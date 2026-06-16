// server.mjs — soapbox.community ROOT — the ecosystem HOME PAGE.
//
// The canonical directory/map of every MELEK / PRANA / KULA surface. It is DATA-DRIVEN from a single
// SERVICES map so it renders the same set twice: once as an ALPHA (live testnet) section with clickable
// links, and once as a MAINNET section showing the future production URL (marked "coming soon", not yet
// clickable). Per the operator, Alpha is denoted and mapped SEPARATELY from MainNet on the page — two
// distinct, clearly-headed sections. Per the standing alpha-badge convention, a small "Alpha" badge sits
// beside the ecosystem wordmark top-left (everything live is testnet).
//
// THE UNIFORM DOMAIN RULE (operator): testnet = X.alpha.{base}, mainnet = X.{base}; a domain's MAIN app
// is alpha.{base} → {base}. Bases in play: melek.salon, soapbox.community, kula.money. The alpha→mainnet
// derivation is the pure function mainnetUrl() — it strips the `alpha.` label from either the
// `X.alpha.{base}` form or the bare `alpha.{base}` (main-app) form, and is unit-tested.
//
//   PORT=8080 BASE_URL=https://soapbox.community node site/home/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the ecosystem map (Alpha section + MainNet section, grouped by category)
//   /health      liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on every interpolated value. Soft-fail-never-throw: every route renders even if a helper is
//   unavailable. No network calls. Alpha links are real + clickable; MainNet links are shown as the
//   future URL with a "soon" tag and are deliberately NOT anchors.

import { createServer } from 'node:http';

const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'SoapBox Community';
const ECOSYSTEM = 'MELEK · PRANA · KULA';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── alpha → mainnet derivation (pure, testable) ────────────────────────────────────────────────────
// Strips the `alpha.` label from a hostname, handling both shapes from the uniform domain rule:
//   X.alpha.{base}  → X.{base}        (e.g. akasha.alpha.soapbox.community → akasha.soapbox.community)
//   alpha.{base}    → {base}          (main-app form, e.g. alpha.kula.money → kula.money)
// Accepts a bare host or a full https URL; returns the same kind it was given (preserving scheme).
// If there is no `alpha` label, the input is returned unchanged (soft-fail).
export function mainnetUrl(alphaUrl) {
  const s = String(alphaUrl == null ? '' : alphaUrl).trim();
  if (!s) return '';
  const m = s.match(/^(https?:\/\/)?([^/]+)(.*)$/i);
  if (!m) return s;
  const scheme = m[1] || '';
  const host = m[2];
  const rest = m[3] || '';
  // remove exactly one `alpha` dot-label wherever it appears in the host
  const labels = host.split('.');
  const idx = labels.findIndex((l) => l.toLowerCase() === 'alpha');
  if (idx === -1) return s; // no alpha label → unchanged
  labels.splice(idx, 1);
  return `${scheme}${labels.join('.')}${rest}`;
}

