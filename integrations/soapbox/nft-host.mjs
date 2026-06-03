// nft-host.mjs — the SoapBox "SourceForge-type" NFT file host (directory queue #139).
//
// Files uploaded here are owned/tradable/license-bearing NFTs that settle on SOAP. The chain
// stores only the content hash + license record (an ERC-1155 mint anchor + a Lit token-gating
// reference), NOT the file bytes themselves. The bytes live in decentralized storage (IPFS via
// Pinata / web3.storage, optionally mirrored to Arweave). This module is the host-side glue:
//
//   - pin({file|bytes|stub})  -> {cid, uri}   (soft-fails / dry-runs without creds)
//   - contentHash(bytes)      -> sha256 hex    (PURE — the scan-and-anchor integrity edge)
//   - licenseRecord({cid, license, editions}) -> on-chain-ready hash+license record (PURE)
//   - verifyAnchor(bytes, anchoredHash)        -> {ok, hash} re-hash & compare (PURE)
//
// All credentials come from process.env.*_KEY and are soft-fail: no key => dry-run, never throw,
// never log/print the key. ESM, node:crypto for hashing.
//
//   import { pin, contentHash, licenseRecord, verifyAnchor } from './nft-host.mjs'
//   node integrations/soapbox/nft-host.mjs

import { createHash } from 'node:crypto';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxNFTHost/1.0 (+https://data.soapbox.community)' };

// ── PURE pieces ──────────────────────────────────────────────────────────────

// Normalize arbitrary input (Buffer / Uint8Array / string / {bytes} / {file:{bytes}}) to a Buffer.
export function toBytes(input) {
  if (input == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  if (typeof input === 'object') {
    if (input.bytes != null) return toBytes(input.bytes);
    if (input.file != null) return toBytes(input.file);
    if (input.content != null) return toBytes(input.content);
    if (typeof input.text === 'string') return Buffer.from(input.text, 'utf8');
  }
  throw new TypeError('toBytes: unsupported input');
}

// sha256 hex of the content. This is the scan-and-anchor integrity edge: the exact value anchored
// on-chain. Deterministic for identical bytes.
export function contentHash(bytes) {
  return createHash('sha256').update(toBytes(bytes)).digest('hex');
}

// Build an on-chain-ready hash + license record. Stored on SOAP (the chain holds this, not the
// file). Shaped for an ERC-1155 mint (editions = supply) plus a Lit token-gating reference.
const LICENSES = new Set(['CC0', 'CC-BY', 'CC-BY-SA', 'CC-BY-NC', 'ARR', 'CUSTOM']);
export function licenseRecord({ cid, license = 'ARR', editions = 1, hash = null, name = null } = {}) {
  if (!cid) throw new Error('licenseRecord: cid required');
  const lic = String(license).toUpperCase();
  const ed = Number.isFinite(editions) && editions >= 1 ? Math.floor(editions) : 1;
  return {
    standard: 'ERC-1155',
    settlement: 'SOAP',
    cid,
    uri: `ipfs://${cid}`,
    contentHash: hash || null,           // sha256 hex; the file's integrity anchor
    license: LICENSES.has(lic) ? lic : 'CUSTOM',
    licenseRaw: license,
    editions: ed,                         // ERC-1155 supply
    name: name || null,
    tokenGate: { provider: 'Lit', condition: { chain: 'SOAP', cid } },
    version: 1,
  };
}

// Re-hash bytes and compare against a previously anchored hash (constant-ish equality).
export function verifyAnchor(bytes, anchoredHash) {
  const hash = contentHash(bytes);
  const expected = String(anchoredHash || '').toLowerCase().trim();
  return { ok: hash === expected, hash, expected };
}

// ── Storage adapters (soft-fail / dry-run without creds) ─────────────────────

function dryRunCid(bytes) {
  // Deterministic stub CID derived from the content hash — lets callers wire the flow without creds.
  return `dryrun-${contentHash(bytes).slice(0, 46)}`;
}

// IPFS via Pinata (PINATA_JWT) or web3.storage (WEB3STORAGE_KEY). Returns {cid} or null on soft-fail.
async function pinIPFS(bytes) {
  const pinataJwt = process.env.PINATA_JWT || process.env.PINATA_KEY;
  const web3Key = process.env.WEB3STORAGE_KEY || process.env.WEB3_STORAGE_KEY;
  try {
    if (pinataJwt) {
      const fd = new FormData();
      fd.append('file', new Blob([bytes]));
      const r = await _fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: { ...UA, Authorization: `Bearer ${pinataJwt}` },
        body: fd,
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j.IpfsHash ? { cid: j.IpfsHash, provider: 'pinata' } : null;
    }
    if (web3Key) {
      const r = await _fetch('https://api.web3.storage/upload', {
        method: 'POST',
        headers: { ...UA, Authorization: `Bearer ${web3Key}` },
        body: bytes,
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j.cid ? { cid: j.cid, provider: 'web3.storage' } : null;
    }
  } catch {
    return null; // soft-fail: network/credential trouble never throws
  }
  return null; // no creds
}

// Optional Arweave mirror (ARWEAVE_KEY). Best-effort; returns an arweave id or null. Soft-fail.
async function mirrorArweave(bytes) {
  const key = process.env.ARWEAVE_KEY;
  if (!key) return null;
  try {
    const r = await _fetch('https://arweave.net/tx', {
      method: 'POST',
      headers: { ...UA, Authorization: `Bearer ${key}`, 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    if (!r.ok) return null;
    const id = (await r.text()).trim();
    return id ? { id, uri: `ar://${id}` } : null;
  } catch {
    return null;
  }
}

// pin: upload to decentralized storage and return {cid, uri}. Soft-fails to a deterministic dry-run
// CID when no creds are present (or storage is unreachable), so the anchor/license flow stays wirable.
export async function pin(input) {
  const bytes = toBytes(input);
  const hash = contentHash(bytes);
  const ipfs = await pinIPFS(bytes);
  const arweave = await mirrorArweave(bytes).catch(() => null);

  if (ipfs && ipfs.cid) {
    return {
      cid: ipfs.cid,
      uri: `ipfs://${ipfs.cid}`,
      contentHash: hash,
      provider: ipfs.provider,
      arweave: arweave || null,
      dryRun: false,
    };
  }
  const cid = dryRunCid(bytes);
  return {
    cid,
    uri: `ipfs://${cid}`,
    contentHash: hash,
    provider: 'dryrun',
    arweave: arweave || null,
    dryRun: true,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith('nft-host.mjs')) {
  const sample = Buffer.from('SoapBox NFT host — sample file bytes\n');
  const res = await pin({ bytes: sample });
  const rec = licenseRecord({ cid: res.cid, license: 'CC-BY-NC', editions: 100, hash: res.contentHash, name: 'sample' });
  const check = verifyAnchor(sample, res.contentHash);
  console.log('pin:', { cid: res.cid, uri: res.uri, provider: res.provider, dryRun: res.dryRun });
  console.log('contentHash:', res.contentHash);
  console.log('verifyAnchor:', check.ok ? 'OK (matches)' : 'MISMATCH');
  console.log('licenseRecord:', JSON.stringify(rec, null, 2));
}
