// lora-dataset.mjs — turn the scraped language corpus into LoRA training data.
//
// Operator greenlit LoRA-on-Modal. Step 1 (no GPU, no cost): format the datasets the Language Center
// scraped (knowledge/languages/*.json) into a training JSONL Hathor can be fine-tuned on, so she
// actually KNOWS the languages (weights), not just retrieves them (RAG).
//
// Two example kinds, both emitted as a single `text` field (works for continued-pretraining AND
// instruction tuners like Unsloth):
//   • STRUCTURED → instruction sentences. CC-CEDICT lines ("漢 hàn /Chinese/") become clean learnable
//     statements ("In Mandarin, 漢 (hàn) means: Chinese.").
//   • RAW corpus → continued-pretraining chunks (the tagged Greek NT / Hebrew OT / indexes), so the
//     model simply reads a lot of the language.
//
// Pure transforms + injectable fs (readDir/readFile) so it's fully offline-testable; the real run
// happens on the box where the datasets live. Soft-fails per source; never throws.
//
//   node integrations/lora-dataset.mjs            # build datasets/lora/training.jsonl from knowledge/languages
//   import { parseCedict, chunkText, buildFromDataset, buildAll, toJsonl } from './lora-dataset.mjs'

import { readFile as fsRead, readdir as fsReaddir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATASET_DIR = process.env.LANG_DATASET_DIR || path.join(__dirname, '..', 'knowledge', 'languages');
export const OUT = process.env.LORA_OUT || path.join(__dirname, '..', 'datasets', 'lora', 'training.jsonl');

const CHUNK = +(process.env.LORA_CHUNK || 800);     // chars per continued-pretraining block
const MAX_PER_SOURCE = +(process.env.LORA_MAX_PER_SOURCE || 4000);

// ── parsers / chunkers (pure) ──────────────────────────────────────────────────────────────────────
// CC-CEDICT line: "傳統 传统 [chuan2 tong3] /tradition/traditional/"  (trad simp [pinyin] /defs/)
const CEDICT_RE = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/\s*$/;
export function parseCedict(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(CEDICT_RE);
    if (!m) continue;
    const [, , simp, pinyin, defs] = m;
    const meaning = defs.split('/').filter(Boolean).slice(0, 4).join('; ');
    if (simp && meaning) out.push({ word: simp, pinyin, meaning });
  }
  return out;
}

// makemeahanzi dictionary.txt = one JSON object per line: {"character","definition","pinyin":[...]}
export function parseHanziJsonl(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const word = o.character; const meaning = o.definition;
    if (!word || !meaning) continue;
    const pinyin = Array.isArray(o.pinyin) ? o.pinyin.join(', ') : (o.pinyin || '');
    out.push({ word, pinyin, meaning: String(meaning).slice(0, 120) });
  }
  return out;
}

/** Split raw text into ~CHUNK-char blocks on sentence/line boundaries (continued-pretraining). */
export function chunkText(text, size = CHUNK) {
  const clean = String(text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const out = [];
  let buf = '';
  for (const para of clean.split(/\n+/)) {
    if ((buf + '\n' + para).length > size && buf) { out.push(buf.trim()); buf = para; }
    else { buf = buf ? buf + '\n' + para : para; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((c) => c.length >= 40);
}

const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const langLabel = { mandarin: 'Mandarin', 'koine-greek': 'Koine Greek', 'biblical-hebrew': 'Biblical Hebrew', 'kurdish-general': 'Kurdish' };
const L = (id) => langLabel[id] || cap(String(id || 'this language').replace(/-/g, ' '));

// ── build examples from one dataset object ({ id, language, type, content }) ─────────────────────────
export function buildFromDataset(ds) {
  if (!ds || !ds.content) return [];
  const lang = ds.language || 'unknown';
  const text = typeof ds.content === 'string' ? ds.content : JSON.stringify(ds.content);
  let examples = [];

  // structured dictionary → instruction sentences
  if (ds.id === 'cc-cedict' || /cedict|hanzi/i.test(ds.via || '')) {
    let entries = parseCedict(text);
    if (!entries.length) entries = parseHanziJsonl(text);   // makemeahanzi is JSON-lines, not CEDICT text
    examples = entries.map((e) => ({
      source: ds.id, language: lang,
      text: `In ${L(lang)}, ${e.word}${e.pinyin ? ` (${e.pinyin})` : ''} means: ${e.meaning}.`,
    })).filter((x) => /means: .+\./.test(x.text));
  } else {
    // raw corpus → reading chunks (continued-pretraining)
    examples = chunkText(text).map((c) => ({
      source: ds.id, language: lang,
      text: `[${L(lang)} reading]\n${c}`,
    }));
  }
  return examples.slice(0, MAX_PER_SOURCE);
}

// ── build the whole training set from the dataset dir (injectable fs for tests) ──────────────────────
export async function buildAll({ dir = DATASET_DIR, readdir = fsReaddir, readFile = fsRead } = {}) {
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'manifest.json'); } catch { files = []; }
  const examples = [];
  const bySource = {};
  for (const f of files) {
    let ds = null;
    try { ds = JSON.parse(await readFile(path.join(dir, f), 'utf8')); } catch { ds = null; }
    if (!ds) continue;
    const ex = buildFromDataset(ds);
    examples.push(...ex);
    bySource[ds.id || f] = ex.length;
  }
  return { examples, stats: { sources: Object.keys(bySource).length, total: examples.length, bySource } };
}

export function toJsonl(examples) {
  return (examples || []).map((e) => JSON.stringify({ text: e.text, language: e.language, source: e.source })).join('\n') + '\n';
}

// ── CLI (runs on the box where the datasets live) ───────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { examples, stats } = await buildAll({});
  if (!examples.length) { console.error(`No datasets in ${DATASET_DIR} — run the language scrape first (language-ingest.mjs --apply).`); process.exit(1); }
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, toJsonl(examples));
  console.log(`LoRA training set → ${OUT}`);
  console.log(`  ${stats.total} examples from ${stats.sources} sources:`);
  for (const [s, n] of Object.entries(stats.bySource)) console.log(`    ${s.padEnd(22)} ${n}`);
}
