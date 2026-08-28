// boards.mjs — the MEGA-FORUM board registry + prefix resolver (data-driven, pure, deterministic).
//
// WHY THIS EXISTS (.local/MEGA_FORUM_DESIGN.md §2.1 — "the one structural change"): the forum engine
// (forum-core.mjs) already owns threads / replies / scarce peer-merit. The single load-bearing extension
// that turns a fixed 8-board forum into a huge programmatic-SEO board network is to make BOARDS *config*
// and add a PREFIX RESOLVER so ids like `city/austin-tx`, `game/minecraft`, `travel/paris`, `biz/<slug>`
// resolve to a valid board on the fly — hundreds of thousands of boards, zero per-board code.
//
// This module is METADATA + ROUTING ONLY. It owns NO threads, NO merit, NO storage, NO network, NO keys.
// forum-core's thread/post/merit logic is untouched; forum-core simply consults an injected registry
// (isBoard / boardMeta / boards) built from here. Pure string/lookup functions, soft-fail-never-throw.
//
//   import { resolveBoard, listCategories, listBoards, boardSitemapEntries } from './boards.mjs'
//
//   resolveBoard('economy')        → { id:'economy', category:'MELEK / Ecosystem', kind:'discussion', … }
//   resolveBoard('city/austin-tx') → programmatic Local board (woven title/desc), or null for junk
//   resolveBoard('nope/foo')       → null
//
// seoType is the schema.org type the SITE renders for a THREAD on that board (a BreadcrumbList is always
// emitted alongside it): discussion/wiki-linkout → DiscussionForumPosting, qa → QAPage, review →
// LocalBusiness, classified → DiscussionForumPosting (Phase-2 seam; those boards stay noindex for now).

// ── kind → schema.org type (the SEO seam) ──────────────────────────────────────
const SEO_TYPE_BY_KIND = {
  discussion: 'DiscussionForumPosting',
  'wiki-linkout': 'DiscussionForumPosting',
  qa: 'QAPage',
  review: 'LocalBusiness',       // Phase 2 — see REVIEW/CLASSIFIED seam below
  classified: 'DiscussionForumPosting', // Phase 2 — geo listings; boards noindex until built
};
export function seoTypeForKind(kind) {
  return SEO_TYPE_BY_KIND[String(kind || '').toLowerCase()] || 'DiscussionForumPosting';
}

// ── the ten categories (design §1) ─────────────────────────────────────────────
// Each: { id, name, comparable, desc }. `name` is the human label shown as a group header + breadcrumb.
export const CATEGORIES = [
  { id: 'melek',       name: 'MELEK / Ecosystem', comparable: '', desc: 'The MELEK chain, its economy, witnesses, and the forum itself.' },
  { id: 'crypto',      name: 'Crypto',            comparable: 'Bitcointalk / Altcoinstalks', desc: 'Coin culture, DeFi, mining, trading, and project announcements.' },
  { id: 'local',       name: 'Local / City-Data', comparable: 'City-Data', desc: 'Per-city boards, neighborhoods, local events, and genealogy.' },
  { id: 'gaming',      name: 'Gaming',            comparable: 'GameFAQs + wikis', desc: 'Per-game help, walkthrough link-outs, deals, and hardware.' },
  { id: 'travel',      name: 'Travel',            comparable: 'TripAdvisor', desc: 'Per-destination travel Q&A, tips, and trip planning.' },
  { id: 'reviews',     name: 'Reviews',           comparable: 'Yelp / YellowPages', desc: 'Local-business & place reviews with facts and ratings. (Phase 2)' },
  { id: 'classifieds', name: 'Classifieds',       comparable: 'Craigslist', desc: 'For-sale, housing, jobs, services, gigs, community. (Phase 2)' },
  { id: 'history',     name: 'History',           comparable: 'Historum', desc: 'Serious, sourced history discussion across periods and themes.' },
  { id: 'mind',        name: 'Mind / Medicine',   comparable: '', desc: 'Witchy, herb, and nootropics — reference & harm-reduction discipline, fed by the Library of Ashurbanipal.' },
  { id: 'style',       name: 'Style',             comparable: '', desc: 'Fashion and beauty — community and the Van Kush Beauty economy.' },
];

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
export function categoryName(id) { const c = CATEGORY_BY_ID.get(id); return c ? c.name : id; }
export function resolveCategory(id) { return CATEGORY_BY_ID.get(String(id || '')) || null; }
export function listCategories() { return CATEGORIES.map((c) => ({ ...c })); }

