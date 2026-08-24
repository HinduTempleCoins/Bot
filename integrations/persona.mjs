// persona.mjs — the thin, read-only aggregator behind the portable "signature card" (the
// better-than-Gravatar cross-surface identity). Keyed by a MELEK account name; every field is looked
// up from readers that already exist and soft-fails to null/empty so a partial persona still renders.
// READ-ONLY, zero keys, never throws. See .local/PORTABLE_IDENTITY_SIGCARD_SPEC.md.
//
// First increment: avatar + REN name (best-effort) + MELEK balances. PRANA capital + game chips layer
// in next rungs. Injectable fetch (delegated to melek-chain) so it unit-tests fully offline.
//
//   import { persona, __setFetch } from './persona.mjs'
//   const p = await persona('hathor')   // -> { account, renName, avatarUrl, balances, postCount, created, network, ok }

import { accountInfo, __setFetch as chainSetFetch, networkLabel } from './melek-chain.mjs';

// Inject fetch for tests — delegates to the underlying chain reader (the only network call here).
export function __setFetch(fn) { chainSetFetch(fn); }

// Public avatar host for the card's <image>. Same-origin relative default so it works when the card
// service sits behind the same domain as the avatar service; override for cross-host embeds.
const AVATAR_BASE = (process.env.PERSONA_AVATAR_BASE || process.env.MELEK_PUBLIC_BASE || '').replace(/\/$/, '');

const REN_TLD = /\.(melek|prana|kula)$/i;

/**
 * persona(name) — assemble the portable persona for a MELEK account (or a .melek/.prana/.kula name,
 * best-effort: the label is used as the account until full REN resolution lands as its own rung).
 * Every sub-read soft-fails; a fully-unreachable RPC still yields a valid { account, ok:false } object.
 */
export async function persona(name) {
  const raw = String(name || '').trim().toLowerCase();
  const renName = REN_TLD.test(raw) ? raw : null;
  const account = raw.replace(REN_TLD, '');
  if (!account) return { account: '', renName, avatarUrl: '', balances: { liquid: null, stable: null, vesting: null }, postCount: null, created: null, network: safeLabel(), ok: false };

  const info = await accountInfo(account).catch(() => null);
  const avatarUrl = `${AVATAR_BASE}/u/${account}/avatar`;
  return {
    account,
    renName,
    avatarUrl,
    balances: info?.balances || { liquid: null, stable: null, vesting: null },
    postCount: info?.postCount ?? null,
    created: info?.created ?? null,
    network: safeLabel(),
    ok: !!info,
  };
}

function safeLabel() { try { return networkLabel(); } catch { return ''; } }
