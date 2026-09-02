// secrets.mjs — minimal env-only capability lookup for the distributable package.
//
// In the MELEK monorepo this is backed by a vault; in this standalone package it reads straight from the
// environment, so federated-provider config (client ids/secrets for Google/GitHub/Discord) is supplied as
// env vars. No vault, no network, no stored secrets. Names are case-insensitive; values are never logged.
//
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID / ..., DISCORD_CLIENT_ID / ...

const envKey = (name) => String(name || '').trim().toUpperCase().replace(/[.\-\s]+/g, '_');

/** Does this capability/secret exist in the environment? */
export function has(name) {
  const v = process.env[envKey(name)];
  return typeof v === 'string' && v.length > 0;
}

/** Get a capability value from the environment (or null). Never logs the value. */
export function getCapability(name) {
  const v = process.env[envKey(name)];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Where a value came from (env or absent) — parity with the monorepo API. */
export function source(name) {
  return has(name) ? 'env' : 'absent';
}
