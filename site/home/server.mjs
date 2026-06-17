// server.mjs — soapbox.community ROOT — the ecosystem HOME PAGE.
//
// The canonical FAMILY TREE of every MELEK / PRANA / KULA surface. It is DATA-DRIVEN from a single
// SERVICES map (each service tagged with its chain FAMILY) so it renders the same tree twice: once as an
// ALPHA (live testnet) tree with clickable leaf links, and once as a MAINNET tree showing the future
// production URL (marked "coming soon", not yet clickable). The tree is a CENTERED, BILATERAL genealogy:
// the HUB = SoapBox Community sits in the horizontal MIDDLE, and the three chain families (MELEK / PRANA /
// KULA) branch OUTWARD from it — MELEK to the LEFT, PRANA to the RIGHT, KULA BELOW — each family fanning
// its service leaves out on its own side using square-bracket (right-angle, no-diagonal) pedigree
// connectors that MIRROR across the hub (left brackets open toward the center, right brackets away).
// Per the operator, Alpha is denoted and mapped SEPARATELY from MainNet — two distinct, clearly-headed
// trees. Per the standing alpha-badge convention, a small "Alpha" badge sits beside the ecosystem
// wordmark top-left (everything live is testnet). Drawn with pure CSS connectors — no libraries, no SVG,
// no build, no network — and collapses to a stacked, indented outline on narrow screens.
//
// THE UNIFORM DOMAIN RULE (operator): testnet = X.alpha.{base}, mainnet = X.{base}; a domain's MAIN app
// is alpha.{base} → {base}. Bases in play: melek.salon, soapbox.community, kula.money. The alpha→mainnet
// derivation is the pure function mainnetUrl() — it strips the `alpha.` label from either the
// `X.alpha.{base}` form or the bare `alpha.{base}` (main-app) form, and is unit-tested.
//
//   PORT=8080 BASE_URL=https://soapbox.community node site/home/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the ecosystem family tree (Alpha tree + MainNet tree; root → 3 families → service leaves)
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
// Skimlinks auto-affiliate script (publisher ID is client-side/public by design). Loaded only when
// SKIMLINKS_JS is set in the env — dormant until Skimlinks approves the domain, then auto-monetizes
// outbound merchant links + lets Skimlinks verify the integration on soapbox.community.
const SKIMLINKS_JS = process.env.SKIMLINKS_JS || '';
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
// THE THREE CHAIN FAMILIES — Level-1 branches of the tree under the SoapBox root.
//   MELEK = social chain (Graphene). PRANA = EVM / compute chain + DAO. KULA = DeFi.
const FAM_MELEK = 'MELEK';
const FAM_PRANA = 'PRANA';
const FAM_KULA = 'KULA';

// Per-family descriptions shown on the branch node.
export const FAMILIES = {
  [FAM_MELEK]: { tagline: 'Social chain — posts, tribes, curation, witnesses.' },
  [FAM_PRANA]: { tagline: 'EVM / compute chain — explorer, RPC, mining, DAO.' },
  [FAM_KULA]: { tagline: 'DeFi — the DEX and the in-browser wallet.' },
};

// Each service carries the FAMILY it descends from (its Level-1 branch). category is retained
// as a secondary label on the leaf, but the tree groups by `family`.
const CAT_WALLET = 'Wallet & Explorer';
const CAT_DEFI = 'Tokens & DeFi';
const CAT_CHAIN = 'Chain & Mining';
const CAT_SOCIAL = 'Social & Curation';

