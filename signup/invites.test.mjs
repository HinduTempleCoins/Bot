// invites.test.mjs — OFFLINE. Temp file store; no chain, no keys, no network. Soft-fail-never-throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import {
  issueInvite, redeemInvite, invitesFor, requireInvite, canRedeem, lineage,
  INVITES_PER_ACCOUNT, ROOT, handler, __setAuthVerifier,
  tree, INVITE_PROBATION_MS,
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

// ── handler: verified-identity, exact routing, deny-by-default (the security boundary) ───────────────
function cap() {
  const o = { code: 0, body: '' };
  return { res: { writeHead: (c) => { o.code = c; }, end: (b) => { o.body = b || ''; } }, o };
}
const hreq = (path, method = 'GET', headers = {}) => ({ url: path, method, headers });
const J = (o) => { try { return JSON.parse(o.body); } catch { return {}; } };

test('handler: deny-by-default — no verified identity → 401 on mutations', () => {
  process.env.INVITES_DATA = freshFile(); __setAuthVerifier(null);
  let { res, o } = cap(); handler(hreq('/issue', 'POST'), res); assert.equal(o.code, 401);
  ({ res, o } = cap()); handler(hreq('/redeem?code=x', 'POST'), res); assert.equal(o.code, 401);
});

test('handler: identity comes from the verifier, NOT a spoofable query field', () => {
  process.env.INVITES_DATA = freshFile();
  __setAuthVerifier(() => 'hathor');                       // verified caller = root
  const { res, o } = cap(); handler(hreq('/issue?inviter=victim', 'POST'), res);
  assert.equal(o.code, 200); assert.equal(J(o).inviter, 'hathor');   // query 'victim' ignored
  __setAuthVerifier(null);
});

test('handler: redeem registers the VERIFIED account, not a query field', () => {
  process.env.INVITES_DATA = freshFile();
  __setAuthVerifier(() => 'hathor');
  const iss = cap(); handler(hreq('/issue', 'POST'), iss.res); const code = J(iss.o).code;
  __setAuthVerifier(() => 'alice');                        // alice proves control of her own account
  const { res, o } = cap(); handler(hreq('/redeem?code=' + code + '&account=mallory', 'POST'), res);
  assert.equal(J(o).ok, true); assert.equal(J(o).account, 'alice');  // not 'mallory'
  __setAuthVerifier(null);
});

test('handler: exact-segment routing + method guards (no endsWith bypass)', () => {
  process.env.INVITES_DATA = freshFile(); __setAuthVerifier(() => 'hathor');
  let { res, o } = cap(); handler(hreq('/issue', 'GET'), res); assert.equal(o.code, 405);
  ({ res, o } = cap()); handler(hreq('/nope', 'POST'), res); assert.equal(o.code, 404);
  __setAuthVerifier(null);
});

test('handler: code check is public; standing/lineage are scoped to the caller', () => {
  process.env.INVITES_DATA = freshFile();
  __setAuthVerifier(() => 'hathor');
  const iss = cap(); handler(hreq('/issue', 'POST'), iss.res); const code = J(iss.o).code;
  __setAuthVerifier(null);
  let { res, o } = cap(); handler(hreq('/check?code=' + code, 'GET'), res);   // public
  assert.equal(o.code, 200); assert.equal(J(o).ok, true);
  ({ res, o } = cap()); handler(hreq('/standing?account=hathor', 'GET'), res); // no auth -> 401
  assert.equal(o.code, 401);
  __setAuthVerifier(() => 'alice');                        // non-root cannot view another's standing
  ({ res, o } = cap()); handler(hreq('/standing?account=bob-jones', 'GET'), res);
  assert.equal(o.code, 403);
  __setAuthVerifier(null);
});

