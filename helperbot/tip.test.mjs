// tip.test.mjs — PIZZA-pattern tipping: verified-link gate, holdings-tier daily quota, global cap, jar
// balance, receipts, simulated-by-default, signer path, MELEK preset via tipbot.mjs. Offline.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch } from './live.mjs';
import { tip, myTips, tipJar, tipConfig, tierFor, parseTiers, buildOps, TOKEN_PRESETS } from './tip.mjs';
import { startLink, verifyLinks, parseIdentity, getLink } from './links.mjs';
import { memoryStore } from './store.mjs';
import { handle } from './brain.mjs';
import { baseState, fakeFetch, wei } from './test-fakes.mjs';

const ALICE = '0x00000000000000000000000000000000000a11ce';
const BOB = '0x0000000000000000000000000000000000000b0b';
const JAR = '0x000000000000000000000000000000000000aa00';
const NOW = Date.parse('2026-10-17T12:00:00Z');
let st;
let store;

const cfg = (over = {}) => ({ ...tipConfig({}), amount: 0.1, tiers: parseTiers('1:1,10:3,100:10'), globalDailyCap: 1, maxPerCommand: 5, ...over });

async function linkVerified(platform, userId, addr) {
  const r = await startLink({ store, platform, userId, identity: parseIdentity(addr), now: NOW, rand: () => 482913 });
  assert.ok(r.ok);
  st.scan.txs[addr] = [{ hash: '0xproof', from: { hash: addr }, to: { hash: addr }, value: String(482913n * 10n ** 9n), status: 'ok', timestamp: new Date(NOW + 1000).toISOString() }];
  const v = await verifyLinks({ store, platform, userId, now: NOW });
  assert.match(v.reply, /verified/);
}

beforeEach(() => {
  st = baseState();
  st.prana.mainnet.native[ALICE] = wei(50); // tier 10+ → 3/day
  st.prana.mainnet.native[JAR] = wei(100);
  __setFetch(fakeFetch(st));
  store = memoryStore();
});

test('default tip token is native PRANA on mainnet 712217, simulated unless explicitly live', () => {
  const c = tipConfig({});
  assert.equal(c.symbol, 'PRANA');
  assert.equal(c.kind, 'evm-native');
  assert.equal(c.chainId, 712217);
  assert.equal(c.live, false);
  assert.equal(c.treasury, '');
  assert.equal(tipConfig({ HELPERBOT_TIP_TOKEN: 'MELEK' }).kind, 'graphene');
  assert.equal(tipConfig({ HELPERBOT_TIP_LIVE: '1' }).live, true);
});

test('tiers: holdings select the daily quota', () => {
  const t = parseTiers('10:3,1:1,100:10');
  assert.deepEqual(tierFor(0.5, t), { minHold: 0, perDay: 0 });
  assert.equal(tierFor(1, t).perDay, 1);
  assert.equal(tierFor(50, t).perDay, 3);
  assert.equal(tierFor(1e6, t).perDay, 10);
  assert.equal(tierFor(null, t).perDay, 0);
});

test('link proof: unverified until the exact self-transfer appears on the explorer', async () => {
  const r = startLink({ store, platform: 'discord', userId: 'a', identity: parseIdentity(ALICE), now: NOW, rand: () => 482913 });
  assert.match(r.reply, /0\.000482913 PRANA/);
  assert.match(r.reply, /to itself/);
  let v = await verifyLinks({ store, platform: 'discord', userId: 'a', now: NOW });
  assert.match(v.reply, /no matching self-transfer/);
  st.scan.txs[ALICE] = [{ hash: '0xwrongvalue', from: { hash: ALICE }, to: { hash: ALICE }, value: '1', status: 'ok' }];
  v = await verifyLinks({ store, platform: 'discord', userId: 'a', now: NOW });
  assert.equal(getLink(store, 'discord', 'a').prana.verified, false);
  st.scan.txs[ALICE].push({ hash: '0xgood', from: { hash: ALICE }, to: { hash: ALICE }, value: String(482913n * 10n ** 9n), status: 'ok', timestamp: new Date(NOW).toISOString() });
  v = await verifyLinks({ store, platform: 'discord', userId: 'a', now: NOW });
  assert.match(v.reply, /verified \(tx 0xgood\)/);
  // nobody else can claim the same verified address
  const other = startLink({ store, platform: 'discord', userId: 'mallory', identity: parseIdentity(ALICE), now: NOW });
  assert.equal(other.ok, false);
});

test('MELEK link proof reads the account history for the memo', async () => {
  startLink({ store, platform: 'telegram', userId: 't1', identity: parseIdentity('@carol'), now: NOW, rand: () => 111222 });
  st.melek.mainnet.history.carol = [[1, { trx_id: 'abc', op: ['transfer', { from: 'carol', to: 'hathor', amount: '0.001 MELEK', memo: 'hathor-link-111222' }] }]];
  const v = await verifyLinks({ store, platform: 'telegram', userId: 't1', now: NOW });
  assert.match(v.reply, /@carol verified/);
});

