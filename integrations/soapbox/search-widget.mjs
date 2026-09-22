// search-widget.mjs — the drop-in "search us" snippet for Hathor's posts and announcements.
//
// Points people at search.soapbox.community. Two audiences, two formats:
//   - Steem/Hive posts + on-chain comments render BBCode/Markdown, NOT HTML forms → link snippets +
//     pre-scoped links (BBCode and Markdown).
//   - Web pages / announcements can embed a real search box → an HTML <form> that GETs the search
//     front door (plus pre-scoped variants, e.g. "search our legal corpus").
//
// Pure string builders. esc() on every interpolation. No network, no I/O, no import-time side effects.
// House style: ESM .mjs, soft-fail-never-throw, CLI guarded by the process.argv[1] check.
//
//   import { htmlBox, bbcodeLink, markdownLink, PRESETS, searchUrl } from './search-widget.mjs'

const DEFAULT_BASE = 'https://search.soapbox.community';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const clean = (base) => String(base || DEFAULT_BASE).replace(/\/+$/, '');

/**
 * Build a search URL for the front door. mode: 'site' (our sites) | 'web' (whole web). scope narrows
 * "our sites" to one surface (e.g. 'law') — the pre-scoped search. All params are URL-encoded.
 */
export function searchUrl({ q = '', mode = 'site', scope = null, base = DEFAULT_BASE } = {}) {
  const u = new URL(clean(base) + '/');
  if (q) u.searchParams.set('q', q);
  if (mode) u.searchParams.set('mode', mode === 'web' ? 'web' : 'site');
  if (scope) u.searchParams.set('scope', String(scope));
  return u.toString();
}

// Pre-scoped presets — the useful "search just X" doorways. Each is { key, label, scope, mode }.
export const PRESETS = [
  { key: 'all', label: 'Search everything we publish', scope: null, mode: 'site' },
  { key: 'law', label: 'Search our legal corpus', scope: 'law', mode: 'site' },
  { key: 'library', label: 'Search the Library (Ashurbanipal)', scope: 'wiki', mode: 'site' },
  { key: 'data', label: 'Search markets & data', scope: 'data', mode: 'site' },
  { key: 'stocks', label: 'Search stocks', scope: 'stocks', mode: 'site' },
  { key: 'hemp', label: 'Search the hemp/plant-medicine shelves', scope: 'hemp', mode: 'site' },
  { key: 'politics', label: 'Search politics & oversight', scope: 'politics', mode: 'site' },
  { key: 'web', label: 'Search the whole web (research-weighted)', scope: null, mode: 'web' },
];

export function preset(key) { return PRESETS.find((p) => p.key === key) || null; }

// ── BBCode (Steem/Hive posts, forums) ─────────────────────────────────────────────────────────────
/** A single BBCode link. `q`/`scope`/`mode` optional → deep-links a pre-run search. */
export function bbcodeLink({ text = 'Search everything on SoapBox', q = '', mode = 'site', scope = null, base } = {}) {
  return `[url=${esc(searchUrl({ q, mode, scope, base }))}]${esc(text)}[/url]`;
}

/** A BBCode block: a headline link + the pre-scoped doorways as a bullet list (BBCode has no forms). */
export function bbcodeBox({ base, presets = PRESETS, heading = 'Search the SoapBox ecosystem' } = {}) {
  const lines = [`[b]${esc(heading)}[/b]`, `[url=${esc(searchUrl({ base }))}]${esc(clean(base).replace(/^https?:\/\//, ''))}[/url]`, '[list]'];
  for (const p of presets) lines.push(`[*]${bbcodeLink({ text: p.label, mode: p.mode, scope: p.scope, base })}`);
  lines.push('[/list]');
  return lines.join('\n');
}

// ── Markdown (Steem/Hive posts render Markdown too; the condenser accepts either) ──────────────────
export function markdownLink({ text = 'Search everything on SoapBox', q = '', mode = 'site', scope = null, base } = {}) {
  // Markdown link text can't contain unescaped ] — esc() handles the HTML-ish chars; ] is rare in labels.
  return `[${esc(text)}](${esc(searchUrl({ q, mode, scope, base }))})`;
}

