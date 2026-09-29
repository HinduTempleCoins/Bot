// harddrive.mjs — HardDrive: send very big files by sharing a LINK, not the bytes. Storage-agnostic
// (S3-compatible: Cloudflare R2 default, or a user's BYO bucket / MinIO / Backblaze B2). The bytes go
// browser → object storage directly via a PRESIGNED URL (SigV4), so our CPU box never proxies gigabytes and
// there is no practical size limit. We mint a gated, expiring share link; the recipient downloads via a
// presigned GET. No AWS SDK — a minimal SigV4 presigner on node:crypto. Pure + offline-testable.
//
//   import { presignPut, presignGet, makeShareLink, checkAccess, storageConfig } from './harddrive.mjs'
//   const cfg = storageConfig();                       // env (R2 default) or pass a BYO {…} config
//   const putUrl = presignPut(cfg, 'u/ryan/plan.pdf', { contentType:'application/pdf', expiresIn:900 });
//   // browser PUTs the file to putUrl, then:
//   const link = makeShareLink({ key:'u/ryan/plan.pdf', owner:'ryan', expiresIn: 7*86400 });
//   // recipient hits /drive/d/<link.id> → checkAccess → presignGet → 302 to the file.

import crypto from 'node:crypto';

let _now = () => Date.now();
export function __setNow(f) { _now = f || (() => Date.now()); }

const env = (k, d = '') => (process.env[k] != null && process.env[k] !== '' ? String(process.env[k]) : d);

// Storage config: default from env (Cloudflare R2), or a BYO object {endpoint, region, bucket, accessKeyId,
// secretAccessKey, publicHost?}. `configured` is false until the operator drops an R2 token in — the surface
// then shows "storage not configured" instead of pretending to work.
export function storageConfig(byo = null) {
  if (byo && byo.accessKeyId && byo.secretAccessKey && byo.bucket && byo.endpoint) {
    return { ...byo, region: byo.region || 'auto', configured: true, source: 'byo' };
  }
  const endpoint = env('DRIVE_S3_ENDPOINT'); // e.g. https://<acct>.r2.cloudflarestorage.com
  const bucket = env('DRIVE_S3_BUCKET');
  const accessKeyId = env('DRIVE_S3_KEY');
  const secretAccessKey = env('DRIVE_S3_SECRET');
  const configured = !!(endpoint && bucket && accessKeyId && secretAccessKey);
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: env('DRIVE_S3_REGION', 'auto'), publicHost: env('DRIVE_PUBLIC_HOST', ''), configured, source: 'env' };
}

// ── minimal SigV4 presigner (query-auth, UNSIGNED-PAYLOAD) — works for R2/S3/B2/MinIO ────────────────
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p) => p.split('/').map(enc).join('/');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
const sha256hex = (data) => crypto.createHash('sha256').update(data, 'utf8').digest('hex');
const amzDate = (ms) => new Date(ms).toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ

function signingKey(secret, dateStamp, region, service) {
  return hmac(hmac(hmac(hmac('AWS4' + secret, dateStamp), region), service), 'aws4_request');
}

