// page.mjs — a branded static "coming soon" page for SoapBox surfaces that aren't deployed yet, so the
// shared nav box (ecosystem-nav) never has a DEAD link (operator 2026-06-17: "make static pages for the
// dead links"). Carries the same top nav as every other SoapBox page, so it's a real landing, not a 404.
//
// Pure render — no server, no fetch. Emit the HTML and serve it as a static file (Caddy file_server).
//   import { comingSoonPage } from './page.mjs'
//   node site/comingsoon/page.mjs "Shopping" "Honest price + deal comparison." > index.html

import { navBar, NAV_STYLE } from '../../integrations/ecosystem-nav.mjs';

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const STYLE = `<style>
  :root{--bg:#0b0e14;--panel:#131826;--line:#222a3a;--fg:#e8e6e3;--mut:#9aa4b2;--gold:#d4a23c}
  *{box-sizing:border-box}body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--gold);text-decoration:none}a:hover{text-decoration:underline}
  main{max-width:680px;margin:0 auto;padding:3rem 1.2rem;text-align:center}
  .alpha{font-size:.55rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);border:1px solid rgba(212,162,60,.5);border-radius:5px;padding:.05rem .3rem;vertical-align:super}
  h1{font-size:2rem;margin:.4rem 0}.soon{display:inline-block;margin:.6rem 0;color:var(--gold);border:1px solid rgba(212,162,60,.5);border-radius:999px;padding:.25rem .9rem;font-size:.85rem;letter-spacing:.04em;text-transform:uppercase}
  .blurb{color:var(--mut);margin:1rem auto;max-width:520px}.back{margin-top:1.6rem}
</style>`;

/**
 * comingSoonPage({ section, blurb, current }) — full HTML doc. `section` = the page title (e.g. "Shopping"),
 * `blurb` = one honest line about what it'll be, `current` = ecosystem-nav key to highlight.
 */
export function comingSoonPage({ section = 'SoapBox', blurb = '', current = '' } = {}) {
  const title = `${esc(section)} — SoapBox (coming soon)`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name=description content="${esc(section)} on SoapBox — a surface we're building. Explore the live ecosystem from the nav above.">
<meta name=robots content="noindex,follow">
${STYLE}${NAV_STYLE}</head><body>
${navBar({ current, brand: 'SoapBox' })}
<main>
  <h1>${esc(section)} <span class=alpha>Alpha</span></h1>
  <div class=soon>Coming soon</div>
  <p class=blurb>${blurb ? esc(blurb) + ' ' : ''}This SoapBox surface is being built. Everything else in the ecosystem is one tap away in the bar above.</p>
  <p class=back><a href="https://soapbox.community/">← Back to the SoapBox hub</a></p>
</main></body></html>`;
}

if (process.argv[1] && process.argv[1].endsWith('page.mjs')) {
  process.stdout.write(comingSoonPage({ section: process.argv[2] || 'SoapBox', blurb: process.argv[3] || '', current: (process.argv[4] || '') }));
}
