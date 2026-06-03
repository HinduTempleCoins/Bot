// kbCheck.js — fact-check a KB / Library SOURCE DOCUMENT directly against live Resource Center data
// (#136 Part 2). The original fact-checker (index.js) checks GENERATED wiki articles, which carry a
// <ref>file</ref> after each claim. KB source docs (knowledge/**/*.json, scripture/**/*.md, Library
// articles) have NO such refs — so this module extracts checkable claim sentences straight from the
// raw document, verifies each against the Resource Center (scraper.research → real fetched pages), and
// records flags keyed by the ACTUAL KB file path so the brief feed can ask "any flags on this doc?".
//
// HARD INVARIANT (project rule): this NEVER edits the KB. It reads the doc, writes ONLY to the
// append-only verdict log (verdictLog.js) and the advisory KB-flag store (flags.js). Verdicts are
// fallible — flags are an operator-review queue, false positives expected.
//
//   import { extractKbClaims, checkKbFile, checkKbDoc } from './kbCheck.js'
//   node src/factChecker/kbCheck.js knowledge/cryptocurrency/foo.json

import fs from 'fs';
import path from 'path';
import { verifyClaim } from './index.js';
import { recordFlag } from './flags.js';
import { logVerdict } from './verdictLog.js';

const nowISO = () => new Date().toISOString();

// Keys whose VALUES are bookkeeping/metadata, not real-world assertions to fact-check.
const META_KEYS = /^(title|author|source|compiled_by|overview|summary|tags|keywords|id|slug|date|created|updated|url|category|domain|type|filename|note|notes)$/i;

// Pull human-readable strings out of a parsed JSON KB doc (depth-first). We keep leaf strings (and
// joined string arrays) that look like prose; we skip obvious metadata keys and tiny fragments.
function stringsFromJson(node, key = '', out = []) {
  if (node == null) return out;
  if (typeof node === 'string') {
    if (!META_KEYS.test(key)) out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    // an array of short strings reads as one claim ("a, b, c"); an array of objects recurses.
    const strs = node.filter((x) => typeof x === 'string');
    if (strs.length === node.length && strs.length) { if (!META_KEYS.test(key)) out.push(strs.join('. ')); }
    else node.forEach((x) => stringsFromJson(x, key, out));
    return out;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) stringsFromJson(v, k, out);
  }
  return out;
}

