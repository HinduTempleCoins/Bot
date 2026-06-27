// server.mjs — read-only HTTP surface for the off-chain karma score, so any surface (the condenser
// profile, Pentecaust, the Auto) can DISPLAY a person's karma. GET /karma/<account> → { score, tier, … }.
//
// Karma is SOCIAL, not economic (BRIEF §9): this endpoint is advisory/display ONLY — no keys, no votes,
// no funds. A short in-memory cache keeps profile views from hammering the chain RPC. CORS-open so the
// condenser (a different origin) can fetch it client-side. House style: handler(req,res) exported,
// activity fetch injectable via karma.mjs __setFetchActivity, CLI guarded, soft-fail-never-throw.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { computeKarma } from './karma.mjs';

const PORT = +(process.env.PORT || 8156);
const HOST = process.env.HOST || '127.0.0.1';
const TTL_MS = +(process.env.KARMA_TTL_MS || 300000); // 5-min cache per account
const ACC_RE = /^[a-z][a-z0-9.-]{1,31}$/;             // valid graphene-ish account name
const _cache = new Map();                              // account -> { at, rec }

function send(res, code, obj) {
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',          // display-only, public, read-only → safe to open
    'cache-control': 'public, max-age=120',
  });
  res.end(JSON.stringify(obj));
}

/** Karma for one account, cached. Returns { ok, account, score, tier, grantMultiplier, flagWeight, components }. */
export async function karmaFor(account, { now = Date.now } = {}) {
  const acc = String(account || '').trim().toLowerCase();
  if (!ACC_RE.test(acc)) return { ok: false, error: 'invalid account' };
  const t = now();
  const hit = _cache.get(acc);
  if (hit && t - hit.at < TTL_MS) return { ok: true, ...hit.rec, cached: true };
  try {
    const rec = await computeKarma(acc);
    _cache.set(acc, { at: t, rec });
    return { ok: true, ...rec };
  } catch { return { ok: false, error: 'could not compute karma' }; }
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://karma.local');
    const path = url.pathname;
    if (path === '/health') return send(res, 200, { ok: true, service: 'karma' });
    let account = url.searchParams.get('account');
    const m = path.match(/^\/karma\/([^/]+)$/);
    if (m) account = decodeURIComponent(m[1]);
    if (account) return send(res, 200, await karmaFor(account));
    return send(res, 404, { ok: false, error: 'not found' });
  } catch { return send(res, 500, { ok: false, error: 'error' }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`karma API on http://${HOST}:${PORT}`));
}
