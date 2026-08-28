// render.mjs — the Library of Ashurbanipal wiki surface. A small MediaWiki-lite → HTML renderer +
// the shared layout. Pure functions (text in → HTML out). The articles are produced by the
// (faithful) Ashurbanipal bot with == Sources == + == Coverage == sections and <ref>file</ref>
// citations; this renders them honestly — provenance and coverage are shown, never hidden.

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const slugify = (s) => String(s).trim().replace(/\.wiki$/, '').replace(/[\s_]+/g, '_').replace(/[^A-Za-z0-9_:-]/g, '');
export const titleize = (slug) => String(slug).replace(/_/g, ' ');

const STYLE = `<style>
  /* Condenser look: light theme, MELEK orange (#e5a21b) + Kurdish-sun green (#117a37). */
  :root{--bg:#f5f6f8;--panel:#ffffff;--line:#e6e9ee;--line2:#dbe0e6;--fg:#1c2126;--mut:#5c6670;--link:#117a37;--gold:#e5a21b;--goldink:#a8730c;--up:#117a37;--down:#c0392b}
  *{box-sizing:border-box} body{font:16px/1.7 Georgia,'Times New Roman',serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--link);text-decoration:none} a:hover{text-decoration:underline}
  header.top{font-family:system-ui,sans-serif;background:var(--panel);border-bottom:1px solid var(--line2);padding:12px 22px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
  .brand{font-weight:800;font-size:18px;color:var(--fg);display:flex;align-items:center;gap:8px} .brand span{color:var(--goldink);font-weight:400;font-size:13px}
  .brand .sun{width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 50% 50%,#e5a21b 0 32%,#c0392b 34% 50%,#117a37 52% 100%);flex:0 0 auto;box-shadow:0 0 0 1px rgba(0,0,0,.06)}
  nav{display:flex;gap:16px;font-family:system-ui,sans-serif;margin-left:auto} nav a{color:var(--mut);font-weight:600;font-size:14px} nav a:hover{color:var(--link);text-decoration:none}
  .wrap{max-width:820px;margin:0 auto;padding:26px 22px}
  h1{font-size:30px;margin:0 0 6px;color:var(--fg)} h2{font-size:22px;margin:26px 0 8px;border-bottom:1px solid var(--line);padding-bottom:5px} h3{font-size:18px;margin:18px 0 6px}
  p{margin:10px 0} ul,ol{margin:10px 0 10px 22px} li{margin:4px 0}
  sup.ref{font-family:system-ui,sans-serif;font-size:11px} sup.ref a{color:var(--goldink)}
  .card{font-family:system-ui,sans-serif;background:#fbfcfd;border:1px solid var(--line2);border-radius:8px;padding:14px 18px;margin:16px 0;font-size:14px;line-height:1.5}
  .muted{color:var(--mut)} input.search{font-family:system-ui;background:#fff;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:9px 13px;width:100%;max-width:420px;font-size:14px}
  input.search:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(229,162,27,.15)}
  .grid{font-family:system-ui,sans-serif;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
  .grid a{display:block;padding:11px 14px;background:#fff;border:1px solid var(--line2);border-radius:8px;font-weight:600} .grid a:hover{border-color:var(--gold);text-decoration:none}
  .flag{font-family:system-ui,sans-serif;background:#c0392b12;border:1px solid #c0392b44;border-radius:8px;padding:12px 16px;margin:14px 0;font-size:13px}
  .flag b{color:var(--down)} code{background:#eef1f4;padding:1px 5px;border-radius:4px;font-size:13px}
  footer{font-family:system-ui,sans-serif;color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding:26px 22px;text-align:center;margin-top:30px}
  blockquote{border-left:3px solid var(--gold);margin:10px 0;padding-left:14px;color:var(--mut)}
</style>`;

const NAV = [['/', 'Library'], ['/search', 'Search'], ['/about', 'About'], ['https://witness.melek.salon', 'Witness School'], ['https://melek.salon', 'MELEK']];

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

export function layout({ title, description = '', canonical = '', jsonld = null, ogType = 'article', body = '' }) {
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
<body><header class=top><a class=brand href="/"><span class=sun aria-hidden=true></span>Library of Ashurbanipal <span>· MELEK</span></a>
<nav>${NAV.map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}</nav></header>
<main class=wrap>${body}</main>
<footer>The Library of Ashurbanipal — synthesized from the VKFRI knowledge base, grounded in cited sources and audited by a fact-checker. Claims attributed to VKFRI are the Institute's own; established science is marked as such.</footer>
</body></html>`;
}

// MediaWiki-lite → HTML. Handles == headers ==, '''bold''', ''italic'', [[links]], <ref>file</ref>
// (as numbered superscripts), and * / # lists. Refs are collected and returned for a footnotes block.
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
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let raw of lines) {
    const line = raw.replace(/\r$/, '');
    let m;
    if ((m = line.match(/^\s*(={2,6})\s*(.+?)\s*\1\s*$/))) {
      closeList(); const lvl = Math.min(4, m[1].length); out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
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
    ? `<h2>References</h2><ol class=muted>${refs.map((f, i) => `<li id=ref${i + 1}><code>${esc(f)}</code></li>`).join('')}</ol>`
    : '';
  return { html: out.join('\n'), refs, footnotes };
}
