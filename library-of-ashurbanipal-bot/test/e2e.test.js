// e2e.test.js — Ashurbanipal end-to-end verification harness (Task #97).
//
// ONE offline harness that exercises ALL the library bot's surfaces TOGETHER and asserts the whole
// pipeline holds — including the load-bearing SAFETY INVARIANTS. It is the integration counterpart to
// the per-module unit tests (reviewQueue / knowledgeLoader / provenance / factChecker / mwRender /
// chatSurface): rather than re-test each unit, it wires them into the real flow a published article
// would take, and proves the seams line up and the invariants survive end-to-end.
//
// PIPELINE under test (mirrors how the bot really works):
//   load  → draft → ground → fact-check → flag → review-queue → render → chat
//
// Each surface uses the SAME injection seams the unit tests use — nothing here reaches a network, a
// real LLM, or knowledge/**:
//   - KnowledgeLoader            : a throwaway tmp KB tree under os.tmpdir() (filesystem-pure loader).
//   - provenance (grounding)     : pure functions — normaliseSources / buildGroundingFooter /
//                                  computeCoverage / appendProvenanceLog — fed the exact sources used.
//   - factChecker                : scraper.__setFetch + globalThis.fetch (Gemini) + __setResourceCenter,
//                                  with KB_FLAG_STORE / FACTCHECK_LOG / KB_FLAG_JSONL pointed at tmp
//                                  BEFORE the modules import (env-read-at-load), exactly as the unit test.
//   - reviewQueue                : in-memory fs + frozen clock + deterministic ids (injected).
//   - mwRender                   : pure markup→HTML.
//   - chatSurface                : __setBackends (search / liveData) — no disk, no network, no LLM.
//
// SAFETY INVARIANTS asserted end-to-end:
//   (A) NO-PUBLISH-WITHOUT-APPROVAL  — a pending draft refuses markPublished; only an approved one publishes.
//   (B) NO-KB-WRITE                  — fact-checking + flagging NEVER writes under knowledge/**. Asserted
//                                      both by construction (every store path is under tmp, none under
//                                      knowledge/) AND by an fs WRITE SPY that records every path written
//                                      during the whole flow and asserts none is under knowledge/.
//   (C) GROUNDED-OR-HONEST           — !ask answers only from sourced rows with citations; an unsourced
//                                      query gets the honest "no grounded source" reply, never a fabrication.
//   (D) XSS-SAFE RENDER              — a hostile <script>/onerror payload smuggled into the markup produces
//                                      no live HTML; only escaped, inert text.
//   (E) NEVER-THROWS                 — the whole flow runs to completion without throwing.
//
// Run: node --test test/e2e.test.js
//      (or with the rest of the suite: node --test test/*.test.js)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── 0. Point every persistent fact-checker store at a throwaway tmp dir BEFORE importing the modules
//       that read these env vars at load time. This is the by-construction half of the NO-KB-WRITE
//       invariant: there is no env path anywhere near knowledge/**.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ashurbanipal-e2e-'));
process.env.KB_FLAG_STORE = path.join(TMP, 'kb-flags.json');        // flags.js (byFile store)
process.env.FACTCHECK_LOG = path.join(TMP, 'factcheck-log.jsonl');  // index.js / verdictLog append-only
process.env.KB_FLAG_JSONL = path.join(TMP, 'kb-flags.jsonl');       // kbFlags.js lifecycle store
process.env.GEMINI_API_KEY = 'test-key';                            // present → verify takes the normal path

// ── 1. Imports (after env is set) — the real modules, reused exactly as production wires them.
const KnowledgeLoader = (await import('../src/utils/knowledgeLoader.js')).default;
const {
  normaliseSources,
  buildGroundingFooter,
  buildCoverageFooter,
  computeCoverage,
  appendProvenanceLog,
} = await import('../src/provenance.js');
const { checkArticle, __setResourceCenter } = await import('../src/factChecker/index.js');
const { flagsForFile, briefWarningFor, openFlagCount } = await import('../src/factChecker/flags.js');
const { readLog } = await import('../src/factChecker/verdictLog.js');
const ReviewQueue = (await import('../src/reviewQueue.js')).default;
const { renderMarkup } = await import('../src/mwRender.js');
const {
  handleCommand,
  NO_SOURCE_REPLY,
  __setBackends,
  __resetBackends,
} = await import('../src/chatSurface.js');
const scraper = await import('../../integrations/scraper.mjs');

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────

