// integrations/token-launch.test.mjs — fully offline (no network, no deps).
// Reference calldata generated from the PRANA ABI via ethers (2026-06-16) and pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SELECTORS,
  PRANA_CHAIN_ID,
  encodeCall,
  validateTokenParams,
  buildCreateTokenTx,
  buildCloneTx,
  createTabFragment,
} from './token-launch.mjs';

const FACTORY = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
const CLONE_FACTORY = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const MINT_TO = '0x1291Be112d480055DaFd8a610b7d1e203891C274';

// Authoritative reference encodings (ethers Interface.encodeFunctionData against the PRANA ABI).
// createToken('Test Token','TST', cap=1000000, initialMint=500000, mintTo)
const REF_CREATE =
  '0x350d4d6500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000f4240000000000000000000000000000000000000000000000000000000000007a1200000000000000000000000001291be112d480055dafd8a610b7d1e203891c274000000000000000000000000000000000000000000000000000000000000000a5465737420546f6b656e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000035453540000000000000000000000000000000000000000000000000000000000';
// createTokenDeterministic(...,salt=0x..2a)
const REF_CREATE_DET =
  '0xefa4183800000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000f4240000000000000000000000000000000000000000000000000000000000007a1200000000000000000000000001291be112d480055dafd8a610b7d1e203891c274000000000000000000000000000000000000000000000000000000000000002a000000000000000000000000000000000000000000000000000000000000000a5465737420546f6b656e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000035453540000000000000000000000000000000000000000000000000000000000';
// initialize('Test Token','TST', cap=1000000, admin=mintTo)
const REF_INIT =
  '0xbd3a13f6000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000001291be112d480055dafd8a610b7d1e203891c274000000000000000000000000000000000000000000000000000000000000000a5465737420546f6b656e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000035453540000000000000000000000000000000000000000000000000000000000';

test('selectors are the known keccak256[:4] values', () => {
  assert.equal(SELECTORS.createToken, '0x350d4d65');
  assert.equal(SELECTORS.createTokenDeterministic, '0xefa41838');
  assert.equal(SELECTORS.initialize, '0xbd3a13f6');
});

test('encodeCall reproduces ethers createToken calldata exactly', () => {
  const data = encodeCall(SELECTORS.createToken, [
    { t: 'string', v: 'Test Token' },
    { t: 'string', v: 'TST' },
    { t: 'uint', v: 1000000n },
    { t: 'uint', v: 500000n },
    { t: 'address', v: MINT_TO },
  ]);
  assert.equal(data.toLowerCase(), REF_CREATE.toLowerCase());
});

test('encodeCall reproduces createTokenDeterministic calldata exactly', () => {
  const data = encodeCall(SELECTORS.createTokenDeterministic, [
    { t: 'string', v: 'Test Token' },
    { t: 'string', v: 'TST' },
    { t: 'uint', v: 1000000n },
    { t: 'uint', v: 500000n },
    { t: 'address', v: MINT_TO },
    { t: 'bytes32', v: '0x' + '00'.repeat(31) + '2a' },
  ]);
  assert.equal(data.toLowerCase(), REF_CREATE_DET.toLowerCase());
});

test('encodeCall reproduces initialize calldata exactly', () => {
  const data = encodeCall(SELECTORS.initialize, [
    { t: 'string', v: 'Test Token' },
    { t: 'string', v: 'TST' },
    { t: 'uint', v: 1000000n },
    { t: 'address', v: MINT_TO },
  ]);
  assert.equal(data.toLowerCase(), REF_INIT.toLowerCase());
});

test('buildCreateTokenTx returns a correct descriptor (base-unit scaling)', () => {
  const d = buildCreateTokenTx(
    { name: 'Melek Reward', symbol: 'MREW', supply: '1000000', owner: MINT_TO },
    { factoryAddr: FACTORY },
  );
  assert.equal(d.ok, true);
  assert.equal(d.to, FACTORY);
  assert.equal(d.value, '0x0');
  assert.equal(d.chainId, PRANA_CHAIN_ID);
  assert.equal(d.data.slice(0, 10), SELECTORS.createToken);
  // initialMint = 1_000_000 * 10^18, cap = 0 (uncapped)
  assert.equal(d.call.initialMint, 1000000n * 10n ** 18n);
  assert.equal(d.call.cap, 0n);
  assert.equal(d.call.mintTo, MINT_TO);
  // encoded mintTo word present (lowercased, left-padded)
  assert.ok(d.data.toLowerCase().includes('1291be112d480055dafd8a610b7d1e203891c274'));
});

