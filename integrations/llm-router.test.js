// llm-router.test.js — prove the provider ladder falls through on error, and that routing
// hints / availableProviders() behave. Mocks global.fetch; no network, no real keys.
//
//   node --test integrations/llm-router.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complete, availableProviders, PROVIDERS, __resetRotation } from './llm-router.mjs';

const ENV_KEYS = PROVIDERS.map((p) => p.env).filter(Boolean); // keyless providers have env:null

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
    assert.equal(a.gemini, false); // $0 hard-pin: metered Gemini is OFF unless LLM_ALLOW_GEMINI=1
    assert.equal(a.groq, true);
    assert.equal(a.openrouter, false);
    assert.equal(a.github, false);
    // Make sure no value leaked into the output.
    const blob = JSON.stringify(a);
    assert.ok(!blob.includes('secret'));
    assert.ok(!blob.includes('gsk_'));
  });
  // the opt-in flag re-enables the metered provider (key still required)
  await withEnv({ GEMINI_API_KEY: 'secret-xyz', LLM_ALLOW_GEMINI: '1' }, () => {
    assert.equal(availableProviders().gemini, true);
  });
});

test('ladder falls through: first provider errors, second answers', async () => {
  const orig = global.fetch;
  __resetRotation(); // deterministic: rotation starts at groq
  // default head (free-first) = groq, openrouter, github; give all keys.
  // Script: groq -> 429, openrouter -> 200 with text.
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
        assert.equal(res.attempts[0].provider, 'groq');
        assert.equal(res.attempts[0].error, 'HTTP 429');
        assert.equal(res.provider, 'openrouter');
        assert.equal(res.text, 'hello from openrouter');
      },
    );
  } finally {
    global.fetch = orig;
  }
});

test('round-robin spreads load across free providers on successive calls', async () => {
  const orig = global.fetch;
  __resetRotation();
  global.fetch = scriptedFetch([{ status: 200, body: openaiBody('ok') }]);
  try {
    await withEnv({ GROQ_API_KEY: 'k', OPENROUTER_API_KEY: 'k', GITHUB_TOKEN: 'k' }, async () => {
      const a = await complete('1'); // shift 0 -> groq leads
      const b = await complete('2'); // shift 1 -> openrouter leads
      const c = await complete('3'); // shift 2 -> github leads
      assert.equal(a.provider, 'groq');
      assert.equal(b.provider, 'openrouter');
      assert.equal(c.provider, 'github');
    });
  } finally {
    global.fetch = orig;
  }
});

test('missing keys are skipped, not attempted', async () => {
  const orig = global.fetch;
  // Only github has a key; default order tries groq/openrouter first (skip), then github.
  __resetRotation();
  global.fetch = scriptedFetch([{ status: 200, body: openaiBody('github answer') }]);
  try {
    await withEnv({ GITHUB_TOKEN: 'k' }, async () => {
      const res = await complete('hi');
      assert.equal(res.provider, 'github');
      assert.equal(res.text, 'github answer');
      const skipped = res.attempts.filter((a) => a.skipped === 'no-key').map((a) => a.provider);
      assert.deepEqual(skipped, ['groq', 'openrouter']);
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

test('task:cheap leads with a free provider, never gemini', async () => {
  const orig = global.fetch;
  __resetRotation();
  global.fetch = scriptedFetch([{ status: 200, body: openaiBody('cheap answer') }]);
  try {
    await withEnv(
      { GEMINI_API_KEY: 'k', GROQ_API_KEY: 'k', OPENROUTER_API_KEY: 'k' },
      async () => {
        const res = await complete('hi', { task: 'cheap' });
        assert.equal(res.attempts[0].provider, 'groq');
        assert.equal(res.provider, 'groq');
        assert.notEqual(res.provider, 'gemini');
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
      // gemini is now a tail backstop (not attempts[0]); assert the gemini attempt is what errored.
      assert.equal(res.attempts.find((a) => a.provider === 'gemini').error, 'HTTP 500');
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

// ── keyless backstop: generation must run with ZERO keys present ──────────────────────────────
test('availableProviders: keyless pollinations is always true, even with no keys', async () => {
  await withEnv({}, () => {
    const a = availableProviders();
    assert.equal(a.gemini, false);
    assert.equal(a.openrouter, false);
    assert.equal(a.github, false);
    assert.equal(a.groq, false);
    assert.equal(a.pollinations, true); // keyless → always usable
  });
});

test('no keys at all: keyless pollinations still answers (the unblock)', async () => {
  const orig = global.fetch;
  // Every keyed rung is skipped (no key); pollinations is the only one tried.
  global.fetch = scriptedFetch([{ status: 200, body: openaiBody('keyless article body') }]);
  try {
    await withEnv({}, async () => {
      const res = await complete('write an article', { task: 'quality' });
      assert.equal(res.provider, 'pollinations');
      assert.equal(res.text, 'keyless article body');
      // every keyed provider was skipped for want of a key
      const skipped = res.attempts.filter((x) => x.skipped === 'no-key').map((x) => x.provider).sort();
      assert.deepEqual(skipped, ['gemini', 'github', 'groq', 'openrouter']);
    });
  } finally {
    global.fetch = orig;
  }
});

test('keyless pollinations sends NO Authorization header', async () => {
  const orig = global.fetch;
  let sawAuth = 'unset';
  global.fetch = async (_url, init) => {
    sawAuth = init?.headers?.authorization ?? null;
    return { ok: true, status: 200, text: async () => openaiBody('ok') };
  };
  try {
    await withEnv({}, async () => {
      const res = await complete('hi', { prefer: 'pollinations' });
      assert.equal(res.provider, 'pollinations');
      assert.equal(sawAuth, null); // no Bearer header when keyless
    });
  } finally {
    global.fetch = orig;
  }
});

test('keyed provider still wins over keyless backstop when a key is present', async () => {
  const orig = global.fetch;
  global.fetch = scriptedFetch([{ status: 200, body: openaiBody('from groq') }]);
  try {
    await withEnv({ GROQ_API_KEY: 'k' }, async () => {
      const res = await complete('hi', { task: 'cheap' }); // cheap → groq first, pollinations last
      assert.equal(res.provider, 'groq');
      assert.equal(res.text, 'from groq');
    });
  } finally {
    global.fetch = orig;
  }
});
