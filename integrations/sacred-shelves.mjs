// integrations/sacred-shelves.mjs — the Hierophant's sacred-text SHELVES: passage-level scripture with
// exact-line citations (Iliad 18.417–420, Gen 6:4, Qur'an 55:15, 1 Enoch 6:1, TLA sentence rows, ORACC
// text/line ids), each passage carrying its ORIGINAL-language line, an aligned translation where one
// exists, and the licence + attribution of the edition it came from.
//
// The index is a compact on-disk artifact built off-box by integrations/sacred-shelves-build.mjs (from
// the passage stream scripts/sacred-shelves-extract.py writes) and shipped to the web tier. At runtime we
// keep only small arrays in memory (doc lengths, doc languages, offsets, a sparse term-dictionary index)
// and read the dictionary block, the postings and the passage records from disk per query.
//
// Retrieval is lexical BM25 over original + translation (+ ORACC lemma glosses), with a
// transliteration- and diacritic-insensitive key so "egregoroi" finds ἐγρήγοροι, "daimon" δαίμων,
// "Theia" Θεία, "rigveda" ṛgveda, "shiva" śiva — plus a consonant-skeleton key for Egyptian, Hebrew and
// Arabic so "Wadjet" reaches wꜣḏ.t and "Nephilim" reaches נְּפִלִים. Nothing here is an LLM.
//
// Files in the index directory (SACRED_SHELVES_DIR, default <repo>/data/sacred-shelves):
//   meta.json      {version, N, avgdl, langs[], shelves{}, sources{}, blocks[[firstTerm, byteOffset]…]}
//   dict.txt       sorted "term\tdf\tpostOffset\tpostBytes\n" lines
//   post.bin       varint (docDelta, tf) pairs
//   docs.jsonl     one passage record per line;  docs.off  Uint32 byte offsets (N+1)
//   doclen.u16     Uint16 per doc;  doclang.u8  Uint8 index into meta.langs
//
// House style: ESM, soft-fail-never-throw (every export returns a safe empty shape on any error),
// injectable fs (__setFs) so the offline tests run against a tiny fixture index.

import * as realFs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const SHELVES_DIR = () => process.env.SACRED_SHELVES_DIR || join(HERE, 'data', 'sacred-shelves');

let fs = realFs;
let _idx = null;           // loaded index (or false after a failed load)
let _dir = null;
export function __setFs(f) { fs = f || realFs; _idx = null; }
export function __reset() { closeIdx(); _idx = null; _checked = 0; }

// ── text keys (shared by the builder and the runtime — the two MUST agree) ─────────────────────────
const GREEK = { α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'e', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o',
  π: 'p', ρ: 'r', σ: 's', ς: 's', ϲ: 's', τ: 't', υ: 'y', φ: 'ph', χ: 'kh', ψ: 'ps', ω: 'o', ϝ: 'w', ϙ: 'k', ϛ: 'st' };
const HEB = { א: '', ב: 'b', ג: 'g', ד: 'd', ה: 'h', ו: 'w', ז: 'z', ח: 'kh', ט: 't', י: 'y', כ: 'k', ך: 'k', ל: 'l', מ: 'm', ם: 'm',
  נ: 'n', ן: 'n', ס: 's', ע: '', פ: 'p', ף: 'p', צ: 'ts', ץ: 'ts', ק: 'q', ר: 'r', ש: 'sh', ת: 't' };
