// melek-permission-tiers.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIER, FUNDS_ENABLED, scopeTier, scopePolicy, classifyScopes, consentModel, guardGrant, asScopes,
} from './melek-permission-tiers.mjs';

test('funds is disabled by default (the load-bearing fact)', () => {
  assert.equal(FUNDS_ENABLED, false);
});

test('scopes classify into the right tiers; unknown → UNKNOWN', () => {
  assert.equal(scopeTier('openid'), TIER.IDENTITY);
  assert.equal(scopeTier('posting'), TIER.SOCIAL);
  assert.equal(scopeTier('vote'), TIER.SOCIAL);
  assert.equal(scopeTier('transfer'), TIER.FUNDS);
  assert.equal(scopeTier('active'), TIER.FUNDS);
  assert.equal(scopeTier('wat'), TIER.UNKNOWN);
});

test('identity is auto, social needs consent, funds is blocked, unknown is denied', () => {
  assert.deepEqual(scopePolicy('openid'), { tier: TIER.IDENTITY, allowed: true, auto: true, requiresConsent: false });
  const social = scopePolicy('posting');
  assert.equal(social.allowed, true); assert.equal(social.auto, false); assert.equal(social.requiresConsent, true);
  const funds = scopePolicy('transfer');
  assert.equal(funds.allowed, false);                         // disabled
  assert.match(funds.reason, /disabled|not available/);
  assert.equal(scopePolicy('mystery').allowed, false);        // fail-closed
});

test('classifyScopes: identity-only login proceeds with no consent screen', () => {
  const c = classifyScopes('openid profile');
  assert.equal(c.tier, TIER.IDENTITY);
  assert.equal(c.requiresConsent, false);
  assert.equal(c.canProceed, true);
  assert.deepEqual(c.blocked, []);
});

test('classifyScopes: identity + social proceeds but REQUIRES explicit consent', () => {
  const c = classifyScopes('openid posting vote');
  assert.equal(c.tier, TIER.SOCIAL);
  assert.equal(c.requiresConsent, true);
  assert.equal(c.canProceed, true);
  assert.equal(c.fundsRequested, false);
});

test('classifyScopes: any funds scope is BLOCKED and cannot proceed', () => {
  const c = classifyScopes('openid posting transfer');
  assert.equal(c.tier, TIER.FUNDS);
  assert.equal(c.fundsRequested, true);
  assert.deepEqual(c.blocked, ['transfer']);
  assert.equal(c.canProceed, false);                          // the whole request can't be granted as-is
});

test('consentModel labels each row auto / consent / blocked for the approval screen', () => {
  const m = consentModel('some-app', 'openid posting transfer');
  const byScope = Object.fromEntries(m.rows.map((r) => [r.scope, r.state]));
  assert.equal(byScope.openid, 'auto');
  assert.equal(byScope.posting, 'consent');
  assert.equal(byScope.transfer, 'blocked');
  assert.equal(m.fundsBlocked, true);
  assert.equal(m.canProceed, false);
  assert.match(m.note, /turned off/);
});

test('guardGrant returns grantable identity+social scopes but THROWS on funds (defense in depth)', () => {
  assert.deepEqual(guardGrant('openid posting'), ['openid', 'posting']);
  assert.throws(() => guardGrant('openid transfer'), /funds-moving scope refused/);
  assert.throws(() => guardGrant('openid bogus'), /scope refused/);   // unknown too
});

test('asScopes normalizes arrays, spaces, commas, case', () => {
  assert.deepEqual(asScopes('OpenID, Posting  vote'), ['openid', 'posting', 'vote']);
  assert.deepEqual(asScopes(['Transfer']), ['transfer']);
});
