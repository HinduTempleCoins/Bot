// secret-store.mjs — a RELIABLE, daemon-free replacement for the flaky Vaultwarden/bw vault
// (.local/infra/oracle-vm/server4/vault.mjs).
//
// WHY: the old vault shells out to the Bitwarden CLI (`bw`), which logs out on every call and
// intermittently fails "not logged in" — a login dance over a localhost daemon for what is really
// just "read/write a few encrypted strings on this box." This module deletes all of that: NO
// daemon, NO network, NO login. It is a single AES-256-GCM-encrypted JSON file on disk, keyed by a
// master passphrase supplied via an env var NAME (never hardcoded). Deterministic, offline,
// auth-tagged. Drop-in compatible method names so consumers can switch with a one-line import swap.
//
// SECURITY POSTURE (matches the house rules):
//   • No secrets in code. The master key is read from process.env[SECRET_STORE_KEY] by NAME only.
//   • Reads SOFT-FAIL, never throw: get()/list()/has() return null/[]/false on a missing or
//     unreadable file. Writes are allowed to throw (a failed write the caller must know about).
//   • Tamper / wrong-key is DETECTED, not silently wrong: AES-256-GCM's auth tag makes a wrong
//     master key or a mutated file fail to decrypt. We surface that as a loud console warning and a
//     soft-fail (empty) read — we never return garbage as if it were a real secret.
//   • dump()/exportAll() — the only paths that hand back plaintext values in bulk — are GUARDED
//     behind an explicit { confirm: true } argument, for migration/backup only.
//
//   import { get, set, note, list, remove, has, importFromBitwarden, dump } from './integrations/secret-store.mjs'
//   set('GEMINI_KEY', process.env.GEMINI_KEY, { url: 'https://ai.google.dev', type: 'login' })
//   const k = get('GEMINI_KEY')            // value | null  (soft-fail)
//   note('DEPLOY_NOTES', '...freeform...') // a 'note' item
//   list()                                 // ['GEMINI_KEY', 'DEPLOY_NOTES']  — NAMES ONLY
//   remove('GEMINI_KEY'); has('GEMINI_KEY') // false
//
//   node integrations/secret-store.mjs list
//   node integrations/secret-store.mjs get  <name>
//   node integrations/secret-store.mjs set  <name> <value> [url]
//   node integrations/secret-store.mjs import <bw-export.json>
//
// File format (on disk): a small JSON envelope, all base64. The auth tag binds the ciphertext so
// any edit (or a wrong key) is caught on decrypt:
//   { "v": 1, "alg": "aes-256-gcm", "kdf": "scrypt", "salt": "...", "iv": "...", "tag": "...", "ct": "..." }

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ---- configuration (env names only; never hardcode a secret) ----
// The env var that NAMES where the master key lives. We read process.env[KEY_ENV] for the key.
const KEY_ENV = 'SECRET_STORE_KEY';
// The env var that names the on-disk file path; defaults to a gitignored data/ path.
const FILE_ENV = 'SECRET_STORE_FILE';
const DEFAULT_FILE = path.join(process.cwd(), 'data', 'secrets', 'secret-store.json.enc');

function storeFile() {
  const p = process.env[FILE_ENV];
  return p && String(p).trim() ? String(p).trim() : DEFAULT_FILE;
}

// ---- master key derivation (scrypt over the env passphrase; never a hardcoded real secret) ----
// scrypt is keyed by a per-file random salt stored in the envelope, so the same passphrase yields
// the right key for THIS file. We cache by salt within a process to avoid re-deriving on every op.
const _keyCache = new Map(); // saltB64 -> Buffer(32)

function passphrase() {
  const raw = process.env[KEY_ENV];
  if (!raw || !String(raw).trim()) {
    throw new Error(
      `secret-store: ${KEY_ENV} is not set. The master key is supplied by env NAME only; ` +
      `export ${KEY_ENV}=<passphrase> before reading or writing secrets.`
    );
  }
  return String(raw);
}

