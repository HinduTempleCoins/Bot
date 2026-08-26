// arcade-keeper-run.mjs — the box runner that drives the KULA Arcade play-token contracts on PRANA (testnet).
//
// It reads the on-chain lifecycle state of KulaLotto + BinaryEventMarket, plans the due actions with the pure
// planner (arcade-keeper.mjs), and broadcasts them via an EVM signer seam. It manages the KulaLotto
// commit-reveal salt across passes in a local JSON store (the salt is generated at close, kept secret, and
// revealed at draw a couple of blocks later). Idempotent + soft-fail: a failed tx leaves that round/market for
// the next pass; missing keys/deps print a plan and exit without broadcasting.
//
// COMPLIANCE: testnet PLAY-token arcade only. Never real money. Never auto-resolves a DISPUTED market. Never
// proposes a market outcome without a confident named source (the resolver is injected; default = none →
// markets are held for a human). See .local/RESEARCH_PREDICTION_MARKETS_BETTING.md §5/§6.
//
// SIGNING: PRANA arcade calls are EVM transactions. This runner signs them through MELEK-Signer's EVM path
// (POST {SIGNER_URL}/v1/evm/sign with a scoped bearer token) — NOT with a local WIF/private key (zero key
// material in this repo, per BRIEF §7). NOTE: mainnet MELEK-Signer currently returns 501 on /v1/evm/sign
// (EVM signing not yet enabled — see the auto-system-signer memory); until that's live, run with --dry (plan
// only) or point at a testnet signer that has EVM enabled.
//
//   # one pass (for a systemd timer), live:
//   ARCADE_SIGNER_URL=… ARCADE_SIGNER_TOKEN=… ARCADE_RPC_URL=… \
//   ARCADE_LOTTO_ADDR=0x… ARCADE_MARKET_ADDR=0x… node integrations/arcade/arcade-keeper-run.mjs --once
//   # plan only, no chain writes, no key needed:
//   ARCADE_RPC_URL=… ARCADE_LOTTO_ADDR=0x… node integrations/arcade/arcade-keeper-run.mjs --once --dry
//   # scratch store file:  --store=/tmp/arcade.json

import { runKeeper } from './arcade-keeper.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };

const DRY = flag('dry');
const STORE_FILE = opt('store', process.env.ARCADE_STORE_FILE || './data/arcade-keeper.json');
const RPC = process.env.ARCADE_RPC_URL || '';
const SIGNER_URL = process.env.ARCADE_SIGNER_URL || '';
const SIGNER_TOKEN = process.env.ARCADE_SIGNER_TOKEN || '';
const LOTTO_ADDR = process.env.ARCADE_LOTTO_ADDR || '';
const MARKET_ADDR = process.env.ARCADE_MARKET_ADDR || '';
const CHAIN_ID = Number(process.env.ARCADE_CHAIN_ID || 712217); // PRANA mainnet 712217 / testnet 108369

function log(...a) { console.log(`[${new Date().toISOString()}]`, ...a); }

