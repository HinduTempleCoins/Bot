// Tests for the article-quality pipeline (#90): grounding sources (#69), coverage flag (#72),
// fact-check report shape (#70), provenance log append (#89). node:test + node:assert, no new deps,
// no network. Run: node test/provenance.test.js
//
// node --check is run on every source file in CI; this file exercises the pure-data + file helpers.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  normaliseSources,
  buildGroundingFooter,
  computeCoverage,
  buildCoverageFooter,
  appendProvenanceLog,
  writeFactCheckReport,
  tokenCount,
} from '../src/provenance.js';

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prov-')), name);
}

// ── #69 grounding sources attached ────────────────────────────────────────────────────────────
test('normaliseSources collects KB + external sources, de-dupes, counts tokens', () => {
  const kb = [
    { source: 'cryptocurrency/foo.json', domain: 'cryptocurrency', content: 'one two three four five' },
    { source: 'cryptocurrency/foo.json', domain: 'cryptocurrency', content: 'six seven' }, // dup id
    { source: 'history/bar.md', domain: 'history', content: 'alpha beta' },
  ];
  const ext = [{ title: 'BitSharesTalk', url: 'https://bitsharestalk.org/', excerpt: 'forum text here' }];
  const out = normaliseSources(kb, ext);
  const ids = out.map((s) => s.id).sort();
  assert.deepEqual(ids, ['cryptocurrency/foo.json', 'history/bar.md', 'https://bitsharestalk.org/']);
  const foo = out.find((s) => s.id === 'cryptocurrency/foo.json');
  assert.equal(foo.kind, 'kb');
  assert.equal(foo.tokens, 7); // 5 + 2 summed across the duplicate
  const url = out.find((s) => s.kind === 'external');
  assert.equal(url.id, 'https://bitsharestalk.org/');
});

