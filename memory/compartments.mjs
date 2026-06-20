// compartments.mjs — the COMPARTMENTALIZATION CHAMBER of Hathor's brain.
//
// Operator (2026-06-20): she can play a game with people 24/7 AND meet the same person in MELEK chat, but
// the game must NOT frame everything she says elsewhere. So memory is COMPARTMENTALIZED per domain — Game,
// MELEK, Trading, PRANA — each its own store. The walls are permeable ON DEMAND: if someone in MELEK chat
// brings up a game thing, she can recall it, weighted by how RELATED the compartments are (PRANA↔MELEK are
// close; the Game is mostly isolated). Memory is also PERSON-indexed so it follows a person across
// compartments. This is the relationship/Crypt-ology graph as a memory router.
//
// Built ON memory/index.mjs (createMemoryIndex) — one store per compartment. `makeStore` is injectable so
// it runs fully offline in tests; the default wires the real vector stack. Soft-fails, never throws.

// Default compartments + how related they are (symmetric weights 0..1). PRANA↔MELEK closest (one
// ecosystem); Trading near MELEK; the Game mostly isolated. Cross-recall scales by these weights.
export const DEFAULT_COMPARTMENTS = ['game', 'melek', 'trading', 'prana'];
export const DEFAULT_EDGES = {
  'melek|prana': 0.8,
  'melek|trading': 0.5,
  'prana|trading': 0.4,
  'game|melek': 0.12,
  'game|prana': 0.1,
  'game|trading': 0.08,
};

const edgeKey = (a, b) => [a, b].sort().join('|');

/**
 * Build the brain's compartmented memory.
 * @param {object} cfg {
 *   compartments?: string[],
 *   edges?: { [pair]: weight },
 *   makeStore?: (name) => { ingestRecords(records):Promise, recall(query,opts):Promise<[{id,text,meta,score}]> }
 * }
 */
export function createBrainMemory(cfg = {}) {
  const names = cfg.compartments || DEFAULT_COMPARTMENTS;
  const edges = { ...DEFAULT_EDGES, ...(cfg.edges || {}) };
  const makeStore = cfg.makeStore || defaultMakeStore;
  const stores = new Map();
  let seq = 0;

  function store(name) {
    if (!names.includes(name)) names.push(name);          // allow new compartments on the fly
    if (!stores.has(name)) stores.set(name, makeStore(name));
    return stores.get(name);
  }

  // how related two compartments are (1 to itself; default 0 if no edge).
  function relatedWeight(a, b) {
    if (a === b) return 1;
    return edges[edgeKey(a, b)] ?? 0;
  }

  /** Store a memory in ONE compartment, tagged with the person it concerns. */
  async function remember(compartment, { text, person = null, meta = {} } = {}) {
    if (!text || !String(text).trim()) return { ok: false };
    const id = `${compartment}:${person || '_'}:${++seq}`;
    try {
      await store(compartment).ingestRecords([{ id, text: String(text), meta: { ...meta, compartment, person } }]);
      return { ok: true, id };
    } catch { return { ok: false }; }
  }

  /** Recall WITHIN one compartment (optionally only this person's memories). */
  async function recall(compartment, query, { k = 5, person = null } = {}) {
    try {
      const over = person ? k * 4 : k;
      let hits = await store(compartment).recall(query, { k: over });
      hits = (hits || []).map((h) => ({ ...h, compartment }));
      if (person) hits = hits.filter((h) => (h.meta && h.meta.person) === person);
      return hits.slice(0, k);
    } catch { return []; }
  }

  /**
   * Recall PRIMARILY from one compartment, but allow related compartments to surface when strongly
   * relevant — scaled by the relationship graph. This is "compartmentalized, but she can cross-reference."
   */
  async function recallAcross(query, { from, person = null, k = 5, minWeight = 0.05 } = {}) {
    const out = [];
    for (const name of names) {
      const w = relatedWeight(from, name);
      if (w < minWeight) continue;
      const hits = await recall(name, query, { k, person });
      for (const h of hits) out.push({ ...h, weight: round(w), weightedScore: round((h.score ?? 0) * w) });
    }
    return out.sort((a, b) => b.weightedScore - a.weightedScore).slice(0, k);
  }

  /** Everything a given PERSON has touched, across all compartments — memory follows the person. */
  async function recallForPerson(person, query, { k = 5 } = {}) {
    const out = [];
    for (const name of names) {
      const hits = await recall(name, query, { k, person });
      out.push(...hits);
    }
    return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, k);
  }

  return {
    remember, recall, recallAcross, recallForPerson, relatedWeight,
    compartments: () => [...names],
    edges: () => ({ ...edges }),
  };
}

function round(x) { return Math.round((x || 0) * 1000) / 1000; }

// Default store factory: a real per-compartment vector index (lazy import so tests that inject makeStore
// never load the embedding stack). Soft-fails to a tiny in-memory keyword store if the stack is absent.
function defaultMakeStore(/* name */) {
  let inner = null;
  const fallback = makeKeywordStore();
  async function ensure() {
    if (inner) return inner;
    try {
      const [{ createMemoryIndex }, { makeFakeDb }, { createEmbedder }] = await Promise.all([
        import('./index.mjs'), import('./vector-store.mjs'), import('./embed.mjs'),
      ]);
      inner = createMemoryIndex({ db: makeFakeDb(), embed: createEmbedder({ backend: 'hash' }) });
    } catch { inner = fallback; }
    return inner;
  }
  return {
    async ingestRecords(records) { return (await ensure()).ingestRecords(records); },
    async recall(query, opts) { return (await ensure()).recall(query, opts); },
  };
}

// Minimal keyword store — a dependency-free fallback so the chamber always works.
export function makeKeywordStore() {
  const recs = [];
  const toks = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  return {
    async ingestRecords(records) { for (const r of records) recs.push(r); return { ingested: records.length }; },
    async recall(query, { k = 5 } = {}) {
      const q = toks(query);
      return recs.map((r) => {
        const rt = toks(r.text); let n = 0; for (const w of q) if (rt.has(w)) n++;
        return { id: r.id, text: r.text, meta: r.meta, score: q.size ? n / q.size : 0 };
      }).filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const brain = createBrainMemory({ makeStore: () => makeKeywordStore() });
  await brain.remember('game', { text: 'VanKushFam built a cobblestone tower near the river', person: 'VanKushFam' });
  await brain.remember('melek', { text: 'VanKushFam asked about the welcome grant on MELEK', person: 'VanKushFam' });
  await brain.remember('prana', { text: 'PRANA testnet reward for the river mining pool', person: 'VanKushFam' });
  console.log('in MELEK, recall "river":', (await brain.recallAcross('river tower', { from: 'melek', person: 'VanKushFam' })).map((h) => `${h.compartment}(${h.weightedScore})`).join(', '));
  console.log('VanKushFam everywhere:', (await brain.recallForPerson('VanKushFam', 'river')).map((h) => h.compartment).join(', '));
}
