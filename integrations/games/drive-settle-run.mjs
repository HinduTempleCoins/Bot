// drive-settle-run.mjs — the box runner that SETTLES the MELEK Drive hourly lane on-chain.
//
// The drive twin of move-settle-run.mjs. Each closed hour the drive attester broadcasts ONE `drive_pay`
// custom_json — { epoch, pay:[[acct,weightInt],...] } — signed by the attester's ACTIVE authority; the
// chain draws a capped slice (45.000 MELEK/epoch) from the "move" reward fund, splits it pro-rata by
// drive-weight straight to each driver's liquid balance, and advances dgpo.last_drive_pay_epoch. No
// MELEK of ours is spent, no relay account, no transfer per driver.
//
// Key custody mirrors move-settle-run.mjs: the active key comes ONLY from env DRIVE_ATTESTER_KEY (or
// HATHOR_ACTIVE_KEY), JIT-fetched from the vault by the wrapper per run — never on disk, never logged.
// settleDriveEpoch is idempotent + retry-safe: a failed broadcast leaves the hour OPEN; an epoch the
// chain already advanced past is treated as settled.
//
// Network guard — accepts TST/TESTS (testnet) or MELEK/MELEK (mainnet) and rejects anything else, so a
// bad env can never sign a drive_pay against the wrong chain. Soft-fails to a printed report.
//
//   # hourly, just-closed epoch, from the live ledger:
//   DRIVE_ATTESTER_KEY=… node integrations/games/drive-settle-run.mjs
//   # explicit epoch / dry-run / scratch ledger file / force an open hour:
//   node integrations/games/drive-settle-run.mjs <epoch> --dry --force --file=./data/scratch.json

import { settleDriveEpoch, buildDrivePay, epochNow } from './drive-ledger.mjs';

const RPC = process.env.MELEK_RPC_URL || process.env.WELCOME_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = (process.env.MELEK_CHAIN_ID || '').trim();
const PREFIX = (process.env.MELEK_ADDRESS_PREFIX || process.env.MELEK_PREFIX || 'TST').trim();
const SYMBOL = (process.env.WELCOME_SYMBOL || process.env.MELEK_SYMBOL || 'TESTS').trim();
// MELEK_DRIVE_ATTESTER in config.hpp. Must match the chain constant or the op is rejected unsigned-by.
const ATTESTER = (process.env.DRIVE_ATTESTER || process.env.MOVE_ATTESTER || 'moveoracle').trim();

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, d) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const epochArg = args.find((a) => /^\d+$/.test(a));

const DRY = flag('dry');
const FORCE = flag('force');
const FILE = opt('file');                                            // scratch ledger (proof); default = live
const EPOCH = epochArg != null ? Number(epochArg) : epochNow() - 1;  // default: the just-closed hour

function fail(msg, code = 1) { console.error(`drive-settle: ${msg}`); process.exit(code); }

(async () => {
  const isTestnet = PREFIX === 'TST' && SYMBOL === 'TESTS';
  const isMainnet = PREFIX === 'MELEK' && SYMBOL === 'MELEK';
  if (!isTestnet && !isMainnet) return fail(`unsupported network (got ${PREFIX}/${SYMBOL}); expected TST/TESTS or MELEK/MELEK`, 2);

  let broadcastDrivePay;
  if (DRY) {
    broadcastDrivePay = async ({ epoch, pay }) => ({ id: `dry-drive_pay-${epoch}-${pay.length}` });
  } else {
    const key = (process.env.DRIVE_ATTESTER_KEY || process.env.HATHOR_ACTIVE_KEY || '').trim();
    if (!key) return fail('no DRIVE_ATTESTER_KEY in env (the wrapper must JIT-fetch it from the vault)');
    if (!CHAIN_ID) return fail('no MELEK_CHAIN_ID in env');
    let dhive;
    try { dhive = await import('@hiveio/dhive'); } catch { dhive = await import('/opt/melek-bot/repo/node_modules/@hiveio/dhive/lib/index.js'); }
    const { Client, PrivateKey } = dhive.default || dhive;
    const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
    const pk = PrivateKey.fromString(key);
    // drive_pay carries required_auths:[attester] → the chain enforces the attester's ACTIVE authority.
    broadcastDrivePay = async ({ epoch, pay }) => {
      const op = ['custom_json', { required_auths: [ATTESTER], required_posting_auths: [], id: 'drive_pay', json: JSON.stringify({ epoch, pay }) }];
      const r = await client.broadcast.sendOperations([op], pk);
      return { id: r.id || r.trx_id || true };
    };
  }

  const preview = buildDrivePay(EPOCH, { file: FILE });
  console.log(`[${new Date().toISOString()}] drive-settle epoch ${EPOCH} — ${preview.claims} driver(s), totalWeight ${preview.totalWeight}${DRY ? ' (DRY)' : ''}${FORCE ? ' (FORCE)' : ''}`);

  const out = await settleDriveEpoch(EPOCH, { broadcastDrivePay }, { file: FILE, force: FORCE });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok === false ? 1 : 0);
})();