// Strip Markdown decoration down to plain prose lines.
function linesFromMarkdown(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')               // fenced code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')          // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')        // [text](url) → text
    .replace(/^[>#*\-+\d.\s]+/gm, '')               // list/quote/heading marks
    .replace(/[*_`]+/g, '')                         // emphasis
    .split(/\n+/);
}

/**
 * Extract candidate fact-checkable claim sentences from a raw KB/Library document (JSON or Markdown).
 * Returns deduped claim strings. A "claim" here is a prose sentence long enough to assert something and
 * containing letters; we split on sentence boundaries and keep the substantive ones.
 *
 * @param {string} text  raw file contents
 * @param {string} [ext] '.json' | '.md' (inferred from a leading '{' if omitted)
 */
export function extractKbClaims(text, ext = '') {
  const raw = String(text || '');
  let blocks = [];
  const looksJson = ext === '.json' || (!ext && /^\s*[{[]/.test(raw));
  if (looksJson) {
    try { blocks = stringsFromJson(JSON.parse(raw)); }
    catch { blocks = linesFromMarkdown(raw); }       // not valid JSON → treat as text
  } else {
    blocks = linesFromMarkdown(raw);
  }
  const claims = [];
  for (const block of blocks) {
    // split a block into sentences; require space+capital lookahead so "Dr." / "U.S." don't split.
    for (const sentRaw of String(block).split(/(?<=[.!?;])\s+(?=[A-Z(])/)) {
      const s = sentRaw.replace(/\s+/g, ' ').trim();
      // substantive: long enough to assert something, has letters, has a verb-ish/connective word.
      if (s.length >= 30 && s.length <= 400 && /[a-z]/i.test(s) && /\b(is|are|was|were|has|have|can|will|provides?|contains?|uses?|named|called|founded|discovered|invented|located|produces?|enables?|allows?|consists?|means?|refers?|developed|created|forms?|occurs?|requires?|gains?|boosts?|affects?|changes?|transforms?|reduces?|increases?|expands?|generates?|causes?|carries|carry|holds?)\b/i.test(s)) {
        claims.push(s);
      }
    }
  }
  const seen = new Set();
  return claims.filter((c) => { const k = c.toLowerCase().slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Check a KB DOCUMENT's raw text against live Resource Center data. Extracts claims, verifies each
 * (Wikipedia/Wikidata + the RC scraper + grounding, via verifyClaim), logs every verdict (append-only),
 * and records CONTRADICTED/UNVERIFIABLE ones to the flag store keyed by `kbFile`. NEVER edits the KB.
 *
 * @param {string} text    raw document contents
 * @param {object} opts    { kbFile (the KB path used as the flag key), topic, ext, max (claim cap), batch }
 * @returns {{kbFile, topic, total, tally, results}}
 */
export async function checkKbDoc(text, { kbFile = 'unknown', topic = '', ext = '', max = 40, batch = 3 } = {}) {
  const t = topic || path.basename(kbFile).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  const claims = extractKbClaims(text, ext || path.extname(kbFile)).slice(0, max);
  const results = [];
  for (let i = 0; i < claims.length; i += batch) {
    const slice = claims.slice(i, i + batch);
    const verdicts = await Promise.all(slice.map(async (claim) => {
      const v = await verifyClaim(claim).catch((e) => ({ verdict: 'UNVERIFIABLE', confidence: 0, reason: 'check error: ' + e.message, source: '', evidence_urls: [] }));
      const rec = { article: t, topic: t, claim, file: kbFile, sourceRef: kbFile, ...v, checkedAt: nowISO() };
      logVerdict(rec);                               // #101 append-only audit log
      const evidence = (v.evidence_urls && v.evidence_urls.length) ? v.evidence_urls.join(' ') : (v.source || '');
      // #104 advisory flag — keyed by the real KB file so briefWarningFor(kbFile) finds it. FLAG-ONLY.
      recordFlag({ file: kbFile, topic: t, claim, verdict: v.verdict, reason: v.reason, evidence, checkedAt: rec.checkedAt });
      return rec;
    }));
    results.push(...verdicts);
  }
  const tally = results.reduce((a, r) => (a[r.verdict] = (a[r.verdict] || 0) + 1, a), {});
  return { kbFile, topic: t, total: results.length, tally, results };
}

/** Convenience: read a KB file from disk and check it. The `kbFile` flag-key defaults to a path that
 *  mirrors how generated articles cite the KB (relative to a knowledge root if given). */
export async function checkKbFile(filePath, { kbRoot = '', topic = '', max = 40 } = {}) {
  const text = fs.readFileSync(filePath, 'utf8');
  const kbFile = kbRoot ? path.relative(kbRoot, filePath) : path.basename(filePath);
  return checkKbDoc(text, { kbFile, topic, ext: path.extname(filePath), max });
}

if (process.argv[1] && process.argv[1].endsWith('kbCheck.js')) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node src/factChecker/kbCheck.js <kb-doc.json|.md>'); process.exit(1); }
  const report = await checkKbFile(file, { kbRoot: process.env.KB_ROOT || '' });
  console.log(`\nKB fact-check: ${report.kbFile} — ${report.total} claims`);
  console.log('Verdicts:', report.tally);
  for (const r of report.results) {
    const mark = { SUPPORTED: '✅', CONTRADICTED: '❌', UNVERIFIABLE: '❓', INTERNAL: '🏛️' }[r.verdict] || '·';
    console.log(`${mark} [${r.verdict}] ${r.claim.slice(0, 90)}${r.claim.length > 90 ? '…' : ''}`);
    if (r.verdict === 'CONTRADICTED') console.log(`     → ${r.reason}${r.source ? ` (${r.source})` : ''}`);
  }
}
