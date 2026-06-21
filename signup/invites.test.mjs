// invites.test.mjs — OFFLINE. Temp file store; no chain, no keys, no network. Soft-fail-never-throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import {
  issueInvite, redeemInvite, invitesFor, requireInvite, canRedeem, lineage,
  INVITES_PER_ACCOUNT, ROOT,
} from './invites.mjs';

// Each test gets a fresh temp file path so they don't bleed into each other.
let n = 0;
function freshFile() {
  const f = join(tmpdir(), `invites-test-${process.pid}-${n++}.json`);
  try { unlinkSync(f); } catch {}
  return f;
}
const O = (file) => ({ file });

// ── root: unlimited ────────────────────────────────────────────────────────────────────────────────
test('root issues unlimited codes without decrementing', () => {
  const o = O(freshFile());
  const codes = new Set();
  for (let i = 0; i < INVITES_PER_ACCOUNT + 25; i++) {
    const r = issueInvite(ROOT, o);
    assert.equal(r.ok, true);
    assert.equal(r.remaining, Infinity);
    codes.add(r.code);
  }
  assert.equal(codes.size, INVITES_PER_ACCOUNT + 25);   // all distinct, single-use codes
  assert.equal(invitesFor(ROOT, o).unlimited, true);
});

// ── normal account: bounded to INVITES_PER_ACCOUNT ──────────────────────────────────────────────────
test('a normal account issues up to the quota then is refused', () => {
  const o = O(freshFile());
  // alice must be a registered account first → redeem a root invite.
  const inv = issueInvite(ROOT, o);
  assert.equal(redeemInvite(inv.code, 'alice', o).ok, true);
  assert.equal(invitesFor('alice', o).remaining, INVITES_PER_ACCOUNT);

  for (let i = 0; i < INVITES_PER_ACCOUNT; i++) {
    const r = issueInvite('alice', o);
    assert.equal(r.ok, true, `issue ${i} should succeed`);
    assert.equal(r.remaining, INVITES_PER_ACCOUNT - 1 - i);
  }
  // the (quota+1)th is refused
  const over = issueInvite('alice', o);
  assert.equal(over.ok, false);
  assert.match(over.reason, /no invites remaining/);
  assert.equal(invitesFor('alice', o).remaining, 0);
  assert.equal(invitesFor('alice', o).issued, INVITES_PER_ACCOUNT);
});

test('unknown / unregistered inviter is rejected', () => {
  const o = O(freshFile());
  const r = issueInvite('carol', o);   // never redeemed → not registered
  assert.equal(r.ok, false);
  assert.match(r.reason, /unknown or unregistered/);
});

// ── redeem grants quota + registers ──────────────────────────────────────────────────────────────────
test('redeem grants the new account a fresh quota and registers it', () => {
  const o = O(freshFile());
  const inv = issueInvite(ROOT, o);
  const red = redeemInvite(inv.code, 'bob-jones', o);
  assert.equal(red.ok, true);
  assert.equal(red.invitedBy, ROOT);
  assert.equal(red.granted, INVITES_PER_ACCOUNT);

  const standing = invitesFor('bob-jones', o);
  assert.equal(standing.registered, true);
  assert.equal(standing.remaining, INVITES_PER_ACCOUNT);
  assert.equal(standing.invitedBy, ROOT);
});

// ── redeem rejections ────────────────────────────────────────────────────────────────────────────────
test('redeem rejects an unknown code', () => {
  const o = O(freshFile());
  const r = redeemInvite('not-a-real-code', 'alice', o);
  assert.equal(r.ok, false);
  assert.match(r.reason, /unknown invite code/);
});

test('redeem rejects a re-used (already consumed) code', () => {
  const o = O(freshFile());
  const inv = issueInvite(ROOT, o);
  assert.equal(redeemInvite(inv.code, 'alice', o).ok, true);
  const second = redeemInvite(inv.code, 'carol', o);  // same code, different account
  assert.equal(second.ok, false);
  assert.match(second.reason, /already used/);
  // carol must NOT have been registered off a spent code
  assert.equal(invitesFor('carol', o).registered, false);
});

