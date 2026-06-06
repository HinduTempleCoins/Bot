// alpha-e2e.test.mjs — offline: injected fetch drives every check; report logic verified.
import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import { buildChecks, runAll, renderReport, __setFetch } from './alpha-e2e.mjs';

afterEach(() => __setFetch(null));

function happyFetch() {
  let head = 36000;
  return async (url, opts = {}) => {
    const u = String(url);
    if (opts.body) { // RPC
      const { method } = JSON.parse(opts.body);
      const result = method === 'condenser_api.get_dynamic_global_properties'
        ? { head_block_number: (head += 3) }
        : { owner: 'hathor', last_confirmed_block_num: head - 5, total_missed: 1, last_sbd_exchange_update: new Date().toISOString().slice(0, 19) };
      return { ok: true, status: 200, json: async () => ({ result }), text: async () => '' };
    }
    const body = u.includes('faucet/health') ? JSON.stringify({ ok: true, testnet: true, creator: 'initminer' })
      : u.includes('graphene-keys') ? 'export function keysFromLogin(){}'
      : u.includes('/hot') ? '"address_prefix":"TST"'
      : u.includes('pick_account') ? '<h1>Create your account</h1>'
      : u.includes('miner-worker') ? 'initializing RandomX'
      : 'ok';
    return { ok: true, status: 200, text: async () => body, json: async () => ({}) };
  };
}

test('all checks pass against a healthy fake stack', { timeout: 30000 }, async () => {
  __setFetch(happyFetch());
  // drop the slow head-advance sleep by running the real checks but with fast fetch — the
  // 6.5s wait is inherent; accept it once.
  const rep = await runAll();
  // bots check imports steemd which needs env; it is OPTIONAL — required ones must pass
  for (const r of rep.results.filter((x) => x.required)) assert.equal(r.pass, true, `${r.name}: ${r.detail}`);
  assert.equal(rep.pass, true);
  assert.match(renderReport(rep), /PASS/);
});

test('a dead surface fails the report and is named', { timeout: 30000 }, async () => {
  const happy = happyFetch();
  __setFetch(async (url, opts) => {
    if (String(url).includes('faucet/health')) return { ok: false, status: 503, text: async () => '', json: async () => ({}) };
    return happy(url, opts);
  });
  const rep = await runAll();
  assert.equal(rep.pass, false);
  assert.ok(rep.requiredFailures.some((r) => r.name.includes('faucet')));
  assert.match(renderReport(rep), /FAIL/);
});

test('checks never throw — a fetch that explodes becomes a failed check', { timeout: 30000 }, async () => {
  __setFetch(async () => { throw new Error('network gone'); });
  const rep = await runAll();
  assert.equal(rep.pass, false);
  assert.ok(rep.results.length === buildChecks().length);
});
