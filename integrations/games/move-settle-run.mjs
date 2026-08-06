// move-settle-run.mjs — the box runner that SETTLES the MELEK Move hourly pool on-chain (testnet/mainnet).
//
// HF25 model (operator, locked): the CHAIN pays walkers from the "move" reward fund. Each closed hour the
// attester (hathor) broadcasts ONE `move_pay` custom_json — { epoch, pay:[[acct,weightInt],...] } — signed
// by hathor's ACTIVE authority; the chain draws a capped slice (150 MELEK/epoch), splits it pro-rata by
// weight straight to each walker's liquid balance, and advances a monotonic epoch guard. No hathor liquid
// is spent, no relay account, no transfer per walker. (The old per-walker `transfer` path is gone.)
//
// Key custody mirrors witness/hathor-welcome-live.mjs: the active key comes ONLY from env HATHOR_ACTIVE_KEY
// (the wrapper JIT-fetches it from the vault per run, never on disk, never logged). settleEpochViaAttester
// is idempotent + retry-safe: a failed broadcast leaves the hour OPEN; an epoch the chain already advanced
// past is treated as settled.
//
// Network guard — accepts TST/TESTS (testnet) or MELEK/MELEK (mainnet), rejects anything else so a bad env
// can never sign against the wrong chain. Soft-fails to a printed report; never broadcasts without a key.
//
//   # hourly, just-closed epoch, from the live ledger:
//   HATHOR_ACTIVE_KEY=… node integrations/games/move-settle-run.mjs
//   # explicit epoch / dry-run / scratch ledger file / force an open hour:
//   node integrations/games/move-settle-run.mjs <epoch> --dry --force --file=/tmp/x.json

import { settleEpochViaAttester, buildMovePay, epochNow } from './move-ledger.mjs';

const RPC = process.env.MELEK_RPC_URL || process.env.WELCOME_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = (process.env.MELEK_CHAIN_ID || '').trim();
const PREFIX = (process.env.MELEK_ADDRESS_PREFIX || process.env.MELEK_PREFIX || 'TST').trim();
const SYMBOL = (process.env.WELCOME_SYMBOL || process.env.MELEK_SYMBOL || 'TESTS').trim();
const ATTESTER = (process.env.HATHOR_ACCOUNT || 'hathor').trim();  // MELEK_MOVE_ATTESTER on-chain

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, d) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const epochArg = args.find((a) => /^\d+$/.test(a));

const DRY = flag('dry');
const FORCE = flag('force');
const FILE = opt('file');                                            // scratch ledger (proof); default = live
const EPOCH = epochArg != null ? Number(epochArg) : epochNow() - 1;  // default: the just-closed hour

function fail(msg, code = 1) { console.error(`move-settle: ${msg}`); process.exit(code); }

(async () => {
  // Accept the MELEK testnet (TST/TESTS) or the MELEK mainnet (MELEK/MELEK) — reject anything else so a
  // misconfigured env can never sign a move_pay against the wrong chain.
  const isTestnet = PREFIX === 'TST' && SYMBOL === 'TESTS';
  const isMainnet = PREFIX === 'MELEK' && SYMBOL === 'MELEK';
  if (!isTestnet && !isMainnet) return fail(`unsupported network (got ${PREFIX}/${SYMBOL}); expected TST/TESTS or MELEK/MELEK`, 2);

  // Build the broadcast dep. DRY → a stub that just records the intent (no chain, no key).
  let broadcastMovePay;
  if (DRY) {
    broadcastMovePay = async ({ epoch, pay }) => ({ id: `dry-move_pay-${epoch}-${pay.length}` });
  } else {
    const key = (process.env.HATHOR_ACTIVE_KEY || '').trim();
    if (!key) return fail('no HATHOR_ACTIVE_KEY in env (the wrapper must JIT-fetch it from the vault)');
    if (!CHAIN_ID) return fail('no MELEK_CHAIN_ID in env');
    let dhive;
    try { dhive = await import('@hiveio/dhive'); } catch { dhive = await import('/opt/melek-bot/repo/node_modules/@hiveio/dhive/lib/index.js'); }
    const { Client, PrivateKey } = dhive.default || dhive;
    const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
    const pk = PrivateKey.fromString(key);
    // move_pay carries required_auths:[attester] → the chain enforces the attester's ACTIVE authority.
    broadcastMovePay = async ({ epoch, pay }) => {
      const op = ['custom_json', { required_auths: [ATTESTER], required_posting_auths: [], id: 'move_pay', json: JSON.stringify({ epoch, pay }) }];
      const r = await client.broadcast.sendOperations([op], pk);
      return { id: r.id || r.trx_id || true };
    };
  }

  const preview = buildMovePay(EPOCH, { file: FILE });
  console.log(`[${new Date().toISOString()}] move-settle epoch ${EPOCH} — ${preview.claims} walker(s), totalWeight ${preview.totalWeight}${DRY ? ' (DRY)' : ''}${FORCE ? ' (FORCE)' : ''}`);

  const out = await settleEpochViaAttester(EPOCH, { broadcastMovePay }, { file: FILE, force: FORCE });
  console.log(JSON.stringify(out, null, 2));
  // exit non-zero only on a genuine failure (so the timer surfaces it); a clean no-op/settle is success.
  process.exit(out.ok === false ? 1 : 0);
})();
