// factChecker.test.js — tests for the fact-checker pipeline (#103): claim extraction (#99), KB-doc
// extraction (#136), the append-only verdict log (#101), the KB-flag store (#104), the brief feed
// (#123), and the verify orchestration (#100) driven fully OFFLINE via injected fetch (no network).
//
// Run: node test/factChecker.test.js   (node:test + node:assert, no new deps, no network)
//
// HARD invariant under test: nothing here writes to knowledge/** — flags + log go to tmp stores set
// via env (KB_FLAG_STORE / FACTCHECK_LOG) BEFORE the modules load.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the flag store + verdict log at throwaway tmp files BEFORE importing the modules that read env.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-'));
process.env.KB_FLAG_STORE = path.join(TMP, 'kb-flags.json');
process.env.FACTCHECK_LOG = path.join(TMP, 'factcheck-log.jsonl');
process.env.GEMINI_API_KEY = 'test-key';            // present so verify takes the normal path

const { extractClaims, verifyClaim, checkArticle, __setResourceCenter } = await import('../src/factChecker/index.js');
const { extractKbClaims, checkKbDoc } = await import('../src/factChecker/kbCheck.js');
const { recordFlag, flagsForFile, flagsForTopic, briefWarningFor, openFlagCount } = await import('../src/factChecker/flags.js');
const { logVerdict, readLog, logTallyForFile } = await import('../src/factChecker/verdictLog.js');
const scraper = await import('../../integrations/scraper.mjs');

// ── offline fetch harness ───────────────────────────────────────────────────────────────────────
// The scraper uses its injectable _fetch (__setFetch); verifyClaim's Gemini call uses globalThis.fetch.
// We make the scraper return one fake evidence page, and Gemini return a scripted verdict per claim.
let geminiVerdict = { verdict: 'SUPPORTED', confidence: 0.9, reason: 'evidence agrees', source: '' };
function fakeResponse(obj, { ok = true, status = 200, contentType = 'application/json' } = {}) {
  return { ok, status, headers: { get: () => contentType }, json: async () => obj, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) };
}
function installFetch() {
  // scraper fetch: DDG/search endpoints → minimal HTML/JSON; Jina/page fetch → markdown text.
  scraper.__setFetch(async (url) => {
    const u = String(url);
    if (u.includes('duckduckgo.com')) return fakeResponse('<a class="result__a" href="https://en.wikipedia.org/wiki/Test">Test</a>', { contentType: 'text/html' });
    if (u.includes('r.jina.ai')) return fakeResponse('Title: Test Page\n\nReal fetched evidence content for grounding.', { contentType: 'text/markdown' });
    return fakeResponse({ results: [] });            // every other search provider → empty, harmless
  });
  // Gemini fetch (verifyClaim → gemini()): return the scripted verdict as a candidate part.
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return fakeResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiVerdict) }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://en.wikipedia.org/wiki/Test' } }] } }] });
    }
    return fakeResponse({});
  };
}
function restoreFetch() { scraper.__setFetch(null); }

// ── #99 claim extraction from a generated wiki article (with <ref> tags) ──────────────────────────
test('extractClaims pulls one claim per <ref>, dedupes, skips Sources footer', () => {
  const wiki = [
    'Bitcoin was created in 2009 by Satoshi Nakamoto.<ref>crypto/btc.json</ref>',
    'It uses a proof-of-work consensus mechanism to secure the ledger.<ref>crypto/btc.json</ref>',
    'It uses a proof-of-work consensus mechanism to secure the ledger.<ref>crypto/btc.json</ref>', // dup
    '== Sources ==',
    '* <ref>crypto/btc.json</ref>',                  // must be ignored (footer)
  ].join('\n');
  const claims = extractClaims(wiki);
  assert.ok(claims.length >= 2, 'at least two distinct claims');
  assert.ok(claims.every((c) => c.file === 'crypto/btc.json'));
  const texts = claims.map((c) => c.claim.toLowerCase());
  // dedupe: the repeated proof-of-work sentence appears once
  assert.equal(texts.filter((t) => t.includes('proof-of-work')).length, 1);
  assert.ok(!texts.some((t) => t.includes('* <ref>')), 'footer line not treated as a claim');
});

