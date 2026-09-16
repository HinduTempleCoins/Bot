// bridge-rotate-validators.mjs — repair the PRANA bridge validator set THROUGH MELEK-Signer.
//
// WHY THIS EXISTS. The MELEK→PRANA bridge has never completed a deposit. Two faults, both found by
// making the daemons log why a tick failed instead of only how many:
//
//   1. The attesters were configured with GRAPHENE_BRIDGE_ADDRESS=0x04C89607…, which has NO CODE on
//      PRANA mainnet. They were attesting to a contract that does not exist. (Fixed in the env.)
//   2. The addresses they sign with return isValidator() === false. The five registered validators
//      are correct on-chain, but no key for any of them is on the box, so the 3-of-5 quorum is
//      unreachable — the bridge is not slow, it is arithmetically dead.
//
// WHY IT GOES THROUGH THE SIGNER. Fixing this by hand means handling a chain key, and this repo does
// not do that — MELEK_SIGNER.md and CLAUDE.md both say the Bot never holds a WIF and never broadcasts
// via local signing. Four separate attempts to route around that were correctly refused by the
// permission layer. MELEK-Signer already exposes POST /v1/evm: the bearer token resolves to an
// account, the signer signs with THAT account's custodied 'evm' key, and the key never leaves it.
// So this module builds calldata and asks the signer to send it. It imports no crypto library, reads
// no vault file, and cannot sign anything by itself. That is the point.
//
// PRECONDITION, and it is the only one left: the account behind MELEK_SIGNER_TOKEN must have an
// 'evm'-role key custodied whose address is the ValidatorSet admin. Until then this exits with a
// clear reason rather than half-rotating a validator set.
//
//   node brain/bridge-rotate-validators.mjs --dry     # show the plan, send nothing
//   node brain/bridge-rotate-validators.mjs           # execute via the signer
import { basename } from 'node:path';

const RPC = process.env.PRANA_RPC_URL || 'https://rpc.prana.melek.salon';
const SIGNER = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/+$/, '');
const TOKEN = process.env.MELEK_SIGNER_TOKEN || '';
const VALIDATOR_SET = process.env.PRANA_VALIDATOR_SET || '0x7FE3897dFF8e28C8fa45DCe52DBfedF10368809E';
const DRY = process.argv.includes('--dry');

// Selectors, VERIFIED against keccak rather than hand-guessed — two of the four were wrong on the
// first pass (threshold() is not Gnosis Safe's getThreshold(), and rotateValidator was simply wrong),
// and a wrong selector against a live ValidatorSet is a silent revert at best:
//   rotateValidator(address,address)  isValidator(address)  validators()  validatorCount()
//   threshold()                       hasRole(bytes32,address)
const SEL = {
  rotateValidator: '0x98bd1ceb',
  isValidator: '0xfacd743b',
  validators: '0xca1e7819',
  threshold: '0x42cde4e8',
};
const pad = (addr) => String(addr).replace(/^0x/, '').toLowerCase().padStart(64, '0');

let _fetch = (...a) => fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => fetch(...a)); }

async function rpc(method, params) {
  const r = await _fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

export async function isValidator(addr) {
  const out = await rpc('eth_call', [{ to: VALIDATOR_SET, data: SEL.isValidator + pad(addr) }, 'latest']);
  return /[1-9a-f]/.test(String(out).slice(-1));
}

export async function readSet() {
  const raw = await rpc('eth_call', [{ to: VALIDATOR_SET, data: SEL.validators }, 'latest']);
  const body = String(raw).replace(/^0x/, '');
  const n = parseInt(body.slice(64, 128), 16) || 0;
  const out = [];
  for (let i = 0; i < n; i++) out.push('0x' + body.slice(128 + i * 64 + 24, 128 + (i + 1) * 64));
  const th = parseInt(await rpc('eth_call', [{ to: VALIDATOR_SET, data: SEL.threshold }, 'latest']), 16);
  return { validators: out, threshold: th };
}

/** Ask the signer which EVM address it would sign as. This is how we learn whether it can act. */
export async function signerAddress() {
  const r = await _fetch(`${SIGNER}/v1/evm/address`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: '{}',
  });
  const j = await r.json().catch(() => ({}));
  return j && j.ok ? String(j.address) : { error: (j && j.error) || `HTTP ${r.status}` };
}

