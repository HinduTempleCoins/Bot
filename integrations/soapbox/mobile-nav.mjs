// mobile-nav.mjs — reusable Steemit-style FIXED mobile bottom navigation bar (queue: SoapBox/MELEK
// surfaces). PURE render helper: NO network, NO keys, NO deps. Inline SVG icons + inline scoped CSS
// so a surface can drop it in with a single string append before </body>.
//
// Modeled on the Steemit mobile app's bottom nav (Explore · My Profile · My Wallet): a row of 3–5
// icon+label tabs, fixed to the bottom on small screens, with an active-tab highlight. Theme-aware
// (respects prefers-color-scheme: dark). Every label/url is esc()'d; bad items soft-fail (skipped),
// never throw.
//
// URLs are env-overridable via a baseUrls arg or process.env (MOBILE_NAV_HOME / _PROFILE / _WALLET /
// _GAMES). Defaults point only at public domains (melek.salon / soapbox.community) — never infra.
//
// USAGE (a site server.mjs injecting it before </body>):
//
//   import { renderMobileNav } from '../../integrations/soapbox/mobile-nav.mjs';
//   const nav = renderMobileNav({ active: 'explore', baseUrls: { profile: `/@${user}` } });
//   // give the page bottom padding so content isn't hidden behind the fixed bar:
//   const page = `<!doctype html><html><head>
//       <style>body{padding-bottom:64px}</style>   /* or: body{padding-bottom:env(safe-area-inset-bottom)} */
//     </head><body>
//       ${mainContent}
//       ${nav}
//     </body></html>`;
//
// The bar shows on small screens and (by default) hides on wide screens (>=768px) — pass
// showOnDesktop:true to keep it visible everywhere. It is a component; wiring it into the condenser
// (the Blurt/Steem-fork blog) is a separate box-side step — our own site/* surfaces and the games
// hub can include it immediately.
//
//   node integrations/soapbox/mobile-nav.mjs        # prints a demo bar to stdout

// --- escaping (house style) ------------------------------------------------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- public domain defaults (env-overridable, never infra) -----------------

const DEFAULT_URLS = {
  home: 'https://soapbox.community/',            // Explore — discovery / games hub / home
  games: 'https://soapbox.community/games',      // spare: games hub
  profile: 'https://melek.salon/@hathor',        // My Profile — the MELEK account
  wallet: 'https://melek.salon/@hathor/wallet',  // My Wallet
  search: 'https://soapbox.community/search',    // spare: search
};

// Resolve a url for a nav item key: explicit baseUrls override > env override > public default.
function resolveUrl(key, baseUrls) {
  const b = baseUrls && typeof baseUrls === 'object' ? baseUrls : {};
  if (b[key] != null && b[key] !== '') return String(b[key]);
  const envKey = 'MOBILE_NAV_' + String(key).toUpperCase();
  const env = (typeof process !== 'undefined' && process.env && process.env[envKey]) || '';
  if (env) return env;
  return DEFAULT_URLS[key] || '#';
}

// --- inline SVG icon set (24x24, currentColor) -----------------------------
// Small, self-contained. currentColor lets CSS drive active/inactive coloring.

export const ICONS = {
  // Explore / discover — compass
  compass: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
  // Home
  home: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  // Profile — person
  person: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  // Wallet
  wallet: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14" r="1.2" fill="currentColor" stroke="none"/></svg>',
  // spare: grid
  grid: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  // spare: search
  search: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};

// --- default nav items (Steemit-style: Explore · My Profile · My Wallet) ----
// id: stable key for active-matching. urlKey: which resolveUrl() key to use. icon: ICONS key.

export const NAV_ITEMS = [
  { id: 'explore', label: 'Explore', urlKey: 'home', icon: 'compass' },
  { id: 'profile', label: 'Profile', urlKey: 'profile', icon: 'person' },
  { id: 'wallet', label: 'Wallet', urlKey: 'wallet', icon: 'wallet' },
];

// Is a nav item usable? soft-fail: garbage/empty is skipped, not thrown.
function validItem(it) {
  return it && typeof it === 'object' && (it.label != null || it.id != null);
}

// --- CSS -------------------------------------------------------------------

// Scoped by the wrapper class .mnav so it can't collide with host styles.
export function mobileNavCss({ showOnDesktop = false } = {}) {
  const desktop = showOnDesktop
    ? ''
    : '\n@media (min-width:768px){.mnav{display:none}}';
  return `
.mnav{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;
  align-items:stretch;justify-content:space-around;
  background:#ffffff;border-top:1px solid #e2e5e8;
  padding-bottom:env(safe-area-inset-bottom,0);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  box-shadow:0 -1px 8px rgba(0,0,0,.06)}
.mnav a{flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:2px;padding:8px 4px 6px;text-decoration:none;color:#6b7480;font-size:11px;line-height:1;
  min-height:52px;-webkit-tap-highlight-color:transparent}
.mnav a svg{width:22px;height:22px;display:block}
.mnav a .mnav-lbl{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mnav a:hover{color:#1a1f24}
.mnav a.mnav-active{color:#06d6a0;font-weight:600}
.mnav a.mnav-active svg{stroke:#06d6a0}
@media (prefers-color-scheme:dark){
  .mnav{background:#16191d;border-top:1px solid #262b31;box-shadow:0 -1px 8px rgba(0,0,0,.4)}
  .mnav a{color:#8a939d}
  .mnav a:hover{color:#f2f4f6}
  .mnav a.mnav-active{color:#06d6a0}
}${desktop}`;
}

// --- HTML ------------------------------------------------------------------

// Render just the <nav> markup (no <style>). Escapes every label + href.
export function mobileNavHtml({ items = NAV_ITEMS, active, baseUrls } = {}) {
  const list = Array.isArray(items) ? items : NAV_ITEMS;
  const tabs = list
    .filter(validItem)
    .map((it) => {
      const id = it.id != null ? String(it.id) : '';
      const label = it.label != null ? String(it.label) : id;
      // href precedence: explicit it.href/url > resolve by urlKey > resolve by id
      let href = it.href || it.url;
      if (!href) href = resolveUrl(it.urlKey || id, baseUrls);
      const iconKey = it.icon && ICONS[it.icon] ? it.icon : 'grid';
      const isActive = active != null && String(active) === id;
      const cls = isActive ? 'mnav-active' : '';
      const aria = isActive ? ' aria-current="page"' : '';
      return `<a href="${esc(href)}" class="${esc(cls)}"${aria} data-nav="${esc(id)}">`
        + ICONS[iconKey]
        + `<span class="mnav-lbl">${esc(label)}</span></a>`;
    })
    .join('');
  return `<nav class="mnav" aria-label="Primary">${tabs}</nav>`;
}

// Full self-contained bar: <style> + <nav>. This is the drop-in string.
export function renderMobileNav(opts = {}) {
  try {
    const o = opts && typeof opts === 'object' ? opts : {};
    const css = mobileNavCss({ showOnDesktop: !!o.showOnDesktop });
    const nav = mobileNavHtml(o);
    return `<style>${css}</style>${nav}`;
  } catch {
    // soft-fail-never-throw: a broken bar must never take down the page.
    return '';
  }
}

// --- CLI demo (guarded) ----------------------------------------------------

if (typeof process !== 'undefined' && process.argv && process.argv[1]
    && import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(renderMobileNav({ active: 'explore' }) + '\n');
}
