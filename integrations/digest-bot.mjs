// digest-bot.mjs — the book / long-document digester. A deterministic BOT, not an agent loop.
//
// Hand it a book (or a long email, a transcript, a paper) and it reads the whole thing chunk by chunk:
//   1. extract text   — .md/.txt direct; .pdf via pdftotext; .docx/.epub by unzipping and stripping XML/HTML.
//   2. chunk          — book-chunker.mjs (whole paragraphs, ~targetWords, with overlap).
//   3. per chunk      — ALWAYS an offline extractive summary + keywords (extractive-summary.mjs), then ONE
//                       LLM pass through llm-router.mjs asking for strict JSON:
//                         { summary, claims:[{text, kind, confidence}], entities:{people, places, groups,
//                           tools, laws, genes}, numbers:[{value, what}], questions_raised, action_items,
//                           sources_cited }
//                       kind ∈ measured | inference | tradition | speculation | opinion.
//                       The JSON is validated and normalised; if the LLM is absent / fails / returns junk,
//                       the chunk keeps its extractive result and is marked llm:false (retried next run).
//   4. cache          — every chunk result is cached by the SHA-256 of its text, so a 500-page book can
//                       stop and resume, and a re-run only pays for chunks that changed or failed.
//   5. merge          — one book-level digest: outline (chunk summaries in order), deduplicated entities
//                       and claims (labels kept, highest confidence wins), numbers, action items, open
//                       questions, sources — written as digest.md + digest.json (+ chunks.jsonl, ready for
//                       an embedder / RAG index) into <outRoot>/<slug>/.
//
// Server mode (--watch <inbox>): digest every new file dropped into an inbox folder, moving each to
// <inbox>/done/ when finished. Run by a systemd timer on the posting host (deploy/production/posting/).
//
//   node integrations/digest-bot.mjs <file|folder> [--out <dir>] [--words 700] [--no-llm] [--max-chunks N]
//   node integrations/digest-bot.mjs --watch <inbox> [--out <dir>]
//
// House rules: pure Node builtins + sibling modules (runs from the sparse docmaker checkout); soft-fail —
// digest() never throws, a bad chunk never stops the book; LLM is injectable for offline tests
// (__setLLM); keys stay inside llm-router (never read, logged or returned here).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chunkText } from './book-chunker.mjs';
import { summarize, keywords } from './extractive-summary.mjs';

export const KINDS = ['measured', 'inference', 'tradition', 'speculation', 'opinion'];
export const ENTITY_TYPES = ['people', 'places', 'groups', 'tools', 'laws', 'genes'];
const PROMPT_VERSION = 'v1';

// ── LLM (injectable) ─────────────────────────────────────────────────────────────────────────
let _llm = null;
export function __setLLM(fn) { _llm = typeof fn === 'function' ? fn : null; }
async function llm(prompt, opts) {
  if (_llm) return _llm(prompt, opts);
  const { complete, textOf } = await import('./llm-router.mjs');
  const r = await complete(prompt, opts);
  return { text: textOf(r), provider: r.provider || null, error: r.error || null };
}

// ── text extraction ──────────────────────────────────────────────────────────────────────────
const stripTags = (s) => String(s)
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<\/(p|div|h[1-6]|li|br|tr|w:p)>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

function unzipList(file) { try { return execFileSync('unzip', ['-Z1', file], { encoding: 'utf8', maxBuffer: 64e6 }).split('\n').filter(Boolean); } catch { return []; } }
function unzipCat(file, entry) { try { return execFileSync('unzip', ['-p', file, entry], { encoding: 'utf8', maxBuffer: 256e6 }); } catch { return ''; } }

/** Plain text of a document. Never throws; '' when unreadable. */
export function extractText(file) {
  try {
    const ext = path.extname(file).toLowerCase();
    if (['.md', '.txt', '.markdown', '.text', ''].includes(ext)) {
      return String(fs.readFileSync(file, 'utf8')).replace(/^---\n[\s\S]*?\n---\n/, '').replace(/\r\n/g, '\n');
    }
    if (ext === '.html' || ext === '.htm') return stripTags(fs.readFileSync(file, 'utf8'));
    if (ext === '.pdf') { try { return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 256e6 }); } catch { return ''; } }
    if (ext === '.docx') return stripTags(unzipCat(file, 'word/document.xml'));
    if (ext === '.epub') {
      const parts = unzipList(file).filter((e) => /\.(x?html?)$/i.test(e) && !/nav|toc/i.test(e)).sort();
      return parts.map((e) => stripTags(unzipCat(file, e))).filter(Boolean).join('\n\n');
    }
  } catch {}
  return '';
}

