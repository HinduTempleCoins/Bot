// dev-trust-guard.test.mjs — OFFLINE. The code-level guard that makes the DEV-TRUST fallback safe:
// honored ONLY on a genuinely-local, non-production request; and a startup REFUSAL if a flag is set in prod.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  honorDevTrust, assertStartupSafe, isLoopbackReq, productionIndicator, anyDevTrustFlag, isLoopbackHost,
} from './dev-trust-guard.mjs';

// keep the process env clean between assertions
const FLAGS = ['PENTECAUST_DEV_TRUST', 'TEAMS_DEV_TRUST_QUERY', 'INVITES_DEV_TRUST'];
const PRODS = ['MELEK_ENV', 'NODE_ENV', 'PENTECAUST_ENV', 'PROD'];
function clean() { for (const k of [...FLAGS, ...PRODS]) delete process.env[k]; }
const loopbackReq = (headers = {}) => ({ headers, socket: { remoteAddress: '127.0.0.1' } });
const publicReq = (headers = {}) => ({ headers, socket: { remoteAddress: '203.0.113.7' } });

test('isLoopbackHost: only real loopback addresses (and empty) count', () => {
  for (const h of ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '']) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ['0.0.0.0', '::', '203.0.113.7', '10.0.0.5', 'example.com']) assert.equal(isLoopbackHost(h), false, h);
});

test('isLoopbackReq: loopback socket is local; public IP, a forwarding header, or no socket are NOT', () => {
  assert.equal(isLoopbackReq(loopbackReq()), true);
  assert.equal(isLoopbackReq(publicReq()), false);
  // behind a reverse proxy the socket is loopback but a forwarding header betrays a public client
  assert.equal(isLoopbackReq(loopbackReq({ 'x-forwarded-for': '203.0.113.7' })), false);
  assert.equal(isLoopbackReq(loopbackReq({ 'x-real-ip': '203.0.113.7' })), false);
  assert.equal(isLoopbackReq(loopbackReq({ forwarded: 'for=203.0.113.7' })), false);
  assert.equal(isLoopbackReq({ headers: {} }), false);   // no socket → fail closed
  assert.equal(isLoopbackReq(null), false);
});

test('honorDevTrust: TRUE only on a local request with the flag on and no production marker', () => {
  clean();
  assert.equal(honorDevTrust(loopbackReq(), true), true);          // flag on + local + not-prod
  assert.equal(honorDevTrust(loopbackReq(), false), false);        // flag off → never
  assert.equal(honorDevTrust(publicReq(), true), false);           // off loopback → inert (can't impersonate)
  assert.equal(honorDevTrust(loopbackReq({ 'x-forwarded-for': '9.9.9.9' }), true), false); // proxied → inert
  process.env.NODE_ENV = 'production';
  assert.equal(honorDevTrust(loopbackReq(), true), false);         // production env → inert even on loopback
  clean();
});

test('productionIndicator: env markers, and (for startup) a non-loopback bind host', () => {
  clean();
  assert.equal(productionIndicator(), false);
  process.env.MELEK_ENV = 'production'; assert.equal(productionIndicator(), true); clean();
  process.env.PENTECAUST_ENV = 'production'; assert.equal(productionIndicator(), true); clean();
  process.env.PROD = '1'; assert.equal(productionIndicator(), true); clean();
  assert.equal(productionIndicator({ host: '0.0.0.0' }), true);    // binding a public host is a prod signal
  assert.equal(productionIndicator({ host: '127.0.0.1' }), false); // loopback bind is not
});

test('anyDevTrustFlag: true if ANY of the three flags is set to 1', () => {
  clean();
  assert.equal(anyDevTrustFlag(), false);
  for (const f of FLAGS) { process.env[f] = '1'; assert.equal(anyDevTrustFlag(), true, f); delete process.env[f]; }
});

test('assertStartupSafe: REFUSES (exit non-zero) when a dev-trust flag is set with a production indicator', () => {
  clean();
  process.env.PENTECAUST_DEV_TRUST = '1';
  process.env.NODE_ENV = 'production';
  let exited = null; let logged = '';
  const ok = assertStartupSafe({ log: (m) => { logged += m; }, exit: (c) => { exited = c; } });
  assert.equal(ok, false);
  assert.equal(exited, 1);                                 // non-zero exit
  assert.match(logged, /Refusing to start/i);
  clean();
});

test('assertStartupSafe: REFUSES when a flag is set while binding a non-loopback host (even with no prod env)', () => {
  clean();
  process.env.INVITES_DEV_TRUST = '1';
  let exited = null;
  const ok = assertStartupSafe({ host: '0.0.0.0', log: () => {}, exit: (c) => { exited = c; } });
  assert.equal(ok, false); assert.equal(exited, 1);
  clean();
});

test('assertStartupSafe: ALLOWS a local dev box (flag set, loopback host, no prod marker)', () => {
  clean();
  process.env.TEAMS_DEV_TRUST_QUERY = '1';
  let exited = null;
  const ok = assertStartupSafe({ host: '127.0.0.1', log: () => {}, exit: (c) => { exited = c; } });
  assert.equal(ok, true); assert.equal(exited, null);      // dev with dev-trust is fine locally
  clean();
});

test('assertStartupSafe: ALLOWS production when NO dev-trust flag is set (normal deploy)', () => {
  clean();
  process.env.NODE_ENV = 'production';
  let exited = null;
  const ok = assertStartupSafe({ host: '0.0.0.0', log: () => {}, exit: (c) => { exited = c; } });
  assert.equal(ok, true); assert.equal(exited, null);
  clean();
});
