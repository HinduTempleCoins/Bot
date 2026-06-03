// reader.mjs — the self-host READER LAYER for the SoapBox Library (queue #86). This is the SERVER-SIDE
// half of an in-browser reading experience: it decides what may be READ IN-BROWSER (we host the bytes
// and embed a viewer) vs what must LINK OUT (we never touch the file), and it emits the manifest a
// front-end PDF.js / EPUB.js viewer needs.
//
// The load-bearing rule is inherited, not re-decided: WE NEVER HOST OTHER PEOPLE'S COPYRIGHTED FILES.
// Copyright classification belongs to library-buckets.mjs — we IMPORT classify() and read its verdict.
// If a work is not PD / open / CC / our-own / user-owned (i.e. it lands in METADATA_ONLY), the reader
// is ALWAYS 'link-out': canEmbed:false, no viewer, no src, just a "read at the source" card.
//
//   import { readableKind, readerManifest, renderReader, cdnAssets } from './reader.mjs'
//   readableKind(item)   → 'pdf' | 'epub' | 'html' | 'link-out'
//   readerManifest(item) → { kind, src?, title, license, canEmbed, viewer, fallbackUrl? }
//   renderReader(item)   → minimal HTML (viewer container + bootstrap, or read-at-source card)
//   cdnAssets()          → { pdfjs:{...}, epubjs:{...} } script/style URLs the page can include
//   node integrations/soapbox/reader.mjs   # offline demo
//
// PURE: no network of its own. A fetch hook is provided for parity with sibling modules / future
// remote-format probing, but defaults to a no-op offline so the module never reaches the network.

// ── defensive import of the copyright classifier ────────────────────────────────────────────────
// Reuse the bucket logic rather than re-deciding copyright. If the module can't be loaded for any
// reason, fall back to the SAFE DEFAULT (never host) so we never accidentally embed an unclassified file.
let _classify = null;
let _BUCKETS = { HOST_FULL: 'HOST_FULL', METADATA_ONLY: 'METADATA_ONLY', USER_NFT: 'USER_NFT' };
try {
  const mod = await import('./library-buckets.mjs');
  if (mod && typeof mod.classify === 'function') _classify = mod.classify;
  if (mod && mod.BUCKETS) _BUCKETS = mod.BUCKETS;
} catch { /* soft-fail: _classify stays null, classifyItem() returns the safe default */ }

// Injectable fetch for parity with sibling soapbox modules. Defaults OFFLINE (no network).
let _fetch = (..._a) => Promise.resolve(null);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((..._a) => Promise.resolve(null)); }

// ── HTML escaping (same shape as creator-storefront.mjs) ──────────────────────────────────────────
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

// ── well-known CDN asset paths for the front-end viewers ──────────────────────────────────────────
// Pinned versions on jsDelivr (a self-host path can be substituted by overriding base). pdf.js ships a
// worker that must be referenced separately; epub.js needs JSZip alongside it.
const PDFJS_VERSION = '4.7.76';
const EPUBJS_VERSION = '0.3.93';
const JSZIP_VERSION = '3.10.1';

/**
 * Script/style URLs for the front-end PDF.js + EPUB.js viewers. The page includes whichever set the
 * manifest's `viewer` calls for. Returns plain well-known CDN paths (no secrets, no network here).
 */
export function cdnAssets() {
  const pdfBase = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;
  return {
    pdfjs: {
      lib: `${pdfBase}/pdf.min.mjs`,
      worker: `${pdfBase}/pdf.worker.min.mjs`,
      version: PDFJS_VERSION,
    },
    epubjs: {
      jszip: `https://cdn.jsdelivr.net/npm/jszip@${JSZIP_VERSION}/dist/jszip.min.js`,
      lib: `https://cdn.jsdelivr.net/npm/epubjs@${EPUBJS_VERSION}/dist/epub.min.js`,
      version: EPUBJS_VERSION,
    },
  };
}

