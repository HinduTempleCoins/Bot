// spamtest/probe.mjs — READ-ONLY live-chain probe for the #299 rate-limit test.
//
// Boundary (CLAUDE.md / task #299): this task runs ONLY read-only probes against the
// live chain. This module never broadcasts and never holds a key. It answers:
//   • what anti-spam limits does the LIVE MELEK testnet actually enforce? (get_config)
//   • how fast has a given account been posting/commenting/voting? (account history)
//   • given that, what would the spam runner's flood hit first?
//
// From this Codespace the RPC is https://alpha.melek.salon/rpc (server-side the node is
// also reachable directly). The fetch fn is injectable so tests run fully offline.
//
// CLI:
//   node spamtest/probe.mjs                      print the enforced limits (live config)
//   node spamtest/probe.mjs --account spambot1   + that account's recent op cadence
//   node spamtest/probe.mjs --json               raw JSON

import { chainLimits } from './limits.mjs';

const DEFAULT_RPC = process.env.SPAMTEST_RPC || process.env.MELEK_RPC_URL || 'https://alpha.melek.salon/rpc';

let _fetch = globalThis.fetch;
/** Inject a fetch for tests (offline). */
export function __setFetch(fn) { _fetch = fn || globalThis.fetch; }

// This Steem-era fork wants the legacy `call` envelope: params = [api, method, args].
async function rpc(method, params = [], { rpcUrl = DEFAULT_RPC, api = 'condenser_api' } = {}) {
  const body = JSON.stringify({ jsonrpc: '2.0', method: 'call', params: [api, method, params], id: 1 });
  const res = await _fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'rpc error');
  return json.result;
}

/** Fetch the live chain config (the STEEM_* params that define the spam limits). */
export async function fetchConfig({ rpcUrl = DEFAULT_RPC } = {}) {
  return rpc('get_config', [], { rpcUrl });
}

/** Fetch dynamic global properties (head block, reserve/subsidy/voting knobs). */
export async function fetchDgp({ rpcUrl = DEFAULT_RPC } = {}) {
  return rpc('get_dynamic_global_properties', [], { rpcUrl });
}

/** Fetch one account record. */
export async function fetchAccount(name, { rpcUrl = DEFAULT_RPC } = {}) {
  const r = await rpc('get_accounts', [[name]], { rpcUrl });
  return Array.isArray(r) && r[0] ? r[0] : null;
}

/**
 * Read an account's recent op cadence — the gaps between successive posts / comments /
 * votes — so we can SEE the chain's intervals in action and confirm the runner's model.
 *
 * @returns {{ gapsSec: {post:number[], comment:number[], vote:number[]}, lastAt: object, count: object }}
 */
export async function fetchCadence(name, { rpcUrl = DEFAULT_RPC, limit = 200 } = {}) {
  const history = await rpc('get_account_history', [name, -1, limit], { rpcUrl });
  const times = { post: [], comment: [], vote: [] };
  for (const [, entry] of history || []) {
    const [opName, opVal] = entry.op;
    const t = Date.parse(entry.timestamp + 'Z');
    if (opName === 'comment') {
      (opVal.parent_author ? times.comment : times.post).push(t);
    } else if (opName === 'vote' && opVal.voter === name) {
      times.vote.push(t);
    }
  }
  const gaps = {};
  const lastAt = {};
  const count = {};
  for (const k of ['post', 'comment', 'vote']) {
    const arr = times[k].sort((a, b) => a - b);
    count[k] = arr.length;
    lastAt[k] = arr.length ? new Date(arr[arr.length - 1]).toISOString() : null;
    gaps[k] = [];
    for (let i = 1; i < arr.length; i++) gaps[k].push(+((arr[i] - arr[i - 1]) / 1000).toFixed(1));
  }
  return { gapsSec: gaps, lastAt, count };
}

/**
 * Full probe report: the enforced limits (from live config) + optional account cadence.
 * Soft-fails to decoded defaults if the RPC is unreachable so the report always prints.
 */
