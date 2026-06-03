import { test } from 'node:test';
import assert from 'node:assert';
import { contentHash, verifyAnchor, licenseRecord, toBytes } from './nft-host.mjs';

// All offline — no network, no creds.

test('contentHash is deterministic sha256 hex', () => {
  const a = contentHash(Buffer.from('hello world'));
  const b = contentHash(Buffer.from('hello world'));
  assert.equal(a, b); // determinism
  assert.match(a, /^[0-9a-f]{64}$/); // sha256 hex shape
  // known vector for sha256("hello world")
  assert.equal(a, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
});

test('contentHash accepts strings, Buffers, Uint8Array, and {bytes}/{file} wrappers equivalently', () => {
  const base = contentHash('abc');
  assert.equal(contentHash(Buffer.from('abc')), base);
  assert.equal(contentHash(new Uint8Array([97, 98, 99])), base);
  assert.equal(contentHash({ bytes: 'abc' }), base);
  assert.equal(contentHash({ file: Buffer.from('abc') }), base);
});

test('different bytes produce different hashes', () => {
  assert.notEqual(contentHash('alpha'), contentHash('beta'));
});

test('verifyAnchor matches when bytes are intact', () => {
  const bytes = Buffer.from('the original file');
  const anchored = contentHash(bytes);
  const r = verifyAnchor(bytes, anchored);
  assert.equal(r.ok, true);
  assert.equal(r.hash, anchored);
});

test('verifyAnchor detects tampering', () => {
  const original = Buffer.from('the original file');
  const anchored = contentHash(original);
  const tampered = Buffer.from('the original file.'); // one byte added
  const r = verifyAnchor(tampered, anchored);
  assert.equal(r.ok, false);
  assert.notEqual(r.hash, anchored);
});

test('verifyAnchor is case-insensitive / whitespace-tolerant on the anchored value', () => {
  const bytes = Buffer.from('xyz');
  const anchored = contentHash(bytes);
  assert.equal(verifyAnchor(bytes, anchored.toUpperCase()).ok, true);
  assert.equal(verifyAnchor(bytes, `  ${anchored}  `).ok, true);
});

test('licenseRecord has on-chain-ready ERC-1155 + SOAP + Lit shape', () => {
  const rec = licenseRecord({ cid: 'bafyCID', license: 'CC-BY', editions: 50, hash: 'deadbeef', name: 'art' });
  assert.equal(rec.standard, 'ERC-1155');
  assert.equal(rec.settlement, 'SOAP');
  assert.equal(rec.cid, 'bafyCID');
  assert.equal(rec.uri, 'ipfs://bafyCID');
  assert.equal(rec.contentHash, 'deadbeef');
  assert.equal(rec.license, 'CC-BY');
  assert.equal(rec.editions, 50);
  assert.equal(rec.name, 'art');
  assert.equal(rec.tokenGate.provider, 'Lit');
  assert.equal(rec.tokenGate.condition.cid, 'bafyCID');
  assert.equal(rec.tokenGate.condition.chain, 'SOAP');
  assert.equal(rec.version, 1);
});

test('licenseRecord defaults: ARR license, single edition, null hash/name', () => {
  const rec = licenseRecord({ cid: 'c1' });
  assert.equal(rec.license, 'ARR');
  assert.equal(rec.editions, 1);
  assert.equal(rec.contentHash, null);
  assert.equal(rec.name, null);
});

test('licenseRecord normalizes case and unknown license -> CUSTOM, floors/guards editions', () => {
  assert.equal(licenseRecord({ cid: 'c', license: 'cc0' }).license, 'CC0');
  assert.equal(licenseRecord({ cid: 'c', license: 'weird-thing' }).license, 'CUSTOM');
  assert.equal(licenseRecord({ cid: 'c', editions: 3.9 }).editions, 3);
  assert.equal(licenseRecord({ cid: 'c', editions: 0 }).editions, 1);
  assert.equal(licenseRecord({ cid: 'c', editions: -5 }).editions, 1);
});

test('licenseRecord requires a cid', () => {
  assert.throws(() => licenseRecord({}), /cid required/);
});

test('toBytes handles empty/null as empty buffer', () => {
  assert.equal(toBytes(null).length, 0);
  assert.equal(toBytes(undefined).length, 0);
});