test('buildCreateTokenTx encodes the symbol upper-cased in the calldata', () => {
  const d = buildCreateTokenTx(
    { name: 'X', symbol: 'abc', supply: '5', owner: MINT_TO },
    { factoryAddr: FACTORY },
  );
  assert.equal(d.ok, true);
  assert.equal(d.call.symbol, 'ABC');
  // 'ABC' = 0x414243 right-padded
  assert.ok(d.data.includes('4142430000'));
});

test('buildCreateTokenTx honors an explicit cap and rejects supply>cap', () => {
  const ok = buildCreateTokenTx(
    { name: 'Capped', symbol: 'CAP', supply: '100', cap: '1000', owner: MINT_TO },
    { factoryAddr: FACTORY },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.call.cap, 1000n * 10n ** 18n);

  const bad = buildCreateTokenTx(
    { name: 'Capped', symbol: 'CAP', supply: '2000', cap: '1000', owner: MINT_TO },
    { factoryAddr: FACTORY },
  );
  assert.equal(bad.ok, false);
});

test('buildCreateTokenTx soft-fails (no throw) on bad factory/owner', () => {
  const a = buildCreateTokenTx({ name: 'X', symbol: 'XX', supply: '1', owner: MINT_TO }, { factoryAddr: '0xnope' });
  assert.equal(a.ok, false);
  assert.ok(a.errors.some((e) => /factory/.test(e)));

  const b = buildCreateTokenTx({ name: 'X', symbol: 'XX', supply: '1', owner: 'notanaddr' }, { factoryAddr: FACTORY });
  assert.equal(b.ok, false);
  assert.ok(b.errors.some((e) => /owner/.test(e)));
});

test('buildCloneTx (non-deterministic) uses createToken on the clone factory', () => {
  const d = buildCloneTx(
    { initArgs: { name: 'Clone', symbol: 'CLN', supply: '42', owner: MINT_TO } },
    { cloneFactoryAddr: CLONE_FACTORY },
  );
  assert.equal(d.ok, true);
  assert.equal(d.to, CLONE_FACTORY);
  assert.equal(d.data.slice(0, 10), SELECTORS.createToken);
  assert.equal(d.call.fn, 'createToken');
});

test('buildCloneTx (deterministic) switches to createTokenDeterministic when salt is set', () => {
  const salt = '0x' + '00'.repeat(31) + '2a';
  const d = buildCloneTx(
    { initArgs: { name: 'Clone', symbol: 'CLN', supply: '42', owner: MINT_TO, salt } },
    { cloneFactoryAddr: CLONE_FACTORY },
  );
  assert.equal(d.ok, true);
  assert.equal(d.data.slice(0, 10), SELECTORS.createTokenDeterministic);
  assert.equal(d.call.fn, 'createTokenDeterministic');
  assert.equal(d.call.salt, salt);
});

test('buildCloneTx with an explicit implementation also returns initialize() calldata', () => {
  const impl = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
  const d = buildCloneTx(
    { implementation: impl, initArgs: { name: 'Clone', symbol: 'CLN', supply: '7', owner: MINT_TO } },
    { cloneFactoryAddr: CLONE_FACTORY },
  );
  assert.equal(d.ok, true);
  assert.equal(d.implementation, impl);
  assert.equal(d.initData.slice(0, 10), SELECTORS.initialize);
});

test('buildCloneTx soft-fails on a bad clone factory', () => {
  const d = buildCloneTx({ initArgs: { name: 'X', symbol: 'XX', supply: '1', owner: MINT_TO } }, { cloneFactoryAddr: 'bad' });
  assert.equal(d.ok, false);
  assert.ok(d.errors.some((e) => /clone-factory/.test(e)));
});