export const SERVICES = [
  // ── KULA (DeFi) ──
  { name: 'KulaSwap', blurb: 'Multi-chain DEX — swap, farm, and stake across the ecosystem.', family: FAM_KULA, category: CAT_DEFI, base: 'kula.money', sub: '' },
  { name: 'Akasha', blurb: 'In-browser wallet — keys generated client-side, never transmitted.', family: FAM_KULA, category: CAT_WALLET, base: 'soapbox.community', sub: 'akasha' },

  // ── MELEK (social chain) ──
  { name: 'MELEK app', blurb: 'The MELEK social front-end — feed, tribes, posting, and wallet.', family: FAM_MELEK, category: CAT_SOCIAL, base: 'melek.salon', sub: '' },
  { name: 'Tokens portal', blurb: 'Unified SCOT token portal — tribe tokens, cross-tribe earnings, the ALTI Vote Shop, Hathor\'s daily Faucet, and "How We Stand" (Crypt-ology).', family: FAM_MELEK, category: CAT_DEFI, base: 'melek.salon', sub: 'tokens' },
  { name: 'MELEK-Engine', blurb: 'Hive-Engine-style side-token layer — issue and manage tokens.', family: FAM_MELEK, category: CAT_DEFI, base: 'melek.salon', sub: 'engine' },
  { name: 'Auto-vote / SoapBox', blurb: 'Delegate to earn — multi-chain autovote + our own SoapBox staking, similar to NutBox.', family: FAM_MELEK, category: CAT_SOCIAL, base: 'melek.salon', sub: 'auto' },
  { name: 'SoapBox Staking', blurb: 'Delegate MELEK Power (dMP) to earn ALTI — our own staking, similar to NutBox.', family: FAM_MELEK, category: CAT_DEFI, base: 'melek.salon', sub: 'staking' },
  { name: 'Witness school', blurb: 'Learn the witness role + live @hathor status. (No alpha variant.)', family: FAM_MELEK, category: CAT_SOCIAL, base: 'melek.salon', sub: '=witness' },
  { name: 'Ecosystem status', blurb: 'Live green/red health board across MELEK, PRANA, and KULA.', family: FAM_MELEK, category: CAT_SOCIAL, base: 'melek.salon', sub: 'status' },

  // ── PRANA (EVM / compute chain + DAO) ──
  { name: 'PRANAScan', blurb: 'Block explorer for the PRANA compute chain.', family: FAM_PRANA, category: CAT_WALLET, base: 'soapbox.community', sub: 'pranascan' },
  { name: 'PRANA RPC', blurb: 'Public JSON-RPC endpoint for the PRANA chain.', family: FAM_PRANA, category: CAT_CHAIN, base: 'melek.salon', sub: 'rpc.prana' },
  { name: 'Faucet', blurb: 'Claim testnet funds + an RC gift to get started.', family: FAM_PRANA, category: CAT_CHAIN, base: 'soapbox.community', sub: 'faucet' },
  { name: 'Mining pool', blurb: 'Browser mining + in-browser walletgen. Same host on both nets.', family: FAM_PRANA, category: CAT_CHAIN, base: 'soapbox.community', sub: '=pool' },
];

// Bilateral placement around the central hub: MELEK fans LEFT, PRANA fans RIGHT, KULA hangs BELOW.
const FAMILY_SIDES = { [FAM_MELEK]: 'left', [FAM_PRANA]: 'right', [FAM_KULA]: 'down' };
// Render order kept stable for the markup (and for the per-family branch loop).
const FAMILY_ORDER = [FAM_MELEK, FAM_PRANA, FAM_KULA];

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