test('PIZZA flow: verified tipper, linked recipient → simulated tip + receipt; quota and caps bind', async () => {
  await linkVerified('discord', 'a', ALICE);
  startLink({ store, platform: 'discord', userId: 'b', identity: parseIdentity(BOB), now: NOW }); // unverified can receive
  const c = cfg({ treasury: JAR, globalDailyCap: 10 });
  const r1 = await tip({ platform: 'discord', userId: 'a', userName: 'alice', target: { userId: 'b' }, count: 2 }, { store, cfg: c, now: NOW });
  assert.equal(r1.ok, true, r1.reply);
  assert.equal(r1.receipt.status, 'simulated');
  assert.equal(r1.receipt.amount, 0.2);
  assert.match(r1.reply, /SIMULATED — live tipping is off/);
  assert.match(r1.reply, /2\/3 today/);
  assert.equal(r1.receipt.ops[0].type, 'evm_native_transfer');
  assert.equal(r1.receipt.ops[0].chainId, 712217);
  assert.equal(r1.receipt.ops[0].to, BOB);
  assert.equal(BigInt(r1.receipt.ops[0].value), 2n * 10n ** 17n);
  // quota: 3/day at 50 PRANA held
  const r2 = await tip({ platform: 'discord', userId: 'a', target: { raw: BOB }, count: 2 }, { store, cfg: c, now: NOW });
  assert.match(r2.reply, /Daily quota: 2\/3/);
  const r3 = await tip({ platform: 'discord', userId: 'a', target: { raw: BOB }, count: 1 }, { store, cfg: c, now: NOW });
  assert.equal(r3.ok, true);
  // next UTC day resets
  const r4 = await tip({ platform: 'discord', userId: 'a', target: { raw: BOB } }, { store, cfg: c, now: NOW + 24 * 3600_000 });
  assert.equal(r4.ok, true);
  const mine = await myTips({ platform: 'discord', userId: 'a' }, { store, cfg: c, now: NOW });
  assert.match(mine, /verified/);
  assert.match(mine, /used 3\/3 today/);
  assert.match(mine, new RegExp(r1.receipt.id));
});

