// site/connect/genai.mjs — Pentecaust Connect as the KEY CUSTODIAN for Hathor Studio image generation.
//
// A user keeps their provider keys (fal.ai, Gemini, or their own worker on a PC/Colab/Modal GPU) in
// Pentecaust Connect. The Studio never receives a key. Instead:
//   1. LINK — the Studio opens connect.pentecaust.com/studio-link in a popup. The user is signed in there
//      (MELEK-Signer session, first-party cookie), so Connect mints a short-lived LINK TOKEN whose only
//      power is "run an image generation with this account's stored keys", and postMessages it to the
//      Studio's origin (exact allowlist) — never to anyone else.
//   2. USE — the Studio calls POST /v1/genai/image with that token (Bearer, no cookies, CORS to the
//      allowlisted origin). Connect runs the provider call INSIDE useConnection(): the key is decrypted
//      only inside the callback, the image comes back, the key does not.
// The token is HMAC-signed (CONNECT_LINK_SECRET), scoped "genai:image", expires (default 24h). It is not
// a login: it cannot read, add or revoke keys, and it cannot be used for any other provider operation.
//
// Own-worker keys are {url, token}. The URL is fetched FROM OUR SERVER, so it must be https and must not
// resolve to a private / loopback / link-local address (SSRF guard).

import crypto from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const LINK_SCOPE = 'genai:image';
export const GENAI_PROVIDERS = [
  { id: 'fal', name: 'fal.ai', keyHelp: 'fal.ai → Dashboard → Keys → create a key' },
  { id: 'gemini', name: 'Google Gemini', keyHelp: 'aistudio.google.com/apikey' },
  { id: 'worker', name: 'My own worker (PC · Colab · Modal GPU)', keyHelp: 'your worker URL + the CPU_SD_TOKEN password you set' },
];
const PROVIDER_IDS = new Set(GENAI_PROVIDERS.map((p) => p.id));

export const allowedOrigins = () => String(process.env.CONNECT_STUDIO_ORIGINS || 'https://hathor.soapbox.community')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
export const isAllowedOrigin = (o) => !!o && allowedOrigins().includes(String(o).replace(/\/+$/, ''));

// ── link tokens ────────────────────────────────────────────────────────────────────────────────
let _devSecret = null;
function linkSecret() {
  const s = process.env.CONNECT_LINK_SECRET;
  if (s && s.trim()) return s.trim();
  if (!_devSecret) _devSecret = crypto.randomBytes(32).toString('hex'); // per-process dev fallback
  return _devSecret;
}
let _now = () => Date.now();
export function __setClock(fn) { _now = typeof fn === 'function' ? fn : () => Date.now(); }
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (body) => b64u(crypto.createHmac('sha256', linkSecret()).update(body).digest());

export function mintLinkToken(account, { ttlMs = 24 * 3600 * 1000, origin = '' } = {}) {
  const body = b64u(JSON.stringify({ a: String(account), s: LINK_SCOPE, o: String(origin), e: _now() + ttlMs }));
  return `pcl1.${body}.${sign(body)}`;
}

/** → { account, origin } for a valid, unexpired, correctly-scoped token; else null. */
export function verifyLinkToken(token) {
  const m = /^pcl1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token || ''));
  if (!m) return null;
  const want = Buffer.from(sign(m[1])); const got = Buffer.from(m[2]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let p; try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!p || p.s !== LINK_SCOPE || !p.a || !(p.e > _now())) return null;
  return { account: p.a, origin: p.o || '' };
}

