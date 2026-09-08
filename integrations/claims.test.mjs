// claims.test.mjs — OFFLINE. No network.
import { test } from 'node:test';
import assert from 'node:assert';
import { NATIVE, NATIVE_FEATURES, verify, phrase, inventory, handler } from './claims.mjs';

test('the inventory is three layers of things we actually run', () => {
  const inv = inventory();
  assert.deepEqual(inv.layers.map((l) => l.layer), ['IAAS', 'PAAS', 'SAAS']);
  assert.ok(inv.total >= 12);
  assert.match(inv.claim, /more third-party surface/);
  assert.match(inv.claim, /own infrastructure/);
});

// ── the size axis is the one we do not fight on ───────────────────────────────────────────────────
test('REFUSES a size comparison and hands back the first-party version instead', () => {
  const r = verify('We have more dApps than Ethereum');
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].code, 'size_comparison');
  assert.match(r.problems[0].instead, /third-party surface/);
});

test('conceding third-party scale is ALLOWED — that concession is the argument', () => {
  assert.equal(verify('Other chains have more third-party projects than we do.').ok, true);
});

test('REFUSES counting somebody else\'s ecosystem', () => {
  const r = verify('Ethereum has 4000 dapps and we are catching up');
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.code === 'counting_others'));
});

// ── the native claim has to be scoped ─────────────────────────────────────────────────────────────
test('REFUSES "no blockchain has private messaging" — it is false and losable in one reply', () => {
  const r = verify('No blockchain has private messaging');
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].code, 'overreach_native');
  assert.match(r.problems[0].instead, /Graphene/);
});

test('the SCOPED version passes', () => {
  assert.equal(verify('Graphene social chains have no native private messaging.').ok, true);
});

test('REFUSES "the only" anywhere', () => {
  assert.equal(verify('We are the only chain doing this').ok, false);
});

// ── phrasing ──────────────────────────────────────────────────────────────────────────────────────
test('phrase() returns a sentence that passes its own verifier', () => {
  for (const id of Object.keys(NATIVE_FEATURES)) {
    const p = phrase(id);
    assert.equal(p.ok, true, id);
    assert.equal(verify(p.say).ok, true, `${id} must survive its own check`);
    assert.ok(p.doNotSay, `${id} must state what it is NOT claiming`);
  }
});

test('the PM claim names the scope and names what would be false', () => {
  const p = phrase('private_messages');
  assert.match(p.say, /Graphene/);
  assert.match(p.say, /Scope: graphene chains/);
  assert.match(p.doNotSay, /Nostr/);
  assert.match(p.doNotSay, /snapie/, 'the competitor is named in our own record, not hidden');
  assert.match(p.note, /no way to say something to one person/);
});

test('the full-stack claim explicitly disclaims being bigger', () => {
  assert.match(phrase("full_stack").doNotSay, /our ecosystem is larger/);
  assert.match(phrase("full_stack").doNotSay, /never the claim/);
});

test('an unknown feature is refused, not improvised', () => {
  assert.equal(phrase('we-cure-cancer').ok, false);
});

test('handler leads with the axis and publishes the refusals', () => {
  let body = '';
  handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.axis, 'first-party, not size');
  assert.ok(j.refuses.size_comparison);
  assert.ok(j.features.every((f) => f.doNotSay), 'every published claim carries its own limit');
  assert.equal(j.layers.length, 3);
});

test('NATIVE lists only things we operate — no bare dependencies', () => {
  const all = Object.values(NATIVE).flatMap((l) => l.items).join(' ').toLowerCase();
  for (const borrowed of ['ethereum mainnet', 'aws', 'cloudflare', 'openai']) {
    assert.ok(!all.includes(borrowed), `"${borrowed}" is something we use, not something we run`);
  }
});