function deriveKey(saltBuf) {
  const saltB64 = saltBuf.toString('base64');
  const cached = _keyCache.get(saltB64);
  if (cached) return cached;
  // scrypt: N=2^15 is a sane interactive cost; r/p default. 32-byte key for AES-256.
  const key = crypto.scryptSync(passphrase(), saltBuf, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  _keyCache.set(saltB64, key);
  return key;
}

// ---- low-level AES-256-GCM over the whole JSON map ----
function encryptMap(map) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(map), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  };
}

// decryptEnvelope — throws on tamper/wrong-key (GCM auth-tag failure). Callers that must soft-fail
// wrap this in loadMap(); callers that want the error (writes) let it propagate.
function decryptEnvelope(env) {
  if (!env || typeof env !== 'object' || env.alg !== 'aes-256-gcm') {
    throw new Error('secret-store: unrecognized file envelope');
  }
  const salt = Buffer.from(env.salt, 'base64');
  const iv = Buffer.from(env.iv, 'base64');
  const tag = Buffer.from(env.tag, 'base64');
  const ct = Buffer.from(env.ct, 'base64');
  const key = deriveKey(salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag); // wrong key OR mutated ct/tag → final() throws below
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

// ---- map persistence ----
// loadMap() — SOFT-FAIL: returns {} for a missing file, and {} + a loud warning for a file that
// fails to decrypt (wrong key / tampered / corrupt). It NEVER returns partial/garbage data and
// NEVER throws on a read. The map is { name -> { name, value, url?, type, updatedAt } }.
function loadMap() {
  const file = storeFile();
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return {}; // missing file → empty store (soft-fail)
  }
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    // eslint-disable-next-line no-console
    console.warn(`[secret-store] WARNING: ${file} is not valid JSON — treating store as empty.`);
    return {};
  }
  try {
    const map = decryptEnvelope(env);
    return map && typeof map === 'object' ? map : {};
  } catch {
    // Wrong master key OR tampered file: GCM caught it. Do NOT return garbage as a real secret.
    // eslint-disable-next-line no-console
    console.warn(
      `[secret-store] WARNING: could not decrypt ${file} ` +
      `(wrong ${KEY_ENV}, or the file was tampered/corrupted). Treating store as empty.`
    );
    return {};
  }
}

// saveMap() — writes the encrypted envelope atomically. This IS allowed to throw: a failed write is
// something the caller must learn about (unlike a read, where empty is a safe default).
function saveMap(map) {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const env = encryptMap(map);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(env), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* best-effort perms */ }
}

// ---- item normalization ----
const TYPES = new Set(['login', 'note']);
function normType(t) {
  const s = String(t == null ? 'login' : t).trim().toLowerCase();
  return TYPES.has(s) ? s : 'login';
}

// ---- public API (drop-in-compatible names) ----

// get(name) -> value | null. SOFT-FAIL: missing name / missing file / undecryptable → null.
export function get(name) {
  if (!name || typeof name !== 'string') return null;
  const item = loadMap()[name];
  return item && typeof item.value === 'string' ? item.value : null;
}

// set(name, value, { url, type }) — upsert a secret. Throws on bad input or a failed write.
export function set(name, value, { url, type = 'login' } = {}) {
  if (!name || typeof name !== 'string') throw new Error('secret-store.set: name (string) is required');
  if (value == null || value === '') throw new Error('secret-store.set: value is required');
  const map = loadMap();
  const item = { name, value: String(value), type: normType(type), updatedAt: new Date().toISOString() };
  if (url) item.url = String(url);
  map[name] = item;
  saveMap(map);
  return { name, type: item.type, updatedAt: item.updatedAt }; // never returns the value
}

// note(name, content) — store a 'note' item (freeform text rather than a credential).
export function note(name, content) {
  return set(name, content, { type: 'note' });
}

// has(name) -> boolean. SOFT-FAIL.
export function has(name) {
  if (!name || typeof name !== 'string') return false;
  return Object.prototype.hasOwnProperty.call(loadMap(), name);
}

// list() -> [names]. NAMES ONLY, never values. SOFT-FAIL to [].
export function list() {
  return Object.keys(loadMap());
}

