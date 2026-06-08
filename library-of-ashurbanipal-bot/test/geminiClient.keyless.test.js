// geminiClient.keyless.test.js — prove the article generator runs with ZERO operator key.
//
// The blocker was: GeminiClient required GEMINI_API_KEY. Now, when no key is present, synthesizeArticle
// (and the question/brief/analyze methods) route STRAIGHT through the shared llm-router, whose final
// rung is the KEYLESS Pollinations text provider. So generation always resolves with no key.
//
// OFFLINE: no network. We delete every provider key from the env and mock global.fetch so the only
// rung that can answer is the keyless one (pollinations). The router is the REAL module — this is an
// end-to-end check of the keyless path, not a stub. console.error is silenced (the client logs status
// lines via console.error by design).
//
// Run: node --test test/geminiClient.keyless.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import GeminiClient from '../src/utils/geminiClient.js';

const PROVIDER_ENV = ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'GITHUB_TOKEN', 'GROQ_API_KEY'];

function withNoKeys(fn) {
  const saved = {};
  for (const k of PROVIDER_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  const restore = () => {
    for (const k of PROVIDER_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
  return Promise.resolve(fn()).finally(restore);
}

const _error = console.error;
const silence = () => { console.error = () => {}; };
const unsilence = () => { console.error = _error; };

function openaiBody(text) {
  return JSON.stringify({ choices: [{ message: { content: text } }] });
}

test('constructor: no key → hasGemini false', () => {
  const c = new GeminiClient(undefined);
  assert.equal(c.hasGemini, false);
  const c2 = new GeminiClient('');
  assert.equal(c2.hasGemini, false);
  const c3 = new GeminiClient('a-real-key');
  assert.equal(c3.hasGemini, true);
});

test('synthesizeArticle with NO keys generates via the keyless pollinations rung', async () => {
  const orig = global.fetch;
  silence();
  // Only the keyless rung is reachable; anything that POSTs gets a good OpenAI-shaped completion.
  global.fetch = async () => ({ ok: true, status: 200, text: async () => openaiBody('== Overview ==\nKeyless article body, fully from sources.') });
  try {
    await withNoKeys(async () => {
      const client = new GeminiClient(undefined);
      const out = await client.synthesizeArticle('Test Topic', {
        primary: [{ id: 'doc1', domain: 'chemistry', excerpt: 'Some sourced fact.' }],
        related: [],
        external: [],
      });
      assert.match(out, /Keyless article body/);
    });
  } finally {
    global.fetch = orig;
    unsilence();
  }
});

test('answerQuestion with NO keys also routes keyless', async () => {
  const orig = global.fetch;
  silence();
  global.fetch = async () => ({ ok: true, status: 200, text: async () => openaiBody('A keyless answer.') });
  try {
    await withNoKeys(async () => {
      const client = new GeminiClient(undefined);
      const out = await client.answerQuestion('What is X?', { primary: [{ domain: 'd', id: 'i', excerpt: 'x' }] });
      assert.equal(out, 'A keyless answer.');
    });
  } finally {
    global.fetch = orig;
    unsilence();
  }
});

test('keyless generation surfaces an error (not a silent empty) when every provider fails', async () => {
  const orig = global.fetch;
  silence();
  global.fetch = async () => ({ ok: false, status: 503, text: async () => 'down' });
  try {
    await withNoKeys(async () => {
      const client = new GeminiClient(undefined);
      await assert.rejects(
        () => client.synthesizeArticle('Topic', { primary: [], related: [], external: [] }),
        /keyless generation failed/,
      );
    });
  } finally {
    global.fetch = orig;
    unsilence();
  }
});
