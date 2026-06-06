// coin-link-finder.mjs — coin-link finder, PHASE 2. Phase 1 (coin-socials.mjs) takes the links a
// coin record already carries and renders them. This phase handles the coins whose pages come up
// EMPTY: it goes looking for a community presence on independent sources and produces CANDIDATE
// links — never published, never written into a coin record. Candidates carry a confidence score
// and the evidence that justified them, and land in a review queue (data/coin-link-candidates.json)
// for a human to confirm before anything is curated.
//
// Sources probed (all keyless, all soft-fail):
//   - Bitcointalk     — a deterministic announcement-thread SEARCH URL (no result fetch; the URL is
//                       itself the candidate "go look here" — Bitcointalk search is HTML, not an API).
//   - Reddit          — www.reddit.com/r/<name>/about.json : does a subreddit with this name exist?
//   - GitHub          — api.github.com/orgs/<slug>          : is there an org with this slug?
//
// DISCOVERY ONLY. We confirm existence and emit a candidate; we never assert it's official. The
// review queue is where a person promotes a candidate (then phase-1 curation / the adapter carries it).
//
//   import { findCandidates, enqueueCandidates, listCandidates } from './coin-link-finder.mjs'
//   const r = await findCandidates({ id:'foocoin', symbol:'FOO', name:'Foo Coin' })
//   await enqueueCandidates(r)                 // appends new candidates to the review queue
//   node integrations/soapbox/coin-link-finder.mjs foocoin FOO "Foo Coin"

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeFs from 'node:fs';
import { hasSocials, classify } from './coin-socials.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const STORE = process.env.SOAPBOX_COIN_LINK_CANDIDATES || path.join(__dir, 'data', 'coin-link-candidates.json');

// fetch is overridable for tests (mirrors condenser/market-factcheck __setFetch convention).
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// clock is overridable so candidate timestamps are deterministic under test.
let _now = () => new Date().toISOString();
export function __setClock(fn) { _now = fn || (() => new Date().toISOString()); }

// the fs is injectable so tests never touch the real review queue on disk.
let _fs = nodeFs;
export function __setFs(fs) { _fs = fs || nodeFs; }

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// ---- slug helpers ------------------------------------------------------------

// reddit/github/bitcointalk names are formed from id/symbol/name. Build the small set of plausible
// slugs we'll probe — de-duplicated, lowercased, stripped of anything that can't appear in a handle.
export function candidateSlugs(coin = {}) {
  const raw = [coin.id, coin.symbol, coin.name].filter((x) => typeof x === 'string' && x.trim());
  const out = [];
  const seen = new Set();
  for (const r of raw) {
    // a "name" like "Foo Coin" → both "foocoin" and "foo-coin"; an id like "foo-coin" stays as-is.
    const compact = r.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const dashed = r.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    for (const s of [compact, dashed]) {
      if (s && s.length >= 2 && !seen.has(s)) { seen.add(s); out.push(s); }
    }
  }
  return out;
}

// ---- Bitcointalk: a search-URL builder (no fetch) ----------------------------

// Bitcointalk's announcement threads ("[ANN]") are the canonical first home of most alt-coins, but
// its search is server-rendered HTML behind a flaky GET — there's no JSON API. So phase 2 does the
// honest thing: it builds the exact search URL a human would click, scoped to the Alternate-Crypto
// announcement board, and emits THAT as the candidate evidence. Confidence stays low (it's a lead,
// not a confirmed presence) and we never fetch it here.
export function bitcointalkSearchUrl(coin = {}) {
  const term = (coin.name || coin.symbol || coin.id || '').toString().trim();
  if (!term) return null;
  const q = encodeURIComponent(`${term} ANN`);
  // board=159 is "Announcements (Altcoins)"; the URL is valid even when scoping is ignored.
  return `https://bitcointalk.org/index.php?action=search2&search=${q}&brd[159]=159`;
}

// ---- Reddit: keyless subreddit existence probe -------------------------------

