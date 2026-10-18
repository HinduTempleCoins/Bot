// profile-ops.mjs — the pure parts of the MELEK profile-picture editor (profile.html).
//
// The picture is saved with account_update2 (op 43, live since HF21 on this Steem fork) writing ONLY
// posting_json_metadata — which the chain authorises with the POSTING key (database_api says so:
// get_potential_signatures for this op returns the posting key). No active key is involved.
//
// dsteem 0.11.1 (what the page uses to sign) has no account_update2 serializer, so this module
// serialises the transaction itself; the page also asks the node (condenser_api.get_transaction_hex)
// to serialise the same transaction and refuses to sign if the two differ.
//
// Runs in the browser and in Node (offline tests). No keys are handled here except reading the
// condenser's own saved-login record (localStorage `autopost2`) from this same origin.

export const IMAGE_CHALLENGE_PREFIX = 'ImageSigningChallenge';
export const ACCOUNT_UPDATE2_ID = 43;

const enc = new TextEncoder();

function concat(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function hexToBytes(hex) {
  const h = String(hex || '');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
export function bytesToHex(b) { return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }

async function sha256(bytes) {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

/**
 * The condenser's saved login (localStorage `autopost2`, hex of "user\tpostingWif\tmemo\t…") →
 * { username, postingWif } | null. postingWif is '' when the login was saved without a key (keychain).
 */
export function readSavedLogin(hex) {
  try {
    if (!/^[0-9a-f]+$/i.test(String(hex || ''))) return null;
    const [username, wif] = new TextDecoder().decode(hexToBytes(hex)).split('\t');
    if (!/^[a-z][a-z0-9.-]{1,15}$/.test(username || '')) return null;
    return { username, postingWif: /^5[1-9A-HJ-NP-Za-km-z]{50}$/.test(wif || '') ? wif : '' };
  } catch { return null; }
}

/** An image URL the avatar route will serve: https only, no characters that break a CSS url(). */
export function isUsableImageUrl(url) {
  const u = String(url || '').trim();
  return u.length <= 1024 && /^https:\/\/[^\s"'<>()\\]+$/i.test(u);
}

function parseObj(s) {
  try { const o = JSON.parse(s || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}

/**
 * The new posting_json_metadata string: keeps every existing key; the profile starts from
 * posting_json_metadata.profile, or — when that has never been set — from json_metadata.profile
 * (so a first posting-key save does not drop a name/about set earlier with the active key).
 * profile_image = '' removes the picture.
 */
export function buildPostingMetadata(postingMetaStr, jsonMetaStr, { profile_image } = {}) {
  const posting = parseObj(postingMetaStr);
  const base = posting.profile && typeof posting.profile === 'object' ? posting.profile
    : (parseObj(jsonMetaStr).profile || {});
  const profile = { ...(typeof base === 'object' ? base : {}) };
  delete profile.user_image; // legacy field
  if (profile_image) profile.profile_image = String(profile_image).trim();
  else delete profile.profile_image;
  return JSON.stringify({ ...posting, profile });
}

// ── Graphene binary serialisation (just what account_update2 needs) ─────────────────────────────

export function varint32(n) {
  const out = [];
  let v = n >>> 0;
  while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v);
  return new Uint8Array(out);
}
function str(s) { const b = enc.encode(String(s)); return concat(varint32(b.length), b); }
function u16(n) { return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]); }
function u32(n) { return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]); }

/** ISO "2026-10-18T04:00:00" (UTC, no zone) → unix seconds. */
export function expirationSeconds(iso) { return Math.floor(Date.parse(String(iso).replace(/Z?$/, 'Z')) / 1000); }

/** The unsigned transaction object (JSON form the node accepts). */
export function accountUpdate2Tx({ ref_block_num, ref_block_prefix, expiration, account, posting_json_metadata }) {
  return {
    ref_block_num, ref_block_prefix, expiration,
    operations: [['account_update2', { account, json_metadata: '', posting_json_metadata, extensions: [] }]],
    extensions: [],
  };
}

/** Serialise an unsigned account_update2 tx (no signatures array) → bytes. */
export function serializeAccountUpdate2Tx(tx) {
  const op = tx.operations[0][1];
  return concat(
    u16(tx.ref_block_num), u32(tx.ref_block_prefix), u32(expirationSeconds(tx.expiration)),
    varint32(1), varint32(ACCOUNT_UPDATE2_ID),
    str(op.account),
    new Uint8Array([0, 0, 0, 0]),   // owner, active, posting, memo_key: all absent
    str(op.json_metadata || ''), str(op.posting_json_metadata), varint32(0),  // op extensions
    varint32(0),                    // tx extensions
  );
}

/** Reference block fields from get_dynamic_global_properties. */
export function refBlock(props) {
  const id = hexToBytes(props.head_block_id);
  return {
    ref_block_num: props.head_block_number & 0xffff,
    ref_block_prefix: (id[4] | (id[5] << 8) | (id[6] << 16) | (id[7] << 24)) >>> 0,
    expiration: new Date(Date.parse(props.time + 'Z') + 60_000).toISOString().slice(0, 19),
  };
}

/** sha256(chain_id || tx) — what the posting key signs. */
export async function txDigest(chainIdHex, txBytes) { return sha256(concat(hexToBytes(chainIdHex), txBytes)); }

/** sha256("ImageSigningChallenge" || imageBytes) — what the image hoster checks the upload signature against. */
export async function uploadChallengeDigest(bytes) { return sha256(concat(enc.encode(IMAGE_CHALLENGE_PREFIX), bytes)); }
