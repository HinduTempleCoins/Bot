// site/gamedev/model.mjs — the data model for the INDIE GAME DEV + HOSTING platform: a game FORGE
// (SourceForge-style dev/project/release hosting) fused with an itch/GameJolt-style indie PORTAL
// (media-rich play/download page + a browsable, ratable directory) on the MELEK/PRANA stack.
//
// This is Phase 1 — the pure, off-chain SPINE only: developers → projects → builds/releases, plus
// discovery queries and two render functions (a project page + a portal index). No upload pipeline,
// no auth, no chain writes yet — those are later phases (see .local/INDIE_GAME_DEV_PLATFORM.md).
//
// DISCIPLINE (house style, same as site/webbuilder/store.mjs + pentecaust/crm/model.mjs):
//   • File-backed whole-file JSON, INJECTABLE fs (tests stay fully offline), SOFT-FAIL NEVER THROWS.
//   • esc() ALL interpolation in rendered HTML. Zero request-time network. Zero secrets/keys.
//   • One MELEK account = the developer identity (validAccountName gates owners) — no separate login.
//
// IP-SAFE RULE (load-bearing): only permissively-licensed or dev-owned ORIGINAL work is surfaced.
//   Every project carries a `license` + an `ipOK` flag; discovery (listGames/listFeatured/search/
//   gamesByTag) HIDES anything not ipOK. Host the engine/original transformative work, never a third
//   party's branded IP/assets/ROMs. Submission asserts rights; moderation is post-publish.
//
//   import { createDeveloper, getDeveloper, createProject, getProject, projectBySlug,
//            addRelease, addBuild, rate, incrementPlays, incrementDownloads, setFeatured,
//            listGames, gamesByDeveloper, gamesByTag, listFeatured, search,
//            renderProjectPage, renderPortalIndex, PLATFORMS, LICENSES } from './model.mjs';

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validAccountName } from '../../signup/welcome-grant.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('GAMEDEV_DATA', join(process.cwd(), 'data', 'gamedev.json'));

// ── esc: escape ALL interpolation (same helper the site/ servers use) ────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── vocab ────────────────────────────────────────────────────────────────────────────────────────────
// Build target platforms. 'web' = an in-browser-playable HTML5/WASM bundle (the indie-portal table stake).
export const PLATFORMS = ['web', 'windows', 'mac', 'linux', 'android', 'ios'];
// IP-safe allow-list: dev-owned original + common permissive/copyleft licenses. Anything NOT here → not ipOK
// → hidden from discovery. LSD:Revamped-style fan remakes of branded IP are legally gray → NOT allowed.
export const LICENSES = ['proprietary-dev-owned', 'cc0', 'cc-by', 'cc-by-sa', 'mit', 'apache-2.0', 'gpl-3.0', 'zlib', 'public-domain'];
const SORTS = ['featured', 'new', 'top', 'played'];

// ── caps / clocks / small helpers ────────────────────────────────────────────────────────────────────
const MAX_PROJECTS = Number(env('GAMEDEV_MAX_PROJECTS', '20000')) || 20000;
const MAX_RELEASES = Number(env('GAMEDEV_MAX_RELEASES', '200')) || 200;
const MAX_BUILDS = Number(env('GAMEDEV_MAX_BUILDS', '12')) || 12;
const MAX_SHOTS = 12;
const MAX_TAGS = 24;

const now = (opts) => (opts && opts.now != null ? opts.now : Date.now());
const clamp = (s, n) => String(s == null ? '' : s).slice(0, n);
const acct = (s) => String(s || '').toLowerCase().replace(/^@/, '').trim();
const arr = (v, n, len) => (Array.isArray(v) ? v.map((x) => clamp(x, len)).filter(Boolean).slice(0, n) : []);
function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}
// A URL we are willing to store/emit: http(s) or a content-addressed scheme only (no javascript:/data: xss).
function safeUrl(u) {
  const s = clamp(u, 500).trim();
  return /^(https?:\/\/|ipfs:\/\/|ar:\/\/|\/)/i.test(s) ? s : '';
}
const isIpOk = (license) => LICENSES.includes(String(license || '').toLowerCase());
const rating = (p) => (p && p.ratingCount ? p.ratingSum / p.ratingCount : 0);

