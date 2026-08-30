// render.mjs — the Library of Ashurbanipal wiki surface. A small MediaWiki-lite → HTML renderer +
// the shared wiki layout (brand, sidebar, article column, footer). Pure functions (text in → HTML
// out). Articles are produced by the (faithful) Ashurbanipal bot with == Sources == + == Coverage ==
// sections and <ref>file</ref> citations; this renders them honestly — provenance and coverage are
// shown, never hidden.
//
// Aesthetic: a desert / ancient-library base (sand, sandstone, ochre) with the bright mineral dyes of
// antiquity for accents (Egyptian blue / lapis, Tyrian purple, malachite, ochre red, gold leaf) and a
// restrained retro-future / vaporwave header. Fully theme-aware: a complete light palette on :root,
// overridden under @media (prefers-color-scheme: dark) and :root[data-theme="dark"].

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const slugify = (s) => String(s).trim().replace(/\.wiki$/, '').replace(/[\s_]+/g, '_').replace(/[^A-Za-z0-9_:-]/g, '');
export const titleize = (slug) => String(slug).replace(/_/g, ' ');

const STYLE = `<style>
  /* ── Palette. Light = desert library; dark = night-desert / lapis dusk. Every color is defined here
     on :root; the dark blocks below only re-point the same tokens (never a color defined only in a
     media block). Accents are the mineral dyes of antiquity. ── */
  :root{
    --sand:#f4ecd8;         /* papyrus page ground */
    --panel:#fbf7ea;        /* article / card panel */
    --side:#efe3c8;         /* sidebar sandstone */
    --line:#e2d5b4;         /* hairline */
    --line2:#d1bd90;        /* stronger rule */
    --fg:#2c2416;           /* dark umber ink */
    --mut:#6d5f45;          /* muted ink */
    --lapis:#12379e;        /* Egyptian blue / lapis — links */
    --lapis-lt:#4e7ebf;
    --tyrian:#6d0a3d;       /* Tyrian purple — headings */
    --tyrian-lt:#8e4585;
    --malachite:#0b6e4f;    /* malachite green */
    --ochre:#b3541e;        /* ochre red / terracotta */
    --gold:#c19a3e;         /* gold leaf */
    --goldink:#8f6c1e;
    --down:#b23a2e;
    /* vaporwave header dyes (used sparingly) */
    --neon-pink:#ff5db1; --neon-cyan:#2bd6d6; --neon-purple:#8a5cff;
    --link:var(--lapis); --head:var(--tyrian);
    --glow:rgba(138,92,255,.35);
  }
  @media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
    --sand:#151021; --panel:#1d1730; --side:#221a38; --line:#33294c; --line2:#463a63;
    --fg:#ede3cf; --mut:#b6a684;
    --lapis:#8ab4ff; --lapis-lt:#6f97e6; --tyrian:#e0a6d6; --tyrian-lt:#c98fc0;
    --malachite:#4fd6a3; --ochre:#e08a52; --gold:#e3c46b; --goldink:#e3c46b; --down:#ff8a7a;
    --neon-pink:#ff7ac2; --neon-cyan:#4fe6e6; --neon-purple:#a684ff;
    --link:var(--lapis); --head:var(--tyrian); --glow:rgba(166,132,255,.5);
  }}
  :root[data-theme="dark"]{
    --sand:#151021; --panel:#1d1730; --side:#221a38; --line:#33294c; --line2:#463a63;
    --fg:#ede3cf; --mut:#b6a684;
    --lapis:#8ab4ff; --lapis-lt:#6f97e6; --tyrian:#e0a6d6; --tyrian-lt:#c98fc0;
    --malachite:#4fd6a3; --ochre:#e08a52; --gold:#e3c46b; --goldink:#e3c46b; --down:#ff8a7a;
    --neon-pink:#ff7ac2; --neon-cyan:#4fe6e6; --neon-purple:#a684ff;
    --link:var(--lapis); --head:var(--tyrian); --glow:rgba(166,132,255,.5);
  }

  *{box-sizing:border-box}
  html,body{max-width:100%;overflow-x:hidden}
  body{font:16px/1.7 Georgia,'Iowan Old Style','Times New Roman',serif;margin:0;background:var(--sand);color:var(--fg);
    background-image:radial-gradient(circle at 12% -10%,rgba(138,92,255,.05),transparent 40%),radial-gradient(circle at 100% 0,rgba(43,214,214,.05),transparent 35%)}
  a{color:var(--link);text-decoration:none} a:hover{text-decoration:underline}
  img{max-width:100%;height:auto} code{background:color-mix(in srgb,var(--line) 55%,transparent);padding:1px 5px;border-radius:4px;font-size:.86em}
  pre,table{overflow-x:auto;max-width:100%}

  /* ── Header: a retro-future sun band with a faint scanline weave. ── */
  header.top{font-family:'Iosevka',ui-monospace,system-ui,sans-serif;position:relative;overflow:hidden;
    background:linear-gradient(120deg,var(--tyrian) 0%,#3a1c66 42%,var(--lapis) 100%);
    color:#fdf6e6;border-bottom:2px solid var(--gold);padding:12px 20px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  header.top::after{content:"";position:absolute;inset:0;pointer-events:none;
    background:repeating-linear-gradient(0deg,rgba(255,255,255,.05) 0 1px,transparent 1px 4px);opacity:.5}
  header.top > *{position:relative;z-index:1}
  .alpha{font-family:ui-monospace,monospace;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
    color:#151021;background:linear-gradient(90deg,var(--neon-cyan),var(--neon-pink));padding:3px 8px;border-radius:999px;
    box-shadow:0 0 10px var(--glow)}
  .brand{font-family:Georgia,serif;font-weight:800;font-size:19px;color:#fdf6e6;display:flex;align-items:center;gap:9px;
    text-shadow:0 0 14px var(--glow)} .brand small{color:#f3d98a;font-weight:400;font-size:12px;letter-spacing:.04em}
  .brand .sun{width:26px;height:26px;border-radius:50%;flex:0 0 auto;
    background:radial-gradient(circle at 50% 45%,#ffe9a8 0 26%,var(--gold) 28% 44%,var(--ochre) 46% 62%,var(--tyrian-lt) 64% 100%);
    box-shadow:0 0 0 1px rgba(0,0,0,.25),0 0 16px var(--neon-pink)}
  nav.top{display:flex;gap:14px;margin-left:auto;flex-wrap:wrap}
  nav.top a{color:#f6ecd6;font-weight:600;font-size:13px;font-family:system-ui,sans-serif} nav.top a:hover{color:#fff}
  .navtoggle{display:none} .navbtn{display:none}

  /* ── Two-column wiki shell. ── */
  .shell{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:minmax(0,232px) minmax(0,1fr);gap:0}
  aside.side{background:var(--side);border-right:1px solid var(--line2);padding:18px 16px 40px;
    font-family:system-ui,sans-serif;font-size:14px;min-width:0}
  aside.side .box{background:color-mix(in srgb,var(--panel) 70%,transparent);border:1px solid var(--line);border-radius:10px;padding:12px;margin:0 0 16px}
  aside.side h4{margin:0 0 8px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--goldink)}
  aside.side ul{list-style:none;margin:0;padding:0} aside.side li{margin:3px 0}
  aside.side a{color:var(--fg);display:block;padding:3px 7px;border-radius:6px;border-left:2px solid transparent}
  aside.side a:hover{background:color-mix(in srgb,var(--lapis) 12%,transparent);border-left-color:var(--lapis);text-decoration:none}
  aside.side .toc a{color:var(--mut);font-size:13px} aside.side .toc a.h3{padding-left:18px;font-size:12px}
  input.search{font-family:system-ui,sans-serif;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);
    padding:8px 11px;width:100%;font-size:14px}
  input.search:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px color-mix(in srgb,var(--gold) 28%,transparent)}

  main.wrap{padding:24px 30px 40px;min-width:0}
  h1{font-family:Georgia,serif;font-size:31px;line-height:1.2;margin:0 0 4px;color:var(--head)}
  h1 .sub{display:block;font-size:13px;font-weight:400;color:var(--mut);font-family:system-ui,sans-serif;margin-top:4px}
  h2{font-size:23px;margin:28px 0 8px;color:var(--head);border-bottom:2px solid var(--line2);padding-bottom:5px}
  h3{font-size:18px;margin:18px 0 6px;color:var(--tyrian-lt)}
  h2:target,h3:target{scroll-margin-top:14px}
  p{margin:11px 0} ul,ol{margin:10px 0 10px 22px} li{margin:4px 0}
  blockquote{border-left:3px solid var(--gold);margin:12px 0;padding:2px 0 2px 14px;color:var(--mut);font-style:italic}
  sup.ref{font-family:system-ui,sans-serif;font-size:11px} sup.ref a{color:var(--ochre)}

  /* ── Infobox / fact card (right rail inside the article). ── */
  .infobox{float:right;width:280px;max-width:100%;margin:4px 0 18px 22px;font-family:system-ui,sans-serif;font-size:13px;
    background:var(--panel);border:1px solid var(--line2);border-top:4px solid var(--tyrian);border-radius:10px;overflow:hidden;
    box-shadow:0 1px 0 var(--gold)}
  .infobox .ib-h{background:linear-gradient(90deg,color-mix(in srgb,var(--tyrian) 16%,transparent),transparent);
    padding:10px 13px;font-family:Georgia,serif;font-weight:700;font-size:15px;color:var(--head);border-bottom:1px solid var(--line)}
  .infobox dl{margin:0;padding:6px 13px 12px} .infobox dt{color:var(--goldink);font-size:11px;letter-spacing:.05em;text-transform:uppercase;margin-top:9px}
  .infobox dd{margin:1px 0 0} .infobox .badge{display:inline-block;font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;
    background:color-mix(in srgb,var(--malachite) 20%,transparent);color:var(--malachite)} .infobox .badge.soon{background:color-mix(in srgb,var(--ochre) 20%,transparent);color:var(--ochre)}

  /* ── Category chips. ── */
  .chips{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0;font-family:system-ui,sans-serif}
  .chip{font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;border:1px solid var(--line2);color:var(--fg);
    background:color-mix(in srgb,var(--gold) 12%,transparent)} .chip:hover{text-decoration:none;border-color:var(--gold)}
  .chip.c0{background:color-mix(in srgb,var(--lapis) 15%,transparent);color:var(--lapis)}
  .chip.c1{background:color-mix(in srgb,var(--tyrian) 15%,transparent);color:var(--tyrian)}
  .chip.c2{background:color-mix(in srgb,var(--malachite) 16%,transparent);color:var(--malachite)}
  .chip.c3{background:color-mix(in srgb,var(--ochre) 16%,transparent);color:var(--ochre)}
  .chip.c4{background:color-mix(in srgb,var(--goldink) 16%,transparent);color:var(--goldink)}
  .chip.c5{background:color-mix(in srgb,var(--neon-purple) 16%,transparent);color:var(--neon-purple)}

  /* ── Index landing. ── */
  .hero{background:linear-gradient(120deg,color-mix(in srgb,var(--tyrian) 12%,var(--panel)),color-mix(in srgb,var(--lapis) 12%,var(--panel)));
    border:1px solid var(--line2);border-radius:14px;padding:20px 22px;margin:0 0 22px}
  .starter{border:1px solid var(--line2);border-radius:12px;padding:16px 18px;margin:0 0 20px;background:var(--panel)}
  .starter h2{margin:0 0 4px;border:0;padding:0}
  .cat{margin:26px 0} .cat h2{display:flex;align-items:center;gap:10px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;font-family:system-ui,sans-serif}
  .grid a{display:block;padding:10px 13px;background:var(--panel);border:1px solid var(--line2);border-radius:9px;font-weight:600}
  .grid a:hover{border-color:var(--lapis);text-decoration:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--lapis) 14%,transparent)}
  .card{font-family:system-ui,sans-serif;background:var(--panel);border:1px solid var(--line2);border-radius:9px;padding:12px 16px;margin:12px 0}
  .muted{color:var(--mut)}
  .flag{font-family:system-ui,sans-serif;background:color-mix(in srgb,var(--down) 10%,transparent);border:1px solid color-mix(in srgb,var(--down) 40%,transparent);
    border-radius:9px;padding:12px 16px;margin:14px 0;font-size:13px} .flag b{color:var(--down)}

  footer{font-family:system-ui,sans-serif;color:var(--mut);font-size:12px;border-top:1px solid var(--line2);
    padding:22px;text-align:center;background:var(--side)}

  @media (max-width:860px){
    .shell{grid-template-columns:1fr}
    aside.side{border-right:0;border-bottom:1px solid var(--line2);display:none;padding-bottom:18px}
    .navtoggle:checked ~ .shell aside.side{display:block}
    .navbtn{display:inline-flex;align-items:center;gap:6px;margin-left:auto;background:rgba(0,0,0,.18);color:#fdf6e6;
      border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;font-family:system-ui,sans-serif}
    nav.top{margin-left:0;width:100%;order:3}
    .infobox{float:none;width:100%;margin:12px 0}
    main.wrap{padding:20px 18px 36px}
  }
</style>`;

