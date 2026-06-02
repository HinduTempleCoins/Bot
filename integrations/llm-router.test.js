// llm-router.test.js — prove the provider ladder falls through on error, and that routing
// hints / availableProviders() behave. Mocks global.fetch; no network, no real keys.
//
//   node --test integrations/llm-router.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complete, availableProviders, PROVIDERS } from './llm-router.mjs';

const ENV_KEYS = PROVIDERS.map((p) => p.env);

function withEnv(overrides, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
  const restore = () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
  return Promise.resolve(fn()).finally(restore);
}

// Build a fake fetch that returns a scripted response per call, in order.
function scriptedFetch(scripts) {
  let i = 0;
  return async () => {
    const s = scripts[i++] || scripts[scripts.length - 1];
    return {
      ok: s.status >= 200 && s.status < 300,
      status: s.status,
      text: async () => s.body ?? '',
    };
  };
}

function openaiBody(text) {
  return JSON.stringify({ choices: [{ message: { content: text } }] });
}
function geminiBody(text) {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
}

test('availableProviders reports booleans only (no key values)', async () => {
  await withEnv({ GEMINI_API_KEY: 'secret-xyz', GROQ_API_KEY: 'gsk_secret' }, () => {
    const a = availableProviders();
    assert.equal(a.gemini, true);
    assert.equal(a.groq, true);
    assert.equal(a.openrouter, false);
    assert.equal(a.github, false);
    // Make sure no value leaked into the output.
    const blob = JSON.stringify(a);
    assert.ok(!blob.includes('secret'));
    assert.ok(!blob.includes('gsk_'));
  });
});

test('ladder falls through: first provider errors, second answers', async () => {
  const orig = global.fetch;
  // task:default order = gemini, openrouter, github, groq. Give all 4 keys.
  // Script: gemini -> 429, openrouter -> 200 with text.
  global.fetch = scriptedFetch([
    { status: 429, body: 'rate limited' },
    { status: 200, body: openaiBody('hello from openrouter') },
  ]);
  try {
    await withEnv(
      {
        GEMINI_API_KEY: 'k',
        OPENROUTER_API_KEY: 'k',
        GITHUB_TOKEN: 'k',
        GROQ_API_KEY: 'k',
      },
      async () => {
        const res = await complete('hi');
        assert.equal(res.provider, 'openrouter');
        assert.equal(res.text, 'hello from openrouter');
        assert.equal(res.attempts[0].provider, 'gemini');
        assert.equal(res.attempts[0].error, 'HTTP 429');
        assert.equal(res.attempts[1].ok, true);
      },
    );
  } finally {
    global.fetch = orig;
  }
});

test('missing keys are skipped, not attempted', async () => {
  const orig = global.fetch;
  // Only groq has a key; default order tries gemini/openrouter/github first (skip), then groq.
  global.fetch = scriptedFetch([{ status: 200, body: openaiBody('groq answer') }]);
  try {
    await withEnv({ GROQ_API_KEY: 'k' }, async () => {
      const res = await complete('hi');
      assert.equal(res.provider, 'groq');
      assert.equal(res.text, 'groq answer');
      const skipped = res.attempts.filter((a) => a.skipped === 'no-key').map((a) => a.provider);
      assert.deepEqual(skipped, ['gemini', 'openrouter', 'github']);
    });
  } finally {
    global.fetch = orig;
  }
});

test('prefer forces a provider to the front', async () => {
  const orig = global.fetch;
  global.fetch = scriptedFetch([{ status: 200, body: openaiBody('groq first') }]);
  try {
    await withEnv(
      { GEMINI_API_KEY: 'k', GROQ_API_KEY: 'k' },
      async () => {
        const res = await complete('hi', { prefer: 'groq' });
        assert.equal(res.provider, 'groq');
        assert.equal(res.attempts[0].provider, 'groq'); // groq tried first despite default order
      },
    );
  } finally {
    global.fetch = orig;
  }
});

test('task:cheap biases groq/openrouter first', async () => {
  const orig = global.fetch;
  global.fetch = scriptedFetch([{ status: 200, body: openaiBody('cheap answer') }]);
  try {
    await withEnv(
      { GEMINI_API_KEY: 'k', GROQ_API_KEY: 'k', OPENROUTER_API_KEY: 'k' },
      async () => {
        const res = await complete('hi', { task: 'cheap' });
        assert.equal(res.attempts[0].provider, 'groq');
        assert.equal(res.provider, 'groq');
      },
    );
  } finally {
    global.fetch = orig;
  }
});

test('total failure returns {text:"", error} and never throws', async () => {
  const orig = global.fetch;
  global.fetch = scriptedFetch([{ status: 500, body: 'boom' }]);
  try {
    await withEnv({ GEMINI_API_KEY: 'k' }, async () => {
      const res = await complete('hi');
      assert.equal(res.text, '');
      assert.match(res.error, /all providers failed/);
      assert.equal(res.attempts[0].error, 'HTTP 500');
    });
  } finally {
    global.fetch = orig;
  }
});

test('gemini path parses candidates shape', async () => {
  const orig = global.fetch;
  global.fetch = scriptedFetch([{ status: 200, body: geminiBody('gemini text') }]);
  try {
    await withEnv({ GEMINI_API_KEY: 'k' }, async () => {
      const res = await complete('hi', { prefer: 'gemini' });
      assert.equal(res.provider, 'gemini');
      assert.equal(res.text, 'gemini text');
    });
  } finally {
    global.fetch = orig;
  }
});
