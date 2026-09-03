// library-rag.test.mjs — OFFLINE tests for integrations/library-rag.mjs (queue #58).
//
// The module under test has no __setFetch / injectable-LLM hook: it uses the global `fetch`
// and routes LLM calls through llm-router.mjs, which ALSO uses the global `fetch` and gates
// each provider on an env API key. So we drive everything offline with two levers:
//
//   1. globalThis.fetch — a stub router that answers the wiki search API, article pages, and
//      (when an LLM key is set) the Gemini-shaped completion endpoint. NO network is touched.
//   2. env API keys — set GEMINI_API_KEY to exercise the LLM path; unset every provider key
//      to exercise the no-LLM degraded path.
//
// The internal helpers (extractArticleText / buildContext / dedupeSources) are not exported,
// so we assert their behavior through the exported surface: passage extraction via retrieve()
// (it calls extractArticleText on the page HTML), and citation formatting + source dedup via
// askLibrary()'s { sources } + LLM context. The module's own contract — retrieve passages,
// ground strictly to them, cite, dedup, fall back when the LLM is unavailable — is covered end
// to end. No network, no git, no file writes.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { askLibrary, retrieve } from './library-rag.mjs';
import { invalidate } from './soapbox/cache.mjs';

const WIKI = (process.env.WIKI_SITE || 'https://wiki.soapbox.community').replace(/\/+$/, '');

// ── env / fetch lifecycle ──────────────────────────────────────────────────────────────────
// LLM_ALLOW_GEMINI belongs in this list: llm-router hard-pins Gemini OFF unless the operator opts
// in with LLM_ALLOW_GEMINI=1 (the $0 cost pin), so a test that wants the Gemini path must set BOTH,
// and the lifecycle must save/restore both so the opt-in never leaks between tests.
const LLM_KEYS = ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'GITHUB_TOKEN', 'GROQ_API_KEY', 'LLM_ALLOW_GEMINI'];
let realFetch;
let savedKeys;

beforeEach(() => {
  realFetch = globalThis.fetch;
  savedKeys = {};
  for (const k of LLM_KEYS) {
    savedKeys[k] = process.env[k];
    delete process.env[k]; // default: no LLM unless a test opts in
  }
  invalidate(); // clear the in-process TTL cache between tests
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of LLM_KEYS) {
    if (savedKeys[k] === undefined) delete process.env[k];
    else process.env[k] = savedKeys[k];
  }
  invalidate();
});

// Build a JSON / text Response-like object (only the bits the module reads: ok, status, text()).
function jsonResponse(obj) {
  return { ok: true, status: 200, text: async () => JSON.stringify(obj) };
}
function textResponse(s) {
  return { ok: true, status: 200, text: async () => s };
}
function notFound() {
  return { ok: false, status: 404, text: async () => '' };
}

// A wiki page wrapped in the <main> region the extractor isolates.
function wikiPage(bodyHtml) {
  return `<!doctype html><html><head><title>x</title></head><body>
    <nav><a href="/">← Library</a></nav>
    <main class="wrap">${bodyHtml}</main>
    <footer>chrome we should never see in a passage</footer>
  </body></html>`;
}

/**
 * Install a stub fetch.
 * @param {object} opts
 * @param {object[]} opts.search  results array for /api/search
 * @param {Record<string,string>} [opts.pages] url-substring -> page HTML
 * @param {string|null} [opts.llmText] completion text returned by the Gemini stub (null => empty)
 * @param {() => void} [opts.onLlm] called with the LLM request body for assertions
 */
function installFetch({ search = [], pages = {}, llmText, onLlm } = {}) {
  globalThis.fetch = async (url, init) => {
    const u = String(url);

    // Wiki search API.
    if (u.includes('/api/search')) return jsonResponse({ results: search });

    // Gemini completion endpoint (llm-router callGemini).
    if (u.includes('generativelanguage.googleapis.com')) {
      if (onLlm && init?.body) onLlm(JSON.parse(init.body));
      if (llmText == null) return jsonResponse({}); // empty -> llm-router throws -> fallback
      return jsonResponse({ candidates: [{ content: { parts: [{ text: llmText }] } }] });
    }

    // Any other LLM endpoint shouldn't be hit in these tests, but answer empty if it is.
    if (u.includes('chat/completions')) return jsonResponse({ choices: [{ message: { content: llmText || '' } }] });

    // Article pages.
    for (const [needle, html] of Object.entries(pages)) {
      if (u.includes(needle)) return textResponse(html);
    }
    return notFound();
  };
}

