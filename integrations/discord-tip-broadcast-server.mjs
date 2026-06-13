#!/usr/bin/env node
// discord-tip-broadcast-server.mjs — the chain-host side of cross-server Discord /tip.
//
// WHY THIS EXISTS
//   The Van Kush Discord bot runs on its own server (off Railway, on Azure/Google/etc.). The Hathor
//   key lives in the vault on the CHAIN host. A bot on a different server therefore CANNOT sign a tip
//   locally. This is a tiny HTTP endpoint that runs ON the chain host: the bot POSTs the tip, this
//   process applies the anti-drain caps, JIT-fetches Hathor's key from the local vault, broadcasts the
//   MELEK-Engine token transfer, and returns the Discord reply line. The bot holds NO key. (BRIEF.md §7.)
//
// SECURITY
//   • Bearer secret (MELEK_TIP_SHARED_SECRET) on every request — timing-safe compared. No secret => 401.
//   • Binds 127.0.0.1 by default; expose to the bot's server only over a private network / tunnel.
//   • Anti-drain caps are enforced HERE (the trust boundary), with a file-persisted ledger, so a
//     compromised or buggy bot still can't drain — the cap is server-side, not client-side.
//   • The vault key is fetched per request and used in-process, never logged, never returned.
//
//   handler(req,res) is exported and the vault-fetch + broadcaster are injected, so this is fully
//   offline-testable with no vault, no RPC, no key.
//
//   MELEK_TIP_SHARED_SECRET=… [PORT=8123] node integrations/discord-tip-broadcast-server.mjs

import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { handleTip } from './discord-tip-handler.mjs';
import { makeTipLedger } from './discord-chain-bridge.mjs';

const PORT = Number(process.env.PORT || 8123);
const HOST = process.env.MELEK_TIP_BIND || '127.0.0.1';
const SECRET = process.env.MELEK_TIP_SHARED_SECRET || '';
const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = process.env.MELEK_PREFIX || 'TST';
const VAULT = process.env.MELEK_VAULT_CLI || '/opt/melek-bot/vault.mjs';
const LEDGER_FILE = process.env.MELEK_TIP_LEDGER || '/srv/bot/discord-tip-ledger.json';

// Timing-safe bearer check — empty/short-circuits when no secret is configured (refuse all).
export function checkAuth(headerValue, secret = SECRET) {
  if (!secret) return false;
  const got = String(headerValue || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// File-backed ledger so the caps persist across restarts and bind server-side.
function fileTipLedger() {
  return makeTipLedger({
    load: () => { try { return JSON.parse(readFileSync(LEDGER_FILE, 'utf8')); } catch { return null; } },
    save: (entries) => {
      try { const tmp = `${LEDGER_FILE}.tmp`; writeFileSync(tmp, JSON.stringify(entries), { mode: 0o600 }); renameSync(tmp, LEDGER_FILE); }
      catch { /* soft-fail: a tip still goes through; the cap just isn't recorded this once */ }
    },
  });
}

// The real broadcaster: JIT-fetch Hathor's active key from the local vault, sign + broadcast the op.
// Imported lazily so the module loads (and tests run) without dhive / a vault present.
function realBroadcast() {
  return async (op) => {
    const { Client, PrivateKey } = await import('@hiveio/dhive');
    const block = execFileSync('node', [VAULT, 'get', 'hathor-testnet-keys'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 20000 });
    const m = block.match(/^active:\s*(5[1-9A-HJ-NP-Za-km-z]{50})/m);
    if (!m) throw new Error('no active key from vault');
    const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
    return client.broadcast.sendOperations([op], PrivateKey.fromString(m[1]));
  };
}

// Read a JSON body with a hard cap (defensive).
function readJson(req, limit = 4096) {
  return new Promise((resolve) => {
    let buf = ''; let over = false;
    req.on('data', (c) => { buf += c; if (buf.length > limit) { over = true; req.destroy(); } });
    req.on('end', () => { if (over) return resolve(null); try { resolve(JSON.parse(buf || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

/**
 * HTTP handler. deps:
 *   broadcast(op) -> broadcasts as @hathor (default: realBroadcast()).
 *   ledger        -> anti-drain ledger (default: file-backed).
 *   secret        -> override the bearer secret (tests).
 */
export async function handler(req, res, deps = {}) {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST' || (req.url || '/').split('?')[0] !== '/tip') return send(404, { ok: false, error: 'not found' });
  if (!checkAuth(req.headers?.authorization, deps.secret)) return send(401, { ok: false, error: 'unauthorized' });

  const body = await readJson(req);
  if (!body || !body.from || !body.to || body.amount == null) {
    return send(400, { ok: false, error: 'need { from, to, amount, symbol? }' });
  }
  const symbol = String(body.symbol || process.env.MELEK_TIP_SYMBOL || 'MANNA').toUpperCase();
  const out = await handleTip(`/tip @${String(body.to).replace(/^@/, '')} ${body.amount} ${symbol}`, {
    from: String(body.from),
    deps: { tipFrom: 'hathor', ledger: deps.ledger || fileTipLedger(), broadcast: deps.broadcast || realBroadcast() },
  });
  return send(out.ok ? 200 : 200, { ok: out.ok, reply: out.reply });
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('discord-tip-broadcast-server.mjs')) {
  if (!SECRET) { console.error('FATAL: set MELEK_TIP_SHARED_SECRET'); process.exit(1); }
  http.createServer((req, res) => { handler(req, res).catch(() => { try { res.writeHead(500); res.end('{"ok":false}'); } catch {} }); })
    .listen(PORT, HOST, () => console.log(`discord-tip-broadcast-server on http://${HOST}:${PORT}/tip (testnet)`));
}