export const slugOf = (file) => path.basename(String(file)).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'document';
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// ── the per-chunk prompt + validation ────────────────────────────────────────────────────────
export function chunkPrompt(text, { title = '', index = 0, total = 1 } = {}) {
  return `You are a careful research librarian digesting part ${index + 1} of ${total} of "${title}".
Return ONLY one JSON object, no prose, no code fence, with exactly these keys:
{"summary": "3-5 sentences, faithful to the text",
 "claims": [{"text": "one claim the text makes", "kind": "measured|inference|tradition|speculation|opinion", "confidence": 0.0-1.0}],
 "entities": {"people": [], "places": [], "groups": [], "tools": ["services, products, software, labs, databases"], "laws": ["statutes, cases, legal mechanisms"], "genes": ["genes, haplogroups, markers"]},
 "numbers": [{"value": "e.g. $39 or 1-2% or 1400 BC", "what": "what it measures"}],
 "questions_raised": [], "action_items": ["concrete steps a reader could take"], "sources_cited": []}
Rules: "measured" = direct observation/data/price stated as fact; "inference" = reasoning from data; "tradition" = oral/religious/mythic account; "speculation" = hypothesis; "opinion" = judgement. Only include what this part actually says. Empty arrays are fine.

TEXT:
${text}`;
}

const arr = (x) => (Array.isArray(x) ? x : []);
const str = (x) => (typeof x === 'string' ? x.trim() : typeof x === 'number' ? String(x) : '');
const uniqStr = (xs, max = 60) => [...new Set(arr(xs).map(str).filter(Boolean))].slice(0, max);

/** Parse + normalise an LLM answer. → object, or null when it isn't usable JSON. */
export function parseChunkJson(text) {
  const t = String(text || '');
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let j; try { j = JSON.parse(t.slice(a, b + 1)); } catch { return null; }
  if (!j || typeof j !== 'object' || !str(j.summary)) return null;
  const ent = j.entities && typeof j.entities === 'object' ? j.entities : {};
  return {
    summary: str(j.summary),
    claims: arr(j.claims).map((c) => (typeof c === 'string' ? { text: c } : c || {}))
      .map((c) => ({ text: str(c.text), kind: KINDS.includes(str(c.kind).toLowerCase()) ? str(c.kind).toLowerCase() : 'inference', confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0.5)) }))
      .filter((c) => c.text).slice(0, 40),
    entities: Object.fromEntries(ENTITY_TYPES.map((k) => [k, uniqStr(ent[k])])),
    numbers: arr(j.numbers).map((n) => (typeof n === 'string' ? { value: n, what: '' } : { value: str(n && n.value), what: str(n && n.what) })).filter((n) => n.value).slice(0, 40),
    questions_raised: uniqStr(j.questions_raised, 20),
    action_items: uniqStr(j.action_items, 30),
    sources_cited: uniqStr(j.sources_cited, 30),
  };
}

const emptyLLM = () => ({ summary: '', claims: [], entities: Object.fromEntries(ENTITY_TYPES.map((k) => [k, []])), numbers: [], questions_raised: [], action_items: [], sources_cited: [] });

/** Digest one chunk. Never throws. */
export async function digestChunk(chunk, ctx = {}) {
  const text = chunk.text;
  const base = { index: chunk.index, hash: sha(PROMPT_VERSION + text), words: chunk.wordCount, extractive: summarize(text, { maxSentences: 4 }), keywords: keywords(text, { n: 10 }) };
  if (ctx.noLLM) return { ...base, llm: false, ...emptyLLM() };
  try {
    const r = await llm(chunkPrompt(text, ctx), { task: 'long', maxTokens: 2500, timeout: 90000 });
    const parsed = parseChunkJson(r && r.text);
    if (parsed) return { ...base, llm: true, provider: (r && r.provider) || null, ...parsed };
    return { ...base, llm: false, llmError: (r && r.error) || 'unparseable', ...emptyLLM() };
  } catch (e) {
    return { ...base, llm: false, llmError: String((e && e.message) || e).slice(0, 120), ...emptyLLM() };
  }
}

// ── merge ────────────────────────────────────────────────────────────────────────────────────
const norm = (s) => str(s).toLowerCase().replace(/[^a-z0-9%$.]+/g, ' ').trim();

