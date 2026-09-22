// ecosystem-nav.mjs — the SINGLE SOURCE OF TRUTH for cross-property navigation across the whole
// VanKush / SoapBox / MELEK ecosystem. Every site imports this and renders it as a toolbar (navBar)
// or a sidebar (navSidebar), so the properties cross-link each other and NEW destinations (MELEK
// chain, PRANA, melek.business, etc.) are added in ONE place — here — and appear everywhere at once.
//
// Add a link: append to ECOSYSTEM_LINKS with {label, url, group, live}. `live:false` renders muted
// ("soon") and is not clickable. Admin (soapy.blog) is deliberately ABSENT — never cross-linked.
//
//   import { ECOSYSTEM_LINKS, navBar, navSidebar, esc } from './ecosystem-nav.mjs'
//   page header:  ${navBar({ current: 'roadmap' })}
//
// Env overrides let a site point at staging without code change (e.g. DATA_SITE=...).

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// THE registry. Grouped, ordered. `live` gates clickability. Extend here — it propagates everywhere.
export const ECOSYSTEM_LINKS = [
  // The project front doors
  { label: 'Roadmap', url: env('VKF_SITE', 'https://vankushfamily.com'), group: 'Project', live: true, key: 'roadmap' },
  { label: 'SoapBox', url: env('SOAPBOX_HUB', 'https://soapbox.community'), group: 'Project', live: true, key: 'soapbox' },
  // The MetaVerse. SoapBox = the building/financial apps; Dudael = the VR/OpenXR world side.
  { label: 'Dudael', url: env('DUDAEL_SITE', 'https://dudael.com'), group: 'Project', live: true, key: 'dudael' },

  // The live SoapBox verticals
  { label: 'Data', url: env('DATA_SITE', 'https://data.soapbox.community'), group: 'SoapBox', live: true, key: 'data' },
  { label: 'Search', url: env('SEARCH_SITE', 'https://search.soapbox.community'), group: 'SoapBox', live: true, key: 'search' },
  { label: 'Law', url: env('LAW_SITE', 'https://law.soapbox.community'), group: 'SoapBox', live: true, key: 'law' },
  { label: 'Legal Lexicon', url: env('LEXICON_SITE', 'https://lexicon.soapbox.community'), group: 'SoapBox', live: false, key: 'lexicon' },
  { label: 'World Law', url: env('WORLDLAW_SITE', 'https://world-law.soapbox.community'), group: 'SoapBox', live: false, key: 'world-law' },
  { label: 'Free Speech', url: env('FREESPEECH_SITE', 'https://free-speech.soapbox.community'), group: 'SoapBox', live: false, key: 'free-speech' },
  { label: 'Philosophy', url: env('PHILOSOPHY_SITE', 'https://philosophy.soapbox.community'), group: 'SoapBox', live: false, key: 'philosophy' },
  { label: 'Legislative', url: env('LEGISLATIVE_SITE', 'https://legislative.soapbox.community'), group: 'SoapBox', live: false, key: 'legislative' },
  { label: 'Politics', url: env('POLITICS_SITE', 'https://politics.soapbox.community'), group: 'SoapBox', live: true, key: 'politics' },
  { label: 'Oversight', url: env('OVERSIGHT_SITE', 'https://oversight.soapbox.community'), group: 'SoapBox', live: true, key: 'oversight' },
  { label: 'Hemp', url: env('HEMP_SITE', 'https://hemp.soapbox.community'), group: 'SoapBox', live: true, key: 'hemp' },
  { label: 'Stocks', url: env('STOCKS_SITE', 'https://stocks.soapbox.community'), group: 'SoapBox', live: true, key: 'stocks' },
  { label: 'A Buck', url: env('ABUCK_SITE', 'https://abuck.soapbox.community'), group: 'SoapBox', live: true, key: 'abuck' },
  { label: 'Shopping', url: env('SHOPPING_SITE', 'https://shopping.soapbox.community'), group: 'SoapBox', live: true, key: 'shopping' },
  { label: 'Travel', url: env('TRAVEL_SITE', 'https://travel.soapbox.community'), group: 'SoapBox', live: true, key: 'travel' },
  { label: 'Home', url: env('HOME_SITE', 'https://home.soapbox.community'), group: 'SoapBox', live: true, key: 'home' },
  { label: 'Wiki', url: env('WIKI_SITE', 'https://wiki.soapbox.community'), group: 'SoapBox', live: true, key: 'wiki' },
  { label: 'Credentials', url: env('CREDENTIALS_SITE', 'https://credentials.soapbox.community'), group: 'SoapBox', live: true, key: 'credentials' },
  { label: 'Grants', url: env('GRANTS_SITE', 'https://grants.soapbox.community'), group: 'SoapBox', live: true, key: 'grants' },
  { label: 'Academy', url: env('ACADEMY_SITE', 'https://academy.melek.salon'), group: 'SoapBox', live: false, key: 'academy' },
  { label: 'Credit', url: env('CREDIT_SITE', 'https://credit.soapbox.community'), group: 'SoapBox', live: false, key: 'credit' },
  { label: 'Shop', url: env('SHOP_SITE', 'https://shop.melek.salon'), group: 'SoapBox', live: true, key: 'shop' },

  // The chains — add the real endpoints here as they go live; `live:false` shows them as "soon"
  { label: 'MELEK Testnet', url: env('MELEK_ALPHA', 'https://alpha.melek.salon'), group: 'Chains', live: true, key: 'melek-testnet' },
  { label: 'Witness School', url: env('WITNESS_SITE', 'https://witness.melek.salon'), group: 'Chains', live: true, key: 'witness' },
  { label: 'MELEK', url: env('MELEK_SITE', 'https://melek.salon'), group: 'Chains', live: false, key: 'melek' },
  { label: 'PRANA', url: env('PRANA_SITE', '#'), group: 'Chains', live: false, key: 'prana' },
];