test('redeem rejects an invalid account name', () => {
  const o = O(freshFile());
  const inv = issueInvite(ROOT, o);
  const r = redeemInvite(inv.code, '0xNotAName!', o);
  assert.equal(r.ok, false);
  assert.match(r.reason, /valid MELEK account name/);
  // and the code must still be unused (a bad name didn't burn it)
  assert.equal(requireInvite(inv.code, o).ok, true);
});

test('redeem rejects an already-registered account', () => {
  const o = O(freshFile());
  const inv1 = issueInvite(ROOT, o);
  assert.equal(redeemInvite(inv1.code, 'alice', o).ok, true);
  const inv2 = issueInvite(ROOT, o);
  const r = redeemInvite(inv2.code, 'alice', o);  // alice already exists
  assert.equal(r.ok, false);
  assert.match(r.reason, /already registered/);
  // the second code stays unused (rejection didn't consume it)
  assert.equal(requireInvite(inv2.code, o).ok, true);
});

// ── the gate signup calls ────────────────────────────────────────────────────────────────────────────
test('requireInvite / canRedeem gate a valid unused code, then see it consumed', () => {
  const o = O(freshFile());
  const inv = issueInvite(ROOT, o);
  assert.equal(requireInvite(inv.code, o).ok, true);
  assert.equal(canRedeem(inv.code, o).ok, true);        // alias
  assert.equal(requireInvite(inv.code, o).inviter, ROOT);

  assert.equal(redeemInvite(inv.code, 'alice', o).ok, true);
  // now the gate must refuse it
  const after = requireInvite(inv.code, o);
  assert.equal(after.ok, false);
  assert.match(after.reason, /already used/);

  // empty / missing code
  assert.equal(requireInvite('', o).ok, false);
  assert.equal(requireInvite(null, o).ok, false);
});

// ── lineage ──────────────────────────────────────────────────────────────────────────────────────────
test('lineage chains back to root through the invite tree', () => {
  const o = O(freshFile());
  const i1 = issueInvite(ROOT, o);
  redeemInvite(i1.code, 'alice', o);                     // root -> alice
  const i2 = issueInvite('alice', o);
  redeemInvite(i2.code, 'bob-jones', o);                 // alice -> bob-jones
  const i3 = issueInvite('bob-jones', o);
  redeemInvite(i3.code, 'carol', o);                     // bob-jones -> carol

  assert.deepEqual(lineage('carol', o), ['carol', 'bob-jones', 'alice', ROOT]);
  assert.deepEqual(lineage('alice', o), ['alice', ROOT]);
  assert.deepEqual(lineage(ROOT, o), [ROOT]);
});

// ── invitesFor reflects issued / redeemed ────────────────────────────────────────────────────────────
test('invitesFor reflects remaining / issued / redeemed counts', () => {
  const o = O(freshFile());
  const inv = issueInvite(ROOT, o);
  redeemInvite(inv.code, 'alice', o);

  // alice issues 2, one of which is redeemed
  const a1 = issueInvite('alice', o);
  issueInvite('alice', o);
  redeemInvite(a1.code, 'bob-jones', o);

  const s = invitesFor('alice', o);
  assert.equal(s.issued, 2);
  assert.equal(s.redeemed, 1);
  assert.equal(s.remaining, INVITES_PER_ACCOUNT - 2);
  assert.equal(s.invitedBy, ROOT);
});

// ── bad input soft-fails (no throws) ────────────────────────────────────────────────────────────────
test('bad input soft-fails everywhere (never throws)', () => {
  const o = O(freshFile());
  assert.doesNotThrow(() => issueInvite(undefined, o));
  assert.doesNotThrow(() => issueInvite('!!bad!!', o));
  assert.doesNotThrow(() => redeemInvite(undefined, undefined, o));
  assert.doesNotThrow(() => redeemInvite('x', null, o));
  assert.doesNotThrow(() => requireInvite(undefined, o));
  assert.doesNotThrow(() => lineage(undefined, o));
  assert.doesNotThrow(() => invitesFor(undefined, o));

  assert.equal(issueInvite(undefined, o).ok, false);
  assert.equal(issueInvite('!!bad!!', o).ok, false);
  assert.equal(redeemInvite(undefined, undefined, o).ok, false);
  // unknown account standing is a clean empty view, not a throw
  const empty = invitesFor('nobody', o);
  assert.equal(empty.registered, false);
  assert.equal(empty.remaining, 0);
  assert.deepEqual(lineage('nobody', o), ['nobody']);
});
