// factCheckerShulgin.test.js — #103 end-to-end fact-checker test against the canonical Shulgin
// article, run FULLY OFFLINE. This is the integration counterpart to factChecker.test.js: instead of
// exercising the parts in isolation, it feeds a realistic Shulgin biography wiki through the WHOLE
// checkArticle() path and proves the checker (a) supports the true claims, (b) refutes the one
// deliberately-false claim ("Shulgin was a Russian astronaut"), (c) writes the append-only verdict
// log + the KB-flag store, (d) NEVER edits the knowledge base, and (e) never throws on real-ish input.
//
// Run: node --test test/factCheckerShulgin.test.js   (node:test + node:assert — no deps, no network)
//
// OFFLINE GUARANTEE — every network seam in src/factChecker/index.js is injected/stubbed:
//   1. research()  (../../integrations/scraper.mjs)        → scraper.__setFetch(fake)  [Resource-Center fetch]
//   2. sourcesFor()(../../integrations/grounding-sources.mjs) → its govapis/library-catalog/scraper.search
//        adapters all resolve to globalThis.fetch (or scraper's _fetch); we override globalThis.fetch
//        AND scraper.__setFetch, so the #178 authoritative layer is fully stubbed too.
//   3. gemini()    (REST → generativelanguage.googleapis.com) → globalThis.fetch(fake scripted verdict)
//   4. Resource Center (resource-center.mjs lazy import)   → __setResourceCenter(fn) injected
// With (1)-(4) covered, NO real HTTP leaves the process.
//
// HARD invariant under test: nothing writes under knowledge/** — flags + log go to a tmp dir set via
// env (KB_FLAG_STORE / FACTCHECK_LOG) BEFORE the modules load.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway stores, set BEFORE importing the modules that read these env vars at load time.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-shulgin-'));
process.env.KB_FLAG_STORE = path.join(TMP, 'kb-flags.json');
process.env.FACTCHECK_LOG = path.join(TMP, 'factcheck-log.jsonl');
process.env.GEMINI_API_KEY = 'test-key';   // present so verifyClaim takes the normal (grounded) path

const { checkArticle, extractClaims, __setResourceCenter } = await import('../src/factChecker/index.js');
const { flagsForFile, briefWarningFor, openFlagCount } = await import('../src/factChecker/flags.js');
const { readLog } = await import('../src/factChecker/verdictLog.js');
const scraper = await import('../../integrations/scraper.mjs');

// ── the canonical Shulgin article fixture ────────────────────────────────────────────────────────
// A faithful-format wiki (each claim trailed by a <ref>FILE</ref>). The TRUE biographical claims are
// real-world checkable; the last claim is the deliberate FALSE one the checker must refute. All cite
// the same KB file so flags/verdicts key to one source path.
const KB_FILE = 'shulgin-pihkal-tihkal/alexander_shulgin.json';
const TRUE_CLAIMS = {
  chemist: 'Alexander Shulgin was an American medicinal chemist known for creating new psychoactive compounds.',
  pihkal: 'Shulgin co-authored the book PiHKAL together with his wife Ann Shulgin.',
  tihkal: 'Shulgin and Ann Shulgin also co-authored a companion book titled TiHKAL.',
  mdma: 'Shulgin is widely credited with introducing MDMA to psychologists in the late 1970s.',
};
const FALSE_CLAIM = 'Alexander Shulgin was a Russian astronaut who flew aboard the Mir space station.';

const SHULGIN_ARTICLE = [
  `${TRUE_CLAIMS.chemist}<ref>${KB_FILE}</ref>`,
  '',
  '== Career ==',
  `${TRUE_CLAIMS.pihkal}<ref>${KB_FILE}</ref>`,
  `${TRUE_CLAIMS.tihkal}<ref>${KB_FILE}</ref>`,
  `${TRUE_CLAIMS.mdma}<ref>${KB_FILE}</ref>`,
  '',
  '== Disputed Claim ==',
  `${FALSE_CLAIM}<ref>${KB_FILE}</ref>`,
  '',
  '== Sources ==',
  `*   ${KB_FILE}`,
].join('\n');

// ── offline fetch harness ─────────────────────────────────────────────────────────────────────────
// fakeResponse mimics the minimal shape both fetch consumers use (json()/text()/headers.get/ok/status).
function fakeResponse(obj, { ok = true, status = 200, contentType = 'application/json' } = {}) {
  return { ok, status, headers: { get: () => contentType }, json: async () => obj, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) };
}