// ── copyright gate ────────────────────────────────────────────────────────────────────────────────
// Run the item through the bucket classifier. Returns { canHostFile, bucket, license }. On any
// missing/garbage input or absent classifier → the SAFE DEFAULT (never host).
function classifyItem(item) {
  const license = item && item.license != null ? String(item.license) : '';
  if (!item || typeof item !== 'object') {
    return { canHostFile: false, bucket: _BUCKETS.METADATA_ONLY, license: '' };
  }
  // Some catalog rows pre-decide a bucket ('host-fully' | 'metadata-only'); honor an explicit
  // metadata-only as never-host, but still defer to classify() for the positive decision.
  if (norm(item.bucket) === 'metadata-only') {
    return { canHostFile: false, bucket: _BUCKETS.METADATA_ONLY, license };
  }
  if (!_classify) {
    // Classifier unavailable: only trust an explicit host-fully marker; otherwise safe default.
    const hostable = norm(item.bucket) === 'host-fully';
    return { canHostFile: hostable, bucket: hostable ? _BUCKETS.HOST_FULL : _BUCKETS.METADATA_ONLY, license };
  }
  let c;
  try { c = _classify(item); } catch { c = null; }
  if (!c || typeof c !== 'object') {
    return { canHostFile: false, bucket: _BUCKETS.METADATA_ONLY, license };
  }
  return { canHostFile: c.canHostFile === true, bucket: c.bucket, license };
}

