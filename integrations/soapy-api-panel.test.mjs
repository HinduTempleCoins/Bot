// soapy-api-panel.test.mjs — offline, no network. Covers the Soapy.Blog coding-AI API panel:
//   listProviders reflects an injected env (some keyed present, some absent, keyless always on);
//   quotaFor parses x-ratelimit-* headers from an injected fetch; quotaFor soft-fails (no throw)
//   when the injected fetch throws; the handler 401s unauthed and 200s authed, rendering a provider
//   name and ESCAPING an injected <script>-ish value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listProviders, quotaFor, quotaAll, handler, renderPanel, esc,
  __setFetch, __setAuth,
} from './soapy-api-panel.mjs';

// ── fake http req/res ──────────────────────────────────────────────────────────────────────────
function fakeRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(c, h) { this.code = c; this.headers = h; },
    end(b) { this.body = b || ''; this._done = true; },
  };
}
// A Headers-like object exposing get() the way fetch's Headers does.
function fakeHeaders(map) {
  const lower = {};
  for (const k of Object.keys(map)) lower[k.toLowerCase()] = map[k];
  return { get: (name) => (name.toLowerCase() in lower ? lower[name.toLowerCase()] : null) };
}

// ── listProviders reflects the injected env ──────────────────────────────────────────────────────
test('listProviders reflects injected env (configured vs not; keyless always on)', () => {
  const env = { GROQ_API_KEY: 'sk-live', OPENROUTER_API_KEY: '   ' /* blank → not configured */ };
  const list = listProviders({ env });

  // Comes from the router's PROVIDERS table — includes the real providers.
  const ids = list.map((p) => p.id);
  for (const id of ['gemini', 'openrouter', 'github', 'groq', 'pollinations']) {
    assert.ok(ids.includes(id), `expected provider ${id} in list`);
  }

  const byId = Object.fromEntries(list.map((p) => [p.id, p]));
  assert.equal(byId.groq.configured, true, 'groq key present → configured');
  assert.equal(byId.openrouter.configured, false, 'blank key → not configured');
  assert.equal(byId.gemini.configured, false, 'absent key → not configured');
  assert.equal(byId.pollinations.configured, true, 'keyless backstop is always configured');

  // Never leaks a key value.
  assert.ok(!JSON.stringify(list).includes('sk-live'), 'must not expose key values');
});

// ── quotaFor parses rate-limit headers from an injected fetch ────────────────────────────────────
test('quotaFor parses x-ratelimit-* headers via injected fetch', async () => {
  __setFetch(async () => ({
    ok: true,
    headers: fakeHeaders({
      'x-ratelimit-remaining': '742',
      'x-ratelimit-limit': '1000',
      'x-ratelimit-reset': '60', // 60s from now
    }),
  }));
  const q = await quotaFor('groq', { env: { GROQ_API_KEY: 'sk-x' } });
  assert.equal(q.id, 'groq');
  assert.equal(q.remaining, 742);
  assert.equal(q.limit, 1000);
  assert.ok(typeof q.resetAt === 'string' && q.resetAt.includes('T'), 'resetAt ISO string');
  assert.ok(!q.error, 'no error when headers parse');
  __setFetch(null);
});

// ── quotaFor soft-fails (never throws) when the injected fetch throws ─────────────────────────────
test('quotaFor soft-fails when fetch throws (no throw, remaining:null, error set)', async () => {
  __setFetch(async () => { throw new Error('network boom'); });
  let q;
  await assert.doesNotReject(async () => { q = await quotaFor('groq', { env: { GROQ_API_KEY: 'sk-x' } }); });
  assert.equal(q.remaining, null);
  assert.ok(q.error, 'error string present on soft-fail');
  __setFetch(null);
});

test('quotaFor soft-fails for unknown / unconfigured / keyless providers', async () => {
  const unknown = await quotaFor('nope', {});
  assert.equal(unknown.remaining, null);
  assert.ok(unknown.error);

  const noKey = await quotaFor('gemini', { env: {} });
  assert.equal(noKey.remaining, null);
  assert.ok(/no key/i.test(noKey.error));

  const keyless = await quotaFor('pollinations', {});
  assert.equal(keyless.remaining, null);
  assert.ok(/keyless/i.test(keyless.error));
});

// ── quotaAll probes only configured providers ────────────────────────────────────────────────────
test('quotaAll returns one entry per configured provider (in parallel)', async () => {
  __setFetch(async () => ({ ok: true, headers: fakeHeaders({ 'x-ratelimit-remaining': '5', 'x-ratelimit-limit': '10' }) }));
  const env = { GROQ_API_KEY: 'a', GEMINI_API_KEY: 'b' }; // groq + gemini keyed; pollinations keyless
  const all = await quotaAll({ env });
  const ids = all.map((q) => q.id).sort();
  assert.deepEqual(ids, ['gemini', 'groq', 'pollinations'], 'configured = groq, gemini, keyless pollinations');
  __setFetch(null);
});

// ── handler: 401 unauthed ────────────────────────────────────────────────────────────────────────
test('handler 401s when not authed', async () => {
  __setAuth(() => false);
  const res = fakeRes();
  await handler({ method: 'GET', url: '/api-panel' }, res, { env: {} });
  assert.equal(res.code, 401);
});

// ── handler: 200 authed, renders a provider name, escapes injected markup ─────────────────────────
test('handler 200 authed renders providers and escapes injected <script>', async () => {
  __setAuth(() => true);
  // A provider probe returns a hostile resetAt-ish header value; it must be escaped in the HTML.
  __setFetch(async () => ({
    ok: true,
    headers: fakeHeaders({
      'x-ratelimit-remaining': '3',
      'x-ratelimit-limit': '100',
      'x-ratelimit-reset': '</td><script>alert(1)</script>', // non-numeric → passed through as string
    }),
  }));
  const res = fakeRes();
  await handler({ method: 'GET', url: '/api-panel' }, res, { env: { GROQ_API_KEY: 'k' } });

  assert.equal(res.code, 200);
  assert.match(res.body, /Groq/, 'renders a provider name');
  assert.match(res.body, /Coding-AI API Panel/, 'renders the panel title');
  // The injected markup must be escaped, not present raw.
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw script must not appear');
  assert.match(res.body, /&lt;script&gt;/, 'script tag is HTML-escaped');
  __setFetch(null);
  __setAuth(null);
});

// ── esc() escapes the dangerous characters ───────────────────────────────────────────────────────
test('esc escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});

// ── renderPanel is pure and escapes id/label ────────────────────────────────────────────────────
test('renderPanel escapes provider fields', () => {
  const html = renderPanel(
    [{ id: '<x>', label: '<b>Evil</b>', configured: true }],
    [{ id: '<x>', remaining: 1, limit: 2, resetAt: null }],
  );
  assert.ok(!html.includes('<b>Evil</b>'), 'label must be escaped');
  assert.match(html, /&lt;b&gt;Evil&lt;\/b&gt;/);
});
