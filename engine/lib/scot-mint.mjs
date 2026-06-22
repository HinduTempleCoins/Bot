// scot-mint.mjs — off-chain builders for the SCOT BOT MINT (scot.mjs). Pure: builds + validates the
// `scot` contract custom_json ops (createTribe / mint); never signs, never broadcasts (the launcher signs
// client-side or via the host signer). Mirrors op-builder.mjs's shape + validation.

import { config } from '../config.mjs';
import { isValidPrecision, toBaseUnits, MAX_PRECISION, maxSupplyBaseUnits } from './decimal.mjs';

const SYMBOL_RE = /^[A-Z]{1,10}$/;
const ACCOUNT_RE = /^[a-z][a-z0-9-]{2,15}(\.[a-z][a-z0-9-]+)*$/;
const CURVES = new Set(['linear', 'quadratic', 'sqrt']);
const isAccount = (a) => typeof a === 'string' && a.length >= 3 && a.length <= 32 && ACCOUNT_RE.test(a);
const isSymbol = (s) => typeof s === 'string' && SYMBOL_RE.test(s);
const err = (error) => ({ ok: false, error });

function customJsonOp(account, envelope) {
  return ['custom_json', { required_auths: [account], required_posting_auths: [], id: config.sidechainId, json: JSON.stringify(envelope) }];
}
function validQuantity(q) {
  const s = String(q == null ? '' : q).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return `malformed quantity "${q}"`;
  if ((s.split('.')[1] || '').length > MAX_PRECISION) return `quantity "${q}" exceeds max precision ${MAX_PRECISION}`;
  if (Number(s) <= 0) return 'quantity must be > 0';
  return null;
}

/**
 * buildCreateTribeOp — assemble a scot.createTribe op (mint a SCOT tribe token: create + reward rule).
 * params: { symbol, name?, precision, maxSupply, tag?, emissionPerWindow, windowBlocks, authorBps?, curve?, initialIssue?, url? }
 */
export function buildCreateTribeOp(account, p = {}) {
  if (!isAccount(account)) return err(`invalid account "${account}"`);
  const symbol = String(p.symbol || '').toUpperCase();
  if (!isSymbol(symbol)) return err(`invalid symbol "${p.symbol}" (1-10 uppercase A-Z)`);
  const precision = Number(p.precision);
  if (!isValidPrecision(precision)) return err(`precision must be an integer 0..${MAX_PRECISION}`);
  let base;
  try { base = toBaseUnits(String(p.maxSupply), precision); } catch (e) { return err(`bad maxSupply: ${e.message}`); }
  if (base <= 0n) return err('maxSupply must be > 0');
  if (base > maxSupplyBaseUnits(precision)) return err('maxSupply exceeds the Number.MAX_SAFE_INTEGER ceiling');
  const eErr = validQuantity(p.emissionPerWindow);
  if (eErr) return err(`emissionPerWindow: ${eErr}`);
  const windowBlocks = Number(p.windowBlocks);
  if (!Number.isInteger(windowBlocks) || windowBlocks < 1) return err('windowBlocks must be a positive integer');
  const authorBps = p.authorBps === undefined ? 5000 : Number(p.authorBps);
  if (!Number.isInteger(authorBps) || authorBps < 0 || authorBps > 10000) return err('authorBps must be an integer 0..10000');
  const curve = p.curve === undefined ? 'linear' : String(p.curve);
  if (!CURVES.has(curve)) return err(`curve must be one of ${[...CURVES].join('/')}`);
  if (p.initialIssue != null && String(p.initialIssue) !== '0') {
    const iErr = validQuantity(p.initialIssue);
    if (iErr) return err(`initialIssue: ${iErr}`);
  }

  const payload = {
    symbol, name: String(p.name || symbol).slice(0, 50), precision, maxSupply: String(p.maxSupply),
    emissionPerWindow: String(p.emissionPerWindow), windowBlocks, authorBps, curve,
  };
  if (p.tag) payload.tag = String(p.tag);
  if (p.initialIssue != null && String(p.initialIssue) !== '0') payload.initialIssue = String(p.initialIssue);
  if (typeof p.url === 'string' && p.url) payload.url = p.url.slice(0, 255);
  const envelope = { contractName: 'scot', contractAction: 'createTribe', contractPayload: payload };
  return { ok: true, action: 'createTribe', op: customJsonOp(account, envelope), envelope,
    summary: `mint SCOT tribe ${symbol} (${p.emissionPerWindow}/window, ${authorBps / 100}% author, ${curve})` };
}

/** buildScotMintOp — issue more of an existing tribe token. params: { symbol, to, quantity } */
export function buildScotMintOp(account, p = {}) {
  if (!isAccount(account)) return err(`invalid account "${account}"`);
  const symbol = String(p.symbol || '').toUpperCase();
  if (!isSymbol(symbol)) return err(`invalid symbol "${p.symbol}"`);
  if (!isAccount(p.to)) return err(`invalid recipient "${p.to}"`);
  const qErr = validQuantity(p.quantity);
  if (qErr) return err(qErr);
  const envelope = { contractName: 'scot', contractAction: 'mint', contractPayload: { symbol, to: p.to, quantity: String(p.quantity) } };
  return { ok: true, action: 'mint', op: customJsonOp(account, envelope), envelope, summary: `mint ${p.quantity} ${symbol} → @${p.to}` };
}