// Quiet the loader's progress logging so harness output stays clean.
const _log = console.log, _warn = console.warn, _error = console.error;
const silence = () => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; };
const restore = () => { console.log = _log; console.warn = _warn; console.error = _error; };

// A small fixture corpus written under a fresh tmp dir (never knowledge/**).
function makeFixtureKB() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ashurbanipal-kb-'));
  const tree = {
    oilahuasca: {
      'space_paste.json': JSON.stringify({
        title: 'Space Paste',
        body: 'Oilahuasca uses essential oils and allylbenzene with an MAOI for transdermal delivery.',
        detail: { mechanism: 'CYP450 inhibition extends myristicin activity.' },
      }),
      'overview.md': '# Oilahuasca\n\nOilahuasca connects essential oils to consciousness through transdermal delivery.',
    },
    phoenician: {
      'headcones.txt': 'The Phoenician headcone is a beeswax kyphi incense cone for transdermal use. Punic wax.',
    },
    cryptocurrency: {
      'witness.md': 'A blockchain witness produces blocks. Graphene powers BitShares and Steem.',
    },
  };
  for (const [domain, files] of Object.entries(tree)) {
    const dir = path.join(base, domain);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content, 'utf-8');
  }
  return base;
}

// In-memory fs for the review queue (no disk).
function memFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => { if (!files.has(p)) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; } return files.get(p); },
    writeFileSync: (p, data) => { files.set(p, String(data)); },
    mkdirSync: () => {},
  };
}

// A fake JSON-ish fetch Response.
function fakeResponse(obj, { ok = true, status = 200, contentType = 'application/json' } = {}) {
  return { ok, status, headers: { get: () => contentType }, json: async () => obj, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) };
}

// The offline evidence/LLM harness, identical in spirit to factChecker.test.js:
//   - scraper fetch (research) → one fake evidence page so a verdict can rest on "fetched" evidence.
//   - Gemini fetch (verifyClaim) → a scripted verdict; everything else → harmless empties.
let geminiVerdict = { verdict: 'SUPPORTED', confidence: 0.9, reason: 'evidence agrees', source: '' };
function installFetch() {
  scraper.__setFetch(async (url) => {
    const u = String(url);
    if (u.includes('duckduckgo.com')) return fakeResponse('<a class="result__a" href="https://en.wikipedia.org/wiki/Test">Test</a>', { contentType: 'text/html' });
    if (u.includes('r.jina.ai')) return fakeResponse('Title: Test Page\n\nReal fetched evidence content for grounding.', { contentType: 'text/markdown' });
    return fakeResponse({ results: [] });
  });
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return fakeResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiVerdict) }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://en.wikipedia.org/wiki/Test' } }] } }] });
    }
    return fakeResponse({});
  };
}
const _origFetch = globalThis.fetch;
function restoreFetch() { scraper.__setFetch(null); globalThis.fetch = _origFetch; }

// fs WRITE SPY (the by-observation half of NO-KB-WRITE): wrap the real fs write entry points and record
// every path written for the duration of the whole flow, so we can assert NONE landed under knowledge/**.
function installWriteSpy() {
  const writes = [];
  const orig = {
    writeFileSync: fs.writeFileSync,
    appendFileSync: fs.appendFileSync,
    mkdirSync: fs.mkdirSync,
    writeFile: fs.writeFile,
    appendFile: fs.appendFile,
  };
  fs.writeFileSync = (p, ...a) => { writes.push(String(p)); return orig.writeFileSync.call(fs, p, ...a); };
  fs.appendFileSync = (p, ...a) => { writes.push(String(p)); return orig.appendFileSync.call(fs, p, ...a); };
  fs.writeFile = (p, ...a) => { writes.push(String(p)); return orig.writeFile.call(fs, p, ...a); };
  fs.appendFile = (p, ...a) => { writes.push(String(p)); return orig.appendFile.call(fs, p, ...a); };
  // mkdirSync creates dirs, not data — record it too so we catch even a *directory* under knowledge/.
  fs.mkdirSync = (p, ...a) => { writes.push(String(p)); return orig.mkdirSync.call(fs, p, ...a); };
  const uninstall = () => Object.assign(fs, orig);
  return { writes, uninstall };
}