// ── SECURITY: the dev-trust x-melek-account fallback is honored ONLY for a genuinely-local request ──
test('handler: INVITES_DEV_TRUST header issues on loopback, but is IGNORED off-loopback (no impersonation)', () => {
  process.env.INVITES_DATA = freshFile();
  __setAuthVerifier(null);                                  // no injected verifier → the dev-trust path governs
  process.env.INVITES_DEV_TRUST = '1';
  const local = (p, m = 'POST') => ({ url: p, method: m, headers: { 'x-melek-account': 'hathor' }, socket: { remoteAddress: '127.0.0.1' } });
  const remote = (p, m = 'POST') => ({ url: p, method: m, headers: { 'x-melek-account': 'hathor' }, socket: { remoteAddress: '203.0.113.7' } });
  // local: root (hathor) can issue via the asserted header
  let { res, o } = cap(); handler(local('/issue'), res);
  assert.equal(o.code, 200); assert.equal(J(o).ok, true); assert.equal(J(o).inviter, 'hathor');
  // remote: the same header authenticates no one → deny-by-default 401 (cannot issue AS hathor from a public origin)
  ({ res, o } = cap()); handler(remote('/issue'), res);
  assert.equal(o.code, 401);
  delete process.env.INVITES_DEV_TRUST;
  __setAuthVerifier(null);
});

// ── probation + the public tree ─────────────────────────────────────────────────────────────────────
test('⚠️ probation is OFF by default — 70 days at zero users strangles the network it protects', () => {
  // The mechanism is Lobste.rs'; the default is not. A mature community can afford a 70-day wait; a
  // network of ten cannot, and the research is blunt that invite gates are rate limiters, not growth.
  assert.equal(INVITE_PROBATION_MS, 0, 'turning it up must be a deliberate operator act');
});

test('when probation IS set, a fresh account cannot immediately issue its quota', async () => {
  const before = process.env.INVITE_PROBATION_DAYS;
  process.env.INVITE_PROBATION_DAYS = '70';
  const fresh = await import(`./invites.mjs?probation=${Date.now()}`);
  const o = O(freshFile());
  const t0 = 1_000_000_000_000;

  const code = fresh.issueInvite(fresh.ROOT, { ...o, now: t0 }).code;
  assert.ok(fresh.redeemInvite(code, 'newbie', { ...o, now: t0 }).ok);

  // ⛔ this is the case that matters: one bad actor becoming eleven in a minute
  const tooSoon = fresh.issueInvite('newbie', { ...o, now: t0 + 1000 });
  assert.equal(tooSoon.ok, false);
  assert.match(tooSoon.reason, /probation/);
  assert.ok(tooSoon.daysLeft > 69);

  // …and it clears on time
  const later = fresh.issueInvite('newbie', { ...o, now: t0 + (71 * 86400000) });
  assert.equal(later.ok, true);

  // root is never on probation — it is the source of the tree
  assert.equal(fresh.issueInvite(fresh.ROOT, { ...o, now: t0 + 1 }).ok, true);
  if (before === undefined) delete process.env.INVITE_PROBATION_DAYS; else process.env.INVITE_PROBATION_DAYS = before;
});

test('⭐ the tree is PUBLIC — that visibility is the deterrent, not the penalty', () => {
  // Lobste.rs reports the chain-of-responsibility punishment is used "once or twice, basically never".
  // A private tree deters nobody, because nobody can see they are attached to anyone.
  const o = O(freshFile());
  const c1 = issueInvite(ROOT, o).code;
  redeemInvite(c1, 'alice', o);
  const c2 = issueInvite('alice', o).code;
  redeemInvite(c2, 'bob', o);

  const t = tree(o);
  assert.equal(t.count, 3, 'root, alice, bob');
  const bob = t.nodes.find((n) => n.account === 'bob');
  assert.equal(bob.invitedBy, 'alice', 'every profile shows who vouched for them');
  assert.equal(t.nodes.find((n) => n.account === 'alice').brought, 1);

  // ⛔ and it leaks NO live credential: an unredeemed code is a credential
  const unredeemed = issueInvite('alice', o).code;
  const blob = JSON.stringify(tree(o));
  assert.ok(!blob.includes(unredeemed), 'an unredeemed invite code must never appear in a public read');
  assert.ok(!blob.includes('remaining'), 'nor how many invites anybody has left');
});
