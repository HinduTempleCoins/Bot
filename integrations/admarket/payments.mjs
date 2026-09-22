// payments.mjs — token-payment INTENT builders for the ad market. Builds + validates only. NEVER signs,
// NEVER broadcasts, NEVER reads a WIF / seed / active key. (BRIEF.md §7 — "Zero WIF in Bot repo".)
//
// HOW AN AD IS PAID FOR (the token-payment hook):
//   1. An advertiser funds a campaign by depositing the budget into the AD ESCROW in the chosen token.
//   2. This module builds the exact UNSIGNED operation/transaction for that deposit — a client-signable
//      envelope the advertiser signs in THEIR OWN wallet (dhive / MetaMask / MELEK-Signer). We hold no key.
//   3. The advertiser broadcasts it; the operator VERIFIES the deposit landed (reads the chain) and calls
//      model.confirmFunding(ref) — the campaign goes active. Budget draws down as the ad serves.
//   4. Unspent budget at the end is returned with a REFUND intent (also unsigned, operator/signer-gated).
//
// THE ESCROW MEMO is the binding key: every deposit carries `adcampaign:<id>` so a deposit can be matched
// to its campaign on-chain. Nothing settles automatically — settlement is an operator/signer action off
// this host. This file only produces the intent + a human summary.
//
// Per-token rail (mirrors pricing.TOKENS.chain):
//   MELEK  → graphene ['transfer', {from,to,amount,memo}]                         (MELEK L1)
//   APIS   → graphene ['custom_json', {required_auths, id, json:tokens.transfer}] (MELEK-Engine side-token)
//   PRANA  → EVM ERC-20 transfer(to,amount) calldata intent {to:token, data, chainId}
//   KULA   → EVM ERC-20 transfer(to,amount) calldata intent {to:token, data, chainId}
//
// House style: ESM .mjs, soft-fail ({ ok:false, error }), esc() is the page's job, BigInt for amounts.

import { TOKENS, tokenSpec, isSupportedToken, toBaseUnits, fromBaseUnits, amountStr, big } from './pricing.mjs';

const ACCOUNT_RE = /^[a-z][a-z0-9-]{2,15}(\.[a-z][a-z0-9-]+)*$/;
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const err = (error) => ({ ok: false, error });

export function isAccount(a) { return typeof a === 'string' && ACCOUNT_RE.test(a); }
export function isEvmAddress(a) { return typeof a === 'string' && EVM_ADDR_RE.test(a); }

// ── ERC-20 transfer(address,uint256) calldata (no ethers dep — pure hex) ───────────────────────────────
export const ERC20_TRANSFER_SELECTOR = '0xa9059cbb'; // keccak256("transfer(address,uint256)")[:4]
const pad32 = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
/** Build ERC-20 transfer calldata: 0x + selector + to(32) + amount(32). null on bad input. */
export function erc20TransferData(to, amountBase) {
  if (!isEvmAddress(to)) return null;
  const amt = big(amountBase);
  if (amt == null) return null;
  return ERC20_TRANSFER_SELECTOR + pad32(to.slice(2)) + pad32(amt.toString(16));
}

// ── escrow config resolution (env-by-name; no address hardcoded, no secret) ────────────────────────────
/**
 * Resolve the deposit escrow destination for a token, from env. We NEVER invent an address; if the escrow
 * for a rail isn't configured the intent build fails with a clear message (nothing to pay into yet).
 *   MELEK/APIS → AD_ESCROW_ACCOUNT   (a MELEK account, e.g. 'melek.ads')
 *   PRANA/KULA → AD_ESCROW_EVM       (an 0x escrow contract/address) + token contract addresses:
 *                PRANA_TOKEN_ADDRESS / KULA_TOKEN_ADDRESS, and PRANA_CHAIN_ID (default 108369).
 */
export function resolveEscrow(token, env = process.env) {
  const spec = tokenSpec(token);
  if (!spec) return null;
  if (spec.chain === 'graphene' || spec.chain === 'engine') {
    const acct = String(env.AD_ESCROW_ACCOUNT || '').trim();
    return acct && isAccount(acct) ? { kind: spec.chain, to: acct } : null;
  }
  // evm
  const to = String(env.AD_ESCROW_EVM || '').trim();
  const tokenAddr = String(env[`${spec.symbol}_TOKEN_ADDRESS`] || '').trim();
  const chainId = Number(env.PRANA_CHAIN_ID || 108369);
  if (!isEvmAddress(to) || !isEvmAddress(tokenAddr)) return null;
  return { kind: 'evm', to, tokenAddr, chainId };
}

