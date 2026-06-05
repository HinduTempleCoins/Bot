// integrations/spam-test.mjs — TESTNET-ONLY spam/rate-limit probe (Task: site tests 2026-06-05).
//
// PURPOSE
//   Hammer the MELEK *testnet* with posts / comments / votes / custom_json from a
//   throwaway account and MEASURE what the CHAIN already enforces — so we can design
//   behavioral rate limits (docs/RATE_LIMITS.md) that are IDENTICAL for humans and AIs
//   (per .local/CONDENSER_SITE_RULES_RECOVERED_2026-06-05.md: no AI-category discrimination;
//   spam is a BEHAVIOR addressed by uniform limits + content signals + Cheetah).
//
// SAFETY (hard rules)
//   - TESTNET ONLY. Refuses to run unless the node reports IS_TEST_NET=true AND the
//     address prefix is TST. Never point this at mainnet; never use a mainnet WIF.
//   - The only private key used is the *public, well-known* testnet `initminer` key
//     (the chain's STEEM_INIT_PUBLIC_KEY_STR). Passed via env SPAMTEST_WIF, never logged.
//   - Read-only by default. Broadcasts only with --go.
//
// WHAT IT MEASURES
//   1. comment/post interval  (STEEM_MIN_ROOT_COMMENT_INTERVAL = 5 min between ROOT posts;
//      STEEM_MIN_REPLY_INTERVAL_HF20 = 3 s between comments/replies)
//   2. vote interval          (STEEM_MIN_VOTE_INTERVAL_SEC = 3 s) + voting-mana drain
//   3. custom_json throughput  (the trollbox transport) — RC / bandwidth ceiling
//   For each: ops attempted, ops accepted, first rejection, error message, effective ops/min.
//
// USAGE
//   node integrations/spam-test.mjs                # dry-run plan, no broadcast
//   SPAMTEST_WIF=<testnet-initminer-wif> node integrations/spam-test.mjs --go
//   ... --account spambot7  --burst 20  --only comment,vote,custom_json
//
// On --go it will (idempotently) create the throwaway account via initminer if missing,
// fund + delegate it a little vesting (for RC), then run the bursts as THAT account.

import { Client, PrivateKey, cryptoUtils } from '@hiveio/dhive';

const RPC = process.env.SPAMTEST_RPC || 'https://alpha.melek.salon/rpc';
const ADDRESS_PREFIX = 'TST';
const INITMINER = 'initminer';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const GO = has('--go');
const ACCOUNT = val('--account', 'spambot');
const BURST = Number(val('--burst', '15'));
const ONLY = (val('--only', 'comment,vote,custom_json')).split(',').map((s) => s.trim());

function log(...a) { console.log(...a); }
function nowIso() { return new Date().toISOString(); }

async function makeClient() {
  // chain id is read from the node so this stays correct across testnet rebuilds
  const probe = new Client(RPC, { addressPrefix: ADDRESS_PREFIX, timeout: 20000 });
  const cfg = await probe.database.call('get_config', []);
  const chainId = cfg.STEEM_CHAIN_ID;
  if (!cfg.IS_TEST_NET) throw new Error('REFUSING: node is not a testnet (IS_TEST_NET != true)');
  if (cfg.STEEM_ADDRESS_PREFIX !== ADDRESS_PREFIX) throw new Error(`REFUSING: prefix ${cfg.STEEM_ADDRESS_PREFIX} != TST`);
  const client = new Client(RPC, { chainId, addressPrefix: ADDRESS_PREFIX, timeout: 20000 });
  return { client, cfg, chainId };
}

// Derive a deterministic test key for the throwaway account from a fixed seed.
function deriveKeys(account) {
  const role = (r) => PrivateKey.fromSeed(`${account}-${r}-melektestnet-spamprobe`);
  return {
    owner: role('owner'), active: role('active'), posting: role('posting'), memo: role('memo'),
  };
}

async function getAccount(client, name) {
  const [a] = await client.database.getAccounts([name]);
  return a || null;
}