// ---- tiny file-backed store (get/set/all) -------------------------------------------------------------- //
function makeStore(file) {
  let data = {};
  try { if (existsSync(file)) data = JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { data = {}; }
  const persist = () => { try { writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) { console.error(`store write soft-failed: ${e?.message || e}`); } };
  return {
    get: (k) => data[k],
    set: (k, v) => { if (v === undefined) delete data[k]; else data[k] = v; persist(); },
    all: () => data,
  };
}

// keccak256(abi.encodePacked(salt)) — salt is a 32-byte value. Lazy ethers import keeps the module dep-free
// and offline-testable; the pure planner + orchestrator need no crypto lib at all.
async function loadHash() {
  let ethers;
  try { ({ ethers } = await import('ethers')); } catch { try { ethers = (await import('ethers')).default; } catch { ethers = null; } }
  if (!ethers) return null;
  return (hexSalt) => ethers.keccak256(hexSalt);
}

// The EVM seam. Reads via JSON-RPC eth_call; writes via MELEK-Signer /v1/evm/sign. Kept thin; if ethers or the
// signer isn't available it soft-fails so --dry still works.
async function makeAdapter() {
  let ethers = null;
  try { ({ ethers } = await import('ethers')); } catch { try { ethers = (await import('ethers')).default; } catch { ethers = null; } }
  if (!ethers) { log('ethers not installed — read/write disabled; use --dry with a hand-supplied snapshot'); return null; }

  const provider = RPC ? new ethers.JsonRpcProvider(RPC, CHAIN_ID) : null;
  const lottoAbi = [
    'function roundCount() view returns (uint256)',
    'function rounds(uint256) view returns (uint256 ticketPrice,uint16 prizeBps,uint16 treasuryBps,uint16 burnBps,uint256 ticketCount,uint256 prizePool,bool closed,bool drawn,uint256 commitBlock,bytes32 saltHash,address winner)',
    'function openRound(uint256 ticketPrice,uint16 prizeBps,uint16 treasuryBps,uint16 burnBps) returns (uint256)',
    'function closeRound(uint256 roundId,bytes32 saltHash)',
    'function drawRound(uint256 roundId,bytes32 salt)',
    'function reArmDraw(uint256 roundId,bytes32 saltHash)',
  ];
  const marketAbi = [
    'function marketCount() view returns (uint256)',
    'function getMarket(uint256) view returns (tuple(uint256 yesPool,uint256 noPool,uint64 closeTime,uint64 disputeWindow,uint16 feeBps,uint256 disputeBond,uint8 phase,uint8 proposed,uint8 outcome,uint64 proposedAt,address disputer))',
    'function proposeOutcome(uint256 marketId,uint8 outcome)',
    'function finalize(uint256 marketId)',
  ];
  const iLotto = new ethers.Interface(lottoAbi);
  const iMarket = new ethers.Interface(marketAbi);

  // Sign+broadcast one EVM call through MELEK-Signer. Returns the tx hash. Soft-throws (caught per-action).
  async function send(to, iface, fn, params) {
    if (!SIGNER_URL || !SIGNER_TOKEN) throw new Error('no ARCADE_SIGNER_URL / ARCADE_SIGNER_TOKEN (EVM signing unavailable)');
    const data = iface.encodeFunctionData(fn, params);
    const nonce = await provider.getTransactionCount(process.env.ARCADE_KEEPER_ADDR || '', 'pending').catch(() => undefined);
    const res = await fetch(`${SIGNER_URL.replace(/\/$/, '')}/v1/evm/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${SIGNER_TOKEN}` },
      body: JSON.stringify({ chainId: CHAIN_ID, to, data, nonce }),
    });
    if (!res.ok) throw new Error(`signer ${res.status} ${await res.text().catch(() => '')}`.slice(0, 200));
    const { rawTransaction, signed } = await res.json();
    const raw = rawTransaction || signed;
    if (!raw) throw new Error('signer returned no rawTransaction');
    const sent = await provider.broadcastTransaction(raw);
    return sent.hash;
  }

  return {
    async readLotto() {
      if (!provider || !LOTTO_ADDR) return { rounds: [], block: 0 };
      const block = await provider.getBlockNumber();
      const c = new ethers.Contract(LOTTO_ADDR, lottoAbi, provider);
      const n = Number(await c.roundCount());
      const rounds = [];
      for (let i = 0; i < n; i++) {
        const r = await c.rounds(i);
        rounds.push({ roundId: i, ticketCount: Number(r.ticketCount), closed: r.closed, drawn: r.drawn, commitBlock: Number(r.commitBlock) });
      }
      return { rounds, block };
    },
    async readMarkets() {
      if (!provider || !MARKET_ADDR) return [];
      const c = new ethers.Contract(MARKET_ADDR, marketAbi, provider);
      const n = Number(await c.marketCount());
      const list = [];
      for (let i = 0; i < n; i++) {
        const m = await c.getMarket(i);
        list.push({ marketId: i, phase: Number(m.phase), closeTime: Number(m.closeTime), disputeWindow: Number(m.disputeWindow), proposedAt: Number(m.proposedAt), disputer: m.disputer });
      }
      return list;
    },
    openRound: (p) => send(LOTTO_ADDR, iLotto, 'openRound', [p.ticketPrice, p.prizeBps, p.treasuryBps, p.burnBps]),
    closeRound: (id, saltHash) => send(LOTTO_ADDR, iLotto, 'closeRound', [id, saltHash]),
    drawRound: (id, salt) => send(LOTTO_ADDR, iLotto, 'drawRound', [id, salt]),
    reArmDraw: (id, saltHash) => send(LOTTO_ADDR, iLotto, 'reArmDraw', [id, saltHash]),
    proposeOutcome: (id, outcome) => send(MARKET_ADDR, iMarket, 'proposeOutcome', [id, { Yes: 1, No: 2, Invalid: 3 }[outcome] ?? 0]),
    finalize: (id) => send(MARKET_ADDR, iMarket, 'finalize', [id]),
  };
}

// A confident-source market resolver is intentionally NOT wired here yet: proposing a real outcome must come
// from the watchdog/17-API named sources with an audit trail. Until that adapter exists, no resolver is
// passed → every closed market is HELD for a human (compliant default).
const resolve = null;

async function main() {
  const store = makeStore(STORE_FILE);
  const adapter = await makeAdapter();
  const hash = await loadHash();
  const rng = () => '0x' + randomBytes(32).toString('hex');

  if (!adapter) { log('no adapter — nothing to do'); process.exit(0); }
  const effectiveDry = DRY || !hash || !SIGNER_URL || !SIGNER_TOKEN;
  if (effectiveDry && !DRY) log('missing hash lib or signer creds → forcing --dry (plan only)');

  const out = await runKeeper({ adapter, store, rng, hash, resolve, dry: effectiveDry });
  log(`planned ${out.planned} | executed ${out.executed.length} | skipped ${out.skipped.length} | errors ${out.errors.length}`);
  for (const n of out.notes) log('note:', n);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`arcade-keeper: ${e?.message || e}`); process.exit(1); });
}

export { makeStore };
