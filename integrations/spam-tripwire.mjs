// spam-tripwire.mjs — detect flooding and repetition, then escalate into the lucidity gate.
//
// The rule, in the operator's terms: after N consecutive or identical messages in some window, you
// get a Turing test that is not a CAPTCHA. This is the detector half; `shulgin-gate.mjs` is the
// challenge half.
//
// SCOPE, honestly. This is LAYER 7. It stops application-layer flooding, comment spam, copy-paste
// campaigns and coordinated posting. It does NOT stop a volumetric DDoS — a 500 Gbit/s SYN flood
// never reaches Node, and anything claiming to solve that in application code is lying. Volumetric
// belongs upstream at the edge. What this catches is the far more common thing that actually takes
// our surfaces down: one script, a thousand identical POSTs.
//
// Three detectors, because the three attacks look nothing alike:
//
//   BURST      — many messages from one identity fast. The dumb flood.
//   REPETITION — the same message again and again from one identity. The spam campaign.
//   CHORUS     — the same message from MANY identities at once. The botnet, and the only one of the
//                three that a per-identity rate limit cannot see, because each member is quiet.
//
// Memory is capped on purpose. An unbounded per-IP map is not a DDoS defence, it is a second DDoS
// vector: the attacker picks a new source every request and we allocate until we die. Everything
// here is a fixed-size LRU with time-based eviction.

import { createHash } from 'node:crypto';

export const DEFAULTS = {
  burstCount: 5,          // messages from one identity...
  burstWindowMs: 10_000,  // ...within this window
  repeatCount: 3,         // identical/near-identical messages from one identity...
  repeatWindowMs: 300_000,
  chorusIdentities: 4,    // distinct identities posting the same thing...
  chorusWindowMs: 60_000,
  maxIdentities: 20_000,  // hard ceiling on tracked identities
  maxDigests: 50_000,     // hard ceiling on tracked message digests
  cooldownMs: 600_000,    // how long a tripped identity stays challenged
};

/** Normalise before hashing so trivial mutation does not defeat repetition detection. */
export function normalise(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')      // strip accents
    .replace(/https?:\/\/\S+/g, ' ¤url¤ ')         // any URL is "a URL"
    .replace(/\d+/g, '#')                                    // 100 free coins == 500 free coins
    .replace(/[^\p{L}\p{N}\s¤]/gu, ' ')                 // drop punctuation/emoji padding
    .replace(/\s+/g, ' ')
    .trim();
}

const digest = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

/**
 * Word-shingle set, for near-duplicate detection. Spam campaigns spin a few words per send; an
 * exact hash misses that and a full edit-distance is too slow to run per request.
 */
export function shingles(text, k = 3) {
  const w = normalise(text).split(' ').filter(Boolean);
  if (w.length < k) return new Set(w.length ? [w.join(' ')] : []);
  const out = new Set();
  for (let i = 0; i <= w.length - k; i++) out.add(w.slice(i, i + k).join(' '));
  return out;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit++;
  return hit / (a.size + b.size - hit);
}

// A Map in JS preserves insertion order, which is all an LRU needs: re-set on touch, delete from
// the front when over the cap.
function touch(map, key, val, cap) {
  if (map.has(key)) map.delete(key);
  map.set(key, val);
  while (map.size > cap) map.delete(map.keys().next().value);
  return val;
}

