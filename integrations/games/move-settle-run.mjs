// move-settle-run.mjs — the box runner that PAYS the MELEK Move hourly pool on-chain (testnet or mainnet).
//
// Reads the move ledger (move-ledger.mjs), settles a CLOSED epoch, and pays each walker their
// stake-weighted MELEK slice via a real `transfer` op (dhive). Mirrors the JIT-key custody of
// witness/hathor-welcome-live.mjs + bin/hathor-grant.sh: the active key comes ONLY from env
// HATHOR_ACTIVE_KEY (the wrapper fetches it from the vault per run, never on disk, never logged).
// settleEpoch is idempotent + retry-safe (a failed transfer leaves the hour OPEN for the next run).
//
// Network guard — accepts TST/TESTS (testnet) or MELEK/MELEK (mainnet), rejects anything else so a bad
// env can never pay from the wrong chain. Soft-fails to a printed report; never broadcasts without a key.
//
//   # hourly, just-closed epoch, from the live ledger:
//   HATHOR_ACTIVE_KEY=… node integrations/games/move-settle-run.mjs
//   # explicit epoch / dry-run / scratch file / custom budget (proof + ops):
//   node integrations/games/move-settle-run.mjs <epoch> --dry --force --file=/tmp/x.json --budget=1

import { settleEpoch, epochNow, readEpoch } from './move-ledger.mjs';

const RPC = process.env.MELEK_RPC_URL || process.env.WELCOME_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = (process.env.MELEK_CHAIN_ID || '').trim();
const PREFIX = (process.env.MELEK_ADDRESS_PREFIX || process.env.MELEK_PREFIX || 'TST').trim();
const SYMBOL = (process.env.WELCOME_SYMBOL || process.env.MELEK_SYMBOL || 'TESTS').trim();
const FROM = (process.env.HATHOR_ACCOUNT || 'hathor').trim();

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, d) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const epochArg = args.find((a) => /^\d+$/.test(a));

const DRY = flag('dry');
const FORCE = flag('force');
const FILE = opt('file');                                  // scratch ledger (proof/ops); default = live
const BUDGET = opt('budget') != null ? Number(opt('budget')) : undefined; // override hourly pool (proof)
const EPOCH = epochArg != null ? Number(epochArg) : epochNow() - 1;       // default: the just-closed hour

function fail(msg, code = 1) { console.error(`move-settle: ${msg}`); process.exit(code); }

(async () => {
  // Accept the MELEK testnet (TST/TESTS) or the MELEK mainnet (MELEK/MELEK) — reject anything else so a
  // misconfigured env can never pay from the wrong chain.
  const isTestnet = PREFIX === 'TST' && SYMBOL === 'TESTS';
  const isMainnet = PREFIX === 'MELEK' && SYMBOL === 'MELEK';
  if (!isTestnet && !isMainnet) return fail(`unsupported network (got ${PREFIX}/${SYMBOL}); expected TST/TESTS or MELEK/MELEK`, 2);

  // Build the transfer dep. DRY → a stub that just records the intent (no chain, no key).
  let transfer;
  if (DRY) {
    transfer = async ({ to, amount }) => ({ id: `dry-${to}-${amount.split(' ')[0]}` });
  } else {
    const key = (process.env.HATHOR_ACTIVE_KEY || '').trim();
    if (!key) return fail('no HATHOR_ACTIVE_KEY in env (the wrapper must JIT-fetch it from the vault)');
    if (!CHAIN_ID) return fail('no MELEK_CHAIN_ID in env');
    let dhive;
    try { dhive = await import('@hiveio/dhive'); } catch { dhive = await import('/opt/melek-bot/repo/node_modules/@hiveio/dhive/lib/index.js'); }
    const { Client, PrivateKey, Asset } = dhive.default || dhive;
    // dhive only ships STEEM/HIVE/SBD/VESTS — teach it the MELEK/MBD symbols (precision 3) so a mainnet
    // `transfer` of "x.xxx MELEK" serializes. Harmless on testnet (TESTS keeps dhive's native handling).
    if (Asset && !Asset.__melekPatched) {
      const SYMS = new Set(['MELEK', 'MBD']);
      const origFromString = Asset.fromString.bind(Asset);
      Asset.fromString = (s, exp) => {
        const [amt, sym] = String(s).split(' ');
        if (SYMS.has(sym)) { const n = Number.parseFloat(amt); if (!Number.isFinite(n)) throw new Error('bad asset amount'); return new Asset(n, sym); }
        return origFromString(s, exp);
      };
      const origPrecision = Asset.prototype.getPrecision;
      Asset.prototype.getPrecision = function () { return SYMS.has(this.symbol) ? 3 : origPrecision.call(this); };
      Asset.__melekPatched = true;
    }
    const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
    const pk = PrivateKey.fromString(key);
    transfer = async ({ from, to, amount, memo }) => {
      const r = await client.broadcast.sendOperations([['transfer', { from, to, amount, memo }]], pk);
      return { id: r.id || r.trx_id || true };
    };
  }

  const pre = readEpoch(EPOCH, { file: FILE });
  console.log(`[${new Date().toISOString()}] move-settle epoch ${EPOCH} — ${pre.claims.length} walker(s), totalWeight ${Math.round(pre.totalWeight)}, settled=${pre.settled}${DRY ? ' (DRY)' : ''}${FORCE ? ' (FORCE)' : ''}`);

  const out = await settleEpoch(EPOCH, { transfer }, { file: FILE, from: FROM, symbol: SYMBOL, budget: BUDGET, force: FORCE });
  console.log(JSON.stringify(out, null, 2));
  // exit non-zero only on a genuine partial failure (so the timer surfaces it); a clean no-op is success.
  process.exit(out.ok === false && (out.errors || []).length ? 1 : 0);
})();
