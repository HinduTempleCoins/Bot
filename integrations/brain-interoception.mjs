// brain-interoception.mjs — Hathor's INTEROCEPTION lobe: the brain feeling its OWN body. The homeostasis
// gap in the architecture doc — one unified "how do I feel" signal over the signals that ARE her body:
// service health, key freshness, compute/token budget, vault reachability, disk. She reads the room with
// the amygdala; this is her reading HERSELF, so she can say when she's strained and the disposition can
// soften or escalate accordingly.
//
// Pure + injectable + soft-fail: you pass a `signals` source (sync value, or async fn) describing raw
// body state; feel() maps it to a bounded wellbeing score + a mood + concerns. No network, no keys here.
//
//   import { createInteroception } from './brain-interoception.mjs';
//   const body = createInteroception({ signals: async () => ({ services:{ pentecaust:'active', wiki:'failed' },
//     keyAgeHours: 2, budgetFraction: 0.6, vaultReachable: true, diskFreeFraction: 0.3 }) });
//   await body.feel();  // -> { wellbeing, mood, concerns, signals }
//
// Signal shape (all optional; missing => not assessed):
//   services        { name: 'active'|'failed'|'inactive'|... }  (systemd-style)
//   keyAgeHours     number  — how long since the active key was rotated/fetched
//   budgetFraction  0..1    — remaining compute/token budget
//   vaultReachable  boolean
//   diskFreeFraction 0..1

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// thresholds (overridable) — each maps a body signal to a wellbeing penalty + a concern line.
const DEFAULTS = {
  keyStaleHours: 24,      // beyond this, the active key is "stale"
  lowBudget: 0.15,        // below this fraction, budget is a concern
  lowDisk: 0.1,           // below this fraction free, disk is a concern
};

export function createInteroception({ signals = null, thresholds = {} } = {}) {
  const T = { ...DEFAULTS, ...thresholds };

  async function read() {
    try { return (typeof signals === 'function' ? await signals() : signals) || {}; }
    catch { return {}; }
  }

  function assess(s) {
    let score = 1; const concerns = []; const good = [];
    // services: each down critical service bites; mostly-up reassures.
    if (s.services && typeof s.services === 'object') {
      const names = Object.keys(s.services);
      const down = names.filter((n) => !/^(active|running|ok|up|healthy)$/i.test(String(s.services[n])));
      if (names.length) {
        score -= 0.5 * (down.length / names.length);
        if (down.length) concerns.push(`services down: ${down.join(', ')}`);
        else good.push(`all ${names.length} services up`);
      }
    }
    // active key freshness
    if (typeof s.keyAgeHours === 'number') {
      if (s.keyAgeHours > T.keyStaleHours) { score -= 0.15; concerns.push(`active key is ${Math.round(s.keyAgeHours)}h old (stale)`); }
      else good.push('key fresh');
    }
    // compute/token budget
    if (typeof s.budgetFraction === 'number') {
      if (s.budgetFraction < T.lowBudget) { score -= 0.2; concerns.push(`low budget (${Math.round(s.budgetFraction * 100)}% left)`); }
      else good.push('budget healthy');
    }
    // vault reachability (custody lifeline)
    if (typeof s.vaultReachable === 'boolean') {
      if (!s.vaultReachable) { score -= 0.25; concerns.push('vault unreachable'); }
      else good.push('vault reachable');
    }
    // disk
    if (typeof s.diskFreeFraction === 'number') {
      if (s.diskFreeFraction < T.lowDisk) { score -= 0.15; concerns.push(`low disk (${Math.round(s.diskFreeFraction * 100)}% free)`); }
    }
    const wellbeing = clamp01(score);
    const mood = wellbeing >= 0.75 ? 'well' : wellbeing >= 0.45 ? 'strained' : 'at-risk';
    return { wellbeing: Math.round(wellbeing * 100) / 100, mood, concerns, good };
  }

  return {
    thresholds: T,
    /** Full self-state read. Soft-fails to a neutral 'unknown' body if nothing is wired. */
    async feel() {
      const s = await read();
      if (!s || !Object.keys(s).length) return { wellbeing: null, mood: 'unknown', concerns: [], good: [], signals: {} };
      return { ...assess(s), signals: s };
    },
    /** A short first-person line Hathor can say about her own state. */
    async report() {
      const f = await this.feel();
      if (f.mood === 'unknown') return 'I cannot feel my own state right now.';
      if (f.mood === 'well') return `I am well — ${f.good.slice(0, 3).join(', ') || 'all systems nominal'}.`;
      return `I am ${f.mood}: ${f.concerns.join('; ') || 'something is off'}.`;
    },
    /** A disposition hint other lobes can weight by (terser/more careful when strained). */
    async dispositionBias() {
      const f = await this.feel();
      return { mood: f.mood, wellbeing: f.wellbeing, terse: f.mood !== 'well', careful: f.mood === 'at-risk' };
    },
  };
}