// ── injectable fs + store (webbuilder/crm discipline) ────────────────────────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} try { writeFileSync(p, s); return true; } catch { return false; } },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { developers: {}, projects: {} };
  try {
    const o = JSON.parse(raw);
    return o && o.projects ? { developers: o.developers || {}, projects: o.projects } : { developers: {}, projects: {} };
  } catch { return { developers: {}, projects: {} }; }
}
function saveStore(fs, file, store) { (fs.write || realFs.write)(file, JSON.stringify(store)); }
const ctx = (opts = {}) => ({ fs: opts.fs || realFs, file: opts.file || DATA_FILE() });

function uniqueId(store, base) {
  const b = base || 'game';
  if (!store.projects[b]) return b;
  for (let i = 2; i < 100000; i++) { const id = `${b}-${i}`; if (!store.projects[id]) return id; }
  return `${b}-${now()}`;
}

// ── developers ───────────────────────────────────────────────────────────────────────────────────────
// A developer profile is just the MELEK account (one identity across every surface) + display metadata.
export function createDeveloper({ account, name, url } = {}, opts = {}) {
  const a = acct(account);
  if (!validAccountName(a)) return { ok: false, reason: 'account must be a valid MELEK account' };
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const t = now(opts);
  const existing = store.developers[a];
  const dev = {
    account: a,
    name: clamp(name, 120).trim() || (existing && existing.name) || a,
    url: safeUrl(url) || (existing && existing.url) || '',
    created: (existing && existing.created) || t,
    updated: t,
  };
  store.developers[a] = dev;
  saveStore(fs, file, store);
  return { ok: true, developer: dev };
}

export function getDeveloper(account, opts = {}) {
  const { fs, file } = ctx(opts);
  return loadStore(fs, file).developers[acct(account)] || null;
}

// ── projects (one project = one game) ─────────────────────────────────────────────────────────────────
export function createProject(input = {}, opts = {}) {
  const owner = acct(input.owner);
  if (!validAccountName(owner)) return { ok: false, reason: 'owner must be a valid MELEK account' };
  const title = clamp(input.title, 160).trim();
  if (!title) return { ok: false, reason: 'title required' };
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  if (Object.keys(store.projects).length >= MAX_PROJECTS) return { ok: false, reason: 'project cap reached' };
  // Auto-create the developer profile on first project (idempotent).
  if (!store.developers[owner]) store.developers[owner] = { account: owner, name: owner, url: '', created: now(opts), updated: now(opts) };
  const license = LICENSES.includes(String(input.license || '').toLowerCase()) ? String(input.license).toLowerCase() : '';
  const t = now(opts);
  const id = uniqueId(store, slug(title) || 'game');
  const project = {
    id,
    owner,
    title,
    slug: id,
    tagline: clamp(input.tagline, 200),
    description: clamp(input.description, 8000),
    cover: safeUrl(input.cover),
    screenshots: arr(input.screenshots, MAX_SHOTS, 500).map(safeUrl).filter(Boolean),
    trailer: safeUrl(input.trailer),
    genre: clamp(input.genre, 60),
    engine: clamp(input.engine, 60),
    platforms: arr(input.platforms, PLATFORMS.length, 20).filter((p) => PLATFORMS.includes(p)),
    tags: arr(input.tags, MAX_TAGS, 40).map((x) => slug(x)).filter(Boolean),
    license,
    // IP-SAFE gate: a project is only surfaced in discovery when it declares an allow-listed license.
    ipOK: isIpOk(license),
    featured: false,
    status: 'draft',              // draft → published (Phase 2 moderation flips this)
    plays: 0,
    ratingSum: 0,
    ratingCount: 0,
    releases: [],
    created: t,
    updated: t,
  };
  store.projects[id] = project;
  saveStore(fs, file, store);
  return { ok: true, project };
}

