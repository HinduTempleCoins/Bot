// chain-explorer.mjs — READ-ONLY steemd-style base-chain explorer. No keys.
// This is the "look at the chain like a block explorer" view: accounts, balances, blocks,
// witnesses, and transfer history on the BASE layer (HIVE-side), to set beside the
// HIVE-Engine token view (hive-engine-market.mjs). It is also the template the MELEK chain
// gets visualized through — point it at MELEK_RPC_URL and the same views render MELEK.
//
//   node integrations/chain-explorer.mjs chain                 # head block / global props
//   node integrations/chain-explorer.mjs account <name>        # balances + recent transfers
//   node integrations/chain-explorer.mjs witness <name>        # witness record
//   node integrations/chain-explorer.mjs block <num>           # one block's ops
//   import { account, chain, witness, transfers } from './chain-explorer.mjs'
//
// MELEK mode: if MELEK_RPC_URL is set it is used (and labeled MELEK); otherwise the explorer
// runs against public Hive nodes for development and says so. Gated, never crashes when MELEK
// isn't live yet.

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// MELEK endpoint when configured, else public Hive mirrors for development
const MELEK_RPC = (process.env.MELEK_RPC_URL || '').trim();
export const ON_MELEK = !!MELEK_RPC;
export const CHAIN_LABEL = ON_MELEK ? 'MELEK' : 'HIVE (dev — MELEK_RPC_URL not set yet)';
const NODES = ON_MELEK
  ? [MELEK_RPC]
  : ['https://api.hive.blog', 'https://api.deathwing.me', 'https://api.openhive.network'];

const TIMEOUT_MS = +(process.env.CHAIN_TIMEOUT_MS || 12000);

async function rpc(method, params = []) {
  let lastErr;
  for (const node of NODES) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(node, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': UA },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctrl.signal,
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'rpc error');
      return j.result;
    } catch (e) { lastErr = e; } finally { clearTimeout(t); }
  }
  throw lastErr || new Error('all chain nodes failed');
}

const VESTS_NOTE = 'VESTS (stake; convert with the chain VESTS↔power ratio for display)';
function amt(s) { return typeof s === 'string' ? s : (s?.amount != null ? `${s.amount} ${s.nai || ''}` : String(s)); }

// ── global / chain ──────────────────────────────────────────────────────────
export async function chain() {
  const p = await rpc('condenser_api.get_dynamic_global_properties');
  return {
    label: CHAIN_LABEL,
    headBlock: p.head_block_number,
    irreversible: p.last_irreversible_block_num,
    currentWitness: p.current_witness,
    supply: p.current_supply,
    time: p.time,
  };
}

// ── account ─────────────────────────────────────────────────────────────────
export async function account(name) {
  const [a] = await rpc('condenser_api.get_accounts', [[name]]);
  if (!a) return null;
  return {
    name: a.name,
    created: a.created,
    balance: a.balance,             // liquid base token (e.g. HIVE)
    savings: a.savings_balance,
    hbd: a.hbd_balance ?? a.sbd_balance,
    vesting: a.vesting_shares,       // staked power, in VESTS
    postCount: a.post_count,
    witnessVotes: a.witness_votes,
    proxy: a.proxy || null,
    recoveryAccount: a.recovery_account,
    lastVoteTime: a.last_vote_time,
  };
}

// ── transfers (base-layer money movement; complements the HIVE-Engine token side) ──
export async function transfers(name, limit = 30) {
  // condenser_api.get_account_history: [account, start(-1=most recent), limit]
  const hist = await rpc('condenser_api.get_account_history', [name, -1, Math.min(limit, 1000)]);
  const out = [];
  for (const [seq, op] of hist) {
    const [type, data] = op.op;
    if (type !== 'transfer') continue;
    out.push({ seq, time: op.timestamp, from: data.from, to: data.to, amount: data.amount, memo: (data.memo || '').slice(0, 80) });
  }
  return out.reverse(); // most recent first
}