export function mergeDigest(results, { title = '', source = '' } = {}) {
  const entities = Object.fromEntries(ENTITY_TYPES.map((k) => [k, new Map()]));
  const claims = new Map(); const numbers = new Map();
  const listMerge = (key) => { const m = new Map(); for (const r of results) for (const x of r[key] || []) { const k = norm(x); if (k && !m.has(k)) m.set(k, { text: x, chunk: r.index }); } return [...m.values()]; };
  for (const r of results) {
    for (const k of ENTITY_TYPES) for (const e of (r.entities && r.entities[k]) || []) {
      const key = norm(e); if (!key) continue;
      const cur = entities[k].get(key); if (cur) cur.count++; else entities[k].set(key, { name: e, count: 1 });
    }
    for (const c of r.claims || []) {
      const key = norm(c.text); if (!key) continue;
      const cur = claims.get(key);
      if (!cur || c.confidence > cur.confidence) claims.set(key, { ...c, chunk: r.index });
    }
    for (const n of r.numbers || []) { const key = norm(n.value + ' ' + n.what); if (key && !numbers.has(key)) numbers.set(key, { ...n, chunk: r.index }); }
  }
  const byKind = Object.fromEntries(KINDS.map((k) => [k, [...claims.values()].filter((c) => c.kind === k).sort((a, b) => b.confidence - a.confidence || a.chunk - b.chunk)]));
  return {
    title, source, chunks: results.length,
    llmChunks: results.filter((r) => r.llm).length,
    outline: results.map((r) => ({ chunk: r.index, summary: r.summary || r.extractive, keywords: r.keywords })),
    entities: Object.fromEntries(ENTITY_TYPES.map((k) => [k, [...entities[k].values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))])),
    claims: byKind,
    numbers: [...numbers.values()],
    action_items: listMerge('action_items'),
    questions: listMerge('questions_raised'),
    sources: listMerge('sources_cited'),
  };
}

const mdEsc = (s) => String(s == null ? '' : s).replace(/\r?\n+/g, ' ').trim();
export function renderMarkdown(d) {
  const L = [];
  L.push(`# Digest: ${mdEsc(d.title)}`, '');
  L.push(`Source: \`${mdEsc(d.source)}\` · ${d.chunks} chunk${d.chunks === 1 ? '' : 's'} · LLM-read ${d.llmChunks}/${d.chunks}${d.llmChunks < d.chunks ? ' (the rest are extractive only — re-run to retry)' : ''} · generated ${new Date().toISOString().slice(0, 16)}Z by digest-bot`, '');
  if (d.action_items.length) { L.push('## Action items', ''); for (const a of d.action_items) L.push(`- [ ] ${mdEsc(a.text)} _(part ${a.chunk + 1})_`); L.push(''); }
  L.push('## Outline', ''); for (const o of d.outline) L.push(`${o.chunk + 1}. ${mdEsc(o.summary)}`); L.push('');
  const kindTitle = { measured: 'Stated as fact / measured', inference: 'Inferences', tradition: 'Tradition / oral / scriptural accounts', speculation: 'Speculation / hypotheses', opinion: 'Opinions / judgements' };
  const anyClaims = KINDS.some((k) => d.claims[k].length);
  if (anyClaims) {
    L.push('## Claims (labelled — keep measurements, inferences and speculation separate)', '');
    for (const k of KINDS) if (d.claims[k].length) { L.push(`### ${kindTitle[k]}`, ''); for (const c of d.claims[k]) L.push(`- ${mdEsc(c.text)} _(conf ${c.confidence.toFixed(2)}, part ${c.chunk + 1})_`); L.push(''); }
  }
  const entTitle = { people: 'People', places: 'Places', groups: 'Groups / peoples', tools: 'Tools, services, labs, databases', laws: 'Laws, cases, legal mechanisms', genes: 'Genes, haplogroups, markers' };
  if (ENTITY_TYPES.some((k) => d.entities[k].length)) { L.push('## Index', ''); for (const k of ENTITY_TYPES) if (d.entities[k].length) L.push(`**${entTitle[k]}:** ${d.entities[k].map((e) => mdEsc(e.name) + (e.count > 1 ? ` (${e.count})` : '')).join(' · ')}`, ''); }
  if (d.numbers.length) { L.push('## Numbers', '', '| Value | What |', '| --- | --- |'); for (const n of d.numbers) L.push(`| ${mdEsc(n.value).replace(/\|/g, '/')} | ${mdEsc(n.what).replace(/\|/g, '/')} |`); L.push(''); }
  if (d.questions.length) { L.push('## Open questions', ''); for (const q of d.questions) L.push(`- ${mdEsc(q.text)}`); L.push(''); }
  if (d.sources.length) { L.push('## Sources cited in the text', ''); for (const s of d.sources) L.push(`- ${mdEsc(s.text)}`); L.push(''); }
  return L.join('\n');
}

