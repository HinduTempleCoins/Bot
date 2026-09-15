// interlink.mjs — THE CROSS-LINKS BETWEEN THE FORUM, THE WIKI AND THE APPS.
//
// The network had a wiki with 154 pages, a forum with 58 boards, and 34 apps — and nothing joined
// them. The forum mentioned the wiki once, in prose, inside a seeded post. The wiki linked to the
// forum zero times. Board names like `/b/library` and `/b/crypto/melek` were labels, not links.
//
// A reader who finishes a wiki article has nowhere to go and no one to ask; a reader on a quiet board
// has no reason to believe there is anything behind it. Each surface makes the other worth visiting,
// and only if they actually point at each other.
//
// ⭐ MAPPING IS BY WIKI CATEGORY, NOT BY ARTICLE. Articles are added and renamed constantly — a
// per-article map would rot within a week and start emitting dead links, which is worse than none.
// Categories are a stable, small, editorial set. A handful of ARTICLE-level links are allowed on top
// where the pairing is too good to lose, and those are the only entries that need checking.
//
// Pure data + pure functions. No network, no I/O. Both sides render from the same map, so a link can
// never point one way only.

const WIKI = (process.env.WIKI_SITE || 'https://wiki.soapbox.community').replace(/\/$/, '');
const FORUM = (process.env.FORUM_SITE || 'https://forum.soapbox.community').replace(/\/$/, '');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * board id → what else in the network is about the same thing.
 *   wikiCategories — stable category ids on the wiki
 *   wikiArticles   — a few exact slugs where the pairing is worth the maintenance
 *   apps           — live surfaces, each a real host that answers 200
 */
export const BOARD_LINKS = Object.freeze({
  library: {
    wikiCategories: ['substances', 'plants', 'entrainment', 'religion'],
    wikiArticles: ['Cannabis_Harm_Reduction', 'Cannabinoid_Oilahuasca', 'Crypto_Glossary'],
    apps: [
      { name: 'The Temple Plate', url: 'https://plate.soapbox.community', why: 'food sorted by what it interacts with, plus a deficiency screener' },
      { name: 'Library of Ashurbanipal', url: WIKI, why: 'the reference wiki itself' },
    ],
  },
  witness: {
    wikiCategories: ['chains'],
    wikiArticles: ['Blockchain_Witness_Block_Producer_', 'Curation_Trails_and_Auto-Voting'],
    apps: [{ name: 'Witness School', url: 'https://witness.melek.salon', why: 'how to run a witness, and live status for Hathor' }],
  },
  development: {
    wikiCategories: ['chains'],
    wikiArticles: ['Building_a_Front_End_for_a_Graphene_Chain', 'APIS_and_Token_Creation'],
    apps: [{ name: 'Tokens', url: 'https://tokens.alpha.melek.salon', why: 'the token surfaces' }],
  },
  economy: {
    wikiCategories: ['chains', 'verticals'],
    wikiArticles: ['CURE_Token', 'Crypto_Glossary'],
    apps: [
      { name: 'Benefits Navigator', url: 'https://benefits.soapbox.community', why: '121 programmes, each labelled with what the money actually IS' },
      { name: 'Business Credit', url: 'https://business.soapbox.community', why: 'the eight real steps, and the fraud named by category' },
      { name: 'Credit Basics', url: 'https://credit.soapbox.community', why: 'how a score works, free tools only' },
    ],
  },
  marketplace: {
    wikiCategories: ['verticals'],
    wikiArticles: [],
    apps: [
      { name: 'Grants', url: 'https://grants.soapbox.community', why: 'where the money is, by field' },
      { name: 'Credentials', url: 'https://credentials.soapbox.community', why: '123 credentials, free ones marked' },
      { name: 'Jobs', url: 'https://jobs.soapbox.community', why: 'work, and the skill that gets it' },
    ],
  },
  general: {
    wikiCategories: ['start', 'people', 'other'],
    wikiArticles: ['Autodidacts_and_Credentials'],
    apps: [
      { name: 'Tools', url: 'https://tools.soapbox.community', why: 'free everyday utilities, no sign-up' },
      { name: 'TV Remote', url: 'https://remote.soapbox.community', why: 'turn a Roku on with no remote' },
    ],
  },
  announcements: {
    wikiCategories: ['start', 'chains'],
    wikiArticles: [],
    apps: [{ name: 'Portfolio', url: 'https://portfolio.soapbox.community', why: 'everything built, every row probed' }],
  },
  meta: { wikiCategories: ['start'], wikiArticles: [], apps: [] },
  'crypto/melek': {
    wikiCategories: ['chains'],
    wikiArticles: ['Akasha_Wallet', 'BLURT_Blockchain', 'BitShares'],
    apps: [{ name: 'MELEK', url: 'https://melek.salon', why: 'the chain front-end' }],
  },
  'crypto/prana': { wikiCategories: ['chains'], wikiArticles: [], apps: [{ name: 'PRANA Games', url: 'https://games.soapbox.community', why: 'what PRANA is for' }] },
  'crypto/mining': { wikiCategories: ['chains'], wikiArticles: [], apps: [{ name: 'Mining pool', url: 'https://pool.soapbox.community', why: 'browser mining + in-browser wallet' }] },
});