// ── the engine side-token custom_json envelope (mirrors engine/lib/op-builder.customJsonOp) ─────────────
function engineCustomJson(from, envelope, env) {
  const id = String(env.MELEK_ENGINE_ID || 'mse-testnet-melek');
  return ['custom_json', {
    required_auths: [from],
    required_posting_auths: [],
    id,
    json: JSON.stringify(envelope),
  }];
}

// ── the funding intent ──────────────────────────────────────────────────────────────────────────────────
/**
 * buildFundingIntent(campaign, opts) — the UNSIGNED deposit the advertiser signs to fund their campaign.
 * campaign: a model campaign view ({ id, advertiser, token, budget|requestedBudget }). opts.env injects
 * the escrow config; opts.amount overrides the amount (decimal token string) else uses requestedBudget.
 * Returns:
 *   { ok:true, kind, token, amount, memo, intent, summary, requiresSignature:true, signedBy }
 *   { ok:false, error }
 * `intent` is one of:
 *   graphene: ['transfer', { from, to, amount:'X.XXX MELEK', memo }]
 *   engine:   ['custom_json', { required_auths:[from], id, json:'{tokens.transfer …, memo}' }]
 *   evm:      { chainId, to:<tokenContract>, data:<0x transfer calldata>, value:'0x0', memoNote }
 * NOTHING is signed here. The advertiser's own wallet / MELEK-Signer signs + broadcasts it.
 */
export function buildFundingIntent(campaign, opts = {}) {
  const env = opts.env || process.env;
  const c = campaign || {};
  if (!isSupportedToken(c.token)) return err(`campaign has unsupported token "${c.token}"`);
  const spec = tokenSpec(c.token);
  const from = c.advertiser;

  // amount: explicit override, else the campaign's requested (or current) budget base units.
  let amountBase;
  if (opts.amount != null) {
    amountBase = toBaseUnits(opts.amount, spec.precision);
    if (amountBase == null || amountBase <= 0n) return err(`invalid amount "${opts.amount}"`);
  } else {
    const b = big(c.requestedBudget != null ? c.requestedBudget : c.budget);
    if (b == null || b <= 0n) return err('campaign has no budget to fund');
    amountBase = b;
  }

  const escrow = resolveEscrow(c.token, env);
  if (!escrow) return err(`ad escrow not configured for ${c.token} — set AD_ESCROW_* env (nothing to pay into yet)`);

  const memo = `adcampaign:${String(c.id || '').slice(0, 64)}`;
  const amtStr = fromBaseUnits(amountBase, spec.precision);

  // graphene MELEK transfer
  if (spec.chain === 'graphene') {
    if (!isAccount(from)) return err(`MELEK payer must be a MELEK account (got "${from}")`);
    const intent = ['transfer', { from, to: escrow.to, amount: `${amtStr} ${spec.symbol}`, memo }];
    return {
      ok: true, kind: 'graphene', token: spec.symbol, amount: amtStr, memo, intent,
      requiresSignature: true, signedBy: `${from} (active key, in the advertiser's own wallet)`,
      summary: `transfer ${amtStr} ${spec.symbol} → @${escrow.to} memo "${memo}" (unsigned; advertiser signs)`,
    };
  }

  // engine APIS side-token transfer via custom_json
  if (spec.chain === 'engine') {
    if (!isAccount(from)) return err(`APIS payer must be a MELEK account (got "${from}")`);
    const envelope = { contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol: spec.symbol, to: escrow.to, quantity: amtStr, memo } };
    const intent = engineCustomJson(from, envelope, env);
    return {
      ok: true, kind: 'engine', token: spec.symbol, amount: amtStr, memo, intent, envelope,
      requiresSignature: true, signedBy: `${from} (active key, in the advertiser's own wallet)`,
      summary: `engine tokens.transfer ${amtStr} ${spec.symbol} → @${escrow.to} memo "${memo}" (unsigned)`,
    };
  }

  // evm PRANA / KULA ERC-20 transfer
  if (spec.chain === 'evm') {
    if (!isEvmAddress(from)) return err(`${spec.symbol} payer must be an 0x EVM address (got "${from}")`);
    const data = erc20TransferData(escrow.to, amountBase);
    if (!data) return err('failed to build ERC-20 calldata');
    const intent = { chainId: escrow.chainId, to: escrow.tokenAddr, data, value: '0x0', from, memoNote: memo };
    return {
      ok: true, kind: 'evm', token: spec.symbol, amount: amtStr, memo, intent,
      requiresSignature: true, signedBy: `${from} (advertiser's wallet, e.g. MetaMask on PRANA)`,
      summary: `ERC-20 transfer ${amtStr} ${spec.symbol} → ${escrow.to} on chain ${escrow.chainId} (unsigned calldata; advertiser signs)`,
    };
  }
  return err(`no rail for chain "${spec.chain}"`);
}

