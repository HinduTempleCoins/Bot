// caddy-config.test.mjs — offline tests for the Caddy rate-limit + CrowdSec bouncer generator (task #30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rateLimitSnippet,
  crowdsecSnippet,
  caddyfileFor,
  xcaddyBuildCommand,
  setupRunbook,
  validateConfig,
} from './caddy-config.mjs';

test('rateLimitSnippet emits a rate_limit block with the events/window/zone/key', () => {
  const s = rateLimitSnippet({ zone: 'api', events: 30, window: '10s', key: '{remote_host}' });
  assert.match(s, /rate_limit\s*\{/);
  assert.match(s, /zone api \{/);
  assert.match(s, /events 30/);
  assert.match(s, /window 10s/);
  assert.match(s, /key\s+\{remote_host\}/);
});

test('rateLimitSnippet soft-fails bad input to sensible defaults', () => {
  const s = rateLimitSnippet({ events: -5, window: '', zone: '' });
  assert.match(s, /zone static \{/);
  assert.match(s, /events 100/);
  assert.match(s, /window 1m/);
  // non-object arg is tolerated
  assert.match(rateLimitSnippet(null), /rate_limit/);
});

test('crowdsecSnippet references env var NAMES via {env.NAME} and contains NO key literal', () => {
  const s = crowdsecSnippet({ apiUrlEnv: 'CROWDSEC_API_URL', apiKeyEnv: 'CROWDSEC_BOUNCER_API_KEY' });
  assert.match(s, /crowdsec\s*\{/);
  assert.match(s, /api_url \{env\.CROWDSEC_API_URL\}/);
  assert.match(s, /api_key \{env\.CROWDSEC_BOUNCER_API_KEY\}/);
  // no literal key/value smuggled in — only the {env.NAME} placeholder form.
  assert.ok(!/api_key\s+[A-Za-z0-9+/]{16,}/.test(s), 'must not contain a literal API key');
  assert.ok(!/https?:\/\//.test(s), 'must not contain a literal URL');
});

test('crowdsecSnippet appsec toggle', () => {
  assert.match(crowdsecSnippet({ appsec: true }), /appsec_url \{env\.CROWDSEC_APPSEC_URL\}/);
  assert.ok(!/appsec_url/.test(crowdsecSnippet({ appsec: false })));
});

test('caddyfileFor includes the domains + auto-TLS + both protections', () => {
  const cf = caddyfileFor({
    domains: ['data.example.com', 'forums.example.com'],
    rateLimits: [{ zone: 'static', events: 100, window: '1m' }],
    crowdsec: { apiUrlEnv: 'CROWDSEC_API_URL', apiKeyEnv: 'CROWDSEC_BOUNCER_API_KEY', appsec: true },
  });
  // domains present as site blocks
  assert.match(cf, /data\.example\.com \{/);
  assert.match(cf, /forums\.example\.com \{/);
  // automatic HTTPS / TLS mentioned
  assert.match(cf, /Automatic HTTPS/i);
  // rate limiting present
  assert.match(cf, /rate_limit \{/);
  assert.match(cf, /zone static/);
  // crowdsec bouncer present (global config + per-site directive)
  assert.match(cf, /api_url \{env\.CROWDSEC_API_URL\}/);
  assert.match(cf, /api_key \{env\.CROWDSEC_BOUNCER_API_KEY\}/);
  assert.match(cf, /^\s*crowdsec$/m);
  assert.match(cf, /^\s*appsec$/m);
  // no secret literals leaked
  assert.ok(!/api_key\s+[A-Za-z0-9+/]{16,}/.test(cf));
});

test('caddyfileFor is deterministic (same input → same output)', () => {
  const cfg = { domains: ['a.example.com'], crowdsec: { apiUrlEnv: 'CROWDSEC_API_URL', apiKeyEnv: 'CROWDSEC_BOUNCER_API_KEY' } };
  assert.equal(caddyfileFor(cfg), caddyfileFor(cfg));
});

test('caddyfileFor soft-fails with no domains (still produces a usable annotated file)', () => {
  const cf = caddyfileFor({});
  assert.match(cf, /no domains supplied/i);
  assert.match(cf, /rate_limit \{/);
});

test('xcaddyBuildCommand names the ratelimit + crowdsec plugins', () => {
  const cmd = xcaddyBuildCommand();
  assert.match(cmd, /xcaddy build/);
  assert.match(cmd, /caddy-ratelimit/);
  assert.match(cmd, /crowdsec-bouncer/);
  assert.match(cmd, /--with/);
  // version pinning
  assert.match(xcaddyBuildCommand({ caddyVersion: 'v2.8.4' }), /xcaddy build v2\.8\.4/);
});

test('setupRunbook mentions xcaddy + CrowdSec + reload + hardening', () => {
  const rb = setupRunbook();
  assert.match(rb, /xcaddy/);
  assert.match(rb, /CrowdSec/);
  assert.match(rb, /reload/i);
  assert.match(rb, /cscli bouncers add/);
  assert.match(rb, /Hardening/i);
  // env var NAMES present; no literal secret value
  assert.match(rb, /CROWDSEC_BOUNCER_API_KEY/);
  assert.ok(!/api_key\s*=\s*[A-Za-z0-9+/]{16,}/.test(rb));
});

test('validateConfig accepts a good env-name-only config', () => {
  const r = validateConfig({
    domains: ['example.com'],
    rateLimits: [{ zone: 'static', events: 100, window: '1m' }],
    crowdsec: { apiUrlEnv: 'CROWDSEC_API_URL', apiKeyEnv: 'CROWDSEC_BOUNCER_API_KEY' },
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.errors, []);
});

test('validateConfig catches a hardcoded secret literal', () => {
  const r = validateConfig({
    domains: ['example.com'],
    crowdsec: { apiUrlEnv: 'CROWDSEC_API_URL', api_key: 'abc123SECRETliteralvalue==' },
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /hardcoded secret/i.test(e)), JSON.stringify(r.errors));
});

test('validateConfig catches a secret in a nested non-crowdsec field too', () => {
  const r = validateConfig({ domains: ['example.com'], extra: { password: 'hunter2plaintext' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /hardcoded secret/i.test(e)));
});

test('validateConfig flags structural problems and never throws', () => {
  assert.equal(validateConfig(null).ok, false);
  assert.equal(validateConfig({ domains: [] }).ok, false);
  assert.equal(validateConfig({ domains: 'nope' }).ok, false);
  assert.equal(validateConfig({ rateLimits: [{ zone: 'z', events: -1 }] }).ok, false);
  assert.equal(validateConfig({ crowdsec: { apiKeyEnv: 'not a name' } }).ok, false);
});
