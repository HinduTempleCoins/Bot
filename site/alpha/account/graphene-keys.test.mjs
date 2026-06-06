// graphene-keys.test.mjs — byte-compatibility against dhive (the library the condenser's own
// login uses) + RIPEMD-160 reference vectors + the key-checker classification logic.
import { test } from 'node:test';
import assert from 'node:assert';
import { PrivateKey } from '@hiveio/dhive';
import {
  ripemd160, b58encode, b58decode, privFromLogin, wifFromPriv, privFromWif,
  compressedPub, pubToString, keysFromLogin, classifySecret, looksLikeWif, generateMasterPassword,
} from './graphene-keys.mjs';

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

test('ripemd160 matches RFC reference vectors', () => {
  const v = (s) => hex(ripemd160(new TextEncoder().encode(s)));
  assert.equal(v(''), '9c1185a5c5e9fc54612808977ee8f548b2258d31');
  assert.equal(v('abc'), '8eb208f7e05d987a9b044a8e98c6b087f15a0bfc');
  assert.equal(v('message digest'), '5d0689ef49d2fae572b881b123a85ffa21595f36');
  assert.equal(v('abcdefghijklmnopqrstuvwxyz'), 'f71c27109c692c1b56bbdceb5b9d2865b3708dbc');
});

test('base58 round-trips and matches known encodings', () => {
  const b = new Uint8Array([0, 0, 1, 2, 3, 255]);
  assert.deepEqual(b58decode(b58encode(b)), b);
  assert.equal(b58encode(new Uint8Array([0])), '1');
});

test('login-derived WIF + public key match dhive exactly (the login box derivation)', async () => {
  const name = 'offgrid', password = 'Ptestmasterpassword123';
  for (const role of ['owner', 'active', 'posting', 'memo']) {
    const dk = PrivateKey.fromLogin(name, password, role);
    const priv = await privFromLogin(name, role, password);
    assert.equal(await wifFromPriv(priv), dk.toString(), `${role} WIF`);
    assert.equal(pubToString(compressedPub(priv), 'TST'), dk.createPublic('TST').toString(), `${role} pub`);
  }
});

test('privFromWif round-trips and rejects garbage', async () => {
  const dk = PrivateKey.fromLogin('someone', 'Pxyz', 'posting');
  const wif = dk.toString();
  const priv = await privFromWif(wif);
  assert.equal(await wifFromPriv(priv), wif);
  // bad-checksum fixture assembled at runtime (no key-shaped literal in the file)
  const badWif = '5J' + 'fake'.repeat(12) + 'x';
  await assert.rejects(() => privFromWif(badWif));
  await assert.rejects(() => privFromWif('not-a-key'));
});

test('generateMasterPassword has the standard P5… shape and derives valid keys', async () => {
  const pw = await generateMasterPassword();
  assert.match(pw, /^P5[1-9A-HJ-NP-Za-km-z]{50}$/);
  const keys = await keysFromLogin('newuser', pw);
  assert.match(keys.posting.pub, /^TST/);
  assert.ok(looksLikeWif(keys.posting.wif));
});

// ── the key-checker brain: the offgrid scenarios ─────────────────────────────

async function chainPubsFor(name, password) {
  const keys = await keysFromLogin(name, password);
  return {
    owner: [keys.owner.pub], active: [keys.active.pub],
    posting: [keys.posting.pub], memo: [keys.memo.pub],
  };
}

test('classify: posting WIF → "log in with exactly this"', async () => {
  const pubs = await chainPubsFor('offgrid', 'Pmaster123');
  const postingWif = (await keysFromLogin('offgrid', 'Pmaster123')).posting.wif;
  const r = await classifySecret('offgrid', postingWif, pubs);
  assert.equal(r.kind, 'wif'); assert.equal(r.role, 'posting');
});

test('classify: owner/active WIF → told it is the wrong key for login', async () => {
  const pubs = await chainPubsFor('offgrid', 'Pmaster123');
  const ownerWif = (await keysFromLogin('offgrid', 'Pmaster123')).owner.wif;
  const r = await classifySecret('offgrid', ownerWif, pubs);
  assert.equal(r.kind, 'wif'); assert.equal(r.role, 'owner');
  assert.match(r.hint, /POSTING key|master password/);
});

test('classify: master password typed whole → master', async () => {
  const pubs = await chainPubsFor('offgrid', 'Pmaster123');
  const r = await classifySecret('offgrid', 'Pmaster123', pubs);
  assert.equal(r.kind, 'master');
});

test('classify: the lost-P case is caught (5… that is really P5…)', async () => {
  // master password literally starts with P5 (the generated shape); user saved it without the P
  const pw = await generateMasterPassword();          // P5…
  const pubs = await chainPubsFor('offgrid', pw);
  const r = await classifySecret('offgrid', pw.slice(1), pubs);  // they kept "5…"
  assert.equal(r.kind, 'master-missing-p');
  assert.match(r.hint, /capital P/);
});

test('classify: a stranger string → no-match with recovery guidance', async () => {
  const pubs = await chainPubsFor('offgrid', 'Pmaster123');
  const r = await classifySecret('offgrid', 'Psomethingelse', pubs);
  assert.equal(r.kind, 'no-match');
});