// ── format detection ────────────────────────────────────────────────────────────────────────────
// Infer the on-disk format from explicit fields, mime type, or the src/url extension.
function detectFormat(item) {
  if (!item || typeof item !== 'object') return null;
  const fmt = norm(item.format || item.fileType || item.ext);
  if (fmt) {
    if (/(^|[^a-z])pdf([^a-z]|$)/.test(fmt) || fmt === 'pdf') return 'pdf';
    if (fmt.includes('epub')) return 'epub';
    if (fmt === 'html' || fmt === 'htm' || fmt === 'xhtml' || fmt.includes('html')) return 'html';
    if (fmt === 'txt' || fmt === 'text' || fmt.includes('plain')) return 'html'; // plain text renders inline as html
  }
  const mime = norm(item.mime || item.mimeType || item.contentType);
  if (mime) {
    if (mime.includes('application/pdf')) return 'pdf';
    if (mime.includes('epub')) return 'epub';
    if (mime.includes('text/html') || mime.includes('xhtml')) return 'html';
    if (mime.includes('text/plain')) return 'html';
  }
  const path = String((item.src || item.url || item.file || '')).split(/[?#]/)[0].toLowerCase();
  if (path.endsWith('.pdf')) return 'pdf';
  if (path.endsWith('.epub')) return 'epub';
  if (path.endsWith('.html') || path.endsWith('.htm') || path.endsWith('.xhtml')) return 'html';
  if (path.endsWith('.txt')) return 'html';
  return null;
}

// The bytes we'd serve to the embedded viewer. Only an explicit hostable-byte field counts — a bare
// `url` is a landing/source page (link-out target), NOT a file we host, so it is deliberately excluded.
function srcOf(item) {
  if (!item || typeof item !== 'object') return null;
  const s = item.src || item.file || item.fileUrl || null;
  return s ? String(s) : null;
}

// Where to send the reader when we link out (or as a fallback when there's no embeddable src).
function fallbackOf(item) {
  if (!item || typeof item !== 'object') return null;
  const s = item.fallbackUrl || item.url || item.src || item.link || null;
  return s ? String(s) : null;
}

// ── readableKind ────────────────────────────────────────────────────────────────────────────────
/**
 * Decide how an item may be READ. In-copyright (not PD/CC/own/user) → ALWAYS 'link-out' — we never host
 * the bytes. For hostable items, the kind follows the detected format ('pdf' | 'epub' | 'html'); if the
 * format is unknown we cannot embed it safely, so we link out. Returns 'link-out' for garbage/empty.
 *
 * @param {object} item
 * @returns {'pdf'|'epub'|'html'|'link-out'|null}
 */
export function readableKind(item) {
  if (!item || typeof item !== 'object') return 'link-out';
  const { canHostFile } = classifyItem(item);
  if (!canHostFile) return 'link-out'; // copyright gate: never host someone else's file
  const fmt = detectFormat(item);
  if (fmt === 'pdf' || fmt === 'epub' || fmt === 'html') return fmt;
  return 'link-out'; // hostable but unknown/unembeddable format → safest is to link out
}

const VIEWER_FOR = { pdf: 'pdfjs', epub: 'epubjs', html: 'inline' };

// ── readerManifest ──────────────────────────────────────────────────────────────────────────────
/**
 * The data a front-end viewer needs to render (or refuse to render) an item.
 *
 * @param {object} item
 * @returns {{ kind:string, src?:string, title:string, license:string, canEmbed:boolean,
 *             viewer:('pdfjs'|'epubjs'|'inline'|null), fallbackUrl?:string }}
 */
export function readerManifest(item) {
  const safeItem = item && typeof item === 'object' ? item : {};
  const title = safeItem.title != null ? String(safeItem.title) : '';
  const { license } = classifyItem(safeItem);
  const kind = readableKind(safeItem);
  const fallbackUrl = fallbackOf(safeItem);

  if (kind === 'link-out' || kind == null) {
    const out = { kind: 'link-out', title, license, canEmbed: false, viewer: null };
    if (fallbackUrl) out.fallbackUrl = fallbackUrl;
    return out;
  }

  const src = srcOf(safeItem);
  // Hostable + embeddable format, but we have no actual src to embed → degrade to link-out.
  if (!src) {
    const out = { kind: 'link-out', title, license, canEmbed: false, viewer: null };
    if (fallbackUrl) out.fallbackUrl = fallbackUrl;
    return out;
  }

  const manifest = { kind, src, title, license, canEmbed: true, viewer: VIEWER_FOR[kind] || null };
  if (fallbackUrl && fallbackUrl !== src) manifest.fallbackUrl = fallbackUrl;
  return manifest;
}

// ── renderReader ────────────────────────────────────────────────────────────────────────────────
function licenseNote(license) {
  const l = String(license || '').trim();
  return l ? `<p class="reader-license">License: ${esc(l)}</p>` : '';
}

function renderLinkOut(m) {
  const href = m.fallbackUrl || '';
  const link = href
    ? `<a class="reader-source-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Read at the source ↗</a>`
    : `<span class="reader-source-link reader-source-unavailable">No reading link available</span>`;
  return `<section class="reader reader-linkout" data-kind="link-out">
  <div class="reader-card">
    <h2 class="reader-title">${esc(m.title || 'Untitled')}</h2>
    <p class="reader-note">This work is in copyright, so SoapBox does not host the file. You can read it at the source.</p>
    ${link}
    ${licenseNote(m.license)}
  </div>
</section>`;
}

function renderPdf(m, a) {
  const id = 'reader-pdf';
  return `<section class="reader reader-pdf" data-kind="pdf">
  <h2 class="reader-title">${esc(m.title || 'Untitled')}</h2>
  <div id="${id}" class="reader-viewer reader-viewer-pdf" data-src="${esc(m.src)}"></div>
  ${licenseNote(m.license)}
  <script type="module">
    import * as pdfjsLib from "${esc(a.pdfjs.lib)}";
    pdfjsLib.GlobalWorkerOptions.workerSrc = "${esc(a.pdfjs.worker)}";
    (async () => {
      const container = document.getElementById("${id}");
      try {
        const pdf = await pdfjsLib.getDocument(container.dataset.src).promise;
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const viewport = page.getViewport({ scale: 1.3 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width; canvas.height = viewport.height;
          container.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        }
      } catch (e) { container.textContent = "Could not render this document in-browser."; }
    })();
  </script>
</section>`;
}

function renderEpub(m, a) {
  const id = 'reader-epub';
  return `<section class="reader reader-epub" data-kind="epub">
  <h2 class="reader-title">${esc(m.title || 'Untitled')}</h2>
  <div id="${id}" class="reader-viewer reader-viewer-epub" data-src="${esc(m.src)}"></div>
  <div class="reader-nav"><button id="reader-prev">‹ Prev</button><button id="reader-next">Next ›</button></div>
  ${licenseNote(m.license)}
  <script src="${esc(a.epubjs.jszip)}"></script>
  <script src="${esc(a.epubjs.lib)}"></script>
  <script>
    (function () {
      var el = document.getElementById("${id}");
      try {
        var book = ePub(el.dataset.src);
        var rendition = book.renderTo("${id}", { width: "100%", height: 600 });
        rendition.display();
        var prev = document.getElementById("reader-prev"), next = document.getElementById("reader-next");
        if (prev) prev.onclick = function () { rendition.prev(); };
        if (next) next.onclick = function () { rendition.next(); };
      } catch (e) { el.textContent = "Could not render this book in-browser."; }
    })();
  </script>
</section>`;
}

function renderInline(m) {
  // For HTML/plain-text we host, the front end fetches and sandboxes the content into an iframe.
  return `<section class="reader reader-inline" data-kind="html">
  <h2 class="reader-title">${esc(m.title || 'Untitled')}</h2>
  <iframe class="reader-viewer reader-viewer-inline" sandbox="allow-same-origin" src="${esc(m.src)}" title="${esc(m.title || 'document')}"></iframe>
  ${licenseNote(m.license)}
</section>`;
}

/**
 * Minimal HTML for the reader. Embeddable items get a viewer container + the PDF.js/EPUB.js bootstrap
 * pointed at src; link-out items get a "read at the source" card with the external link + license note.
 * ALL values are escaped. Never emits a viewer container for a link-out item.
 *
 * @param {object} item
 * @returns {string} HTML
 */
export function renderReader(item) {
  const m = readerManifest(item);
  if (!m.canEmbed) return renderLinkOut(m);
  const a = cdnAssets();
  if (m.viewer === 'pdfjs') return renderPdf(m, a);
  if (m.viewer === 'epubjs') return renderEpub(m, a);
  if (m.viewer === 'inline') return renderInline(m);
  // Unknown viewer despite canEmbed (shouldn't happen) → safest is the link-out card.
  return renderLinkOut({ ...m, canEmbed: false, kind: 'link-out', viewer: null, fallbackUrl: m.fallbackUrl || m.src });
}

// ── CLI demo (offline) ────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('reader.mjs')) {
  const fixtures = [
    { label: 'PD PDF (Gutenberg)', item: { title: 'Moby-Dick', source: 'gutenberg', year: 1851, format: 'pdf', src: 'https://example.org/moby.pdf' } },
    { label: 'Own-corpus EPUB', item: { title: 'The Convergence', owner: 'melek', format: 'epub', src: '/corpus/convergence.epub' } },
    { label: 'CC HTML paper', item: { title: 'An OA study', license: 'CC BY 4.0', source: 'doaj', format: 'html', src: 'https://example.org/study.html' } },
    { label: 'In-copyright book', item: { title: 'A 2023 novel', year: 2023, rights: 'All rights reserved', format: 'pdf', url: 'https://openlibrary.org/works/X' } },
    { label: 'Garbage item', item: null },
  ];
  for (const { label, item } of fixtures) {
    const m = readerManifest(item);
    console.log(`${label.padEnd(22)} → kind=${m.kind.padEnd(9)} embed=${m.canEmbed ? 'Y' : 'N'} viewer=${m.viewer || '-'}`);
  }
}
