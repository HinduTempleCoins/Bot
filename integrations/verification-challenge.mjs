// verification-challenge.mjs — PURE, deterministic human-verification challenge generator.
// No network, no CAPTCHA service, no keys, no I/O, no LLM. Backlog 6bd8577e5e.
//
// PURPOSE (read before changing logic):
//   The signup / troll-box / tutorial flows sometimes need a lightweight "are you a human and
//   paying attention" check WITHOUT pulling in a third-party CAPTCHA, without any network call,
//   and without storing PII. This module turns an INJECTED seed (and an injected clock for
//   expiry) into a small, solvable challenge plus a verifier. It is server-agnostic: the caller
//   decides where the seed comes from (a request nonce, a timestamp, an account name + salt) and
//   where the clock comes from. The module itself does no IO and never throws.
//
//   Three challenge kinds, all answerable by a human reading the prompt:
//     - 'math'     — a small-integer arithmetic word problem ("Add three and four.").
//     - 'phrase'   — echo a short generated phrase back ("Type the phrase: silver-river-7").
//     - 'sequence' — repeat a short ordering ("List these in order: 3, 1, 2 -> 1, 2, 3").
//
//   The prompt NEVER contains the answer literally for math/sequence (math hides the sum;
//   sequence shows a shuffled list, the answer is the sorted list). phrase necessarily shows
//   the phrase to echo — that is the point of an echo challenge — but the stored answer is the
//   normalized form, so it is still checked, not trusted from the prompt.
//
// DETERMINISM: makeChallenge({seed}) is a pure function of (seed, kind). Same seed + same kind
//   -> byte-identical {id, kind, prompt, answer}. This is what the test pins.
//
// SOFT-FAIL, NEVER THROW: a bad/missing seed collapses to a deterministic fallback seed; a
//   missing/garbage submitted answer yields {ok:false}; verifyAnswer on a malformed challenge
//   returns {ok:false}. The functions always return a well-formed value.
//
//   import { makeChallenge, verifyAnswer, isExpired } from './integrations/verification-challenge.mjs';
//   const c = makeChallenge({ seed: 'req-abc-123' });           // {id, kind, prompt, answer}
//   const r = verifyAnswer(c, userInput);                       // {ok, normalizedSubmitted}
//   const dead = isExpired(c.issuedAt, Date.now(), 300);        // boolean
//
// CLI:  node integrations/verification-challenge.mjs            # print one worked example of each kind

// ── HTML escape: used on any value that may be interpolated into a page ─────────────────────────
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const KINDS = ['math', 'phrase', 'sequence'];

