// integrations/herald/backlink-network.mjs — Herald CURATED BACKLINK NETWORK engine (pure, tested).
//
// The differentiator behind the Herald Web Builder: customers who publish a site can opt their site into
// a curated cross-link network so relevant member sites surface a small, tasteful "Related sites" block
// pointing at each other. Done naively ("everyone links to everyone") this is a LINK FARM / PBN and gets
// Google-penalized. So this engine is built to be the OPPOSITE of a link farm — a curated, relevant,
// disclosed, rate-limited directory-style network. The anti-penalty rules are load-bearing:
//
//   1. CATEGORY / RELEVANCE MATCH — a link only surfaces between sites in the same (or an adjacent)
//      category. Irrelevant cross-category links never surface. (relevance())
//   2. PER-SITE CAP — at most MAX_LINKS_PER_SITE network links surface on any one site. (cap in linksFor)
//   3. NATURAL (not blanket) RECIPROCITY — reciprocal A<->B links are capped to a fraction of a site's
//      links (RECIPROCITY_MAX_RATIO); the network is not a wall of mutual back-scratching. (recipUsed)
//   4. QUALITY GATE — a member must pass a quality bar (opted-in, live, real https URL, valid category,
//      not flagged, score >= QUALITY_MIN) to participate or receive links. (passesGate / siteQuality)
//   5. RATE LIMITS — a site introduces at most RATE_MAX_NEW new links per RATE_WINDOW_MS; links trickle
//      in, they don't land in a burst. (newBudget in linksFor)
//   6. APPROPRIATE rel — only same-category, high-quality, non-reciprocal links (up to a follow ratio)
//      are editorial "follow"; everything else carries rel="nofollow". (linkObj)
//
// networkHealth() audits an arbitrary placement graph and FLAGS link-farm patterns (over-reciprocity,
// irrelevance, caps exceeded, rate bursts, low-quality members) so the network self-polices.
//
// PURE / deterministic: no Math.random, no bare Date.now in asserted logic (inject `now`), NO network,
// soft-fail-never-throw (bad input → {ok:false,error} / [] ), esc() all HTML interpolation. CLI guarded.
//
//   import { createBacklinkNetwork, CATEGORIES } from './backlink-network.mjs'
//   const net = createBacklinkNetwork({ now: () => clock });
//   net.register({ id:'a', name:'Acme', url:'https://acme.example', category:'business', optIn:true });
//   net.linksFor('a');            // the OTHER members' links to surface on site a
//   net.recordPlacement({ from:'a', to:'b', at });
//   net.networkHealth();          // audit → flags link-farm patterns
//   net.renderRelatedBlock('a');  // escaped "Related sites" HTML block

const DAY_MS = 86400000;

// ── tuning (exported so the site + tests share one source of truth) ────────────────────────────────
export const MAX_LINKS_PER_SITE = 5;      // per-site cap — most network links that surface on one site
export const RECIPROCITY_MAX_RATIO = 0.5; // at most this fraction of a site's links may be reciprocal
export const QUALITY_MIN = 40;            // a member must score >= this (0-100) to participate
export const FOLLOW_QUALITY_MIN = 70;     // editorial "follow" needs at least this quality
export const FOLLOW_RATIO = 0.5;          // at most this fraction of a site's links are "follow"
export const RATE_WINDOW_MS = DAY_MS;     // rolling window for new-link introductions
export const RATE_MAX_NEW = 3;            // most NEW links a site introduces per window

// The category taxonomy. Relevance = same category OR an adjacent one in RELATED. Anything else is
// irrelevant and never surfaces (the #1 anti-penalty rule).
export const CATEGORIES = [
  'business', 'tech', 'finance', 'health', 'wellness', 'travel', 'food',
  'arts', 'education', 'nonprofit', 'legal', 'realestate', 'shop', 'personal', 'portfolio',
];
// Adjacency: categories that are close enough to be relevant to each other (curated, conservative).
const RELATED = {
  business: ['finance', 'tech', 'shop', 'legal'],
  tech: ['business', 'finance'],
  finance: ['business', 'tech', 'realestate', 'legal'],
  health: ['wellness'],
  wellness: ['health', 'food'],
  travel: ['food'],
  food: ['travel', 'wellness'],
  arts: ['portfolio', 'personal'],
  education: ['nonprofit'],
  nonprofit: ['education'],
  legal: ['business', 'finance'],
  realestate: ['finance', 'business'],
  shop: ['business'],
  personal: ['portfolio', 'arts'],
  portfolio: ['personal', 'arts'],
};

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// safeHref: only real http(s) URLs pass; javascript:/data:/junk → ''.
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u.trim()); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

const clampStr = (s, n) => String(s == null ? '' : s).slice(0, n);
const finite = (n) => Number.isFinite(Number(n)) ? Number(n) : null;