test('validateTokenParams accepts a good token', () => {
  const v = validateTokenParams({ name: 'Good', symbol: 'GOOD', supply: '1000', decimals: 18 });
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test('validateTokenParams rejects bad symbol / supply / decimals', () => {
  assert.equal(validateTokenParams({ name: 'X', symbol: 'a', supply: '1' }).ok, false); // symbol too short/lowercase form
  assert.equal(validateTokenParams({ name: 'X', symbol: 'TOOLONGSYMBOLNAME', supply: '1' }).ok, false);
  assert.equal(validateTokenParams({ name: 'X', symbol: 'OK', supply: '0' }).ok, false);
  assert.equal(validateTokenParams({ name: 'X', symbol: 'OK', supply: '-5' }).ok, false);
  assert.equal(validateTokenParams({ name: 'X', symbol: 'OK', supply: '1', decimals: 6 }).ok, false);
  assert.equal(validateTokenParams({ name: '', symbol: 'OK', supply: '1' }).ok, false);
});

test('validateTokenParams rejects cap < supply but allows blank cap', () => {
  assert.equal(validateTokenParams({ name: 'X', symbol: 'OK', supply: '100', cap: '50' }).ok, false);
  assert.equal(validateTokenParams({ name: 'X', symbol: 'OK', supply: '100', cap: '' }).ok, true);
  assert.equal(validateTokenParams({ name: 'X', symbol: 'OK', supply: '100', cap: '100' }).ok, true);
});

test('validateTokenParams rejects a malformed owner address', () => {
  assert.equal(validateTokenParams({ name: 'X', symbol: 'OK', supply: '1', owner: '0x123' }).ok, false);
  assert.equal(validateTokenParams({ name: 'X', symbol: 'OK', supply: '1', owner: MINT_TO }).ok, true);
});

test('createTabFragment is escaped HTML carrying the injected factory addresses', () => {
  const frag = createTabFragment({ wizardAddr: FACTORY, cloneFactoryAddr: CLONE_FACTORY, chainIdHex: '0x1a751' });
  assert.equal(typeof frag, 'string');
  assert.ok(frag.includes(FACTORY));
  assert.ok(frag.includes(CLONE_FACTORY));
  assert.ok(frag.includes('Create a Token'));
  assert.ok(frag.includes('eth_sendTransaction'));
  // selectors embedded for the client encoder
  assert.ok(frag.includes('0x350d4d65'));
});

test('createTabFragment escapes a hostile injected value', () => {
  const frag = createTabFragment({ wizardAddr: '"><script>alert(1)</script>' });
  assert.ok(!frag.includes('<script>alert(1)</script>'));
  assert.ok(frag.includes('&lt;script&gt;'));
});

test('createTabFragment renders the two chain "Bubbles" — PRANA (main) + MELEK Engine', () => {
  const frag = createTabFragment({
    wizardAddr: FACTORY, cloneFactoryAddr: CLONE_FACTORY, chainIdHex: '0x1a751',
    engineApi: 'https://engine.example', feeToken: 'APIS', tokenCreationFee: '100', scotFee: '100',
  });
  // both bubbles present
  assert.ok(/data-bubble=prana/.test(frag));
  assert.ok(/data-bubble=melek/.test(frag));
  assert.ok(frag.includes('PRANA'));
  assert.ok(frag.includes('MELEK Engine'));
  // PRANA is the default bubble
  assert.ok(frag.includes('pickBubble("prana")'));
  // the MELEK engine path posts to the engine's authoritative build endpoint
  assert.ok(frag.includes('https://engine.example'));
  assert.ok(frag.includes('/tools/api/build'));
  // the Scot Bot reward-rule option is offered in the same flow
  assert.ok(/scot\.enable/.test(frag));
  assert.ok(frag.includes('Scot Bot'));
  // the PRANA ERC-20 path is still intact
  assert.ok(frag.includes('eth_sendTransaction'));
  assert.ok(frag.includes('0x350d4d65'));
});

test('createTabFragment defaults the Bubble to MELEK when asked, still keeps PRANA present', () => {
  const frag = createTabFragment({ engineApi: 'https://e', defaultBubble: 'melek' });
  assert.ok(frag.includes('pickBubble("melek")'));
  assert.ok(/data-bubble=prana/.test(frag));
});
