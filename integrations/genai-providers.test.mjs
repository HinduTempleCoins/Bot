// genai-providers.test.mjs — offline tests for the image-provider failover, breaker, and budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateImage, providerStatus, providerConfigured, normSize,
  __setFetch, __setNow, __resetState,
} from './genai-providers.mjs';

// a tiny base64 image payload (not a real PNG, just non-empty bytes)
const B64 = Buffer.from('fake-image-bytes').toString('base64');

function okResp(body, { json = false, ct } = {}) {
  return {
    ok: true, status: 200,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? (ct || (json ? 'application/json' : 'image/png')) : null) },
    json: async () => body,
    arrayBuffer: async () => Buffer.from('fake-image-bytes'),
  };
}
function errResp(status = 500) {
  return { ok: false, status, headers: { get: () => null }, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
}

function clearKeys() {
  delete process.env.CF_ACCOUNT_ID; delete process.env.CF_API_TOKEN; delete process.env.GEMINI_API_KEY;
  delete process.env.GENAI_BREAKER_THRESHOLD; delete process.env.GENAI_BREAKER_COOLDOWN_MS;
  delete process.env.GENAI_DAILY_CAP; delete process.env.GENAI_CF_DAILY_CAP; delete process.env.GENAI_GEMINI_DAILY_CAP;
}

test('normSize parses and clamps', () => {
  assert.equal(normSize('1024x768').label, '1024x768');
  assert.equal(normSize('bad').label, '1024x1024');
  assert.equal(normSize('99999x99999').label, '2048x2048');
});

test('no keys → chain soft-fails all the way to pollinations', async () => {
  clearKeys(); __resetState();
  let calls = [];
  __setFetch(async (url) => {
    calls.push(String(url));
    if (String(url).includes('pollinations')) return okResp(null);
    return errResp();
  });
  const r = await generateImage({ prompt: 'a temple' });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'pollinations');
  // cloudflare + gemini skipped for no-key; only pollinations hit the network
  assert.ok(calls.every((c) => c.includes('pollinations')));
  const tried = r.tried || [];
  assert.ok(tried.find((t) => t.id === 'cloudflare' && t.skipped === 'no-key'));
  assert.ok(tried.find((t) => t.id === 'gemini' && t.skipped === 'no-key'));
});

test('failover order: cloudflare first when keyed', async () => {
  clearKeys(); __resetState();
  process.env.CF_ACCOUNT_ID = 'acct'; process.env.CF_API_TOKEN = 'tok';
  __setFetch(async (url) => {
    if (String(url).includes('cloudflare')) return okResp({ result: { image: B64 }, success: true }, { json: true });
    return errResp();
  });
  const r = await generateImage({ prompt: 'a temple' });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'cloudflare');
  assert.ok(/Cloudflare/.test(r.note));
});

test('cloudflare fails → falls to gemini → pollinations', async () => {
  clearKeys(); __resetState();
  process.env.CF_ACCOUNT_ID = 'acct'; process.env.CF_API_TOKEN = 'tok'; process.env.GEMINI_API_KEY = 'g';
  // cloudflare 500, gemini returns no image (image-out not available), pollinations ok
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('cloudflare')) return errResp(500);
    if (u.includes('generativelanguage')) return okResp({ candidates: [{ content: { parts: [{ text: 'sorry no image' }] } }] }, { json: true });
    return okResp(null); // pollinations
  });
  const r = await generateImage({ prompt: 'a temple' });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'pollinations');
});

test('gemini image-out works when key present and cloudflare absent', async () => {
  clearKeys(); __resetState();
  process.env.GEMINI_API_KEY = 'g';
  __setFetch(async (url) => {
    if (String(url).includes('generativelanguage'))
      return okResp({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: B64 } }] } }] }, { json: true });
    return errResp();
  });
  const r = await generateImage({ prompt: 'a temple' });
  assert.equal(r.provider, 'gemini');
  assert.equal(r.base64, B64);
});

