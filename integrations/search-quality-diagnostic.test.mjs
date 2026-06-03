// search-quality-diagnostic.test.mjs — offline guards for the Resource-Center search quality
// diagnostic (task #132). NO network: runDiagnostic's search source is injected with canned rows.
//   node --test integrations/search-quality-diagnostic.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreResult, diagnose, runDiagnostic, digestibilityHint, healthBlock, __setSearch,
} from './search-quality-diagnostic.mjs';

// ── canned results ───────────────────────────────────────────────────────────────────────────────
const GOOD = {
  title: 'Alexander Shulgin',
  url: 'https://en.wikipedia.org/wiki/Alexander_Shulgin',
  snippet: 'American chemist and pharmacologist who synthesized and bioassayed hundreds of psychoactive compounds; author of PiHKAL (1991).',
  provider: 'wikipedia',
};
const SCHOLARLY = {
  title: 'PiHKAL phenethylamine synthesis',
  url: 'https://doi.org/10.1021/abc',
  snippet: 'Peer-reviewed synthesis route for phenethylamines. doi:10.1021/abc (1991).',
  providers: ['crossref', 'openalex'],
};
const BAD = {
  title: 'Top 10 Facts You Won\'t Believe',
  url: 'https://listverse.com/x',
  snippet: 'x',
  provider: 'duckduckgo',
};
const NO_SOURCE = { title: 'mystery', url: '', snippet: '', provider: '' };

test('scoreResult: relevant, well-sourced, concise result scores high overall', () => {
  const s = scoreResult(GOOD, 'alexander shulgin pihkal');
  assert.ok(s.overall >= 0.75, `expected high overall, got ${s.overall}`);
  assert.ok(s.relevance >= 0.8, `relevance ${s.relevance}`);
  assert.ok(s.sourceQuality >= 0.6, `sourceQuality ${s.sourceQuality}`);
  assert.ok(s.digestibility >= 0.8, `digestibility ${s.digestibility}`);
  assert.equal(s.dedup, 1);
  // every sub-score is a 0..1 number.
  for (const k of ['relevance', 'sourceQuality', 'digestibility', 'dedup', 'overall']) {
    assert.ok(s[k] >= 0 && s[k] <= 1, `${k} out of range: ${s[k]}`);
  }
});

test('scoreResult: irrelevant + source-less + clickbait result scores low', () => {
  const s = scoreResult(BAD, 'alexander shulgin pihkal');
  assert.ok(s.overall < 0.4, `expected low overall, got ${s.overall}`);
  assert.ok(s.sourceQuality < 0.4, `expected low sourceQuality, got ${s.sourceQuality}`);
  const ns = scoreResult(NO_SOURCE, 'alexander shulgin pihkal');
  assert.ok(ns.overall < 0.35, `no-source overall ${ns.overall}`);
});

test('scoreResult: a marked duplicate drops the dedup sub-score to 0', () => {
  const s = scoreResult({ ...GOOD, _dupOf: true }, 'alexander shulgin');
  assert.equal(s.dedup, 0);
  const fresh = scoreResult(GOOD, 'alexander shulgin');
  assert.ok(s.overall < fresh.overall, 'duplicate should lower overall vs fresh');
});

test('scoreResult: deterministic — same inputs give identical output', () => {
  const a = scoreResult(GOOD, 'alexander shulgin pihkal');
  const b = scoreResult(GOOD, 'alexander shulgin pihkal');
  assert.deepEqual(a, b);
});

test('diagnose: computes averages, a grade, and flags low-quality + duplicates', () => {
  // three near-duplicate wikipedia rows + clickbait → high dup rate + low-quality flag.
  const results = [
    GOOD,
    { ...GOOD, url: 'http://en.wikipedia.org/wiki/Alexander_Shulgin?utm_source=ddg', provider: 'duckduckgo' },
    { ...GOOD, url: 'https://en.wikipedia.org/wiki/Alexander_Shulgin#bio', provider: 'bing' },
    BAD,
  ];
  const d = diagnose('alexander shulgin pihkal', results);
  assert.equal(d.n, 4);
  assert.ok(d.avgRelevance >= 0 && d.avgRelevance <= 1);
  assert.ok(['A', 'B', 'C', 'D', 'F'].includes(d.grade));
  assert.ok(d.duplicateRate >= 0.4, `dup rate ${d.duplicateRate}`);
  assert.ok(d.lowQualityCount >= 1, `lowQualityCount ${d.lowQualityCount}`);
  assert.ok(d.problems.some((p) => /duplicate/i.test(p)), 'should flag high duplicate rate');
  assert.equal(d.scores.length, 4);
});