async function ensureAccount(client, initminerWif) {
  let acct = await getAccount(client, ACCOUNT);
  if (acct) { log(`  account @${ACCOUNT} exists`); return; }
  log(`  creating @${ACCOUNT} via @${INITMINER} ...`);
  const k = deriveKeys(ACCOUNT);
  const auth = (pub) => ({ weight_threshold: 1, account_auths: [], key_auths: [[pub, 1]] });
  const ck = (pk) => pk.createPublic(ADDRESS_PREFIX).toString();
  // account_creation_fee comes from the witness median props; read it instead of guessing.
  const wso = await client.database.call('get_witness_schedule', []).catch(() => null);
  const fee = (wso && wso.median_props && wso.median_props.account_creation_fee) || '0.001 TESTS';
  const op = ['account_create', {
    fee,
    creator: INITMINER,
    new_account_name: ACCOUNT,
    owner: auth(ck(k.owner)),
    active: auth(ck(k.active)),
    posting: auth(ck(k.posting)),
    memo_key: ck(k.memo),
    json_metadata: '',
  }];
  await client.broadcast.sendOperations([op], PrivateKey.fromString(initminerWif));
  // fund a little + delegate vesting so the account has RC/bandwidth to act
  await client.broadcast.sendOperations(
    [['transfer', { from: INITMINER, to: ACCOUNT, amount: '10.000 TESTS', memo: 'spamtest seed' }]],
    PrivateKey.fromString(initminerWif));
  await client.broadcast.sendOperations(
    [['transfer_to_vesting', { from: INITMINER, to: ACCOUNT, amount: '10.000 TESTS' }]],
    PrivateKey.fromString(initminerWif)).catch((e) => log('  (vesting xfer skipped:', e.message, ')'));
  log(`  @${ACCOUNT} created + funded`);
}

// Run a timed burst of one op kind, broadcasting back-to-back, recording accept/reject.
async function burst(client, kind, buildOp, signer, n) {
  const results = [];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const op = buildOp(i);
    const tOp = Date.now();
    try {
      await client.broadcast.sendOperations([op], signer);
      results.push({ i, ok: true, dtMs: Date.now() - tOp });
    } catch (e) {
      const msg = (e && e.message ? e.message : String(e)).split('\n')[0].slice(0, 300);
      results.push({ i, ok: false, dtMs: Date.now() - tOp, err: msg });
    }
  }
  const elapsedMs = Date.now() - t0;
  const accepted = results.filter((r) => r.ok).length;
  const firstReject = results.find((r) => !r.ok);
  const opsPerMin = accepted > 0 ? +(accepted / (elapsedMs / 60000)).toFixed(1) : 0;
  return { kind, attempted: n, accepted, rejected: n - accepted, elapsedMs, opsPerMin, firstReject, results };
}