// ── theme — shared SoapBox dark theme + the alpha badge + the CENTERED BILATERAL FAMILY-TREE layout ──
// Drawn with pure CSS — no libraries, no SVG, no build. The layout is a 3-column grid: [left wing | hub |
// right wing], with a third "down" wing centred beneath the hub. The hub (SoapBox Community) sits in the
// middle; MELEK fans LEFT, PRANA fans RIGHT, KULA hangs DOWN.
//
// Square-bracket (pedigree) connectors, all right angles, mirrored across the hub, built from pseudo-
// element borders — NO diagonals:
//   • the hub emits a horizontal trunk stub left and right (and a vertical stub down) toward each wing;
//   • each WING is a vertical stack of leaf boxes joined by a single vertical "bracket bar" (the open
//     side of the square bracket) running the height of the stack;
//   • each leaf emits a short horizontal stub from the bracket bar to the box. On the LEFT wing the bar
//     sits on the box's RIGHT (bracket opens toward the center); on the RIGHT wing the bar sits on the
//     box's LEFT — the mirror. The DOWN wing uses the classic top-bus + per-leaf drop.
// --c is the connector colour: gold in the alpha tree, grey in the mainnet tree.
// On narrow screens a media query flattens everything to a stacked, left-indented outline (connector
// pseudo-elements switched off) so it degrades to a readable list — CSS only.
const STYLE = `<style>
  :root{--bg:#0b0e14;--panel:#131826;--line:#222a3a;--line2:#222a3a;--fg:#e8e6e3;--mut:#9aa4b2;--gold:#d4a23c;--grey:#3a4150;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--gold);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:11px 22px;display:flex;align-items:center;gap:12px}
  .brand{font-weight:800;font-size:19px;color:var(--fg)} .brand small{color:var(--mut);font-weight:400;font-size:13px;margin-left:8px}
  .alpha{font-size:.58rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);border:1px solid rgba(212,162,60,.5);border-radius:5px;padding:.05rem .3rem;vertical-align:super;line-height:1;margin-left:6px}
  .wrap{max-width:1180px;margin:0 auto;padding:24px 22px 8px}
  h1{margin:0 0 6px;font-size:28px} .lede{color:var(--mut);margin:0 0 8px;max-width:680px}
  /* the two big top-level sections — visually distinct so the Alpha tree is mapped SEPARATE from MainNet */
  section.net{border-radius:14px;padding:6px 20px 26px;margin:22px 0;overflow-x:auto}
  section.alpha-net{border:1px solid rgba(212,162,60,.45);background:linear-gradient(180deg,#16140d,#131826)}
  section.mainnet-net{border:1px solid var(--line2);background:#0f131c}
  .net-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:14px 0 4px;border-bottom:1px solid var(--line);margin-bottom:6px}
  .net-head h2{font-size:21px;margin:0}
  .net-head .tag{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;border-radius:6px;padding:3px 9px}
  .tag.live{color:var(--gold);border:1px solid rgba(212,162,60,.5)}
  .tag.soon{color:var(--mut);border:1px solid var(--line2)}
  .net-head .nh-sub{color:var(--mut);font-size:13px}

  /* ── CENTERED BILATERAL FAMILY TREE ───────────────────────────────────────────────── */
  /* --c = connector colour (gold in alpha, grey in mainnet). The tree is a 3-col grid: the hub is
     centred in column 2; the left wing in column 1, the right wing in column 3, the down wing spans
     all three columns under the hub. */
  .tree{--c:var(--grey);min-width:1040px;padding-top:14px}
  .alpha-net .tree{--c:var(--gold)}
  .tree-top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;column-gap:0}
  /* HUB — the central node */
  .hub{grid-column:2;display:flex;justify-content:center;position:relative;padding:0 26px}
  /* hub emits a horizontal trunk stub toward each wing (left + right) */
  .hub::before,.hub::after{content:"";position:absolute;top:50%;width:26px;height:2px;background:var(--c)}
  .hub::before{left:0} .hub::after{right:0}
  /* hub also drops a vertical stub down to the KULA (down) wing */
  .hub-drop{grid-column:2;justify-self:center;width:2px;height:20px;background:var(--c)}

  /* a WING = one family branch-box (nearest the hub) + its leaves fanning to the OUTER edge.
     DOM order is [branch-box][stub][stack]; the side wings reverse it so the branch sits inward
     (toward the hub) and the leaf stack fans outward to the page edge — a true mirror left/right. */
  .wing{display:flex;align-items:center;gap:0}
  .wing-left{grid-column:1;justify-content:flex-end;flex-direction:row-reverse}   /* [leaves]·[branch]→hub */
  .wing-right{grid-column:3;justify-content:flex-start}                            /* hub←[branch]·[leaves] */
  /* the branch (family) box connects to the hub trunk with its own short horizontal stub */
  .branch{position:relative;display:flex;align-items:center}
  .wing-left .branch{flex-direction:row-reverse}
  .wing-right .branch{flex-direction:row}
  .branch .stub{width:22px;height:2px;background:var(--c);flex:none}

  /* the leaf STACK of a side wing, joined by a single vertical bracket bar between branch and leaves.
     left wing → bar on the stack's RIGHT edge (toward the inward branch / hub); right wing → bar on
     the LEFT edge — the mirror. Each leaf emits a short horizontal stub OUTWARD from the bar to its box. */
  .stack{position:relative;display:flex;flex-direction:column;gap:12px;padding:6px 0}
  .wing-left .stack{padding-right:22px}
  .wing-left .stack::before{content:"";position:absolute;top:14px;bottom:14px;right:0;width:2px;background:var(--c)}
  .wing-right .stack{padding-left:22px}
  .wing-right .stack::before{content:"";position:absolute;top:14px;bottom:14px;left:0;width:2px;background:var(--c)}
  .stack .leaf{position:relative}
  .wing-left .stack .leaf::after{content:"";position:absolute;top:50%;right:-22px;width:22px;height:2px;background:var(--c)}
  .wing-right .stack .leaf::after{content:"";position:absolute;top:50%;left:-22px;width:22px;height:2px;background:var(--c)}

  /* the DOWN wing (KULA): classic top-bus + per-leaf drop, centred under the hub */
  .wing-down{grid-column:1 / -1;justify-self:center;flex-direction:column;align-items:center;padding-top:6px}
  .wing-down .branch{flex-direction:column;align-items:center}
  .wing-down .branch .stub{width:2px;height:20px}
  .wing-down .stack{flex-direction:row;flex-wrap:wrap;justify-content:center;gap:14px;padding:20px 0 0}
  .wing-down .stack::before{content:"";position:absolute;top:0;left:10%;right:10%;height:2px;background:var(--c)}
  .wing-down .stack .leaf{padding-top:14px}
  .wing-down .stack .leaf::after{content:"";position:absolute;top:0;left:50%;width:2px;height:14px;background:var(--c);transform:translateX(-1px)}

  .node-box{border:1px solid var(--line2);border-radius:11px;padding:12px 14px;background:var(--panel);text-align:left}
  .hub-box{border-color:var(--c);background:#171d2e;padding:14px 18px;text-align:center;min-width:160px}
  .hub-box .fam{font-weight:800;font-size:17px;letter-spacing:.03em}
  .branch-box{border-color:var(--c);background:#171d2e;width:150px;text-align:center;flex:none}
  .branch-box .fam{font-weight:800;font-size:16px;letter-spacing:.04em}
  .branch-box .ft{color:var(--mut);font-size:11.5px;margin-top:3px}
  .leaf-box{display:block;min-width:200px;max-width:230px}
  /* side-wing leaves are a touch narrower so the bilateral tree fits the centred layout */
  .wing-left .leaf-box,.wing-right .leaf-box{min-width:172px;max-width:188px}
  a.leaf-box:hover{border-color:var(--gold);text-decoration:none}
  .leaf-box .nm{font-weight:700;font-size:15px;color:var(--fg)}
  .leaf-box .bl{color:var(--mut);font-size:12.5px;margin-top:4px;line-height:1.45}
  .leaf-box .u{display:block;margin-top:8px;font-size:12px;font-variant-numeric:tabular-nums;word-break:break-all}
  a.leaf-box .u{color:var(--gold)} .leaf-box.soon{opacity:.8} .leaf-box.soon .u{color:var(--mut)}
  .pill{display:inline-block;font-size:10px;font-weight:700;border-radius:20px;padding:1px 7px;margin-left:6px}
  .pill.same{color:var(--up);border:1px solid #3fb95055}
  .pill.soon{color:var(--mut);border:1px solid var(--line2)}

  /* ── responsive: collapse to a stacked, indented outline (connectors off) ── */
  @media(max-width:1080px){
    section.net{overflow-x:visible}
    .tree{min-width:0}
    .tree-top{display:block}
    .hub,.wing{display:block}
    .hub{padding:0}
    .hub::before,.hub::after,.hub-drop,.branch .stub,.stack::before,.stack .leaf::after{display:none;content:none}
    .wing{margin-top:10px}
    .branch{display:block}
    .branch-box{min-width:0;text-align:left;margin-bottom:8px}
    .stack{padding:0;border-left:2px solid var(--c);margin-left:8px;padding-left:14px}
    .wing-left .stack,.wing-right .stack,.wing-down .stack{flex-direction:column;flex-wrap:nowrap;padding-left:14px;padding-right:0}
    .leaf-box{min-width:0;max-width:none;text-align:left}
  }
  footer{color:var(--mut);font-size:12px;text-align:center;padding:28px 22px;margin-top:18px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--gold)}
</style>`;

