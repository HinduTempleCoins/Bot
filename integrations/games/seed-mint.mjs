// seed-mint.mjs — the off-chain Seed MINT runner. Reads the seed catalog (seed-tokens.mjs) and BUILDS the
// MELEK-Engine `seeds` contract ops (register / mint / plant) as Graphene custom_json operations. Pure: it
// only builds + validates ops — it NEVER signs and NEVER broadcasts (zero-WIF; the box signer broadcasts with
// the minter's JIT key, exactly like every other Hathor op). One register op per seed bootstraps the asset
// (a fungible token for abundant strains, an NFT type for scarce ones); mint issues to a grower; plant burns.
//
// House style: ESM, pure, soft-fail-never-throw, env-overridable. CLI guarded by process.argv[1].
//
//   node integrations/games/seed-mint.mjs register --account hathor      # build the register-all op list
//   node integrations/games/seed-mint.mjs mint --account hathor --to bob --symbol VANKUSH --qty 3
//   node integrations/games/seed-mint.mjs plant --account bob --symbol AUTOSOUR --qty 1

import { fileURLToPath } from 'node:url';
import { seedCatalog } from './seed-tokens.mjs';

const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || '';
export const SIDECHAIN_ID = env('MELEK_ENGINE_ID') || 'mse-testnet-melek';

const SYMBOL_RE = /^[A-Z]{1,10}$/;
const ACCOUNT_RE = /^[a-z][a-z0-9-]{2,15}(\.[a-z][a-z0-9-]+)*$/;
const isAccount = (a) => typeof a === 'string' && a.length >= 3 && a.length <= 32 && ACCOUNT_RE.test(a);
const isSymbol = (s) => typeof s === 'string' && SYMBOL_RE.test(s);
const isCount = (q) => /^\d+$/.test(String(q)) && BigInt(String(q)) > 0n;
const err = (error) => ({ ok: false, error });

/** Wrap an engine contract envelope into a Graphene custom_json op (active auth = the minter/holder). */
function customJsonOp(account, envelope) {
  return ['custom_json', {
    required_auths: [account], required_posting_auths: [],
    id: SIDECHAIN_ID, json: JSON.stringify(envelope),
  }];
}

// Supply policy — the inverse-inflation shape made concrete. Fungible (token-kind) seeds get an ABUNDANT cap
// scaled by grow tier (daily "milk" the largest); NFT-kind seeds get a SCARCE edition cap scaled by rarity.
const TOKEN_CAP_BY_TIER = { day: '100000000', week: '10000000', month: '1000000', season: '500000', year: '100000' };
const NFT_CAP_BY_RARITY = { common: '100000', uncommon: '50000', rare: '5000', legendary: '500' };
export function supplyForSeed(seed) {
  if (seed.kind === 'nft') return NFT_CAP_BY_RARITY[seed.rarity] || '5000';
  return TOKEN_CAP_BY_TIER[seed.growTier] || '1000000';
}

/** The traits an NFT-kind seed carries on-chain (and that the seeds registry records). */
function traitsFor(seed) {
  return {
    rarity: seed.rarity, growTier: seed.growTier, season: seed.season,
    multiHarvest: seed.multiHarvest || 1,
    volunteer: !!seed.volunteer, flower: !!seed.flower, festival: !!seed.festival,
  };
}

/** Build one seeds.register op for a catalog entry. */
export function buildRegisterOp(account, seed) {
  if (!isAccount(account)) return err(`invalid account "${account}"`);
  if (!seed || !isSymbol(seed.symbol)) return err(`invalid seed symbol "${seed && seed.symbol}"`);
  const kind = seed.kind === 'nft' ? 'nft' : 'token';
  const payload = {
    symbol: seed.symbol, kind, name: seed.name || seed.symbol,
    maxSupply: supplyForSeed(seed),
    rarity: seed.rarity || null, growTier: seed.growTier || null, season: seed.season || null,
  };
  if (kind === 'nft') { payload.collection = seed.collection || undefined; payload.traits = traitsFor(seed); }
  const envelope = { contractName: 'seeds', contractAction: 'register', contractPayload: payload };
  return { ok: true, action: 'register', symbol: seed.symbol, kind, op: customJsonOp(account, envelope), envelope,
    summary: `register ${kind} seed ${seed.symbol} (cap ${payload.maxSupply})` };
}

/** Build the register op for every seed in the catalog — the full Mint bootstrap. */
export function buildRegisterAllOps(account, catalog = seedCatalog()) {
  return catalog.map((seed) => buildRegisterOp(account, seed)).filter((r) => r.ok);
}

/** Build a seeds.mint op (issue `quantity` of `symbol` to `to`). Minter-signed. */
export function buildMintOp(account, { to, symbol, quantity } = {}) {
  if (!isAccount(account)) return err(`invalid account "${account}"`);
  if (!isAccount(to)) return err(`invalid recipient "${to}"`);
  const sym = String(symbol || '').toUpperCase();
  if (!isSymbol(sym)) return err(`invalid symbol "${symbol}"`);
  if (!isCount(quantity)) return err(`quantity must be a positive integer (got "${quantity}")`);
  const envelope = { contractName: 'seeds', contractAction: 'mint', contractPayload: { to, symbol: sym, quantity: String(quantity) } };
  return { ok: true, action: 'mint', op: customJsonOp(account, envelope), envelope, summary: `mint ${quantity} ${sym} → @${to}` };
}

/** Build a seeds.plant op (the grower burns `quantity` of `symbol`). Holder-signed. */
export function buildPlantOp(account, { symbol, quantity } = {}) {
  if (!isAccount(account)) return err(`invalid account "${account}"`);
  const sym = String(symbol || '').toUpperCase();
  if (!isSymbol(sym)) return err(`invalid symbol "${symbol}"`);
  if (!isCount(quantity)) return err(`quantity must be a positive integer (got "${quantity}")`);
  const envelope = { contractName: 'seeds', contractAction: 'plant', contractPayload: { symbol: sym, quantity: String(quantity) } };
  return { ok: true, action: 'plant', op: customJsonOp(account, envelope), envelope, summary: `plant (burn) ${quantity} ${sym}` };
}

// ---- CLI (build-only; prints ops as JSON for the box signer to broadcast) ----
function arg(flags, name, def) { const i = flags.indexOf(`--${name}`); return i >= 0 && flags[i + 1] ? flags[i + 1] : def; }
function main(argv) {
  const [cmd, ...flags] = argv;
  const account = arg(flags, 'account', env('MELEK_ENGINE_SEED_MINTER') || 'hathor');
  let out;
  if (cmd === 'register') {
    const ops = buildRegisterAllOps(account);
    out = { ok: true, action: 'register', count: ops.length, ops: ops.map((o) => ({ summary: o.summary, op: o.op })) };
  } else if (cmd === 'mint') {
    out = buildMintOp(account, { to: arg(flags, 'to'), symbol: arg(flags, 'symbol'), quantity: arg(flags, 'qty', '1') });
  } else if (cmd === 'plant') {
    out = buildPlantOp(account, { symbol: arg(flags, 'symbol'), quantity: arg(flags, 'qty', '1') });
  } else {
    out = { ok: false, error: 'usage: seed-mint.mjs <register|mint|plant> [--account x] [--to y] [--symbol Z] [--qty N]' };
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
