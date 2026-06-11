// dry-run.mjs — Offline population PLAN for the MediaWiki path (Library of Ashurbanipal wiki).
//
// WHY: The live population path (library-of-ashurbanipal-bot WikiClient.editArticle / the Python
// populate_wiki.py Pywikibot save) is creds-gated and writes to the wiki. Before any live run we
// want to SEE the exact list of pages that WOULD be pushed — titles, the wikitext body, and whether
// each push is a create (page missing) or an update (page exists). This module computes that plan.
//
// PURE / OFFLINE: planPopulation(docs, opts) does NO network, reads NO creds, signs NOTHING. The only
// outside knowledge it needs — "does page X already exist, and what's its current text?" — comes in
// through an INJECTABLE reader seam (__setReader / opts.reader). With no reader, every doc is a
// 'create' (the safe assumption: nothing is known to exist).
//
// HOUSE STYLE: ESM .mjs; exported API; injectable seam (__setReader, also accepts opts.reader/fetch);
// SOFT-FAIL — never throws, a bad doc is skipped (and surfaced in `.skipped`), a bad reader is
// treated as "page unknown" → create; esc() escapes any HTML that ends up in a human-facing string;
// CLI guarded by process.argv[1].
//
// Exports:
//   planPopulation(docs, opts) -> { plan, skipped, summary }
//     plan    = [{ title, wikitext, action:'create'|'update', reason }]  (the list it WOULD push)
//     skipped = [{ doc, reason }]  (docs that could not be planned)
//     summary = { total, create, update, skipped }
//   renderDoc(doc)         -> { title, wikitext } | null   (title + wikitext from a doc, pure)
//   titleToSlug(title)     -> the generated-articles slug (matches wikiGenerator.js)
//   esc(s)                 -> HTML-escaped string
//   __setReader(fn)        -> inject the existence/content reader (test seam)
//   __setFetch(fn)         -> alias kept for the house __setFetch convention (wraps a reader)

// ── HTML escape (house esc()) ──────────────────────────────────────────────────────────────────
/**
 * Escape the five HTML-significant characters. Used on anything that lands in a human-facing
 * string (CLI preview, summaries). Soft: null/undefined/number all coerce safely.
 * @param {*} s
 * @returns {string}
 */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Injectable reader seam ───────────────────────────────────────────────────────────────────────
// A reader answers: "for this title, does the page exist and what is its current wikitext?"
// Shape (any of these is accepted, all OPTIONAL — soft):
//   reader(title) -> {
//      exists?: boolean,            // explicit existence flag
//      content?: string | null,    // current wikitext (null/'' ⇒ treat as missing unless exists:true)
//   }
//   reader(title) -> string|null    // shorthand: current content (string ⇒ exists, null/'' ⇒ missing)
//   reader(title) -> boolean        // shorthand: existence only
// A reader that throws / returns undefined ⇒ "unknown" ⇒ planned as 'create' (safe default).
let _reader = null;

/**
 * Inject the page-existence reader. Pass null to clear (back to no-reader = everything is 'create').
 * @param {Function|null} fn
 */
export function __setReader(fn) {
  _reader = typeof fn === 'function' ? fn : null;
}

/**
 * House __setFetch convention. The live MediaWiki existence check would be a fetch against the API;
 * offline we model it as a reader. Accepts either a plain reader fn OR is left for callers who want
 * to name the seam "fetch". Here it simply aliases __setReader.
 * @param {Function|null} fn
 */
export function __setFetch(fn) {
  __setReader(fn);
}

/**
 * Normalise whatever a reader returned into { exists, content }.
 * @param {*} res
 * @returns {{ exists: boolean, content: string|null }}
 */
function normaliseReaderResult(res) {
  if (res == null) return { exists: false, content: null };
  if (typeof res === 'boolean') return { exists: res, content: null };
  if (typeof res === 'string') return { exists: res.trim() !== '', content: res };
  if (typeof res === 'object') {
    const content = typeof res.content === 'string' ? res.content : null;
    let exists;
    if (typeof res.exists === 'boolean') exists = res.exists;
    else exists = content != null && content.trim() !== '';
    return { exists, content };
  }
  return { exists: false, content: null };
}

// ── Title / slug helpers ───────────────────────────────────────────────────────────────────────
/**
 * Convert an article title to the generated-articles slug — MUST match wikiGenerator.js:
 *   const slug = articleDef.title.replace(/[^a-zA-Z0-9]/g, '_');
 * @param {string} title
 * @returns {string}
 */
