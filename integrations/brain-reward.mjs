// brain-reward.mjs — Hathor's REWARD / dopamine lobe: a learning signal so what WORKED gets believed
// more and what failed gets believed less. The reward-system gap in the architecture doc. It generalizes
// the decades-brain's per-layer "reliability weight" to ANY tag — a council seat, a skill, an answer
// source, a compartment — so outcomes close the loop (good/bad -> weight -> future routing), and digest()
// surfaces what's being reinforced (the substrate for annals -> training data).
//
// Pure + deterministic + bounded + persistable (pass a store snapshot). No network, no keys.
//
//   import { createReward } from './brain-reward.mjs';
//   const r = createReward();
//   r.reinforce('seat:librarian', 'good');   // weight drifts up toward max
//   r.reinforce('seat:witness', 'bad');       // drifts down toward min
//   r.weightFor('seat:librarian');            // -> ~1.05 ; used to scale a seat's confidence
//   r.digest();                               // -> { reinforced:[...], penalized:[...] }

const DEFAULTS = { rate: 0.1, min: 0.5, max: 1.5, start: 1.0 };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// outcome -> signed reward in [-1, 1]
function toSignal(outcome) {
  if (typeof outcome === 'number') return clamp(outcome, -1, 1);
  const o = String(outcome || '').toLowerCase();
  if (/good|win|correct|accept|success|up|\+/.test(o)) return 1;
  if (/bad|loss|wrong|reject|fail|down|-/.test(o)) return -1;
  return 0; // neutral
}

export function createReward({ store = null, rate, min, max, start } = {}) {
  const cfg = { rate: rate ?? DEFAULTS.rate, min: min ?? DEFAULTS.min, max: max ?? DEFAULTS.max, start: start ?? DEFAULTS.start };
  const weights = new Map();                 // tag -> weight
  const stats = new Map();                   // tag -> { n, good, bad }
  if (store && store.weights) for (const [k, v] of Object.entries(store.weights)) weights.set(k, v);
  if (store && store.stats) for (const [k, v] of Object.entries(store.stats)) stats.set(k, v);

  const w = (tag) => (weights.has(tag) ? weights.get(tag) : cfg.start);

  return {
    config: cfg,
    /** Reinforce a tag by an outcome. Returns the new weight. */
    reinforce(tag, outcome = 'neutral') {
      if (!tag) return cfg.start;
      const sig = toSignal(outcome);
      const next = clamp(w(tag) + cfg.rate * sig, cfg.min, cfg.max);
      weights.set(tag, Math.round(next * 1000) / 1000);
      const st = stats.get(tag) || { n: 0, good: 0, bad: 0 };
      st.n++; if (sig > 0) st.good++; else if (sig < 0) st.bad++;
      stats.set(tag, st);
      return weights.get(tag);
    },
    reinforceMany(list = []) { return list.map((e) => this.reinforce(e.tag, e.outcome)); },

    /** Current learned weight for a tag (1.0 if unseen). Scale a candidate's confidence by this. */
    weightFor(tag) { return w(tag); },

    /** Apply the reward weight to a raw confidence (the routing use). */
    adjust(tag, confidence) { return clamp((Number(confidence) || 0) * w(tag), 0, 1.5); },

    /** What is being reinforced vs. penalized — the learning-loop readout. */
    digest(k = 5) {
      const rows = [...weights.entries()].map(([tag, weight]) => ({ tag, weight, ...(stats.get(tag) || { n: 0, good: 0, bad: 0 }) }));
      return {
        reinforced: rows.filter((r) => r.weight > cfg.start).sort((a, b) => b.weight - a.weight).slice(0, k),
        penalized: rows.filter((r) => r.weight < cfg.start).sort((a, b) => a.weight - b.weight).slice(0, k),
        tracked: rows.length,
      };
    },

    /** Persistable snapshot (hand to `store` next time). */
    snapshot() {
      return { weights: Object.fromEntries(weights), stats: Object.fromEntries(stats) };
    },
  };
}