export async function probe({ rpcUrl = DEFAULT_RPC, account } = {}) {
  let config = {}, dgp = null, live = true;
  try { config = await fetchConfig({ rpcUrl }); } catch { live = false; }
  try { dgp = await fetchDgp({ rpcUrl }); } catch { /* optional */ }
  const { params } = chainLimits(config);

  const report = {
    rpcUrl,
    live,
    enforced: {
      rootPostEverySec: params.rootCommentIntervalSec,
      replyEverySec: params.replyIntervalSec,
      voteEverySec: params.voteIntervalSec,
      commentEditEverySec: params.commentEditIntervalSec,
      bandwidthWindowDays: +(params.bandwidthWindowSec / 86400).toFixed(2),
      maxReserveRatio: params.maxReserveRatio,
      maxTxBytes: params.maxTransactionSize,
      votingManaRegenDays: +(params.votingManaRegenSec / 86400).toFixed(2),
    },
    dgp: dgp ? {
      headBlock: dgp.head_block_number,
      currentWitness: dgp.current_witness,
      availableAccountSubsidies: dgp.available_account_subsidies,
      votePowerReserveRate: dgp.vote_power_reserve_rate,
      targetVotesPerPeriod: dgp.target_votes_per_period,
    } : null,
  };

  if (account) {
    try {
      const acct = await fetchAccount(account, { rpcUrl });
      const cadence = await fetchCadence(account, { rpcUrl });
      report.account = {
        name: account,
        exists: !!acct,
        vestingShares: acct?.vesting_shares ?? null,
        receivedVestingShares: acct?.received_vesting_shares ?? null,
        votingPower: acct?.voting_power ?? null,
        cadence,
      };
    } catch (e) {
      report.account = { name: account, error: e.message };
    }
  }
  return report;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────
function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const account = getArg('--account');
  const rpcUrl = getArg('--rpc') || DEFAULT_RPC;
  const r = await probe({ rpcUrl, account });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); return; }

  console.log(`MELEK forum anti-spam limits  (${r.live ? 'LIVE config from ' + r.rpcUrl : 'OFFLINE — decoded defaults'})`);
  console.log('─'.repeat(70));
  const e = r.enforced;
  console.log(`  Top-level post  : 1 every ${e.rootPostEverySec}s   (consensus, hard reject)`);
  console.log(`  Reply / comment : 1 every ${e.replyEverySec}s    (consensus, hard reject)`);
  console.log(`  Vote            : 1 every ${e.voteEverySec}s     (consensus, hard reject)`);
  console.log(`  Comment edit    : 1 every ${e.commentEditEverySec}s     (consensus)`);
  console.log(`  Bandwidth window: ${e.bandwidthWindowDays} days rolling   reserve-ratio ≤ ${e.maxReserveRatio}`);
  console.log(`  Voting mana     : regenerates over ${e.votingManaRegenDays} days`);
  console.log(`  Max tx size     : ${e.maxTxBytes} bytes`);
  if (r.dgp) {
    console.log(`\n  head block ${r.dgp.headBlock}, witness ${r.dgp.currentWitness}`);
    console.log(`  account-creation subsidies available: ${r.dgp.availableAccountSubsidies}`);
  }
  if (r.account) {
    const a = r.account;
    console.log(`\nAccount @${a.name}: exists=${a.exists}  VESTS=${a.vestingShares}  votingPower=${a.votingPower}`);
    if (a.cadence) {
      for (const k of ['post', 'comment', 'vote']) {
        const g = a.cadence.gapsSec[k];
        const min = g.length ? Math.min(...g) : null;
        console.log(`  ${k.padEnd(8)}: ${a.cadence.count[k]} ops, last ${a.cadence.lastAt[k] || '—'}, min gap ${min ?? '—'}s`);
      }
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('probe.mjs')) {
  main().catch((err) => { console.error('[probe] fatal:', err.message); process.exit(1); });
}
