/**
 * streamer.mjs — follow the MELEK L1, extract sidechain ops, feed the engine.
 *
 * Security study §6 A: stream from a FAILOVER ARRAY of MELEK nodes (item 3);
 * pin the L1 chain_id and refuse a fork (item 2/3); never fabricate sidechain
 * blocks while L1 is unreachable — halt safely and resume (§6 G item 18).
 *
 * A sidechain block is produced only when an L1 block carries parseable ops
 * (HE pattern). We walk L1 blocks in order from state.meta.lastBlock+1, and for
 * each L1 block extract every `custom_json` whose id === config.sidechainId,
 * deriving the signer strictly from the op's auth arrays.
 */

import { config } from '../config.mjs';

async function rpc(node, method, params) {
  const res = await fetch(node, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${node} HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

/** Try each node in the failover array until one answers. */
async function rpcFailover(method, params) {
  let lastErr;
  for (const node of config.rpcNodes) {
    try {
      return await rpc(node, method, params);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`all RPC nodes failed for ${method}: ${lastErr?.message}`);
}

/** Verify we are pointed at the pinned chain (anti-fork, item 2/3). */
export async function verifyChain() {
  const v = await rpcFailover('database_api.get_version', {});
  if (v.chain_id !== config.chainId) {
    throw new Error(`chain_id mismatch: got ${v.chain_id}, expected ${config.chainId} — refusing to replay`);
  }
  return v;
}

export async function headBlock() {
  const dgp = await rpcFailover('condenser_api.get_dynamic_global_properties', []);
  return dgp.head_block_number;
}

/**
 * Extract sidechain ops from one L1 block object.
 * Returns [{ sender, authLevel, json, txId, blockNum, blockId }].
 */
export function extractOps(block, blockNum) {
  const ops = [];
  const blockId = block.block_id;
  const txs = block.transactions || [];
  for (let ti = 0; ti < txs.length; ti++) {
    const tx = txs[ti];
    const txId = (block.transaction_ids && block.transaction_ids[ti]) || `${blockNum}-${ti}`;
    for (const operation of tx.operations || []) {
      const [opName, opVal] = operation;
      if (opName !== 'custom_json') continue;
      if (opVal.id !== config.sidechainId) continue;
      // signer strictly from auth arrays (§6 A item 1).
      // On this Steem/Graphene fork the active auth on custom_json is carried
      // in `required_auths`; newer Hive uses `required_active_auths`. Accept
      // both. Posting auth is always `required_posting_auths`.
      const activeAuths = opVal.required_active_auths || opVal.required_auths || [];
      const postingAuths = opVal.required_posting_auths || [];
      let sender, authLevel;
      if (activeAuths.length) {
        sender = activeAuths[0];
        authLevel = 'active';
      } else if (postingAuths.length) {
        sender = postingAuths[0];
        authLevel = 'posting';
      } else {
        continue; // no auth -> ignore
      }
      ops.push({ sender, authLevel, json: opVal.json, txId, blockNum, blockId });
    }
  }
  return ops;
}

/**
 * Stream blocks from `fromBlock`..`toBlock` (inclusive) into `engine`.
 * Returns the number of L1 blocks processed.
 */
export async function streamRange(engine, fromBlock, toBlock, { onBlock } = {}) {
  let processed = 0;
  for (let n = fromBlock; n <= toBlock; n++) {
    const block = await rpcFailover('condenser_api.get_block', [n]);
    if (!block) {
      // L1 doesn't have this block yet — liveness halt, not state event.
      break;
    }
    const ops = extractOps(block, n);
    for (const op of ops) engine.process(op);
    const hash = engine.commitBlock(n, block.block_id, true);
    if (onBlock) onBlock(n, ops.length, hash);
    processed++;
  }
  return processed;
}
