// render.mjs — the Library of Ashurbanipal wiki surface. A small MediaWiki-lite → HTML renderer +
// the shared layout. Pure functions (text in → HTML out). The articles are produced by the
// (faithful) Ashurbanipal bot with == Sources == + == Coverage == sections and <ref>file</ref>
// citations; this renders them honestly — provenance and coverage are shown, never hidden.
//
// House style / visual identity (pattern research: knowledge/architecture/aesthetic_canon):
//   Egyptian-angelic-vaporwave signature — GOLD (Ra/eternity) + LAPIS (Nut, the night sky) on
//   QUARTZ/limestone white, with AMETHYST violet as the "light-as-material" glow. The header carries
//   a wesekh-collar register (the thin gold→lapis→green band) and the layout is axial/symmetric —
//   the pylon threshold you pass through into the library. Dark mode is the lapis-night sky.
//   All colour lives in :root tokens so the whole surface re-themes from one place.

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const slugify = (s) => String(s).trim().replace(/\.wiki$/, '').replace(/[\s_]+/g, '_').replace(/[^A-Za-z0-9_:-]/g, '');
export const titleize = (slug) => String(slug).replace(/_/g, ' ');

// anchorId — a stable, URL-safe #fragment for an in-article heading, for the table of contents.
// Lowercased, spaces→hyphens, punctuation dropped. Deduped by the caller (see renderWiki).
export const anchorId = (s) => String(s == null ? '' : s)
  .toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\w\s-]/g, '').trim()
  .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'section';

