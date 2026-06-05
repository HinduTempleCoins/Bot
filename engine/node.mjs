#!/usr/bin/env node
/**
 * node.mjs — the Melek-Engine sidechain node.
 *
 * Boots state, bootstraps genesis tokens, verifies it's pointed at the pinned
 * MELEK L1 chain, replays from the last processed block to the head, then polls
 * for new blocks. Serves the read API + UI alongside.
 *
 * Liveness rule (§6 G item 18): if L1 is unreachable, log + retry; NEVER
 * fabricate sidechain blocks. State only advances on real L1 blocks.
 *
 * Usage:
 *   node engine/node.mjs            # stream + serve (default)
 *   node engine/node.mjs --once     # one catch-up pass, no poll loop
 *   node engine/node.mjs --serve    # API/UI only, no streaming
 */

import { State } from './lib/state.mjs';
import { Engine } from './lib/engine.mjs';
import { bootstrapGenesis } from './lib/genesis.mjs';
import { verifyChain, headBlock, streamRange } from './lib/streamer.mjs';
import { startServer } from './api/server.mjs';
import { config } from './config.mjs';

const args = new Set(process.argv.slice(2));
const ONCE = args.has('--once');
const SERVE_ONLY = args.has('--serve');

async function main() {
  const state = new State(config.stateFile);
  const created = bootstrapGenesis(state);
  if (created) {
    state.persist();
    console.log('[engine] genesis tokens created:', config.stateFile);
  }
  const engine = new Engine(state);

  if (!SERVE_ONLY) {
    startServer(state);
  } else {
    startServer(state);
    return; // serve-only: no streaming
  }

  // verify chain pin before streaming
  try {
    const v = await verifyChain();
    console.log(`[engine] anchored to MELEK L1 ${v.chain_id.slice(0, 16)}… v${v.blockchain_version}`);
  } catch (e) {
    console.error('[engine] chain verify failed:', e.message);
    if (ONCE) process.exit(1);
  }

  const catchUp = async () => {
    let head;
    try {
      head = await headBlock();
    } catch (e) {
      console.warn('[engine] L1 unreachable, will retry:', e.message);
      return;
    }
    const from = Math.max(state.meta.lastBlock + 1, config.startBlock);
    if (from > head) return;
    const n = await streamRange(engine, from, head, {
      onBlock: (blk, opCount, hash) => {
        if (opCount > 0) console.log(`[engine] block ${blk}: ${opCount} op(s) · state ${hash.slice(0, 12)}…`);
      },
    });
    if (n > 0) console.log(`[engine] caught up to ${state.meta.lastBlock} (head ${head})`);
  };

  await catchUp();
  if (ONCE) {
    console.log('[engine] --once done, lastBlock', state.meta.lastBlock);
    return;
  }

  // poll loop (~3s blocks on this Graphene fork)
  setInterval(() => {
    catchUp().catch((e) => console.warn('[engine] catchUp error:', e.message));
  }, 3000);
  console.log('[engine] streaming MELEK L1 every 3s…');
}

main().catch((e) => {
  console.error('[engine] fatal:', e);
  process.exit(1);
});