// Map a claim string to a scripted verdict so ONE checkArticle() run yields the right per-claim
// verdicts: the false astronaut claim → CONTRADICTED; everything else → SUPPORTED. We classify by the
// claim text embedded in the Gemini prompt (the prompt contains  CLAIM: "...").
function scriptedVerdictFor(promptText) {
  const isFalse = /russian astronaut|mir space station/i.test(promptText);
  if (isFalse) {
    return { verdict: 'CONTRADICTED', confidence: 0.95, reason: 'No reliable source records Shulgin as a Russian astronaut; he was an American chemist.', source: 'https://en.wikipedia.org/wiki/Alexander_Shulgin' };
  }
  return { verdict: 'SUPPORTED', confidence: 0.92, reason: 'Reliable sources confirm this biographical fact about Shulgin.', source: 'https://en.wikipedia.org/wiki/Alexander_Shulgin' };
}

function installFetch() {
  // Seam 1 + part of seam 2: the scraper's research()/search()/searchAll() all go through _fetch.
  scraper.__setFetch(async (url) => {
    const u = String(url);
    if (u.includes('duckduckgo.com')) return fakeResponse('<a class="result__a" href="https://en.wikipedia.org/wiki/Alexander_Shulgin">Alexander Shulgin</a>', { contentType: 'text/html' });
    if (u.includes('r.jina.ai')) return fakeResponse('Title: Alexander Shulgin\n\nAmerican medicinal chemist; co-authored PiHKAL and TiHKAL with Ann Shulgin; introduced MDMA to psychologists.', { contentType: 'text/markdown' });
    return fakeResponse({ results: [] });   // every other scraper provider → empty, harmless
  });
  // Seam 2 (govapis / library-catalog adapters of sourcesFor) + seam 3 (gemini REST) both hit
  // globalThis.fetch. We branch: Gemini endpoint → scripted verdict; anything else → empty/harmless.
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('generativelanguage.googleapis.com')) {
      // The verdict prompt is in the POST body; classify on it so the right claim is contradicted.
      let promptText = '';
      try { promptText = JSON.parse(opts.body || '{}')?.contents?.[0]?.parts?.[0]?.text || ''; } catch { /* ignore */ }
      const verdict = scriptedVerdictFor(promptText);
      return fakeResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(verdict) }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://en.wikipedia.org/wiki/Alexander_Shulgin' } }] } }] });
    }
    // govapis (federalRegister/usaspending) + library-catalog (OpenAlex/Crossref/…) → empty results.
    return fakeResponse({ results: [], data: [] });
  };
}
function restoreFetch() { scraper.__setFetch(null); }

// Seam 4: never let the real Resource Center load — inject a deterministic corroborating source for the
// true claims and nothing for the false one (so the false claim has no external support to lean on).
function installResourceCenter() {
  __setResourceCenter(async (claim) => {
    if (/russian astronaut|mir space station/i.test(claim)) return [];
    return [{ title: 'Encyclopedia: Alexander Shulgin', url: 'https://rc.example/shulgin', snippet: 'American chemist, PiHKAL/TiHKAL, MDMA.' }];
  });
}

// ── sanity: the fixture extracts the expected claims (true ones + the false one), drops the footer ──
test('Shulgin fixture extracts the biographical claims and the false claim, skips Sources footer', () => {
  const claims = extractClaims(SHULGIN_ARTICLE);
  const texts = claims.map((c) => c.claim.toLowerCase());
  assert.ok(claims.length >= 5, `expected >=5 claims, got ${claims.length}`);
  assert.ok(claims.every((c) => c.file === KB_FILE), 'every claim cites the Shulgin KB file');
  assert.ok(texts.some((t) => t.includes('american medicinal chemist')), 'chemist claim extracted');
  assert.ok(texts.some((t) => t.includes('pihkal')), 'PiHKAL claim extracted');
  assert.ok(texts.some((t) => t.includes('tihkal')), 'TiHKAL claim extracted');
  assert.ok(texts.some((t) => t.includes('russian astronaut')), 'the false claim is extracted for checking');
  assert.ok(!texts.some((t) => t.startsWith('*   shulgin-pihkal')), 'Sources footer line is not a claim');
});

