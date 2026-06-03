// docconvert.mjs — document-conversion engine for SoapBox (queue #140). Thin adapters to four
// self-hosted, keyless conversion engines, each reached by a configurable base URL:
//
//   Gotenberg    (GOTENBERG_URL)  — Office / 100+ formats → PDF, plus PDF merge/split. LibreOffice + Chromium under the hood.
//   Stirling-PDF (STIRLING_URL)   — PDF-native toolbox: OCR, compress, rotate, page ops, PDF→Office.
//   Tika         (TIKA_URL)       — Apache Tika text/metadata extraction from almost anything.
//   Pandoc       (PANDOC_URL)     — markup ↔ markup (markdown / html / rst / latex / docx / epub …).
//
// All engines are self-hosted (no API keys, ever) and SOFT-FAIL: if the relevant *_URL env var is
// unset we throw a clear, catchable error rather than calling a phantom host. The public surface is
// toPdf / extractText / convert (network) plus a PURE supports()/honestCaveat() capability map that
// callers can consult with zero I/O.
//
// Honesty note (sold as such on the site): DOC/DOCX/Office → PDF via Gotenberg/LibreOffice is
// rock-solid, high-fidelity — layout, fonts, tables come through. The reverse, PDF → editable DOCX,
// is fundamentally reconstruction: it reflows fine for simple text PDFs but DEGRADES on complex
// layouts (multi-column, heavy tables, scanned pages). We surface that as "best-effort reflow" and
// never promise pixel parity going back into an editable document.

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ---------------------------------------------------------------------------
// Engine config — base URL per engine, soft-failing when unset.
// ---------------------------------------------------------------------------
export const ENGINES = {
  gotenberg: { env: 'GOTENBERG_URL', label: 'Gotenberg' },
  stirling: { env: 'STIRLING_URL', label: 'Stirling-PDF' },
  tika: { env: 'TIKA_URL', label: 'Apache Tika' },
  pandoc: { env: 'PANDOC_URL', label: 'Pandoc' },
};

/** Resolve an engine's base URL from env, or throw a clear soft-fail error. PURE-ish (reads env). */
export function engineUrl(engine) {
  const cfg = ENGINES[engine];
  if (!cfg) throw new Error(`docconvert: unknown engine "${engine}"`);
  const url = process.env[cfg.env];
  if (!url) throw new Error(`docconvert: ${cfg.label} not configured (set ${cfg.env})`);
  return url.replace(/\/+$/, '');
}

/** Is the named engine configured? PURE-ish (reads env), never throws. */
export function engineReady(engine) {
  try { return !!engineUrl(engine); } catch { return false; }
}

// ---------------------------------------------------------------------------
// PURE capability map — no I/O. Drives the UI's "what can I do with this file?".
// ---------------------------------------------------------------------------

// Formats Gotenberg/LibreOffice can render TO PDF (subset of the real 100+; the headline ones).
export const OFFICE_TO_PDF = [
  'doc', 'docx', 'odt', 'rtf', 'txt',
  'xls', 'xlsx', 'ods', 'csv',
  'ppt', 'pptx', 'odp',
  'html', 'md',
];

// Markup formats Pandoc converts among (both directions).
export const PANDOC_FORMATS = ['md', 'markdown', 'html', 'rst', 'latex', 'tex', 'docx', 'epub', 'odt', 'rtf', 'txt'];

// Formats Tika can extract plain text from (broad; the common ones enumerated).
export const TEXT_EXTRACTABLE = [
  'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'html', 'md',
  'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'epub',
];

const norm = (f) => String(f || '').trim().toLowerCase().replace(/^\./, '');

/**
 * PURE capability check: can we convert `from` → `to`? No network, no env reads.
 * Covers: anything-Office → pdf (Gotenberg), pdf → docx/editable (Stirling, best-effort),
 * markup ↔ markup (Pandoc), and identity.
 */
export function supports(from, to) {
  const a = norm(from), b = norm(to);
  if (!a || !b) return false;
  if (a === b) return true;
  // → PDF from any Office/markup format Gotenberg renders.
  if (b === 'pdf' && OFFICE_TO_PDF.includes(a)) return true;
  // PDF → editable Office (Stirling-PDF reconstruction).
  if (a === 'pdf' && (b === 'docx' || b === 'doc' || b === 'odt')) return true;
  // markup ↔ markup via Pandoc.
  if (PANDOC_FORMATS.includes(a) && PANDOC_FORMATS.includes(b)) return true;
  return false;
}

/**
 * PURE honesty caveat for a conversion. No network. Tells the caller (and the UI) how much to
 * trust the result. PDF→DOCX is reconstruction ("best-effort reflow"); DOC→PDF is "high-fidelity".
 * Returns null when the pair isn't supported at all.
 */
export function honestCaveat(from, to) {
  const a = norm(from), b = norm(to);
  if (!supports(a, b)) return null;
  if (a === b) return 'no conversion (identity)';
  // The headline degrading case: going back to an editable doc from PDF.
  if (a === 'pdf' && (b === 'docx' || b === 'doc' || b === 'odt')) {
    return 'best-effort reflow — degrades on complex layouts (multi-column, tables, scans)';
  }
  // The rock-solid case: office/markup → PDF.
  if (b === 'pdf' && OFFICE_TO_PDF.includes(a)) return 'high-fidelity';
  if (PANDOC_FORMATS.includes(a) && PANDOC_FORMATS.includes(b)) return 'high-fidelity (markup)';
  return 'best-effort';
}