export function getProject(id, opts = {}) {
  const { fs, file } = ctx(opts);
  return loadStore(fs, file).projects[String(id || '')] || null;
}
export function projectBySlug(s, opts = {}) { return getProject(slug(s), opts); }

// Internal mutate-and-persist (crm pattern): fn may return {ok:false} to abort without writing.
function mutate(id, opts, fn) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const p = store.projects[String(id || '')];
  if (!p) return { ok: false, reason: 'no such project' };
  const r = fn(p, store);
  if (r && r.ok === false) return r;
  p.updated = now(opts);
  saveStore(fs, file, store);
  return { ok: true, project: p };
}

export function updateProject(id, patch = {}, opts = {}) {
  return mutate(id, opts, (p) => {
    if (patch.title != null) { const t = clamp(patch.title, 160).trim(); if (t) p.title = t; }
    if (patch.tagline != null) p.tagline = clamp(patch.tagline, 200);
    if (patch.description != null) p.description = clamp(patch.description, 8000);
    if (patch.cover != null) p.cover = safeUrl(patch.cover);
    if (patch.trailer != null) p.trailer = safeUrl(patch.trailer);
    if (patch.genre != null) p.genre = clamp(patch.genre, 60);
    if (patch.engine != null) p.engine = clamp(patch.engine, 60);
    if (patch.screenshots != null) p.screenshots = arr(patch.screenshots, MAX_SHOTS, 500).map(safeUrl).filter(Boolean);
    if (patch.platforms != null) p.platforms = arr(patch.platforms, PLATFORMS.length, 20).filter((x) => PLATFORMS.includes(x));
    if (patch.tags != null) p.tags = arr(patch.tags, MAX_TAGS, 40).map((x) => slug(x)).filter(Boolean);
    if (patch.license != null) { const l = String(patch.license).toLowerCase(); p.license = LICENSES.includes(l) ? l : ''; p.ipOK = isIpOk(p.license); }
    if (patch.status != null && ['draft', 'published', 'unlisted', 'removed'].includes(patch.status)) p.status = patch.status;
  });
}

// ── releases + builds ──────────────────────────────────────────────────────────────────────────────────
// A release binds a version string to changelog notes and an initial set of build artifacts.
export function addRelease(id, release = {}, opts = {}) {
  return mutate(id, opts, (p) => {
    if (p.releases.length >= MAX_RELEASES) return { ok: false, reason: 'release cap reached' };
    const version = clamp(release.version, 60).trim();
    if (!version) return { ok: false, reason: 'version required' };
    if (p.releases.some((r) => r.version === version)) return { ok: false, reason: 'duplicate version' };
    const builds = Array.isArray(release.builds) ? release.builds.slice(0, MAX_BUILDS).map(normalizeBuild).filter(Boolean) : [];
    p.releases.push({ version, notes: clamp(release.notes, 4000), created: now(opts), builds });
  });
}

function normalizeBuild(raw = {}) {
  const url = safeUrl(raw.url);
  if (!url) return null;                          // a build with no reachable URL is meaningless
  const platform = PLATFORMS.includes(raw.platform) ? raw.platform : 'web';
  return {
    platform,
    url,
    label: clamp(raw.label, 120) || platform,
    size: Math.max(0, Math.round(Number(raw.size) || 0)),   // bytes, for display
    // A 'web' build may be flagged playable → runs in-browser on the project page (Phase 3 sandbox).
    playable: platform === 'web' && raw.playable === true,
    downloads: 0,
    created: raw.created != null ? raw.created : Date.now(),
  };
}