// ── #136 KB-doc extraction (raw JSON / Markdown, NO <ref> tags) ───────────────────────────────────
test('extractKbClaims pulls prose claims from a raw KB JSON doc and skips metadata', () => {
  const doc = JSON.stringify({
    title: 'Ignore Me Title',                        // META_KEYS → skipped
    author: 'Ignore Me Author',
    body: 'Graphene is a blockchain framework that powers BitShares and Steem.',
    detail: { mechanism: 'Delegated proof-of-stake elects a fixed set of block producers called witnesses.' },
    tags: ['ignore', 'these'],                       // tags key → skipped
  });
  const claims = extractKbClaims(doc, '.json');
  const joined = claims.join(' || ').toLowerCase();
  assert.ok(joined.includes('graphene'), 'body prose extracted');
  assert.ok(joined.includes('delegated proof-of-stake'), 'nested prose extracted');
  assert.ok(!joined.includes('ignore me'), 'metadata values (title/author) skipped');
});

test('extractKbClaims handles a Markdown KB doc', () => {
  const md = '# Heading\n\n- BitShares is a decentralized exchange built on the Graphene framework.\n\nSome short line.';
  const claims = extractKbClaims(md, '.md');
  assert.ok(claims.some((c) => /bitshares is a decentralized exchange/i.test(c)));
  assert.ok(!claims.some((c) => /^heading$/i.test(c)), 'bare heading is not a claim');
});

// ── #101 append-only verdict log ──────────────────────────────────────────────────────────────────
test('logVerdict appends one JSONL line per call and never truncates', () => {
  const logFile = path.join(TMP, 'append.jsonl');
  logVerdict({ article: 'A', claim: 'c1', file: 'f/one.json', verdict: 'SUPPORTED', confidence: 1 }, logFile);
  logVerdict({ article: 'A', claim: 'c2', file: 'f/one.json', verdict: 'CONTRADICTED', confidence: 0.3 }, logFile);
  logVerdict({ article: 'B', claim: 'c3', file: 'f/two.json', verdict: 'UNVERIFIABLE' }, logFile);
  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3, 'three appends → three lines');
  const recs = readLog(logFile);
  assert.equal(recs.length, 3);
  assert.equal(recs[0].sourceRef, 'f/one.json');     // sourceRef mirrors file
  // tally helper groups by file
  const tally = logTallyForFile('f/one.json', recs);
  assert.deepEqual(tally, { SUPPORTED: 1, CONTRADICTED: 1 });
  // re-logging does NOT overwrite earlier lines (append-only)
  logVerdict({ article: 'C', claim: 'c4', file: 'f/two.json', verdict: 'SUPPORTED' }, logFile);
  assert.equal(readLog(logFile).length, 4);
});

// ── #104 KB-flag store: only CONTRADICTED/UNVERIFIABLE flag; SUPPORTED heals ──────────────────────
test('recordFlag stores disputes by file, ignores SUPPORTED, and heals on re-check', () => {
  const file = 'history/claim.json';
  recordFlag({ file, topic: 'History', claim: 'A false thing', verdict: 'CONTRADICTED', reason: 'wrong date', evidence: 'https://e', checkedAt: '2026-06-02T00:00:00Z' });
  recordFlag({ file, topic: 'History', claim: 'A real thing', verdict: 'SUPPORTED', checkedAt: '2026-06-02T00:00:00Z' });
  let flags = flagsForFile(file);
  assert.equal(flags.length, 1, 'only the CONTRADICTED claim is flagged');
  assert.equal(flags[0].claim, 'A false thing');
  // topic lookup finds it too
  assert.ok(flagsForTopic('history').some((f) => f.claim === 'A false thing'));
  // a later re-check that now SUPPORTS the claim heals (removes) the flag
  recordFlag({ file, topic: 'History', claim: 'A false thing', verdict: 'SUPPORTED', checkedAt: '2026-06-02T01:00:00Z' });
  assert.equal(flagsForFile(file).length, 0, 're-check healed the flag');
});