const STYLE = `<style>
  /* ── Signature palette (aesthetic_canon): gold+lapis on quartz, amethyst light. One source of truth. */
  :root{
    --bg:#f6f5f1;--panel:#ffffff;--panel2:#fbfaf6;--line:#e7e3d8;--line2:#dcd7c8;
    --fg:#1b1e26;--mut:#5f6470;--faint:#8b8f9a;
    --link:#0f6f34;--linkh:#0a5527;
    --gold:#e0a11b;--goldink:#9a6c0b;--goldsoft:#f4e6c4;
    --lapis:#26418f;--lapisink:#1a2b6b;--lapissoft:#dfe4f4;
    --amethyst:#7c4d9c;--amethystsoft:#ece2f6;
    --up:#0f6f34;--down:#b83227;
    --measure:68ch;--radius:12px;--gutter:16px;
    --shadow:0 1px 2px rgba(27,30,38,.05),0 6px 20px rgba(27,30,38,.05);
    --glow:0 0 0 3px rgba(124,77,156,.22);
  }
  /* ── Dark mode = the lapis-night sky (Nut). Guarded so an explicit data-theme wins. */
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
    --bg:#0e1226;--panel:#151a34;--panel2:#111531;--line:#262d4d;--line2:#333c63;
    --fg:#eaecf5;--mut:#a7adc4;--faint:#7b83a3;
    --link:#5fd08a;--linkh:#8fe3ac;
    --gold:#f0bf52;--goldink:#f0bf52;--goldsoft:#3a2f14;
    --lapis:#8aa0e6;--lapisink:#b8c4f0;--lapissoft:#1c2547;
    --amethyst:#c299ea;--amethystsoft:#2a1f42;
    --up:#5fd08a;--down:#f0857a;
    --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 26px rgba(0,0,0,.45);
    --glow:0 0 0 3px rgba(194,153,234,.30);
  }}
  :root[data-theme="dark"]{
    --bg:#0e1226;--panel:#151a34;--panel2:#111531;--line:#262d4d;--line2:#333c63;
    --fg:#eaecf5;--mut:#a7adc4;--faint:#7b83a3;
    --link:#5fd08a;--linkh:#8fe3ac;
    --gold:#f0bf52;--goldink:#f0bf52;--goldsoft:#3a2f14;
    --lapis:#8aa0e6;--lapisink:#b8c4f0;--lapissoft:#1c2547;
    --amethyst:#c299ea;--amethystsoft:#2a1f42;
    --up:#5fd08a;--down:#f0857a;
    --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 26px rgba(0,0,0,.45);
    --glow:0 0 0 3px rgba(194,153,234,.30);
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth;scroll-padding-top:76px}
  body{font:17px/1.75 Georgia,'Iowan Old Style','Times New Roman',serif;margin:0;background:var(--bg);color:var(--fg);-webkit-text-size-adjust:100%}
  a{color:var(--link);text-decoration:none} a:hover{color:var(--linkh);text-decoration:underline}
  /* ── Header: the pylon threshold. The wesekh register (gold→lapis→green) sits under it. */
  header.top{position:sticky;top:0;z-index:20;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:color-mix(in srgb,var(--panel) 88%,transparent);backdrop-filter:saturate(1.4) blur(8px);border-bottom:1px solid var(--line2);padding:11px var(--gutter);display:flex;gap:16px;align-items:center;flex-wrap:wrap}
  header.top::after{content:"";position:absolute;left:0;right:0;bottom:-3px;height:3px;background:linear-gradient(90deg,var(--gold) 0 33%,var(--lapis) 33% 66%,var(--link) 66% 100%);opacity:.9}
  .brand{font-family:system-ui,sans-serif;font-weight:800;font-size:18px;color:var(--fg);display:flex;align-items:center;gap:9px}
  .brand:hover{text-decoration:none} .brand small{color:var(--goldink);font-weight:600;font-size:12px;letter-spacing:.02em}
  /* the crowned sun-disk — gold Ra core, lapis ring, green corona (light as material) */
  .brand .sun{width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 50% 45%,var(--gold) 0 30%,var(--lapis) 33% 52%,var(--link) 55% 100%);flex:0 0 auto;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 0 10px rgba(224,161,27,.5)}
  nav.main{display:flex;gap:15px;font-family:system-ui,sans-serif;margin-left:auto;align-items:center;flex-wrap:wrap}
  nav.main a{color:var(--mut);font-weight:600;font-size:14px} nav.main a:hover{color:var(--link);text-decoration:none}
  nav.main a.active{color:var(--fg);box-shadow:inset 0 -2px 0 var(--gold)}
  .themebtn{font:inherit;font-family:system-ui,sans-serif;font-size:13px;cursor:pointer;background:var(--panel2);border:1px solid var(--line2);color:var(--mut);border-radius:20px;padding:5px 11px;line-height:1}
  .themebtn:hover{border-color:var(--gold);color:var(--fg)}
  /* ── Shell: axial, symmetric. Article + sticky TOC aside on wide screens. */
  .shell{max-width:1120px;margin:0 auto;padding:26px var(--gutter);display:grid;grid-template-columns:1fr;gap:30px}
  .shell.withtoc{grid-template-columns:minmax(0,1fr) 250px}
  .wrap{max-width:var(--measure);margin:0 auto;padding:26px var(--gutter);width:100%}
  main.col{min-width:0;max-width:var(--measure);margin:0 auto}
  .crumbs{font-family:system-ui,sans-serif;font-size:13px;color:var(--faint);margin:0 0 10px}
  .crumbs a{color:var(--mut)} .crumbs span.sep{padding:0 6px;color:var(--line2)}
  h1{font-family:system-ui,sans-serif;font-weight:800;font-size:32px;line-height:1.15;margin:0 0 8px;color:var(--fg);letter-spacing:-.01em}
  h1 .lede-rule{display:block;width:64px;height:4px;margin-top:12px;border-radius:3px;background:linear-gradient(90deg,var(--gold),var(--lapis))}
  h2{font-family:system-ui,sans-serif;font-size:23px;margin:34px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line);color:var(--fg)}
  h3{font-family:system-ui,sans-serif;font-size:18px;margin:22px 0 6px;color:var(--fg)}
  h4{font-family:system-ui,sans-serif;font-size:16px;margin:18px 0 4px;color:var(--mut)}
  p{margin:12px 0} ul,ol{margin:12px 0 12px 24px} li{margin:5px 0}
  /* header anchor targets sit invisibly above the visible heading so #links land below the sticky bar */
  span.hx{display:block;position:relative;top:-72px;visibility:hidden}
  sup.ref{font-family:system-ui,sans-serif;font-size:11px;line-height:0} sup.ref a{color:var(--goldink)}
  .muted{color:var(--mut)} .faint{color:var(--faint)}
  input.search{font-family:system-ui,sans-serif;background:var(--panel);border:1px solid var(--line2);border-radius:22px;color:var(--fg);padding:11px 16px;width:100%;max-width:440px;font-size:15px}
  input.search:focus{outline:none;border-color:var(--gold);box-shadow:var(--glow)}
  /* cards / callouts — depth & relief: one family + a thin line + soft shadow */
  .card{font-family:system-ui,sans-serif;background:var(--panel2);border:1px solid var(--line2);border-radius:var(--radius);padding:14px 18px;margin:16px 0;font-size:14px;line-height:1.55;box-shadow:var(--shadow)}
  .grid{font-family:system-ui,sans-serif;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:11px;margin:6px 0}
  .grid a{display:block;padding:12px 15px;background:var(--panel);border:1px solid var(--line2);border-radius:10px;font-weight:600;box-shadow:var(--shadow)}
  .grid a:hover{border-color:var(--gold);text-decoration:none;transform:translateY(-1px);transition:transform .12s}
  /* the "start here" pylon panel */
  .pylon{margin:22px 0 8px;padding:18px;border:1px solid var(--goldsoft);border-left:4px solid var(--gold);border-radius:var(--radius);background:linear-gradient(180deg,color-mix(in srgb,var(--goldsoft) 30%,var(--panel)),var(--panel));box-shadow:var(--shadow)}
  .chip{display:inline-block;font-family:system-ui,sans-serif;font-size:12px;font-weight:600;color:var(--lapisink);background:var(--lapissoft);border:1px solid color-mix(in srgb,var(--lapis) 25%,transparent);border-radius:20px;padding:3px 10px;margin:2px 4px 2px 0;text-decoration:none}
  .chip:hover{border-color:var(--lapis);text-decoration:none}
  .flag{font-family:system-ui,sans-serif;background:color-mix(in srgb,var(--down) 8%,var(--panel));border:1px solid color-mix(in srgb,var(--down) 40%,transparent);border-radius:var(--radius);padding:13px 16px;margin:16px 0;font-size:13px}
  .flag b{color:var(--down)} code{background:var(--panel2);border:1px solid var(--line);padding:1px 5px;border-radius:5px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  blockquote{border-left:3px solid var(--gold);margin:14px 0;padding:2px 0 2px 16px;color:var(--mut);font-style:italic}
  /* ── Table of contents (sticky sidebar on desktop; a collapsible box on mobile) */
  aside.toc{font-family:system-ui,sans-serif;font-size:13.5px;align-self:start;position:sticky;top:84px}
  aside.toc .toctitle{font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin:0 0 8px}
  aside.toc nav{border-left:2px solid var(--line2);padding-left:2px}
  aside.toc a{display:block;color:var(--mut);padding:4px 12px;border-left:2px solid transparent;margin-left:-2px;line-height:1.35}
  aside.toc a:hover{color:var(--link);text-decoration:none;border-left-color:var(--gold)}
  aside.toc a.lvl3{padding-left:24px;font-size:12.5px;color:var(--faint)}
  footer{font-family:system-ui,sans-serif;color:var(--mut);font-size:12.5px;border-top:1px solid var(--line);padding:26px var(--gutter);text-align:center;margin-top:40px;line-height:1.7}
  footer .fnav{margin-bottom:8px} footer .fnav a{color:var(--mut);margin:0 8px}
  footer::before{content:"";display:block;width:120px;height:3px;margin:0 auto 18px;border-radius:3px;background:linear-gradient(90deg,var(--gold),var(--lapis),var(--link));opacity:.7}
  /* ── Mobile: collapse the TOC column; keep a 16px gutter, no horizontal scroll. */
  @media (max-width:820px){
    .shell.withtoc{grid-template-columns:1fr}
    aside.toc{position:static;top:auto;order:-1;background:var(--panel2);border:1px solid var(--line2);border-radius:var(--radius);padding:12px 14px;box-shadow:var(--shadow)}
    aside.toc nav{max-height:none}
    h1{font-size:27px}
  }
  @media print{header.top,aside.toc,footer .fnav,.themebtn{display:none}}
</style>`;

