// bottom-nav.mjs — reusable Steemit-style COLLAPSIBLE bottom navigation bar for SoapBox/MELEK site
// surfaces + the Web Builder. PURE render helper: NO network, NO keys, NO deps. Inline SVG icons +
// inline scoped CSS + a tiny progressive-enhancement <script> so a surface drops it in with one string
// append before </body>.
//
// WHY A SECOND NAV MODULE (vs. mobile-nav.mjs)
//   mobile-nav.mjs is a FIXED, always-visible mobile tab bar. This one is COLLAPSIBLE: a bottom-anchored
//   bar the visitor can expand/collapse with a toggle. It is built on the native <details>/<summary>
//   element so it works with ZERO JavaScript (the browser toggles it natively, and it is keyboard
//   accessible out of the box: the summary is focusable, Enter/Space toggles). The optional inline script
//   is pure enhancement — it remembers the open/closed state per-browser in localStorage and keeps
//   aria-expanded honest. Theme-aware via prefers-color-scheme. Every label + href is esc()'d; bad items
//   soft-fail (skipped), never throw.
//
//   Steemit / HIVE condenser frontends anchor primary nav to the bottom on mobile (a row of icon+label
//   tabs); this adds the collapse affordance the condenser bottom drawer has. Wiring it into the external
//   condenser fork (/workspaces/melek-condenser) is a separate box-side step — our own site/* surfaces and
//   the Web Builder can include it immediately (see the Web Builder `bottomnav` block).
//
// USAGE (a site server.mjs injecting it before </body>):
//
//   import { bottomNav } from '../../integrations/soapbox/bottom-nav.mjs';
//   const bar = bottomNav({ active: 'explore', collapsed: false, baseUrls: { profile: `/@${user}` } });
//   const html = `<!doctype html><html><head>
//       <style>body{padding-bottom:120px}</style>   /* room so content isn't hidden behind the bar */
//     </head><body>
//       ${mainContent}
//       ${bar}
//     </body></html>`;
//
//   node integrations/soapbox/bottom-nav.mjs        # prints a demo bar to stdout

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
  home: 'https://soapbox.community/',            // Explore — discovery / home
  games: 'https://soapbox.community/games',      // spare: games hub
  profile: 'https://melek.salon/@hathor',        // My Profile — the MELEK account
  wallet: 'https://melek.salon/@hathor/wallet',  // My Wallet
  search: 'https://soapbox.community/search',    // spare: search
};

// Resolve a url for a nav item key: explicit baseUrls override > env override > public default.
function resolveUrl(key, baseUrls) {
  const b = baseUrls && typeof baseUrls === 'object' ? baseUrls : {};
  if (b[key] != null && b[key] !== '') return String(b[key]);
  const envKey = 'BOTTOM_NAV_' + String(key).toUpperCase();
  const env = (typeof process !== 'undefined' && process.env && process.env[envKey]) || '';
  if (env) return env;
  return DEFAULT_URLS[key] || '#';
}

// --- inline SVG icon set (24x24, currentColor) -----------------------------

export const ICONS = {
  compass: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  person: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14" r="1.2" fill="currentColor" stroke="none"/></svg>',
  grid: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  // chevron for the collapse toggle (points up when collapsed → "open me"; rotates when expanded)
  chevron: '<svg class="bnav-chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>',
};

// --- default nav items (Steemit-style: Explore · Profile · Wallet) ----------
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
// Scoped by the wrapper class .bnav so it can't collide with host styles. The bar is fixed to the bottom
// and, because it is bottom-anchored, GROWS UPWARD as the item row appears when expanded (the toggle sits
// on top, the items below it at the very bottom edge).