const NAV = [['/', 'Library'], ['/search', 'Search'], ['/about', 'About'], ['https://witness.melek.salon', 'Witness School'], ['https://melek.salon', 'MELEK']];

// The sidebar's standing navigation — the newcomer's map, always present on every page.
const SIDE_NAV = [
  ['Start here', [['MELEK', 'MELEK'], ['PRANA', 'PRANA'], ['KULA', 'KULA'], ['SoapBox', 'SoapBox'], ['Hathor', 'Hathor']]],
  ['Learn the chain', [['Mining', 'Mining'], ['The_Graphene_Family', 'The Graphene Family'], ['Crypto_Glossary', 'Crypto Glossary']]],
];

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

// Build a sidebar table-of-contents from rendered article HTML (the <h2 id>/<h3 id> anchors that
// renderWiki emits). Returns '' when an article has no sections.
export function buildToc(html) {
  const items = [];
  const re = /<h([23])\s+id="([^"]+)">(.*?)<\/h\1>/g;
  let m;
  while ((m = re.exec(html))) {
    const text = m[3].replace(/<[^>]+>/g, '').trim();
    if (text) items.push({ lvl: m[1], id: m[2], text });
  }
  if (items.length < 2) return '';
  return `<nav class=toc><ul>${items.map((i) => `<li><a class="${i.lvl === '3' ? 'h3' : ''}" href="#${esc(i.id)}">${esc(i.text)}</a></li>`).join('')}</ul></nav>`;
}