export function titleToSlug(title) {
  return String(title == null ? '' : title).replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Derive a wiki title from a doc. Mirrors the two upstream conventions:
 *   - the JS generator carries an explicit `title`
 *   - the Python populate_wiki.py derives it from a filename: strip .json, '_'→' ', Title Case
 * @param {object} doc
 * @returns {string|null}
 */
function deriveTitle(doc) {
  if (doc && typeof doc.title === 'string' && doc.title.trim() !== '') return doc.title.trim();
  // Python populate_wiki.py json_to_title(): filename.json -> "Title Case"
  const fn = doc && (doc.filename || doc.file || doc.path);
  if (typeof fn === 'string' && fn.trim() !== '') {
    const base = fn.split('/').pop().replace(/\.json$/i, '').replace(/_/g, ' ').trim();
    if (base) {
      // simple Title Case (Python str.title())
      return base.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return null;
}

/**
 * Extract the wikitext body from a doc. Accepts the field names the upstream paths use:
 *   - `wikitext` (this module's preferred field)
 *   - `content` / `body` (wikiGenerator.js article shape; populate_wiki publishes `content`)
 * Returns null if no usable string body is present.
 * @param {object} doc
 * @returns {string|null}
 */
function deriveWikitext(doc) {
  if (!doc || typeof doc !== 'object') return null;
  for (const key of ['wikitext', 'content', 'body', 'text']) {
    const v = doc[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

/**
 * renderDoc(doc) -> { title, wikitext } | null
 * Pure. Uses the existing rendering when the doc already carries wikitext/content (the generator and
 * the Python path both emit ready wikitext); if a custom `render(doc)->string` is supplied on the doc
 * we honour it. Returns null when title or body cannot be determined (caller records it as skipped).
 * @param {object} doc
 * @returns {{title:string, wikitext:string}|null}
 */
export function renderDoc(doc) {
  try {
    if (!doc || typeof doc !== 'object') return null;
    const title = deriveTitle(doc);
    if (!title) return null;

    let wikitext = null;
    // Per-doc custom renderer (lets a caller plug the live wikitext renderer without coupling here).
    if (typeof doc.render === 'function') {
      try {
        const r = doc.render(doc);
        if (typeof r === 'string' && r.trim() !== '') wikitext = r;
      } catch { /* fall through to field extraction */ }
    }
    if (wikitext == null) wikitext = deriveWikitext(doc);
    if (wikitext == null) return null;

    return { title, wikitext };
  } catch {
    return null;
  }
}

/**
 * planPopulation(docs, opts) -> { plan, skipped, summary }
 *
 * The list of pages the live populator WOULD push, computed offline. No network, no creds.
 *
 * @param {Array<object>} docs   each: { title? , filename? , wikitext?|content?|body? , render? }
 * @param {object} [opts]
 * @param {Function} [opts.reader]  existence reader (overrides the module-level __setReader for this call)
 * @param {Function} [opts.fetch]   alias for opts.reader
 * @param {boolean}  [opts.skipUnchanged=false]  when an update's new wikitext === current, mark action
 *                                                'update' but reason 'unchanged' (still listed). When
 *                                                true, such docs are moved to `skipped` instead.
 * @returns {{ plan: Array, skipped: Array, summary: object }}
 */
export function planPopulation(docs, opts = {}) {
  const plan = [];
  const skipped = [];
  const reader = typeof opts.reader === 'function' ? opts.reader
    : typeof opts.fetch === 'function' ? opts.fetch
    : _reader;
  const skipUnchanged = opts.skipUnchanged === true;

  const list = Array.isArray(docs) ? docs : (docs == null ? [] : [docs]);

  for (const doc of list) {
    const rendered = renderDoc(doc);
    if (!rendered) {
      skipped.push({ doc, reason: 'no usable title or wikitext' });
      continue;
    }
    const { title, wikitext } = rendered;

    // Determine existence via the (soft) reader. Any failure ⇒ unknown ⇒ create.
    let exists = false;
    let current = null;
    if (reader) {
      try {
        const norm = normaliseReaderResult(reader(title));
        exists = norm.exists;
        current = norm.content;
      } catch {
        exists = false;
        current = null;
      }
    }

    if (!exists) {
      plan.push({ title, wikitext, action: 'create', reason: 'page does not exist' });
      continue;
    }

    // Page exists ⇒ update. Detect a no-op (same text) for visibility / optional skipping.
    const unchanged = current != null && current === wikitext;
    if (unchanged && skipUnchanged) {
      skipped.push({ doc, reason: 'unchanged (current wikitext matches)' });
      continue;
    }
    plan.push({
      title,
      wikitext,
      action: 'update',
      reason: unchanged ? 'page exists, content unchanged' : 'page exists, content differs',
    });
  }

  const summary = {
    total: list.length,
    create: plan.filter((p) => p.action === 'create').length,
    update: plan.filter((p) => p.action === 'update').length,
    skipped: skipped.length,
  };

  return { plan, skipped, summary };
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
// Prints a human-readable plan. Offline by default: with no reader, every doc is a 'create'.
// Usage: node dry-run.mjs <docs.json>   where docs.json is an array of {title, wikitext|content}.
import { fileURLToPath } from 'node:url';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.log('Usage: node dry-run.mjs <docs.json>');
    console.log('  docs.json = array of { title, wikitext|content } objects.');
    console.log('  Offline plan only — no network, no wiki creds, nothing is pushed.');
    return;
  }
  let docs = [];
  try {
    const { readFile } = await import('node:fs/promises');
    docs = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    console.error('Could not read docs file:', esc(e.message));
    return;
  }
  const { plan, skipped, summary } = planPopulation(docs);
  console.log('=== MediaWiki population DRY RUN (offline; nothing pushed) ===');
  for (const p of plan) {
    const preview = esc(String(p.wikitext).slice(0, 80)).replace(/\n/g, ' ');
    console.log(`  [${p.action.toUpperCase()}] ${esc(p.title)}  — ${esc(p.reason)}`);
    console.log(`      ${preview}${p.wikitext.length > 80 ? '…' : ''}`);
  }
  for (const s of skipped) {
    console.log(`  [SKIP] ${esc(s.reason)}`);
  }
  console.log(
    `\nPlan: ${summary.total} doc(s) → ${summary.create} create, ${summary.update} update, ${summary.skipped} skipped.`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => console.error(esc(e && e.message)));
}

export default { planPopulation, renderDoc, titleToSlug, esc, __setReader, __setFetch };
