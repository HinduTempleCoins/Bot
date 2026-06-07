// integrations/rate-limit.test.mjs — offline tests for the signup rate limiter.
// node --test integrations/rate-limit.test.mjs
//
// Fully offline: injectable clock, a temp state file per test, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Limiter, clientIp } from './rate-limit.mjs';

function tmpState() {
  const dir = mkdtempSync(join(tmpdir(), 'rl-test-'));
  return join(dir, 'state.json');
}
function clock(start = 1_000_000_000_000) {
  const o = { t: start };
  o.now = () => o.t;
  o.advance = (sec) => { o.t += sec * 1000; };
  return o;
}

test('IP cap: 6th mint from one IP is blocked even with fresh fingerprints', () => {
  const c = clock();
  const rl = new Limiter({ scope: 'faucet', path: tmpState(), ipMax: 5, fpMax: 100, windowSec: 3600, now: c.now });
  const outcomes = [];
  for (let i = 0; i < 6; i++) outcomes.push(rl.check({ ip: '10.0.0.1', fingerprint: `acct${i}` }));
  assert.equal(outcomes.slice(0, 5).every((v) => v.allowed), true, 'first 5 allowed');
  assert.equal(outcomes[5].allowed, false, '6th blocked');
  assert.equal(outcomes[5].reason, 'ip-rate-limited');
  assert.ok(outcomes[5].retryAfter > 0);
});

test('fingerprint cap: same fingerprint blocked after fpMax even from new IPs', () => {
  const c = clock();
  const rl = new Limiter({ scope: 'faucet', path: tmpState(), ipMax: 100, fpMax: 3, windowSec: 3600, now: c.now });
  const o = [];
  for (let i = 0; i < 4; i++) o.push(rl.check({ ip: `10.0.0.${i}`, fingerprint: 'same-device' }));
  assert.equal(o.slice(0, 3).every((v) => v.allowed), true, 'first 3 allowed');
  assert.equal(o[3].allowed, false, '4th blocked by fingerprint');
  assert.equal(o[3].reason, 'fingerprint-rate-limited');
});

test('blocked requests do not consume budget (count holds at cap)', () => {
  const c = clock();
  const rl = new Limiter({ scope: 's', path: tmpState(), ipMax: 2, fpMax: 100, windowSec: 3600, now: c.now });
  rl.check({ ip: 'x', fingerprint: 'a' });
  rl.check({ ip: 'x', fingerprint: 'b' });
  const blocked1 = rl.check({ ip: 'x', fingerprint: 'c' });
  const blocked2 = rl.check({ ip: 'x', fingerprint: 'd' });
  assert.equal(blocked1.allowed, false);
  assert.equal(blocked2.allowed, false);
  assert.equal(blocked2.ip.count, 2, 'count stays at cap; blocked attempts are not recorded');
});

test('window expiry: allowed again after the window slides past', () => {
  const c = clock();
  const rl = new Limiter({ scope: 's', path: tmpState(), ipMax: 2, fpMax: 100, windowSec: 60, now: c.now });
  assert.equal(rl.check({ ip: 'y', fingerprint: 'a' }).allowed, true);
  assert.equal(rl.check({ ip: 'y', fingerprint: 'b' }).allowed, true);
  assert.equal(rl.check({ ip: 'y', fingerprint: 'c' }).allowed, false, 'over cap inside window');
  c.advance(61); // window (60s) has fully passed
  assert.equal(rl.check({ ip: 'y', fingerprint: 'd' }).allowed, true, 'allowed after window expiry');
});

test('persists across instances (same file)', () => {
  const path = tmpState();
  const c = clock();
  const a = new Limiter({ scope: 's', path, ipMax: 3, fpMax: 100, windowSec: 3600, now: c.now });
  a.check({ ip: 'z', fingerprint: '1' });
  a.check({ ip: 'z', fingerprint: '2' });
  // new instance reads the same file
  const b = new Limiter({ scope: 's', path, ipMax: 3, fpMax: 100, windowSec: 3600, now: c.now });
  assert.equal(b.check({ ip: 'z', fingerprint: '3' }).allowed, true, '3rd allowed');
  assert.equal(b.check({ ip: 'z', fingerprint: '4' }).allowed, false, '4th blocked — state carried over');
});

test('soft-fail OPEN on corrupt state file (never lock users out)', () => {
  const path = tmpState();
  writeFileSync(path, '{ this is not json ');
  const c = clock();
  const rl = new Limiter({ scope: 's', path, ipMax: 1, fpMax: 100, windowSec: 3600, now: c.now });
  const v = rl.check({ ip: 'a', fingerprint: 'b' });
  assert.equal(v.allowed, true, 'corrupt state starts clean and allows');
});

test('RL_DISABLED-style disabled flag always allows', () => {
  const c = clock();
  const rl = new Limiter({ scope: 's', path: tmpState(), ipMax: 1, fpMax: 1, disabled: true, now: c.now });
  for (let i = 0; i < 10; i++) assert.equal(rl.check({ ip: 'q', fingerprint: 'q' }).allowed, true);
});

test('different scopes do not share budget through one file', () => {
  const path = tmpState();
  const c = clock();
  const faucet = new Limiter({ scope: 'faucet', path, ipMax: 1, fpMax: 100, windowSec: 3600, now: c.now });
  const email = new Limiter({ scope: 'email', path, ipMax: 1, fpMax: 100, windowSec: 3600, now: c.now });
  assert.equal(faucet.check({ ip: 'ip1', fingerprint: 'a' }).allowed, true);
  assert.equal(faucet.check({ ip: 'ip1', fingerprint: 'b' }).allowed, false, 'faucet cap hit');
  assert.equal(email.check({ ip: 'ip1', fingerprint: 'a' }).allowed, true, 'email scope independent');
});

test('atomic write leaves valid JSON on disk', () => {
  const path = tmpState();
  const c = clock();
  const rl = new Limiter({ scope: 's', path, ipMax: 5, fpMax: 5, windowSec: 3600, now: c.now });
  rl.check({ ip: 'a', fingerprint: 'b' });
  assert.equal(existsSync(path), true);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(parsed._meta.version, 1);
  assert.equal(typeof parsed.buckets, 'object');
});

test('clientIp prefers X-Forwarded-For first hop, falls back to socket', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }), '203.0.113.9');
  assert.equal(clientIp({ headers: { 'x-real-ip': '198.51.100.2' } }), '198.51.100.2');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '192.0.2.5' } }), '192.0.2.5');
  assert.equal(clientIp({}), 'unknown');
  assert.equal(clientIp(null), 'unknown');
});

test('check never throws on garbage input', () => {
  const rl = new Limiter({ scope: 's', path: tmpState(), now: () => 1 });
  assert.doesNotThrow(() => rl.check());
  assert.doesNotThrow(() => rl.check({ ip: null, fingerprint: undefined }));
  assert.doesNotThrow(() => rl.check({ ip: 12345, fingerprint: { x: 1 } }));
});