// ── #123 brief feed: file-or-topic, with the open-flag count ──────────────────────────────────────
test('briefWarningFor surfaces flags by KB FILE or TOPIC with an N-count; openFlagCount agrees', () => {
  const file = 'crypto/disputed.json';
  recordFlag({ file, topic: 'Disputed Coin', claim: 'It has a magnetic charge', verdict: 'CONTRADICTED', reason: 'not a real property', checkedAt: '2026-06-02T00:00:00Z' });
  recordFlag({ file, topic: 'Disputed Coin', claim: 'It launched in 1492', verdict: 'UNVERIFIABLE', reason: 'no evidence', checkedAt: '2026-06-02T00:00:00Z' });
  // by FILE (path-like → exact key)
  const byFile = briefWarningFor(file);
  assert.match(byFile, /KB doc "crypto\/disputed\.json"/);
  assert.match(byFile, /has 2 open fact-flag/);
  assert.match(byFile, /magnetic charge/);
  assert.equal(openFlagCount(file), 2);
  // by TOPIC (free text → fuzzy)
  const byTopic = briefWarningFor('Disputed Coin');
  assert.match(byTopic, /"Disputed Coin"/);
  assert.match(byTopic, /has 2 open fact-flag/);
  // clean topic → empty string, count 0
  assert.equal(briefWarningFor('Totally Clean Subject'), '');
  assert.equal(openFlagCount('Totally Clean Subject'), 0);
});

// ── #100 verify orchestration, OFFLINE: verdict flows to the right store ──────────────────────────
test('verifyClaim returns a verdict grounded in fetched evidence (offline harness)', async () => {
  installFetch();
  try {
    geminiVerdict = { verdict: 'CONTRADICTED', confidence: 0.8, reason: 'the date is wrong', source: '' };
    const v = await verifyClaim('Some checkable real-world claim about a date.');
    assert.equal(v.verdict, 'CONTRADICTED');
    assert.ok(Array.isArray(v.evidence_urls));
    assert.ok(v.evidence_urls.length >= 1, 'evidence URLs captured from grounding/fetch');
  } finally { restoreFetch(); }
});

// ── #136-lib Resource Center as an ADDITIONAL evidence source (injected; offline) ──────────────────
test('verifyClaim folds in injected Resource Center evidence (corroboration → evidence_urls)', async () => {
  installFetch();
  let rcCalled = false;
  __setResourceCenter(async (claim, opts) => {
    rcCalled = true;
    return [
      { title: 'RC corroborating source', url: 'https://gov.example/record-1', snippet: 'Authoritative corroborating text.' },
      { title: 'RC second source', url: 'https://scholarly.example/paper-2', snippet: 'Peer-reviewed agreement.' },
    ];
  });
  try {
    geminiVerdict = { verdict: 'SUPPORTED', confidence: 0.9, reason: 'evidence agrees', source: '' };
    const v = await verifyClaim('A claim the Resource Center corroborates.');
    assert.ok(rcCalled, 'the injected Resource Center query was used');
    assert.equal(v.verdict, 'SUPPORTED');
    // the RC-surfaced URL is folded into the evidence the same way other sources are
    assert.ok(v.evidence_urls.includes('https://gov.example/record-1'), 'Resource Center URL folded into evidence_urls');
  } finally { restoreFetch(); __setResourceCenter(null); }
});

test('verifyClaim soft-fails when the Resource Center throws (unchanged verdict behavior)', async () => {
  installFetch();
  __setResourceCenter(async () => { throw new Error('resource center down'); });
  try {
    geminiVerdict = { verdict: 'CONTRADICTED', confidence: 0.8, reason: 'the date is wrong', source: '' };
    // must still return a normal verdict — exactly as before the Resource Center existed
    const v = await verifyClaim('Some checkable real-world claim about a date.');
    assert.equal(v.verdict, 'CONTRADICTED');
    assert.ok(Array.isArray(v.evidence_urls));
    assert.ok(v.evidence_urls.length >= 1, 'evidence still captured from the other sources');
  } finally { restoreFetch(); __setResourceCenter(null); }
});