// ── the refund intent (unspent budget back to the advertiser) ───────────────────────────────────────────
/**
 * buildRefundIntent(campaign, opts) — the UNSIGNED payout of unspent budget from the escrow back to the
 * advertiser. required_auths / from is the ESCROW (operator side) — so this is an OPERATOR/SIGNER-gated
 * intent, never auto-broadcast here. opts.amount overrides (decimal string), else budget − spent.
 */
export function buildRefundIntent(campaign, opts = {}) {
  const env = opts.env || process.env;
  const c = campaign || {};
  if (!isSupportedToken(c.token)) return err(`campaign has unsupported token "${c.token}"`);
  const spec = tokenSpec(c.token);
  const escrow = resolveEscrow(c.token, env);
  if (!escrow) return err(`ad escrow not configured for ${c.token}`);

  let refundBase;
  if (opts.amount != null) {
    refundBase = toBaseUnits(opts.amount, spec.precision);
    if (refundBase == null || refundBase < 0n) return err(`invalid refund amount "${opts.amount}"`);
  } else {
    const budget = big(c.budget); const spent = big(c.spent) ?? 0n;
    if (budget == null) return err('campaign has no budget');
    refundBase = budget - spent;
  }
  if (refundBase <= 0n) return err('nothing to refund (budget fully spent)');
  const to = c.advertiser;
  const amtStr = fromBaseUnits(refundBase, spec.precision);
  const memo = `adrefund:${String(c.id || '').slice(0, 64)}`;

  if (spec.chain === 'graphene') {
    const intent = ['transfer', { from: escrow.to, to, amount: `${amtStr} ${spec.symbol}`, memo }];
    return { ok: true, kind: 'graphene', token: spec.symbol, amount: amtStr, memo, intent, requiresSignature: true, signedBy: `${escrow.to} (operator/MELEK-Signer, off this host)`, summary: `refund ${amtStr} ${spec.symbol} @${escrow.to} → @${to} (operator-gated, unsigned)` };
  }
  if (spec.chain === 'engine') {
    const envelope = { contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol: spec.symbol, to, quantity: amtStr, memo } };
    const intent = engineCustomJson(escrow.to, envelope, env);
    return { ok: true, kind: 'engine', token: spec.symbol, amount: amtStr, memo, intent, envelope, requiresSignature: true, signedBy: `${escrow.to} (operator/MELEK-Signer)`, summary: `refund engine tokens.transfer ${amtStr} ${spec.symbol} → @${to} (operator-gated)` };
  }
  // evm — refund is sent from the escrow contract/owner; calldata is transfer(advertiser, amount).
  const data = erc20TransferData(to, refundBase);
  if (!data) return err('failed to build ERC-20 refund calldata');
  const intent = { chainId: escrow.chainId, to: escrow.tokenAddr, data, value: '0x0', from: escrow.to, memoNote: memo };
  return { ok: true, kind: 'evm', token: spec.symbol, amount: amtStr, memo, intent, requiresSignature: true, signedBy: `${escrow.to} (operator/MELEK-Signer)`, summary: `refund ERC-20 ${amtStr} ${spec.symbol} → ${to} on chain ${escrow.chainId} (operator-gated)` };
}

/** Does a paid deposit memo bind to this campaign id? (used by the operator's reconciliation.) */
export function memoMatchesCampaign(memo, campaignId) {
  return typeof memo === 'string' && memo.trim() === `adcampaign:${String(campaignId || '').slice(0, 64)}`;
}

// ── CLI — offline demo ──────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('payments.mjs')) {
  const env = { AD_ESCROW_ACCOUNT: 'melek.ads', AD_ESCROW_EVM: '0x' + '1'.repeat(40), PRANA_TOKEN_ADDRESS: '0x' + '2'.repeat(40) };
  console.log('admarket/payments — unsigned funding intents (zero-WIF)\n' + '─'.repeat(64));
  console.log(JSON.stringify(buildFundingIntent({ id: 'camp_x', advertiser: 'acmecorp', token: 'MELEK', requestedBudget: '50000' }, { env, amount: '50.000' }), null, 2));
  console.log(JSON.stringify(buildFundingIntent({ id: 'camp_y', advertiser: '0x' + 'a'.repeat(40), token: 'PRANA', requestedBudget: '1' }, { env, amount: '25' }), null, 2));
}
