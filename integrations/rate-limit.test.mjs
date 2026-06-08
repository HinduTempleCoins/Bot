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
  for (let i = 0; i < 6; i++) outcomes.push(rl.consume({ ip: '10.0.0.1', fingerprint: `acct${i}` }));
  assert.equal(outcomes.slice(0, 5).every((v) => v.allowed), true, 'first 5 allowed');
  assert.equal(outcomes[5].allowed, false, '6th blocked');
  assert.equal(outcomes[5].reason, 'ip-rate-limited');
  assert.ok(outcomes[5].retryAfter > 0);
});

test('fingerprint cap: same fingerprint blocked after fpMax even from new IPs', () => {
  const c = clock();
  const rl = new Limiter({ scope: 'faucet', path: tmpState(), ipMax: 100, fpMax: 3, windowSec: 3600, now: c.now });
  const o = [];
  for (let i = 0; i < 4; i++) o.push(rl.consume({ ip: `10.0.0.${i}`, fingerprint: 'same-device' }));
  assert.equal(o.slice(0, 3).every((v) => v.allowed), true, 'first 3 allowed');
  assert.equal(o[3].allowed, false, '4th blocked by fingerprint');
  assert.equal(o[3].reason, 'fingerprint-rate-limited');
});

test('blocked requests do not consume budget (count holds at cap)', () => {
  const c = clock();
  const rl = new Limiter({ scope: 's', path: tmpState(), ipMax: 2, fpMax: 100, windowSec: 3600, now: c.now });
  rl.consume({ ip: 'x', fingerprint: 'a' });
  rl.consume({ ip: 'x', fingerprint: 'b' });
  const blocked1 = rl.consume({ ip: 'x', fingerprint: 'c' });
  const blocked2 = rl.consume({ ip: 'x', fingerprint: 'd' });
  assert.equal(blocked1.allowed, false);
  assert.equal(blocked2.allowed, false);
  assert.equal(blocked2.ip.count, 2, 'count stays at cap; blocked attempts are not recorded');
});

test('window expiry: allowed again after the window slides past', () => {
  const c = clock();
  const rl = new Limiter({ scope: 's', path: tmpState(), ipMax: 2, fpMax: 100, windowSec: 60, now: c.now });
  assert.equal(rl.consume({ ip: 'y', fingerprint: 'a' }).allowed, true);
  assert.equal(rl.consume({ ip: 'y', fingerprint: 'b' }).allowed, true);
  assert.equal(rl.consume({ ip: 'y', fingerprint: 'c' }).allowed, false, 'over cap inside window');
  c.advance(61); // window (60s) has fully passed
  assert.equal(rl.consume({ ip: 'y', fingerprint: 'd' }).allowed, true, 'allowed after window expiry');
});

test('persists across instances (same file)', () => {
  const path = tmpState();
  const c = clock();
  const a = new Limiter({ scope: 's', path, ipMax: 3, fpMax: 100, windowSec: 3600, now: c.now });
  a.consume({ ip: 'z', fingerprint: '1' });
  a.consume({ ip: 'z', fingerprint: '2' });
  // new instance reads the same file
  const b = new Limiter({ scope: 's', path, ipMax: 3, fpMax: 100, windowSec: 3600, now: c.now });
  assert.equal(b.consume({ ip: 'z', fingerprint: '3' }).allowed, true, '3rd allowed');
  assert.equal(b.consume({ ip: 'z', fingerprint: '4' }).allowed, false, '4th blocked — state carried over');
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
  assert.equal(faucet.consume({ ip: 'ip1', fingerprint: 'a' }).allowed, true);
  assert.equal(faucet.consume({ ip: 'ip1', fingerprint: 'b' }).allowed, false, 'faucet cap hit');
  assert.equal(email.consume({ ip: 'ip1', fingerprint: 'a' }).allowed, true, 'email scope independent');
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

test('record never throws on garbage input', () => {
  const rl = new Limiter({ scope: 's', path: tmpState(), now: () => 1 });
  assert.doesNotThrow(() => rl.record());
  assert.doesNotThrow(() => rl.record({ ip: null, fingerprint: undefined }));
  assert.doesNotThrow(() => rl.record({ ip: 12345, fingerprint: { x: 1 } }));
});

// ── FINDING 2: check() must NOT count; only record() counts. ────────────────────────────────────
test('check() does NOT consume a slot — repeated checks without record stay allowed', () => {
  const c = clock();
  const rl = new Limiter({ scope: 'faucet', path: tmpState(), ipMax: 2, fpMax: 100, windowSec: 3600, now: c.now });
  const key = { ip: 'ip-a', fingerprint: 'fp-a' };
  // Five checks in a row with no record() — none of them should burn budget.
  for (let i = 0; i < 5; i++) assert.equal(rl.check(key).allowed, true, `check #${i + 1} still allowed`);
  assert.equal(rl.peek(key).ip, 0, 'no hits recorded by check() alone');
});

test('failed broadcast (check without record) does NOT consume a slot; success (record) does', () => {
  const c = clock();
  const rl = new Limiter({ scope: 'faucet', path: tmpState(), ipMax: 2, fpMax: 100, windowSec: 3600, now: c.now });
  const key = { ip: 'ip-b', fingerprint: 'fp-b' };

  // Two transient broadcast FAILURES: caller checks (allowed) but never records.
  assert.equal(rl.check(key).allowed, true, 'attempt 1 allowed');
  // ...broadcast fails, no record()...
  assert.equal(rl.check(key).allowed, true, 'attempt 2 allowed (failure did not burn a slot)');
  // ...broadcast fails again, no record()...
  // A real user can still get through — the failures cost nothing.
  assert.equal(rl.check(key).allowed, true, 'attempt 3 still allowed after 2 failures');

  // Now a SUCCESS: record one event.
  rl.record(key);
  assert.equal(rl.peek(key).ip, 1, 'one successful event recorded');

  // A second success records the second slot...
  assert.equal(rl.check(key).allowed, true);
  rl.record(key);
  assert.equal(rl.peek(key).ip, 2, 'two successful events recorded');

  // ...and now we are AT cap: the next check is rejected.
  assert.equal(rl.check(key).allowed, false, 'over-cap still rejects after 2 successes');
});

test('over-cap rejection holds regardless of how many checks precede record', () => {
  const c = clock();
  const rl = new Limiter({ scope: 'faucet', path: tmpState(), ipMax: 1, fpMax: 100, windowSec: 3600, now: c.now });
  const key = { ip: 'ip-c', fingerprint: 'fp-c' };
  assert.equal(rl.check(key).allowed, true);
  rl.record(key);                         // one success -> at cap (ipMax 1)
  const v = rl.check(key);
  assert.equal(v.allowed, false, 'second request rejected');
  assert.equal(v.reason, 'ip-rate-limited');
  assert.ok(v.retryAfter > 0);
});

test('consume() = check + record in one call (backward-compat)', () => {
  const c = clock();
  const rl = new Limiter({ scope: 'faucet', path: tmpState(), ipMax: 1, fpMax: 100, windowSec: 3600, now: c.now });
  const key = { ip: 'ip-d', fingerprint: 'fp-d' };
  assert.equal(rl.consume(key).allowed, true, 'first consume allowed and counted');
  assert.equal(rl.peek(key).ip, 1, 'consume recorded the event');
  const blocked = rl.consume(key);
  assert.equal(blocked.allowed, false, 'second consume blocked — consume counts like the old check()');
});