test('circuit breaker opens after N consecutive failures and skips provider', async () => {
  clearKeys(); __resetState();
  process.env.CF_ACCOUNT_ID = 'a'; process.env.CF_API_TOKEN = 't';
  process.env.GENAI_BREAKER_THRESHOLD = '2';
  let cfCalls = 0;
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('cloudflare')) { cfCalls++; return errResp(500); }
    return okResp(null); // pollinations always ok
  });
  await generateImage({ prompt: 'x' }); // cf fail #1
  await generateImage({ prompt: 'x' }); // cf fail #2 → breaker opens
  const callsBefore = cfCalls;
  const r = await generateImage({ prompt: 'x' }); // cf should be skipped now
  assert.equal(cfCalls, callsBefore, 'cloudflare not retried while breaker open');
  assert.equal(r.provider, 'pollinations');
  const st = providerStatus().find((p) => p.id === 'cloudflare');
  assert.equal(st.breakerOpen, true);
});

test('breaker cooldown expires with injected clock', async () => {
  clearKeys(); __resetState();
  process.env.CF_ACCOUNT_ID = 'a'; process.env.CF_API_TOKEN = 't';
  process.env.GENAI_BREAKER_THRESHOLD = '1'; process.env.GENAI_BREAKER_COOLDOWN_MS = '1000';
  let t = 1000; __setNow(() => t);
  let cfGen1 = true; // first generation: cloudflare (both models) fails entirely
  __setFetch(async (url) => {
    if (String(url).includes('cloudflare')) { if (cfGen1) return errResp(500); return okResp({ result: { image: B64 } }, { json: true }); }
    return okResp(null);
  });
  await generateImage({ prompt: 'x' }); // both cf models fail → breaker opens (cooldown 1000ms)
  cfGen1 = false; // cloudflare would succeed now if attempted
  t = 1500; // still within cooldown
  let r = await generateImage({ prompt: 'x' });
  assert.equal(r.provider, 'pollinations'); // cf skipped
  t = 3000; // past cooldown
  r = await generateImage({ prompt: 'x' });
  assert.equal(r.provider, 'cloudflare'); // recovered
  __setNow(null);
});

test('daily budget cap skips provider when exhausted (no auto-retry loop)', async () => {
  clearKeys(); __resetState();
  process.env.CF_ACCOUNT_ID = 'a'; process.env.CF_API_TOKEN = 't';
  process.env.GENAI_CF_DAILY_CAP = '2';
  __setFetch(async (url) => {
    if (String(url).includes('cloudflare')) return okResp({ result: { image: B64 } }, { json: true });
    return okResp(null);
  });
  let r = await generateImage({ prompt: 'x' }); assert.equal(r.provider, 'cloudflare');
  r = await generateImage({ prompt: 'x' }); assert.equal(r.provider, 'cloudflare');
  r = await generateImage({ prompt: 'x' }); // cap hit → over-budget skip → pollinations
  assert.equal(r.provider, 'pollinations');
  assert.ok((r.tried || []).find((x) => x.id === 'cloudflare' && x.skipped === 'over-budget'));
});

test('empty prompt is rejected without any network', async () => {
  clearKeys(); __resetState();
  let hit = false; __setFetch(async () => { hit = true; return okResp(null); });
  const r = await generateImage({ prompt: '   ' });
  assert.equal(r.ok, false);
  assert.equal(hit, false);
});

test('error messages are scrubbed of key-like material', async () => {
  clearKeys(); __resetState();
  process.env.GEMINI_API_KEY = 'g';
  __setFetch(async (url) => {
    if (String(url).includes('generativelanguage')) throw new Error('failed at key=AIzaSECRETKEY123456789 oops');
    return okResp(null);
  });
  const r = await generateImage({ prompt: 'x' });
  // ended at pollinations; the gemini try error must not leak the key
  const geminiTry = (r.tried || []).find((t) => t.id === 'gemini');
  assert.ok(geminiTry && !/AIzaSECRET/.test(geminiTry.error || ''));
});

test('providerConfigured reflects env keys', () => {
  clearKeys();
  assert.equal(providerConfigured('pollinations'), true);
  assert.equal(providerConfigured('cloudflare'), false);
  process.env.CF_ACCOUNT_ID = 'a'; process.env.CF_API_TOKEN = 't';
  assert.equal(providerConfigured('cloudflare'), true);
  clearKeys();
});
