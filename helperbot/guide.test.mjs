// guide.test.mjs — guide mode walks EVERY WORKS flow end to end, verifies chain-traceable steps before
// advancing, holds the step on a failed check, and gives NOT FINISHED flows only the Under Construction
// notice. Offline (fake chain + the vendored flows snapshot).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { __setFetch } from './live.mjs';
import { guideCommand, findFlow, ALIASES, FEATURED, VERIFIERS, __setFlows, loadFlows } from './guide.mjs';
import { memoryStore } from './store.mjs';
import { PRANA } from './addresses.mjs';
import { baseState, fakeFetch, wei } from './test-fakes.mjs';

const FLOWS = JSON.parse(readFileSync(new URL('./data/flows.snapshot.json', import.meta.url), 'utf8'));
const WORKS = FLOWS.filter((f) => f.status === 'WORKS');
const ADDR = '0x00000000000000000000000000000000000a11ce';
const lc = (a) => a.toLowerCase();
let st;
let store;
const who = { platform: 'discord', userId: 'u1' };
const g = (cmd, args = []) => guideCommand(cmd, args, who, { store, now: Date.parse('2026-10-17T12:00:00Z') });

function before() {
  st = baseState();
  for (const net of ['mainnet', 'testnet']) st.melek[net].accounts.alice = { name: 'alice', balance: '0.000 MELEK', vesting_shares: '0 VESTS', received_vesting_shares: '0 VESTS', post_count: 0 };
  st.prana.mainnet.bal[lc(PRANA.KULA)] = { [lc(ADDR)]: wei(100), [lc(PRANA.veKULA)]: wei(600) };
  st.engine.balances['alice|WMELEK'] = 0;
}
function after() {
  for (const net of ['mainnet', 'testnet']) Object.assign(st.melek[net].accounts.alice, { balance: '10.000 MELEK', received_vesting_shares: '5.000000 VESTS', post_count: 1 });
  st.melek.mainnet.history.alice = [[1, { trx_id: 't', op: ['transfer', { from: 'alice', to: 'wmelek-bridge', amount: '1.000 MELEK', memo: '' }] }]];
  st.melek.mainnet.witnesses.alice = { owner: 'alice' };
  st.engine.balances['alice|WMELEK'] = 1;
  st.prana.alpha.native[lc(ADDR)] = wei(5);
  st.prana.mainnet.native[lc(ADDR)] = wei(1);
  st.prana.mainnet.nonce[lc(ADDR)] = 2;
  st.prana.mainnet.bal[lc(PRANA.KULA)] = { [lc(ADDR)]: wei(50), [lc(PRANA.veKULA)]: wei(650) };
  st.pool[`prana-mainnet|${ADDR}`] = { pendingShares: 3, pendingBalance: 0, totalPaid: 0, performanceSamples: [] };
}

beforeEach(() => { before(); __setFetch(fakeFetch(st)); __setFlows(FLOWS); store = memoryStore(); });

test('snapshot sanity: the operator\'s featured flows are WORKS and every alias resolves', () => {
  const ids = new Set(WORKS.map((f) => f.id));
  for (const id of ['create-melek-account', 'first-post-melek-salon', 'bridge-vkbt-cure-prana', 'kulaswap-swap', 'pool-browser-mine', 'stake-kula-vekula', 'melek-to-wmelek-engine', 'autovote-curation', 'mining-servers']) assert.ok(ids.has(id), id);
  for (const [alias, id] of Object.entries(ALIASES)) assert.equal(findFlow(alias, FLOWS).id, id, alias);
  for (const id of FEATURED) assert.ok(FLOWS.some((f) => f.id === id), id);
  // every verifier step number exists in its flow
  for (const [id, v] of Object.entries(VERIFIERS)) {
    const f = FLOWS.find((x) => x.id === id);
    assert.ok(f, id);
    for (const n of Object.keys(v.steps)) assert.ok(f.steps.some((s) => s.n === Number(n)), `${id}#${n}`);
  }
});

test('natural phrasing finds the right flow', () => {
  assert.equal(findFlow('how do i make a melek account', FLOWS).id, 'create-melek-account');
  assert.equal(findFlow('swap tokens on kulaswap', FLOWS).id, 'kulaswap-swap');
  assert.equal(findFlow('xyzzy plugh', FLOWS), null);
});

// The generic walk excludes the two flows whose checks need a mid-flow state change (tested below).
const SPECIAL = new Set(['create-melek-account', 'bridge-vkbt-cure-prana']);
for (const flow of WORKS.filter((f) => !SPECIAL.has(f.id))) {
  test(`walks WORKS flow "${flow.id}" end to end (${flow.steps.length} steps)`, async () => {
    const start = await g('guide', [flow.id, '@alice', ADDR]);
    assert.match(start, new RegExp(`step 1/${flow.steps.length}`));
    after();
    let last = '';
    for (let i = 0; i < flow.steps.length; i++) {
      last = await g('next');
      assert.ok(!/^(✋|⏳)/.test(last), `${flow.id} step ${i + 1}: ${last}`);
    }
    assert.match(last, /Done/);
    assert.equal(store.get('guide:discord:u1'), null, 'session cleared at the end');
  });
}

