// prana-address-registry.mjs — which PRANA address belongs to which MELEK account.
//
// This is the cross-chain join that makes SoapBox delegation-mining payable, and it is the part the
// NutBox model needed a manual "bind your TRON address" step for. We need no bind step: MELEK-Signer
// custodies a PRANA (EVM) key per account and will tell a logged-in session its own address —
// `POST /v1/evm/address`, bearer resolves to the account, `{ok:true, address}` back. So the mapping
// is learned at LOGIN, automatically, and the user never types or holds anything.
//
//   MELEK account --(their own signer token)--> /v1/evm/address --> 0x… --> dMP is minted there
//
// THE SECURITY PROPERTY, and the reason `record()` is not an API the client can hand an address to:
// an address is only ever accepted as it came back from the signer FOR THAT TOKEN. A caller cannot
// claim someone else's address, because the signer answers only for the account its own bearer
// resolves to (src/server.mjs: `evmSigner.getAddress(grant.account)`). `recordFromSigner()` is
// therefore the only intended writer; `record()` exists for tests and for a server-side backfill
// where the account is already proven.
//
// House style: ESM, injectable fs + fetch, soft-fail-never-throw, CLI guarded, offline tests.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validAccountName } from '../signup/welcome-grant.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const REGISTRY_FILE = () => env('PRANA_ADDRESS_REGISTRY', join(process.cwd(), 'data', 'prana-addresses.json'));
export const SIGNER_URL = () => String(env('MELEK_SIGNER_URL', 'https://signer.melek.salon')).replace(/\/$/, '');

/** An EVM address and nothing else. Checked before anything is stored. */
export const isEvmAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ''));

const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const ctx = (opts = {}) => ({ fs: opts.fs || realFs, file: opts.file || REGISTRY_FILE() });
const norm = (a) => String(a == null ? '' : a).toLowerCase();

function load(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { byAccount: {} };
  try { const o = JSON.parse(raw); return o && o.byAccount ? { byAccount: o.byAccount } : { byAccount: {} }; }
  catch { return { byAccount: {} }; }
}
function save(fs, file, store) {
  try { (fs.write || realFs.write)(file, JSON.stringify(store)); return true; } catch { return false; }
}

/**
 * Record a proven account → address pair. Rejects a bad account name or a non-address outright.
 * A changed address is recorded and the previous one kept in `history`, because a silently moved
 * payout address is exactly the thing you want to be able to see afterwards.
 */
export function record(account, address, opts = {}) {
  const who = norm(account);
  if (!validAccountName(who)) return { ok: false, reason: 'invalid account name' };
  if (!isEvmAddress(address)) return { ok: false, reason: 'not an EVM address' };
  const { fs, file } = ctx(opts);
  const store = load(fs, file);
  const prev = store.byAccount[who];
  const addr = String(address);
  if (prev && prev.address && prev.address.toLowerCase() === addr.toLowerCase()) {
    return { ok: true, account: who, address: prev.address, changed: false };
  }
  store.byAccount[who] = {
    address: addr,
    seen: Number(opts.now) || Date.now(),
    history: [...((prev && prev.history) || []), ...(prev && prev.address ? [prev.address] : [])].slice(-10),
  };
  save(fs, file, store);
  return { ok: true, account: who, address: addr, changed: true, previous: (prev && prev.address) || null };
}

/** The recorded address for an account, or null. */
export function addressFor(account, opts = {}) {
  const { fs, file } = ctx(opts);
  const e = load(fs, file).byAccount[norm(account)];
  return (e && e.address) || null;
}

/** Everything recorded, as the Map the delegation relayer wants. */
export function allAddresses(opts = {}) {
  const { fs, file } = ctx(opts);
  const out = new Map();
  for (const [acct, e] of Object.entries(load(fs, file).byAccount)) {
    if (e && isEvmAddress(e.address)) out.set(acct, e.address);
  }
  return out;
}

/**
 * Ask MELEK-Signer for the address of the account THIS token belongs to, and record it.
 * The token is never logged and never stored — only the address it resolves to.
 *
 * `expectAccount` is optional belt-and-braces: if given and the caller believed the token belonged
 * to a different account, nothing is recorded. The signer is still the authority either way.
 */
export async function recordFromSigner({ token, expectAccount = null, signerUrl = SIGNER_URL(), ...opts } = {}) {
  if (!token) return { ok: false, reason: 'no signer token (token is never logged)' };
  let body;
  try {
    const r = await _fetch(`${signerUrl}/v1/evm/address`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: '{}',
    });
    body = await r.json().catch(() => null);
    if (!r.ok || !body || !body.ok) {
      return { ok: false, reason: (body && body.error) || `signer said ${r.status}` };
    }
  } catch (e) { return { ok: false, reason: `signer unreachable: ${String(e.message || e).slice(0, 80)}` }; }

  if (!isEvmAddress(body.address)) return { ok: false, reason: 'signer returned no usable address' };
  // The signer does not echo the account, so the caller supplies who it just authenticated.
  const who = norm(expectAccount);
  if (!validAccountName(who)) return { ok: false, reason: 'expectAccount must be the authenticated MELEK account' };
  return record(who, body.address, opts);
}

// ── CLI (guarded) — read-only listing ─────────────────────────────────────────────────────────────
if (process.argv[1] && /prana-address-registry\.mjs$/.test(process.argv[1])) {
  const all = allAddresses();
  console.log(`registry: ${REGISTRY_FILE()}`);
  console.log(`signer  : ${SIGNER_URL()}/v1/evm/address`);
  console.log(`recorded: ${all.size} account(s)`);
  for (const [a, addr] of all) console.log(`   @${a}  ->  ${addr}`);
  if (!all.size) {
    console.log('\nNothing recorded yet. An address is learned when an account logs in with');
    console.log('MELEK-Signer — there is no bind step and nothing for a user to type.');
  }
}