// Attach a build to an existing release (or the latest release if none named).
export function addBuild(id, build = {}, opts = {}) {
  return mutate(id, opts, (p) => {
    if (!p.releases.length) return { ok: false, reason: 'no release to attach to' };
    const rel = build.version ? p.releases.find((r) => r.version === clamp(build.version, 60).trim()) : p.releases[p.releases.length - 1];
    if (!rel) return { ok: false, reason: 'no such release' };
    if (rel.builds.length >= MAX_BUILDS) return { ok: false, reason: 'build cap reached' };
    const b = normalizeBuild(build);
    if (!b) return { ok: false, reason: 'build url required (http/https/ipfs/ar)' };
    rel.builds.push(b);
  });
}

// The release surfaced as "latest" (last added). Predictable release management (forge requirement).
export function latestRelease(p) {
  return p && p.releases && p.releases.length ? p.releases[p.releases.length - 1] : null;
}
// Flatten every build across releases → for a downloads table / stats.
export function allBuilds(p) {
  const out = [];
  for (const r of (p && p.releases) || []) for (const b of r.builds || []) out.push({ ...b, version: r.version });
  return out;
}
// The playable (in-browser) build, if any, preferring the latest release.
export function playableBuild(p) {
  for (let i = (p && p.releases ? p.releases.length : 0) - 1; i >= 0; i--) {
    const b = (p.releases[i].builds || []).find((x) => x.playable && x.url);
    if (b) return { ...b, version: p.releases[i].version };
  }
  return null;
}

// ── ratings / plays / downloads (the discovery + social-proof signals) ────────────────────────────────
export function rate(id, stars, opts = {}) {
  const s = Math.round(Number(stars));
  if (!(s >= 1 && s <= 5)) return { ok: false, reason: 'stars must be 1..5' };
  return mutate(id, opts, (p) => { p.ratingSum += s; p.ratingCount += 1; });
}
export function incrementPlays(id, n = 1, opts = {}) {
  const inc = Math.max(1, Math.round(Number(n) || 1));
  return mutate(id, opts, (p) => { p.plays += inc; });
}
export function incrementDownloads(id, { version, platform } = {}, opts = {}) {
  return mutate(id, opts, (p) => {
    let hit = false;
    for (const r of p.releases) {
      if (version && r.version !== version) continue;
      for (const b of r.builds) {
        if (platform && b.platform !== platform) continue;
        b.downloads += 1; hit = true;
        if (platform) break;                 // one specific platform → count once
      }
      if (version) break;
    }
    if (!hit) return { ok: false, reason: 'no matching build' };
  });
}
export function setFeatured(id, on = true, opts = {}) {
  return mutate(id, opts, (p) => { p.featured = !!on; });
}

// ── discovery (IP-safe: hides anything not ipOK; only 'published' by default) ─────────────────────────
function visible(p, { includeUnpublished = false } = {}) {
  if (!p || !p.ipOK) return false;                     // IP-SAFE gate — non-negotiable
  if (p.status === 'removed') return false;
  if (includeUnpublished) return true;
  return p.status === 'published';
}
function sortBy(list, sort) {
  const s = SORTS.includes(sort) ? sort : 'new';
  const by = {
    new: (a, b) => (b.created || 0) - (a.created || 0),
    top: (a, b) => rating(b) - rating(a) || (b.ratingCount || 0) - (a.ratingCount || 0),
    played: (a, b) => (b.plays || 0) - (a.plays || 0),
    featured: (a, b) => (b.featured === a.featured ? (b.created || 0) - (a.created || 0) : (b.featured ? 1 : 0) - (a.featured ? 1 : 0)),
  }[s];
  return list.slice().sort(by);
}

