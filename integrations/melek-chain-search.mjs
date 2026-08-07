// melek-chain-search.mjs — search the MELEK chain ITSELF (posts + accounts) so people can find things on
// MELEK. This is the piece our federated "our own Google" (our-search.mjs) and the public SoapBox Search
// were missing: everything else indexed our corpus/verticals, nothing indexed the live chain content.
//
// Graphene has no full-text index, so we query the RPC breadth-first — trending + newest across the query
// (used as a tag) plus a set of active tags — then rank hits by query-term overlap in title/tags/author/
// body. Accounts are matched by name prefix. READ-ONLY, no keys, soft-fails to [] (a dead RPC never throws).
//
//   import { searchMelek } from './melek-chain-search.mjs';
//   const hits = await searchMelek('walking rewards', { k: 8 });
//   // -> [{ source:'melek', kind:'post'|'account', title, link, snippet, score, author?, tags? }]
//
// CLI:  node integrations/melek-chain-search.mjs "van kush beauty"  [--k=8]

let _fetch = (...a) => globalThis.fetch(...a);
/** Inject fetch (tests pass a fake; default = global fetch). */
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

const RPC = () => process.env.MELEK_RPC_URL || 'https://melek.salon/rpc';
const CONDENSER = () => process.env.MELEK_CONDENSER_URL || 'https://melek.salon';
const ACTIVE_TAGS = ['melek', 'vankush', 'move', 'hive', 'life', 'photography', 'art', 'crypto'];

/** One condenser_api JSON-RPC call. Soft-fails to null. */
async function rpcCall(method, params) {
  try {
    const r = await _fetch(RPC(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.' + method, params }),
    });
    const j = await r.json();
    return j && 'result' in j ? j.result : null;
  } catch { return null; }
}

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const norm = (s) => String(s || '').toLowerCase();
const STOP = new Set(['the', 'and', 'for', 'with', 'you', 'are', 'this', 'that', 'from', 'was', 'but', 'not', 'all', 'can', 'has', 'our', 'your', 'his', 'her', 'its', 'to', 'of', 'in', 'on', 'at', 'by', 'is', 'be', 'as', 'or', 'an', 'it', 'we', 'my', 'me', 'do', 'so', 'up', 'if', 'no', 'a', 'i']);
const terms = (q) => norm(q).split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
function snippetOf(body, ts) {
  const text = String(body || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[#>*_`~\[\]()]/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  const at = ts.map((t) => text.toLowerCase().indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  const start = at != null && at > 40 ? at - 40 : 0;
  return (start ? '…' : '') + text.slice(start, start + 200) + (text.length > start + 200 ? '…' : '');
}

/** Score a post 0..1 by query-term overlap, weighted (title/tag > author > body), with a small vote nudge. */
function scorePost(p, ts) {
  const title = norm(p.title), author = norm(p.author);
  let tags = []; try { tags = (JSON.parse(p.json_metadata || '{}').tags || []).map(norm); } catch {}
  const body = norm(p.body).slice(0, 4000);
  let s = 0;
  for (const t of ts) {
    if (title.includes(t)) s += 3;
    if (tags.some((g) => g.includes(t))) s += 2;
    if (author.includes(t)) s += 2;
    if (body.includes(t)) s += 1;
  }
  if (!s) return 0;
  const votes = Math.max(0, Number(p.net_votes) || 0);
  return Math.min(1, s / (ts.length * 3)) * 0.9 + Math.min(0.1, votes / 200);
}

/**
 * Search MELEK chain content. Returns up to k ranked hits (posts first, then account matches).
 * @param {string} query
 * @param {{k?:number, rpc?:Function}} [opts]  rpc override lets tests inject canned chain data
 */
export async function searchMelek(query, opts = {}) {
  const ts = terms(query);
  if (!ts.length) return [];
  const k = opts.k || 8;
  const call = opts.rpc || rpcCall;

  // gather candidate posts: the query as a tag (trending + created) + a sweep of active tags
  const tagsToPull = [...new Set([ts[0], norm(query).replace(/\s+/g, '-'), ...ACTIVE_TAGS])].slice(0, 8);
  const safe = (m, p) => Promise.resolve().then(() => call(m, p)).catch(() => null);
  const batches = await Promise.all(tagsToPull.flatMap((tag) => [
    safe('get_discussions_by_trending', [{ tag, limit: 20 }]),
    safe('get_discussions_by_created', [{ tag, limit: 20 }]),
  ]));
  const seen = new Set(); const posts = [];
  for (const b of batches) for (const p of (Array.isArray(b) ? b : [])) {
    const id = `${p.author}/${p.permlink}`;
    if (seen.has(id) || !p.author) continue; seen.add(id); posts.push(p);
  }
  const postHits = posts.map((p) => ({ p, score: scorePost(p, ts) }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k)
    .map(({ p, score }) => {
      let tags = []; try { tags = JSON.parse(p.json_metadata || '{}').tags || []; } catch {}
      return { source: 'melek', kind: 'post', title: p.title || `@${p.author}/${p.permlink}`,
        link: `${CONDENSER()}/@${p.author}/${p.permlink}`, author: p.author, tags,
        snippet: snippetOf(p.body, ts), score };
    });

  // account matches (name prefix) — helps people find people/projects on MELEK
  let accountHits = [];
  const lookup = await Promise.resolve().then(() => call('lookup_accounts', [ts[0], 8])).catch(() => null);
  if (Array.isArray(lookup) && lookup.length) {
    const names = lookup.filter((n) => ts.some((t) => n.includes(t))).slice(0, 4);
    accountHits = names.map((n, i) => ({ source: 'melek', kind: 'account', title: `@${n}`,
      link: `${CONDENSER()}/@${n}`, snippet: `MELEK account @${n}`, score: 0.5 - i * 0.05 }));
  }

  return [...postHits, ...accountHits].slice(0, k);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const kArg = args.find((a) => a.startsWith('--k='));
  const q = args.filter((a) => !a.startsWith('--')).join(' ');
  searchMelek(q, { k: kArg ? Number(kArg.split('=')[1]) : 8 }).then((hits) => {
    console.log(`MELEK search "${q}" — ${hits.length} hit(s):`);
    for (const h of hits) console.log(`  [${h.kind}] ${h.title}\n    ${h.link}  (score ${h.score.toFixed(2)})\n    ${h.snippet.slice(0, 120)}`);
  });
}