export class SpamTripwire {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.identities = new Map();   // id -> { times[], recent[{sh, at}], trippedUntil, degree }
    this.digests = new Map();      // normalised-digest -> { ids:Set, at }
  }

  /** Recognised peers get room to work. A MASTER-degree agent is not re-challenged every minute. */
  setDegree(id, degree) {
    const st = this.#state(id);
    st.degree = degree | 0;
    if (st.degree >= 3) st.trippedUntil = 0;
  }

  #state(id) {
    const st = this.identities.get(id) || { times: [], recent: [], trippedUntil: 0, degree: 0 };
    return touch(this.identities, id, st, this.o.maxIdentities);
  }

  /** Budget multiplier by degree: unknown 1x, apprentice 2x, fellow 4x, master effectively exempt. */
  #allowance(degree) { return [1, 2, 4, 1000][Math.max(0, Math.min(3, degree | 0))]; }

  /**
   * Record one message and say what should happen.
   * Returns { action: 'allow'|'challenge'|'cooldown', trigger, detail, evidence }.
   * Never throws; a detector that can crash is a denial-of-service of its own.
   */
  check(id, text, now = Date.now()) {
    const o = this.o;
    const st = this.#state(String(id));
    const mult = this.#allowance(st.degree);

    if (st.trippedUntil > now) {
      return { action: 'cooldown', trigger: st.trigger || 'prior', detail: 'still cooling down',
        retryInMs: st.trippedUntil - now, degree: st.degree };
    }

    const norm = normalise(text);
    const sh = shingles(text);
    const d = digest(norm);

    st.times.push(now);
    st.times = st.times.filter((t) => now - t <= Math.max(o.burstWindowMs, o.repeatWindowMs));
    st.recent.push({ sh, at: now });
    if (st.recent.length > 40) st.recent.shift();

    // CHORUS. Tracked before the per-identity checks because it is the one a rate limit misses.
    const seen = this.digests.get(d) || { ids: new Set(), at: now };
    seen.ids.add(String(id));
    seen.at = now;
    touch(this.digests, d, seen, o.maxDigests);

    if (norm.length >= 12 && seen.ids.size >= o.chorusIdentities && now - seen.at <= o.chorusWindowMs) {
      return this.#trip(st, 'chorus',
        `the same message from ${seen.ids.size} identities inside ${o.chorusWindowMs / 1000}s`,
        { identities: seen.ids.size }, now);
    }

    // BURST.
    const inBurst = st.times.filter((t) => now - t <= o.burstWindowMs).length;
    if (inBurst >= o.burstCount * mult) {
      return this.#trip(st, 'burst',
        `${inBurst} messages inside ${o.burstWindowMs / 1000}s`, { count: inBurst }, now);
    }

    // REPETITION — exact or near, within the longer window.
    let near = 0;
    for (const r of st.recent.slice(0, -1)) {
      if (now - r.at > o.repeatWindowMs) continue;
      if (jaccard(sh, r.sh) >= 0.8) near++;
    }
    if (near + 1 >= o.repeatCount * mult) {
      return this.#trip(st, 'repetition',
        `${near + 1} near-identical messages inside ${o.repeatWindowMs / 1000}s`,
        { count: near + 1 }, now);
    }

    return { action: 'allow', degree: st.degree };
  }

  #trip(st, trigger, detail, evidence, now) {
    st.trippedUntil = now + this.o.cooldownMs;
    st.trigger = trigger;
    // A tripped identity starts over, so passing the gate is a real reset rather than an identity
    // that is permanently one message away from tripping again.
    st.times = []; st.recent = [];
    return { action: 'challenge', trigger, detail, evidence, degree: st.degree,
      cooldownMs: this.o.cooldownMs };
  }

  /** Called after the gate is answered. A pass clears the cooldown and records the degree earned. */
  resolve(id, { allow, degree = 0 } = {}, now = Date.now()) {
    const st = this.#state(String(id));
    st.degree = Math.max(st.degree, degree | 0);
    if (allow) { st.trippedUntil = 0; st.trigger = null; return { action: 'allow', degree: st.degree }; }
    st.trippedUntil = now + this.o.cooldownMs;
    return { action: 'cooldown', retryInMs: this.o.cooldownMs, degree: st.degree };
  }

  /** Drop everything older than the longest window. Cheap to call on a timer. */
  sweep(now = Date.now()) {
    const horizon = Math.max(this.o.repeatWindowMs, this.o.chorusWindowMs, this.o.cooldownMs);
    for (const [k, v] of this.digests) if (now - v.at > horizon) this.digests.delete(k);
    for (const [k, v] of this.identities) {
      const last = v.times[v.times.length - 1] || 0;
      if (now - Math.max(last, v.trippedUntil) > horizon && v.degree < 3) this.identities.delete(k);
    }
    return { identities: this.identities.size, digests: this.digests.size };
  }

  stats() { return { identities: this.identities.size, digests: this.digests.size }; }
}