// ── static boards (hand-registered; finite, culturally-native) ─────────────────
// { id, title, categoryId, kind, desc, links[], comparable? }. `links` are {label, href} (relative or
// absolute); the site safeHref()s them at render time. Wiki-linkout/harm-reduction boards point at the
// Library of Ashurbanipal — reference posture, NOT manufacture manuals (CLAUDE.md moderation policy).
const WIKI = 'https://wiki.soapbox.community';
const GAMBLING = 'https://gambling.soapbox.community';   // the Gambling Education Center (odds/EV/help)
const STATIC_BOARDS = [
  // MELEK / Ecosystem — the existing forum-core boards, preserved verbatim (titles are load-bearing for tests).
  { id: 'announcements', title: 'Announcements',           categoryId: 'melek', kind: 'discussion', desc: 'Official MELEK news, releases, and witness notices.' },
  { id: 'general',       title: 'General Discussion',      categoryId: 'melek', kind: 'discussion', desc: 'Anything MELEK — introductions, questions, and open talk.' },
  { id: 'economy',       title: 'Economy & Tokens',        categoryId: 'melek', kind: 'discussion', desc: 'MELEK, MBD, side-tokens, curation rewards, and the FORUM merit economy.' },
  { id: 'witness',       title: 'Witnesses & Governance',  categoryId: 'melek', kind: 'discussion', desc: 'Block production, voting, and running a node.' },
  { id: 'development',   title: 'Development',              categoryId: 'melek', kind: 'discussion', desc: 'Building on the chain — apps, APIs, the condenser, and tooling.' },
  { id: 'marketplace',   title: 'Marketplace & Services',  categoryId: 'melek', kind: 'discussion', desc: 'Offer or find services, goods, and bounties.' },
  { id: 'library',       title: 'Library of Ashurbanipal', categoryId: 'melek', kind: 'wiki-linkout', desc: 'Plant-medicine & harm-reduction reference — history, ethnobotany, safety. Education only; no synthesis/extraction recipes.', links: [{ label: 'Library of Ashurbanipal', href: WIKI }] },
  { id: 'meta',          title: 'Forum Feedback',          categoryId: 'melek', kind: 'discussion', desc: 'Bugs, ideas, and moderation for the forum itself.' },

  // Crypto — Bitcointalk / Altcoinstalks sub-boards (finite, native).
  { id: 'crypto/bitcoin',       title: 'Bitcoin',              categoryId: 'crypto', kind: 'discussion', desc: 'Bitcoin — protocol, culture, custody, and news.' },
  { id: 'crypto/altcoins',      title: 'Altcoins',             categoryId: 'crypto', kind: 'discussion', desc: 'Altcoin projects, tech, and discussion.' },
  { id: 'crypto/defi',          title: 'DeFi',                 categoryId: 'crypto', kind: 'discussion', desc: 'Decentralised finance — DEXs, lending, farming, and CDPs.' },
  { id: 'crypto/mining',        title: 'Mining',               categoryId: 'crypto', kind: 'discussion', desc: 'Proof-of-work mining, pools, hardware, and payouts.' },
  { id: 'crypto/trading',       title: 'Trading',              categoryId: 'crypto', kind: 'discussion', desc: 'Markets, strategy, and trading tools.' },
  { id: 'crypto/melek',         title: 'MELEK',                categoryId: 'crypto', kind: 'discussion', desc: 'The MELEK chain and token.' },
  { id: 'crypto/prana',         title: 'PRANA',                categoryId: 'crypto', kind: 'discussion', desc: 'The PRANA compute-DeFi chain and KULA.' },
  { id: 'crypto/tokens',        title: 'Tokens',               categoryId: 'crypto', kind: 'discussion', desc: 'Side-tokens, SCOT, and the token economy.' },
  { id: 'crypto/announcements', title: 'Announcements (ANN)',  categoryId: 'crypto', kind: 'discussion', desc: 'Project announcement threads, tied to a real on-chain token registry (not vaporware).' },
  { id: 'crypto/services',      title: 'Services & Marketplace', categoryId: 'crypto', kind: 'discussion', desc: 'Escrow, jobs, and campaigns — reframed as real-utility token work.' },

  // Local / City-Data — programmatic city/<slug> below; these are the cross-city static boards.
  { id: 'neighborhoods', title: 'Neighborhoods', categoryId: 'local', kind: 'discussion', desc: 'Hyper-local — HOAs, crime, schools, and "is X a good area".' },
  { id: 'genealogy',     title: 'Genealogy',     categoryId: 'local', kind: 'discussion', desc: 'Surname boards, ancestor lookups, and regional genealogy help.' },
  { id: 'local-events',  title: 'Local Events',  categoryId: 'local', kind: 'discussion', desc: 'Current events and local news for a place.' },

  // Gaming — programmatic game/<slug> below; these are the cross-game static boards.
  { id: 'gaming/general',  title: 'Gaming — General', categoryId: 'gaming', kind: 'discussion', desc: 'Cross-game chat and community.' },
  { id: 'gaming/deals',    title: 'Game Deals',       categoryId: 'gaming', kind: 'discussion', desc: 'Sales, bundles, and free games.' },
  { id: 'gaming/hardware', title: 'Gaming Hardware',  categoryId: 'gaming', kind: 'discussion', desc: 'PCs, consoles, peripherals, and builds.' },

  // Travel — programmatic travel/<dest> below (qa); these are the cross-destination static boards.
  { id: 'travel/general', title: 'Travel — General', categoryId: 'travel', kind: 'discussion', desc: 'Cross-destination travel talk, gear, and points/miles.' },
  { id: 'travel/tips',    title: 'Travel Tips',       categoryId: 'travel', kind: 'discussion', desc: 'Practical travel advice and how-tos.' },

  // Reviews — kind:'review' SEAM (Phase 2). Registered so the category exists; programmatic biz/<slug> below.
  // TODO(Phase 2): review capture UI + AggregateRating + LocalBusiness pages over local-business-intel.mjs.
  { id: 'reviews', title: 'Reviews', categoryId: 'reviews', kind: 'review', desc: 'Local-business & place reviews — facts + user ratings + owner right-of-reply. Coming in Phase 2.' },

  // Classifieds — kind:'classified' SEAM (Phase 2). Craigslist top-levels registered; geo/lifecycle later.
  // TODO(Phase 2): listing lifecycle (active→expired), geo scoping, identity-DM contact, anti-spam.
  { id: 'classifieds/for-sale',  title: 'For Sale',  categoryId: 'classifieds', kind: 'classified', desc: 'Items for sale. Coming in Phase 2.' },
  { id: 'classifieds/housing',   title: 'Housing',   categoryId: 'classifieds', kind: 'classified', desc: 'Rentals, sublets, and rooms. Coming in Phase 2.' },
  { id: 'classifieds/jobs',      title: 'Jobs',      categoryId: 'classifieds', kind: 'classified', desc: 'Job postings. Coming in Phase 2.' },
  { id: 'classifieds/services',  title: 'Services',  categoryId: 'classifieds', kind: 'classified', desc: 'Services offered. Coming in Phase 2.' },
  { id: 'classifieds/gigs',      title: 'Gigs',      categoryId: 'classifieds', kind: 'classified', desc: 'Short-term gigs. Coming in Phase 2.' },
  { id: 'classifieds/community', title: 'Community', categoryId: 'classifieds', kind: 'classified', desc: 'Local community postings. Coming in Phase 2.' },

  // History — Historum replacement (sourced discussion).
  { id: 'history/ancient',   title: 'Ancient History',   categoryId: 'history', kind: 'discussion', desc: 'Antiquity — the ancient Near East, Egypt, Greece, Rome, and beyond.' },
  { id: 'history/medieval',  title: 'Medieval History',  categoryId: 'history', kind: 'discussion', desc: 'The medieval world across regions.' },
  { id: 'history/modern',    title: 'Modern History',    categoryId: 'history', kind: 'discussion', desc: 'Early-modern through contemporary history.' },
  { id: 'history/military',  title: 'Military History',  categoryId: 'history', kind: 'discussion', desc: 'Campaigns, strategy, and the history of war.' },
  { id: 'history/regional',  title: 'Regional History',  categoryId: 'history', kind: 'discussion', desc: 'Histories tied to a place or people.' },
  { id: 'history/mysteries', title: 'Speculative History', categoryId: 'history', kind: 'discussion', desc: 'Ancient-mystery and esoteric-history discussion, treated as scholarship.' },

  // Mind / Medicine — Ashurbanipal-fed, harm-reduction discipline (reference, never manufacture manuals).
  { id: 'witchy',     title: 'Witchy',     categoryId: 'mind', kind: 'discussion', desc: 'Folk practice, herbalism-as-tradition, ritual, and diaspora brujería.', links: [{ label: 'Library of Ashurbanipal', href: WIKI }] },
  { id: 'herb',       title: 'Herb',       categoryId: 'mind', kind: 'discussion', desc: 'Ethnobotany, plant medicine, and harm reduction — history, dose ranges, interactions, testing, set/setting/aftercare. Reference only; no synthesis or extraction recipes.', links: [{ label: 'Library of Ashurbanipal', href: WIKI }] },
  { id: 'nootropics', title: 'Nootropics', categoryId: 'mind', kind: 'discussion', desc: 'Cognitive enhancement, stacks, and sourcing safety — reference only. No brain-stimulation self-application recipes.', links: [{ label: 'Library of Ashurbanipal', href: WIKI }] },
  { id: 'gambling-education', title: 'Gambling Education & Odds', categoryId: 'mind', kind: 'discussion', desc: 'The math of gambling — odds, expected value, the house edge, and the lottery reality. Education and harm-reduction, never promotion; the Forum never takes a wager or runs a game. If gambling has become a problem, help is one click away.', links: [{ label: 'Odds & EV — Gambling Education Center', href: GAMBLING }, { label: 'House edge by game', href: `${GAMBLING}/games` }, { label: 'Lottery odds & the −EV reality', href: `${GAMBLING}/lottery` }, { label: 'Get help — responsible gambling', href: `${GAMBLING}/help` }] },

  // Style — Fashion / Beauty (Van Kush).
  { id: 'fashion', title: 'Fashion', categoryId: 'style', kind: 'discussion', desc: 'Outfits, thrift, sustainable fashion, and brand talk.' },
  { id: 'beauty',  title: 'Beauty',  categoryId: 'style', kind: 'discussion', desc: 'Skincare, cosmetics, routines — the Van Kush Beauty community.' },
];