// remove(name) -> boolean (true if it existed). Throws only on a failed write.
export function remove(name) {
  if (!name || typeof name !== 'string') return false;
  const map = loadMap();
  if (!Object.prototype.hasOwnProperty.call(map, name)) return false;
  delete map[name];
  saveMap(map);
  return true;
}

// dump({ confirm }) / exportAll({ confirm }) — the ONLY bulk-plaintext paths. GUARDED: callers must
// pass { confirm: true } explicitly. For migration/backup only. Returns { name -> {value,...} }.
export function dump({ confirm } = {}) {
  if (confirm !== true) {
    throw new Error(
      'secret-store.dump: refused. This returns ALL plaintext secrets; pass { confirm: true } ' +
      'to acknowledge (migration/backup only).'
    );
  }
  return loadMap();
}
export const exportAll = dump;

// importFromBitwarden(bwExportJson) — bulk-load from the shape of `bw export --format json`:
//   { items: [ { name, login: { password }, notes }, ... ] }
// Maps each item name -> value (login.password preferred; falls back to notes for secure-note
// items). Idempotent: re-importing the same export upserts, never duplicates. Accepts either a
// parsed object or a JSON string. Returns { imported: [names], skipped: [{name, reason}] }.
export function importFromBitwarden(bwExportJson) {
  let data = bwExportJson;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { throw new Error('importFromBitwarden: input is not valid JSON'); }
  }
  const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
  const imported = [];
  const skipped = [];
  // Load once, mutate in memory, save once (cheaper + atomic for the whole batch).
  const map = loadMap();
  for (const it of items) {
    const name = it && typeof it.name === 'string' ? it.name.trim() : '';
    if (!name) { skipped.push({ name: it?.name ?? null, reason: 'missing name' }); continue; }
    // type 1 = login, type 2 = secure note in Bitwarden's schema; we infer from the data present.
    const pw = it?.login?.password;
    const notes = it?.notes;
    let value, type;
    if (pw != null && pw !== '') { value = String(pw); type = 'login'; }
    else if (notes != null && notes !== '') { value = String(notes); type = 'note'; }
    else { skipped.push({ name, reason: 'no password or notes' }); continue; }
    const item = { name, value, type, updatedAt: new Date().toISOString() };
    const uri = it?.login?.uris?.[0]?.uri;
    if (uri) item.url = String(uri);
    map[name] = item; // upsert → idempotent
    imported.push(name);
  }
  if (imported.length) saveMap(map);
  return { imported, skipped };
}

// ---- CLI (guarded; master key from env NAME only; values printed only for explicit `get`) ----
if (process.argv[1] && process.argv[1].endsWith('secret-store.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const usage = 'usage: get <name> | set <name> <value> [url] | list | import <bw-export.json>';
  try {
    if (cmd === 'get') {
      const v = get(rest[0]);
      if (v == null) { console.error(`secret-store: no item "${rest[0]}"`); process.exit(2); }
      process.stdout.write(v);
    } else if (cmd === 'set') {
      if (!rest[0] || rest[1] == null) { console.error(usage); process.exit(1); }
      const r = set(rest[0], rest[1], { url: rest[2] });
      console.log(`secret-store: stored "${r.name}" (type=${r.type}).`);
    } else if (cmd === 'list') {
      const names = list();
      console.log(names.length ? names.map((n) => `- ${n}`).join('\n') : '(empty)');
    } else if (cmd === 'import') {
      const f = rest[0];
      if (!f) { console.error('secret-store import: path to a `bw export --format json` file is required'); process.exit(1); }
      const json = fs.readFileSync(f, 'utf8');
      const { imported, skipped } = importFromBitwarden(json);
      console.log(`secret-store: imported ${imported.length} item(s); skipped ${skipped.length}.`);
      if (skipped.length) for (const s of skipped) console.log(`  skipped: ${s.name} (${s.reason})`);
    } else {
      console.error(usage);
      process.exit(1);
    }
  } catch (e) {
    console.error(`secret-store: ${e.message}`);
    process.exit(1);
  }
}
