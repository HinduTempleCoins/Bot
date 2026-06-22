#!/usr/bin/env node
/**
 * live-seed-mint.mjs — ACTIVATE the Seed Mint on the live MELEK testnet.
 *
 * Broadcasts the real `seeds.register` ops for the whole Kush Farm seed catalog (a fungible token for each
 * abundant strain, an NFT type for each scarce one), then a sample `seeds.mint` to a grower — all signed with
 * the public TESTNET init key supplied via env (NEVER hardcoded, NEVER a mainnet key). The already-running
 * engine (melek-engine.service) folds these L1 custom_json ops automatically, so afterwards
 * /contracts/seeds and /contracts/nft/balances are populated and the Seeds wallet page shows real holdings.
 *
 *   TESTNET_WIF=<public-testnet-init-key> \
 *   MELEK_ENGINE_RPC=http://127.0.0.1:8090 \
 *   MELEK_ENGINE_ID=mse-testnet-melek \
 *   TESTNET_ACCT=initminer \            # must equal the engine's seed minter (MELEK_ENGINE_ISSUER)
 *   ENGINE_API=http://127.0.0.1:8098 \  # the live engine read API, to verify after
 *   MINT_TO=initminer MINT_TOKEN_QTY=1000 MINT_NFT_QTY=5 \
 *   node engine/test/live-seed-mint.mjs
 *
 * The init WIF is the well-known public Steem-testnet key (in the testnet node's config.ini on the chain
 * host). It is a throwaway testnet key, never read from or written to this repo.
 */

import dhive from '@hiveio/dhive';
import { config } from '../config.mjs';
import { buildRegisterAllOps, buildMintOp } from '../../integrations/games/seed-mint.mjs';
import { seedCatalog } from '../../integrations/games/seed-tokens.mjs';

const WIF = process.env.TESTNET_WIF;
const ACCT = process.env.TESTNET_ACCT || 'initminer';
const ENGINE_API = process.env.ENGINE_API || `http://${config.apiHost}:${config.apiPort}`;
const MINT_TO = process.env.MINT_TO || ACCT;
const MINT_TOKEN_QTY = process.env.MINT_TOKEN_QTY || '1000';
const MINT_NFT_QTY = process.env.MINT_NFT_QTY || '5';
if (!WIF) { console.error('set TESTNET_WIF (public testnet init key) to activate the seed mint'); process.exit(1); }

const client = new dhive.Client(config.rpcNodes[0], { chainId: config.chainId, addressPrefix: config.addressPrefix, timeout: 8000 });
const key = dhive.PrivateKey.fromString(WIF);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (u) => { try { const r = await fetch(u); return r.ok ? r.json() : null; } catch { return null; } };

async function send(op, label) {
  try {
    const r = await client.broadcast.sendOperations([op], key);
    console.log(`  ✓ ${label} → ${r.id} @blk ${r.block_num}`);
  } catch (e) {
    console.log(`  ✗ ${label} FAILED: ${e.message}`);
  }
}

async function main() {
  console.log(`Activating Seed Mint as @${ACCT} via ${config.rpcNodes[0]} (id ${config.sidechainId})`);

  // 1) register every seed (one op each; spaced so they spread across L1 blocks under the free-tx allowance)
  const regs = buildRegisterAllOps(ACCT);
  console.log(`\nregistering ${regs.length} seeds…`);
  for (const r of regs) { await send(r.op, r.summary); await wait(1500); }

  // 2) a sample mint of one fungible seed + one NFT seed, to a grower
  const cat = seedCatalog();
  const tokenSeed = cat.find((s) => s.kind === 'token');
  const nftSeed = cat.find((s) => s.kind === 'nft');
  console.log(`\nminting samples to @${MINT_TO}…`);
  if (tokenSeed) { const m = buildMintOp(ACCT, { to: MINT_TO, symbol: tokenSeed.symbol, quantity: MINT_TOKEN_QTY }); if (m.ok) await send(m.op, m.summary); await wait(1500); }
  if (nftSeed) { const m = buildMintOp(ACCT, { to: MINT_TO, symbol: nftSeed.symbol, quantity: MINT_NFT_QTY }); if (m.ok) await send(m.op, m.summary); await wait(1500); }

  // 3) let the live engine fold the blocks, then verify via its read API
  console.log('\nwaiting for the engine to fold the blocks…');
  await wait(12000);
  const registered = (await getJson(`${ENGINE_API}/contracts/seeds`)) || [];
  const nftBal = (await getJson(`${ENGINE_API}/contracts/nft/balances?account=${encodeURIComponent(MINT_TO)}`)) || [];
  const tokenBal = (await getJson(`${ENGINE_API}/contracts/balances?account=${encodeURIComponent(MINT_TO)}`)) || [];
  console.log('\n--- RESULT (live engine) ---');
  console.log(`seeds registered: ${registered.length} (${registered.map((r) => `${r.symbol}:${r.kind}`).join(', ')})`);
  console.log(`@${MINT_TO} NFT seeds:`, nftBal.map((b) => `${b.tokenId}×${b.count}`).join(', ') || 'none');
  console.log(`@${MINT_TO} token seeds:`, tokenBal.filter((b) => cat.some((s) => s.symbol === b.symbol)).map((b) => `${b.symbol}×${b.balance}`).join(', ') || 'none');
  const ok = registered.length >= cat.length;
  console.log(ok ? '\n✓ Seed Mint active — seeds registered on the live engine' : '\n… not all seeds visible yet (engine may still be folding; re-check the API)');
  process.exit(ok ? 0 : 2);
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