// Convenience: a standard two-article corpus.
function corpus() {
  return {
    search: [
      { title: 'The Convergence', slug: 'the-convergence', score: 9, snippet: 'snippet A' },
      { title: 'Zar Thread System', slug: 'zar-thread-system', score: 5, snippet: 'snippet B' },
    ],
    pages: {
      'the-convergence': wikiPage('<p>The Convergence is the reconstruction of temple technology.</p>'),
      'zar-thread-system': wikiPage('<p>The Zar Thread System organizes the threads.</p>'),
    },
  };
}

// ── retrieve(): retrieval + passage extraction ───────────────────────────────────────────────

test('retrieve returns top passages with extracted body text and source metadata', async () => {
  const { search, pages } = corpus();
  installFetch({ search, pages });

  const passages = await retrieve('What is the Convergence?');
  assert.equal(passages.length, 2, 'both articles retrieved');

  const conv = passages.find((p) => p.title === 'The Convergence');
  assert.ok(conv, 'Convergence article present');
  assert.equal(conv.url, `${WIKI}/wiki/the-convergence`, 'url built from slug');
  // extractArticleText: tag-stripped prose, nav/footer chrome removed.
  assert.match(conv.text, /The Convergence is the reconstruction of temple technology\./);
  assert.doesNotMatch(conv.text, /chrome we should never see/, 'footer chrome excluded');
  assert.doesNotMatch(conv.text, /← Library/, 'breadcrumb nav excluded');
  assert.doesNotMatch(conv.text, /<p>|<\/p>/, 'html tags stripped');
});

test('retrieve sorts by score descending', async () => {
  const { search, pages } = corpus();
  installFetch({ search, pages });
  const passages = await retrieve('threads');
  assert.equal(passages[0].title, 'The Convergence', 'higher score first');
});

test('retrieve falls back to the search snippet when the page body will not load', async () => {
  installFetch({
    search: [{ title: 'Phoenix Protocol', slug: 'phoenix-protocol', score: 7, snippet: 'fallback snippet text' }],
    pages: {}, // page fetch 404s
  });
  const passages = await retrieve('phoenix');
  assert.equal(passages.length, 1);
  assert.equal(passages[0].text, 'fallback snippet text', 'snippet used when body unavailable');
});

test('retrieve returns [] for empty question and never throws on network failure', async () => {
  installFetch({ search: [] });
  assert.deepEqual(await retrieve('   '), [], 'empty question short-circuits');

  globalThis.fetch = async () => { throw new Error('network down'); };
  assert.deepEqual(await retrieve('anything'), [], 'best-effort: empty, not thrown');
});

test('retrieve keeps far more than the old 1200-char cap of a long article body', async () => {
  // A long single-article body: ~3000 chars of prose. The whole thing is fetched; the per-article cap
  // (raised from 1200 to 4000) must now keep substantially more than the old limit chopped off.
  const longBody = '<p>' + ('The Convergence reconstructs temple technology. ').repeat(60) + '</p>';
  installFetch({
    search: [{ title: 'The Convergence', slug: 'the-convergence', score: 9, snippet: 's' }],
    pages: { 'the-convergence': wikiPage(longBody) },
  });
  const passages = await retrieve('What is the Convergence?');
  assert.equal(passages.length, 1);
  assert.ok(passages[0].text.length > 1200, `kept ${passages[0].text.length} chars (was capped at 1200)`);
});

test('retrieve respects topK', async () => {
  const { search, pages } = corpus();
  installFetch({ search, pages });
  const passages = await retrieve('what is the convergence and zar', { topK: 1 });
  assert.equal(passages.length, 1, 'capped to topK');
});

// ── askLibrary(): grounding, citation, dedup, fallback ───────────────────────────────────────

test('askLibrary with no LLM key degrades to retrieved passages, grounded + cited', async () => {
  const { search, pages } = corpus();
  installFetch({ search, pages }); // no LLM key set (beforeEach cleared them)

  const res = await askLibrary('What is the Convergence?');
  assert.equal(res.grounded, true, 'grounded by retrieved passages');
  assert.ok(/Here is what the Library has on that/.test(res.answer), 'templated lead');
  // The templated answer is built strictly from the passages, attributing each by title.
  assert.match(res.answer, /From "The Convergence": .*temple technology/);
  assert.match(res.answer, /From "Zar Thread System":/);
  // Sources cite both articles.
  assert.equal(res.sources.length, 2);
  assert.deepEqual(
    res.sources.map((s) => s.title).sort(),
    ['The Convergence', 'Zar Thread System'],
  );
  assert.equal(res.sources[0].url, `${WIKI}/wiki/the-convergence`);
});

