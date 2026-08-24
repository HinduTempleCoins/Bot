// account-hud.test.mjs — offline tests for the MELEK account-stats HUD.
// Deterministic: mana %, vests→power, delegations and reputation are asserted from injected numbers.
// Injectable fetch, no network; soft-fail paths return null / found:false (never throw).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  accountStats, accountBoard, headline, renderBoard, handler, __setFetch,
  configured, networkLabel,
} from './account-hud.mjs';

const RPC = 'http://example.invalid:8090';
const HEAD_TIME = '2026-08-24T00:00:00';
const NOW = Math.floor(Date.parse(HEAD_TIME + 'Z') / 1000);
let savedEnv;

beforeEach(() => {
  savedEnv = { rpc: process.env.MELEK_RPC_URL, net: process.env.MELEK_NETWORK };
  process.env.MELEK_RPC_URL = RPC;
  delete process.env.MELEK_NETWORK;
});
afterEach(() => {
  if (savedEnv.rpc === undefined) delete process.env.MELEK_RPC_URL; else process.env.MELEK_RPC_URL = savedEnv.rpc;
  if (savedEnv.net === undefined) delete process.env.MELEK_NETWORK; else process.env.MELEK_NETWORK = savedEnv.net;
  __setFetch(null);
});

// props: ratio = fund/shares = 1,000,000 / 2,000,000,000 = 0.0005 MP per VEST.
const PROPS = {
  head_block_number: 1000, time: HEAD_TIME,
  total_vesting_fund_balance: '1000000.000 MELEK',
  total_vesting_shares: '2000000000.000000 VESTS',
};

// alice: 2,000,000 own VESTS, none received/delegated → effective 2,000,000 VESTS → 1000 MP.
// voting mana: 1e12 as of 108000s ago (window/4) → regen 5e11 → 1.5e12 / 2e12 = 75%.
const ALICE = {
  name: 'alice', created: '2026-01-01T00:00:00', post_count: 42,
  vesting_shares: '2000000.000000 VESTS',
  received_vesting_shares: '0.000000 VESTS',
  delegated_vesting_shares: '0.000000 VESTS',
  balance: '12.345 MELEK', sbd_balance: '6.000 MBD', savings_balance: '0.000 MELEK',
  reputation: 1e13, // log10=13 → (13-9)*9+25 = 61
  voting_manabar: { current_mana: 1e12, last_update_time: NOW - 108000 },
  downvote_manabar: { current_mana: 2.5e11, last_update_time: NOW }, // max = 2e12/4 = 5e11 → 50%
  witness_votes: ['hathor', 'initminer'], proxy: '',
};
const DELEG_OUT = [{ delegatee: 'bob', vesting_shares: '100000.000000 VESTS', min_delegation_time: '2026-02-01T00:00:00' }];
const RC_ACCT = { rc_manabar: { current_mana: 1e9, last_update_time: NOW }, max_rc: 1e9 }; // 100%

function fakeRpc({ accounts = [ALICE], props = PROPS, deleg = DELEG_OUT, rc = RC_ACCT } = {}) {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    let result;
    switch (body.method) {
      case 'condenser_api.get_accounts': result = accounts; break;
      case 'condenser_api.get_dynamic_global_properties': result = props; break;
      case 'condenser_api.get_vesting_delegations': result = deleg; break;
      case 'rc_api.find_rc_accounts': result = rc == null ? null : { rc_accounts: [rc] }; break;
      default: result = null;
    }
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  };
}

test('accountStats reads account + props + delegations + rc', async () => {
  __setFetch(fakeRpc());
  const raw = await accountStats('Alice'); // also verifies lowercasing
  assert.equal(raw.account.name, 'alice');
  assert.equal(raw.delegationsOut.length, 1);
  assert.ok(raw.rc && raw.rc.max_rc === 1e9);
  assert.equal(raw.headTime, HEAD_TIME);
});

test('accountBoard computes voting energy from manabar regen (75%)', async () => {
  __setFetch(fakeRpc());
  const b = await accountBoard({ account: 'alice' });
  assert.equal(b.found, true);
  assert.equal(b.energy.votingPct, 75);
  assert.equal(b.energy.downvotePct, 50);
  assert.equal(b.energy.rcPct, 100);
});

test('accountBoard computes effective MELEK Power via the shared converter (1000 MP)', async () => {
  __setFetch(fakeRpc());
  const b = await accountBoard({ account: 'alice' });
  assert.equal(b.power.effectiveMp, 1000);
  assert.equal(b.power.ownMp, 1000);
  assert.equal(b.power.receivedMp, 0);
});