// Build a presigned URL for a method (PUT/GET) on {bucket}/{key}. Path-style (R2/MinIO friendly).
// contentLength (PUT): the exact byte count is SIGNED into the URL, so storage rejects any upload of a different
// size — that is how a size limit is enforced without our server ever touching the bytes.
function presign(cfg, method, key, { expiresIn = 900, extraQuery = {}, contentLength = null } = {}) {
  if (!cfg || !cfg.configured) throw new Error('drive: storage not configured');
  const now = _now();
  const date = amzDate(now);
  const dateStamp = date.slice(0, 8);
  const host = new URL(cfg.endpoint).host;
  const service = 's3';
  const region = cfg.region || 'auto';
  const credScope = `${dateStamp}/${region}/${service}/aws4_request`;
  // key === null → a bucket-level operation (create/head the bucket); otherwise an object under the bucket.
  const canonicalUri = key == null ? `/${cfg.bucket}` : `/${cfg.bucket}/${encPath(String(key).replace(/^\/+/, ''))}`;
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKeyId}/${credScope}`,
    'X-Amz-Date': date,
    'X-Amz-Expires': String(Math.max(1, Math.min(604800, expiresIn | 0))),
    'X-Amz-SignedHeaders': contentLength != null ? 'content-length;host' : 'host',
    ...extraQuery,
  };
  const canonicalQuery = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join('&');
  const canonicalHeaders = (contentLength != null ? `content-length:${contentLength | 0}\n` : '') + `host:${host}\n`;
  const signedHeaders = contentLength != null ? 'content-length;host' : 'host';
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', date, credScope, sha256hex(canonicalRequest)].join('\n');
  const sig = hmac(signingKey(cfg.secretAccessKey, dateStamp, region, service), stringToSign).toString('hex');
  return `${cfg.endpoint.replace(/\/$/, '')}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${sig}`;
}

export function presignPut(cfg, key, { expiresIn = 900, contentLength = null } = {}) {
  return presign(cfg, 'PUT', key, { expiresIn, contentLength });
}

// ── free-tier limits (our own storage). A user's OWN bucket (BYO) is not limited by us. ──────────────
const envNum = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
export const limits = () => ({
  maxFileBytes: envNum('HD_MAX_FILE_BYTES', 2 * 1024 ** 3),     // 2 GiB per file
  dailyBytes: envNum('HD_DAILY_BYTES', 10 * 1024 ** 3),         // 10 GiB per visitor per day
});
const _usage = new Map(); // visitor -> { day, bytes }
export function checkQuota(visitor, bytes, now = _now()) {
  const L = limits();
  const n = Math.floor(Number(bytes));
  if (!(n > 0)) return { ok: false, code: 400, error: 'the file size is required' };
  if (n > L.maxFileBytes) return { ok: false, code: 413, error: `files up to ${Math.round(L.maxFileBytes / 1024 ** 3)} GB on free storage — connect your own storage for bigger files` };
  const day = new Date(now).toISOString().slice(0, 10);
  const u = _usage.get(visitor) || { day, bytes: 0 };
  if (u.day !== day) { u.day = day; u.bytes = 0; }
  if (u.bytes + n > L.dailyBytes) return { ok: false, code: 429, error: `today's free allowance (${Math.round(L.dailyBytes / 1024 ** 3)} GB) is used — try tomorrow, or connect your own storage` };
  u.bytes += n; _usage.set(visitor, u);
  return { ok: true, bytes: n };
}
export function __resetQuota() { _usage.clear(); }
export function presignGet(cfg, key, { expiresIn = 900, downloadName = '' } = {}) {
  const extraQuery = downloadName ? { 'response-content-disposition': `attachment; filename="${downloadName.replace(/["\\]/g, '')}"` } : {};
  return presign(cfg, 'GET', key, { expiresIn, extraQuery });
}

// ── share links: a small record you store (JSON/db). Gated + expiring + optional password. ──────────
const rand = (n = 16) => crypto.randomBytes(n).toString('base64url');
const pwHash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');

export function objectKey(owner, filename) {
  const safeOwner = String(owner || 'anon').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'anon';
  const safeName = String(filename || 'file').replace(/[^a-z0-9._-]/gi, '_').slice(0, 120) || 'file';
  return `u/${safeOwner}/${Date.now().toString(36)}-${rand(4)}/${safeName}`;
}

// Make a shareable link record. `requireLogin` = gate to a MELEK-Signer-authenticated recipient.
export function makeShareLink({ key, owner, filename = '', bytes = 0, expiresIn = 7 * 86400, password = '', requireLogin = false } = {}) {
  if (!key) throw new Error('drive: key required');
  const now = _now();
  const rec = {
    id: rand(12), key, owner: owner || 'anon', filename, bytes: bytes | 0,
    createdAt: now, expiresAt: expiresIn ? now + expiresIn * 1000 : 0,
    requireLogin: !!requireLogin, hasPassword: !!password,
  };
  if (password) { rec.pwSalt = rand(8); rec.pwHash = pwHash(password, rec.pwSalt); }
  return rec;
}

// Check whether a request may download. Returns {ok} or {ok:false, reason}. Never throws.
export function checkAccess(rec, { password = '', loggedIn = false } = {}) {
  if (!rec || !rec.key) return { ok: false, reason: 'not-found' };
  if (rec.expiresAt && _now() > rec.expiresAt) return { ok: false, reason: 'expired' };
  if (rec.requireLogin && !loggedIn) return { ok: false, reason: 'login-required' };
  if (rec.hasPassword) {
    if (!password) return { ok: false, reason: 'password-required' };
    let match = false;
    try { match = crypto.timingSafeEqual(Buffer.from(pwHash(password, rec.pwSalt), 'hex'), Buffer.from(rec.pwHash, 'hex')); } catch { match = false; }
    if (!match) return { ok: false, reason: 'password-wrong' };
  }
  return { ok: true };
}

if (process.argv[1] && process.argv[1].endsWith('harddrive.mjs')) {
  const cfg = storageConfig();
  console.log('storage configured:', cfg.configured, '| source:', cfg.source, '| bucket:', cfg.bucket || '(none)');
  if (cfg.configured) console.log('sample PUT url:', presignPut(cfg, objectKey('demo', 'plan.pdf')).slice(0, 120) + '…');
}
