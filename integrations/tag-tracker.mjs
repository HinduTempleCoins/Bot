// tag-tracker.mjs — the MELEK TAG TRACKER: trending-tags analytics over the chain's own tag feeds.
// Tags are the "subreddits of Steemit" (operator 2026-08-24) — the atomic topic unit on a Graphene
// social chain. This is the READ/analytics counterpart to the existing tag-REWARD engines
// (hashtag-reward / scot-tag-distribution): for any tag it reports post count, unique authors, pending
// payout, the top posts, and — against a prior snapshot — velocity; plus a trending-tags leaderboard
// across a configured tag set. See .local/RESEARCH_SOCIAL_ANALYTICS_HASHTAG_MERIT.md (build step 1).
//
//   import { tagBoard, trendingTags, headline, renderBoard, handler } from './integrations/tag-tracker.mjs';
//   const b = await tagBoard({ tag: 'melek' });
//   res.end(renderBoard(b));
//
// READ-ONLY · NO KEYS · SOFT-FAIL. Standard condenser_api tag feeds only. Injectable fetch → offline tests.
//
//   node integrations/tag-tracker.mjs melek     # print a tag summary (live; soft-fails to n/a)

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export function rpcUrl() { return process.env.MELEK_RPC_URL || ''; }
export function configured() { return !!rpcUrl(); }
export function network() { return String(process.env.MELEK_NETWORK || 'testnet').toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet'; }
export function networkLabel() { return network() === 'mainnet' ? '[MELEK]' : '[TestNet not MELEK]'; }

// The tags the leaderboard scans when no specific tag is requested (env-overridable, never hard-hosted).
export function activeTags() {
  const env = String(process.env.TAG_TRACKER_TAGS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return env.length ? env : ['melek', 'hathor', 'introduceyourself', 'witness', 'prana', 'life', 'crypto', 'art'];
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const round = (n, p = 3) => +num(n).toFixed(p);
function assetNum(v) { if (typeof v === 'number') return num(v); const m = String(v || '').match(/^[-+]?\d*\.?\d+/); return m ? num(m[0]) : 0; }
const normTag = (t) => String(t || '').trim().toLowerCase().replace(/^#/, '');

async function rpc(method, params = [], timeout = 12000) {
  const url = rpcUrl();
  if (!url) return null;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await _fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || d.error) return null;
    return d.result;
  } catch { return null; } finally { clearTimeout(t); }
}

function payoutOf(p) { return assetNum(p && p.pending_payout_value) + assetNum(p && p.total_payout_value) + assetNum(p && p.curator_payout_value); }

/**
 * Raw stats for one tag: reads the trending + newest feeds and computes headline metrics.
 * @returns {Promise<object|null>} { tag, postCount, uniqueAuthors, totalPayout, top[], newestAt } or null.
 */
export async function tagStats(tag, { limit = 50 } = {}) {
  const g = normTag(tag);
  if (!g) return null;
  const [trending, created] = await Promise.all([
    rpc('condenser_api.get_discussions_by_trending', [{ tag: g, limit }]),
    rpc('condenser_api.get_discussions_by_created', [{ tag: g, limit }]),
  ]);
  const tr = Array.isArray(trending) ? trending : [];
  const cr = Array.isArray(created) ? created : [];
  if (!tr.length && !cr.length) return { tag: g, postCount: 0, uniqueAuthors: 0, totalPayout: 0, top: [], newestAt: null, empty: true };

  const authors = new Set();
  let totalPayout = 0;
  for (const p of tr) { if (p && p.author) authors.add(p.author); totalPayout += payoutOf(p); }
  for (const p of cr) { if (p && p.author) authors.add(p.author); }

  const top = tr.slice().sort((a, b) => payoutOf(b) - payoutOf(a)).slice(0, 5).map((p) => ({
    author: p.author, title: p.title || '(untitled)',
    payout: round(payoutOf(p), 3), votes: num(p.net_votes), comments: num(p.children),
    link: `/@${p.author}/${p.permlink}`,
  }));

  return {
    tag: g,
    postCount: Math.max(tr.length, cr.length),
    uniqueAuthors: authors.size,
    totalPayout: round(totalPayout, 3),
    top,
    newestAt: cr[0] && cr[0].created ? cr[0].created : null,
    empty: false,
  };
}

/**
 * Board for one tag. `prev` (a prior tagStats result for the same tag) enables velocity (Δ post count).
 */
export async function tagBoard({ tag, limit = 50, prev = null, stats = null } = {}) {
  const asOf = new Date().toISOString();
  const g = normTag(tag);
  const s = stats || (await tagStats(g, { limit }));
  if (!s || s.empty) {
    return { asOf, tag: g, network: network(), label: networkLabel(), found: false,
      postCount: 0, uniqueAuthors: 0, totalPayout: 0, top: [], velocity: null,
      sections: { activity: { ok: false }, top: { ok: false } } };
  }
  const velocity = prev && Number.isFinite(+prev.postCount) ? s.postCount - prev.postCount : null;
  return {
    asOf, tag: g, network: network(), label: networkLabel(), found: true,
    postCount: s.postCount, uniqueAuthors: s.uniqueAuthors, totalPayout: s.totalPayout,
    newestAt: s.newestAt, top: s.top, velocity,
    sections: { activity: { ok: true }, top: { ok: s.top.length > 0 } },
  };
}

/**
 * Trending-tags leaderboard across a set of tags (default: activeTags()). Each tag soft-fails to zeros.
 * Ranked by total payout then post count. Cheap-ish: one trending call per tag (small limit).
 */
export async function trendingTags({ tags, limit = 20 } = {}) {
  const list = (Array.isArray(tags) && tags.length ? tags : activeTags()).map(normTag).filter(Boolean).slice(0, 24);
  const rows = await Promise.all(list.map(async (g) => {
    const s = await tagStats(g, { limit }).catch(() => null);
    return s ? { tag: g, postCount: s.postCount, uniqueAuthors: s.uniqueAuthors, totalPayout: s.totalPayout } : { tag: g, postCount: 0, uniqueAuthors: 0, totalPayout: 0 };
  }));
  rows.sort((a, b) => (b.totalPayout - a.totalPayout) || (b.postCount - a.postCount));
  return { asOf: new Date().toISOString(), network: network(), label: networkLabel(), tags: rows };
}

export function headline(board) {
  if (!board) return 'Tag tracker unavailable.';
  if (!board.found) return `#${esc(board.tag)} — no posts found on ${board.label}.`;
  const v = board.velocity == null ? '' : ` · ${board.velocity >= 0 ? '+' : ''}${board.velocity} vs last`;
  return `#${board.tag} — ${board.postCount} posts · ${board.uniqueAuthors} authors · ${Number(board.totalPayout).toLocaleString()} payout${v} ${board.label}`;
}

// ── render ────────────────────────────────────────────────────────────────────────────────────────
export function renderBoard(board) {
  if (!board) return `<div class="tag-tracker"><p>Tag tracker unavailable.</p></div>`;
  if (!board.found) return `<div class="tag-tracker"><h2>#${esc(board.tag)}</h2><p>No posts found on ${esc(board.label)}.</p></div>`;
  const top = board.top.length
    ? `<ol class="tt-top">${board.top.map((p) => `<li><strong>${esc(p.title)}</strong> — @${esc(p.author)} · ${esc(p.payout)} payout · ${esc(p.votes)} votes</li>`).join('')}</ol>`
    : '<p>No top posts.</p>';
  const vel = board.velocity == null ? '' : `<p class="tt-mut">Velocity: ${board.velocity >= 0 ? '+' : ''}${esc(board.velocity)} posts vs last snapshot</p>`;
  return `<div class="tag-tracker">`
    + `<h2>#${esc(board.tag)} <span class="tt-net">${esc(board.label)}</span></h2>`
    + `<p class="tt-headline">${esc(headline(board))}</p>`
    + `<p class="tt-mut">${esc(board.postCount)} posts · ${esc(board.uniqueAuthors)} unique authors · ${esc(board.totalPayout)} total payout</p>`
    + vel
    + `<h3>Top posts</h3>${top}`
    + `</div>`;
}

export function renderLeaderboard(lb) {
  if (!lb || !Array.isArray(lb.tags)) return `<div class="tag-tracker"><p>No tag data.</p></div>`;
  const rows = lb.tags.map((t, i) =>
    `<li>#${i + 1} <a href="?tag=${esc(t.tag)}">#${esc(t.tag)}</a> — ${esc(t.postCount)} posts · ${esc(t.totalPayout)} payout · ${esc(t.uniqueAuthors)} authors</li>`).join('');
  return `<div class="tag-tracker"><h2>Trending tags <span class="tt-net">${esc(lb.label)}</span></h2>`
    + `<p class="tt-mut">The subreddits of MELEK — ranked by payout then activity.</p>`
    + `<ol class="tt-lb">${rows}</ol></div>`;
}

const PAGE_CSS = `.tag-tracker{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:0 auto;padding:16px;color:#e8e8ea}
.tag-tracker h2{font-size:1.3rem;margin:0 0 4px}.tt-net{font-size:.7rem;opacity:.6;font-weight:400}
.tt-headline{font-size:1rem;opacity:.9;margin:.2rem 0}.tt-mut{opacity:.65;font-size:.85rem;margin:.2rem 0}
.tag-tracker h3{font-size:1rem;margin:1rem 0 .4rem;opacity:.85}
.tt-top,.tt-lb{padding-left:1.2rem;font-size:.9rem;line-height:1.7}a{color:#58a6ff}`;

/** GET /?tag=NAME → single-tag HTML (or leaderboard when no tag). /api → JSON. Read-only. */
export async function handler(req, res) {
  try {
    const u = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
    const tag = normTag(u.searchParams.get('tag') || '');
    const wantsJson = u.pathname.endsWith('/api') || String(req.headers?.accept || '').includes('application/json');
    const data = tag ? await tagBoard({ tag }) : await trendingTags({});
    if (wantsJson) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(data));
    }
    const body = tag ? renderBoard(data) : renderLeaderboard(data);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">`
      + `<title>MELEK Tag Tracker${tag ? ' — #' + esc(tag) : ''}</title><style>body{background:#0b0b0d}${PAGE_CSS}</style></head><body>${body}</body></html>`);
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('tag-tracker error');
  }
}

if (process.argv[1] && process.argv[1].endsWith('tag-tracker.mjs')) {
  const tag = process.argv[2];
  if (tag) { const b = await tagBoard({ tag }); console.log(headline(b)); }
  else { const lb = await trendingTags({}); console.log('TRENDING TAGS —', lb.label); lb.tags.forEach((t, i) => console.log(`  ${i + 1}. #${t.tag.padEnd(18)} ${t.postCount} posts · ${t.totalPayout} payout`)); }
  if (!configured()) console.log('(MELEK_RPC_URL unset — live reads soft-fail.)');
}
