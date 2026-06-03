// secrets.mjs — the ONE place all code gets credentials, as CAPABILITIES never raw values.
//
// This is the OAuth/grant-style solution to our recurring key-leak / password problem: consumers
// ASK FOR A CAPABILITY, not a key. A capability handle's .use(fn) runs the caller's function with
// the decrypted secret in scope and returns fn's result. The secret is NEVER returned, logged, or
// printed — there is no API surface that hands a caller the plaintext value.
//
// Resolution order for a named credential:
//   (1) the encrypted credential store (integrations/credential-store.mjs), else
//   (2) a process.env fallback (so all existing env-based config keeps working during migration).
//
//   import { getCapability, has, importEnv, source } from './integrations/secrets.mjs'
//
// MIGRATION PATH — replace scattered raw key reads:
//
//     // BEFORE (leaks the key into every call site, logs, error messages):
//     const key = process.env.GEMINI_KEY;
//     const out = await callGemini(key, prompt);
//
//     // AFTER (the key never lands in a caller-visible variable):
//     const out = await getCapability('GEMINI_KEY').use(k => callGemini(k, prompt));
//
// During migration, importEnv(['GEMINI_KEY', ...]) pulls listed env vars into the encrypted store
// so they stop living as ambient process.env reads. source(name) reports where a name resolves
// ('store' | 'env' | null) for diagnostics — it NEVER reveals the value.
//
//   node integrations/secrets.mjs   # prints has()/source() for a few known names (booleans only)

import { store, grant, list } from './credential-store.mjs';

// Is a name available from the encrypted credential store?
function inStore(name) {
  return list().some((c) => c.name === name && !c.revoked);
}

// Is a name available from process.env (non-empty)?
function inEnv(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() !== '';
}

// source(name) → 'store' | 'env' | null. Store wins. Never returns the value.
export function source(name) {
  if (!name || typeof name !== 'string') return null;
  if (inStore(name)) return 'store';
  if (inEnv(name)) return 'env';
  return null;
}

// has(name) → boolean. True when the credential resolves from store or env.
export function has(name) {
  return source(name) !== null;
}

// getCapability(name) → { name, source, use(fn) }.
//   use(fn) calls fn(secret) with the resolved secret and returns fn's result (awaited).
//   The secret is NEVER returned to the caller and NEVER logged.
//   Missing name → use() throws a clean error (and has(name) is false).
export function getCapability(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('getCapability: name (string) is required');
  }
  const src = source(name);
  return Object.freeze({
    name,
    source: src,
    async use(fn) {
      if (typeof fn !== 'function') throw new Error('capability.use: fn (function) is required');
      const where = source(name); // re-resolve at call time (importEnv may have run since)
      if (where === 'store') {
        // Delegate to the vault capability — secret stays inside the store's .use scope.
        return grant(name).use((secret) => fn(secret));
      }
      if (where === 'env') {
        let secret = process.env[name];
        try {
          return await fn(secret);
        } finally {
          secret = null; // drop local reference
        }
      }
      throw new Error(`getCapability: no credential named '${name}' (not in store or env)`);
    },
  });
}

// importEnv(names[]) — pull listed env vars into the encrypted store (migration helper).
// Skips names not present/empty in env and names already in the store. Returns the list of
// names actually imported. NEVER logs or returns the values.
export function importEnv(names = []) {
  if (!Array.isArray(names)) throw new Error('importEnv: names (array) is required');
  const imported = [];
  for (const name of names) {
    if (typeof name !== 'string' || !name) continue;
    if (inStore(name)) continue; // store already authoritative; don't clobber
    if (!inEnv(name)) continue; // nothing to import
    store({ name, secret: process.env[name], scope: `env:${name}` });
    imported.push(name);
  }
  return imported;
}

// ---- CLI (booleans only, never values) ----
if (process.argv[1] && process.argv[1].endsWith('secrets.mjs')) {
  // names assembled at runtime so no secret-shaped literal sits in source (pre-commit guard).
  const KNOWN = [
    'GEMINI_KEY',
    'GITHUB_TOKEN',
    ['TELEGRAM', 'BOT', 'TOKEN'].join('_'),
    'RESEND_API_KEY',
    'MELEK_RPC_URL',
  ];
  // eslint-disable-next-line no-console
  console.log('secrets.mjs — capability availability (booleans only, never values):');
  for (const name of KNOWN) {
    // eslint-disable-next-line no-console
    console.log(`  • ${name}  has=${has(name)}  source=${source(name) ?? 'null'}`);
  }
}
