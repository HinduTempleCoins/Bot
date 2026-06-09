// integrations/ai-tools.mjs
// Read-only TOOL DISPATCH shim — lets the API / local AIs call our own search +
// library + chain reads BY NAME, the way an LLM tool-use loop expects.
//
// Each tool is { name, description, params, run } and wraps an existing module.
// Contract for every tool:
//   • READ-ONLY — no writes, no broadcasts, no key material, no env secrets.
//   • NEVER THROWS — run() soft-fails to { error } so a misbehaving tool can
//     never crash the AI's tool loop.
//   • OFFLINE-TESTABLE — the underlying modules are injectable via __setDeps().
//
// Public API:
//   listTools()        → [{ name, description, params }]  (no run fn — safe to serialize)
//   dispatch(name,args)→ result of the tool's run(args), or { error } for unknown/failed
//
// The wrapped modules (real ones, lazy-imported so a missing optional dep can't
// break import of this shim):
//   our_search      → our-search.search(query, {k, domain, only})
//   library_lookup  → library-index.catalogLookup(query, {domain, k})   (sync, fast)
//   library_recall  → library-index.recall(query, {domain, k})          (semantic)
//   ask_library     → library-rag.askLibrary(question, opts)            (RAG answer)
//   chain_account   → chain-explorer.account(name)                      (read-only chain)

// ── injectable deps (tests override; prod lazy-loads the real modules) ───────
let _deps = null;

/** Tests only: inject fakes. Pass an object of module-name → module-like object.
 *  Keys: ourSearch, libraryIndex, libraryRag, chainExplorer. Pass null to reset. */
export function __setDeps(obj) {
  _deps = obj && typeof obj === 'object' ? obj : null;
}

async function dep(key, modPath) {
  if (_deps && _deps[key]) return _deps[key];
  try { return await import(modPath); }
  catch { return null; }
}

// ── tool registry ────────────────────────────────────────────────────────────
// Each run() returns the wrapped module's result, or { error } — never throws.

const TOOLS = [
  {
    name: 'our_search',
    description: 'Search our federated search ("our Google") across our engines. Returns ranked hits with title/link/snippet.',
    params: {
      query: { type: 'string', required: true, description: 'The search query.' },
      k: { type: 'number', required: false, description: 'Max hits to return (default 8).' },
      domain: { type: 'string', required: false, description: 'Optional domain filter.' },
      only: { type: 'array', required: false, description: 'Optional list of source names to restrict to.' },
    },
    async run({ query, k, domain, only } = {}) {
      const m = await dep('ourSearch', './our-search.mjs');
      if (!m || typeof m.search !== 'function') return { error: 'our_search unavailable' };
      try {
        const opts = {};
        if (k != null) opts.k = k;
        if (domain != null) opts.domain = domain;
        if (only != null) opts.only = only;
        return await m.search(query, opts);
      } catch (e) { return { error: `our_search failed: ${e?.message || e}` }; }
    },
  },
  {
    name: 'library_lookup',
    description: 'Fast catalog lookup over our library index by keyword. Returns matching docs (domain/path/title/keywords) ranked by relevance.',
    params: {
      query: { type: 'string', required: true, description: 'Keywords to look up.' },
      domain: { type: 'string', required: false, description: 'Optional domain (healer/scripture/knowledge/chain).' },
      k: { type: 'number', required: false, description: 'Max results (default 6).' },
    },
    async run({ query, domain, k } = {}) {
      const m = await dep('libraryIndex', './library-index.mjs');
      if (!m || typeof m.catalogLookup !== 'function') return { error: 'library_lookup unavailable' };
      try {
        const opts = {};
        if (domain != null) opts.domain = domain;
        if (k != null) opts.k = k;
        return m.catalogLookup(query, opts);
      } catch (e) { return { error: `library_lookup failed: ${e?.message || e}` }; }
    },
  },
  {
    name: 'library_recall',
    description: 'Semantic recall over the library vector index. Returns nearest-neighbour passages with scores.',
    params: {
      query: { type: 'string', required: true, description: 'The query to recall against.' },
      domain: { type: 'string', required: false, description: 'Optional domain filter.' },
      k: { type: 'number', required: false, description: 'Max passages (default 6).' },
    },
    async run({ query, domain, k } = {}) {
      const m = await dep('libraryIndex', './library-index.mjs');
      if (!m || typeof m.recall !== 'function') return { error: 'library_recall unavailable' };
      try {
        const opts = {};
        if (domain != null) opts.domain = domain;
        if (k != null) opts.k = k;
        return await m.recall(query, opts);
      } catch (e) { return { error: `library_recall failed: ${e?.message || e}` }; }
    },
  },
  {
    name: 'ask_library',
    description: 'Ask the Library a question (RAG). Returns a grounded answer with sources, degrading to retrieved passages when no LLM is configured.',
    params: {
      question: { type: 'string', required: true, description: 'The natural-language question.' },
      topK: { type: 'number', required: false, description: 'Passages to retrieve.' },
    },
    async run({ question, topK } = {}) {
      const m = await dep('libraryRag', './library-rag.mjs');
      if (!m || typeof m.askLibrary !== 'function') return { error: 'ask_library unavailable' };
      try {
        const opts = {};
        if (topK != null) opts.topK = topK;
        return await m.askLibrary(question, opts);
      } catch (e) { return { error: `ask_library failed: ${e?.message || e}` }; }
    },
  },
  {
    name: 'chain_account',
    description: 'Read a chain account (balances, vesting, witness votes, recovery). Read-only — no keys, no broadcasts.',
    params: {
      name: { type: 'string', required: true, description: 'The account name to look up.' },
    },
    async run({ name } = {}) {
      const m = await dep('chainExplorer', './chain-explorer.mjs');
      if (!m || typeof m.account !== 'function') return { error: 'chain_account unavailable' };
      try {
        const r = await m.account(name);
        return r == null ? { error: `account not found: ${name}` } : r;
      } catch (e) { return { error: `chain_account failed: ${e?.message || e}` }; }
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** The tool catalog the AI sees — name/description/params, no run fn (serializable). */
export function listTools() {
  return TOOLS.map(({ name, description, params }) => ({ name, description, params }));
}

/** Route a call to a named tool. Unknown name → { error }. Never throws. */
export async function dispatch(name, args = {}) {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return { error: `unknown tool: ${name}`, available: [...BY_NAME.keys()] };
  }
  try {
    return await tool.run(args || {});
  } catch (e) {
    // run() is meant to soft-fail itself; this is the last-resort guard.
    return { error: `tool ${name} threw: ${e?.message || e}` };
  }
}

// ── CLI: list tools, or `dispatch <name> '<json-args>'` ──────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('ai-tools.mjs');
if (isMain) {
  const [cmd, name, jsonArgs] = process.argv.slice(2);
  if (cmd === 'dispatch' && name) {
    let args = {};
    try { args = jsonArgs ? JSON.parse(jsonArgs) : {}; } catch { args = {}; }
    dispatch(name, args).then((r) => console.log(JSON.stringify(r, null, 2)));
  } else {
    console.log(JSON.stringify(listTools(), null, 2));
  }
}