test('buildGroundingFooter lists real KB ids + external URLs, empty when no sources', () => {
  const sources = normaliseSources(
    [{ source: 'cryptocurrency/foo.json', content: 'x y z' }],
    [{ url: 'https://example.org/', excerpt: 'a b c' }]
  );
  const footer = buildGroundingFooter(sources);
  assert.match(footer, /== Sources \(grounding\) ==/);
  assert.match(footer, /<ref>cryptocurrency\/foo\.json<\/ref>/);
  assert.match(footer, /https:\/\/example\.org\//);
  assert.ok(!/placeholder/i.test(footer), 'footer must not be a placeholder');
  assert.equal(buildGroundingFooter([]), ''); // no sources → no placeholder footer
});

// ── #72 coverage flag triggers on thin input ──────────────────────────────────────────────────
test('computeCoverage flags a thin section and passes a well-grounded one', () => {
  // Well-grounded section: 2 distinct refs + plenty of tokens. Thin section: 1 ref, few tokens.
  const wellBody = Array(150).fill('word').join(' ');
  const wiki = [
    `== Overview ==`,
    `${wellBody}<ref>cryptocurrency/foo.json</ref> more text<ref>history/bar.md</ref>`,
    ``,
    `== Stub ==`,
    `Sparse.<ref>cryptocurrency/foo.json</ref>`,
  ].join('\n');
  const sources = normaliseSources(
    [{ source: 'cryptocurrency/foo.json', content: 'c' }, { source: 'history/bar.md', content: 'b' }],
    []
  );
  const cov = computeCoverage(wiki, sources);
  const overview = cov.sections.find((s) => s.heading === 'Overview');
  const stub = cov.sections.find((s) => s.heading === 'Stub');
  assert.equal(overview.thin, false, 'Overview should be well-grounded');
  assert.equal(stub.thin, true, 'Stub should be flagged thin');
  assert.equal(stub.flag, cov.thinFlag);
  assert.equal(cov.thin, 1);
  assert.equal(cov.wellCovered, 1);
  // the coverage footer surfaces the thin section by name
  const footer = buildCoverageFooter(cov);
  assert.match(footer, /== Coverage \(audit\) ==/);
  assert.match(footer, /Stub/);
  assert.match(footer, /thin evidence/);
});

test('computeCoverage skips metadata footers (Sources/Coverage) when grading', () => {
  const wiki = [
    '== Body ==',
    'content<ref>a/b.json</ref>',
    '== Sources (grounding) ==',
    '* <ref>a/b.json</ref>',
    '== Coverage (audit) ==',
    'Coverage: 1/1',
  ].join('\n');
  const cov = computeCoverage(wiki, normaliseSources([{ source: 'a/b.json', content: 'x' }], []));
  const headings = cov.sections.map((s) => s.heading);
  assert.deepEqual(headings, ['Body']); // metadata sections excluded
});

// ── #70 fact-check report shape ───────────────────────────────────────────────────────────────
test('writeFactCheckReport produces an advisory report with the right per-claim shape', () => {
  const reportPath = tmpFile('Foo.factcheck.json');
  const report = {
    title: 'Foo',
    topic: 'Foo',
    total: 2,
    tally: { SUPPORTED: 1, CONTRADICTED: 1 },
    results: [
      { claim: 'X is true', verdict: 'SUPPORTED', file: 'a/b.json', confidence: 0.9, reason: 'agrees', evidence_urls: ['https://e1'] },
      { claim: 'Y is false', verdict: 'CONTRADICTED', file: 'c/d.json', confidence: 0.4, reason: 'disagrees' },
    ],
  };
  const out = writeFactCheckReport(reportPath, report);
  assert.equal(out.advisory, true);
  assert.match(out.note, /FLAG-ONLY/);
  assert.equal(out.total, 2);
  const r0 = out.results[0];
  assert.deepEqual(Object.keys(r0).sort(), ['claim', 'confidence', 'evidence', 'reason', 'sourceRef', 'verdict']);
  assert.equal(r0.sourceRef, 'a/b.json'); // mapped from file
  assert.deepEqual(r0.evidence, ['https://e1']);
  // persisted to disk and re-readable as JSON
  const onDisk = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(onDisk.results[1].verdict, 'CONTRADICTED');
  assert.equal(onDisk.results[1].confidence, 0.4);
});

// ── #89 provenance log append ─────────────────────────────────────────────────────────────────
test('appendProvenanceLog appends one JSONL line per call (append-only)', () => {
  const logPath = tmpFile('_provenance.jsonl');
  const rec1 = appendProvenanceLog(logPath, {
    stamp: 'BitShares',
    article: 'BitShares',
    sourceDocIds: ['cryptocurrency/foo.json'],
    externalUrls: ['https://bitsharestalk.org/'],
    model: 'gemini-2.5-flash',
    coverage: { wellCovered: 5, thin: 1 },
    factCheckSummary: { total: 3, tally: { SUPPORTED: 3 } },
    generatedAt: '2026-06-02T00:00:00.000Z',
  });
  assert.equal(rec1.article, 'BitShares');
  appendProvenanceLog(logPath, { stamp: 'HIVE', article: 'HIVE Blockchain' });

  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2, 'two append calls → two JSONL lines');
  const first = JSON.parse(lines[0]);
  assert.deepEqual(first.sourceDocIds, ['cryptocurrency/foo.json']);
  assert.equal(first.model, 'gemini-2.5-flash');
  assert.equal(first.generatedAt, '2026-06-02T00:00:00.000Z');
  const second = JSON.parse(lines[1]);
  assert.equal(second.article, 'HIVE Blockchain');
  assert.deepEqual(second.sourceDocIds, []); // defaults applied
});

test('tokenCount counts whitespace-delimited tokens', () => {
  assert.equal(tokenCount(''), 0);
  assert.equal(tokenCount('one two three'), 3);
  assert.equal(tokenCount('  spaced   out  '), 2);
});
