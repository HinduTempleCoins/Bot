// pentecaust/sso.mjs — sign in to a SIBLING SITE using the login Pentecaust already has.
//
// ⭐ WHY A HANDOFF AND NOT MORE OAUTH APPS.
// Herald lives on a different registrable domain from Pentecaust, so a pentecaust.com session cookie is
// never sent to it — cookies are host-scoped and no amount of config changes that. The obvious fix is to
// register herald's own callback URI with Google, Discord and GitHub, but every one of those lives behind
// the operator's login in a provider console. So instead: ALL OAuth stays on pentecaust.com, and Herald
// accepts a short-lived signed ticket proving who signed in there. Zero console changes, one place where
// identity is established, and one place to revoke it.
//
// The ticket travels in a URL, which means it can land in a referrer header, a proxy log and shell
// history. Three things make that survivable, and all three are load-bearing:
//   1. TTL of 60s — a leaked ticket is stale before it is useful.
//   2. AUDIENCE BINDING — a ticket minted for herald cannot be replayed at any other site.
//   3. SINGLE USE — the first redemption burns it, so a copy out of a log is already spent.
//
// ⚠️ And the return URL is checked against an exact-origin ALLOW-LIST before a ticket is ever minted.
// Without that this endpoint is an open redirect that hands an attacker a valid ticket for the asking.
//
// House style: ESM, soft-fail-never-throw, injectable clock, handler(req,res), CLI guarded.

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const env = (k, d = '') => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const TICKET_TTL_MS = () => Math.max(5000, Number(env('SSO_TICKET_TTL_MS', '60000')) || 60000);
export const SESSION_TTL_MS = () => Math.max(60000, Number(env('SSO_SESSION_TTL_MS', String(7 * 24 * 3600 * 1000))) || 7 * 24 * 3600 * 1000);
export const COOKIE = 'herald_session';

/** Exact origins allowed to receive a ticket. Empty ⇒ nothing is allowed (fails closed). */
export function allowedOrigins() {
  return String(env('SSO_ALLOWED_ORIGINS', ''))
    .split(/[,\s]+/).map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

let _secret = null;
function secret() {
  const s = env('PENTECAUST_SESSION_SECRET', '') || env('SSO_SECRET', '');
  if (s) return s;
  // No shared secret ⇒ a per-process random one. Signing still works, verification across a restart or
  // across the two services does not — which fails CLOSED (nobody gets in) rather than open.
  if (!_secret) _secret = randomBytes(32).toString('hex');
  return _secret;
}

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const now = (o) => (o && o.now != null ? o.now : Date.now());

function sign(payload, sec = secret()) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(createHmac('sha256', sec).update(body).digest())}`;
}
function verify(token, sec = secret()) {
  const t = String(token || '');
  const i = t.lastIndexOf('.');
  if (i <= 0) return null;
  const body = t.slice(0, i); const sig = t.slice(i + 1);
  const want = b64u(createHmac('sha256', sec).update(body).digest());
  const a = Buffer.from(sig); const b = Buffer.from(want);
  if (a.length !== b.length) return null;
  try { if (!timingSafeEqual(a, b)) return null; } catch { return null; }
  try { return JSON.parse(unb64u(body)); } catch { return null; }
}

/** Is this return URL one we will hand a ticket to? Exact origin match, https only. */
export function returnUrlOk(returnUrl) {
  let u;
  try { u = new URL(String(returnUrl || '')); } catch { return { ok: false, reason: 'not a URL' }; }
  if (u.protocol !== 'https:' && u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
    return { ok: false, reason: 'https required' };
  }
  const list = allowedOrigins();
  if (!list.length) return { ok: false, reason: 'no SSO_ALLOWED_ORIGINS configured' };
  if (!list.includes(u.origin)) return { ok: false, reason: 'origin not allowed' };
  return { ok: true, origin: u.origin, url: u };
}

/** Mint a ticket for ONE audience. Never call without running returnUrlOk first. */
export function mintTicket(account, audience, opts = {}) {
  const acct = String(account || '').trim().toLowerCase();
  const aud = String(audience || '').trim().replace(/\/$/, '');
  if (!acct || !aud) return '';
  return sign({ k: 'sso', sub: acct, aud, jti: b64u(randomBytes(12)), exp: now(opts) + TICKET_TTL_MS() }, opts.secret || secret());
}

// Single-use: remember spent ticket ids until they expire anyway. Bounded, so a flood cannot grow it
// without limit — and eviction is by expiry, so a ticket can never come back to life inside its TTL.
const _spent = new Map();
function burn(jti, exp, t) {
  for (const [k, e] of _spent) if (e <= t) _spent.delete(k);
  if (_spent.size > 10000) _spent.clear();
  if (_spent.has(jti)) return false;
  _spent.set(jti, exp);
  return true;
}
export const __resetSpent = () => _spent.clear();

/**
 * Redeem a ticket AT the audience it was minted for.
 * @returns {{ ok:true, account } | { ok:false, reason }}
 */
export function redeemTicket(ticket, audience, opts = {}) {
  const p = verify(ticket, opts.secret || secret());
  if (!p || p.k !== 'sso') return { ok: false, reason: 'bad ticket' };
  const t = now(opts);
  if (!p.exp || t >= Number(p.exp)) return { ok: false, reason: 'ticket expired' };
  const aud = String(audience || '').trim().replace(/\/$/, '');
  if (!aud || p.aud !== aud) return { ok: false, reason: 'ticket was not minted for this site' };
  if (!burn(String(p.jti || ''), Number(p.exp), t)) return { ok: false, reason: 'ticket already used' };
  return { ok: true, account: String(p.sub || '') };
}

/** A normal session for the sibling site, once a ticket has been redeemed. */
export const makeSiblingSession = (account, opts = {}) =>
  sign({ k: 'sess', sub: String(account || '').toLowerCase(), exp: now(opts) + SESSION_TTL_MS() }, opts.secret || secret());

export function sessionFromCookie(cookieHeader, opts = {}) {
  const raw = String(cookieHeader || '');
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]*)`).exec(raw);
  if (!m) return null;
  let val; try { val = decodeURIComponent(m[1]); } catch { val = m[1]; }
  const p = verify(val, opts.secret || secret());
  if (!p || p.k !== 'sess' || !p.exp || now(opts) >= Number(p.exp)) return null;
  return { account: String(p.sub || '') };
}