test('delegations: out list + MP, sorted; totals present', async () => {
  __setFetch(fakeRpc());
  const b = await accountBoard({ account: 'alice' });
  assert.equal(b.delegations.outCount, 1);
  assert.equal(b.delegations.out[0].to, 'bob');
  assert.equal(b.delegations.out[0].mp, 50); // 100000 * 0.0005
});

test('reputation transform: 1e13 → score 61', async () => {
  __setFetch(fakeRpc());
  const b = await accountBoard({ account: 'alice' });
  assert.equal(b.reputation.score, 61);
});

test('witness votes surfaced', async () => {
  __setFetch(fakeRpc());
  const b = await accountBoard({ account: 'alice' });
  assert.equal(b.votes.witnessCount, 2);
  assert.equal(b.votes.proxy, '');
});

test('soft-fail: rc_api absent → votingPct kept, rcPct null (board still assembles)', async () => {
  __setFetch(fakeRpc({ rc: null }));
  const b = await accountBoard({ account: 'alice' });
  assert.equal(b.found, true);
  assert.equal(b.energy.votingPct, 75);
  assert.equal(b.energy.rcPct, null);
});

test('unknown account → found:false, renderBoard shows not-found, never throws', async () => {
  __setFetch(fakeRpc({ accounts: [] }));
  const b = await accountBoard({ account: 'nobody' });
  assert.equal(b.found, false);
  const html = renderBoard(b);
  assert.match(html, /not found/i);
});

test('RPC unset → accountBoard soft-fails to found:false', async () => {
  delete process.env.MELEK_RPC_URL;
  assert.equal(configured(), false);
  const b = await accountBoard({ account: 'alice' });
  assert.equal(b.found, false);
});

test('headline is one plain line with account, energy, MP', async () => {
  __setFetch(fakeRpc());
  const b = await accountBoard({ account: 'alice' });
  const h = headline(b);
  assert.match(h, /@alice/);
  assert.match(h, /75% energy/);
  assert.match(h, /1,000 MP/);
});

test('renderBoard emits escaped HTML with the energy meters', async () => {
  __setFetch(fakeRpc());
  const b = await accountBoard({ account: 'alice' });
  const html = renderBoard(b);
  assert.match(html, /account-hud/);
  assert.match(html, /Voting energy/);
  assert.match(html, /Resource Credits/);
  assert.match(html, /@bob/);
});

test('renderBoard escapes hostile delegatee names (no raw angle brackets injected)', async () => {
  __setFetch(fakeRpc({ deleg: [{ delegatee: '<script>x', vesting_shares: '2000.000000 VESTS' }] }));
  const b = await accountBoard({ account: 'alice' });
  const html = renderBoard(b);
  assert.ok(!html.includes('<script>x'));
  assert.match(html, /&lt;script&gt;x/);
});

test('handler serves the HTML HUD (200) for a found account', async () => {
  __setFetch(fakeRpc());
  const chunks = [];
  const res = {
    writeHead(code, headers) { this.code = code; this.headers = headers; },
    end(s) { chunks.push(s); },
  };
  await handler({ url: '/hud?account=alice', headers: { host: 'x' } }, res);
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(chunks.join(''), /Account HUD/);
});

test('handler serves JSON on /api', async () => {
  __setFetch(fakeRpc());
  const chunks = [];
  const res = {
    writeHead(code, headers) { this.code = code; this.headers = headers; },
    end(s) { chunks.push(s); },
  };
  await handler({ url: '/api?account=alice', headers: { host: 'x' } }, res);
  assert.match(res.headers['content-type'], /application\/json/);
  const board = JSON.parse(chunks.join(''));
  assert.equal(board.account, 'alice');
  assert.equal(board.energy.votingPct, 75);
});

test('handler returns 404 for an unknown account (still valid HTML)', async () => {
  __setFetch(fakeRpc({ accounts: [] }));
  const res = { writeHead(c, h) { this.code = c; this.headers = h; }, end() {} };
  await handler({ url: '/hud?account=ghost', headers: { host: 'x' } }, res);
  assert.equal(res.code, 404);
});

test('mainnet label flips without losing the reader', async () => {
  process.env.MELEK_NETWORK = 'mainnet';
  assert.equal(networkLabel(), '[MELEK]');
  __setFetch(fakeRpc());
  const b = await accountBoard({ account: 'alice' });
  assert.equal(b.label, '[MELEK]');
});