const HEB_FINAL = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
const AR = { ا: '', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh', د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd',
  ط: 't', ظ: 'z', ع: '', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', و: 'w', ي: 'y', ء: '', ة: 'h', ى: 'y' };

const RE_GREEK = /[Ͱ-Ͽἀ-῿]/;
const RE_HEB = /[֐-׿]/;
const RE_AR = /[؀-ۿݐ-ݿ]/;
const RE_ETH = /[ሀ-᎟ⶀ-⷟]/;
const RE_HIERO = /[\u{13000}-\u{1345f}]/u;
const MARKS = /\p{M}/gu;

/** Latin-script fold: diacritics off, IAST/Egyptological letters to their usual English spellings. */
export function latinKey(tok) {
  let s = String(tok).normalize('NFD').toLowerCase();
  s = s.replace(/ṝ?/g, 'ri')                       // ṛ ṝ → ri  (ṛgveda → rigveda)
    .replace(/ś|ṣ|š/g, 'sh')                 // ś ṣ š → sh
    .replace(/ḏ/g, 'dj').replace(/ṯ/g, 'tj')       // ḏ ṯ
    .replace(/ḫ|ẖ/g, 'kh')                          // ḫ ẖ
    .replace(/[ꜢꜣꜤꜥ]/g, 'a')                // ꜣ ꜥ
    .replace(/[Ꞽꞽı]/g, 'i')                      // ꞽ ı͗
    .replace(MARKS, '')
    .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ð/g, 'd').replace(/þ/g, 'th').replace(/ʾ|ʿ|ʼ|'/g, '')
    .replace(/j/g, 'i').replace(/v/g, 'u').replace(/c/g, 'k')
    .replace(/ae/g, 'ai').replace(/oe/g, 'oi');                  // Hephaestus ~ Ἥφαιστος, Phoebe ~ Φοίβη
  // a plain plural -s off (handmaids → handmaid, watchers → watcher); -es/-is/-os/-us/-ss endings kept
  if (s.length >= 5 && s.endsWith('s') && !/[eiosu]s$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** Greek → the Latin transliteration most people type (ἐγρήγοροι → egregoroi, Ἑρμῆς → hermes). */
export function greekKey(tok) {
  const d = String(tok).normalize('NFD').toLowerCase();
  let rough = false;                     // rough breathing on the opening vowel(s) → a leading h
  for (const ch of d) {
    if (ch === '̔') { rough = true; break; }
    if (/[βγδζθκλμνξπρστφχψςϲ]/.test(ch)) break;
  }
  if (d.startsWith('ρ')) rough = false;
  const b = d.replace(MARKS, '');
  let out = '';
  for (let i = 0; i < b.length; i++) {
    const c = b[i], prev = b[i - 1], next = b[i + 1];
    if (c === 'γ' && (next === 'γ' || next === 'κ' || next === 'ξ' || next === 'χ')) { out += 'n'; continue; }
    if (c === 'υ' && (prev === 'α' || prev === 'ε' || prev === 'ο' || prev === 'η')) { out += 'u'; continue; }
    out += GREEK[c] != null ? GREEK[c] : (/[a-z0-9]/.test(c) ? c : '');
  }
  return latinKey((rough ? 'h' : '') + out);
}

function hebNative(tok) {
  return String(tok).normalize('NFD').replace(/[֑-ׇ]/g, '').replace(/[ךםןףץ]/g, (c) => HEB_FINAL[c]);
}
function hebTranslit(tok) { return [...hebNative(tok)].map((c) => HEB[c] != null ? HEB[c] : '').join(''); }
function arNative(tok) {
  return String(tok).normalize('NFC').replace(/[ً-ٰٟۖ-ۭـ]/g, '')
    .replace(/[ٱأإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
}
function arTranslit(tok) { return [...arNative(tok)].map((c) => AR[c] != null ? AR[c] : '').join(''); }

/** Consonant skeleton: vowels, w/y/h and doubling dropped, common digraphs merged. "~"-prefixed. */
export function skeleton(raw) {
  let s = String(raw).normalize('NFD').toLowerCase()
    .replace(/ḫ|ẖ/g, 'k').replace(/š|ś/g, 's')
    .replace(MARKS, '').replace(/[^a-z]/g, '')
    .replace(/dj|dh/g, 'd').replace(/tj|th/g, 't').replace(/sh|ts|tz/g, 's').replace(/kh|ch|ck|gh/g, (m) => (m === 'gh' ? 'g' : 'k'))
    .replace(/ph|f/g, 'p').replace(/v/g, 'b').replace(/q|c/g, 'k')
    .replace(/[aeiouywh]/g, '').replace(/(.)\1+/g, '$1');
  return s.length >= 2 ? `~${s}` : '';
}

const TOKEN_RE = /[\p{L}\p{M}\p{N}]+/gu;

/** Keys for one run of text. opts.lang: document language (enables egy/akk/sux cleanup + egy skeletons);
 *  opts.query: true → also emit Latin skeleton keys (weighted low by the ranker). Returns [{k, w}]. */
export function keysFor(text, opts = {}) {
  let t = String(text || '');
  const lang = opts.lang || '';
  if (lang === 'egy') t = t.replace(/[.=⸗()⸢⸣〈〉[\]{}~\-]/g, '');
  if (lang === 'akk' || lang === 'sux') t = t.replace(/\{[^}]*\}/g, '').replace(/[₀-₉ₓ]/g, '').replace(/-/g, '');
  const out = [];
  for (const m of t.matchAll(TOKEN_RE)) {
    const tok = m[0];
    if (RE_HIERO.test(tok)) continue;
    if (RE_GREEK.test(tok)) { const k = greekKey(tok); if (k.length > 1) out.push({ k, w: 1 }); continue; }
    if (RE_HEB.test(tok)) {
      const k = hebNative(tok); if (k.length > 1) out.push({ k, w: 1 });
      const sk = skeleton(hebTranslit(tok)); if (sk) out.push({ k: sk, w: 0.35, sk: true });
      continue;
    }
    if (RE_AR.test(tok)) {
      let k = arNative(tok); if (k.length > 1) out.push({ k, w: 1 });
      if (k.startsWith('ال') && k.length > 3) out.push({ k: k.slice(2), w: 1, alt: true });
      let tr = arTranslit(tok); if (tr.startsWith('l') && k.startsWith('ال')) tr = tr.slice(1);
      const sk = skeleton(tr); if (sk) out.push({ k: sk, w: 0.35, sk: true });
      continue;
    }
    if (RE_ETH.test(tok)) { const k = tok.normalize('NFC'); if (k.length > 1) out.push({ k, w: 1 }); continue; }
    const k = latinKey(tok);
    if (k.length < 2 || /^\d+$/.test(k)) continue;
    out.push({ k, w: 1 });
    // skeletons: every Egyptian transliteration token; for a query only when ≥3 consonants survive, so a
    // short English word ("enoch" → ~nk) cannot drag in unrelated Hebrew/Arabic/Egyptian roots
    if (lang === 'egy') { const sk = skeleton(tok); if (sk && sk.length > 2) out.push({ k: sk, w: 0.35, sk: true }); }
    else if (opts.query) { const sk = skeleton(tok); if (sk && sk.length > 3) out.push({ k: sk, w: 0.35, sk: true }); }
  }
  return out;
}

/** Canonical-reference normaliser used for aliases and getPassage(): "Qur'an 55:15" → "quran55.15". */
export function normRef(ref) {
  return String(ref || '').normalize('NFD').replace(/r\u0323/gi, 'ri').replace(MARKS, '').toLowerCase()
    .replace(/[’'`ʼʾʿ]/g, '').replace(/[–—]/g, '-').replace(/:/g, '.')
    .replace(/[\s,()]+/g, '').replace(/\.+$/, '');
}

// ── varint ───────────────────────────────────────────────────────────────────────────────────────
export function readVarints(buf, cb) {
  let i = 0;
  while (i < buf.length) {
    let v = 0, shift = 0, b;
    do { b = buf[i++]; v += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80 && i < buf.length);
    cb(v);
  }
}

// ── loading ─────────────────────────────────────────────────────────────────────────────────────
let _checked = 0, _mtime = 0;
const RECHECK_MS = 60_000;
function closeIdx() {
  if (_idx) for (const fd of [_idx.fdDict, _idx.fdPost, _idx.fdDocs]) { try { fs.closeSync(fd); } catch { /* already closed */ } }
}
function load() {
  const dir = SHELVES_DIR();
  // A new index swapped into place (directory rename) is picked up within a minute — no restart needed.
  if (_dir === dir && _idx !== null && Date.now() - _checked > RECHECK_MS) {
    _checked = Date.now();
    let m = 0;
    try { m = fs.statSync(join(dir, 'meta.json')).mtimeMs; } catch { m = -1; }
    if (m !== _mtime) { closeIdx(); _idx = null; }
  }
  if (_idx && _dir === dir) return _idx;
  if (_idx === false && _dir === dir) return null;
  _dir = dir;
  _checked = Date.now();
  try {
    _mtime = fs.statSync(join(dir, 'meta.json')).mtimeMs;
    const meta = JSON.parse(fs.readFileSync(join(dir, 'meta.json'), 'utf8'));
    const u8 = (name) => { const b = fs.readFileSync(join(dir, name)); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); };
    const offB = fs.readFileSync(join(dir, 'docs.off'));
    const lenB = fs.readFileSync(join(dir, 'doclen.u16'));
    const off = new Uint32Array(offB.buffer.slice(offB.byteOffset, offB.byteOffset + offB.byteLength));
    const doclen = new Uint16Array(lenB.buffer.slice(lenB.byteOffset, lenB.byteOffset + lenB.byteLength));
    const doclang = u8('doclang.u8');
    _idx = {
      dir, meta, off, doclen, doclang,
      fdDict: fs.openSync(join(dir, 'dict.txt'), 'r'),
      fdPost: fs.openSync(join(dir, 'post.bin'), 'r'),
      fdDocs: fs.openSync(join(dir, 'docs.jsonl'), 'r'),
      dictSize: fs.statSync(join(dir, 'dict.txt')).size,
    };
    return _idx;
  } catch {
    _mtime = -1;
    _idx = false;
    return null;
  }
}

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = fs.readSync(fd, b, got, len - got, pos + got);
    if (!n) break;
    got += n;
  }
  return got === len ? b : b.subarray(0, got);
}

/** Dictionary lookup: binary-search the sparse block index, read one block, scan it. */
function lookup(idx, term) {
  const blocks = idx.meta.blocks || [];
  let lo = 0, hi = blocks.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid][0] <= term) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (at < 0) return null;
  const start = blocks[at][1];
  const end = at + 1 < blocks.length ? blocks[at + 1][1] : idx.dictSize;
  const text = readAt(idx.fdDict, start, end - start).toString('utf8');
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    if (line.slice(0, tab) === term) {
      const [, df, po, pl] = line.split('\t');
      return { df: +df, off: +po, len: +pl };
    }
  }
  return null;
}