// ── relevance ──────────────────────────────────────────────────────────────────────────────────────
// 'same' | 'related' | 'none'. Unknown categories are never relevant (fail closed).
export function relevance(a, b) {
  const x = String(a || '').toLowerCase(), y = String(b || '').toLowerCase();
  if (!CATEGORIES.includes(x) || !CATEGORIES.includes(y)) return 'none';
  if (x === y) return 'same';
  if ((RELATED[x] || []).includes(y)) return 'related';
  return 'none';
}
const relevanceRank = (r) => (r === 'same' ? 0 : r === 'related' ? 1 : 2);

// ── quality ──────────────────────────────────────────────────────────────────────────────────────
// A 0-100 quality score. Explicit numeric `quality` wins (clamped); otherwise a signal blend. A flagged
// site is always 0 (fails the gate).
export function siteQuality(site = {}) {
  if (!site || typeof site !== 'object') return 0;
  if (site.flagged) return 0;
  const q = finite(site.quality);
  if (q != null) return Math.max(0, Math.min(100, q));
  let s = 0;
  const href = safeHref(site.url);
  if (href) s += href.startsWith('https:') ? 30 : 15;
  if (clampStr(site.name, 200).trim()) s += 15;
  if (site.live !== false) s += 15;
  if (CATEGORIES.includes(String(site.category || '').toLowerCase())) s += 20;
  if (site.optIn === true) s += 20;
  return Math.max(0, Math.min(100, s));
}

// Gate: opted-in, live, real https/http URL, valid category, not flagged, score >= QUALITY_MIN.
export function passesGate(site = {}) {
  if (!site || typeof site !== 'object') return false;
  if (site.flagged) return false;
  if (site.optIn !== true) return false;
  if (site.live === false) return false;
  if (!safeHref(site.url)) return false;
  if (!CATEGORIES.includes(String(site.category || '').toLowerCase())) return false;
  return siteQuality(site) >= QUALITY_MIN;
}

const pairKey = (a, b) => `${a} ${b}`;

