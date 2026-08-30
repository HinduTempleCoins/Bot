// site-routes.mjs — a declarative manifest of the MELEK site's PAGE routes.
//
// PURPOSE: one discoverable place that lists every page vertical (home, landing,
// tutorial, mail, moderation, witness, soapbox, …) so the new pages are registered
// alongside the existing ones instead of being scattered across per-vertical servers.
//
// This module is PURE DATA + small helpers. It does NOT start a server, open a port,
// touch the network, or edit any other file. Each route declares which `module` (the
// per-vertical `server.mjs`) provides it; that module owns its own `handler(req,res)`.
//
// NOTE — for the live site server: the front door (a future single site server /
// reverse-proxy / router) should CONSUME this manifest to decide what to mount —
// e.g. `import { ROUTES } from './site-routes.mjs'` then, for each route, import its
// `module` and mount its exported `handler` at `route.path`, gating `public:false`
// routes behind admin auth. This module deliberately stops at the manifest so it can
// be unit-tested offline and imported anywhere without side effects.
//
// House style: ESM, esc() on any render, soft-fail-never-throw, no network, no I/O.

// ── HTML escape (used by the optional render helper; never trust route metadata blindly) ──
export const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── normalize a path to a canonical leading-slash, no-trailing-slash form ───────────
// "" → "/", "tutorial" → "/tutorial", "/mail/" → "/mail". Soft: bad input → "/".
export function normalizePath(p) {
  if (p == null) return '/';
  let s = String(p).trim();
  if (s === '' || s === '/') return '/';
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/\/+$/, '');           // drop trailing slash(es)
  s = s.replace(/\/{2,}/g, '/');        // collapse internal doubles
  return s === '' ? '/' : s;
}

// ── ROUTES: the manifest. {path, title, module, public, description} ────────────────
// `module` is the per-vertical server file (relative to this file's dir) that exports
// the page's handler(req,res). `public:true` = anyone; `public:false` = admin/gated.
export const ROUTES = [
  // ── public site verticals ─────────────────────────────────────────────────
  {
    path: '/',
    title: 'MELEK Home',
    module: './home/server.mjs',
    public: true,
    description: 'The site front door — what MELEK is and where to go next.',
  },
  {
    path: '/home-goods',
    title: 'SoapBox Home — home services & goods',
    module: './home-goods/server.mjs',
    public: true,
    description: 'Curated home directory: services/improvement doorways + home-goods stores with coupons.',
  },
  {
    path: '/landing',
    title: 'Landing — Where Is It?',
    module: './landing/server.mjs',
    public: true,
    description: 'Surfaces already-built things (Hathor intro post, latest Cheetah run).',
  },
  {
    path: '/tutorial',
    title: 'Tutorial — Staged Onboarding',
    module: './tutorial/server.mjs',
    public: true,
    description: 'The CryptoKannon-model staged onboarding walkthrough (19 stages).',
  },
  {
    path: '/mail',
    title: 'Mail — Email Signup & Notices',
    module: './mail/server.mjs',
    public: true,
    description: 'Email-only signup/notification surface (no SMS, email providers only).',
  },
  {
    path: '/witness',
    title: 'Witness School',
    module: './witness/server.mjs',
    public: true,
    description: 'Witness School — what a witness is, plus live /hathor status.',
  },
  {
    path: '/soapbox',
    title: 'SoapBox Verticals',
    module: './soapbox/server.mjs',
    public: true,
    description: 'The SoapBox community vertical hub (law/politics/hemp/… subsites).',
  },
  {
    path: '/signup',
    title: 'Signup',
    module: './signup-pages/render.mjs',
    public: true,
    description: 'Client-side-walletgen signup help pages (keys never leave the browser).',
  },
  {
    path: '/wiki',
    title: 'Wiki',
    module: './wiki/server.mjs',
    public: true,
    description: 'Reference wiki for the MELEK ecosystem and corpus.',
  },
  {
    path: '/directory',
    title: 'Directory',
    module: './directory/server.mjs',
    public: true,
    description: 'Ecosystem directory / navigation index across the site verticals.',
  },
  {
    path: '/hub',
    title: 'Hub',
    module: './hub/server.mjs',
    public: true,
    description: 'Cross-vertical hub linking the live MELEK properties together.',
  },
  {
    path: '/search',
    title: 'Search',
    module: './search/server.mjs',
    public: true,
    description: 'Site search across the corpus and verticals.',
  },
  {
    path: '/kula-paper',
    title: 'The KULA Paper — PRANA / KULA economic spec',
    module: './kula-paper/server.mjs',
    public: true,
    description: 'The public economic spec for the PRANA/KULA economy: see-saw compute, KULA/MWALI/APIS, CDP, veKULA, gauges, bridge, arcade.',
  },
  {
    path: '/prana-paper',
    title: 'The PRANA Paper — technical & consensus spec',
    module: './prana-paper/server.mjs',
    public: true,
    description: 'The public technical/consensus spec for PRANA: Etchash PoW, chainId 712217, EIP-1559, the 2% consensus Hathor fee, and the "chain IS the pool" see-saw (HASH + TASK + BURN lanes → one per-epoch pot).',
  },

  // ── admin / gated (public:false — mount behind operator auth) ───────────────
  {
    path: '/moderation',
    title: 'Moderation Console',
    module: './moderation/server.mjs',
    public: false,
    description: 'Operator moderation queue / review console — admin only.',
  },
  {
    path: '/admin',
    title: 'Admin',
    module: './admin/server.mjs',
    public: false,
    description: 'Operator admin surface for the site — admin only.',
  },
  {
    path: '/oversight',
    title: 'Oversight',
    module: './oversight/server.mjs',
    public: false,
    description: 'Oversight / governance review surface — admin only.',
  },
];

// ── routesByVisibility(): split into { public, admin } (soft, never throws) ─────────
export function routesByVisibility() {
  const out = { public: [], admin: [] };
  try {
    for (const r of ROUTES) {
      if (r && r.public === true) out.public.push(r);
      else out.admin.push(r);
    }
  } catch { /* soft-fail: return whatever accumulated */ }
  return out;
}

// ── findRoute(path): exact match on the normalized path, else undefined ─────────────
export function findRoute(path) {
  try {
    const want = normalizePath(path);
    return ROUTES.find((r) => r && normalizePath(r.path) === want);
  } catch {
    return undefined;
  }
}

// ── renderManifest(): optional plain-HTML view of the manifest (esc() everywhere) ───
// Pure string builder — no server, no I/O. Handy for a future "/_routes" debug page.
export function renderManifest() {
  try {
    const row = (r) =>
      `<tr><td><a href="${esc(r.path)}">${esc(r.path)}</a></td>` +
      `<td>${esc(r.title)}</td>` +
      `<td>${esc(r.public ? 'public' : 'admin')}</td>` +
      `<td>${esc(r.description)}</td></tr>`;
    const rows = ROUTES.map(row).join('');
    return `<!doctype html><meta charset="utf-8"><title>MELEK site routes</title>` +
      `<table><thead><tr><th>path</th><th>title</th><th>visibility</th><th>description</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>`;
  } catch {
    return '<!doctype html><meta charset="utf-8"><title>MELEK site routes</title><p>manifest unavailable</p>';
  }
}