// ── Deterministic seed coercion ─────────────────────────────────────────────────────────────────
// Any seed (string, number, object, undefined) -> a stable unsigned 32-bit integer.
// FNV-1a over the string form. A blank/missing seed maps to a fixed fallback, so the module is
// still deterministic and still produces a solvable challenge instead of throwing.
function seedToUint32(seed) {
  let s;
  if (seed === undefined || seed === null) s = '__fallback_seed__';
  else if (typeof seed === 'string') s = seed.length ? seed : '__fallback_seed__';
  else if (typeof seed === 'number' && Number.isFinite(seed)) s = 'n:' + seed;
  else {
    try { s = JSON.stringify(seed); } catch { s = '__fallback_seed__'; }
    if (typeof s !== 'string' || !s.length) s = '__fallback_seed__';
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

// ── seededRng(seed): deterministic LCG ──────────────────────────────────────────────────────────
// Returns a function () -> float in [0,1). Numerical Recipes LCG constants. Pure, no global state.
export function seededRng(seed) {
  let state = seedToUint32(seed);
  return function next() {
    // x_{n+1} = (a x_n + c) mod 2^32
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// helper: pick integer in [lo, hi] inclusive from an rng
function intIn(rng, lo, hi) {
  const span = hi - lo + 1;
  return lo + Math.floor(rng() * span);
}

// short stable id from seed + kind, for logging/lookup. Not secret.
function challengeId(seedUint, kind) {
  return kind.slice(0, 3) + '-' + seedUint.toString(36).padStart(7, '0');
}

// ── normalizeAnswer ─────────────────────────────────────────────────────────────────────────────
// trim, collapse internal whitespace to single spaces, lower-case unless caseSensitive.
export function normalizeAnswer(s, { caseSensitive = false } = {}) {
  let v = String(s ?? '').trim().replace(/\s+/g, ' ');
  if (!caseSensitive) v = v.toLowerCase();
  return v;
}

const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const ADJECTIVES = ['silver', 'golden', 'quiet', 'bright', 'ancient', 'hidden', 'gentle', 'rising'];
const NOUNS = ['river', 'temple', 'falcon', 'ember', 'harbor', 'lantern', 'cedar', 'meadow'];

function numWord(n) {
  return (n >= 0 && n < NUM_WORDS.length) ? NUM_WORDS[n] : String(n);
}

// ── makeChallenge ───────────────────────────────────────────────────────────────────────────────
// makeChallenge({seed, kind?}) -> {id, kind, prompt, answer, issuedAt?}.
//   - kind defaults to one derived deterministically from the seed (so callers can omit it).
//   - an unknown/garbage kind falls back to the seed-derived kind (soft-fail).
//   - prompt never reveals the math/sequence answer; the answer field is the normalized expected.
//   - issuedAt is passed through if provided (caller injects its clock); otherwise omitted.
export function makeChallenge(opts = {}) {
  let seed, kind, issuedAt;
  try {
    ({ seed, kind, issuedAt } = opts && typeof opts === 'object' ? opts : {});
  } catch {
    seed = undefined; kind = undefined; issuedAt = undefined;
  }

  const seedUint = seedToUint32(seed);
  const rng = seededRng(seed);

  // derive a default kind deterministically from the seed
  const derivedKind = KINDS[seedUint % KINDS.length];
  const useKind = KINDS.includes(kind) ? kind : derivedKind;

  let prompt = '';
  let answer = '';

  if (useKind === 'math') {
    const a = intIn(rng, 1, 9);
    const b = intIn(rng, 1, 9);
    const op = rng() < 0.5 ? 'add' : 'subtract';
    if (op === 'add') {
      prompt = `Verification: add ${numWord(a)} and ${numWord(b)}. Reply with the number.`;
      answer = String(a + b);
    } else {
      // keep result non-negative for a clean small-integer answer
      const hi = Math.max(a, b);
      const lo = Math.min(a, b);
      prompt = `Verification: subtract ${numWord(lo)} from ${numWord(hi)}. Reply with the number.`;
      answer = String(hi - lo);
    }
  } else if (useKind === 'phrase') {
    const adj = ADJECTIVES[intIn(rng, 0, ADJECTIVES.length - 1)];
    const noun = NOUNS[intIn(rng, 0, NOUNS.length - 1)];
    const n = intIn(rng, 2, 9);
    const phrase = `${adj}-${noun}-${n}`;
    prompt = `Verification: type this phrase exactly — ${phrase}`;
    answer = phrase;
  } else {
    // sequence: show a shuffled list of small distinct ints; answer is them sorted ascending.
    const count = intIn(rng, 3, 4);
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    // Fisher-Yates with the rng, then take `count`
    for (let i = pool.length - 1; i > 0; i--) {
      const j = intIn(rng, 0, i);
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const picked = pool.slice(0, count);
    const sorted = picked.slice().sort((x, y) => x - y);
    prompt = `Verification: list these numbers in increasing order, separated by spaces — ${picked.join(', ')}`;
    answer = sorted.join(' ');
  }

  const out = {
    id: challengeId(seedUint, useKind),
    kind: useKind,
    prompt,
    answer
  };
  if (issuedAt !== undefined) out.issuedAt = issuedAt;
  return out;
}

// ── verifyAnswer ────────────────────────────────────────────────────────────────────────────────
// verifyAnswer(challenge, submitted, {caseSensitive?}) -> {ok, normalizedSubmitted}.
//   Compares the normalized submission against the normalized stored answer. Soft-fail: a
//   malformed challenge or a missing answer yields {ok:false}. Never throws.
export function verifyAnswer(challenge, submitted, { caseSensitive = false } = {}) {
  const normalizedSubmitted = normalizeAnswer(submitted, { caseSensitive });
  if (!challenge || typeof challenge !== 'object' || typeof challenge.answer !== 'string' || challenge.answer === '') {
    return { ok: false, normalizedSubmitted };
  }
  if (submitted === undefined || submitted === null) {
    return { ok: false, normalizedSubmitted };
  }
  const expected = normalizeAnswer(challenge.answer, { caseSensitive });
  return { ok: normalizedSubmitted === expected && expected !== '', normalizedSubmitted };
}

// ── isExpired ───────────────────────────────────────────────────────────────────────────────────
// isExpired(issuedAt, now, ttlSec) -> boolean. Times are ms epoch (injected by the caller).
//   ttlSec is the lifetime in SECONDS. Soft-fail: bad inputs are treated as expired (fail-closed,
//   the safe direction for a verification gate). Boundary: exactly at the deadline is NOT expired.
export function isExpired(issuedAt, now, ttlSec) {
  const i = Number(issuedAt);
  const n = Number(now);
  const t = Number(ttlSec);
  if (!Number.isFinite(i) || !Number.isFinite(n) || !Number.isFinite(t) || t < 0) return true;
  const deadline = i + t * 1000;
  return n > deadline;
}

// ── CLI (guarded) ───────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('verification-challenge.mjs')) {
  for (const kind of KINDS) {
    const c = makeChallenge({ seed: 'demo-' + kind, kind, issuedAt: 1_700_000_000_000 });
    console.log(`[${c.kind}] id=${c.id}`);
    console.log(`  prompt: ${c.prompt}`);
    console.log(`  answer: ${c.answer}`);
    console.log(`  self-check: ${verifyAnswer(c, c.answer).ok}`);
  }
}