test('refusals: unlinked, unverified, self-tip, unlinked recipient, zero-tier, global cap, empty jar', async () => {
  const c = cfg({ treasury: JAR });
  assert.match((await tip({ platform: 'discord', userId: 'a', target: { raw: BOB } }, { store, cfg: c, now: NOW })).reply, /Link your PRANA/);
  startLink({ store, platform: 'discord', userId: 'a', identity: parseIdentity(ALICE), now: NOW });
  assert.match((await tip({ platform: 'discord', userId: 'a', target: { raw: BOB } }, { store, cfg: c, now: NOW })).reply, /not verified/);
  await linkVerified('discord', 'a', ALICE);
  assert.match((await tip({ platform: 'discord', userId: 'a', target: { userId: 'a' } }, { store, cfg: c, now: NOW })).reply, /yourself/);
  assert.match((await tip({ platform: 'discord', userId: 'a', target: { raw: ALICE } }, { store, cfg: c, now: NOW })).reply, /yourself/);
  assert.match((await tip({ platform: 'discord', userId: 'a', target: { userId: 'nobody' } }, { store, cfg: c, now: NOW })).reply, /hasn't linked/);
  assert.match((await tip({ platform: 'discord', userId: 'a', target: { raw: '@bob' } }, { store, cfg: c, now: NOW })).reply, /Tips are in PRANA/);
  assert.match((await tip({ platform: 'discord', userId: 'a', target: { raw: BOB }, count: 9 }, { store, cfg: c, now: NOW })).reply, /Max 5/);
  assert.match((await tip({ platform: 'discord', userId: 'a', target: { raw: BOB }, count: 'x' }, { store, cfg: c, now: NOW })).reply, /Usage/);
  // global cap = 1 PRANA → 0.1 × 3 fits; then cap test with a tiny cap
  assert.match((await tip({ platform: 'discord', userId: 'a', target: { raw: BOB } }, { store, cfg: cfg({ treasury: JAR, globalDailyCap: 0.05 }), now: NOW })).reply, /global cap/);
  st.prana.mainnet.native[JAR] = 0n;
  assert.match((await tip({ platform: 'discord', userId: 'a', target: { raw: BOB } }, { store, cfg: c, now: NOW })).reply, /tip jar is empty/);
  st.prana.mainnet.native[ALICE] = wei(0.5);
  assert.match((await tip({ platform: 'discord', userId: 'a', target: { raw: BOB } }, { store, cfg: cfg(), now: NOW })).reply, /unlocks at 1 PRANA/);
  st.down.add('rpc.prana.melek.salon');
  assert.match((await tip({ platform: 'discord', userId: 'a', target: { raw: BOB } }, { store, cfg: cfg(), now: NOW })).reply, /couldn't read your wallet/);
});

test('live path only with treasury + HELPERBOT_TIP_LIVE + an injected signer; a failed signer records nothing', async () => {
  await linkVerified('discord', 'a', ALICE);
  const c = cfg({ treasury: JAR, live: true, globalDailyCap: 10 });
  const noSigner = await tip({ platform: 'discord', userId: 'a', target: { raw: BOB } }, { store, cfg: c, now: NOW });
  assert.match(noSigner.reply, /no signer attached/);
  const seen = [];
  const ok = await tip({ platform: 'discord', userId: 'a', target: { raw: BOB } }, { store, cfg: c, now: NOW, signer: async (ops) => { seen.push(ops); return { txid: '0xabc' }; } });
  assert.equal(ok.receipt.status, 'broadcast');
  assert.match(ok.reply, /pranascan\.soapbox\.community\/tx\/0xabc/);
  assert.equal(seen[0][0].from, JAR);
  const bad = await tip({ platform: 'discord', userId: 'a', target: { raw: BOB } }, { store, cfg: c, now: NOW, signer: async () => { throw new Error('down'); } });
  assert.equal(bad.ok, false);
  assert.match(await myTips({ platform: 'discord', userId: 'a' }, { store, cfg: c, now: NOW }), /used 2\/3/);
});

test('MELEK preset builds Graphene transfer ops through tipbot.mjs (never a key)', async () => {
  const c = { ...tipConfig({ HELPERBOT_TIP_TOKEN: 'MELEK' }), treasury: 'hathor' };
  const ops = await buildOps({ id: 'r1', to: 'bob', amount: 0.5 }, c);
  assert.equal(ops[0].type, 'transfer');
  assert.equal(ops[0].to, 'bob');
  assert.equal(ops[0].symbol, 'MELEK');
  assert.equal(ops[0].from, 'hathor');
  const e = await buildOps({ id: 'r2', to: 'bob', amount: 1 }, { ...TOKEN_PRESETS.WMELEK, treasury: 'hathor' });
  assert.equal(e[0].type, 'custom_json');
  assert.equal(e[0].json.contractAction, 'transfer');
});

test('MELEK token mode: quota from liquid + POWER, recipient must exist on chain', async () => {
  const c = { ...tipConfig({ HELPERBOT_TIP_TOKEN: 'MELEK' }), tiers: parseTiers('1:2') };
  st.melek.mainnet.accounts.carol = { name: 'carol', balance: '0.500 MELEK', vesting_shares: '0.002800 VESTS', delegated_vesting_shares: '0.000000 VESTS' };
  startLink({ store, platform: 'discord', userId: 'c', identity: parseIdentity('@carol'), now: NOW, rand: () => 1 });
  st.melek.mainnet.history.carol = [[1, { trx_id: 't', op: ['transfer', { from: 'carol', to: 'hathor', memo: 'hathor-link-1' }] }]];
  await verifyLinks({ store, platform: 'discord', userId: 'c', now: NOW });
  assert.match((await tip({ platform: 'discord', userId: 'c', target: { raw: '@ghost' } }, { store, cfg: c, now: NOW })).reply, /doesn't exist/);
  st.melek.mainnet.accounts.dave = { name: 'dave', balance: '0.000 MELEK', vesting_shares: '0 VESTS' };
  const r = await tip({ platform: 'discord', userId: 'c', target: { raw: '@dave' } }, { store, cfg: c, now: NOW });
  assert.equal(r.ok, true, r.reply); // 0.5 liquid + 0.0028 VESTS × (250000/700) ≈ 1.5 → tier 1
  assert.match(r.reply, /@dave/);
});

test('!tipjar reports configuration honestly', async () => {
  assert.match(await tipJar({ store, cfg: cfg() }), /not configured yet/);
  assert.match(await tipJar({ store, cfg: cfg({ treasury: JAR }) }), /100 PRANA/);
});

test('brain routes !tip with a Discord mention to the linked recipient', async () => {
  await linkVerified('discord', '111', ALICE);
  startLink({ store, platform: 'discord', userId: '222', identity: parseIdentity(BOB), now: NOW });
  const out = await handle({ platform: 'discord', userId: '111', userName: 'alice', text: '!tip <@222> 1' }, { store, now: NOW, tipCfg: cfg({ globalDailyCap: 10 }) });
  assert.equal(out.handled, true);
  assert.match(out.reply, /tipped 0x0000000000000000000000000000000000000b0b 0\.1 PRANA/);
  assert.match(out.reply, /tip jar not configured/);
});
