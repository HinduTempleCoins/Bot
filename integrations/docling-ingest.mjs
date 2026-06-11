// docling-ingest.mjs — normalize a Docling export into MELEK annal/corpus records.
//
// Per .local/BRAIN_STACK_PLAN.md, Annals ingestion uses Docling (IBM, Apache-2.0): it converts
// PDF/DOCX/HTML → a structured JSON document (or "DocTags"/markdown). This module is the thin,
// offline adapter that turns whatever Docling produced into the record shape the rest of the brain
// stores + embeds (memory/vector-store.mjs) — it does NOT run Docling itself (that's a Python tool
// on the brain box); it just normalizes Docling's OUTPUT, which the caller hands in or reads via an
// injected reader.
//
//   import { normalizeDocling, toAnnalRecords, chunkForEmbedding } from './docling-ingest.mjs'
//   normalizeDocling(doclingJson)            -> { title, source, sections:[{heading,text,level}], meta }
//   toAnnalRecords(normalized, { source })   -> [{ id, text, meta }]   (ready for Memory.upsert)
//   chunkForEmbedding(records, { maxChars }) -> [{ id, text, meta }]   (split long sections)
//
// Accepts the common Docling JSON shapes (texts[]/tables[] with labels, or a {title, sections}
// already-simplified shape, or raw markdown string). Pure + offline: any file read goes through an
// injected reader (__setReader); never fetches, never runs a model. Soft-fail: malformed input →
// empty/partial result, never throws. esc() for any HTML rendering. Zero-WIF: data-shaping only.

let _reader = null; // injected: (path) => string  (for the CLI / file-backed ingest)
export function __setReader(fn) { _reader = typeof fn === 'function' ? fn : null; }

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Docling "texts" items carry a `label` (title, section_header, paragraph, list_item, caption, …)
const HEADING_LABELS = new Set(['title', 'section_header', 'subtitle', 'heading']);

/**
 * Normalize a Docling export (object or markdown string) into a flat document shape.
 * Returns { title, source, sections:[{heading, level, text}], meta }. Soft-fail → empty doc.
 */
export function normalizeDocling(input, opts = {}) {
  const source = String((opts && opts.source) || '');
  const empty = { title: '', source, sections: [], meta: {} };
  if (input == null) return empty;

  // raw markdown string → split on ATX headings
  if (typeof input === 'string') {
    return { ...markdownToDoc(input), source };
  }
  if (typeof input !== 'object') return empty;

  // already-simplified { title, sections:[{heading,text,level}] }
  if (Array.isArray(input.sections)) {
    return {
      title: String(input.title || ''),
      source,
      sections: input.sections
        .filter((s) => s && typeof s === 'object')
        .map((s) => ({
          heading: String(s.heading || ''),
          level: Number.isInteger(s.level) ? s.level : 1,
          text: String(s.text || ''),
        })),
      meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
    };
  }

  // canonical Docling JSON: { texts:[{label,text,...}], name?, metadata? }
  if (Array.isArray(input.texts)) {
    const sections = [];
    let title = String(input.name || (input.metadata && input.metadata.title) || '');
    let cur = null;
    for (const t of input.texts) {
      if (!t || typeof t !== 'object') continue;
      const label = String(t.label || '').toLowerCase();
      const text = String(t.text || '').trim();
      if (!text) continue;
      if (label === 'title' && !title) title = text;
      if (HEADING_LABELS.has(label)) {
        cur = { heading: text, level: label === 'title' ? 1 : 2, text: '' };
        sections.push(cur);
      } else {
        if (!cur) {
          cur = { heading: '', level: 1, text: '' };
          sections.push(cur);
        }
        cur.text += (cur.text ? '\n' : '') + text;
      }
    }
    return {
      title,
      source,
      sections,
      meta: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    };
  }

  return empty;
}

