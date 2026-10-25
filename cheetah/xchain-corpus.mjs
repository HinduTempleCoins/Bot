// xchain-corpus.mjs — pull a cross-chain corpus for Cheetah from the sibling Graphene chains.
//
// WHY THIS EXISTS
//   alpha-report.mjs scans each post against "the OTHER recent posts" — a MELEK-only corpus. That
//   cannot see the case the brief actually cares about: content that also lives on HIVE, STEEM or
//   BLURT. This module supplies that corpus from the sibling chains' PUBLIC, KEYLESS condenser RPCs.
//
//   No API key, no account, no paid service, and NO LLM — detection is matching, and a generative
//   model would invent a source. (CHEETAH_ADVANCED.md §3.)
//
// WHAT IT DOES, AND WHAT IT HONESTLY CANNOT
//   It fetches the blog of the SAME ACCOUNT NAME on each sibling chain. That is cheap, keyless and
//   high-signal, and it resolves the most common real case on these chains: a person cross-posting
//   their own work, which must be CREDITED, not accused (brief §2).
//
//   It does NOT find a different author on another chain who lifted the text — that needs full-text
//   SEARCH, which the core Graphene RPC does not provide. Do not mistake a clean result here for
//   "not stolen anywhere"; it means "not published under this same name on these chains".
//
// Soft-fail everywhere: a down chain, a missing account or a bad body yields fewer corpus entries,
// never a throw. Injectable fetch so the tests run fully offline.

const CHAINS = [
  { chain: 'hive', rpc: 'https://api.hive.blog', view: (a, p) => `https://peakd.com/@${a}/${p}` },
  { chain: 'blurt', rpc: 'https://rpc.beblurt.com', view: (a, p) => `https://beblurt.com/@${a}/${p}` },
  { chain: 'steem', rpc: 'https://api.steemit.com', view: (a, p) => `https://steemit.com/@${a}/${p}` },
];

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
export function __resetFetch() { _fetch = (...a) => globalThis.fetch(...a); }
export const CHAIN_LIST = CHAINS.map((c) => c.chain);

/** One keyless condenser call. Returns null on any failure — never throws. */
export async function chainCall(rpc, method, params, { timeoutMs = 20000 } = {}) {
  try {
    const r = await _fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    if (!j || j.error) return null;
    return j.result ?? null;
  } catch {
    return null;
  }
}

/** Normalise one chain post into a corpus entry. Returns null if unusable. */
export function toCorpusEntry(p, chain, viewUrl) {
  if (!p || !p.author || !p.permlink) return null;
  const body = typeof p.body === 'string' ? p.body : '';
  if (!body.trim()) return null;
  return {
    author: p.author,
    permlink: p.permlink,
    body,
    chain,
    url: viewUrl(p.author, p.permlink),
    created: p.created || '',
    crossChain: true,
  };
}

/**
 * Blog of one account on one sibling chain.
 * @returns {Promise<object[]>} corpus entries (possibly empty)
 */
export async function fetchAuthorOnChain(author, chainDef, { limit = 10 } = {}) {
  if (!author) return [];
  const raw = await chainCall(chainDef.rpc, 'condenser_api.get_discussions_by_blog', [{ tag: author, limit }]);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && p.author === author && !p.parent_author)
    .map((p) => toCorpusEntry(p, chainDef.chain, chainDef.view))
    .filter(Boolean);
}

/**
 * Cross-chain corpus for a set of MELEK authors.
 * @param {string[]} authors
 * @param {{limitPerAuthor?:number, maxAuthors?:number, chains?:string[]}} opts
 * @returns {Promise<{corpus:object[], perChain:Record<string,number>, errors:string[]}>}
 */
export async function fetchCrossChainCorpus(authors = [], opts = {}) {
  const { limitPerAuthor = 10, maxAuthors = 25, chains = CHAIN_LIST } = opts;
  const uniq = [...new Set(authors.filter(Boolean))].slice(0, maxAuthors);
  const defs = CHAINS.filter((c) => chains.includes(c.chain));
  const corpus = [];
  const perChain = Object.fromEntries(defs.map((d) => [d.chain, 0]));
  const errors = [];

  for (const def of defs) {
    for (const author of uniq) {
      const got = await fetchAuthorOnChain(author, def, { limit: limitPerAuthor });
      if (!got.length) continue;
      perChain[def.chain] += got.length;
      corpus.push(...got);
    }
  }
  // de-duplicate on chain/author/permlink
  const seen = new Set();
  const deduped = corpus.filter((e) => {
    const k = `${e.chain}/${e.author}/${e.permlink}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { corpus: deduped, perChain, errors };
}

/**
 * Is this match the SAME person cross-posting rather than a theft?
 * Same account name on a sibling chain is the credit case, not the accusation case.
 */
export function isLikelySelfCrossPost(post, match) {
  if (!post || !match) return false;
  if (!match.crossChain) return false;
  return String(post.author || '').toLowerCase() === String(match.author || '').toLowerCase();
}
