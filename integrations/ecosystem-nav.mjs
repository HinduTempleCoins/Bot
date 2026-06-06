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
  { label: 'Politics', url: env('POLITICS_SITE', 'https://politics.soapbox.community'), group: 'SoapBox', live: true, key: 'politics' },
  { label: 'Oversight', url: env('OVERSIGHT_SITE', 'https://oversight.soapbox.community'), group: 'SoapBox', live: true, key: 'oversight' },
  { label: 'Hemp', url: env('HEMP_SITE', 'https://hemp.soapbox.community'), group: 'SoapBox', live: true, key: 'hemp' },
  { label: 'Stocks', url: env('STOCKS_SITE', 'https://stocks.soapbox.community'), group: 'SoapBox', live: true, key: 'stocks' },
  { label: 'A Buck', url: env('ABUCK_SITE', 'https://abuck.soapbox.community'), group: 'SoapBox', live: true, key: 'abuck' },
  { label: 'Library', url: env('WIKI_SITE', 'https://wiki.soapbox.community'), group: 'SoapBox', live: true, key: 'wiki' },

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

if (process.argv[1] && process.argv[1].endsWith('ecosystem-nav.mjs')) {
  console.log('ECOSYSTEM_LINKS:', ECOSYSTEM_LINKS.length, 'links across Project/SoapBox/Chains');
  console.log('\nnavBar (current=roadmap):\n', navBar({ current: 'roadmap' }));
}