export const bearer = (req) => {
  const h = String((req && req.headers && req.headers.authorization) || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
};

// ── the popup page that hands the token to the Studio ─────────────────────────────────────────
const jsStr = (s) => JSON.stringify(String(s == null ? '' : s)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
export function linkPageHtml({ token, account, origin, providers }) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=robots content=noindex>
<title>Linked — Pentecaust</title></head><body style="font:15px system-ui;background:#0b0d12;color:#e9eef5;padding:24px">
<p>Linked <b>@${String(account).replace(/[&<>"']/g, '')}</b> to Hathor Studio. You can close this window.</p>
<script>(function(){ if(window.opener){ window.opener.postMessage({type:'pentecaust-link', token:${jsStr(token)},
 account:${jsStr(account)}, providers:${JSON.stringify(providers || []).replace(/</g, '\\u003c')}}, ${jsStr(origin)}); setTimeout(function(){window.close();},400);} })();</script>
</body></html>`;
}

// ── provider calls (run INSIDE useConnection — `secret` never leaves this module's callbacks) ─────
let _fetch = (...a) => fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : (...a) => fetch(...a); }
let _resolve = async (host) => (await lookup(host, { all: true })).map((r) => r.address);
export function __setResolver(fn) { _resolve = typeof fn === 'function' ? fn : async (host) => (await lookup(host, { all: true })).map((r) => r.address); }

function privateAddr(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') ||
    (v.startsWith('::ffff:') && privateAddr(v.slice(7)));
}

/** SSRF guard for a user-supplied worker URL. → normalised base URL, or throws. */
export async function safeWorkerBase(url) {
  let u; try { u = new URL(String(url || '')); } catch { throw new Error('worker URL is not a URL'); }
  if (u.protocol !== 'https:') throw new Error('worker URL must be https (Modal and tunnels give you one)');
  if (u.username || u.password) throw new Error('put the password in the password field, not the URL');
  const host = u.hostname.replace(/^\[|\]$/g, ''); // IPv6 literals keep their brackets in URL.hostname
  const ips = net.isIP(host) ? [host] : await _resolve(host).catch(() => []);
  if (!ips.length) throw new Error('worker host does not resolve');
  if (ips.some(privateAddr)) throw new Error('worker URL points at a private address');
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

const sizeWH = (size) => { const m = /(\d+)\s*x\s*(\d+)/.exec(String(size || '')); return m ? { width: +m[1], height: +m[2] } : { width: 768, height: 768 }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runFal(key, job) {
  const model = job.image ? 'fal-ai/flux/dev/image-to-image' : 'fal-ai/flux/schnell';
  const input = job.image ? { prompt: job.prompt, image_url: job.image, strength: 0.85 } : { prompt: job.prompt, image_size: sizeWH(job.size) };
  const r = await _fetch(`https://fal.run/${model}`, { method: 'POST', headers: { authorization: `Key ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const j = await r.json().catch(() => null);
  const url = j && j.images && j.images[0] && j.images[0].url;
  if (!r.ok || !url) throw new Error((j && (j.detail || j.error)) ? String(j.detail || j.error).slice(0, 160) : `fal HTTP ${r.status}`);
  return { src: url, note: `your fal.ai key (${model})` };
}

async function runGemini(key, job) {
  const parts = [{ text: job.prompt }];
  if (job.image) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(job.image);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  const r = await _fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ parts }] }) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error && j.error.message) ? String(j.error.message).slice(0, 160) : `Gemini HTTP ${r.status}`);
  const ps = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  for (const p of ps) { const d = p.inlineData || p.inline_data; if (d && d.data) return { src: `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`, note: 'your Gemini key' }; }
  throw new Error('Gemini returned no image');
}

async function runWorker(secret, job, { pollMs = 2000, maxPolls = 450 } = {}) {
  let cfg; try { cfg = JSON.parse(secret); } catch { throw new Error('stored worker key is not {url, token}'); }
  const base = await safeWorkerBase(cfg.url);
  const headers = { 'content-type': 'application/json' };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  const body = { prompt: job.prompt, size: job.size, steps: 6 };
  if (job.image) { const m = /^data:[^;]+;base64,(.+)$/.exec(job.image); if (m) body.image = { base64: m[1] }; }
  const s = await _fetch(`${base}/jobs`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error' });
  const sj = await s.json().catch(() => null);
  if (!s.ok || !sj || !sj.id) throw new Error((sj && sj.error) || `worker HTTP ${s.status}`);
  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollMs);
    const p = await _fetch(`${base}/jobs/${encodeURIComponent(sj.id)}`, { headers, redirect: 'error' }).then((r) => r.json()).catch(() => null);
    if (!p) continue;
    if (p.status === 'done' && p.result && p.result.base64) return { src: `data:${p.result.mime || 'image/png'};base64,${p.result.base64}`, note: `your worker (${p.result.mode})` };
    if (p.status === 'error') throw new Error((p.result && p.result.error) || 'render failed');
  }
  throw new Error('your worker timed out');
}

export const RUNNERS = { fal: runFal, gemini: runGemini, worker: runWorker };

/** Normalise + validate an image request. → { ok, job } | { ok:false, reason } */
export function normImageJob(b) {
  const provider = String((b && b.provider) || '').toLowerCase();
  if (!PROVIDER_IDS.has(provider)) return { ok: false, reason: 'unknown provider' };
  const prompt = String((b && b.prompt) || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  if (!prompt) return { ok: false, reason: 'empty prompt' };
  const image = typeof (b && b.image) === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(b.image) ? b.image : null;
  const size = /^\d{3,4}x\d{3,4}$/.test(String((b && b.size) || '')) ? b.size : '768x768';
  return { ok: true, provider, job: { prompt, size, image } };
}

export default { LINK_SCOPE, GENAI_PROVIDERS, mintLinkToken, verifyLinkToken, linkPageHtml, safeWorkerBase, normImageJob, RUNNERS, isAllowedOrigin, allowedOrigins, bearer };