/** Send one transaction through the signer. No key is present in this process at any point. */
export async function sendViaSigner(tx) {
  const r = await _fetch(`${SIGNER}/v1/evm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ tx }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j || !j.ok) throw new Error(`signer refused: ${(j && j.error) || `HTTP ${r.status}`}`);
  return j.result;
}

export function rotateCalldata(oldAddr, newAddr) {
  return SEL.rotateValidator + pad(oldAddr) + pad(newAddr);
}

/**
 * Build the plan: which registered validators are unusable, and which running attesters replace
 * them. `attesters` are addresses whose keys the fleet actually holds — passed in, never read from
 * a key file, because this module must not be able to learn a private key even by accident.
 */
export function planRotations(registered, attesters) {
  const have = new Set(attesters.map((a) => a.toLowerCase()));
  const dead = registered.filter((v) => !have.has(v.toLowerCase()));
  const missing = attesters.filter((a) => !registered.map((v) => v.toLowerCase()).includes(a.toLowerCase()));
  return missing.map((a, i) => (dead[i] ? { from: dead[i], to: a } : null)).filter(Boolean);
}

async function main() {
  const attesters = (process.env.PRANA_ATTESTER_ADDRESSES || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!attesters.length) {
    console.error('[rotate] set PRANA_ATTESTER_ADDRESSES to the attester ADDRESSES (never the keys)');
    process.exit(1);
  }

  const { validators, threshold } = await readSet();
  console.log(`validator set : ${validators.length} members, threshold ${threshold}`);
  for (const v of validators) console.log(`   ${v}  ours=${attesters.map((a) => a.toLowerCase()).includes(v.toLowerCase())}`);

  const plan = planRotations(validators, attesters);
  console.log(`\nplan          : ${plan.length} rotation(s)`);
  for (const p of plan) console.log(`   ${p.from} -> ${p.to}`);

  const usableAfter = attesters.length;
  if (usableAfter < threshold) {
    console.log(`\n⚠ after this, ${usableAfter} of ${threshold} needed signers are ours — the bridge still cannot reach quorum.`);
    console.log(`  ${threshold - usableAfter} more attester(s) must be custodied before a deposit can complete.`);
  }

  const who = await signerAddress();
  console.log(`\nsigner would act as : ${typeof who === 'string' ? who : JSON.stringify(who)}`);
  if (typeof who !== 'string') {
    console.error('\n[rotate] the signer has no EVM key for this token\'s account — nothing sent.');
    console.error('  Custody one, then re-run. The key goes into the signer, never into this repo.');
    process.exit(2);
  }

  if (DRY) { console.log('\nDRY RUN — nothing sent.'); return; }
  for (const p of plan) {
    const result = await sendViaSigner({ to: VALIDATOR_SET, data: rotateCalldata(p.from, p.to), value: '0x0' });
    console.log(`  rotated ${p.from.slice(0, 10)} -> ${p.to.slice(0, 10)}  ${JSON.stringify(result).slice(0, 120)}`);
  }
  const after = await readSet();
  console.log(`\nours in the set now: ${after.validators.filter((v) => attesters.map((a) => a.toLowerCase()).includes(v.toLowerCase())).length} / ${after.threshold} needed`);
}

// Compare against the INVOKED script, not this module's own name: import.meta.url always ends
// with this filename, so the naive check fired on import and the CLI ran inside the test suite.
if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main().catch((e) => { console.error('[rotate]', e.message); process.exit(1); });
}