// ── the whole document ───────────────────────────────────────────────────────────────────────
function readJson(f, dflt) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } }

/**
 * Digest one document end to end. Never throws.
 * → { ok, slug, outDir, chunks, llmChunks, cached, error? }
 */
export async function digest(file, { outRoot = process.env.DIGEST_OUT || path.join(process.cwd(), '.local', 'digests'), words = +(process.env.DIGEST_WORDS || 700), overlap = 60, noLLM = false, maxChunks = 0, title, log = () => {} } = {}) {
  try {
    const text = extractText(file);
    if (!text.trim()) return { ok: false, error: 'no text extracted', slug: slugOf(file) };
    const slug = slugOf(file);
    const outDir = path.join(outRoot, slug);
    fs.mkdirSync(outDir, { recursive: true });
    const cacheFile = path.join(outDir, 'cache.json');
    const cache = readJson(cacheFile, {});
    let chunks = chunkText(text, { targetWords: words, overlapWords: overlap });
    if (maxChunks > 0) chunks = chunks.slice(0, maxChunks);
    const name = title || (text.match(/^#\s+(.+)$/m) || [])[1] || path.basename(file);
    const results = []; let cached = 0;
    for (const c of chunks) {
      const h = sha(PROMPT_VERSION + c.text);
      const hit = cache[h];
      if (hit && (hit.llm || noLLM)) { results.push({ ...hit, index: c.index }); cached++; continue; }
      const r = await digestChunk(c, { title: name, index: c.index, total: chunks.length, noLLM });
      results.push(r); cache[h] = r;
      try { fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch {}   // checkpoint after every chunk
      log(`chunk ${c.index + 1}/${chunks.length}: ${r.llm ? `llm (${r.provider || '?'})` : `extractive${r.llmError ? ` — ${r.llmError}` : ''}`}`);
    }
    const d = mergeDigest(results, { title: name, source: path.basename(file) });
    fs.writeFileSync(path.join(outDir, 'digest.json'), JSON.stringify(d, null, 2));
    fs.writeFileSync(path.join(outDir, 'digest.md'), renderMarkdown(d));
    fs.writeFileSync(path.join(outDir, 'chunks.jsonl'), chunks.map((c, i) => JSON.stringify({ id: `${slug}#${c.index}`, title: name, text: c.text, summary: results[i] && (results[i].summary || results[i].extractive) })).join('\n') + '\n');
    return { ok: true, slug, outDir, chunks: chunks.length, llmChunks: d.llmChunks, cached };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200), slug: slugOf(file) };
  }
}

const DOC_EXT = /\.(md|txt|markdown|pdf|docx|epub|html?)$/i;
/** Digest every document in an inbox folder, then move each to <inbox>/done/. */
export async function watchOnce(inbox, opts = {}) {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(inbox).filter((f) => DOC_EXT.test(f)).map((f) => path.join(inbox, f)).filter((f) => fs.statSync(f).isFile()); } catch { return out; }
  for (const f of files) {
    const r = await digest(f, opts);
    out.push({ file: path.basename(f), ...r });
    // only fully LLM-read documents leave the inbox; partial ones stay and resume from cache next run
    if (r.ok && (r.llmChunks === r.chunks || opts.noLLM)) {
      try { fs.mkdirSync(path.join(inbox, 'done'), { recursive: true }); fs.renameSync(f, path.join(inbox, 'done', path.basename(f))); } catch {}
    }
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const a = process.argv.slice(2);
  const flag = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const opts = { noLLM: a.includes('--no-llm'), log: (m) => console.log(m) };
  if (flag('--out')) opts.outRoot = path.resolve(flag('--out'));
  if (flag('--words')) opts.words = +flag('--words');
  if (flag('--max-chunks')) opts.maxChunks = +flag('--max-chunks');
  const watch = flag('--watch');
  const target = watch || a.find((x, i) => !x.startsWith('--') && !['--out', '--words', '--max-chunks', '--watch'].includes(a[i - 1]));
  if (!target) { console.error('usage: digest-bot.mjs <file|folder> [--out dir] [--words 700] [--no-llm] [--max-chunks N] | --watch <inbox>'); process.exit(1); }
  let isDir = false; try { isDir = fs.statSync(target).isDirectory(); } catch {}
  const res = watch || isDir ? await watchOnce(target, opts) : [await digest(target, opts)];
  for (const r of res) console.log(JSON.stringify(r));
}