export function bottomNavCss({ showOnDesktop = false } = {}) {
  const desktop = showOnDesktop
    ? ''
    : '\n@media (min-width:768px){.bnav{max-width:420px;left:auto;right:12px}}';
  return `
.bnav{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;
  background:#ffffff;border-top:1px solid #e2e5e8;
  padding-bottom:env(safe-area-inset-bottom,0);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  box-shadow:0 -1px 10px rgba(0,0,0,.08)}
.bnav>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
  gap:8px;padding:9px 14px;min-height:40px;color:#4a5560;font-size:13px;font-weight:600;
  -webkit-tap-highlight-color:transparent;user-select:none}
.bnav>summary::-webkit-details-marker{display:none}
.bnav>summary:focus-visible{outline:2px solid #06d6a0;outline-offset:-2px}
.bnav .bnav-grip{position:absolute;top:5px;left:50%;transform:translateX(-50%);
  width:36px;height:4px;border-radius:3px;background:#cfd5db}
.bnav .bnav-chev{transition:transform .18s ease}
.bnav[open] .bnav-chev{transform:rotate(180deg)}
.bnav-items{display:flex;align-items:stretch;justify-content:space-around;
  border-top:1px solid #eef0f2}
.bnav-items a{flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:3px;padding:9px 4px 8px;text-decoration:none;color:#6b7480;font-size:11px;line-height:1;
  min-height:54px;-webkit-tap-highlight-color:transparent}
.bnav-items a svg{width:22px;height:22px;display:block}
.bnav-items a .bnav-lbl{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bnav-items a:hover{color:#1a1f24}
.bnav-items a:focus-visible{outline:2px solid #06d6a0;outline-offset:-2px;border-radius:6px}
.bnav-items a.bnav-active{color:#06d6a0;font-weight:600}
.bnav-items a.bnav-active svg{stroke:#06d6a0}
@media (prefers-color-scheme:dark){
  .bnav{background:#16191d;border-top:1px solid #262b31;box-shadow:0 -1px 10px rgba(0,0,0,.5)}
  .bnav>summary{color:#c2cad3}
  .bnav .bnav-grip{background:#39414a}
  .bnav-items{border-top:1px solid #262b31}
  .bnav-items a{color:#8a939d}
  .bnav-items a:hover{color:#f2f4f6}
  .bnav-items a.bnav-active{color:#06d6a0}
}${desktop}`;
}

// --- HTML ------------------------------------------------------------------

// Render just the <details> markup (no <style>, no <script>). Escapes every label + href.
// collapsed:true → the bar starts collapsed (no `open` attribute); default is expanded.
export function bottomNavHtml({ items = NAV_ITEMS, active, baseUrls, collapsed = false, toggleLabel = 'Menu' } = {}) {
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
      const cls = isActive ? 'bnav-active' : '';
      const aria = isActive ? ' aria-current="page"' : '';
      return `<a href="${esc(href)}" class="${esc(cls)}"${aria} data-nav="${esc(id)}">`
        + ICONS[iconKey]
        + `<span class="bnav-lbl">${esc(label)}</span></a>`;
    })
    .join('');
  const openAttr = collapsed ? '' : ' open';
  const tlbl = esc(toggleLabel);
  // <details>/<summary>: native, no-JS, keyboard-accessible collapse. summary is the toggle handle.
  return `<details class="bnav"${openAttr} data-bnav>`
    + `<summary aria-label="${tlbl} — expand or collapse the navigation bar">`
    + `<span class="bnav-grip" aria-hidden="true"></span>`
    + ICONS.chevron
    + `<span class="bnav-toggle-lbl">${tlbl}</span>`
    + `</summary>`
    + `<nav class="bnav-items" aria-label="Primary">${tabs}</nav>`
    + `</details>`;
}

// Progressive-enhancement script (optional): remember open/closed per-browser + keep aria-expanded honest.
// Pure enhancement — the bar works fully without it. Guarded, never throws, no network.
export function bottomNavScript({ storageKey = 'soapbox-bottom-nav' } = {}) {
  const k = JSON.stringify(String(storageKey));
  return '<script>(function(){try{'
    + 'var d=document.querySelector("details.bnav[data-bnav]");if(!d)return;'
    + `var K=${k};`
    + 'try{var v=localStorage.getItem(K);if(v==="open")d.open=true;else if(v==="closed")d.open=false;}catch(e){}'
    + 'var s=d.querySelector("summary");if(s)s.setAttribute("aria-expanded",d.open?"true":"false");'
    + 'd.addEventListener("toggle",function(){try{localStorage.setItem(K,d.open?"open":"closed");}catch(e){}'
    + 'if(s)s.setAttribute("aria-expanded",d.open?"true":"false");});'
    + '}catch(e){}})();</script>';
}

// Full self-contained bar: <style> + <details> + optional <script>. This is the drop-in string.
// opts: { items, active, baseUrls, collapsed, toggleLabel, showOnDesktop, noScript, storageKey }.
export function bottomNav(opts = {}) {
  try {
    const o = opts && typeof opts === 'object' ? opts : {};
    const css = bottomNavCss({ showOnDesktop: !!o.showOnDesktop });
    const nav = bottomNavHtml(o);
    const js = o.noScript ? '' : bottomNavScript({ storageKey: o.storageKey });
    return `<style>${css}</style>${nav}${js}`;
  } catch {
    // soft-fail-never-throw: a broken bar must never take down the page.
    return '';
  }
}

// --- CLI demo (guarded) ----------------------------------------------------

if (typeof process !== 'undefined' && process.argv && process.argv[1]
    && import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(bottomNav({ active: 'explore' }) + '\n');
}