const httpsUrl = (host) => (/^https?:\/\//i.test(host) ? host : `https://${host}`);

// ── THE SERVICES MAP — single source of truth for both sections ─────────────────────────────────────
// {name, blurb, category, base, sub}
//   base = the domain root (melek.salon | soapbox.community | kula.money)
//   sub  = the alpha host. '' means the domain's MAIN app (alpha.{base}); otherwise X.alpha.{base}
//          ('=' marks a service with no alpha variant — same host on both nets, e.g. the pool).
const CAT_WALLET = 'Wallet & Explorer';
const CAT_DEFI = 'Tokens & DeFi';
const CAT_CHAIN = 'Chain & Mining';
const CAT_SOCIAL = 'Social & Curation';

export const SERVICES = [
  // ── Tokens & DeFi ──
  { name: 'KulaSwap', blurb: 'Multi-chain DEX — swap, farm, and stake across the ecosystem.', category: CAT_DEFI, base: 'kula.money', sub: '' },
  { name: 'Tokens portal', blurb: 'Unified SCOT token portal — tribe tokens, cross-tribe earnings.', category: CAT_DEFI, base: 'melek.salon', sub: 'tokens' },
  { name: 'MELEK-Engine', blurb: 'Hive-Engine-style side-token layer — issue and trade tokens.', category: CAT_DEFI, base: 'melek.salon', sub: 'engine' },

  // ── Wallet & Explorer ──
  { name: 'Akasha', blurb: 'In-browser wallet — keys generated client-side, never transmitted.', category: CAT_WALLET, base: 'soapbox.community', sub: 'akasha' },
  { name: 'PRANAScan', blurb: 'Block explorer for the PRANA compute chain.', category: CAT_WALLET, base: 'soapbox.community', sub: 'pranascan' },

  // ── Chain & Mining ──
  { name: 'PRANA RPC', blurb: 'Public JSON-RPC endpoint for the PRANA chain.', category: CAT_CHAIN, base: 'melek.salon', sub: 'rpc.prana' },
  { name: 'Faucet', blurb: 'Claim testnet funds + an RC gift to get started.', category: CAT_CHAIN, base: 'soapbox.community', sub: 'faucet' },
  { name: 'Mining pool', blurb: 'Browser mining + in-browser walletgen. Same host on both nets.', category: CAT_CHAIN, base: 'soapbox.community', sub: '=pool' },

  // ── Social & Curation ──
  { name: 'Auto-vote / NutBox', blurb: 'Delegate to earn — multi-chain autovote + NutBox staking.', category: CAT_SOCIAL, base: 'melek.salon', sub: 'auto' },
  { name: 'Witness school', blurb: 'Learn the witness role + live @hathor status. (No alpha variant.)', category: CAT_SOCIAL, base: 'melek.salon', sub: '=witness' },
];

const CATEGORY_ORDER = [CAT_WALLET, CAT_DEFI, CAT_CHAIN, CAT_SOCIAL];

// Resolve a service to its alpha host and mainnet host.
//   sub === ''        → alpha = alpha.{base},  mainnet = {base}              (main app)
//   sub === '=X'      → no alpha variant: same host (X.{base} or {base}) on both nets
//   sub === 'X'       → alpha = X.alpha.{base}, mainnet = X.{base}
export function resolve(svc) {
  const base = svc.base;
  if (svc.sub === '') {
    return { sameBoth: false, alphaHost: `alpha.${base}`, mainnetHost: base };
  }
  if (svc.sub && svc.sub.startsWith('=')) {
    const label = svc.sub.slice(1);
    const host = label ? `${label}.${base}` : base; // '=pool' → pool.{base}
    return { sameBoth: true, alphaHost: host, mainnetHost: host };
  }
  const alphaHost = `${svc.sub}.alpha.${base}`;
  return { sameBoth: false, alphaHost, mainnetHost: mainnetUrl(alphaHost) };
}

// ── theme (shared SoapBox dark theme + the alpha badge per the standing convention) ─────────────────
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:11px 22px;display:flex;align-items:center;gap:12px}
  .brand{font-weight:800;font-size:19px;color:var(--fg)} .brand small{color:var(--mut);font-weight:400;font-size:13px;margin-left:8px}
  .alpha{font-size:.58rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);border:1px solid rgba(212,162,60,.5);border-radius:5px;padding:.05rem .3rem;vertical-align:super;line-height:1;margin-left:6px}
  .wrap{max-width:1000px;margin:0 auto;padding:24px 22px 8px}
  h1{margin:0 0 6px;font-size:28px} .lede{color:var(--mut);margin:0 0 8px;max-width:640px}
  .muted{color:var(--mut)}
  /* the two big top-level sections — visually distinct so Alpha is mapped SEPARATE from MainNet */
  section.net{border-radius:14px;padding:6px 20px 18px;margin:22px 0}
  section.alpha-net{border:1px solid rgba(212,162,60,.45);background:linear-gradient(180deg,#1c1a12,#161b22)}
  section.mainnet-net{border:1px solid var(--line2);background:#12161d}
  .net-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:14px 0 4px;border-bottom:1px solid var(--line);margin-bottom:6px}
  .net-head h2{font-size:21px;margin:0}
  .net-head .tag{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;border-radius:6px;padding:3px 9px}
  .tag.live{color:var(--gold);border:1px solid rgba(212,162,60,.5)}
  .tag.soon{color:var(--mut);border:1px solid var(--line2)}
  .net-head .nh-sub{color:var(--mut);font-size:13px}
  .cat{margin:16px 0 6px;font-size:13px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}
  .card{display:block;border:1px solid var(--line2);border-radius:11px;padding:15px 17px;background:var(--panel)}
  a.card:hover{border-color:var(--blue);text-decoration:none}
  .card .nm{font-weight:700;font-size:16px;color:var(--fg)}
  .card .bl{color:var(--mut);font-size:13px;margin-top:4px;line-height:1.5}
  .card .u{display:block;margin-top:9px;font-size:12.5px;font-variant-numeric:tabular-nums}
  a.card .u{color:var(--blue)} .card.soon{opacity:.78} .card.soon .u{color:var(--mut)}
  .pill{display:inline-block;font-size:10.5px;font-weight:700;border-radius:20px;padding:1px 8px;margin-left:6px}
  .pill.same{color:var(--up);border:1px solid #3fb95055}
  .pill.soon{color:var(--mut);border:1px solid var(--line2)}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:28px 22px;margin-top:18px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

function card({ name, blurb, host, clickable, sameBoth }) {
  const url = httpsUrl(host);
  const pill = sameBoth
    ? '<span class="pill same" title="No separate alpha — same host on both nets">same both nets</span>'
    : (clickable ? '' : '<span class="pill soon">soon</span>');
  const inner = `<div class=nm>${esc(name)}${pill}</div>
    <div class=bl>${esc(blurb)}</div>
    <span class=u>${clickable ? esc(url) + ' →' : esc(host) + (sameBoth ? '' : ' · coming soon')}</span>`;
  return clickable
    ? `<a class=card href="${esc(url)}" rel="noopener" target=_blank>${inner}</a>`
    : `<div class="card soon">${inner}</div>`;
}

// Render one net section (alpha or mainnet), grouped by category.
function netSection(which) {
  const isAlpha = which === 'alpha';
  let body = '';
  for (const cat of CATEGORY_ORDER) {
    const svcs = SERVICES.filter((s) => s.category === cat);
    if (!svcs.length) continue;
    const cards = svcs.map((s) => {
      const r = resolve(s);
      if (isAlpha) {
        // Alpha section: real live host, clickable.
        return card({ name: s.name, blurb: s.blurb, host: r.alphaHost, clickable: true, sameBoth: r.sameBoth });
      }
      // MainNet section: future host. Clickable ONLY if it's the same host on both nets (already live).
      return card({ name: s.name, blurb: s.blurb, host: r.mainnetHost, clickable: r.sameBoth, sameBoth: r.sameBoth });
    }).join('');
    body += `<div class=cat>${esc(cat)}</div><div class=grid>${cards}</div>`;
  }
  if (isAlpha) {
    return `<section class="net alpha-net" id=alpha>
      <div class=net-head><h2>Alpha</h2><span class="tag live">live · testnet</span>
        <span class=nh-sub>Everything below is running now on the testnet. Links are live.</span></div>
      ${body}</section>`;
  }
  return `<section class="net mainnet-net" id=mainnet>
    <div class=net-head><h2>MainNet</h2><span class="tag soon">coming soon</span>
      <span class=nh-sub>The same surfaces at their production URLs — drop the <code>alpha.</code> label. Not live yet.</span></div>
    ${body}</section>`;
}

export function homePage() {
  const body = `<h1>${esc(ECOSYSTEM)}</h1>
    <p class=lede>The map of the ecosystem. Every surface lives at a uniform address: the testnet sits under
      <b>alpha.</b> and mainnet is the same name with <b>alpha.</b> dropped. Alpha is live now; MainNet is coming soon.</p>
    ${netSection('alpha')}
    ${netSection('mainnet')}`;
  return page(`${SITE_NAME} — ${ECOSYSTEM} ecosystem map`, body);
}

function page(title, body) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="The canonical map of the MELEK, PRANA and KULA ecosystem — wallet, explorer, DEX, tokens, chain, mining and curation surfaces. Alpha (testnet) is live; MainNet is coming soon.">
<meta name=robots content="index,follow">
<link rel=canonical href="${esc(BASE_URL)}/">
<meta property="og:title" content="${esc(title)}">
${STYLE}</head><body>
<header class=topbar><span class=brand>SoapBox<span class=alpha>Alpha</span><small>${esc(ECOSYSTEM)}</small></span></header>
<main class=wrap>${body}</main>
<footer><b>${esc(SITE_NAME)}</b> · the MELEK / PRANA / KULA ecosystem map. All surfaces are on the
  <b>testnet (alpha)</b> today; mainnet URLs are shown for reference and are not live yet.
  <div style="margin-top:8px"><a href="#alpha">Alpha</a> · <a href="#mainnet">MainNet</a></div></footer>
</body></html>`;
}

// ── crawler files (inline, keyless — no shared-module dependency so the root can't soft-fail to blank) ─
const ROBOTS = `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`;
function sitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>${esc(BASE_URL)}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n`;
}
function llmsTxt() {
  const lines = [`# ${SITE_NAME}`, '', `> The map of the MELEK / PRANA / KULA ecosystem. Alpha (testnet) is live; MainNet is coming soon.`, ''];
  lines.push('## Alpha (live testnet)');
  for (const s of SERVICES) lines.push(`- [${s.name}](${httpsUrl(resolve(s).alphaHost)}): ${s.blurb}`);
  lines.push('', '## MainNet (coming soon)');
  for (const s of SERVICES) {
    const r = resolve(s);
    lines.push(`- ${s.name}: ${httpsUrl(r.mainnetHost)}${r.sameBoth ? ' (live — same host on both nets)' : ' (coming soon)'}`);
  }
  return lines.join('\n') + '\n';
}

function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(ROBOTS); }
    if (path === '/sitemap.xml' || path === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(sitemapXml());
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(llmsTxt());
    }
    if (path === '/') return sendHtml(res, homePage());

    // unknown route → soft 404 (still renders the map so the root is never a dead end)
    return sendHtml(res, homePage(), 404);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/home\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Community ecosystem home on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
