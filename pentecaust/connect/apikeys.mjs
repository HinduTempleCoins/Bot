// pentecaust/connect/apikeys.mjs — BRING YOUR OWN KEY: a signed-in Pentecaust account stores ITS OWN
// provider API keys and Hathor Metatron (writing, images, video) and Hathor Sandalphon (songs) use them
// for that account's work. Same shape as the Herald mailbox connector: the user connects something that
// belongs to them, scoped to their one MELEK identity, and nobody else can see or use it.
//
// WHY: our own CPU pool is slow and shared. A user with an OpenAI / Stability / Replicate / Suno account
// can spend their own quota and get their result now. Their key, their bill, their rate limits.
//
// SECURITY RULES, LOAD-BEARING:
//   • A key is WRITE-ONLY from the outside. getMasked() is what any UI or API ever returns ("sk-…a1b2").
//     The full secret leaves this module only through useKey(), for that account's own request.
//   • Keys are NEVER logged, never echoed into HTML, never put in a URL, never sent to another account.
//   • Owner-scoped: every read/write takes the acting account; there is no cross-account read.
//   • This file-store is the alpha shape (offline-testable, matches the repo pattern). PRODUCTION MUST
//     encrypt at rest — same note as connect/mailbox.mjs.
//   • A key is only ever sent to its provider's own host (PROVIDERS[].host), never anywhere else.
//
//   import { setKey, getMasked, listKeys, removeKey, useKey, PROVIDERS } from './apikeys.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('APIKEYS_DATA', join(process.cwd(), 'data', 'apikeys.json'));

// The providers a user may connect. `part` says which side of Hathor uses it; `host` is the ONLY host the
// key may ever be sent to. A provider not in this list cannot be stored at all.
export const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', part: 'metatron', host: 'api.openai.com', what: 'writing help and images (GPT, DALL·E)', hint: 'sk-…' },
  { id: 'anthropic', label: 'Anthropic', part: 'metatron', host: 'api.anthropic.com', what: 'writing help (Claude)', hint: 'sk-ant-…' },
  { id: 'stability', label: 'Stability AI', part: 'metatron', host: 'api.stability.ai', what: 'images and video', hint: 'sk-…' },
  { id: 'replicate', label: 'Replicate', part: 'both', host: 'api.replicate.com', what: 'images, video and song models', hint: 'r8_…' },
  { id: 'fal', label: 'fal.ai', part: 'both', host: 'fal.run', what: 'fast images, video and audio', hint: 'key id:secret' },
  { id: 'openrouter', label: 'OpenRouter', part: 'metatron', host: 'openrouter.ai', what: 'many writing models through one key', hint: 'sk-or-…' },
  { id: 'elevenlabs', label: 'ElevenLabs', part: 'sandalphon', host: 'api.elevenlabs.io', what: 'voices and sound', hint: 'sk_…' },
  { id: 'suno', label: 'Suno', part: 'sandalphon', host: 'studio-api.suno.ai', what: 'songs', hint: 'your API token' },
];
export const providerById = (id) => PROVIDERS.find((p) => p.id === String(id || '').toLowerCase()) || null;

const acct = (s) => String(s || '').toLowerCase().replace(/^@/, '').trim();
const now = (o) => (o && o.now != null ? o.now : Date.now());

// ── injectable fs + store (same discipline as the other pentecaust stores) ──────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch { /* exists */ } writeFileSync(p, s, { mode: 0o600 }); },
};
let _fs = realFs;
export function __setIO(io) { _fs = io || realFs; }

function load(file) {
  const raw = _fs.read(file || DATA_FILE());
  if (!raw) return {};
  try { const o = JSON.parse(raw); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
function save(store, file) {
  try { _fs.write(file || DATA_FILE(), JSON.stringify(store, null, 1)); return true; } catch { return false; }
}

/** last four characters only — this is the ONLY form that ever goes back out to a UI or an API */
export function mask(secret) {
  const s = String(secret || '');
  if (s.length <= 4) return s ? '…' + s.slice(-1) : '';
  return '…' + s.slice(-4);
}

/** Store (or replace) one provider key for one account. Returns the masked record, never the secret. */
export function setKey(account, provider, secret, opts = {}) {
  const a = acct(account); const p = providerById(provider);
  if (!a) return { ok: false, reason: 'sign in first' };
  if (!p) return { ok: false, reason: 'unknown provider' };
  const key = String(secret || '').trim();
  if (key.length < 8 || key.length > 400) return { ok: false, reason: 'that does not look like an API key' };
  if (/\s/.test(key)) return { ok: false, reason: 'an API key has no spaces in it' };
  const store = load(opts.file);
  const mine = store[a] || (store[a] = {});
  mine[p.id] = { key, added: now(opts), lastUsed: 0 };
  if (!save(store, opts.file)) return { ok: false, reason: 'could not save' };
  return { ok: true, provider: p.id, masked: mask(key) };
}

/** The masked form of one key, or null. Safe to render. */
export function getMasked(account, provider, opts = {}) {
  const rec = (load(opts.file)[acct(account)] || {})[String(provider || '').toLowerCase()];
  return rec ? { provider: String(provider).toLowerCase(), masked: mask(rec.key), added: rec.added, lastUsed: rec.lastUsed || 0 } : null;
}

/** Every provider, with whether this account has connected it. Never includes a secret. */
export function listKeys(account, opts = {}) {
  const mine = load(opts.file)[acct(account)] || {};
  return PROVIDERS.map((p) => {
    const rec = mine[p.id];
    return { id: p.id, label: p.label, part: p.part, what: p.what, hint: p.hint, host: p.host,
      connected: !!rec, masked: rec ? mask(rec.key) : '', added: rec ? rec.added : 0, lastUsed: rec ? rec.lastUsed || 0 : 0 };
  });
}

export function removeKey(account, provider, opts = {}) {
  const a = acct(account); const store = load(opts.file);
  const mine = store[a]; const id = String(provider || '').toLowerCase();
  if (!mine || !mine[id]) return { ok: true, removed: false };
  delete mine[id];
  if (!Object.keys(mine).length) delete store[a];
  return save(store, opts.file) ? { ok: true, removed: true } : { ok: false, reason: 'could not save' };
}

/**
 * Hand an account's own key to a caller for ONE request to that provider's own host.
 * `fn(secret)` runs with the secret; it is not returned, not logged, and not stored anywhere else.
 * Returns { ok, result } or { ok:false, reason }.
 */
export async function useKey(account, provider, fn, opts = {}) {
  const p = providerById(provider);
  if (!p) return { ok: false, reason: 'unknown provider' };
  const store = load(opts.file);
  const rec = (store[acct(account)] || {})[p.id];
  if (!rec) return { ok: false, reason: `connect your ${p.label} key first` };
  rec.lastUsed = now(opts); save(store, opts.file);
  try {
    const result = await fn(rec.key, p);
    return { ok: true, result };
  } catch {
    // never surface the provider's raw error — it can echo the key back in a URL
    return { ok: false, reason: `${p.label} did not answer` };
  }
}
