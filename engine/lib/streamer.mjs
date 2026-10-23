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

// Transient-failure resilience for the RPC layer (catch-up streams thousands of get_block calls).
const RPC_RETRIES = Number(process.env.MELEK_ENGINE_RPC_RETRIES || 4);
const RPC_BACKOFF_MS = Number(process.env.MELEK_ENGINE_RPC_BACKOFF_MS || 200);
const STREAM_DELAY_MS = Number(process.env.MELEK_ENGINE_STREAM_DELAY_MS || 8);
// Catch-up batch size. One JSON-RPC ARRAY request fetches this many blocks per round trip.
// Measured against the mainnet node 2026-09-03: a single `condenser_api.get_block` costs ~430ms,
// almost all of it fixed per-request overhead, so 100 blocks cost 0.65s batched instead of 43s
// one-at-a-time — a 65x speedup, and the difference between a 1.7-hour and a 4.5-DAY first sync.
// This fork has no `block_api.get_block_range`, so the array form is the only batch path available.
const BATCH_SIZE = Math.max(1, Number(process.env.MELEK_ENGINE_BATCH || 100));

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

/**
 * Try each node in the failover array until one answers; retry the whole set a few times with
 * exponential backoff before giving up. Catch-up (streamRange) calls this once per block in a tight
 * loop over thousands of blocks, so a single transient `fetch failed` must NOT be fatal — without
 * the retry the node crashed mid-catch-up on any RPC blip.
 */
async function rpcFailover(method, params, { retries = RPC_RETRIES } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    for (const node of config.rpcNodes) {
      try {
        return await rpc(node, method, params);
      } catch (e) {
        lastErr = e;
      }
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, RPC_BACKOFF_MS * 2 ** attempt));
  }
  throw new Error(`all RPC nodes failed for ${method} after ${retries + 1} attempts: ${lastErr?.message}`);
}

/** One JSON-RPC ARRAY request. Returns the raw response array (unordered — callers key by id). */
async function rpcBatch(node, calls) {
  const res = await fetch(node, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(calls),
  });
  if (!res.ok) throw new Error(`${node} HTTP ${res.status}`);
  const j = await res.json();
  if (!Array.isArray(j)) throw new Error(`batch: expected an array, got ${typeof j}`);
  return j;
}

/**
 * Fetch blocks `from`..`from+count-1` in ONE round trip, with the same failover and retry
 * discipline as rpcFailover. Returns an array of length `count` POSITIONALLY ALIGNED to the
 * requested block numbers — `null` where the chain does not have that block yet.
 *
 * The response is keyed back by JSON-RPC `id` (set to the block number) rather than by position,
 * because a batch response is not required to preserve request order.
 */