export function markdownBox({ base, presets = PRESETS, heading = 'Search the SoapBox ecosystem' } = {}) {
  const lines = [`**${esc(heading)}** — <${esc(searchUrl({ base }))}>`, ''];
  for (const p of presets) lines.push(`- ${markdownLink({ text: p.label, mode: p.mode, scope: p.scope, base })}`);
  return lines.join('\n');
}

// ── HTML (web pages, announcements, the /hathor status page, etc.) ────────────────────────────────
/** A plain HTML link. */
export function htmlLink({ text = 'Search SoapBox', q = '', mode = 'site', scope = null, base } = {}) {
  return `<a href="${esc(searchUrl({ q, mode, scope, base }))}">${esc(text)}</a>`;
}

/**
 * An embeddable HTML search BOX — a real <form> that GETs the search front door. Drop it into any
 * page. `scope` pre-scopes the box (a hidden field), `mode` picks web/site. Self-contained inline
 * styles so it needs no external CSS; every attribute value is escaped.
 */
export function htmlBox({ base, mode = 'site', scope = null, placeholder = 'Search the SoapBox ecosystem…', button = 'Search', label = '' } = {}) {
  const action = esc(clean(base) + '/');
  const hidden = [
    `<input type="hidden" name="mode" value="${esc(mode === 'web' ? 'web' : 'site')}">`,
    scope ? `<input type="hidden" name="scope" value="${esc(scope)}">` : '',
  ].join('');
  return `<form class="sbx-search" method="get" action="${action}" role="search"`
    + ` style="display:flex;gap:8px;max-width:560px;margin:12px 0;font:14px system-ui,sans-serif">`
    + (label ? `<label style="position:absolute;left:-9999px">${esc(label)}</label>` : '')
    + `<input type="search" name="q" placeholder="${esc(placeholder)}" aria-label="${esc(label || placeholder)}"`
    + ` style="flex:1;padding:10px 14px;border:1px solid #30363d;border-radius:20px;background:#0b0f14;color:#e6edf3;outline:none">`
    + hidden
    + `<button type="submit" style="padding:10px 18px;border:1px solid #30363d;border-radius:8px;background:#161b22;color:#e6edf3;font-weight:600;cursor:pointer">${esc(button)}</button>`
    + `</form>`;
}

// ── the all-in-one snippet a post author copies ───────────────────────────────────────────────────
/** Return every format at once — for a "copy the one you need" helper/announcement page. */
export function widgetKit({ base } = {}) {
  return {
    url: searchUrl({ base }),
    bbcodeLink: bbcodeLink({ base }),
    bbcodeBox: bbcodeBox({ base }),
    markdownLink: markdownLink({ base }),
    markdownBox: markdownBox({ base }),
    htmlLink: htmlLink({ base }),
    htmlBox: htmlBox({ base }),
    presets: PRESETS.map((p) => ({ ...p, url: searchUrl({ mode: p.mode, scope: p.scope, base }) })),
  };
}

// ── CLI — node integrations/soapbox/search-widget.mjs [bbcode|markdown|html|url] ────────────────────
if (process.argv[1] && process.argv[1].endsWith('search-widget.mjs')) {
  const what = process.argv[2] || 'all';
  const kit = widgetKit({});
  if (what === 'bbcode') console.log(kit.bbcodeBox);
  else if (what === 'markdown') console.log(kit.markdownBox);
  else if (what === 'html') console.log(kit.htmlBox + '\n' + kit.htmlLink);
  else if (what === 'url') console.log(kit.url);
  else {
    console.log('=== URL ===\n' + kit.url);
    console.log('\n=== BBCode (Steem/Hive posts, forums) ===\n' + kit.bbcodeBox);
    console.log('\n=== Markdown (posts) ===\n' + kit.markdownBox);
    console.log('\n=== HTML box (web pages) ===\n' + kit.htmlBox);
    console.log('\n=== Pre-scoped doorways ===');
    for (const p of kit.presets) console.log(`  ${p.label}\n      ${p.url}`);
  }
}
