// integrations/sacred-shelves-build.mjs — build the compact on-disk index that integrations/sacred-shelves.mjs
// reads. Input: the passage stream written by scripts/sacred-shelves-extract.py (one JSON passage per line)
// plus its .sources.json. Output: the directory described in sacred-shelves.mjs (meta.json, dict.txt,
// post.bin, docs.jsonl/docs.off, doclen.u16, doclang.u8).
//
// Memory is bounded by building postings in PARTS hash-partitions of the vocabulary (one pass over the
// passages per partition). Keys come from the SAME keysFor()/normRef() the runtime uses, so the index and
// the query path can never drift apart.
//
//   node integrations/sacred-shelves-build.mjs passages.jsonl OUT_DIR [PARTS]
//
// House style: ESM, CLI guarded by the argv check; buildIndex() is exported for the offline tests.

import { createReadStream, createWriteStream, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keysFor, normRef } from './sacred-shelves.mjs';

const BLOCK = 128;              // dictionary lines per sparse-index block

function varint(n, arr) {
  while (n >= 0x80) { arr.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80); }
  arr.push(n);
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Keys of one passage: {bag: Map<term,tf>, len}. Aliases become "@"-terms (not counted in length). */
export function docTerms(rec) {
  const bag = new Map();
  let len = 0;
  const add = (text, lang) => {
    for (const { k, sk } of keysFor(text, { lang })) {
      bag.set(k, (bag.get(k) || 0) + 1);
      if (!sk) len++;
    }
  };
  add(rec.text, rec.lang);
  if (rec.tr) add(rec.tr, rec.tr_lang || 'en');
  if (rec.gloss) add(rec.gloss, 'en');
  for (const { k } of keysFor(rec.work || '', {})) if (!bag.has(k)) bag.set(k, 1);   // "Iliad", "Ṛgveda", "Theogony"
  for (const a of new Set([rec.id, rec.ref, ...(rec.aliases || [])])) {
    const n = normRef(a);
    if (n) bag.set('@' + n, 1);
  }
  return { bag, len };
}

async function* lines(src) {
  if (Array.isArray(src)) { for (const r of src) yield r; return; }
  const rl = createInterface({ input: createReadStream(src, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) { if (line.trim()) yield JSON.parse(line); }
}

/** Build the index. src: a JSONL path or an array of passage objects. sources: {key:{name,license,…}}. */
export async function buildIndex(src, outDir, { sources = {}, parts = 1, log = () => {} } = {}) {
  const tmp = outDir + '.tmp';
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  // pass 0: docs.jsonl / docs.off / doclen / doclang + stats
  const docsOut = createWriteStream(join(tmp, 'docs.jsonl'));
  const offs = [0]; const lens = []; const langIdx = []; const langs = []; const langCounts = {}; const shelves = {}; const works = {};
  let pos = 0, N = 0, total = 0;
  for await (const rec of lines(src)) {
    const { aliases, gloss, ...keep } = rec;        // aliases/gloss are index-only
    const line = JSON.stringify(keep) + '\n';
    if (!docsOut.write(line)) await new Promise((r) => docsOut.once('drain', r));
    pos += Buffer.byteLength(line); offs.push(pos);
    const { len } = docTerms(rec);
    lens.push(Math.min(65535, len)); total += len;
    let li = langs.indexOf(rec.lang); if (li < 0) { langs.push(rec.lang); li = langs.length - 1; }
    langIdx.push(li);
    langCounts[rec.lang] = (langCounts[rec.lang] || 0) + 1;
    shelves[rec.shelf] = (shelves[rec.shelf] || 0) + 1;
    const wk = `${rec.shelf}\t${rec.work}`; works[wk] = works[wk] || { shelf: rec.shelf, work: rec.work, first: rec.id, n: 0 }; works[wk].n++;
    N++;
    if (N % 200000 === 0) log(`docs ${N}`);
  }
  await new Promise((r) => docsOut.end(r));
  if (pos >= 2 ** 32) throw new Error('docs.jsonl exceeds 4 GiB');
  writeFileSync(join(tmp, 'docs.off'), Buffer.from(new Uint32Array(offs).buffer));
  writeFileSync(join(tmp, 'doclen.u16'), Buffer.from(new Uint16Array(lens).buffer));
  writeFileSync(join(tmp, 'doclang.u8'), Buffer.from(new Uint8Array(langIdx).buffer));
  // passes 1..parts: postings per vocabulary partition
  const postOut = createWriteStream(join(tmp, 'post.bin'));
  let postPos = 0;
  const dict = [];
  for (let p = 0; p < parts; p++) {
    const map = new Map();
    let d = 0;
    for await (const rec of lines(src)) {
      const { bag } = docTerms(rec);
      for (const [k, tf] of bag) {
        if (parts > 1 && hash(k) % parts !== p) continue;
        let e = map.get(k);
        if (!e) { e = { last: 0, bytes: [], df: 0 }; map.set(k, e); }
        varint(d - e.last, e.bytes); varint(tf, e.bytes); e.last = d; e.df++;
      }
      d++;
    }
    for (const [k, e] of map) {
      const buf = Buffer.from(e.bytes);
      if (!postOut.write(buf)) await new Promise((r) => postOut.once('drain', r));
      dict.push([k, e.df, postPos, buf.length]);
      postPos += buf.length;
    }
    log(`partition ${p + 1}/${parts}: ${map.size} terms`);
    map.clear();
  }
  await new Promise((r) => postOut.end(r));
  dict.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const blocks = [];
  const dictOut = createWriteStream(join(tmp, 'dict.txt'));
  let dpos = 0;
  for (let i = 0; i < dict.length; i++) {
    const [k, df, o, l] = dict[i];
    const line = `${k}\t${df}\t${o}\t${l}\n`;
    if (i % BLOCK === 0) blocks.push([k, dpos]);
    if (!dictOut.write(line)) await new Promise((r) => dictOut.once('drain', r));
    dpos += Buffer.byteLength(line);
  }
  await new Promise((r) => dictOut.end(r));
  const meta = {
    version: 1, built: new Date().toISOString(), N, avgdl: N ? total / N : 1, langs, langCounts, shelves,
    works: Object.fromEntries(Object.values(works).map((w) => [w.work, w])), sources, terms: dict.length, blocks,
  };
  writeFileSync(join(tmp, 'meta.json'), JSON.stringify(meta));
  rmSync(outDir, { recursive: true, force: true });
  renameSync(tmp, outDir);
  return { N, terms: dict.length, langCounts, shelves };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, out, parts] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: node sacred-shelves-build.mjs passages.jsonl OUT_DIR [PARTS]'); process.exit(2); }
  const sp = src + '.sources.json';
  const sources = existsSync(sp) ? (JSON.parse(readFileSync(sp, 'utf8')).sources || {}) : {};
  const t0 = Date.now();
  buildIndex(src, out, { sources, parts: +parts || 4, log: (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`) })
    .then((r) => console.error(JSON.stringify(r)))
    .catch((e) => { console.error(e); process.exit(1); });
}