function markdownToDoc(md) {
  const lines = String(md).split(/\r?\n/);
  const sections = [];
  let title = '';
  let cur = null;
  for (const ln of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(ln);
    if (h) {
      const level = h[1].length;
      const heading = h[2].trim();
      if (level === 1 && !title) title = heading;
      cur = { heading, level, text: '' };
      sections.push(cur);
    } else if (ln.trim()) {
      if (!cur) {
        cur = { heading: '', level: 1, text: '' };
        sections.push(cur);
      }
      cur.text += (cur.text ? '\n' : '') + ln.trim();
    }
  }
  return { title, sections, meta: {} };
}

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'section';

/**
 * Turn a normalized doc into annal/corpus records ready for Memory.upsert: one per non-empty
 * section, id = `${sourceSlug}#${sectionSlug}-${i}`. meta carries title/heading/source/level.
 * Soft-fail → []. Never throws.
 */
export function toAnnalRecords(normalized, opts = {}) {
  const doc = normalized && typeof normalized === 'object' ? normalized : null;
  if (!doc || !Array.isArray(doc.sections)) return [];
  const source = String((opts && opts.source) || doc.source || '');
  const base = slug(source || doc.title || 'doc');
  const records = [];
  doc.sections.forEach((s, i) => {
    const text = `${s.heading ? s.heading + '\n' : ''}${s.text || ''}`.trim();
    if (!text) return;
    records.push({
      id: `${base}#${slug(s.heading)}-${i}`,
      text,
      meta: {
        source,
        title: doc.title || '',
        heading: s.heading || '',
        level: s.level || 1,
        ...(doc.meta || {}),
      },
    });
  });
  return records;
}

/**
 * Split records whose text exceeds maxChars into ~maxChars chunks on paragraph/whitespace
 * boundaries, carrying a small overlap. Keeps short records as-is. For embedding-sized inputs.
 * Soft-fail → []. Never throws.
 */
export function chunkForEmbedding(records, opts = {}) {
  const max = Number.isInteger(opts.maxChars) && opts.maxChars > 0 ? opts.maxChars : 1500;
  const overlap = Number.isInteger(opts.overlap) && opts.overlap >= 0 ? opts.overlap : 100;
  const list = Array.isArray(records) ? records : [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r.text !== 'string') continue;
    if (r.text.length <= max) {
      out.push(r);
      continue;
    }
    const parts = splitText(r.text, max, overlap);
    parts.forEach((p, i) => {
      out.push({ id: `${r.id}~${i}`, text: p, meta: { ...(r.meta || {}), chunk: i, chunks: parts.length } });
    });
  }
  return out;
}

function splitText(text, max, overlap) {
  const paras = text.split(/\n{2,}/);
  const chunks = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = '';
  };
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > max && buf) {
      flush();
      if (overlap > 0 && chunks.length) buf = chunks[chunks.length - 1].slice(-overlap) + '\n\n';
    }
    if (p.length > max) {
      // hard-split an over-long paragraph on word boundaries
      const words = p.split(/\s+/);
      for (const w of words) {
        if ((buf + ' ' + w).length > max && buf) flush();
        buf += (buf ? ' ' : '') + w;
      }
    } else {
      buf += (buf ? '\n\n' : '') + p;
    }
  }
  flush();
  return chunks;
}

// --- CLI (guarded; reads a Docling JSON/markdown file via the injected reader) ----------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.log('usage: node integrations/docling-ingest.mjs <docling.json|doc.md>  (needs an injected reader in tests)');
  } else if (!_reader) {
    console.log('no reader injected — this CLI path expects __setReader for file access (offline by design)');
  } else {
    const raw = _reader(path);
    let input = raw;
    try {
      input = JSON.parse(raw);
    } catch {
      /* treat as markdown */
    }
    const doc = normalizeDocling(input, { source: path });
    const recs = chunkForEmbedding(toAnnalRecords(doc));
    console.log(`${doc.title || '(untitled)'} — ${recs.length} record(s) from ${doc.sections.length} section(s)`);
  }
}