export function links({ group } = {}) {
  return ECOSYSTEM_LINKS.filter((l) => !group || l.group === group);
}

function linkHtml(l, current) {
  const isCurrent = current && (l.key === current);
  if (!l.live) return `<span class="enav-link soon" title="coming soon">${esc(l.label)}<span class=enav-soon>soon</span></span>`;
  return `<a class="enav-link${isCurrent ? ' current' : ''}"${isCurrent ? ' aria-current="page"' : ''} href="${esc(l.url)}">${esc(l.label)}</a>`;
}

// Minimal, theme-agnostic CSS (dark-friendly, inherits colors where it can). Include once per page.
export const NAV_STYLE = `<style>
  .enav{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  .enav .enav-brand{font-weight:800;letter-spacing:.3px;opacity:.85;margin-right:4px}
  .enav .enav-grp{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .enav .enav-sep{opacity:.35;margin:0 2px}
  .enav-link{display:inline-block;padding:4px 10px;border:1px solid rgba(128,128,128,.35);border-radius:8px;
    text-decoration:none;color:inherit;white-space:nowrap;font-weight:600}
  .enav-link:hover{border-color:#4c8dff;color:#4c8dff}
  .enav-link.current{border-color:#d9a441;color:#d9a441}
  .enav-link.soon{opacity:.5;cursor:default}
  .enav-soon{font-size:9px;text-transform:uppercase;margin-left:5px;border:1px solid currentColor;border-radius:6px;padding:0 4px;opacity:.8}
  .enav-side{display:flex;flex-direction:column;gap:10px}
  .enav-side .enav-grp{flex-direction:column;align-items:stretch;gap:5px}
  .enav-side .enav-grp-title{font-size:11px;text-transform:uppercase;letter-spacing:.5px;opacity:.55;margin-top:6px}

  /* ── collapsible drawer ────────────────────────────────────────────────────────────────────
     The nav you can put away and bring back, the way Steemit's does. The toggle is a real
     <button> with aria-expanded and aria-controls so it works for a screen reader and for a
     keyboard, and the panel is hidden with the [hidden] attribute rather than a class, so it is
     hidden to assistive tech too and not merely invisible.
     CSS-only open/close via :has() where supported; the tiny inline script below is the fallback
     and the thing that remembers your choice. With no JS at all the panel renders OPEN, because a
     nav that needs JS to exist is worse than one that will not close. */
  .enav-drawer{position:relative}
  .enav-toggle{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font:inherit;font-weight:700;
    padding:6px 12px;border:1px solid rgba(128,128,128,.35);border-radius:8px;background:transparent;color:inherit}
  .enav-toggle:hover{border-color:#4c8dff;color:#4c8dff}
  .enav-toggle:focus-visible{outline:2px solid #4c8dff;outline-offset:2px}
  .enav-bars{display:inline-block;width:16px;height:2px;background:currentColor;position:relative;border-radius:2px}
  .enav-bars::before,.enav-bars::after{content:"";position:absolute;left:0;width:16px;height:2px;background:currentColor;border-radius:2px}
  .enav-bars::before{top:-5px} .enav-bars::after{top:5px}
  .enav-panel{margin-top:10px}
  .enav-panel[hidden]{display:none}
  /* Collapsible groups inside the drawer — each section folds on its own, like the Facebook
     sidebar's Upgrades / Also from Meta sections. <details> needs no script at all. */
  .enav-sec{border-top:1px solid rgba(128,128,128,.2);padding:6px 0}
  .enav-sec>summary{cursor:pointer;list-style:none;font-size:11px;text-transform:uppercase;
    letter-spacing:.5px;opacity:.6;padding:6px 0;font-weight:700}
  .enav-sec>summary::-webkit-details-marker{display:none}
  .enav-sec>summary::after{content:"\\25BE";float:right;transition:transform .15s}
  .enav-sec[open]>summary::after{transform:rotate(180deg)}
  .enav-sec .enav-grp{padding:4px 0 8px}
</style>`;