function sidebar(toc = '') {
  const nav = SIDE_NAV.map(([h, links]) => `<div class=box><h4>${esc(h)}</h4><ul>${links.map(([slug, label]) => `<li><a href="/wiki/${esc(slug)}">${esc(label)}</a></li>`).join('')}</ul></div>`).join('');
  const tocBox = toc ? `<div class=box><h4>On this page</h4>${toc}</div>` : '';
  return `<aside class=side>
    <div class=box><form action="/search" method=get><input class=search name=q placeholder="Search Ashurbanipal…" autocomplete=off aria-label="Search the Library"></form></div>
    ${tocBox}${nav}
    <div class=box><h4>This wiki</h4><ul><li><a href="/">Library index</a></li><li><a href="/search">Search</a></li><li><a href="/about">About</a></li></ul></div>
  </aside>`;
}

export function layout({ title, description = '', canonical = '', jsonld = null, ogType = 'article', body = '', toc = '' }) {
  const desc = esc(description || `${title} — the Library of Ashurbanipal, the Van Kush Family Research Institute knowledge base.`);
  const url = canonical ? esc(canonical) : '';
  // JSON-LD must never leak a {placeholder} template token; stringify + a defensive sweep below.
  const ld = jsonld ? safeJsonLd(jsonld) : '';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)} — Library of Ashurbanipal</title>
