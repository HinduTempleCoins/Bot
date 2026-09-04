// hive-engine-bridge-daemon.mjs — the LIVE Hive-Engine <-> PRANA bridge relayer (both legs, one process).
//
// THE JOB (make the wrapped-asset bridge live):
//   DEPOSIT leg  (Hive-Engine -> PRANA mint):  a holder transfers a bridged Hive-Engine token
//     (VKBT / CURE) to the custody @account (kula-bridge) with their 0x PRANA address in the MEMO.
//     This daemon reads those deposits (hive-engine-bridge-watcher.mjs), and — holding the bot's
//     3-of-5 PRANA validator keys — submits attestDeposit(...) with EACH of its 3 keys. Three
//     distinct attestations reach the bridge's 3-of-5 threshold and it mints wVKBT/wCURE to the memo
//     address. (wMELEK has NO Hive-Engine source token — see the note below — so it is not bridged
//     on this leg.)
//   RELEASE leg  (PRANA burn -> Hive-Engine release): a holder burns wVKBT/wCURE on PRANA
//     (GrapheneDepositBridge.withdraw -> GrapheneWithdrawal event, destinationRef = a HIVE @account).
//     This daemon reads those events (hive-engine-withdrawal-watcher.mjs) and — holding 3-of-5 of the
//     @kula-bridge HIVE active keys — signs ONE custom_json tokens.transfer with all 3 keys (weight
//     3 == threshold 3) and broadcasts it to release the real VKBT/CURE. Once per withdrawal nonce.
//
// KEY-CUSTODY BOUNDARY (BRIEF.md §7 / zero-WIF-in-repo): the pure watcher/derivation modules hold NO
// keys and SIGN nothing. Keys live ONLY here, at the edge, loaded JIT from two credential JSON files
// whose PATHS come from env (systemd LoadCredentialEncrypted -> tmpfs on the box; never on disk in
// this repo, never logged). loadBridgeKeys() reads them into memory and the private material never
// leaves this process (no log line ever prints a WIF or an EVM private key — only derived addresses).
//
// MELEK note: there is no `MELEK` token on Hive-Engine (only VKBT + CURE, issuer @kalivankush). Native
// MELEK-chain deposits are a SEPARATE path (bridge-relayer-runner.mjs, native transfer, 3->18dp) with
// its own MELEK-chain custody account — NOT the HIVE @kula-bridge and NOT these HIVE keys. So this
// daemon bridges VKBT + CURE only; wMELEK stays deployed-but-unfed until that path is provisioned.
//
// House style: ethers + dhive appear ONLY at the edges (makeEvmSubmitters / makeHiveReleaser). The
// tick orchestration takes injected edges so it is fully offline-testable. Everything soft-fails.

import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  loadConfig as loadDepositConfig,
  buildAttestations,
} from './hive-engine-bridge-watcher.mjs';
import {
  loadConfig as loadReleaseConfig,
  deriveRelease,
  releaseOp,
} from './hive-engine-withdrawal-watcher.mjs';

// ---------------------------------------------------------------------------
// Config (env NAMES only; values resolved here at the edge)
// ---------------------------------------------------------------------------