/**
 * Horizontal toolbar. `current` highlights the active property by key. `brand` optional left label.
 * Renders groups separated by a dot. Drop into any page header.
 */
export function navBar({ current = '', brand = 'VanKush · MELEK' } = {}) {
  const groups = ['Project', 'SoapBox', 'Chains'];
  const parts = groups.map((g) => `<span class=enav-grp>${links({ group: g }).map((l) => linkHtml(l, current)).join('')}</span>`);
  return `<nav class=enav>${brand ? `<span class=enav-brand>${esc(brand)}</span>` : ''}${parts.join('<span class=enav-sep>·</span>')}</nav>`;
}

/** Vertical sidebar variant with group titles. Same registry, same `current` highlighting. */
export function navSidebar({ current = '' } = {}) {
  const groups = ['Project', 'SoapBox', 'Chains'];
  const blocks = groups.map((g) =>
    `<div class=enav-grp><div class=enav-grp-title>${esc(g)}</div>${links({ group: g }).map((l) => linkHtml(l, current)).join('')}</div>`);
  return `<nav class="enav enav-side">${blocks.join('')}</nav>`;
}


/**
 * The drawer script. Kept tiny and inlined by navDrawer() so a page needs no build step and no
 * external request. It does three things and nothing else: toggle the panel, keep aria-expanded
 * honest, and remember the choice in localStorage so the nav stays put across pages.
 *
 * Every localStorage access is wrapped: a private window, blocked site data, or an embedded
 * webview can throw on access, and a nav that throws is a nav that breaks the page under it.
 */
export const NAV_DRAWER_JS = `<script>
(function(){
  var KEY='enav.open';
  function read(){ try { return localStorage.getItem(KEY); } catch(e){ return null; } }
  function write(v){ try { localStorage.setItem(KEY, v); } catch(e){} }
  document.querySelectorAll('.enav-drawer').forEach(function(d){
    var btn = d.querySelector('.enav-toggle'), panel = d.querySelector('.enav-panel');
    if(!btn || !panel) return;
    // Remembered state wins; default is CLOSED on a phone and OPEN on a wide screen, because a
    // drawer that eats the first screenful on a phone is the reason people close it.
    var saved = read();
    var open = saved === null ? window.matchMedia('(min-width: 900px)').matches : saved === '1';
    function apply(o){ panel.hidden = !o; btn.setAttribute('aria-expanded', String(o)); }
    apply(open);
    btn.addEventListener('click', function(){ open = !open; apply(open); write(open ? '1' : '0'); });
    // Tap anywhere outside to close. Phones have no Esc key, so a keyboard-only dismissal is no
    // dismissal at all for most of the people using this — a tap outside is the gesture they already
    // expect from every drawer on a phone, and it costs a desktop user nothing.
    document.addEventListener('click', function(e){
      if(!open) return;
      if(d.contains(e.target)) return;      // inside the drawer, including the toggle itself
      open = false; apply(false); write('0');
    });
  });
})();
<\/script>`;

/**
 * A nav that can be HIDDEN and BROUGHT BACK — the Steemit pattern, asked for repeatedly and until
 * now not built. Groups render as <details> sections so each folds independently.
 *
 * Renders OPEN with no JavaScript. The script only adds closing, remembering, and tap-outside.
 *
 * @param {{current?:string, brand?:string, label?:string, openGroups?:string[]}} opts
 */
export function navDrawer({ current = '', brand = 'VanKush \u00b7 MELEK', label = 'Menu', openGroups = ['Project'] } = {}) {
  const groups = ['Project', 'SoapBox', 'Chains'];
  const sections = groups.map((g) => {
    const open = openGroups.includes(g) ? ' open' : '';
    return `<details class=enav-sec${open}><summary>${esc(g)}</summary>`
      + `<div class=enav-grp>${links({ group: g }).map((l) => linkHtml(l, current)).join('')}</div></details>`;
  }).join('');
  return `<div class="enav enav-drawer">`
    + `<button type=button class=enav-toggle aria-expanded=true aria-controls=enav-panel>`
    + `<span class=enav-bars aria-hidden=true></span>${esc(label)}</button>`
    + `<div class="enav-panel enav-side" id=enav-panel>`
    + (brand ? `<div class=enav-brand>${esc(brand)}</div>` : '')
    + sections
    + `</div></div>`;
}

if (process.argv[1] && process.argv[1].endsWith('ecosystem-nav.mjs')) {
  console.log('ECOSYSTEM_LINKS:', ECOSYSTEM_LINKS.length, 'links across Project/SoapBox/Chains');
  console.log('\nnavBar (current=roadmap):\n', navBar({ current: 'roadmap' }));
}
