// melek-chain.mjs — read-only reader for the MELEK chain (testnet today, mainnet later).
// This is how the bots (Discord, Telegram, trollbox) surface Hathor's witness role: head block,
// witness status, accounts, the price feed — chain legibility, which is in-scope per BRIEF.md §6.
//
// DESIGN RULES:
//   • READ-ONLY. No keys, no broadcast, ever. Standard condenser_api calls only.
//   • Env-gated: MELEK_RPC_URL names the endpoint (same convention as native-node.mjs /
//     bringup-check.mjs). Unset → every reader soft-fails to null; nothing fake, nothing thrown.
//   • NETWORK IS A FIRST-CLASS FIELD. MELEK_NETWORK=testnet|mainnet (default testnet). Every
//     payload carries `network` + `label`; testnet output is labeled "[TestNet not MELEK]" —
//     the testnet stays connected alongside mainnet forever, never deprecated (operator rule
//     2026-06-06). The label travels IN the message so the distinction is made everywhere.
//   • Injectable fetch (__setFetch) so all tests run offline.
//
// Exports:
//   networkLabel() -> '[TestNet not MELEK]' | '[MELEK]'
//   configured()   -> boolean (MELEK_RPC_URL set?)
//   headBlock()        -> { num, time, witness, network, label } | null
//   witnessInfo(name)  -> { owner, url, signingKey, missed, lastConfirmedBlock, feed, network, label } | null
//   accountInfo(name)  -> { name, created, postCount, balances, network, label } | null
//   hathorStatus()     -> combined witness + head-block view for the `hathor` account | null
//   __setFetch(fn)     -> inject fetch for tests

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export const ACCOUNT = 'hathor'; // the Witness's on-chain account (BRIEF.md §1)

export function rpcUrl() { return process.env.MELEK_RPC_URL || ''; }
export function configured() { return !!rpcUrl(); }

/** testnet | mainnet — from env, defaulting to testnet (the live network today). */
export function network() {
  const n = String(process.env.MELEK_NETWORK || 'testnet').toLowerCase();
  return n === 'mainnet' ? 'mainnet' : 'testnet';
}

/** The permanent network label carried in every chain-tied message. */
export function networkLabel() {
  return network() === 'mainnet' ? '[MELEK]' : '[TestNet not MELEK]';
}

async function rpc(method, params = [], timeout = 12000) {
  const url = rpcUrl();
  if (!url) return null;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await _fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.error) return null;
    return d.result;
  } catch { return null; } finally { clearTimeout(t); }
}

const stamp = () => ({ network: network(), label: networkLabel() });

/** Head-block view: number, time, current producer. null when unreachable/unconfigured. */
export async function headBlock() {
  const g = await rpc('condenser_api.get_dynamic_global_properties', []);
  if (!g || g.head_block_number == null) return null;
  return {
    num: +g.head_block_number,
    time: g.time || null,
    witness: g.current_witness || null,
    ...stamp(),
  };
}

/** Witness record for an account (default hathor). Signing key is PUBLIC chain data. */
export async function witnessInfo(name = ACCOUNT) {
  const w = await rpc('condenser_api.get_witness_by_account', [String(name || ACCOUNT)]);
  if (!w || !w.owner) return null;
  const feed = w.sbd_exchange_rate || null;
  return {
    owner: w.owner,
    url: w.url || '',
    signingKey: w.signing_key || '',
    missed: +(w.total_missed || 0),
    lastConfirmedBlock: +(w.last_confirmed_block_num || 0),
    feed: feed ? { base: feed.base, quote: feed.quote } : null,
    lastFeedUpdate: w.last_sbd_exchange_update || null,
    ...stamp(),
  };
}

/** Account view: public profile-level facts only. */
export async function accountInfo(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  const res = await rpc('condenser_api.get_accounts', [[n]]);
  const a = Array.isArray(res) ? res[0] : null;
  if (!a || !a.name) return null;
  return {
    name: a.name,
    created: a.created || null,
    postCount: +(a.post_count || 0),
    balances: {
      liquid: a.balance || null,      // TESTS on testnet, MELEK on mainnet
      stable: a.sbd_balance || null,  // TBD on testnet, MBD on mainnet
      vesting: a.vesting_shares || null,
    },
    ...stamp(),
  };
}

/** Combined live view of the Witness: head block + hathor's witness record. */
export async function hathorStatus() {
  const [head, w] = await Promise.all([headBlock(), witnessInfo(ACCOUNT)]);
  if (!head && !w) return null;
  const behind = head && w ? Math.max(0, head.num - w.lastConfirmedBlock) : null;
  return {
    account: ACCOUNT,
    head,
    witness: w,
    producing: behind != null ? behind < 100 : null, // within ~5 min of head → actively confirming
    blocksBehindHead: behind,
    ...stamp(),
  };
}

// CLI: node integrations/melek-chain.mjs [hathor|block|witness <name>|account <name>]
if (process.argv[1] && process.argv[1].endsWith('melek-chain.mjs')) {
  const [verb = 'hathor', arg] = process.argv.slice(2);
  const out = verb === 'block' ? await headBlock()
    : verb === 'witness' ? await witnessInfo(arg)
    : verb === 'account' ? await accountInfo(arg)
    : await hathorStatus();
  console.log(JSON.stringify(out, null, 2));
}