<meta name=description content="${desc}">${canonical ? `<link rel=canonical href="${url}">` : ''}
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${desc}"><meta property="og:type" content="${esc(ogType)}"><meta property="og:site_name" content="Library of Ashurbanipal">${url ? `<meta property="og:url" content="${url}">` : ''}
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${desc}">
${ld ? `<script type="application/ld+json">${ld}</script>` : ''}${STYLE}</head>
<body><input type=checkbox id=navtoggle class=navtoggle aria-hidden=true>
<header class=top><span class=alpha>Alpha</span>
<a class=brand href="/"><span class=sun aria-hidden=true></span>Library of Ashurbanipal <small>· MELEK</small></a>
<label class=navbtn for=navtoggle>☰ Menu</label>
<nav class=top>${NAV.map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}</nav></header>
<div class=shell>${sidebar(toc)}<main class=wrap>${body}</main></div>
<footer>The Library of Ashurbanipal — synthesized from the VKFRI knowledge base, grounded in cited sources and audited by a fact-checker. Claims attributed to VKFRI are the Institute's own; established science is marked as such.</footer>
</body></html>`;
}

// MediaWiki-lite → HTML. Handles == headers == (with slugged anchor ids for the TOC), '''bold''',
// ''italic'', [[links]], <ref>file</ref> (as numbered superscripts), and * / # lists. Refs are
// collected and returned for a footnotes block.
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
  const seen = new Map();
  const headId = (raw) => {
    let base = slugify(raw.replace(/'''?|''/g, '')) || 'section';
    let id = base, n = 1;
    while (seen.has(id)) { id = `${base}-${++n}`; }
    seen.set(id, 1);
    return id;
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
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let raw of lines) {
    const line = raw.replace(/\r$/, '');
    let m;
    if ((m = line.match(/^\s*(={2,6})\s*(.+?)\s*\1\s*$/))) {
      closeList(); const lvl = Math.min(4, m[1].length); out.push(`<h${lvl} id="${headId(m[2])}">${inline(m[2])}</h${lvl}>`);
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
    ? `<h2 id=references>References</h2><ol class=muted>${refs.map((f, i) => `<li id=ref${i + 1}><code>${esc(f)}</code></li>`).join('')}</ol>`
    : '';
  return { html: out.join('\n'), refs, footnotes };
}
