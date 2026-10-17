// store.mjs — tiny durable key/value store for the helper bot's per-user state (links, tip quota +
// receipts, faucet cooldowns, guide sessions). File-backed JSON with atomic replace (0600) so state
// survives restarts and per-process spawns; memoryStore() for tests. Holds PUBLIC data only — account
// names, 0x addresses, counters, receipts. Never a key (secrets are refused upstream by secret-guard).

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function memoryStore(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  return {
    get: (k, d = null) => (k in data ? data[k] : d),
    set: (k, v) => { data[k] = v; return v; },
    del: (k) => { delete data[k]; },
    keys: (prefix = '') => Object.keys(data).filter((k) => k.startsWith(prefix)),
    dump: () => JSON.parse(JSON.stringify(data)),
  };
}

export function fileStore(file = join(process.env.HELPERBOT_DATA_DIR || '.helperbot-data', 'state.json')) {
  let data = {};
  try { data = JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { data = {}; }
  const save = () => {
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, file);
    } catch { /* soft-fail: state is best-effort; caps still bind in-process */ }
  };
  return {
    get: (k, d = null) => (k in data ? data[k] : d),
    set: (k, v) => { data[k] = v; save(); return v; },
    del: (k) => { delete data[k]; save(); },
    keys: (prefix = '') => Object.keys(data).filter((k) => k.startsWith(prefix)),
    dump: () => JSON.parse(JSON.stringify(data)),
  };
}

let _default = null;
export function defaultStore() {
  if (!_default) _default = fileStore();
  return _default;
}
export function __setDefaultStore(s) { _default = s; }

/** UTC day key, e.g. 2026-10-17 — quotas and caps reset at 00:00 UTC (the PIZZA convention). */
export const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Discord snowflake → account creation time (ms). null when not a snowflake. */
export function snowflakeTime(id) {
  try {
    if (!/^\d{15,21}$/.test(String(id))) return null;
    return Number((BigInt(id) >> 22n) + 1420070400000n);
  } catch { return null; }
}
