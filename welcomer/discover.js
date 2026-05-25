/**
 * welcomer/discover.js — find new accounts by scanning chain blocks.
 *
 * Pure-ish: takes a dhive Client (or any object with the same
 * `database.getDynamicGlobalProperties()` / `database.getBlock(num)`
 * shape), produces lists of new-account events. Doesn't persist anything
 * — that's the orchestrator's job.
 *
 * Why block-scanning rather than account_history of the creator? On
 * Graphene chains, account_create_with_delegation can be signed by any
 * account, not just hathor. Watching only hathor's history misses
 * accounts created by other onboarders. Block-scanning is exhaustive.
 *
 * Cost: one RPC call per block. At MELEK's 4s block time, that's 21,600
 * blocks/day. Most won't contain account_create ops. If this becomes a
 * load problem, a future optimization is to use a streaming API or to
 * batch multiple blocks per RPC call where supported.
 */

const ACCOUNT_CREATE_OPS = new Set([
  'account_create',
  'account_create_with_delegation',
]);

/**
 * Head block number, from dynamic global properties.
 */
export async function getHeadBlockNumber(client) {
  const props = await client.database.getDynamicGlobalProperties();
  return props.head_block_number;
}

/**
 * Scan a single block for account-creation operations.
 *
 * @returns {Promise<Array<{account: string, creator: string, block: number, timestamp: string}>>}
 */
export async function scanBlock(client, blockNum) {
  const block = await client.database.getBlock(blockNum);
  if (!block) return [];
  const found = [];
  for (const tx of block.transactions || []) {
    for (const op of tx.operations || []) {
      const [opName, opVal] = op;
      if (ACCOUNT_CREATE_OPS.has(opName) && opVal?.new_account_name) {
        found.push({
          account: opVal.new_account_name,
          creator: opVal.creator || null,
          block: blockNum,
          timestamp: block.timestamp,
        });
      }
    }
  }
  return found;
}

/**
 * Scan an inclusive block range, returning all account-creation events.
 * Sequential — if you need throughput, batch externally or call scanBlock
 * in parallel with a small concurrency cap.
 */
export async function scanBlockRange(client, fromBlock, toBlock) {
  const all = [];
  for (let b = fromBlock; b <= toBlock; b++) {
    const found = await scanBlock(client, b);
    if (found.length) all.push(...found);
  }
  return all;
}