export function listGames({ sort = 'new', tag, genre, platform, limit = 100, includeUnpublished = false } = {}, opts = {}) {
  const { fs, file } = ctx(opts);
  let list = Object.values(loadStore(fs, file).projects).filter((p) => visible(p, { includeUnpublished }));
  if (tag) { const t = slug(tag); list = list.filter((p) => p.tags.includes(t)); }
  if (genre) { const g = String(genre).toLowerCase(); list = list.filter((p) => String(p.genre).toLowerCase() === g); }
  if (platform) list = list.filter((p) => p.platforms.includes(platform));
  return sortBy(list, sort).slice(0, Math.max(1, Math.min(1000, limit)));
}
export function gamesByDeveloper(account, opts = {}) {
  const a = acct(account);
  const { fs, file } = ctx(opts);
  // A developer sees ALL their own projects (drafts included); IP gate still hides mislicensed ones.
  return Object.values(loadStore(fs, file).projects)
    .filter((p) => p.owner === a && p.status !== 'removed')
    .sort((x, y) => (y.updated || 0) - (x.updated || 0));
}
export function gamesByTag(tag, opts = {}) { return listGames({ tag, sort: 'top' }, opts); }
export function listFeatured({ limit = 12 } = {}, opts = {}) {
  return listGames({ sort: 'featured', limit }, opts).filter((p) => p.featured);
}
export function search(q, opts = {}) {
  const needle = String(q || '').toLowerCase().trim();
  if (!needle) return [];
  return listGames({ sort: 'top', limit: 1000 }, opts).filter((p) => {
    const hay = `${p.title} ${p.tagline} ${p.genre} ${p.engine} ${p.tags.join(' ')} ${p.owner}`.toLowerCase();
    return hay.includes(needle);
  });
}

// ── stats (per-project adoption tracking — a core forge value) ────────────────────────────────────────
export function projectStats(id, opts = {}) {
  const p = getProject(id, opts);
  if (!p) return null;
  const builds = allBuilds(p);
  return {
    plays: p.plays,
    downloads: builds.reduce((s, b) => s + (b.downloads || 0), 0),
    rating: Number(rating(p).toFixed(2)),
    ratingCount: p.ratingCount,
    releases: p.releases.length,
    builds: builds.length,
    byPlatform: PLATFORMS.reduce((o, pl) => { o[pl] = builds.filter((b) => b.platform === pl).reduce((s, b) => s + b.downloads, 0); return o; }, {}),
  };
}

// ── rendering — escaped HTML fragments (no <html> shell; a server wraps them) ─────────────────────────
const stars = (p) => { const r = Math.round(rating(p)); return '★★★★★☆☆☆☆☆'.slice(5 - r, 10 - r); };

// A single project (storefront) page: cover/media, description, platform badges, and the
// Play/Download button front-and-center, with rating + play count as social proof.
export function renderProjectPage(p) {
  if (!p) return '<main class="gd-empty"><p>Game not found.</p></main>';
  const rel = latestRelease(p);
  const play = playableBuild(p);
  const badges = p.platforms.map((pl) => `<span class="gd-badge">${esc(pl)}</span>`).join('');
  const shots = p.screenshots.map((s) => `<img class="gd-shot" src="${esc(s)}" alt="${esc(p.title)} screenshot" loading="lazy">`).join('');
  const dls = allBuilds(p).map((b) => `<li class="gd-dl"><a href="${esc(b.url)}" rel="nofollow">${esc(b.label)}</a> <span class="gd-plat">${esc(b.platform)}</span>${b.size ? ` <span class="gd-size">${Math.round(b.size / 1024)} KB</span>` : ''} <span class="gd-count">${b.downloads} downloads</span></li>`).join('');
  const cta = play
    ? `<a class="gd-cta gd-play" href="${esc(play.url)}">▶ Play in browser</a>`
    : (rel && rel.builds[0] ? `<a class="gd-cta gd-download" href="${esc(rel.builds[0].url)}" rel="nofollow">⬇ Download (${esc(rel.version)})</a>` : '<span class="gd-cta gd-nobuild">No build yet</span>');
  const tags = p.tags.map((t) => `<a class="gd-tag" href="?tag=${esc(t)}">#${esc(t)}</a>`).join(' ');
  return `<main class="gd-project">
  <header class="gd-head">
    ${p.cover ? `<img class="gd-cover" src="${esc(p.cover)}" alt="${esc(p.title)} cover">` : ''}
    <div class="gd-headinfo">
      <h1 class="gd-title">${esc(p.title)}</h1>
      <p class="gd-tagline">${esc(p.tagline)}</p>
      <p class="gd-by">by <a href="/dev/${esc(p.owner)}">@${esc(p.owner)}</a>${p.genre ? ` · ${esc(p.genre)}` : ''}${p.engine ? ` · ${esc(p.engine)}` : ''}</p>
      <p class="gd-meta"><span class="gd-stars" title="${esc(rating(p).toFixed(2))} / 5 (${p.ratingCount})">${esc(stars(p))}</span> · <span class="gd-plays">${p.plays} plays</span> · <span class="gd-lic">${esc(p.license || 'unlicensed')}</span></p>
      <div class="gd-badges">${badges}</div>
      ${cta}
    </div>
  </header>
  ${shots ? `<section class="gd-gallery">${shots}</section>` : ''}
  <section class="gd-desc"><p>${esc(p.description).replace(/\n/g, '<br>')}</p></section>
  <section class="gd-tags">${tags}</section>
  ${dls ? `<section class="gd-downloads"><h2>Downloads</h2><ul>${dls}</ul></section>` : ''}
  ${rel ? `<section class="gd-release"><h2>Latest release — ${esc(rel.version)}</h2><p>${esc(rel.notes).replace(/\n/g, '<br>')}</p></section>` : ''}
</main>`;
}