function postings(idx, ent) {
  const buf = readAt(idx.fdPost, ent.off, ent.len);
  const docs = [], tfs = [];
  let doc = 0, odd = false;
  readVarints(buf, (v) => {
    if (!odd) { doc += v; docs.push(doc); } else tfs.push(v);
    odd = !odd;
  });
  return { docs, tfs };
}

function readDoc(idx, i) {
  if (i < 0 || i >= idx.meta.N) return null;
  const a = idx.off[i], b = idx.off[i + 1];
  try {
    const rec = JSON.parse(readAt(idx.fdDocs, a, b - a).toString('utf8'));
    rec._i = i;
    return rec;
  } catch { return null; }
}

/** Attach licence/attribution for the original and the translation. */
function withLicence(idx, rec) {
  if (!rec) return null;
  const S = idx.meta.sources || {};
  const s = S[rec.src] || {};
  const t = rec.tr_src ? (S[rec.tr_src] || {}) : null;
  return {
    id: rec.id, ref: rec.ref, work: rec.work, shelf: rec.shelf, lang: rec.lang, text: rec.text,
    translation: rec.tr || null, translation_lang: rec.tr ? (rec.tr_lang || 'en') : null, translation_label: rec.tr_label || null,
    url: rec.url || s.home || null, urn: rec.urn || null,
    source: { key: rec.src, name: s.name || rec.src, license: s.license || '', license_url: s.license_url || '', home: s.home || '' },
    translation_source: t ? { key: rec.tr_src, name: t.name || rec.tr_src, license: t.license || '', license_url: t.license_url || '', home: t.home || '' } : null,
    index: rec._i,
  };
}

