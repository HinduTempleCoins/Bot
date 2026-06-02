// factChecker — the second, simpler bot. It does NOT synthesize; it AUDITS. Given a generated wiki
// article, it pulls out each factual claim (with the KB source file the article cited for it),
// checks that claim against EXTERNAL reality via Gemini's google_search grounding, and records a
// verdict. Contradicted/unverifiable claims become KB FLAGS (flags.js) that the brief writers read.
//
// Verdicts:
//   SUPPORTED     — external sources agree.
//   CONTRADICTED  — external sources disagree (a real hallucination / bad source datum).
//   UNVERIFIABLE  — no external evidence either way (flag, lower urgency).
//   INTERNAL      — a claim about VKFRI's own framework/terminology; not externally checkable, not a flag.
//
//   node src/factChecker/index.js generated-articles/Shulgin_Ten_Essential_Oils.wiki
//   import { checkArticle } from './factChecker/index.js'

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { recordFlag } from './flags.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const LOG = process.env.FACTCHECK_LOG || path.join(__dir, '..', '..', 'data', 'factcheck-log.jsonl');
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const KEY = () => process.env.GEMINI_API_KEY || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();

// ── Gemini REST (grounding needs the google_search tool, cleanest via REST) ──
async function gemini(prompt, { grounded = false, retries = 3 } = {}) {
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } };
  if (grounded) body.tools = [{ google_search: {} }];
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY()}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      const d = await r.json();
      const text = d.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '';
      const citations = (d.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
        .map((c) => c.web?.uri).filter(Boolean);
      return { text, citations };
    } catch (e) { if (i === retries - 1) throw e; await sleep(1500 * (i + 1)); }
  }
  return { text: '', citations: [] };
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ── claim extraction: pull "sentence<ref>file</ref>" pairs from the faithful article format ──
export function extractClaims(wikiText) {
  const claims = [];
  // strip Sources/Coverage/etc. from claim consideration
  const body = wikiText.replace(/==\s*(Sources|Coverage|See Also|References)\s*==[\s\S]*$/i, '');
  const clean = (s) => s
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')   // [[Link|x]] → x
    .replace(/'''?|[*#]|^=+|=+$/g, '')                  // bold/list/header marks
    .replace(/\s+/g, ' ').trim();
  // the faithful format attaches a <ref> right after each claim: "…claim text<ref>file</ref>."
  // Capture the prose immediately preceding each <ref>, then keep its LAST sentence as the claim.
  const re = /([^<>\n]{15,}?)<ref>([^<]+)<\/ref>/g;
  let m;
  while ((m = re.exec(body))) {
    const file = m[2].trim();
    // last sentence of the captured prose (avoid splitting on "Dr." etc. by requiring space+capital)
    const parts = clean(m[1]).split(/(?<=[.;:])\s+(?=[A-Z(])/);
    const text = (parts[parts.length - 1] || '').trim().replace(/^[-•\s]+/, '');
    if (text.length > 20 && /[a-z]/i.test(text)) claims.push({ claim: text, file });
  }
  const seen = new Set();
  return claims.filter((c) => { const k = c.claim.toLowerCase().slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ── verify one claim against external reality ──
export async function verifyClaim(claim) {
  const prompt = `You are a careful fact-checker with web search. Assess ONE claim from a research wiki against reliable external sources (encyclopedias, scientific literature, reputable web).

CONTEXT: "VKFRI" = the Van Kush Family Research Institute, a small PRIVATE research group — it is NOT externally notable; do NOT look it up (and do NOT confuse it with any similarly-initialed school or organization). When a claim is phrased as "VKFRI notes/states/proposes that X", IGNORE the attribution wrapper and fact-check the underlying real-world assertion X (the science/history/date), not the institute.

CLAIM: "${claim}"

Decide ONE verdict about the underlying real-world assertion:
- SUPPORTED: reliable external sources agree the assertion is accurate.
- CONTRADICTED: reliable external sources show it is false or not a real/established thing (invented terminology like a molecule's "magnetic charge"; a biochemical mechanism not established in science; a wrong date).
- UNVERIFIABLE: a real-world assertion exists but there is no reliable external evidence either way.
- INTERNAL: the claim ONLY describes VKFRI's own framework, terminology, or teaching and makes NO externally checkable real-world assertion (e.g. "VKFRI calls this the spice cabinet a laboratory of consciousness").

Respond with STRICT JSON only:
{"verdict":"SUPPORTED|CONTRADICTED|UNVERIFIABLE|INTERNAL","confidence":0.0-1.0,"reason":"one sentence about the underlying assertion","source":"a URL or empty string"}`;
  const { text, citations } = await gemini(prompt, { grounded: true });
  const j = parseJson(text) || { verdict: 'UNVERIFIABLE', confidence: 0, reason: 'no parseable verdict', source: '' };
  if (!j.source && citations[0]) j.source = citations[0];
  return j;
}

// ── orchestrate: check a whole article ──
export async function checkArticle(wikiText, { title = 'untitled', topic = '' } = {}) {
  const claims = extractClaims(wikiText);
  const results = [];
  const t = topic || title;
  // small concurrency to be gentle on the API
  const BATCH = 3;
  for (let i = 0; i < claims.length; i += BATCH) {
    const slice = claims.slice(i, i + BATCH);
    const verdicts = await Promise.all(slice.map(async (c) => {
      const v = await verifyClaim(c.claim).catch((e) => ({ verdict: 'UNVERIFIABLE', confidence: 0, reason: 'check error: ' + e.message, source: '' }));
      const rec = { article: title, topic: t, claim: c.claim, file: c.file, ...v, checkedAt: nowISO() };
      // log + flag
      fs.mkdirSync(path.dirname(LOG), { recursive: true });
      fs.appendFileSync(LOG, JSON.stringify(rec) + '\n');
      recordFlag({ file: c.file, topic: t, claim: c.claim, verdict: v.verdict, reason: v.reason, evidence: v.source, checkedAt: rec.checkedAt });
      return rec;
    }));
    results.push(...verdicts);
  }
  const tally = results.reduce((a, r) => (a[r.verdict] = (a[r.verdict] || 0) + 1, a), {});
  return { title, topic: t, total: results.length, tally, results };
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node src/factChecker/index.js <article.wiki>'); process.exit(1); }
  const text = fs.readFileSync(file, 'utf8');
  const title = path.basename(file).replace(/\.wiki$/, '').replace(/_/g, ' ');
  const report = await checkArticle(text, { title });
  console.log(`\nFact-check: ${title} — ${report.total} claims`);
  console.log(`Verdicts:`, report.tally);
  for (const r of report.results) {
    const mark = { SUPPORTED: '✅', CONTRADICTED: '❌', UNVERIFIABLE: '❓', INTERNAL: '🏛️' }[r.verdict] || '·';
    console.log(`${mark} [${r.verdict}] ${r.claim.slice(0, 90)}${r.claim.length > 90 ? '…' : ''}`);
    if (r.verdict === 'CONTRADICTED') console.log(`     → ${r.reason}${r.source ? ` (${r.source})` : ''}  [source: ${r.file}]`);
  }
}