// ---------------------------------------------------------------------------
// Request shaping — builds the multipart body + target URL per engine. Each returns
// { url, options } ready to hand to fetch. Kept separate so tests can assert shaping
// with an injected fetch and never touch the network.
// ---------------------------------------------------------------------------

function asBlob(input, filename) {
  // Accept Buffer/Uint8Array/string/Blob; normalize to a Blob for FormData.
  if (typeof Blob !== 'undefined' && input instanceof Blob) return input;
  const data = typeof input === 'string' ? input : input; // string or binary both fine for Blob
  return new Blob([data], { type: 'application/octet-stream' });
}

/** Shape a Gotenberg LibreOffice → PDF request. */
export function shapeGotenbergToPdf({ input, filename }) {
  const url = `${engineUrl('gotenberg')}/forms/libreoffice/convert`;
  const fd = new FormData();
  fd.append('files', asBlob(input, filename), filename || 'document');
  return { url, options: { method: 'POST', headers: { 'user-agent': UA }, body: fd } };
}

/** Shape a Stirling-PDF "PDF → editable Office" request (best-effort reflow). */
export function shapeStirlingPdfToOffice({ input, to }) {
  const url = `${engineUrl('stirling')}/api/v1/convert/pdf/${norm(to) === 'docx' ? 'word' : norm(to)}`;
  const fd = new FormData();
  fd.append('fileInput', asBlob(input, 'in.pdf'), 'in.pdf');
  return { url, options: { method: 'POST', headers: { 'user-agent': UA }, body: fd } };
}

/** Shape a Tika text-extraction request (PUT raw bytes, ask for plain text). */
export function shapeTikaExtract({ input }) {
  const url = `${engineUrl('tika')}/tika`;
  return { url, options: { method: 'PUT', headers: { 'user-agent': UA, accept: 'text/plain' }, body: input } };
}

/** Shape a Pandoc conversion request (JSON API: from/to + text). */
export function shapePandocConvert({ input, from, to }) {
  const url = `${engineUrl('pandoc')}/convert`;
  const body = JSON.stringify({
    from: norm(from), to: norm(to),
    text: typeof input === 'string' ? input : Buffer.from(input).toString('utf8'),
  });
  return { url, options: { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/json' }, body } };
}

// ---------------------------------------------------------------------------
// Public network API — toPdf / extractText / convert. Each soft-fails with a clear
// error if the needed engine isn't configured, and on a non-OK response.
// ---------------------------------------------------------------------------

async function send({ url, options }) {
  const r = await _fetch(url, options);
  if (!r || !r.ok) throw new Error(`docconvert: ${url} → ${r ? r.status : 'no response'}`);
  return r;
}

/** Convert an Office/markup document to PDF via Gotenberg. Returns an ArrayBuffer of the PDF. */
export async function toPdf({ input, format }) {
  const fmt = norm(format);
  if (fmt && fmt !== 'pdf' && !OFFICE_TO_PDF.includes(fmt)) {
    throw new Error(`docconvert: ${format} → pdf not supported`);
  }
  const r = await send(shapeGotenbergToPdf({ input, filename: fmt ? `document.${fmt}` : 'document' }));
  return r.arrayBuffer();
}

/** Extract plain text from a document via Tika. Returns a string. */
export async function extractText({ input }) {
  const r = await send(shapeTikaExtract({ input }));
  return r.text();
}

/**
 * General conversion router: picks the right engine for (from → to).
 *   • → pdf            → Gotenberg          (high-fidelity)
 *   • pdf → docx/doc   → Stirling-PDF       (best-effort reflow)
 *   • markup ↔ markup  → Pandoc
 * Returns { data, caveat } where data is an ArrayBuffer or string per engine.
 */
export async function convert({ input, from, to }) {
  const a = norm(from), b = norm(to);
  if (!supports(a, b)) throw new Error(`docconvert: ${from} → ${to} not supported`);
  const caveat = honestCaveat(a, b);
  if (a === b) return { data: input, caveat };
  if (b === 'pdf') {
    return { data: await toPdf({ input, format: a }), caveat };
  }
  if (a === 'pdf' && (b === 'docx' || b === 'doc' || b === 'odt')) {
    const r = await send(shapeStirlingPdfToOffice({ input, to: b }));
    return { data: await r.arrayBuffer(), caveat };
  }
  // markup ↔ markup via Pandoc.
  const r = await send(shapePandocConvert({ input, from: a, to: b }));
  return { data: await r.text(), caveat };
}

// ---------------------------------------------------------------------------
// CLI — quick capability lookup / readiness probe. No network unless a real conversion is asked.
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('docconvert.mjs')) {
  const [from, to] = process.argv.slice(2);
  if (from && to) {
    console.log(`${from} → ${to}: ${supports(from, to) ? 'supported' : 'NOT supported'}`);
    const c = honestCaveat(from, to);
    if (c) console.log(`  fidelity: ${c}`);
  } else {
    console.log('Engines:');
    for (const e of Object.keys(ENGINES)) console.log(`  ${ENGINES[e].label.padEnd(14)} ${engineReady(e) ? 'configured' : 'unset (' + ENGINES[e].env + ')'}`);
    console.log('\nUsage: node docconvert.mjs <from> <to>   # capability + fidelity lookup');
  }
}