test('askLibrary returns the not-covered answer with no sources when nothing is retrieved', async () => {
  installFetch({ search: [] });
  const res = await askLibrary('something the wiki has never heard of');
  assert.equal(res.grounded, false);
  assert.equal(res.answer, "The Library doesn't cover that.");
  assert.deepEqual(res.sources, []);
  assert.deepEqual(res.passages, []);
});

test('askLibrary with an LLM key grounds on passages, returns the answer + cited sources', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.LLM_ALLOW_GEMINI = '1'; // llm-router keeps metered Gemini off without this
  const { search, pages } = corpus();
  let llmPrompt = null;
  installFetch({
    search,
    pages,
    llmText: 'The Convergence is the reconstruction of temple technology (per "The Convergence").',
    onLlm: (body) => { llmPrompt = body?.contents?.[0]?.parts?.[0]?.text || ''; },
  });

  const res = await askLibrary('What is the Convergence?');
  assert.equal(res.grounded, true);
  assert.match(res.answer, /reconstruction of temple technology/);
  assert.equal(res.provider, 'gemini');
  assert.equal(res.sources.length, 2, 'both retrieved articles cited as sources');

  // The prompt handed to the LLM is built ONLY from the retrieved passages (grounding contract).
  assert.ok(llmPrompt, 'LLM received a prompt');
  assert.match(llmPrompt, /Article: "The Convergence"/);
  assert.match(llmPrompt, /Article: "Zar Thread System"/);
  assert.match(llmPrompt, /temple technology/, 'passage body present in context');
  assert.match(llmPrompt, /Question: What is the Convergence\?/);
});

test('askLibrary suppresses sources when the LLM says the Library does not cover it', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.LLM_ALLOW_GEMINI = '1'; // llm-router keeps metered Gemini off without this
  const { search, pages } = corpus();
  installFetch({ search, pages, llmText: "The Library doesn't cover that." });

  const res = await askLibrary('What is the Convergence?');
  assert.equal(res.grounded, false, 'verbatim not-covered reply marks ungrounded');
  assert.deepEqual(res.sources, [], 'no sources cited for an ungrounded answer');
});

test('askLibrary falls back to passages when the LLM returns empty text', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.LLM_ALLOW_GEMINI = '1'; // llm-router keeps metered Gemini off without this
  const { search, pages } = corpus();
  installFetch({ search, pages, llmText: null }); // empty completion -> router fails -> fallback

  const res = await askLibrary('What is the Convergence?');
  assert.equal(res.grounded, true, 'still grounded via the retrieved passages');
  assert.match(res.answer, /Here is what the Library has on that/);
  assert.equal(res.sources.length, 2);
});

test('askLibrary dedups sources that share a url/title across passages', async () => {
  // Same article surfaced twice by search (e.g. snippet + anchor hit) must collapse to one source.
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.LLM_ALLOW_GEMINI = '1'; // llm-router keeps metered Gemini off without this
  installFetch({
    search: [
      { title: 'The Convergence', slug: 'the-convergence', score: 9, snippet: 'A' },
      { title: 'The Convergence', slug: 'the-convergence', score: 8, snippet: 'B' },
    ],
    pages: { 'the-convergence': wikiPage('<p>Convergence body.</p>') },
    llmText: 'Answer grounded in the passage (per "The Convergence").',
  });

  const res = await askLibrary('convergence');
  assert.equal(res.sources.length, 1, 'duplicate article collapsed to a single source');
  assert.equal(res.sources[0].title, 'The Convergence');
  assert.equal(res.sources[0].url, `${WIKI}/wiki/the-convergence`);
});

test('askLibrary prompts for input on an empty question (no retrieval, no throw)', async () => {
  installFetch({ search: [] });
  const res = await askLibrary('   ');
  assert.equal(res.grounded, false);
  assert.match(res.answer, /Ask the Library a question/);
  assert.deepEqual(res.sources, []);
});