/** Symbols this daemon bridges. VKBT/CURE are 8dp on Hive-Engine == 8dp wrappers (exact 1:1). */
export function bridgedSymbols(env = process.env) {
  return String(env.HE_BRIDGE_SYMBOLS || 'VKBT,CURE')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// JIT key loading (the ONLY place secrets are read; never logged)
// ---------------------------------------------------------------------------

/**
 * Load the bot's bridge signing keys from the two credential JSON files, JIT into memory.
 * Paths come from env (systemd creds dir on the box). Returns derived-address metadata plus the
 * raw private material for the edges; callers MUST never log the raw fields.
 *   validators file: { bot_signing_set: { shared:{address,privateKey}, bot:[{address,privateKey},...] } }
 *   hive signers file: { bot_side: { shared:{wif,pub}, bot:[{wif,pub},...] } }
 * @returns {{ok:boolean, evm:{address,privateKey}[], hive:{wif,pub}[], reason?:string}}
 */
export function loadBridgeKeys(env = process.env) {
  const vPath = env.BRIDGE_VALIDATORS_CRED
    || (env.CREDENTIALS_DIRECTORY ? `${env.CREDENTIALS_DIRECTORY}/validators.json` : '');
  const hPath = env.BRIDGE_HIVE_SIGNERS_CRED
    || (env.CREDENTIALS_DIRECTORY ? `${env.CREDENTIALS_DIRECTORY}/hive-signers.json` : '');
  if (!vPath || !hPath) return { ok: false, evm: [], hive: [], reason: 'no-credential-paths (BRIDGE_VALIDATORS_CRED / BRIDGE_HIVE_SIGNERS_CRED or CREDENTIALS_DIRECTORY)' };
  let evm = [], hive = [];
  try {
    const v = JSON.parse(readFileSync(vPath, 'utf8'));
    const bs = v.bot_signing_set || {};
    const evmItems = [bs.shared, ...(Array.isArray(bs.bot) ? bs.bot : [])].filter(Boolean);
    evm = evmItems.map((it) => ({
      address: it.address,
      privateKey: String(it.privateKey || it.priv || it.key || '').startsWith('0x')
        ? String(it.privateKey || it.priv || it.key)
        : '0x' + String(it.privateKey || it.priv || it.key || ''),
    })).filter((e) => /^0x[0-9a-fA-F]{64}$/.test(e.privateKey));
  } catch (e) { return { ok: false, evm: [], hive: [], reason: `validators-cred:${e.message}` }; }
  try {
    const h = JSON.parse(readFileSync(hPath, 'utf8'));
    const b = h.bot_side || {};
    const items = [b.shared, ...(Array.isArray(b.bot) ? b.bot : [])].filter(Boolean);
    hive = items.map((it) => ({ wif: it.wif, pub: it.pub })).filter((e) => e.wif);
  } catch (e) { return { ok: false, evm: [], hive: [], reason: `hive-cred:${e.message}` }; }
  if (!evm.length) return { ok: false, evm, hive, reason: 'no-evm-keys-in-validators-cred' };
  if (!hive.length) return { ok: false, evm, hive, reason: 'no-hive-keys-in-signers-cred' };
  return { ok: true, evm, hive };
}

// ---------------------------------------------------------------------------
// EDGE 1: PRANA attest submitters (ethers) — one per validator key
// ---------------------------------------------------------------------------

const BRIDGE_ABI = ['function attestDeposit(bytes32 depositRef, bytes32 tokenId, address recipient, uint256 amount)'];

/**
 * Build one ethers-backed submitter per EVM key. Each returns { address, submit(call) } where
 * submit broadcasts THIS key's attestDeposit. ethers is imported lazily so tests never need it.
 * @returns {Promise<{address:string, submit:(call)=>Promise<string>}[]>}
 */
export async function makeEvmSubmitters({ pranaRpc, bridgeAddress, evm }) {
  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(pranaRpc);
  return evm.map((k) => {
    const wallet = new ethers.Wallet(k.privateKey, provider);
    const bridge = new ethers.Contract(bridgeAddress, BRIDGE_ABI, wallet);
    return {
      address: wallet.address,
      submit: async (call) => {
        const [ref, tokenId, recipient, amount] = call.args;
        const tx = await bridge.attestDeposit(ref, tokenId, recipient, amount);
        await tx.wait();
        return tx.hash;
      },
    };
  });
}

// ---------------------------------------------------------------------------
// EDGE 2: HIVE custody releaser (dhive) — signs one op with all 3 keys, broadcasts once
// ---------------------------------------------------------------------------

/**
 * Build the HIVE release broadcaster: async (op) => trx. Signs the custom_json with ALL provided
 * active WIFs (the 3-of-5 threshold is met by 3 signatures of weight 1) and broadcasts once. dhive
 * is imported lazily. `op` is the tuple ['custom_json', {...}] from releaseOp().
 */
export async function makeHiveReleaser({ hiveRpc, wifs, chainId, addressPrefix }) {
  const { Client, PrivateKey } = await import('@hiveio/dhive');
  const client = new Client(hiveRpc, {
    ...(chainId ? { chainId } : {}),
    ...(addressPrefix ? { addressPrefix } : {}),
    timeout: 20000,
  });
  const keys = wifs.map((w) => PrivateKey.from(w));
  return async (op) => client.broadcast.sendOperations([op], keys);
}

// ---------------------------------------------------------------------------
// DEPOSIT tick — read Hive-Engine deposits, attest with each of the bot's keys
// ---------------------------------------------------------------------------

/**
 * One deposit pass. Reads attestable deposits (buildAttestations), and for each, submits with every
 * submitter that has not already submitted this (ref, address). Idempotent per (ref,address) via the
 * `seen` set; an on-chain "already attested / already processed" revert is treated as done (marked
 * seen, not retried). Soft-fail: any read/submit error is recorded, never thrown.
 * @param {object} deps { attestations:async()=>call[], submitters:[{address,submit}], seen:Set, log }
 */
export async function depositTick({ attestations, submitters, seen, log = () => {} }) {
  const out = { submitted: [], skipped: [], failed: [] };
  let calls = [];
  try { calls = await attestations(); } catch (e) { out.failed.push({ reason: `read:${e.message}` }); return out; }
  for (const call of Array.isArray(calls) ? calls : []) {
    const ref = call.args && call.args[0];
    if (!ref) { out.skipped.push({ reason: 'no-ref' }); continue; }
    for (const s of submitters) {
      const key = `${ref}:${s.address.toLowerCase()}`;
      if (seen.has(key)) { out.skipped.push({ ref, by: s.address, reason: 'already-submitted-this-instance' }); continue; }
      try {
        const hash = await s.submit(call);
        seen.add(key);
        out.submitted.push({ ref, by: s.address, hash, symbol: call.symbol });
        log(`attested ${call.symbol || ''} ref=${String(ref).slice(0, 14)} by ${s.address.slice(0, 10)} -> ${String(hash).slice(0, 14)}`);
      } catch (e) {
        const msg = String((e && (e.shortMessage || e.reason || e.message)) || e);
        if (/already|processed|attested|finaliz/i.test(msg)) {
          seen.add(key); // on-chain backstop already satisfied — stop retrying this pair
          out.skipped.push({ ref, by: s.address, reason: 'on-chain-already-done' });
        } else {
          out.failed.push({ ref, by: s.address, reason: msg.slice(0, 180) });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// RELEASE tick — read PRANA burns (confirmation-gated), release from HIVE custody once per nonce
// ---------------------------------------------------------------------------

/** Minimal JSON-RPC (POST) — used for the confirmation-gated eth_getLogs read on the release leg. */
async function ethRpc(fetchImpl, url, method, params) {
  const res = await fetchImpl(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j && j.error) throw new Error((j.error && j.error.message) || 'rpc-error');
  return j && j.result;
}

/**
 * Read confirmed GrapheneWithdrawal releases: only logs at least `confirmations` blocks behind head
 * (young-PoW reorg safety), decoded + resolved to release ops via the pure watcher. Soft-fails to [].
 * @returns {Promise<object[]>} releaseOp() tuples ({ op, nonce, symbol, amount, toAccount, memo })
 */
export async function fetchConfirmedReleases(wcfg, { fetch: fetchImpl = globalThis.fetch, confirmations = 12 } = {}) {
  if (!wcfg || !wcfg.pranaRpc || !wcfg.bridgeAddress) return [];
  try {
    const head = Number(BigInt(await ethRpc(fetchImpl, wcfg.pranaRpc, 'eth_blockNumber', [])));
    const toBlock = head - confirmations;
    if (toBlock <= 0) return [];
    const from = Math.max(0, toBlock - wcfg.lookbackBlocks);
    const logs = await ethRpc(fetchImpl, wcfg.pranaRpc, 'eth_getLogs', [{
      address: wcfg.bridgeAddress,
      topics: [wcfg.withdrawalTopic0],
      fromBlock: '0x' + from.toString(16),
      toBlock: '0x' + toBlock.toString(16),
    }]);
    const ops = [];
    const seen = new Set();
    for (const log of Array.isArray(logs) ? logs : []) {
      const rel = deriveRelease(log, wcfg);
      if (rel && !seen.has(rel.nonce)) { seen.add(rel.nonce); ops.push(releaseOp(rel, wcfg)); }
    }
    return ops;
  } catch { return []; }
}

/**
 * Has a release for `nonce` already been broadcast? Idempotency across restarts: scan the custody
 * account's Hive-Engine history for an outgoing transfer whose memo == `bridge-withdraw:<nonce>`.
 * Soft-fails to false (safe: a false negative only means the confirmation-gated re-broadcast is
 * attempted — the memo makes a double-release visible and the nonce set guards within a process).
 */
export async function alreadyReleased({ historyUrl, custody, symbol, nonce, fetch: fetchImpl = globalThis.fetch }) {
  try {
    const url = `${historyUrl}?account=${encodeURIComponent(custody)}&symbol=${encodeURIComponent(symbol)}&limit=200`;
    const res = await fetchImpl(url);
    if (!res || !res.ok) return false;
    const j = await res.json();
    const rows = Array.isArray(j) ? j : (Array.isArray(j && j.result) ? j.result : []);
    const marker = `bridge-withdraw:${nonce}`;
    return rows.some((r) => String(r.memo || '') === marker && String(r.from || '').toLowerCase() === String(custody).toLowerCase());
  } catch { return false; }
}

/**
 * One release pass. For each confirmed withdrawal not yet released (in-process nonce set AND on-chain
 * memo check), sign + broadcast the custody transfer once. Soft-fail.
 * @param {object} deps { releases:async()=>op[], broadcast:async(op)=>trx, released:Set, isReleased:async(op)=>bool, log }
 */
export async function releaseTick({ releases, broadcast, released, isReleased = async () => false, log = () => {} }) {
  const out = { released: [], skipped: [], failed: [] };
  let ops = [];
  try { ops = await releases(); } catch (e) { out.failed.push({ reason: `read:${e.message}` }); return out; }
  for (const rop of Array.isArray(ops) ? ops : []) {
    const nonce = rop.nonce;
    if (released.has(nonce)) { out.skipped.push({ nonce, reason: 'nonce-released-this-instance' }); continue; }
    let done = false;
    try { done = await isReleased(rop); } catch { done = false; }
    if (done) { released.add(nonce); out.skipped.push({ nonce, reason: 'on-chain-already-released' }); continue; }
    try {
      const trx = await broadcast(rop.op);
      released.add(nonce);
      out.released.push({ nonce, symbol: rop.symbol, amount: rop.amount, to: rop.toAccount, trx: (trx && (trx.id || trx.trx_id)) || trx });
      log(`released #${nonce} ${rop.amount} ${rop.symbol} -> @${rop.toAccount}`);
    } catch (e) {
      out.failed.push({ nonce, reason: String((e && e.message) || e).slice(0, 180) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Manifest / CLI
// ---------------------------------------------------------------------------

/** Config + key-presence manifest — booleans + derived addresses only, never a secret. */
export function daemonManifest(env = process.env) {
  const symbols = bridgedSymbols(env);
  const keys = loadBridgeKeys(env);
  let evmAddrs = [];
  if (keys.ok) evmAddrs = keys.evm.map((k) => k.address);
  return {
    role: 'Hive-Engine <-> PRANA bridge relayer (VKBT/CURE), 3-of-5 both legs, one process',
    symbols,
    deposit: { custody: env.HE_BRIDGE_CUSTODY || '', historyUrl: env.HE_HISTORY_URL || 'https://history.hive-engine.com/accountHistory' },
    prana: { rpc: env.PRANA_RPC_URL || '', bridge: env.GRAPHENE_BRIDGE_ADDRESS || '', confirmations: +(env.CONFIRMATIONS || 12) },
    release: { hiveRpc: env.HIVE_RPC || 'https://api.hive.blog', sscId: env.HE_SSC_ID || 'ssc-mainnet-hive' },
    keys: {
      loaded: keys.ok, reason: keys.reason,
      evmValidators: keys.ok ? keys.evm.length : 0,
      evmAddresses: evmAddrs,            // public addresses only (safe to print)
      hiveSigners: keys.ok ? keys.hive.length : 0,
      hivePubs: keys.ok ? keys.hive.map((h) => h.pub) : [],
    },
    boundary: 'private keys read JIT from cred files; NEVER logged; watchers stay zero-key',
  };
}

async function main() {
  const env = process.env;
  const symbols = bridgedSymbols(env);
  const { ethers } = await import('ethers');

  // symbol -> bytes32 tokenId (keccak256(symbol)), matching the on-chain registration.
  const tokenIds = {};
  for (const s of symbols) tokenIds[s] = ethers.id(s);
  const depEnv = { ...env, HE_BRIDGE_TOKEN_IDS: JSON.stringify(tokenIds) };

  const depCfg = loadDepositConfig(depEnv);
  const relCfg = loadReleaseConfig(depEnv);
  const confirmations = +(env.CONFIRMATIONS || 12);

  // Config is required to WATCH; keys are required only to SUBMIT. If the keys aren't mounted yet
  // (go-live gated), run in WATCH-ONLY mode: poll + derive + log what WOULD be attested/released,
  // but submit nothing. Dropping the encrypted creds + restarting flips it to live minting/release.
  if (!depCfg.custody || !depCfg.symbols.length) { process.stderr.write('[he-bridge] missing HE_BRIDGE_CUSTODY / symbols\n'); process.exit(1); }
  if (!env.PRANA_RPC_URL || !env.GRAPHENE_BRIDGE_ADDRESS) { process.stderr.write('[he-bridge] missing PRANA_RPC_URL / GRAPHENE_BRIDGE_ADDRESS\n'); process.exit(1); }

  const keys = loadBridgeKeys(env);
  const live = keys.ok;
  const submitters = live
    ? await makeEvmSubmitters({ pranaRpc: env.PRANA_RPC_URL, bridgeAddress: env.GRAPHENE_BRIDGE_ADDRESS, evm: keys.evm })
    : [];
  const releaser = live
    ? await makeHiveReleaser({ hiveRpc: env.HIVE_RPC || 'https://api.hive.blog', wifs: keys.hive.map((h) => h.wif) })
    : null;

  const depSeen = new Set();
  const relReleased = new Set();
  const historyUrl = depCfg.historyUrl;

  const depLog = (m) => process.stdout.write(`[he-bridge][deposit] ${m}\n`);
  const relLog = (m) => process.stdout.write(`[he-bridge][release] ${m}\n`);

  if (live) {
    process.stdout.write(`[he-bridge] LIVE. custody @${depCfg.custody} symbols=${symbols.join(',')} attesters=[${submitters.map((s) => s.address.slice(0, 10)).join(',')}] hiveSigners=${keys.hive.length} prana=${env.PRANA_RPC_URL} bridge=${env.GRAPHENE_BRIDGE_ADDRESS}\n`);
  } else {
    process.stdout.write(`[he-bridge] WATCH-ONLY (no keys mounted: ${keys.reason}). custody @${depCfg.custody} symbols=${symbols.join(',')} prana=${env.PRANA_RPC_URL} bridge=${env.GRAPHENE_BRIDGE_ADDRESS}. Observing @${depCfg.custody}; will NOT submit until creds are mounted.\n`);
  }

  const depTickMs = Math.max(10000, +(env.TICK_MS || 30000));
  const relTickMs = Math.max(15000, +(env.RELEASE_TICK_MS || 60000));

  const depositLoop = async () => {
    try {
      if (!live) { // watch-only: observe + log would-attest, submit nothing
        const calls = await buildAttestations(depCfg);
        if (calls.length) depLog(`WATCH-ONLY: ${calls.length} attestable deposit(s) observed on @${depCfg.custody} (would mint): ${calls.map((c) => `${c.symbol} ref=${String(c.args[0]).slice(0, 14)} -> ${c.args[2]}`).join('; ')}`);
        return;
      }
      const r = await depositTick({ attestations: () => buildAttestations(depCfg), submitters, seen: depSeen, log: depLog });
      if (r.failed.length) process.stderr.write(`[he-bridge][deposit] ${r.failed.length} failed this tick (retry): ${JSON.stringify(r.failed).slice(0, 300)}\n`);
    } catch (e) { process.stderr.write(`[he-bridge][deposit] tick error: ${e.message}\n`); }
  };
  const releaseLoop = async () => {
    try {
      if (!live) { // watch-only: observe + log would-release, broadcast nothing
        const ops = await fetchConfirmedReleases(relCfg, { confirmations });
        if (ops.length) relLog(`WATCH-ONLY: ${ops.length} confirmed withdrawal(s) observed on PRANA (would release): ${ops.map((o) => `#${o.nonce} ${o.amount} ${o.symbol} -> @${o.toAccount}`).join('; ')}`);
        return;
      }
      const r = await releaseTick({
        releases: () => fetchConfirmedReleases(relCfg, { confirmations }),
        broadcast: releaser,
        released: relReleased,
        isReleased: (rop) => alreadyReleased({ historyUrl, custody: depCfg.custody, symbol: rop.symbol, nonce: rop.nonce }),
        log: relLog,
      });
      if (r.failed.length) process.stderr.write(`[he-bridge][release] ${r.failed.length} failed this tick (retry): ${JSON.stringify(r.failed).slice(0, 300)}\n`);
    } catch (e) { process.stderr.write(`[he-bridge][release] tick error: ${e.message}\n`); }
  };

  await depositLoop(); await releaseLoop();
  setInterval(depositLoop, depTickMs);
  setInterval(releaseLoop, relTickMs);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check') || process.argv.includes('--manifest')) {
    process.stdout.write(JSON.stringify(daemonManifest(), null, 2) + '\n');
  } else {
    main();
  }
}