const STATIC_BY_ID = new Map(STATIC_BOARDS.map((b) => [b.id, b]));

// ── programmatic prefix resolvers (design §2.1) ────────────────────────────────
// A valid programmatic board is `<prefix>/<slug>` where the prefix is known and the slug is slug-shaped.
// The generator weaves a non-thin title/desc from the slug (listing-seo.mjs discipline) so thousands of
// generated pages carry unique text. No per-board code — add a prefix here, get a whole board family.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // lowercase, digits, single dashes; no spaces/junk

function humanize(slug) {
  return String(slug || '').split('-').filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const PREFIXES = [
  {
    prefix: 'city', categoryId: 'local', kind: 'discussion',
    title: (s) => `${humanize(s)} — Local Board`,
    desc: (s) => `Local questions, "moving to ${humanize(s)}", neighborhoods, schools, traffic, and current events for ${humanize(s)}. Auto-linked to cost-of-living and local business reviews.`,
    links: (s) => [
      { label: 'Cost of living', href: `https://data.soapbox.community/cost-of-living/${s}` },
      { label: 'Local reviews', href: `/b/reviews` },
    ],
  },
  {
    prefix: 'game', categoryId: 'gaming', kind: 'wiki-linkout',
    title: (s) => `${humanize(s)} — Game Board`,
    desc: (s) => `Help, builds, and "how do I…" for ${humanize(s)}. Community discussion plus curated walkthrough link-outs — we never mirror copyrighted guides.`,
    links: (s) => [
      { label: `${humanize(s)} guides (GameFAQs)`, href: `https://gamefaqs.gamespot.com/search?game=${encodeURIComponent(s)}` },
    ],
  },
  {
    prefix: 'travel', categoryId: 'travel', kind: 'qa',
    title: (s) => `${humanize(s)} — Travel Q&A`,
    desc: (s) => `Destination Q&A for ${humanize(s)} — best time to visit, "3 days in ${humanize(s)}", safety, and getting around. Question → best answer.`,
    links: (s) => [
      { label: `${humanize(s)} travel`, href: `https://travel.soapbox.community/${s}` },
    ],
  },
  {
    // Reviews SEAM (Phase 2): a business page. Registered so biz/<slug> resolves + carries LocalBusiness
    // seoType, but the site renders a Phase-2 stub (noindex) for now — no review capture UI yet.
    prefix: 'biz', categoryId: 'reviews', kind: 'review',
    title: (s) => `${humanize(s)} — Business`,
    desc: (s) => `${humanize(s)} — facts, reviews, and rating. Coming in Phase 2.`,
    links: () => [],
  },
];

const PREFIX_BY_ID = new Map(PREFIXES.map((p) => [p.prefix, p]));

// Shape a static or programmatic board into the uniform meta the site + forum-core consume.
function shape(b, { programmatic = false } = {}) {
  const cat = CATEGORY_BY_ID.get(b.categoryId);
  return {
    id: b.id,
    board: b.id,
    title: b.title,
    desc: b.desc || '',
    kind: b.kind,
    seoType: seoTypeForKind(b.kind),
    categoryId: b.categoryId,
    category: cat ? cat.name : b.categoryId, // forum-core groups on `.category`; site shows the human name
    comparable: cat ? cat.comparable : '',
    links: Array.isArray(b.links) ? b.links.filter((l) => l && l.href) : [],
    programmatic,
  };
}

/**
 * Resolve a board id/path to its metadata, or null. Deterministic + pure. Accepts a registered static id
 * (e.g. 'economy', 'crypto/bitcoin') OR a programmatic `<prefix>/<slug>` (e.g. 'city/austin-tx'). Junk,
 * empty slugs, unknown prefixes, and over-deep paths all return null. Never throws.
 */
export function resolveBoard(path) {
  if (typeof path !== 'string') return null;
  const id = path.trim().replace(/^\/+|\/+$/g, '');
  if (!id) return null;

  const stat = STATIC_BY_ID.get(id);
  if (stat) return shape(stat);

  // programmatic: exactly `<prefix>/<slug>` (Phase 1 — a single slug segment).
  const slash = id.indexOf('/');
  if (slash <= 0) return null;
  const prefix = id.slice(0, slash);
  const slug = id.slice(slash + 1);
  const gen = PREFIX_BY_ID.get(prefix);
  if (!gen) return null;
  if (!SLUG_RE.test(slug)) return null; // rejects empty, spaces, deeper paths (has a '/'), uppercase, junk

  return shape({
    id,
    title: gen.title(slug),
    desc: gen.desc(slug),
    categoryId: gen.categoryId,
    kind: gen.kind,
    links: typeof gen.links === 'function' ? gen.links(slug) : [],
  }, { programmatic: true });
}

/** Is this id a resolvable board (static or programmatic)? */
export function isBoard(id) { return resolveBoard(id) != null; }

/** Board metadata (alias of resolveBoard) — the name forum-core's registry uses. */
export function boardMeta(id) { return resolveBoard(id); }

/** All STATIC boards as uniform metas (programmatic boards are infinite and not listed here). */
export function listBoards() { return STATIC_BOARDS.map((b) => shape(b)); }

/** Static boards grouped by category, in CATEGORIES order — for forum-core's `boards()` + the home page. */
export function boardsByCategory() {
  return CATEGORIES.map((c) => ({
    category: c.name,
    categoryId: c.id,
    comparable: c.comparable,
    boards: STATIC_BOARDS.filter((b) => b.categoryId === c.id).map((b) => shape(b)),
  })).filter((g) => g.boards.length);
}

/** Static boards in one category (by id). [] for unknown. */
export function boardsInCategory(categoryId) {
  return STATIC_BOARDS.filter((b) => b.categoryId === String(categoryId || '')).map((b) => shape(b));
}

// ── flagship demo boards (proven end-to-end by the site seed) ──────────────────
// One static crypto board + two programmatic boards, so the resolver is exercised in production content.
export const FLAGSHIP_BOARDS = ['crypto/bitcoin', 'city/austin-tx', 'game/minecraft'];

/**
 * Sitemap entries for the board network: every static board (`/b/<id>`), every category (`/c/<id>`), plus
 * any `extra` programmatic board paths (e.g. seeded city/game boards). Deterministic. `extra` entries are
 * validated through resolveBoard, so junk can never enter the sitemap. Each entry:
 *   { path, kind, seoType, changefreq, priority }
 */
export function boardSitemapEntries(opts) {
  const extra = opts && Array.isArray(opts.extra) ? opts.extra : [];
  const out = [];
  for (const c of CATEGORIES) {
    out.push({ path: `/c/${c.id}`, kind: 'category', seoType: 'CollectionPage', changefreq: 'weekly', priority: '0.6' });
  }
  for (const b of STATIC_BOARDS) {
    const m = shape(b);
    out.push({ path: `/b/${b.id}`, kind: m.kind, seoType: m.seoType, changefreq: 'weekly', priority: '0.7' });
  }
  const seen = new Set(out.map((e) => e.path));
  for (const raw of extra) {
    const m = resolveBoard(raw);
    if (!m) continue;
    const path = `/b/${m.id}`;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, kind: m.kind, seoType: m.seoType, changefreq: 'daily', priority: '0.7' });
  }
  return out;
}