// Grounded search backend for the chat surface (mirrors chatSurface.test.js).
function groundedSearch() {
  return async (query) => {
    const q = String(query).toLowerCase();
    if (q.includes('oilahuasca')) {
      return [
        { title: 'Oilahuasca', excerpt: 'Oilahuasca is an oral DMT-analog preparation framework.', source: 'oilahuasca/space_paste.json' },
        { title: 'Headcones', excerpt: 'A related transdermal delivery method.', source: 'phoenician/headcones.txt' },
      ];
    }
    return []; // ungrounded query → no sources (drives the honest-fallback path)
  };
}
function fakeLiveData() {
  return async (cmd) => (/^price\s+vkbt/i.test(cmd)
    ? { ok: true, text: '**Van Kush** (VKBT) — $0.42 (+1.20% 24h)', data: { symbol: 'VKBT', price_usd: 0.42 } }
    : { ok: false, text: 'no coin', data: null });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// THE END-TO-END FLOW
// One big test that walks the whole pipeline once and asserts every stage + invariant. A single flow
// (rather than many isolated tests) is the point of an e2e harness: it proves the surfaces compose.
// ────────────────────────────────────────────────────────────────────────────────────────────────
test('e2e: load → draft → ground → fact-check → flag → review-queue → render → chat (all invariants hold)', async () => {
  const spy = installWriteSpy();
  installFetch();
  silence();

  // accumulate everything the flow produces so post-flow assertions can inspect it.
  const seen = {};

  try {
    await assert.doesNotReject((async () => {
      // ── (1) LOAD: a small fixture corpus from a tmp KB tree ──────────────────────────────────────
      const kbBase = makeFixtureKB();
      const loader = new KnowledgeLoader(kbBase);
      await loader.loadAll();
      seen.docCount = loader.documents.size;
      seen.topic = loader.getTopicContext('oilahuasca', 1);

      // ── (2) DRAFT + (3) GROUND: synthesize an article body, then attach a REAL grounding footer +
      //       per-section coverage from the exact KB docs that grounded it. We use the deterministic
      //       provenance helpers (the network-free grounding layer) so the draft carries citations. ──
      const groundingDocs = loader.search('oilahuasca essential oils', 5).map((r) => ({
        source: r.docId,
        content: loader.documents.get(r.docId).content,
      }));
      assert.ok(groundingDocs.length >= 1, 'grounding pulled at least one KB doc');
      const sources = normaliseSources(groundingDocs, []);
      assert.ok(sources.every((s) => s.kind === 'kb' && s.id), 'normalised KB sources carry ids');

      // The body cites the KB docs with <ref> tags (the faithful format the fact-checker expects), plus
      // a deliberately FALSE claim so the fact-check stage has a real CONTRADICTED to catch + flag.
      const trueRef = sources[0].id;          // a real KB doc id
      const falseRef = 'cryptocurrency/witness.md';
      const body = [
        "== Overview ==",
        `Oilahuasca uses essential oils and an MAOI for transdermal delivery.<ref>${trueRef}</ref>`,
        '',
        "== Disputed ==",
        `The Graphene witness gains energy through a biochemical mechanism that boosts its magnetic charge.<ref>${falseRef}</ref>`,
      ].join('\n');

      const footer = buildGroundingFooter(sources);
      assert.match(footer, /Sources \(grounding\)/, 'a real grounding footer is built');
      assert.match(footer, new RegExp(trueRef.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')), 'footer cites the KB doc id');

      const coverage = computeCoverage(body, sources);
      const coverageFooter = buildCoverageFooter(coverage);
      const articleMarkup = `${body}\n\n${footer}${coverageFooter}`;
      assert.match(articleMarkup, /<ref>/, 'the draft carries citations');
      seen.articleMarkup = articleMarkup;

      // append-only provenance audit log (under tmp, never knowledge/**).
      const provLog = path.join(TMP, 'provenance.jsonl');
      appendProvenanceLog(provLog, {
        stamp: 'Oilahuasca', article: 'Oilahuasca',
        sourceDocIds: sources.map((s) => s.id), externalUrls: [], model: 'e2e-fixture',
        coverage: coverage.summary,
      });
      assert.equal(fs.readFileSync(provLog, 'utf8').trim().split('\n').length, 1, 'one provenance line appended');

      // ── (4) FACT-CHECK + (5) FLAG: the false claim → CONTRADICTED + a KB-flag; the true claim →
      //       SUPPORTED. Scripted per claim via the offline Gemini stub. Verdicts logged append-only. ──
      const logBefore = readLog().length;

      // true claim verdict
      geminiVerdict = { verdict: 'SUPPORTED', confidence: 0.9, reason: 'external sources agree', source: '' };
      const trueReport = await checkArticle(
        `Oilahuasca uses essential oils and an MAOI for transdermal delivery.<ref>${trueRef}</ref>`,
        { title: 'Oilahuasca (true claim)' },
      );
      assert.equal(trueReport.total, 1);
      assert.equal(trueReport.tally.SUPPORTED, 1, 'the true claim is SUPPORTED');
      assert.equal(flagsForFile(trueRef).length, 0, 'a SUPPORTED claim raises NO flag');

      // false claim verdict
      geminiVerdict = { verdict: 'CONTRADICTED', confidence: 0.8, reason: 'no such mechanism; magnetic charge is not a real property', source: '' };
      const falseReport = await checkArticle(
        `The Graphene witness gains energy through a biochemical mechanism that boosts its magnetic charge.<ref>${falseRef}</ref>`,
        { title: 'Oilahuasca (false claim)' },
      );
      assert.equal(falseReport.total, 1);
      assert.equal(falseReport.tally.CONTRADICTED, 1, 'the false claim is CONTRADICTED');

      // the contradiction is now a KB-flag keyed by the cited KB file (advisory, flag-only).
      const flags = flagsForFile(falseRef);
      assert.equal(flags.length, 1, 'the CONTRADICTED claim raised exactly one KB-flag');
      assert.equal(flags[0].verdict, 'CONTRADICTED');
      assert.equal(openFlagCount(falseRef), 1);
      assert.match(briefWarningFor(falseRef), /open fact-flag/, 'the flag feeds the brief warning');
      seen.flags = flags;

      // verdict log grew append-only (true + false = +2 lines), nothing earlier overwritten.
      const logAfter = readLog();
      assert.equal(logAfter.length, logBefore + 2, 'two verdicts appended (append-only)');

      // ── (6) REVIEW-QUEUE: the draft enters as pending and CANNOT publish until approved (Invariant A) ─
      let idN = 0;
      const queue = new ReviewQueue({
        fs: memFs(),
        path: { dirname: () => 'data' },
        now: () => new Date('2026-06-03T12:00:00.000Z'),
        idFactory: () => `e2e-${++idN}`,
        storePath: 'data/review-queue.jsonl',
      });
      const draft = queue.enqueueDraft({
        title: 'Oilahuasca', body: articleMarkup, sources: sources.map((s) => s.id), articleId: 'Oilahuasca',
      });
      assert.equal(draft.status, 'pending', 'draft enters the queue as pending');

      // INVARIANT A: a pending draft refuses to publish.
      const prematurePublish = queue.markPublished(draft.id);
      assert.equal(prematurePublish.ok, false, 'pending draft CANNOT be published');
      assert.equal(queue.get(draft.id).status, 'pending', 'still pending after the refused publish');

      // operator approves → now (and only now) it can publish.
      assert.equal(queue.approve(draft.id, { reviewer: 'operator', note: 'sources verified' }).ok, true);
      const published = queue.markPublished(draft.id);
      assert.equal(published.ok, true, 'an APPROVED draft publishes');
      assert.equal(queue.get(draft.id).status, 'published');
      seen.publishedMarkup = queue.get(draft.id).body;

      // ── (7) RENDER: the approved article's markup → safe HTML (Invariant D: XSS-safe) ─────────────
      // Smuggle a hostile payload into the approved markup, exactly as a poisoned source might.
      const hostileMarkup = `${seen.publishedMarkup}\n\n== Note ==\n<script>steal(document.cookie)</script>\n[javascript:alert(1) click me]\n<img src=x onerror=alert(2)>`;
      const html = renderMarkup(hostileMarkup);
      assert.equal(typeof html, 'string');
      // INVARIANT D: no live script/handler/dangerous href survives.
      assert.doesNotMatch(html, /<script/i, 'no live <script> tag');
      assert.doesNotMatch(html, /onerror\s*=/i, 'no live onerror handler');
      assert.doesNotMatch(html, /href="javascript:/i, 'no javascript: href');
      // the legit content + a real citation still rendered.
      assert.match(html, /Overview/, 'legit heading rendered');
      assert.match(html, /class="reference"/, 'citations rendered as numbered footnotes');
      seen.html = html;

      // ── (8) CHAT: !ask answers grounded-or-honestly; !price via injected liveData (Invariant C) ───
      __setBackends({ search: groundedSearch(), liveData: fakeLiveData() });

      const grounded = await handleCommand({ user: 'alice', text: '!ask what is oilahuasca' });
      assert.equal(grounded.kind, 'ask');
      assert.match(grounded.reply, /Sources:/, 'grounded answer carries citations');
      assert.match(grounded.reply, /space_paste\.json/, 'cites a real KB doc');
      assert.notEqual(grounded.reply, NO_SOURCE_REPLY);

      // INVARIANT C: an unsourced question gets the honest no-source reply, never a fabrication.
      const honest = await handleCommand({ user: 'bob', text: '!ask what is the airspeed of an unladen swallow' });
      assert.equal(honest.reply, NO_SOURCE_REPLY, 'ungrounded query → honest no-source reply');
      assert.doesNotMatch(honest.reply, /Sources:/, 'no fabricated citations');

      const price = await handleCommand({ user: 'carol', text: '!price VKBT' });
      assert.match(price.reply, /VKBT/);
      assert.match(price.reply, /\$0\.42/);

      seen.chat = { grounded: grounded.reply, honest: honest.reply, price: price.reply };
    })());
  } finally {
    restore();
    restoreFetch();
    __resetBackends();
    __setResourceCenter(null);
    spy.uninstall();
  }

  // ── post-flow: the whole pipeline produced what we expect ──────────────────────────────────────
  assert.ok(seen.docCount >= 4, 'loader loaded the fixture corpus');
  assert.ok(seen.flags && seen.flags.length === 1, 'exactly one KB-flag from the false claim');
  assert.ok(typeof seen.html === 'string' && seen.html.length > 0, 'render produced HTML');

  // ── INVARIANT B (NO-KB-WRITE), by OBSERVATION: across the ENTIRE flow, the fs write spy recorded
  //    NO write (file or directory) under a knowledge/ path. Combined with the by-construction half
  //    (every store env points under tmp), the fact-checker flagged without ever touching the KB. ──
  const knowledgeWrites = spy.writes.filter((p) => /(^|[\\/])knowledge[\\/]/.test(p));
  assert.deepEqual(knowledgeWrites, [], `no write under knowledge/** during the flow; offenders: ${knowledgeWrites.join(', ')}`);
});

// ── INVARIANT B, by CONSTRUCTION: every persistent store the flow used is under the tmp dir and none
//    is under knowledge/**. This is the static half of the no-KB-write guarantee. ──────────────────
test('e2e safety: every fact-checker store path is under tmp and never under knowledge/**', () => {
  for (const k of ['KB_FLAG_STORE', 'FACTCHECK_LOG', 'KB_FLAG_JSONL']) {
    assert.ok(process.env[k].startsWith(TMP), `${k} is under the tmp dir`);
    assert.ok(!/(^|[\\/])knowledge[\\/]/.test(process.env[k]), `${k} is not under knowledge/**`);
  }
});