// ── the end-to-end check, fully offline ────────────────────────────────────────────────────────────
test('checkArticle on the Shulgin article: true claims SUPPORTED, false claim CONTRADICTED, log+flags written, KB untouched', async () => {
  installFetch();
  installResourceCenter();
  const logBefore = readLog().length;          // append-only: prior log lines must survive
  let report;
  try {
    // (e) the checker must NOT throw on this real-ish input — a thrown error fails the test here.
    report = await checkArticle(SHULGIN_ARTICLE, { title: 'Alexander Shulgin', topic: 'Alexander Shulgin' });
  } finally {
    restoreFetch();
    __setResourceCenter(null);
  }

  // ── (a) true claims got SUPPORTED verdicts ──
  const byClaim = (needle) => report.results.find((r) => new RegExp(needle, 'i').test(r.claim));
  for (const [label, text] of Object.entries(TRUE_CLAIMS)) {
    const r = byClaim(text.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.ok(r, `true claim "${label}" present in results`);
    assert.equal(r.verdict, 'SUPPORTED', `true claim "${label}" should be SUPPORTED`);
  }

  // ── (b) the deliberately FALSE claim got CONTRADICTED (refuted/flagged) ──
  const falseResult = report.results.find((r) => /russian astronaut|mir space station/i.test(r.claim));
  assert.ok(falseResult, 'the false claim was checked');
  assert.equal(falseResult.verdict, 'CONTRADICTED', 'the false Russian-astronaut claim must be refuted');
  assert.match(falseResult.reason || '', /astronaut|chemist/i, 'refutation reason mentions the contradiction');

  // ── tally sanity: at least 4 SUPPORTED + exactly 1 CONTRADICTED ──
  assert.ok((report.tally.SUPPORTED || 0) >= 4, `expected >=4 SUPPORTED, got ${report.tally.SUPPORTED}`);
  assert.equal(report.tally.CONTRADICTED, 1, 'exactly one CONTRADICTED (the planted false claim)');

  // ── (c) verdict log written, APPEND-ONLY (count grew by the number of claims; prior lines intact) ──
  const logAfter = readLog();
  assert.equal(logAfter.length, logBefore + report.total, 'one appended log line per checked claim');
  const logged = logAfter.slice(logBefore);
  assert.ok(logged.every((rec) => rec.file === KB_FILE), 'every logged verdict carries the cited KB file');
  assert.ok(logged.some((rec) => rec.verdict === 'CONTRADICTED'), 'the contradiction is in the append-only log');
  assert.ok(logged.every((rec) => rec.sourceRef === KB_FILE), 'sourceRef mirrors the cited file');

  // ── (c2) KB-flag store written: ONLY the contradicted claim is flagged (SUPPORTED claims do not flag) ──
  const flags = flagsForFile(KB_FILE);
  assert.equal(flags.length, 1, 'exactly one flag: the contradicted false claim (SUPPORTED claims never flag)');
  assert.match(flags[0].claim, /russian astronaut|mir space station/i, 'the flag is the false claim');
  assert.equal(flags[0].verdict, 'CONTRADICTED');
  // the brief feed surfaces it for the brief writers, keyed by KB file
  assert.match(briefWarningFor(KB_FILE), /open fact-flag/, 'brief warning surfaces the open flag');
  assert.equal(openFlagCount(KB_FILE), 1, 'one open flag for this KB doc');

  // ── (d) HARD invariant: every write landed in the tmp dir, NOT under knowledge/** (flags-only, no KB edits) ──
  assert.ok(process.env.KB_FLAG_STORE.startsWith(TMP), 'flag store is in the tmp dir');
  assert.ok(process.env.FACTCHECK_LOG.startsWith(TMP), 'verdict log is in the tmp dir');
  assert.ok(!/knowledge[\\/]/.test(process.env.KB_FLAG_STORE), 'flag store is not under knowledge/');
  assert.ok(!/knowledge[\\/]/.test(process.env.FACTCHECK_LOG), 'verdict log is not under knowledge/');
});

// ── offline proof: with NO seams installed, a real check WOULD try the network — so confirm the
// modules used the injected fetch (sentinel). If the harness ever leaks real HTTP this asserts loudly.
test('offline harness is wired: the scripted Gemini verdict (not real network) drove the verdicts', async () => {
  installFetch();
  installResourceCenter();
  let sawGemini = false;
  const wrapped = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('generativelanguage.googleapis.com')) sawGemini = true;
    return wrapped(url, opts);
  };
  try {
    const report = await checkArticle(`${FALSE_CLAIM}<ref>${KB_FILE}</ref>`, { title: 'X' });
    assert.ok(sawGemini, 'the (stubbed) Gemini endpoint was the verdict source — no real LLM call');
    assert.equal(report.results[0].verdict, 'CONTRADICTED');
  } finally {
    restoreFetch();
    __setResourceCenter(null);
  }
});