export async function getBlocks(from, count) {
  const calls = [];
  for (let i = 0; i < count; i++) {
    calls.push({ jsonrpc: '2.0', id: from + i, method: 'condenser_api.get_block', params: [from + i] });
  }
  let lastErr;
  for (let attempt = 0; attempt <= RPC_RETRIES; attempt++) {
    for (const node of config.rpcNodes) {
      try {
        const rows = await rpcBatch(node, calls);
        const byNum = new Map();
        for (const r of rows) {
          // A per-entry error is a failed batch, not a missing block: retry the whole window
          // rather than silently folding a hole into deterministic state.
          if (r && r.error) throw new Error(`batch entry ${r.id}: ${JSON.stringify(r.error)}`);
          if (r && typeof r.id === 'number') byNum.set(r.id, r.result ?? null);
        }
        const out = [];
        for (let i = 0; i < count; i++) out.push(byNum.has(from + i) ? byNum.get(from + i) : null);
        return out;
      } catch (e) {
        lastErr = e;
      }
    }
    if (attempt < RPC_RETRIES) await new Promise((r) => setTimeout(r, RPC_BACKOFF_MS * 2 ** attempt));
  }
  throw new Error(`all RPC nodes failed for batch ${from}..${from + count - 1}: ${lastErr?.message}`);
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
 * Extract L1 SOCIAL ops (comment + vote) from a block — the feed for the SCOT/rewards layer.
 * Returns [{ kind:'comment', author, permlink, tags, ... } | { kind:'vote', voter, author, permlink, ... }].
 * Tags come from a comment's json_metadata.tags plus its parent_permlink (the Hive category convention).
 */
export function extractSocialOps(block, blockNum) {
  const out = [];
  const blockId = block.block_id;
  const txs = block.transactions || [];
  for (let ti = 0; ti < txs.length; ti++) {
    const tx = txs[ti];
    const txId = (block.transaction_ids && block.transaction_ids[ti]) || `${blockNum}-${ti}`;
    for (const operation of tx.operations || []) {
      const [opName, v] = operation;
      if (opName === 'comment' && v && v.author && v.permlink) {
        let tags = [];
        try { const m = JSON.parse(v.json_metadata || '{}'); if (Array.isArray(m.tags)) tags = m.tags; } catch { /* none */ }
        if (v.parent_permlink) tags = [v.parent_permlink, ...tags]; // category is the first tag on Hive
        out.push({ kind: 'comment', author: v.author, permlink: v.permlink, tags, txId, blockNum, blockId });
      } else if (opName === 'vote' && v && v.voter && v.author && v.permlink) {
        out.push({ kind: 'vote', voter: v.voter, author: v.author, permlink: v.permlink, txId, blockNum, blockId });
      }
    }
  }
  return out;
}

/**
 * Stream blocks from `fromBlock`..`toBlock` (inclusive) into `engine`.
 * Returns the number of L1 blocks processed.
 */
function foldBlock(engine, block, n, onBlock) {
  const ops = extractOps(block, n);
  for (const op of ops) engine.process(op);
  // SCOT/rewards: fold L1 social ops (comments → post tags, votes → tribe-weighted reward votes),
  // then crank matured payouts. Guarded so an engine without these methods (older) still streams.
  if (typeof engine.processSocial === 'function') {
    for (const s of extractSocialOps(block, n)) engine.processSocial(s);
    if (typeof engine.crankPayouts === 'function') engine.crankPayouts({ blockNum: n, blockId: block.block_id, txId: `${n}-crank` });
    if (typeof engine.crankWorkerbee === 'function') engine.crankWorkerbee({ blockNum: n, blockId: block.block_id, txId: `${n}-wb` });
  }
  const hash = engine.commitBlock(n, block.block_id, true);
  if (onBlock) onBlock(n, ops.length, hash);
}

export async function streamRange(engine, fromBlock, toBlock, { onBlock, batchSize = BATCH_SIZE } = {}) {
  let processed = 0;
  let n = fromBlock;

  while (n <= toBlock) {
    const count = Math.min(batchSize, toBlock - n + 1);

    let blocks;
    if (count === 1) {
      blocks = [await rpcFailover('condenser_api.get_block', [n])];
    } else {
      try {
        blocks = await getBlocks(n, count);
      } catch {
        // A node that refuses the batch (unsupported, too large, transient) must not stall the
        // catch-up. Drop to one block for this step and continue; the next iteration retries a batch.
        blocks = [await rpcFailover('condenser_api.get_block', [n])];
      }
    }
    if (!blocks.length) break; // defensive: never spin on an empty window

    let halted = false;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      // L1 doesn't have this block yet — liveness halt, not a state event. Everything before it in
      // the window is already folded and committed, so resuming picks up exactly here.
      if (!block) { halted = true; break; }
      foldBlock(engine, block, n + i, onBlock);
      processed++;
    }
    if (halted) break;

    n += blocks.length;
    // Pace the catch-up: back-to-back requests exhaust local sockets (sustained `fetch failed` the
    // retry can't ride out). The delay is now PER BATCH rather than per block, so a 100-block window
    // pays it once; real-time follow (one block / 3s) is unaffected.
    if (STREAM_DELAY_MS > 0 && n <= toBlock) await new Promise((r) => setTimeout(r, STREAM_DELAY_MS));
  }
  return processed;
}