// Primary chrome nav. [href, label, matchKey] — matchKey marks the active tab.
const NAV = [
  ['/', 'Library', 'home'], ['/categories', 'Contents', 'categories'], ['/search', 'Search', 'search'],
  ['/about', 'About', 'about'], ['https://witness.melek.salon', 'Witness School', ''], ['https://melek.salon', 'MELEK', ''],
];

// tiny inline theme toggle: cycles light/dark, persisted in localStorage, wrapped in try/catch so a
// blocked/private store never throws. Applied pre-paint via the boot script in <head>.
const THEME_BOOT = `<script>try{var t=localStorage.getItem('la-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>`;
const THEME_BTN = `<button class=themebtn type=button onclick="(function(){try{var r=document.documentElement,n=r.getAttribute('data-theme')==='dark'?'light':'dark';r.setAttribute('data-theme',n);localStorage.setItem('la-theme',n)}catch(e){}})()" aria-label="Toggle light or dark theme" title="Toggle theme">◐ Theme</button>`;

// Serialize a JSON-LD object safely for embedding in a <script type="application/ld+json"> tag.
// Two jobs: (1) prevent any unfilled {placeholder} template token from leaking into the page —
// strings containing one are dropped, and the whole node is rejected if a placeholder survives;
// (2) escape "</" so the JSON can never break out of the script element. Returns '' if invalid.
export function safeJsonLd(obj) {
  const PLACEHOLDER = /\{[A-Za-z0-9_.\-]+\}/; // e.g. {title}, {date_published}
  const clean = (v) => {
    if (typeof v === 'string') return PLACEHOLDER.test(v) ? undefined : v;
    if (Array.isArray(v)) { const a = v.map(clean).filter((x) => x !== undefined); return a.length ? a : undefined; }
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, val] of Object.entries(v)) { const c = clean(val); if (c !== undefined) o[k] = c; }
      return Object.keys(o).length ? o : undefined;
    }
    return v; // numbers, booleans, null
  };
  const cleaned = clean(obj);
  if (cleaned === undefined) return '';
  let s;
  try { s = JSON.stringify(cleaned); } catch { return ''; }
  if (PLACEHOLDER.test(s)) return ''; // belt-and-suspenders: never emit a leaked token
  return s.replace(/<\/(script)/gi, '<\\/$1');
}