// www.reddit.com/r/<name>/about.json returns the subreddit's metadata when it exists, a 404 (or a
// JSON error envelope) when it doesn't. We treat "exists + has a display_name" as evidence. Soft-fail:
// any throw / non-2xx → not-found, never an exception to the caller.
export async function probeReddit(slug) {
  if (!slug) return { source: 'reddit', slug, exists: false };
  const url = `https://www.reddit.com/r/${encodeURIComponent(slug)}/about.json`;
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!r || !r.ok) return { source: 'reddit', slug, exists: false, status: r?.status ?? 0 };
    const j = await r.json().catch(() => null);
    const d = j && j.data;
    // about.json for a missing/banned sub returns a Listing / error envelope with no display_name.
    if (!d || !d.display_name) {
      return { source: 'reddit', slug, exists: false, status: r.status };
    }
    return {
      source: 'reddit', slug, exists: true, status: r.status,
      url: `https://www.reddit.com/r/${d.display_name}`,
      subscribers: typeof d.subscribers === 'number' ? d.subscribers : null,
      quarantine: !!d.quarantine,
    };
  } catch (err) {
    return { source: 'reddit', slug, exists: false, error: String(err?.name || err?.message || err) };
  }
}

// ---- GitHub: keyless org existence probe -------------------------------------

// api.github.com/orgs/<slug> is keyless (low unauthenticated rate limit, but fine for occasional
// discovery). 200 → the org exists; 404 → it doesn't; 403 → rate-limited (we treat as inconclusive,
// not as "absent"). Soft-fail throughout.
export async function probeGithubOrg(slug) {
  if (!slug) return { source: 'github', slug, exists: false };
  const url = `https://api.github.com/orgs/${encodeURIComponent(slug)}`;
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/vnd.github+json' } });
    if (r && r.status === 403) return { source: 'github', slug, exists: false, inconclusive: true, status: 403 };
    if (!r || !r.ok) return { source: 'github', slug, exists: false, status: r?.status ?? 0 };
    const j = await r.json().catch(() => null);
    if (!j || !j.login) return { source: 'github', slug, exists: false, status: r.status };
    return {
      source: 'github', slug, exists: true, status: r.status,
      url: j.html_url || `https://github.com/${j.login}`,
      public_repos: typeof j.public_repos === 'number' ? j.public_repos : null,
    };
  } catch (err) {
    return { source: 'github', slug, exists: false, error: String(err?.name || err?.message || err) };
  }
}

// ---- confidence scoring ------------------------------------------------------

// Confidence is intentionally conservative — a candidate is a LEAD for a human, not a fact.
//   reddit: base 0.5; +0.2 if >=1000 subscribers; −0.2 if quarantined.
//   github: base 0.45; +0.15 if it has public repos.
//   bitcointalk: a search URL is only a pointer → fixed low 0.25.
function redditConfidence(p) {
  let c = 0.5;
  if ((p.subscribers || 0) >= 1000) c += 0.2;
  if (p.quarantine) c -= 0.2;
  return Math.max(0, Math.min(1, Number(c.toFixed(2))));
}
function githubConfidence(p) {
  let c = 0.45;
  if ((p.public_repos || 0) > 0) c += 0.15;
  return Math.max(0, Math.min(1, Number(c.toFixed(2))));
}

// ---- the finder --------------------------------------------------------------

/**
 * Find CANDIDATE community links for a coin that lacks them.
 * Returns:
 *   {
 *     id, symbol, name,
 *     skipped,                                   // true if the coin already has socials (phase-1 covers it)
 *     candidates: [{ platform, url, confidence, evidence, slug, foundAt }],
 *     probedSlugs: [...],
 *   }
 * `force:true` runs discovery even when the coin already has links (useful to surface alternatives).
 * Never writes anything — call enqueueCandidates() to persist to the review queue.
 */