// ── public API ──────────────────────────────────────────────────────────────────────────────────
export const LANG_NAMES = {
  grc: 'Ancient Greek', la: 'Latin', hbo: 'Biblical Hebrew / Aramaic', sa: 'Sanskrit', pi: 'Pali', egy: 'Egyptian',
  akk: 'Akkadian', sux: 'Sumerian', gez: "Ge'ez", ar: 'Classical Arabic', en: 'English', de: 'German',
};

export function available() { return !!load(); }

export function stats() {
  const idx = load();
  if (!idx) return { ok: false, N: 0, shelves: {}, langs: {}, sources: {} };
  const m = idx.meta;
  return { ok: true, N: m.N, shelves: m.shelves || {}, langs: m.langCounts || {}, sources: m.sources || {}, built: m.built || null, works: m.works || {} };
}

const QSTOP = new Set(['what', 'does', 'did', 'say', 'says', 'said', 'about', 'who', 'whom', 'which', 'when', 'where', 'why', 'how',
  'is', 'are', 'was', 'were', 'the', 'a', 'an', 'of', 'in', 'on', 'to', 'and', 'or', 'for', 'with', 'by', 'from', 'tell', 'me',
  'text', 'texts', 'scripture', 'scriptures', 'passage', 'passages', 'quote', 'cite', 'do', 'there', 'any', 'that', 'this', 'it', 'its']);