// ── the network ────────────────────────────────────────────────────────────────────────────────────
export function createBacklinkNetwork(opts = {}) {
  const clock = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const nowMs = () => { const n = Number(clock()); return Number.isFinite(n) ? n : 0; };

  // storage seam: caller-owned mutable object (in-memory default; a daemon can pass a persisted one).
  const store = opts.storage && typeof opts.storage === 'object' ? opts.storage : {};
  if (!store.sites || typeof store.sites !== 'object') store.sites = {};
  if (!Array.isArray(store.placements)) store.placements = [];

  const MAX = Number.isFinite(opts.maxLinksPerSite) ? opts.maxLinksPerSite : MAX_LINKS_PER_SITE;

  // ── membership ───────────────────────────────────────────────────────────────────────────────────
  function register(info = {}) {
    const id = clampStr(info && info.id, 80).trim().toLowerCase();
    if (!id) return { ok: false, error: 'id required' };
    const url = safeHref(info && info.url);
    if (!url) return { ok: false, error: 'valid http(s) url required' };
    const category = String(info && info.category || '').toLowerCase();
    if (!CATEGORIES.includes(category)) return { ok: false, error: 'unknown category' };
    const site = {
      id,
      name: clampStr(info && info.name, 200) || id,
      url,
      category,
      ren: clampStr(info && info.ren, 120),
      domain: clampStr(info && info.domain, 253),
      optIn: info && info.optIn === true,
      live: !(info && info.live === false),
      flagged: !!(info && info.flagged),
      quality: finite(info && info.quality),
      addedAt: nowMs(),
    };
    store.sites[id] = site;             // upsert (re-register updates, e.g. flipping the opt-in toggle)
    return { ok: true, site };
  }
  function unregister(id) {
    const key = clampStr(id, 80).trim().toLowerCase();
    if (store.sites[key]) { delete store.sites[key]; return { ok: true }; }
    return { ok: false, error: 'unknown site' };
  }
  const site = (id) => store.sites[clampStr(id, 80).trim().toLowerCase()] || null;
  const sites = () => Object.values(store.sites);

  // Two sites are "the same owner" if they share id, a non-empty domain, or a non-empty ren — never
  // surface a site's own aliases as a "related site".
  function sameOwner(a, b) {
    if (!a || !b) return false;
    if (a.id === b.id) return true;
    if (a.domain && b.domain && a.domain === b.domain) return true;
    if (a.ren && b.ren && a.ren === b.ren) return true;
    return false;
  }

  const isReciprocal = (fromId, toId) => store.placements.some((p) => p.from === toId && p.to === fromId);
  const isPlaced = (fromId, toId) => store.placements.some((p) => p.from === fromId && p.to === toId);

  // ── linksFor — the curated allotment for ONE site (respects ALL anti-penalty rules) ───────────────
  function linksFor(id, o = {}) {
    const from = site(id);
    if (!from || !passesGate(from)) return [];      // soft-fail: unknown / gated-out → nothing
    const at = finite(o && o.at) != null ? finite(o.at) : nowMs();
    const cap = Math.max(0, Math.min(MAX, finite(o && o.max) != null ? finite(o.max) : MAX));
    if (cap === 0) return [];

    // candidate pool: other members, relevant category, pass the gate, not the same owner.
    const pool = sites()
      .filter((c) => c.id !== from.id && !sameOwner(from, c) && passesGate(c) && relevance(from.category, c.category) !== 'none')
      .map((c) => ({ c, rel: relevance(from.category, c.category), q: siteQuality(c) }))
      .sort((a, b) =>
        (relevanceRank(a.rel) - relevanceRank(b.rel))   // same-category first
        || (b.q - a.q)                                  // then higher quality
        || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0)); // then stable by id

    // reciprocity sub-cap: at most floor(cap * ratio) of the surfaced links may be reciprocal.
    const recipAllowed = Math.floor(cap * RECIPROCITY_MAX_RATIO);
    // rate budget: how many NEW links this site may introduce in the current window.
    const recentNew = store.placements.filter((p) => p.from === from.id && p.at > at - RATE_WINDOW_MS && p.at <= at).length;
    let newBudget = Math.max(0, RATE_MAX_NEW - recentNew);
    // follow cap: at most floor(cap * FOLLOW_RATIO) editorial-follow links.
    const followAllowed = Math.floor(cap * FOLLOW_RATIO);

    let recipUsed = 0, followUsed = 0;
    const out = [];
    for (const cand of pool) {
      if (out.length >= cap) break;
      const recip = isReciprocal(from.id, cand.c.id);
      if (recip && recipUsed >= recipAllowed) continue;   // natural, not blanket, reciprocity
      const placed = isPlaced(from.id, cand.c.id);
      if (!placed) {                                       // rate-limit NEW introductions
        if (newBudget <= 0) continue;
        newBudget--;
      }
      // appropriate rel: editorial follow only for same-category, high-quality, non-reciprocal links,
      // and only up to the follow ratio; everything else is nofollow.
      const followEligible = cand.rel === 'same' && cand.q >= FOLLOW_QUALITY_MIN && !recip && followUsed < followAllowed;
      if (followEligible) followUsed++;
      if (recip) recipUsed++;
      out.push({
        id: cand.c.id,
        name: cand.c.name,
        url: cand.c.url,
        category: cand.c.category,
        relevance: cand.rel,
        reciprocal: recip,
        rel: followEligible ? '' : 'nofollow',
        disclosed: true,
      });
    }
    return out;
  }

  // ── placement log (records that from actually surfaced a link to `to`) ────────────────────────────
  function recordPlacement(info = {}) {
    const from = clampStr(info && info.from, 80).trim().toLowerCase();
    const to = clampStr(info && info.to, 80).trim().toLowerCase();
    if (!from || !to) return { ok: false, error: 'from and to required' };
    if (from === to) return { ok: false, error: 'no self-pairing' };
    if (!site(from) || !site(to)) return { ok: false, error: 'unknown member' };
    if (store.placements.some((p) => pairKey(p.from, p.to) === pairKey(from, to))) {
      return { ok: false, error: 'duplicate placement' };
    }
    const at = finite(info && info.at) != null ? finite(info.at) : nowMs();
    const placement = { from, to, at };
    store.placements.push(placement);
    return { ok: true, placement };
  }

  // ── networkHealth — audit the placement graph for link-farm patterns ──────────────────────────────
  function networkHealth() {
    const placements = store.placements.slice();
    const flags = [];
    const total = placements.length;

    // caps exceeded: any site with more than MAX outbound links.
    const outBy = {};
    for (const p of placements) outBy[p.from] = (outBy[p.from] || 0) + 1;
    const capOffenders = Object.entries(outBy).filter(([, n]) => n > MAX).map(([id, n]) => ({ id, count: n }));
    if (capOffenders.length) flags.push({ type: 'cap', detail: `${capOffenders.length} site(s) exceed the ${MAX}-link cap`, sites: capOffenders });

    // irrelevance: any placement crossing into a non-relevant category (or involving an unknown member).
    const irrelevant = placements.filter((p) => {
      const a = site(p.from), b = site(p.to);
      if (!a || !b) return true;
      return relevance(a.category, b.category) === 'none';
    });
    if (irrelevant.length) flags.push({ type: 'irrelevance', detail: `${irrelevant.length} link(s) are cross-category / irrelevant`, sites: irrelevant.map((p) => `${p.from}->${p.to}`) });

    // over-reciprocity: fraction of links that have a matching back-link.
    let recipCount = 0;
    for (const p of placements) if (placements.some((q) => q.from === p.to && q.to === p.from)) recipCount++;
    const recipRatio = total ? recipCount / total : 0;
    if (recipRatio > RECIPROCITY_MAX_RATIO) flags.push({ type: 'reciprocity', detail: `reciprocity ratio ${recipRatio.toFixed(2)} exceeds ${RECIPROCITY_MAX_RATIO}`, ratio: recipRatio });

    // rate bursts: any site that introduced more than RATE_MAX_NEW links inside one window.
    const rateOffenders = [];
    for (const id of new Set(placements.map((p) => p.from))) {
      const ats = placements.filter((p) => p.from === id).map((p) => p.at).sort((a, b) => a - b);
      let worst = 0;
      for (let i = 0; i < ats.length; i++) {
        let j = i, c = 0;
        while (j < ats.length && ats[j] - ats[i] < RATE_WINDOW_MS) { c++; j++; }
        if (c > worst) worst = c;
      }
      if (worst > RATE_MAX_NEW) rateOffenders.push({ id, burst: worst });
    }
    if (rateOffenders.length) flags.push({ type: 'rate', detail: `${rateOffenders.length} site(s) burst past ${RATE_MAX_NEW}/window`, sites: rateOffenders });

    // low-quality members in the graph (flagged / below the gate but still placing links).
    const badMembers = [];
    for (const id of new Set(placements.flatMap((p) => [p.from, p.to]))) {
      const s = site(id);
      if (!s || !passesGate(s)) badMembers.push(id);
    }
    if (badMembers.length) flags.push({ type: 'quality', detail: `${badMembers.length} member(s) fail the quality gate`, sites: badMembers });

    const score = Math.max(0, 100 - flags.length * 20 - Math.round(recipRatio * 20));
    return {
      ok: flags.length === 0,
      score,
      flags,
      stats: { members: sites().length, placements: total, reciprocity: +recipRatio.toFixed(3) },
    };
  }

  // ── render — the tasteful, DISCLOSED "Related sites" block the builder embeds ──────────────────────
  function renderRelatedBlock(id, o = {}) {
    const links = linksFor(id, o);
    if (!links.length) return '';
    const items = links.map((l) => {
      const href = safeHref(l.url);
      if (!href) return '';
      const rel = ['noopener', l.rel].filter(Boolean).join(' ');
      return `<li><a href="${esc(href)}" rel="${esc(rel)}" target="_blank">${esc(l.name)}</a>`
        + ` <span class="bl-cat">${esc(l.category)}</span></li>`;
    }).filter(Boolean).join('');
    if (!items) return '';
    return `<aside class="backlink-network" aria-label="Related sites">`
      + `<h2>Related sites</h2><ul class="bl-list">${items}</ul>`
      + `<p class="bl-disclosure">A curated network of related sites. Links are relevance-matched and disclosed.</p>`
      + `</aside>`;
  }

  // ── directory feed — for the aggregator-directory / search.soapbox seam (discoverability) ──────────
  function toDirectory() {
    return sites()
      .filter((s) => passesGate(s))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((s) => ({ id: s.id, name: s.name, url: s.url, category: s.category, ren: s.ren || null, domain: s.domain || null }));
  }

  return {
    register, unregister, site, sites, sameOwner,
    linksFor, recordPlacement, networkHealth, renderRelatedBlock, toDirectory,
    config: { MAX_LINKS_PER_SITE: MAX, RECIPROCITY_MAX_RATIO, QUALITY_MIN, FOLLOW_QUALITY_MIN, RATE_WINDOW_MS, RATE_MAX_NEW },
  };
}

// ── CLI (guarded) — a tiny demo + audit of a sample network ────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('backlink-network.mjs')) {
  const net = createBacklinkNetwork({ now: () => 1_700_000_000_000 });
  const demo = [
    ['acme', 'Acme Consulting', 'business', 'https://acme.example'],
    ['ledger', 'Ledger CPA', 'finance', 'https://ledger.example'],
    ['forge', 'Forge Dev Shop', 'tech', 'https://forge.example'],
    ['bloom', 'Bloom Wellness', 'wellness', 'https://bloom.example'],
    ['trailmix', 'Trailmix Travel', 'travel', 'https://trailmix.example'],
  ];
  for (const [id, name, category, url] of demo) net.register({ id, name, category, url, optIn: true, quality: 80 });
  console.log('linksFor(acme):');
  for (const l of net.linksFor('acme')) console.log(`  → ${l.name} [${l.category}] rel="${l.rel || 'follow'}"${l.reciprocal ? ' (reciprocal)' : ''}`);
  console.log('\nnetworkHealth:', JSON.stringify(net.networkHealth(), null, 2));
}