test('diagnose: a majority-weak set flags "too many low-quality sources"', () => {
  const d = diagnose('alexander shulgin', [
    BAD,
    { title: 'Best 5 Shulgin Tricks', url: 'https://ehow.com/y', snippet: 'z', provider: 'bing' },
    { title: 'spam', url: 'https://wikihow.com/z', snippet: 'q', provider: 'bing' },
    GOOD,
  ]);
  assert.ok(d.lowQualityCount >= 3, `lowQualityCount ${d.lowQualityCount}`);
  assert.ok(d.problems.some((p) => /low-quality/i.test(p)), 'should flag low-quality sources');
});

test('diagnose: empty results → grade F + thin-results problem', () => {
  const d = diagnose('anything', []);
  assert.equal(d.n, 0);
  assert.equal(d.grade, 'F');
  assert.ok(d.problems.some((p) => /thin/i.test(p)));
});

test('diagnose: a clean set of strong results grades well', () => {
  const d = diagnose('alexander shulgin pihkal', [
    GOOD, SCHOLARLY,
    { title: 'Shulgin biography', url: 'https://www.britannica.com/biography/shulgin', snippet: 'A concise encyclopedia biography of the chemist Alexander Shulgin and his work on psychoactive phenethylamines.', provider: 'bing' },
  ]);
  assert.ok(['A', 'B', 'C'].includes(d.grade), `grade ${d.grade}`);
  assert.equal(d.duplicateRate, 0);
});

test('runDiagnostic: aggregates across probe queries via injected search (offline)', async () => {
  __setSearch(async (q) => {
    if (/empty/.test(q)) return [];
    return [GOOD, SCHOLARLY];
  });
  const report = await runDiagnostic(['alexander shulgin pihkal', 'empty query test']);
  __setSearch(null);
  assert.equal(report.queries, 2);
  assert.ok(report.avgOverall >= 0 && report.avgOverall <= 1);
  assert.ok(['A', 'B', 'C', 'D', 'F'].includes(report.grade));
  assert.equal(report.perQuery.length, 2);
  const empty = report.perQuery.find((p) => /empty/.test(p.query));
  assert.equal(empty.grade, 'F');
  assert.ok(empty.problems.some((p) => /thin/i.test(p)));
  assert.ok(Array.isArray(report.problems));
});

test('runDiagnostic: injected search via opts.search takes precedence; throwing search soft-fails', async () => {
  __setSearch(null);
  const report = await runDiagnostic(['q1', 'q2'], {
    search: async (q) => { if (q === 'q2') throw new Error('upstream down'); return [GOOD]; },
  });
  assert.equal(report.queries, 2);
  const q2 = report.perQuery.find((p) => p.query === 'q2');
  assert.equal(q2.n, 0); // threw → treated as empty, pass still completed.
  assert.equal(q2.grade, 'F');
});

test('runDiagnostic: accepts {results} envelope shape from the search source', async () => {
  const report = await runDiagnostic(['x'], { search: async () => ({ results: [GOOD, SCHOLARLY] }) });
  assert.equal(report.perQuery[0].n, 2);
});

test('digestibilityHint: gives targeted fixes', () => {
  assert.match(digestibilityHint({ ...GOOD, _dupOf: true }), /duplicate/i);
  assert.match(digestibilityHint({ title: 't', url: 'https://x.com', snippet: '' }), /add a snippet/i);
  assert.match(digestibilityHint({ title: 't', url: 'https://x.com', snippet: 'tiny' }), /expand|thin/i);
  assert.match(digestibilityHint({ title: 't', url: 'https://x.com', snippet: 'a'.repeat(700) }), /trim/i);
  assert.match(digestibilityHint(GOOD, 'alexander shulgin pihkal'), /good/i);
});

test('healthBlock: renders a brief-ready markdown block', async () => {
  const report = await runDiagnostic(['alexander shulgin pihkal'], { search: async () => [GOOD, SCHOLARLY] });
  const md = healthBlock(report);
  assert.match(md, /### Search quality/);
  assert.match(md, /Overall grade/);
  assert.match(md, /alexander shulgin pihkal/);
  assert.match(md, /search-quality-diagnostic\.mjs/);
  // null-safe.
  assert.match(healthBlock(null), /### Search quality/);
});