// One LEAF node = a service. Clickable anchor (alpha, or same-both) or a static "coming soon" box (mainnet).
function leaf({ name, blurb, host, clickable, sameBoth }) {
  const url = httpsUrl(host);
  const pill = sameBoth
    ? '<span class="pill same" title="No separate alpha — same host on both nets">same both nets</span>'
    : (clickable ? '' : '<span class="pill soon">soon</span>');
  const inner = `<div class=nm>${esc(name)}${pill}</div>
    <div class=bl>${esc(blurb)}</div>
    <span class=u>${clickable ? esc(url) + ' →' : esc(host) + (sameBoth ? '' : ' · coming soon')}</span>`;
  const box = clickable
    ? `<a class="leaf-box node-box" href="${esc(url)}" rel="noopener" target=_blank>${inner}</a>`
    : `<div class="leaf-box node-box soon">${inner}</div>`;
  return `<div class=leaf>${box}</div>`;
}

// One WING = a chain family branch-box + the service leaves that fan out from it on its side of the hub.
// `side` ∈ {left, right, down}; the connectors are drawn in CSS keyed off the wing/branch classes (the
// markup is side-agnostic — direction is purely a CSS concern so left/right are exact mirrors).
function wing(family, isAlpha) {
  const fam = FAMILIES[family] || { tagline: '' };
  const side = FAMILY_SIDES[family] || 'down';
  const svcs = SERVICES.filter((s) => s.family === family);
  const leaves = svcs.map((s) => {
    const r = resolve(s);
    return isAlpha
      ? leaf({ name: s.name, blurb: s.blurb, host: r.alphaHost, clickable: true, sameBoth: r.sameBoth })
      // MainNet: future host; clickable only when it's the same host on both nets (already live).
      : leaf({ name: s.name, blurb: s.blurb, host: r.mainnetHost, clickable: r.sameBoth, sameBoth: r.sameBoth });
  }).join('');
  return `<div class="wing wing-${esc(side)}">
    <div class=branch>
      <div class="node-box branch-box"><div class=fam>${esc(family)}</div><div class=ft>${esc(fam.tagline)}</div></div>
      <span class=stub></span>
      <div class=stack>${leaves}</div>
    </div>
  </div>`;
}

