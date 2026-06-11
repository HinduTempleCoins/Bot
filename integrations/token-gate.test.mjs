// token-gate.test.mjs — offline tests for the pure token-gated role evaluator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  DEFAULT_TIERS,
  evaluateGate,
  highestTier,
  renderAccessBadge,
} from './token-gate.mjs';

test('esc escapes HTML-significant characters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

test('DEFAULT_TIERS is a frozen array of frozen tier objects', () => {
  assert.ok(Array.isArray(DEFAULT_TIERS));
  assert.ok(Object.isFrozen(DEFAULT_TIERS));
  for (const t of DEFAULT_TIERS) {
    assert.ok(Object.isFrozen(t));
    assert.equal(typeof t.role, 'string');
    assert.equal(typeof t.minBalance, 'number');
    assert.equal(typeof t.token, 'string');
  }
});

test('evaluateGate grants single-token tiers at or above threshold (>=)', () => {
  const res = evaluateGate({ balances: { VKBT: 100 }, rules: DEFAULT_TIERS });
  // 100 meets member(100) and holder(1) but not whale(10000)
  assert.deepEqual(res.grantedRoles.sort(), ['holder', 'member']);
  assert.equal(res.deniedRoles.length, 1);
  assert.equal(res.deniedRoles[0].role, 'whale');
  assert.equal(res.deniedRoles[0].short, 'below-min');
});

test('evaluateGate exact threshold is granted (boundary, >=)', () => {
  const res = evaluateGate({ balances: { VKBT: 10000 }, rules: DEFAULT_TIERS });
  assert.deepEqual(res.grantedRoles.sort(), ['holder', 'member', 'whale']);
  assert.equal(res.deniedRoles.length, 0);
});

test('evaluateGate allOf AND-gate requires every condition', () => {
  const rules = [
    { role: 'council', allOf: [{ token: 'VKBT', min: 100 }, { token: 'MELEK', min: 1 }] },
  ];
  const granted = evaluateGate({ balances: { VKBT: 100, MELEK: 1 }, rules });
  assert.deepEqual(granted.grantedRoles, ['council']);

  const denied = evaluateGate({ balances: { VKBT: 100, MELEK: 0 }, rules });
  assert.deepEqual(denied.grantedRoles, []);
  assert.equal(denied.deniedRoles[0].short, 'and-gate-unmet');
  assert.match(denied.deniedRoles[0].reason, /MELEK/);
});

test('missing and garbage balances are treated as 0', () => {
  const rules = [{ role: 'holder', token: 'VKBT', minBalance: 1 }];
  assert.deepEqual(evaluateGate({ balances: {}, rules }).grantedRoles, []);
  assert.deepEqual(evaluateGate({ balances: { VKBT: 'oops' }, rules }).grantedRoles, []);
  assert.deepEqual(evaluateGate({ balances: { VKBT: NaN }, rules }).grantedRoles, []);
  assert.deepEqual(evaluateGate({ balances: { VKBT: -5 }, rules }).grantedRoles, []);
  // string-numeric still parses
  assert.deepEqual(evaluateGate({ balances: { VKBT: '3' }, rules }).grantedRoles, ['holder']);
});

test('evaluateGate handles malformed rules without throwing', () => {
  const res = evaluateGate({
    balances: { VKBT: 50 },
    rules: [
      { token: 'VKBT', minBalance: 1 },     // missing role
      { role: 'empty', allOf: [] },          // empty gate
      null,                                  // junk
      { role: 'holder', token: 'VKBT', minBalance: 1 },
    ],
  });
  assert.deepEqual(res.grantedRoles, ['holder']);
  assert.ok(res.deniedRoles.some((d) => d.short === 'no-role'));
  assert.ok(res.deniedRoles.some((d) => d.short === 'no-conditions'));
});

test('duplicate roles are not double-granted', () => {
  const rules = [
    { role: 'holder', token: 'VKBT', minBalance: 1 },
    { role: 'holder', token: 'MELEK', minBalance: 1 },
  ];
  const res = evaluateGate({ balances: { VKBT: 5, MELEK: 5 }, rules });
  assert.deepEqual(res.grantedRoles, ['holder']);
});

test('evaluateGate soft-fails on non-object input', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    const res = evaluateGate(bad);
    assert.deepEqual(res, { grantedRoles: [], deniedRoles: [] });
  }
});

test('highestTier returns the best granted role by threshold weight', () => {
  assert.equal(highestTier({ VKBT: 10000 }, DEFAULT_TIERS), 'whale');
  assert.equal(highestTier({ VKBT: 100 }, DEFAULT_TIERS), 'member');
  assert.equal(highestTier({ VKBT: 1 }, DEFAULT_TIERS), 'holder');
  assert.equal(highestTier({ VKBT: 0 }, DEFAULT_TIERS), null);
});

test('highestTier weights AND-gates by sum of mins', () => {
  const rules = [
    { role: 'holder', token: 'VKBT', minBalance: 1 },
    { role: 'council', allOf: [{ token: 'VKBT', min: 100 }, { token: 'MELEK', min: 50 }] },
  ];
  assert.equal(highestTier({ VKBT: 200, MELEK: 60 }, rules), 'council');
  assert.equal(highestTier({ VKBT: 200, MELEK: 0 }, rules), 'holder');
  assert.equal(highestTier({ VKBT: 0 }, rules), null);
});

test('highestTier soft-fails on bad rules arg', () => {
  assert.equal(highestTier({ VKBT: 100 }, null), null);
  assert.equal(highestTier(null, DEFAULT_TIERS), null);
});

test('renderAccessBadge produces an esc()d one-line string', () => {
  const res = evaluateGate({ balances: { VKBT: 100 }, rules: DEFAULT_TIERS });
  const html = renderAccessBadge('alice', res);
  assert.ok(!html.includes('\n'));
  assert.match(html, /access-badge/);
  assert.match(html, /alice/);
  assert.match(html, /member/);
});

test('renderAccessBadge escapes account and roles, shows none when empty', () => {
  const none = renderAccessBadge('<bob>', { grantedRoles: [] });
  assert.match(none, /&lt;bob&gt;: no roles/);
  assert.ok(!none.includes('<bob>'));

  const evil = renderAccessBadge('x', { grantedRoles: ['<script>'] });
  assert.match(evil, /&lt;script&gt;/);
  assert.ok(!evil.includes('<script>'));
});

test('renderAccessBadge soft-fails on missing result', () => {
  const html = renderAccessBadge(null, null);
  assert.match(html, /anon: no roles/);
});
