// credential-anchor.mjs — anchor a MELEK credential's verification hash permanently on-chain.
//
// Fills the credential system's `verification.anchor` seam for real. A credential is verifiable on its
// own (re-hash the fields), but an ANCHOR makes it tamper-proof AND permanent AND public: hathor records
// the credential's id + hash in a Graphene `custom_json` op on MELEK mainnet. Anyone can then read the
// chain and confirm the credential existed and has not been altered — the deepest layer of credibility.
//
// PRIVACY: the on-chain record carries only { id, hash, issuer, program, issuedAt } — NEVER the recipient's
// name. The hash already commits to the recipient (it's hashed into it), so a match proves the exact
// credential without publishing a person's name on a permanent public ledger.
//
// PURE op-building + verification here; the live broadcast is a GATED seam (a broadcaster is injected —
// the proven hathor path / MELEK-Signer). Zero-WIF: this module holds no key and broadcasts nothing itself.

export const ANCHOR_ID = 'melek_credential';   // the custom_json id namespace
export const ANCHOR_VERSION = 1;

const nn = (v) => (v == null ? '' : String(v));

/** The public, PII-free payload recorded on-chain for a credential. */
export function anchorPayload(cred) {
  if (!cred || !cred.id || !cred.verification) return null;
  return {
    v: ANCHOR_VERSION,
    id: cred.id,
    hash: cred.verification.hash,
    issuer: cred.issuer && cred.issuer.id,
    program: cred.program && cred.program.id,
    issuedAt: cred.issuedAt,
  };
}

/** The Graphene custom_json op that anchors the credential (posting authority of `anchorer`). */
export function anchorOp(cred, { anchorer = 'hathor' } = {}) {
  const payload = anchorPayload(cred);
  if (!payload) return null;
  return ['custom_json', {
    required_auths: [],
    required_posting_auths: [nn(anchorer)],
    id: ANCHOR_ID,
    json: JSON.stringify(payload),
  }];
}

/** A stable reference string to store back in verification.anchor once broadcast. */
export function anchorRef({ tx = '', block = 0 } = {}) {
  return `melek:${ANCHOR_ID}:${nn(tx) || '?'}${block ? `@${block}` : ''}`;
}

/** Return a copy of the credential with its anchor recorded (after a successful broadcast). */
export function applyAnchor(cred, { tx = '', block = 0 } = {}) {
  if (!cred || !cred.verification) return cred;
  return {
    ...cred,
    verification: { ...cred.verification, anchor: anchorRef({ tx, block }), anchorTx: nn(tx) || null, anchorBlock: block || null },
  };
}

/** Parse an on-chain custom_json `json` field (string or object) back to the payload, soft-failing to null. */
export function parseAnchorRecord(json) {
  try {
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    return o && o.id && o.hash ? o : null;
  } catch { return null; }
}

/** Confirm an on-chain record anchors this exact credential (id + hash must match). */
export function verifyAnchor(cred, onChainRecord) {
  const rec = parseAnchorRecord(onChainRecord);
  if (!cred || !cred.verification) return { anchored: false, reason: 'not-a-credential' };
  if (!rec) return { anchored: false, reason: 'no-on-chain-record' };
  if (rec.id !== cred.id) return { anchored: false, reason: 'id-mismatch' };
  if (rec.hash !== cred.verification.hash) return { anchored: false, reason: 'hash-mismatch (credential altered since anchoring)' };
  return { anchored: true, reason: 'anchored on MELEK', id: rec.id };
}

/**
 * Broadcast the anchor — GATED. Only runs when a broadcaster is injected (the proven hathor path /
 * MELEK-Signer). Returns { ok, tx } or { ok:false, reason }. Never signs here; never holds a key.
 * @param {{ broadcaster?: (ops:any[]) => Promise<{id?:string, block_num?:number}>, anchorer?: string }} deps
 */
export async function broadcastAnchor(cred, { broadcaster, anchorer = 'hathor' } = {}) {
  const op = anchorOp(cred, { anchorer });
  if (!op) return { ok: false, reason: 'not-a-credential' };
  if (typeof broadcaster !== 'function') return { ok: false, reason: 'no broadcaster (anchoring is gated — inject the hathor/Signer path)' };
  try {
    const r = await broadcaster([op]);
    const tx = (r && (r.id || r.tx)) || '';
    const block = (r && (r.block_num || r.block)) || 0;
    return { ok: true, tx, block, credential: applyAnchor(cred, { tx, block }) };
  } catch (e) {
    return { ok: false, reason: `broadcast-failed:${(e && e.message) || e}` };
  }
}

// CLI demo (guarded, offline — never broadcasts)
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('credential-anchor.mjs')) {
  const cred = { id: 'MELEK-CERT-ABC123', program: { id: 'angelic-ai-foundations' }, issuer: { id: 'academy' }, issuedAt: '2026-08-28', verification: { hash: 'deadbeef', method: 'sha256', anchor: null } };
  console.log('op:', JSON.stringify(anchorOp(cred)));
  const anchored = applyAnchor(cred, { tx: 'abc123tx', block: 784500 });
  console.log('anchor ref:', anchored.verification.anchor);
  console.log('verify (match):', verifyAnchor(anchored, JSON.stringify(anchorPayload(cred))));
  console.log('verify (tampered):', verifyAnchor({ ...anchored, verification: { ...anchored.verification, hash: 'other' } }, JSON.stringify(anchorPayload(cred))));
}