/** A registry object shaped for forum-core's `createForum({ registry })` injection. */
export function forumRegistry() {
  return {
    isBoard: (id) => isBoard(id),
    boardMeta: (id) => boardMeta(id),
    boards: () => boardsByCategory(),
  };
}

export default { resolveBoard, listCategories, listBoards, boardSitemapEntries, forumRegistry };

// ── CLI ── node integrations/forum/boards.mjs [path]
if (process.argv[1] && process.argv[1].endsWith('boards.mjs')) {
  const arg = process.argv[2];
  if (arg) {
    console.log(`resolveBoard(${JSON.stringify(arg)}):`);
    console.log(JSON.stringify(resolveBoard(arg), null, 2));
  } else {
    console.log(`${CATEGORIES.length} categories, ${STATIC_BOARDS.length} static boards, ${PREFIXES.length} prefix families.`);
    for (const g of boardsByCategory()) {
      console.log(`\n${g.category}  [${g.comparable || '—'}]`);
      for (const b of g.boards) console.log(`  ${b.id.padEnd(24)} ${b.kind.padEnd(13)} → ${b.seoType}`);
    }
    console.log('\nprefix families:', PREFIXES.map((p) => `${p.prefix}/<slug>`).join(', '));
    console.log('flagships:', FLAGSHIP_BOARDS.join(', '));
    for (const s of ['city/austin-tx', 'game/minecraft', 'travel/paris', 'biz/joes', 'city/', 'nope/foo']) {
      console.log(`  resolveBoard(${JSON.stringify(s)}) →`, resolveBoard(s) ? resolveBoard(s).title : 'null');
    }
  }
}