function permlink(prefix, i) {
  return `${prefix}-${Date.now()}-${i}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 200);
}

async function main() {
  log('');
  log('  MELEK testnet spam / rate-limit probe');
  log('  =====================================');
  log(`  rpc      : ${RPC}`);
  log(`  account  : @${ACCOUNT}`);
  log(`  burst    : ${BURST} per kind`);
  log(`  kinds    : ${ONLY.join(', ')}`);
  log(`  mode     : ${GO ? 'LIVE BROADCAST (--go)' : 'DRY RUN (no broadcast)'}`);
  log('');

  const { client, cfg } = await makeClient();
  const gp = await client.database.getDynamicGlobalProperties();
  log(`  chain head ${gp.head_block_number}, witness ${gp.current_witness}, IS_TEST_NET=${cfg.IS_TEST_NET}`);
  log('  chain-enforced intervals (from get_config):');
  log(`    root comment interval : ${cfg.STEEM_MIN_ROOT_COMMENT_INTERVAL / 1e6} s`);
  log(`    reply interval (HF20) : ${cfg.STEEM_MIN_REPLY_INTERVAL_HF20 / 1e6} s`);
  log(`    min vote interval     : ${cfg.STEEM_MIN_VOTE_INTERVAL_SEC} s`);
  log(`    comment edit interval : ${cfg.STEEM_MIN_COMMENT_EDIT_INTERVAL / 1e6} s`);
  log(`    bandwidth window      : ${cfg.STEEM_BANDWIDTH_AVERAGE_WINDOW_SECONDS} s`);
  log('');

  if (!GO) {
    log('  DRY RUN — would create/ensure the throwaway account, then for each kind broadcast');
    log(`  ${BURST} ops back-to-back and record the first rejection + ops/min. Re-run with --go.`);
    log('');
    return;
  }

  const wif = process.env.SPAMTEST_WIF;
  if (!wif) throw new Error('SPAMTEST_WIF not set (testnet initminer WIF required for --go)');
  const initSigner = PrivateKey.fromString(wif);

  await ensureAccount(client, wif);
  const k = deriveKeys(ACCOUNT);

  const report = { startedAt: nowIso(), rpc: RPC, account: ACCOUNT, burst: BURST, bursts: [] };

  // 1. COMMENTS (replies under a root we own). First we publish one root, then spam replies.
  if (ONLY.includes('comment')) {
    log('  [comment] publishing one root post, then bursting replies...');
    const rootPl = permlink('spamroot', 0);
    try {
      await client.broadcast.sendOperations([['comment', {
        parent_author: '', parent_permlink: 'test', author: ACCOUNT, permlink: rootPl,
        title: 'spam-test root', body: 'root for spam-test reply burst', json_metadata: '{"app":"spam-test"}',
      }]], k.posting);
    } catch (e) { log('    root post error:', e.message); }
    const b = await burst(client, 'comment(reply)', (i) => ['comment', {
      parent_author: ACCOUNT, parent_permlink: rootPl, author: ACCOUNT, permlink: permlink('spamreply', i),
      title: '', body: `reply ${i} @ ${Date.now()}`, json_metadata: '{"app":"spam-test"}',
    }], k.posting, BURST);
    report.bursts.push(b);
    log(`    accepted ${b.accepted}/${b.attempted}, ${b.opsPerMin}/min, firstReject: ${b.firstReject ? b.firstReject.err : 'none'}`);
  }

  // 2. ROOT POSTS — the 5-minute interval should bite after the first.
  if (ONLY.includes('post')) {
    log('  [post] bursting ROOT posts (expect 5-min interval to reject after #1)...');
    const b = await burst(client, 'root-post', (i) => ['comment', {
      parent_author: '', parent_permlink: 'test', author: ACCOUNT, permlink: permlink('spampost', i),
      title: `spam post ${i}`, body: `body ${i}`, json_metadata: '{"app":"spam-test"}',
    }], k.posting, Math.min(BURST, 5));
    report.bursts.push(b);
    log(`    accepted ${b.accepted}/${b.attempted}, firstReject: ${b.firstReject ? b.firstReject.err : 'none'}`);
  }

  // 3. VOTES — vote our own root repeatedly (weight varies to avoid identical-vote dedupe).
  if (ONLY.includes('vote')) {
    log('  [vote] bursting votes (expect 3-s interval + mana drain)...');
    // need a target permlink; reuse a root we just made or make one
    const votePl = permlink('spamvotetarget', 0);
    try {
      await client.broadcast.sendOperations([['comment', {
        parent_author: '', parent_permlink: 'test', author: ACCOUNT, permlink: votePl,
        title: 'vote target', body: 'target', json_metadata: '{"app":"spam-test"}',
      }]], k.posting);
    } catch (e) { log('    vote-target post error:', e.message); }
    const b = await burst(client, 'vote', (i) => ['vote', {
      voter: ACCOUNT, author: ACCOUNT, permlink: votePl, weight: 10000 - (i % 5) * 1000,
    }], k.posting, BURST);
    report.bursts.push(b);
    log(`    accepted ${b.accepted}/${b.attempted}, ${b.opsPerMin}/min, firstReject: ${b.firstReject ? b.firstReject.err : 'none'}`);
  }

  // 4. CUSTOM_JSON — the trollbox transport. Cheapest op; find the RC/bandwidth ceiling.
  if (ONLY.includes('custom_json')) {
    log('  [custom_json] bursting trollbox-style custom_json (find RC/bandwidth ceiling)...');
    const b = await burst(client, 'custom_json', (i) => ['custom_json', {
      required_auths: [], required_posting_auths: [ACCOUNT], id: 'melek_trollbox',
      json: JSON.stringify({ v: 1, user: ACCOUNT, text: `spam line ${i}`, ts: Date.now() }),
    }], k.posting, BURST);
    report.bursts.push(b);
    log(`    accepted ${b.accepted}/${b.attempted}, ${b.opsPerMin}/min, firstReject: ${b.firstReject ? b.firstReject.err : 'none'}`);
  }

  report.finishedAt = nowIso();
  log('');
  log('  ===== RESULT JSON =====');
  log(JSON.stringify(report.bursts.map((b) => ({
    kind: b.kind, attempted: b.attempted, accepted: b.accepted, opsPerMin: b.opsPerMin,
    firstRejectErr: b.firstReject ? b.firstReject.err : null,
  })), null, 2));
  log('');
}

main().catch((e) => { console.error('SPAM-TEST ERROR:', e.message); process.exit(1); });