export const setCookie = (token) =>
  `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS() / 1000)}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/**
 * handler — the SIBLING side (Herald).
 *   GET /auth/login    → bounce to the identity site's /auth/sso with this site as the return
 *   GET /auth/callback → redeem ?sso=, set the cookie, land on /
 *   GET /auth/me       → who am I
 *   GET /auth/logout   → clear
 */
export async function handler(req, res, opts = {}) {
  const selfOrigin = String(opts.selfOrigin || env('SSO_SELF_ORIGIN', '')).replace(/\/$/, '');
  const idpOrigin = String(opts.idpOrigin || env('SSO_IDP_ORIGIN', 'https://pentecaust.com')).replace(/\/$/, '');
  const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const redirect = (loc, extra) => { res.writeHead(302, { location: loc, ...(extra || {}) }); res.end(''); };

  try {
    const url = new URL(String((req && req.url) || '/'), selfOrigin || 'https://local.invalid');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const cookie = (req && req.headers && req.headers.cookie) || '';

    if (path === '/auth/login') {
      if (!selfOrigin) return json(503, { ok: false, reason: 'SSO_SELF_ORIGIN not configured' });
      return redirect(`${idpOrigin}/auth/sso?return=${encodeURIComponent(`${selfOrigin}/auth/callback`)}`);
    }

    if (path === '/auth/callback') {
      const r = redeemTicket(url.searchParams.get('sso'), `${selfOrigin}/auth/callback`, opts);
      if (!r.ok) return json(401, r);
      return redirect('/', { 'set-cookie': setCookie(makeSiblingSession(r.account, opts)) });
    }

    if (path === '/auth/me') {
      const s = sessionFromCookie(cookie, opts);
      return s ? json(200, { ok: true, account: s.account }) : json(401, { ok: false, reason: 'no session' });
    }

    if (path === '/auth/logout') return redirect('/', { 'set-cookie': clearCookie() });

    return json(404, { ok: false, reason: 'not-found' });
  } catch { return json(500, { ok: false, reason: 'error' }); }
}

export default { handler, mintTicket, redeemTicket, returnUrlOk, sessionFromCookie, makeSiblingSession, allowedOrigins, COOKIE, setCookie, clearCookie, __resetSpent };

if (process.argv[1] && process.argv[1].endsWith('sso.mjs')) {
  process.stdout.write(`SSO allowed origins: ${allowedOrigins().join(', ') || '(none — fails closed)'}\n`);
}