// Render one full CENTERED, BILATERAL family tree for one net: a left wing | central hub | right wing
// row, with the third (down) wing centred beneath the hub.
function netTree(which) {
  const isAlpha = which === 'alpha';
  const leftFam = FAMILY_ORDER.find((f) => FAMILY_SIDES[f] === 'left');
  const rightFam = FAMILY_ORDER.find((f) => FAMILY_SIDES[f] === 'right');
  const downFam = FAMILY_ORDER.find((f) => FAMILY_SIDES[f] === 'down');
  const hub = `<div class=hub><div class="node-box hub-box"><div class=fam>${esc(SITE_NAME)}</div>
      <div class=ft>The ecosystem hub</div></div></div>`;
  const tree = `<div class=tree>
    <div class=tree-top>
      ${wing(leftFam, isAlpha)}
      ${hub}
      ${wing(rightFam, isAlpha)}
    </div>
    <div class=hub-drop></div>
    ${wing(downFam, isAlpha)}
  </div>`;
  if (isAlpha) {
    return `<section class="net alpha-net" id=alpha>
      <div class=net-head><h2>Alpha</h2><span class="tag live">live · testnet</span>
        <span class=nh-sub>The live testnet family tree. Every leaf is a working link.</span></div>
      ${tree}</section>`;
  }
  return `<section class="net mainnet-net" id=mainnet>
    <div class=net-head><h2>MainNet</h2><span class="tag soon">coming soon</span>
      <span class=nh-sub>The same family tree at production URLs — drop the <code>alpha.</code> label. Not live yet.</span></div>
    ${tree}</section>`;
}

export function homePage() {
  const body = `<h1>${esc(ECOSYSTEM)}</h1>
    <p class=lede>The family tree of the ecosystem, centred on the <b>${esc(SITE_NAME)}</b> hub. The three chain
      families fan out from the middle — <b>MELEK</b> to the left, <b>PRANA</b> to the right, <b>KULA</b> below —
      and every surface hangs as a leaf off its family. The testnet tree sits under <b>alpha.</b>; mainnet is the
      same tree with <b>alpha.</b> dropped. Alpha is live now; MainNet is coming soon.</p>
    ${netTree('alpha')}
    ${netTree('mainnet')}`;
  return page(`${SITE_NAME} — ${ECOSYSTEM} ecosystem family tree`, body);
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
${SKIMLINKS_JS ? `<script type="text/javascript" src="${esc(SKIMLINKS_JS)}"></script>` : ''}
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
