/**
 * genesis.test.mjs — bootstrapGenesis, the engine's native-token bootstrap.
 *
 * Offline, deterministic, no network / clock / fs / keys. Uses the real in-memory
 * State(null) (which touches the filesystem ONLY when constructed with a file
 * path — we never pass one) and the real config genesis tokenomics.
 *
 * Verifies: first run creates APIS + DRONE and mints their initial supply to the
 * genesis issuer; idempotency (second run is a no-op, returns false, no double
 * mint); the meta markers; that the precise tokenomics in config.mjs land on the
 * token rows; replay determinism (state hash stable across two independent
 * bootstraps); and the soft-fail / edge boundaries — a state already carrying the
 * fee token short-circuits, and the genesis fee waiver means the issuer never
 * needs a pre-existing APIS balance to bootstrap.
 *
 * Run: node --test engine/test/genesis.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { State } from '../lib/state.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { genesis as gcfg } from '../config.mjs';

function freshState() {
  // null file => pure in-memory, no fs access at all.
  return new State(null);
}

test('first bootstrap returns true and creates every configured token', () => {
  const s = freshState();
  const did = bootstrapGenesis(s);
  assert.equal(did, true);

  for (const t of gcfg.tokens) {
    const row = s.findOne('tokens', { symbol: t.symbol });
    assert.ok(row, `token ${t.symbol} should exist`);
    assert.equal(row.symbol, t.symbol);
    assert.equal(row.name, t.name);
    assert.equal(row.precision, t.precision);
    assert.equal(row.issuer, gcfg.issuer);
    assert.equal(row.supplyCapImmutable, t.supplyCapImmutable);
    assert.equal(row.createdBlock, 0, 'genesis tokens are created at block 0');
  }
});

test('initial supply is minted to the genesis issuer', () => {
  const s = freshState();
  bootstrapGenesis(s);

  for (const t of gcfg.tokens) {
    if (!t.initialIssue) continue;
    const balRow = s.findOne('balances', { account: gcfg.issuer, symbol: t.symbol });
    assert.ok(balRow, `issuer should hold a ${t.symbol} balance`);
    // balance is stored as a base-unit string; equals initialIssue * 10^precision.
    const expected = (BigInt(t.initialIssue) * 10n ** BigInt(t.precision)).toString();
    assert.equal(balRow.balance, expected);

    const tok = s.findOne('tokens', { symbol: t.symbol });
    assert.equal(tok.supply, expected, 'token supply matches the minted amount');
    assert.equal(tok.circulatingSupply, expected);
  }
});

test('the issuance log records each genesis mint', () => {
  const s = freshState();
  bootstrapGenesis(s);
  const minted = gcfg.tokens.filter((t) => t.initialIssue);
  const log = s.find('issuanceLog', {});
  assert.equal(log.length, minted.length);
  for (const t of minted) {
    const entry = s.findOne('issuanceLog', { symbol: t.symbol });
    assert.ok(entry, `issuance log should have a ${t.symbol} entry`);
    assert.equal(entry.to, gcfg.issuer);
    assert.equal(entry.issuer, gcfg.issuer);
    assert.equal(entry.block, 0);
  }
});

test('meta markers are set after bootstrap', () => {
  const s = freshState();
  bootstrapGenesis(s);
  assert.equal(s.meta.genesisDone, true);
  assert.equal(s.meta.genesisIssuer, gcfg.issuer);
});

test('the fee token (APIS) is created so creation fees can later be burned', () => {
  const s = freshState();
  bootstrapGenesis(s);
  const fee = s.findOne('tokens', { symbol: gcfg.feeToken });
  assert.ok(fee, 'fee token row must exist');
  assert.equal(fee.symbol, gcfg.feeToken);
});

test('idempotent: a second bootstrap is a no-op and returns false', () => {
  const s = freshState();
  assert.equal(bootstrapGenesis(s), true);

  const tokensBefore = s.find('tokens', {}).length;
  const balsBefore = s.find('balances', {}).map((b) => `${b.account}:${b.symbol}=${b.balance}`).sort();
  const logBefore = s.find('issuanceLog', {}).length;

  const did2 = bootstrapGenesis(s);
  assert.equal(did2, false, 'second run detects existing fee token and short-circuits');

  const tokensAfter = s.find('tokens', {}).length;
  const balsAfter = s.find('balances', {}).map((b) => `${b.account}:${b.symbol}=${b.balance}`).sort();
  const logAfter = s.find('issuanceLog', {}).length;

  assert.equal(tokensAfter, tokensBefore, 'no extra token rows');
  assert.deepEqual(balsAfter, balsBefore, 'no double-mint of supply');
  assert.equal(logAfter, logBefore, 'no extra issuance-log entries');
});

test('short-circuit edge: a state already holding the fee token is left untouched', () => {
  const s = freshState();
  // Pre-seed a fee-token row the way a loaded snapshot would carry it.
  s.insert('tokens', {
    symbol: gcfg.feeToken,
    name: gcfg.feeToken,
    issuer: 'someone-else',
    precision: 3,
    maxSupply: '1',
    supply: '0',
    circulatingSupply: '0',
    supplyCapImmutable: false,
    url: '',
    createdBlock: 99,
  });
  const did = bootstrapGenesis(s);
  assert.equal(did, false, 'returns false without re-bootstrapping');
  // The pre-existing row is preserved untouched; no genesis meta is written.
  const fee = s.findOne('tokens', { symbol: gcfg.feeToken });
  assert.equal(fee.issuer, 'someone-else');
  assert.equal(fee.createdBlock, 99);
  assert.equal(s.meta.genesisDone, undefined);
  // The other (non-fee) genesis tokens were NOT created either.
  for (const t of gcfg.tokens) {
    if (t.symbol === gcfg.feeToken) continue;
    assert.equal(s.findOne('tokens', { symbol: t.symbol }), null, `${t.symbol} not created`);
  }
});

test('genesis fee waiver: issuer needs no pre-existing APIS to bootstrap', () => {
  // A normal token create() burns the APIS creation fee. Genesis must waive it
  // (ctx.genesis === true) because there is no APIS yet. Proof: bootstrap from a
  // completely empty state succeeds and does not throw.
  const s = freshState();
  assert.equal(s.find('balances', {}).length, 0, 'no balances exist before genesis');
  assert.doesNotThrow(() => bootstrapGenesis(s));
  // and no burn was recorded (the fee was waived, not charged).
  assert.equal(s.find('burnLog', {}).length, 0, 'no creation fee was burned at genesis');
});

test('replay determinism: two independent bootstraps yield an identical state hash', () => {
  const a = freshState();
  const b = freshState();
  bootstrapGenesis(a);
  bootstrapGenesis(b);
  assert.equal(a.hash(), b.hash(), 'genesis is a pure deterministic fold');
});

test('never throws on a minimal but valid state object', () => {
  // bootstrapGenesis only needs findOne/find/insert + a meta object. Confirm it
  // tolerates the bare in-memory store (it does — exercised above) and that the
  // typed return value is a boolean in every path.
  const s = freshState();
  const r1 = bootstrapGenesis(s);
  const r2 = bootstrapGenesis(s);
  assert.equal(typeof r1, 'boolean');
  assert.equal(typeof r2, 'boolean');
  assert.equal(r1, true);
  assert.equal(r2, false);
});
