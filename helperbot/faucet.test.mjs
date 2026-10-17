// faucet.test.mjs — !faucet routes only to faucets that pass a LIVE check, shows Under Construction for
// the rest, gates abuse, dry-runs unless switched on, and never accepts a key. Offline.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch } from './live.mjs';
import { faucetCommand, probeFaucets, gate, faucetConfig } from './faucet.mjs';
import { memoryStore } from './store.mjs';
import { baseState, fakeFetch } from './test-fakes.mjs';

const ADDR = '0x026d69cB54B82a805b6aaE60718C4877124D8d11';
const NOW = Date.parse('2026-10-17T12:00:00Z');
const OLD = NOW - 30 * 86400_000;
let st;
let store;
beforeEach(() => { st = baseState(); __setFetch(fakeFetch(st)); store = memoryStore(); });

const who = (over = {}) => ({ platform: 'discord', userId: 'u1', accountCreatedAt: OLD, ...over });
const cfg = (over = {}) => ({ ...faucetConfig({}), ...over });

test('probe: PRANA testnet works when the page serves drips AND the alpha chain answers 108369', async () => {
  let s = await probeFaucets(cfg());
  assert.equal(s['prana-testnet'].works, true);
  assert.equal(s['melek-testnet'].works, true);
  assert.equal(s['melek-mainnet'].works, true);
  assert.equal(s['prana-mainnet'].works, false);
  st.down.add('rpc.prana.alpha.melek.salon');
  s = await probeFaucets(cfg());
  assert.equal(s['prana-testnet'].works, false);
  assert.match(s['prana-testnet'].detail, /alpha chain/);
});

test('!faucet lists faucets with live marks and never asks for a key', async () => {
  const t = await faucetCommand([], who(), { store, cfg: cfg(), now: NOW });
  assert.match(t, /✅ PRANA testnet/);
  assert.match(t, /🚧 PRANA mainnet/);
  assert.match(t, /PUBLIC address/);
});

test('PRANA mainnet and broken faucets get the Under Construction notice', async () => {
  assert.match(await faucetCommand(['prana', 'mainnet'], who(), { store, cfg: cfg(), now: NOW }), /🚧 A mainnet PRANA faucet is under construction/);
  st.faucet.page = 'Faucet is not configured yet.';
  assert.match(await faucetCommand(['prana', ADDR], who(), { store, cfg: cfg(), now: NOW }), /🚧 The PRANA testnet faucet is under construction/);
  st.faucet.mainnetHealth = { ok: false };
  assert.match(await faucetCommand(['melek'], who(), { store, cfg: cfg(), now: NOW }), /🚧 The MELEK mainnet account faucet/);
});

test('MELEK faucet = free account creation in the browser, with a guide offer', async () => {
  const t = await faucetCommand(['melek', 'testnet'], who(), { store, cfg: cfg(), now: NOW });
  assert.match(t, /alpha\.melek\.salon\/account\/signup\.html/);
  assert.match(t, /YOUR browser/);
  assert.match(t, /!guide signup/);
  assert.match(await faucetCommand(['melek'], who(), { store, cfg: cfg(), now: NOW }), /wallet\.melek\.salon\/signup/);
});

test('dry run by default — no drip request is sent', async () => {
  const t = await faucetCommand(['prana', ADDR], who(), { store, cfg: cfg(), now: NOW });
  assert.match(t, /DRY RUN/);
  assert.ok(!st.calls.some((c) => c.startsWith('POST faucet.alpha.soapbox.community/api/drip')));
});

test('live drip (HELPERBOT_FAUCET_LIVE=1) then per-user / per-address cooldown and global cap', async () => {
  const live = cfg({ live: true, globalDailyDrips: 2 });
  const t = await faucetCommand(['prana', ADDR], who(), { store, cfg: live, now: NOW });
  assert.match(t, /✅ Sent 5 test PRANA/);
  assert.match(t, /pranascan\.alpha\.soapbox\.community\/tx\/0xfeed/);
  assert.match(await faucetCommand(['prana', ADDR], who(), { store, cfg: live, now: NOW + 1000 }), /already used the faucet/);
  assert.match(await faucetCommand(['prana', ADDR], who({ userId: 'u2' }), { store, cfg: live, now: NOW + 1000 }), /funded recently/);
  await faucetCommand(['prana', '0x' + '1'.repeat(40)], who({ userId: 'u3' }), { store, cfg: live, now: NOW });
  assert.match(await faucetCommand(['prana', '0x' + '2'.repeat(40)], who({ userId: 'u4' }), { store, cfg: live, now: NOW }), /budget is used up/);
  st.faucet.drip = { ok: false, error: 'Already funded recently. Try again later.' };
  assert.match(await faucetCommand(['prana', '0x' + '3'.repeat(40)], who({ userId: 'u5' }), { store, cfg: cfg({ live: true }), now: NOW }), /declined: Already funded/);
});

test('gate: account-age and karma requirements', () => {
  const c = cfg({ minKarma: 5 });
  assert.match(gate({ store, platform: 'd', userId: 'x', address: ADDR, accountCreatedAt: NOW - 86400_000, now: NOW }, c).why, /7 days old/);
  assert.match(gate({ store, platform: 'd', userId: 'x', address: ADDR, accountCreatedAt: null, now: NOW }, c).why, /can't confirm/);
  assert.match(gate({ store, platform: 'd', userId: 'x', address: ADDR, accountCreatedAt: OLD, karma: 1, now: NOW }, c).why, /karma/);
  assert.equal(gate({ store, platform: 'd', userId: 'x', address: ADDR, accountCreatedAt: OLD, karma: 9, now: NOW }, c).ok, true);
});

test('bad input and pasted keys are refused before any request', async () => {
  assert.match(await faucetCommand(['prana', '0x123'], who(), { store, cfg: cfg(), now: NOW }), /Usage/);
  assert.match(await faucetCommand(['prana', 'ab'.repeat(32)], who(), { store, cfg: cfg(), now: NOW }), /private key/);
  assert.match(await faucetCommand(['bogus'], who(), { store, cfg: cfg(), now: NOW }), /Faucets:/);
});