// ── witness ─────────────────────────────────────────────────────────────────
export async function witness(name) {
  const w = await rpc('condenser_api.get_witness_by_account', [name]);
  if (!w) return null;
  return {
    owner: w.owner,
    url: w.url,
    runningVersion: w.running_version,
    totalMissed: w.total_missed,
    lastBlock: w.last_confirmed_block_num,
    signingKey: w.signing_key,
    votes: w.votes,
    feed: w.hbd_exchange_rate || w.sbd_exchange_rate,
    props: { accountCreationFee: w.props?.account_creation_fee, maxBlockSize: w.props?.maximum_block_size },
  };
}

// ── block ───────────────────────────────────────────────────────────────────
export async function block(num) {
  const b = await rpc('condenser_api.get_block', [+num]);
  if (!b) return null;
  const opCounts = {};
  for (const tx of b.transactions || []) for (const [type] of tx.operations || []) opCounts[type] = (opCounts[type] || 0) + 1;
  return { num: +num, timestamp: b.timestamp, witness: b.witness, txCount: (b.transactions || []).length, opCounts };
}

// ── CLI ───────────────────────────────────────────────────────────────────--
if (process.argv[1] && process.argv[1].endsWith('chain-explorer.mjs')) {
  const [cmd, arg] = process.argv.slice(2);
  const banner = `Chain explorer — ${CHAIN_LABEL} (read-only)`;
  try {
    if (!cmd || cmd === 'chain') {
      const c = await chain();
      console.log(banner + '\n' + '─'.repeat(60));
      console.log(`  head block:      ${c.headBlock}`);
      console.log(`  irreversible:    ${c.irreversible}`);
      console.log(`  current witness: @${c.currentWitness}`);
      console.log(`  supply:          ${amt(c.supply)}`);
      console.log(`  chain time:      ${c.time}`);
    } else if (cmd === 'account') {
      const a = await account(arg);
      console.log(banner + '\n' + '─'.repeat(60));
      if (!a) { console.log(`  @${arg} not found`); }
      else {
        console.log(`  @${a.name}  (created ${String(a.created).slice(0, 10)})`);
        console.log(`  liquid:   ${a.balance}`);
        console.log(`  savings:  ${a.savings}`);
        console.log(`  hbd:      ${a.hbd}`);
        console.log(`  staked:   ${a.vesting}  — ${VESTS_NOTE}`);
        console.log(`  posts:    ${a.postCount}   witness votes: ${a.witnessVotes?.length || 0}`);
        const t = await transfers(arg, 10).catch(() => []);
        console.log(`  recent transfers (${t.length}):`);
        for (const x of t.slice(0, 10)) console.log(`    ${String(x.time).slice(0, 16)}  ${x.from} → ${x.to}  ${x.amount}${x.memo ? '  "' + x.memo + '"' : ''}`);
      }
    } else if (cmd === 'witness') {
      const w = await witness(arg);
      console.log(banner + '\n' + '─'.repeat(60));
      if (!w) { console.log(`  witness @${arg} not found`); }
      else {
        console.log(`  @${w.owner}  v${w.runningVersion}`);
        console.log(`  url:          ${w.url}`);
        console.log(`  missed:       ${w.totalMissed}   last block: ${w.lastBlock}`);
        console.log(`  signing key:  ${w.signingKey}`);
        console.log(`  votes:        ${w.votes}`);
        console.log(`  fee/maxblock: ${w.props.accountCreationFee} / ${w.props.maxBlockSize}`);
      }
    } else if (cmd === 'block') {
      const b = await block(arg);
      console.log(banner + '\n' + '─'.repeat(60));
      if (!b) { console.log(`  block ${arg} not found`); }
      else {
        console.log(`  block ${b.num}  @${b.witness}  ${b.timestamp}  (${b.txCount} tx)`);
        for (const [op, n] of Object.entries(b.opCounts)) console.log(`    ${op.padEnd(28)} ${n}`);
      }
    } else {
      console.log('usage: chain-explorer.mjs [chain | account <name> | witness <name> | block <num>]');
    }
  } catch (e) {
    console.log(banner);
    console.log(`  explorer unreachable: ${e.message}`);
    if (ON_MELEK) console.log('  (MELEK_RPC_URL is set but not responding — chain may not be live yet.)');
  }
}