// The portal index: a thumbnail grid (the front door), sortable, with rating + play count on each tile.
export function renderPortalIndex(list = [], { title = 'MELEK Game Portal', sort = 'new' } = {}) {
  const tabs = SORTS.map((s) => `<a class="gd-tab${s === sort ? ' on' : ''}" href="?sort=${esc(s)}">${esc(s)}</a>`).join('');
  const cards = (Array.isArray(list) ? list : []).map((p) => `<a class="gd-card" href="/game/${esc(p.slug)}">
    <div class="gd-thumb">${p.cover ? `<img src="${esc(p.cover)}" alt="${esc(p.title)}" loading="lazy">` : `<span class="gd-noimg">${esc((p.title || '?').slice(0, 1))}</span>`}${p.featured ? '<span class="gd-feat">★ Featured</span>' : ''}</div>
    <div class="gd-cardinfo">
      <h3>${esc(p.title)}</h3>
      <p class="gd-cardby">@${esc(p.owner)}</p>
      <p class="gd-cardmeta"><span class="gd-stars">${esc(stars(p))}</span> · ${p.plays} plays</p>
    </div>
  </a>`).join('');
  return `<main class="gd-portal">
  <header class="gd-portalhead"><h1>${esc(title)}</h1><nav class="gd-tabs">${tabs}</nav></header>
  <section class="gd-grid">${cards || '<p class="gd-empty">No games yet — be the first to publish.</p>'}</section>
</main>`;
}

// ── CLI (guarded by process.argv[1], per house style) — a tiny offline demo, no network, no writes ────
function isMain() {
  try { return typeof process !== 'undefined' && process.argv && process.argv[1] && import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
}
if (isMain()) {
  const mem = new Map();
  const o = { fs: { read: (p) => (mem.has(p) ? mem.get(p) : null), write: (p, s) => mem.set(p, s) }, file: 'mem://gamedev.json', now: 1000 };
  const p = createProject({ owner: 'hathor', title: 'Cinder Foundry', tagline: 'An idle smelter', genre: 'idle', engine: 'idle-kit', platforms: ['web'], tags: ['idle', 'clicker'], license: 'mit', cover: 'https://example/cover.png' }, o).project;
  updateProject(p.id, { status: 'published' }, o);
  addRelease(p.id, { version: '1.0.0', notes: 'first cut', builds: [{ platform: 'web', url: 'https://example/play/', playable: true }] }, o);
  rate(p.id, 5, o); incrementPlays(p.id, 42, o);
  process.stdout.write(renderPortalIndex(listGames({}, o)) + '\n\n' + JSON.stringify(projectStats(p.id, o), null, 2) + '\n');
}