/** BM25 search across the shelves. opts: {langs: ['grc',…], shelves: [...], limit=10, perWork=2}.
 *  Returns [{…passage, score}] — never throws. */
export function searchShelves(query, opts = {}) {
  try {
    const idx = load();
    if (!idx) return [];
    const q = String(query || '').slice(0, 400);
    const limit = Math.max(1, Math.min(50, +opts.limit || 10));
    const perWork = opts.perWork == null ? 2 : +opts.perWork;
    const langSet = Array.isArray(opts.langs) && opts.langs.length
      ? new Set(opts.langs.map((l) => idx.meta.langs.indexOf(l)).filter((i) => i >= 0)) : null;
    if (langSet && !langSet.size) return [];
    const shelfSet = Array.isArray(opts.shelves) && opts.shelves.length ? new Set(opts.shelves) : null;
    // one entry per distinct key, max weight; English question words dropped
    const qk = new Map();
    for (const { k, w } of keysFor(q, { query: true })) {
      if (QSTOP.has(k)) continue;
      qk.set(k, Math.max(qk.get(k) || 0, w));
    }
    if (!qk.size) return [];
    const { N, avgdl } = idx.meta;
    const k1 = 1.2, b = 0.75;
    let ents = [...qk].map(([k, w]) => ({ k, w, e: lookup(idx, k) })).filter((x) => x.e);
    if (!ents.length) return [];
    const rare = ents.filter((x) => x.e.df <= N * 0.08);
    if (rare.length) ents = rare;                   // very common keys only count when nothing else matched
    const scores = new Map();
    for (const { w, e } of ents) {
      const idf = Math.log(1 + (N - e.df + 0.5) / (e.df + 0.5));
      const { docs, tfs } = postings(idx, e);
      for (let j = 0; j < docs.length; j++) {
        const d = docs[j];
        if (langSet && !langSet.has(idx.doclang[d])) continue;
        const tf = tfs[j], dl = idx.doclen[d] || 1;
        const s = w * idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl));
        scores.set(d, (scores.get(d) || 0) + s);
      }
    }
    const ranked = [...scores].sort((x, y) => y[1] - x[1]);
    const out = [], perW = new Map();
    for (const [d, s] of ranked) {
      if (out.length >= limit) break;
      const rec = readDoc(idx, d);
      if (!rec) continue;
      if (shelfSet && !shelfSet.has(rec.shelf)) continue;
      const n = perW.get(rec.work) || 0;
      if (perWork > 0 && n >= perWork) continue;
      perW.set(rec.work, n + 1);
      out.push({ ...withLicence(idx, rec), score: Math.round(s * 1000) / 1000 });
      if (out.length >= limit) break;
      if (scores.size > 5000 && out.length === 0 && perW.size > 400) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Resolve a canonical reference ("Gen 6:4", "Iliad 18.418", "Qur'an 55:15", an id, a CTS URN).
 *  Returns {passage, alternates[]} or null. Never throws. */
export function getPassage(ref) {
  try {
    const idx = load();
    if (!idx) return null;
    const raw = String(ref || '').trim().slice(0, 300);
    if (!raw) return null;
    const tries = [raw];
    const urn = raw.match(/^urn:cts:\w+:([^:]+?)(?:\.[a-z0-9-]+)?:(.+)$/i);
    if (urn) tries.push(`${urn[1].split('.').slice(0, 2).join('.')}:${urn[2]}`);
    const range = raw.match(/^(.*?\d)\s*[-–—]\s*\d+[a-z]?$/);    // "Iliad 18.417–420" → "Iliad 18.417"
    if (range) tries.push(range[1]);
    for (const t of tries) {
      const e = lookup(idx, '@' + normRef(t));
      if (!e) continue;
      const { docs } = postings(idx, e);
      const recs = docs.slice(0, 12).map((d) => withLicence(idx, readDoc(idx, d))).filter(Boolean);
      if (recs.length) return { passage: recs[0], alternates: recs.slice(1) };
    }
    return null;
  } catch {
    return null;
  }
}

/** The passage at a doc index (for prev/next browsing). */
export function passageAt(i) {
  try {
    const idx = load();
    if (!idx) return null;
    return withLicence(idx, readDoc(idx, +i));
  } catch { return null; }
}