test('every WORKS flow is covered by the walk (none skipped silently)', () => {
  assert.equal(WORKS.length, WORKS.filter((f) => !SPECIAL.has(f.id)).length + SPECIAL.size);
});

test('signup guide: name free → (keys in browser) → account exists on-chain → welcome grant', async () => {
  delete st.melek.testnet.accounts.alice;
  await g('guide', ['signup', '@alice', 'testnet']);
  assert.match(await g('next'), /@alice is free/);
  await g('next'); await g('next'); // self-check: save keys, retype password
  let r = await g('next'); // step 4: account must exist
  assert.match(r, /^✋ @alice doesn't exist on MELEK testnet/);
  st.melek.testnet.accounts.alice = { name: 'alice', balance: '0.000 TESTS', received_vesting_shares: '0 VESTS', post_count: 0 };
  assert.match(await g('next'), /exists on-chain/);
  await g('next'); // step 5 self-check
  r = await g('next'); // step 6: grant
  assert.match(r, /hasn't landed yet/);
  st.melek.testnet.accounts.alice.balance = '7.000 TESTS';
  assert.match(await g('next'), /Welcome grant landed/);
  assert.match(await g('next'), /Done/);
});

test('signup: a taken name is caught at step 1', async () => {
  await g('guide', ['signup', '@alice', 'testnet']);
  assert.match(await g('next'), /already taken/);
});

test('bridge guide: mint on PRANA verified at step 5, burn verified at step 8', async () => {
  await g('guide', ['bridge', ADDR]);
  for (let i = 0; i < 4; i++) await g('next');
  assert.match(await g('next'), /Not minted yet/);
  st.prana.mainnet.bal[lc(PRANA.wVKBT)] = { [lc(ADDR)]: wei(10, 8) };
  assert.match(await g('next'), /Minted on PRANA/);
  await g('next'); await g('next');
  assert.match(await g('next'), /don't see the withdraw/);
  st.prana.mainnet.bal[lc(PRANA.wVKBT)] = { [lc(ADDR)]: wei(4, 8) };
  assert.match(await g('next'), /Withdraw burned/);
});

test('a failed check holds the step; an unreachable chain says so', async () => {
  await g('guide', ['swap', ADDR]);
  assert.match(await g('next'), /no PRANA for gas/);
  assert.match(await g('step'), /step 1\//);
  st.down.add('rpc.prana.melek.salon');
  assert.match(await g('next'), /^⏳/);
});

test('missing identity: the guide asks for a PUBLIC name/address and `!guide set` supplies it', async () => {
  const s = await g('guide', ['stake']);
  assert.match(s, /PUBLIC address/);
  assert.match(await g('next'), /need your PUBLIC 0x address/);
  const r = await g('guide', ['set', ADDR]);
  assert.match(r, /Got it/);
  assert.match(await g('next'), /You hold 100 KULA/);
  assert.match(await g('back'), /step 1\//);
  assert.match(await g('guide', ['stop']), /Guide ended/);
  assert.match(await g('next'), /No guide running/);
});

test('NOT FINISHED flows only ever get the one-line Under Construction notice', async () => {
  for (const f of FLOWS.filter((x) => x.status !== 'WORKS')) {
    const r = await g('guide', [f.id]);
    assert.match(r, /^🚧 /, f.id);
    assert.equal(r.split('\n').length, 1, f.id);
  }
  assert.match(await g('guide', ['recover']), /under construction/);
});

test('list shows featured guides and the under-construction list, never Botanica', async () => {
  const l = await g('guide');
  assert.match(l, /!guide signup/);
  assert.match(l, /!guide swap/);
  assert.match(l, /Under construction/);
  assert.ok(!/botanica/i.test(l));
});

test('live flows map wins over the snapshot (a flow that stops working is withdrawn)', async () => {
  __setFlows(null);
  st.flows = FLOWS.map((f) => (f.id === 'kulaswap-swap' ? { id: f.id, status: 'NOT FINISHED', answer: 'Swapping is under construction and not available yet.' } : f));
  const flows = await loadFlows(Date.now() + 1);
  assert.equal(flows.find((f) => f.id === 'kulaswap-swap').status, 'NOT FINISHED');
  assert.match(await g('guide', ['swap']), /^🚧 Swapping is under construction/);
  // and if the map is unreachable the snapshot keeps guides working
  __setFlows(null); st.flows = null;
  assert.equal((await loadFlows(Date.now() + 2)).length, FLOWS.length);
});