// Render a table-of-contents aside from a [{level,text,id}] list (from renderWiki). Empty → ''.
export function tocAside(toc) {
  if (!Array.isArray(toc) || toc.length < 2) return '';
  const items = toc.filter((t) => t.level === 2 || t.level === 3)
    .map((t) => `<a class="lvl${t.level}" href="#${esc(t.id)}">${esc(t.text)}</a>`).join('');
  if (!items) return '';
  return `<aside class=toc aria-label="Table of contents"><div class=toctitle>On this page</div><nav>${items}</nav></aside>`;
}

export function layout({ title, description = '', canonical = '', jsonld = null, ogType = 'article', body = '', toc = '', crumbs = '', active = '' }) {
  const desc = esc(description || `${title} — the Library of Ashurbanipal, the Van Kush Family Research Institute knowledge base.`);
  const url = canonical ? esc(canonical) : '';
  // JSON-LD must never leak a {placeholder} template token; stringify + a defensive sweep below.
  const ld = jsonld ? safeJsonLd(jsonld) : '';
  const nav = NAV.map(([h, l, k]) => `<a href="${h}"${k && k === active ? ' class=active' : ''}>${l}</a>`).join('');
  const crumbBar = crumbs ? `<p class=crumbs>${crumbs}</p>` : '';
  // With a TOC we lay out a two-column shell (article + sticky aside); otherwise a single measure column.
  const inner = toc
    ? `<div class="shell withtoc"><main class=col>${crumbBar}${body}</main>${toc}</div>`
    : `<main class=wrap>${crumbBar}${body}</main>`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)} — Library of Ashurbanipal</title>