export async function findCandidates(coin = {}, { force = false } = {}) {
  const id = coin.id || '';
  const symbol = coin.symbol || '';
  const name = coin.name || '';
  const base = { id, symbol, name, skipped: false, candidates: [], probedSlugs: [] };

  // phase-1 already renders coins that carry links — don't second-guess them unless forced.
  if (!force && hasSocials(coin)) return { ...base, skipped: true };

  const slugs = candidateSlugs(coin);
  base.probedSlugs = slugs;
  const foundAt = _now();
  const candidates = [];

  // Bitcointalk: one deterministic search-URL candidate per coin (no per-slug fan-out, no fetch).
  const btUrl = bitcointalkSearchUrl(coin);
  if (btUrl) {
    candidates.push({
      platform: 'bitcointalk', url: btUrl, confidence: 0.25,
      evidence: 'announcement-thread search URL (manual review — Bitcointalk has no result API)',
      slug: null, foundAt,
    });
  }

  // Reddit + GitHub: probe each plausible slug; keep the first confirmed existence per platform.
  for (const slug of slugs) {
    if (!candidates.some((c) => c.platform === 'reddit')) {
      const r = await probeReddit(slug);
      if (r.exists) {
        candidates.push({
          platform: 'reddit', url: r.url, confidence: redditConfidence(r),
          evidence: `r/${slug} exists via about.json (${r.subscribers ?? '?'} subscribers${r.quarantine ? ', quarantined' : ''})`,
          slug, foundAt,
        });
      }
    }
    if (!candidates.some((c) => c.platform === 'github')) {
      const g = await probeGithubOrg(slug);
      if (g.exists) {
        candidates.push({
          platform: 'github', url: g.url, confidence: githubConfidence(g),
          evidence: `github org /${slug} exists (${g.public_repos ?? '?'} public repos)`,
          slug, foundAt,
        });
      }
    }
  }

  // keep only well-formed http(s) candidates whose host classifies to the claimed platform (a cheap
  // guard against a probe handing back something junky). bitcointalk search URLs classify cleanly.
  base.candidates = candidates.filter((c) => {
    if (!c.url || !/^https?:\/\//i.test(c.url)) return false;
    const cls = classify(c.url);
    return cls ? cls.key === c.platform : true;
  });
  return base;
}

// ---- review queue (injectable fs) --------------------------------------------

function load() {
  try { return JSON.parse(_fs.readFileSync(STORE, 'utf8')); } catch { return []; }
}
function save(rows) {
  _fs.mkdirSync(path.dirname(STORE), { recursive: true });
  _fs.writeFileSync(STORE, JSON.stringify(rows, null, 2));
}

// a stable identity for de-duplication: a candidate is "the same" if it points the same coin at the
// same platform+url. Re-running discovery shouldn't pile duplicates into the queue.
function candKey(coinId, c) { return `${coinId}|${c.platform}|${c.url}`; }

/**
 * Append a finder result's candidates to the review queue, skipping ones already queued.
 * Each queued row: { id:candKey, coin, symbol, name, platform, url, confidence, evidence, slug,
 *                    status:'pending', foundAt }. Returns { added, skipped, total }.
 * NEVER auto-publishes — status is always 'pending'; a human flips it.
 */
export async function enqueueCandidates(result) {
  if (!result || !Array.isArray(result.candidates) || !result.candidates.length) {
    return { added: 0, skipped: 0, total: load().length };
  }
  const rows = load();
  const have = new Set(rows.map((r) => r.id));
  let added = 0, skipped = 0;
  for (const c of result.candidates) {
    const key = candKey(result.id, c);
    if (have.has(key)) { skipped++; continue; }
    rows.push({
      id: key, coin: result.id, symbol: result.symbol, name: result.name,
      platform: c.platform, url: c.url, confidence: c.confidence, evidence: c.evidence,
      slug: c.slug ?? null, status: 'pending', foundAt: c.foundAt,
    });
    have.add(key);
    added++;
  }
  if (added) save(rows);
  return { added, skipped, total: rows.length };
}

/** Read the review queue, optionally filtered by status ('pending' by default; pass null for all). */
export function listCandidates({ status = 'pending', coin = null } = {}) {
  let rows = load();
  if (status) rows = rows.filter((r) => r.status === status);
  if (coin) rows = rows.filter((r) => r.coin === coin);
  return rows;
}

// ---- CLI (guarded) -----------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('coin-link-finder.mjs')) {
  const [, , id, symbol, ...nameParts] = process.argv;
  const coin = { id: id || 'bitcoin', symbol: symbol || '', name: nameParts.join(' ') || (id || 'bitcoin') };
  const r = await findCandidates(coin, { force: true });
  console.log(JSON.stringify(r, null, 2));
}
