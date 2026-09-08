import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITIES, invitedSenders, operators, check, capabilitiesFor, guardSend, handler,
} from './entitlements.mjs';

const ENV = { HERALD_OPERATORS: 'vankush', HERALD_INVITED_SENDERS: 'alice, bob' };
const s = (account) => ({ account });

test('every capability is anonymous to nobody — login is the floor', () => {
  for (const id of Object.keys(CAPABILITIES)) {
    const r = check({ session: null, capability: id, env: ENV });
    assert.equal(r.ok, false, `${id} must require a session`);
    assert.equal(r.code, 'login-required');
  }
});

test('PMs are open to every logged-in account', () => {
  const r = check({ session: s('stranger'), capability: 'pm', env: ENV });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'all-users');
});

test('building a campaign is open — only the send is gated', () => {
  assert.equal(check({ session: s('stranger'), capability: 'campaign_build', env: ENV }).ok, true);
  assert.equal(check({ session: s('stranger'), capability: 'email_send', env: ENV }).ok, false);
});

test('email sending is refused to an uninvited account, with a reason they can read', () => {
  const r = check({ session: s('stranger'), capability: 'email_send', env: ENV });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not-invited');
  assert.match(r.reason, /granted by the operator/);
});

test('the operator always has send, without being on their own invite list', () => {
  const r = check({ session: s('vankush'), capability: 'email_send', env: ENV });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'operator');
  assert.ok(!invitedSenders(ENV).has('vankush'), 'not on the list, still granted');
});

test('an operator-invited account gets send', () => {
  const r = check({ session: s('Alice'), capability: 'email_send', env: ENV });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'operator-invite');
  assert.equal(r.account, 'alice', 'account is normalised from the session');
});

test('IMPERSONATION: a request naming a different account is refused, not silently corrected', () => {
  const r = check({
    session: s('alice'), capability: 'pm', claimedAccount: 'vankush', env: ENV,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'impersonation');
  assert.match(r.reason, /session is @alice but the request acts as @vankush/);
});

test('naming your OWN account is fine', () => {
  assert.equal(check({ session: s('alice'), capability: 'pm', claimedAccount: 'Alice', env: ENV }).ok, true);
});

test('identity is never taken from the request', () => {
  // a caller asserting they are the operator gets nothing from saying so
  const r = check({ session: s('attacker'), capability: 'email_send', claimedAccount: 'vankush', env: ENV });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'impersonation');
});

test('an unknown capability is refused rather than defaulting open', () => {
  const r = check({ session: s('vankush'), capability: 'delete_everything', env: ENV });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unknown-capability');
});

test('the UI can ask what to show, and is told plainly', () => {
  const stranger = capabilitiesFor(s('stranger'), ENV);
  assert.ok(stranger.can.includes('pm'));
  assert.ok(stranger.can.includes('campaign_build'));
  assert.ok(stranger.cannot.includes('email_send'));
  assert.match(stranger.note, /Sending is granted by the operator/);

  const op = capabilitiesFor(s('vankush'), ENV);
  assert.equal(op.cannot.length, 0);
  assert.match(op.note, /Full access/);

  const anon = capabilitiesFor(null, ENV);
  assert.equal(anon.loggedIn, false);
  assert.equal(anon.can.length, 0);
});

test('the send is re-checked at send time, not trusted from build time', () => {
  const camp = { owner: 'alice' };
  assert.equal(guardSend({ session: s('alice'), campaign: camp, env: ENV }).ok, true);
  // grant revoked between building and sending
  const revoked = { HERALD_OPERATORS: 'vankush', HERALD_INVITED_SENDERS: 'bob' };
  const r = guardSend({ session: s('alice'), campaign: camp, env: revoked });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not-invited');
});

test('you cannot send another account\'s campaign', () => {
  const r = guardSend({ session: s('alice'), campaign: { owner: 'bob' }, env: ENV });
  assert.equal(r.ok, false);
  assert.match(r.reason, /belongs to another account|acts as @bob/);
});

test('an empty invite list grants nobody but the operator', () => {
  const env = { HERALD_OPERATORS: 'vankush', HERALD_INVITED_SENDERS: '' };
  assert.equal(invitedSenders(env).size, 0);
  assert.equal(check({ session: s('alice'), capability: 'email_send', env }).ok, false);
  assert.equal(check({ session: s('vankush'), capability: 'email_send', env }).ok, true);
});

test('handler states the policy', () => {
  const res = { statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  handler({ url: '/e' }, res);
  const j = JSON.parse(res.body);
  assert.match(j.policy, /Login required for everything/);
  assert.match(j.policy, /Email sending is operator-granted/);
  assert.match(j.policy, /refused as impersonation/);
  assert.ok(operators({ HERALD_OPERATORS: 'x' }).has('x'));
});