/** wiki category id → the boards that discuss it. Derived, so the two directions cannot disagree. */
export function boardsForCategory(categoryId) {
  const c = String(categoryId || '');
  if (!c) return [];
  return Object.entries(BOARD_LINKS)
    .filter(([, v]) => (v.wikiCategories || []).includes(c))
    .map(([id]) => id)
    .sort();
}

/** wiki article slug → the boards that name it explicitly. */
export function boardsForArticle(slug) {
  const s = String(slug || '');
  if (!s) return [];
  return Object.entries(BOARD_LINKS)
    .filter(([, v]) => (v.wikiArticles || []).includes(s))
    .map(([id]) => id)
    .sort();
}

/** Everything a board should point at. Unknown board → empty, never a broken render. */
export function relatedForBoard(boardId) {
  const v = BOARD_LINKS[String(boardId || '')];
  if (!v) return { categories: [], articles: [], apps: [] };
  return {
    categories: [...(v.wikiCategories || [])],
    articles: [...(v.wikiArticles || [])],
    apps: [...(v.apps || [])],
  };
}

export const wikiCategoryUrl = (id) => `${WIKI}/category/${encodeURIComponent(String(id || ''))}`;
export const wikiArticleUrl = (slug) => `${WIKI}/wiki/${encodeURIComponent(String(slug || ''))}`;
export const boardUrl = (id) => `${FORUM}/b/${String(id || '').split('/').map(encodeURIComponent).join('/')}`;
export const articleTitle = (slug) => String(slug || '').replace(/_/g, ' ').replace(/\s+$/, '');
export const boardTitle = (id) => String(id || '').split('/').pop().replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

const SHARED_STYLE = `<style>
.xlink{border:1px solid rgba(128,128,128,.35);border-radius:12px;padding:14px 16px;margin:22px 0;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.xlink h3{font-size:12px;letter-spacing:.8px;text-transform:uppercase;opacity:.65;margin:0 0 10px;font-weight:700}
.xlink ul{list-style:none;margin:0 0 10px;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.xlink li{margin:0}
.xlink a{display:inline-block;padding:6px 11px;border:1px solid rgba(128,128,128,.4);border-radius:999px;text-decoration:none;color:inherit}
.xlink a:hover{border-color:currentColor}
.xlink p{margin:8px 0 0;opacity:.7;font-size:13px}
</style>`;

/** The block a FORUM board/thread renders: read the wiki, use the app. */
export function renderForumRelated(boardId) {
  const r = relatedForBoard(boardId);
  if (!r.categories.length && !r.articles.length && !r.apps.length) return '';
  const cats = r.categories.map((c) => `<li><a href="${esc(wikiCategoryUrl(c))}">📚 ${esc(boardTitle(c))}</a></li>`).join('');
  const arts = r.articles.map((a) => `<li><a href="${esc(wikiArticleUrl(a))}">📄 ${esc(articleTitle(a))}</a></li>`).join('');
  const apps = r.apps.map((a) => `<li><a href="${esc(a.url)}">🔧 ${esc(a.name)}</a></li>`).join('');
  return `${SHARED_STYLE}<aside class="xlink">
${cats || arts ? `<h3>Read up on this</h3><ul>${cats}${arts}</ul>` : ''}
${apps ? `<h3>Use it</h3><ul>${apps}</ul>` : ''}
<p>The wiki explains it, the forum argues about it, the apps do it.</p>
</aside>`;
}

/** The block a WIKI article/category renders: go argue about it. */
export function renderWikiRelated({ categoryId = '', articleSlug = '' } = {}) {
  const ids = [...new Set([...boardsForCategory(categoryId), ...boardsForArticle(articleSlug)])];
  if (!ids.length) return '';
  const items = ids.map((id) => `<li><a href="${esc(boardUrl(id))}">💬 ${esc(boardTitle(id))}</a></li>`).join('');
  return `${SHARED_STYLE}<aside class="xlink">
<h3>Discuss this on the forum</h3><ul>${items}</ul>
<p>Standing there is scarce, peer-awarded merit — it cannot be bought or self-minted.</p>
</aside>`;
}

/** Every link this map produces, for a dead-link check. */
export function allTargets() {
  const out = new Set();
  for (const [id, v] of Object.entries(BOARD_LINKS)) {
    out.add(boardUrl(id));
    for (const c of v.wikiCategories || []) out.add(wikiCategoryUrl(c));
    for (const a of v.wikiArticles || []) out.add(wikiArticleUrl(a));
    for (const a of v.apps || []) out.add(a.url);
  }
  return [...out].sort();
}