test('verifyClaim Resource Center evidence can lift an otherwise-unverifiable verdict (additive)', async () => {
  // With NO scraper/grounding evidence AND no Gemini citations, a SUPPORTED verdict is normally
  // downgraded to UNVERIFIABLE. An injected Resource Center hit supplies external evidence, so the
  // fetchedCount > 0 guard is satisfied and the SUPPORTED verdict survives — proving the fold is additive.
  scraper.__setFetch(async () => fakeResponse({ results: [] }));   // scraper + jina → no evidence
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      // no groundingChunks → no Gemini citations either
      return fakeResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiVerdict) }] } }] });
    }
    return fakeResponse({});
  };
  __setResourceCenter(async () => [{ title: 'RC only', url: 'https://rc.example/only', snippet: 'agrees' }]);
  try {
    geminiVerdict = { verdict: 'SUPPORTED', confidence: 0.9, reason: 'evidence agrees', source: '' };
    const v = await verifyClaim('A claim only the Resource Center can corroborate.');
    assert.equal(v.verdict, 'SUPPORTED', 'RC evidence kept it from being downgraded to UNVERIFIABLE');
    assert.ok(v.evidence_urls.includes('https://rc.example/only'));
    assert.ok(v.evidence_fetched >= 1, 'Resource Center counted toward fetched evidence');
  } finally { restoreFetch(); __setResourceCenter(null); }
});

test('checkArticle logs every verdict (append-only) and flags the contradicted claim, never edits KB', async () => {
  installFetch();
  const before = readLog().length;                   // existing log untouched (append-only)
  try {
    geminiVerdict = { verdict: 'CONTRADICTED', confidence: 0.7, reason: 'external sources disagree', source: '' };
    const wiki = 'The widget was invented in the year 3000 by nobody at all.<ref>tech/widget.json</ref>';
    const report = await checkArticle(wiki, { title: 'Widget' });
    assert.equal(report.total, 1);
    assert.equal(report.tally.CONTRADICTED, 1);
    // verdict appended to the (shared) log — count grew, prior lines intact
    const after = readLog();
    assert.equal(after.length, before + 1);
    assert.equal(after[after.length - 1].file, 'tech/widget.json');
    // contradicted claim landed in the flag store keyed by the cited KB file
    assert.equal(flagsForFile('tech/widget.json').length, 1);
  } finally { restoreFetch(); }
});

test('checkKbDoc checks a raw KB doc against RC evidence and flags by the KB file key (offline)', async () => {
  installFetch();
  try {
    geminiVerdict = { verdict: 'CONTRADICTED', confidence: 0.6, reason: 'no such mechanism', source: '' };
    const doc = JSON.stringify({ body: 'The compound gains energy through a biochemical mechanism that boosts its magnetic charge.' });
    const report = await checkKbDoc(doc, { kbFile: 'chem/compound.json', ext: '.json' });
    assert.ok(report.total >= 1);
    assert.ok((report.tally.CONTRADICTED || 0) >= 1);
    assert.ok(flagsForFile('chem/compound.json').length >= 1, 'flag keyed by the real KB path');
    // brief feed can now report the count for this KB doc
    assert.match(briefWarningFor('chem/compound.json'), /open fact-flag/);
  } finally { restoreFetch(); }
});

// ── invariant: no test wrote anywhere under a knowledge/ path ──────────────────────────────────────
test('all writes stayed in tmp — KB-flag store + log are under the tmp dir, not knowledge/**', () => {
  assert.ok(process.env.KB_FLAG_STORE.startsWith(TMP));
  assert.ok(process.env.FACTCHECK_LOG.startsWith(TMP));
  assert.ok(!/knowledge[\\/]/.test(process.env.KB_FLAG_STORE));
  assert.ok(!/knowledge[\\/]/.test(process.env.FACTCHECK_LOG));
});
