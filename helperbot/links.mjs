// links.mjs — link a chat user (Discord/Telegram/troll-box id) to a PUBLIC PRANA 0x address and/or a
// MELEK account name, and PROVE ownership without the bot ever seeing a key:
//
//   PRANA:  the user sends an exact dust amount (e.g. 0.000482913 PRANA) from the address TO ITSELF in
//           their own wallet. The bot reads the explorer and checks a self-transfer of exactly that value
//           exists after the link was requested. Costs only gas; nothing leaves the user's wallet.
//   MELEK:  the user transfers 0.001 MELEK (TESTS on testnet) to @hathor with the memo `hathor-link-NNNNNN`.
//           The bot reads the account history for that memo.
//
// An UNVERIFIED link may RECEIVE tips (the only risk of a typo is to the linker). Sending tips — where the
// daily quota is gated on the linked wallet's holdings — requires a VERIFIED link, so nobody can borrow a
// whale's address to inflate their quota. One verified address ↔ one chat user.

import { randomInt } from 'node:crypto';
import { prana, melek, CFG } from './live.mjs';
import { defaultStore } from './store.mjs';

export const EVM_RX = /^0x[0-9a-fA-F]{40}$/;
export const MELEK_RX = /^[a-z][a-z0-9-]{2,15}(\.[a-z][a-z0-9-]{2,15})*$/;

export const userKey = (platform, userId) => `link:${platform}:${userId}`;

export function getLink(store, platform, userId) {
  return (store || defaultStore()).get(userKey(platform, userId), null) || {};
}

/** Classify a public identifier the user typed. Returns { kind:'prana'|'melek', value } | null. */
export function parseIdentity(token) {
  const t = String(token || '').trim();
  if (EVM_RX.test(t)) return { kind: 'prana', value: t.toLowerCase() };
  const a = t.replace(/^@/, '').toLowerCase();
  if (MELEK_RX.test(a)) return { kind: 'melek', value: a };
  return null;
}

/** startLink — record an (unverified) link and return proof instructions. Pure apart from the store. */
export function startLink({ store = defaultStore(), platform, userId, identity, now = Date.now(), rand = () => randomInt(100000, 1000000), melekNet = 'mainnet' }) {
  const cur = getLink(store, platform, userId);
  const code = rand();
  if (identity.kind === 'prana') {
    const owner = store.get(`owner:prana:${identity.value}`, null);
    if (owner && owner !== `${platform}:${userId}`) return { ok: false, reply: 'That address is already verified by another user.' };
    const wei = (BigInt(code) * 10n ** 9n).toString();
    cur.prana = { address: identity.value, verified: false, code, wei, requestedAt: now };
    store.set(userKey(platform, userId), cur);
    const amt = `0.000${code}`;
    return {
      ok: true,
      reply: [
        `Linked ${identity.value} (unverified — you can already RECEIVE tips).`,
        `To verify (needed to SEND tips): in your own wallet on PRANA mainnet, send exactly **${amt} PRANA** from this address **to itself**, then type \`!verify\`.`,
        'It costs only gas; I never need your key or seed.',
      ].join('\n'),
    };
  }
  const memo = `hathor-link-${code}`;
  const owner = store.get(`owner:melek:${identity.value}`, null);
  if (owner && owner !== `${platform}:${userId}`) return { ok: false, reply: 'That account is already verified by another user.' };
  cur.melek = { account: identity.value, verified: false, code: memo, net: melekNet, requestedAt: now };
  store.set(userKey(platform, userId), cur);
  return {
    ok: true,
    reply: [
      `Linked @${identity.value} (unverified — you can already RECEIVE tips).`,
      `To verify: from @${identity.value}, transfer 0.001 ${melekNet === 'testnet' ? 'TESTS' : 'MELEK'} to @hathor with memo \`${memo}\` (in your own wallet: ${melekNet === 'testnet' ? 'https://alpha.melek.salon' : 'https://wallet.melek.salon'}), then type \`!verify\`.`,
    ].join('\n'),
  };
}

const sameAddr = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/** verifyPrana — read-only explorer check for the self-transfer proof. */
export async function verifyPranaProof(link) {
  const j = await prana.scanTxs(link.address);
  if (!j || !Array.isArray(j.items)) return { ok: null, why: 'explorer unreachable' };
  const since = Number(link.requestedAt || 0) - 120_000;
  const hit = j.items.find((tx) =>
    sameAddr(tx.from && tx.from.hash, link.address) && sameAddr(tx.to && tx.to.hash, link.address) &&
    String(tx.value) === String(link.wei) && (tx.status === 'ok' || tx.result === 'success') &&
    (!tx.timestamp || Date.parse(tx.timestamp) >= since));
  return hit ? { ok: true, tx: hit.hash } : { ok: false, why: 'no matching self-transfer yet' };
}

export async function verifyMelekProof(link) {
  const h = await melek.history(link.account, link.net || 'mainnet', 100);
  if (!Array.isArray(h)) return { ok: null, why: 'chain unreachable' };
  for (const [, e] of h) {
    const op = e && e.op;
    if (op && op[0] === 'transfer' && op[1].from === link.account && op[1].to === 'hathor' && String(op[1].memo).trim() === link.code) {
      return { ok: true, tx: e.trx_id };
    }
  }
  return { ok: false, why: 'no transfer with that memo yet' };
}

/** verifyLinks — check any pending proofs for this user; marks verified + claims the reverse index. */
export async function verifyLinks({ store = defaultStore(), platform, userId, now = Date.now() }) {
  const cur = getLink(store, platform, userId);
  const out = [];
  if (cur.prana && !cur.prana.verified) {
    const r = await verifyPranaProof(cur.prana);
    if (r.ok) {
      cur.prana.verified = true; cur.prana.verifiedAt = now; cur.prana.tx = r.tx;
      store.set(`owner:prana:${cur.prana.address}`, `${platform}:${userId}`);
      out.push(`✅ ${cur.prana.address} verified (tx ${r.tx}).`);
    } else out.push(r.ok === null ? `⏳ Couldn't reach the PRANA explorer (${CFG.pranascan.mainnet}) — try \`!verify\` again shortly.` : `⏳ ${cur.prana.address}: ${r.why}. Send exactly 0.000${cur.prana.code} PRANA to yourself, then \`!verify\`.`);
  }
  if (cur.melek && !cur.melek.verified) {
    const r = await verifyMelekProof(cur.melek);
    if (r.ok) {
      cur.melek.verified = true; cur.melek.verifiedAt = now; cur.melek.tx = r.tx;
      store.set(`owner:melek:${cur.melek.account}`, `${platform}:${userId}`);
      out.push(`✅ @${cur.melek.account} verified (tx ${r.tx}).`);
    } else out.push(r.ok === null ? '⏳ Couldn\'t reach the MELEK chain — try `!verify` again shortly.' : `⏳ @${cur.melek.account}: ${r.why} (memo \`${cur.melek.code}\` to @hathor).`);
  }
  store.set(userKey(platform, userId), cur);
  if (!out.length) {
    if (cur.prana || cur.melek) out.push(`Already verified: ${[cur.prana && cur.prana.address, cur.melek && '@' + cur.melek.account].filter(Boolean).join(', ')}`);
    else out.push('Nothing linked yet — `!link 0xYourPranaAddress` or `!link @yourmelekaccount`.');
  }
  return { reply: out.join('\n'), link: cur };
}