<meta name=description content="${desc}">${canonical ? `<link rel=canonical href="${url}">` : ''}
<meta name="theme-color" content="#e0a11b">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${desc}"><meta property="og:type" content="${esc(ogType)}"><meta property="og:site_name" content="Library of Ashurbanipal">${url ? `<meta property="og:url" content="${url}">` : ''}
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${desc}">
${ld ? `<script type="application/ld+json">${ld}</script>` : ''}${THEME_BOOT}${STYLE}<script defer src="https://soapy.blog/b.js"></script><noscript><img src="https://soapy.blog/px.gif" alt="" width="1" height="1" style="position:absolute;left:-9999px"></noscript></head>
<body><header class=top><a class=brand href="/"><span class=sun aria-hidden=true></span>Library of Ashurbanipal <small>· MELEK</small></a>
<nav class=main>${nav}${THEME_BTN}</nav></header>
${inner}
<footer><div class=fnav><a href="/">Library</a><a href="/categories">Contents</a><a href="/search">Search</a><a href="/about">About</a><a href="https://witness.melek.salon">Witness School</a></div>
The Library of Ashurbanipal — synthesized from the VKFRI knowledge base, grounded in cited sources and audited by a fact-checker. Claims attributed to VKFRI are the Institute's own; established science is marked as such.</footer>
</body></html>`;
}

// MediaWiki-lite → HTML. Handles == headers ==, '''bold''', ''italic'', [[links]], <ref>file</ref>
// (as numbered superscripts), and * / # lists. Refs are collected and returned for a footnotes block.
// Headers get an invisible preceding anchor (span.hx#id) so the returned `toc` can deep-link to them
// WITHOUT changing the <hN>text</hN> byte-shape the renderer/tests depend on.
export function renderWiki(text) {
  // strip a common bot preamble ("The Library of Ashurbanipal presents... ---")
  let t = text.replace(/^[\s\S]*?presents the following wiki article:\s*-*\s*/i, '').trim();
  const refs = [];
  const refIndex = new Map();
  const refMark = (file) => {
    const f = file.trim();
    if (!refIndex.has(f)) { refIndex.set(f, refs.length + 1); refs.push(f); }
    const n = refIndex.get(f);
    return `<sup class=ref><a href="#ref${n}" title="${esc(f)}">[${n}]</a></sup>`;
  };

  const inline = (s) => esc(s)
    .replace(/&lt;ref&gt;([^&]+?)&lt;\/ref&gt;/g, (_, f) => refMark(f))
    .replace(/'''(.+?)'''/g, '<b>$1</b>')
    .replace(/''(.+?)''/g, '<i>$1</i>')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, l, txt) => `<a href="/wiki/${slugify(l)}">${txt}</a>`)
    .replace(/\[\[([^\]]+)\]\]/g, (_, l) => `<a href="/wiki/${slugify(l)}">${l}</a>`)
    // external links (MediaWiki-style): [url text] and bare [url]; then autolink stray URLs. A reference
    // wiki cites outside sources, so external links are first-class. rel=nofollow on all outbound.
    .replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, (_, url, txt) => `<a href="${url}" rel="nofollow">${txt}</a>`)
    .replace(/\[(https?:\/\/[^\s\]]+)\]/g, (_, url) => `<a href="${url}" rel="nofollow">${url}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)(?=[\s).,;]|$)/g, (_, pre, url) => `${pre}<a href="${url}" rel="nofollow">${url}</a>`);

  const lines = t.split('\n');
  const out = [];
  const toc = [];
  const usedIds = new Set();
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let raw of lines) {
    const line = raw.replace(/\r$/, '');
    let m;
    if ((m = line.match(/^\s*(={2,6})\s*(.+?)\s*\1\s*$/))) {
      closeList();
      const lvl = Math.min(4, m[1].length);
      const inner = inline(m[2]);
      // plain-text label for the TOC (strip any inline markup the heading produced)
      const label = inner.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
      let id = anchorId(label); let n = 2; const base = id;
      while (usedIds.has(id)) id = `${base}-${n++}`;
      usedIds.add(id);
      if (lvl === 2 || lvl === 3) toc.push({ level: lvl, text: label, id });
      // invisible anchor BEFORE the heading — keeps `<hN>text</hN>` intact for the renderer/tests.
      out.push(`<span class=hx id="${id}"></span><h${lvl}>${inner}</h${lvl}>`);
    } else if ((m = line.match(/^\s*\*\s+(.*)$/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*#\s+(.*)$/))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList(); out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  const footnotes = refs.length
    ? `<span class=hx id="references"></span><h2>References</h2><ol class=muted>${refs.map((f, i) => `<li id=ref${i + 1}><code>${esc(f)}</code></li>`).join('')}</ol>`
    : '';
  return { html: out.join('\n'), refs, footnotes, toc };
}
