// sso.test.mjs — OFFLINE. No network. Every ticket here is minted and redeemed in-process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.PENTECAUST_SESSION_SECRET = 'sso-test-secret-stable';
process.env.SSO_ALLOWED_ORIGINS = 'https://herald.soapbox.community, https://other.test';
const {
  mintTicket, redeemTicket, returnUrlOk, sessionFromCookie, makeSiblingSession,
  handler, COOKIE, setCookie, __resetSpent, allowedOrigins,
} = await import('./sso.mjs');

const AUD = 'https://herald.soapbox.community/auth/callback';
const cap = () => { const o = { code: 0, body: '', headers: {} }; return { res: { writeHead: (c, h) => { o.code = c; o.headers = h || {}; }, end: (b) => { o.body = b || ''; } }, o }; };
const J = (o) => { try { return JSON.parse(o.body); } catch { return {}; } };

test('⚠️ the return URL is allow-listed by EXACT origin — otherwise this is an open redirect', () => {
  assert.equal(returnUrlOk('https://herald.soapbox.community/auth/callback').ok, true);
  for (const bad of [
    'https://evil.test/auth/callback',
    'https://herald.soapbox.community.evil.test/x',   // suffix trick
    'https://sub.herald.soapbox.community/x',         // subdomain is a different origin
    'http://herald.soapbox.community/x',              // scheme must not be downgradable
    'not-a-url', '', null,
  ]) assert.equal(returnUrlOk(bad).ok, false, `${bad} must be refused`);
});

test('⚠️ with no allow-list configured NOTHING is allowed — fails closed', () => {
  const keep = process.env.SSO_ALLOWED_ORIGINS;
  process.env.SSO_ALLOWED_ORIGINS = '';
  assert.equal(allowedOrigins().length, 0);
  assert.equal(returnUrlOk('https://herald.soapbox.community/auth/callback').ok, false);
  process.env.SSO_ALLOWED_ORIGINS = keep;
});

test('a ticket redeems once at its own audience', () => {
  __resetSpent();
  const t = mintTicket('hathor', AUD);
  assert.deepEqual(redeemTicket(t, AUD), { ok: true, account: 'hathor' });
});

test('⚠️ SINGLE USE — a ticket copied out of a log or referrer is already spent', () => {
  __resetSpent();
  const t = mintTicket('hathor', AUD);
  assert.equal(redeemTicket(t, AUD).ok, true);
  assert.deepEqual(redeemTicket(t, AUD), { ok: false, reason: 'ticket already used' });
});

test('⚠️ AUDIENCE BOUND — a herald ticket cannot be replayed at another site', () => {
  __resetSpent();
  const t = mintTicket('hathor', AUD);
  const r = redeemTicket(t, 'https://other.test/auth/callback');
  assert.equal(r.ok, false);
  assert.match(r.reason, /not minted for this site/);
});

test('⚠️ SHORT TTL — a stale ticket is refused', () => {
  __resetSpent();
  const t0 = 1_000_000;
  const t = mintTicket('hathor', AUD, { now: t0 });
  assert.equal(redeemTicket(t, AUD, { now: t0 + 30_000 }).ok, true);
  __resetSpent();
  const t2 = mintTicket('hathor', AUD, { now: t0 });
  assert.match(redeemTicket(t2, AUD, { now: t0 + 90_000 }).reason, /expired/);
});

test('a tampered or foreign-signed ticket is refused', () => {
  __resetSpent();
  const t = mintTicket('hathor', AUD);
  const [body, sig] = t.split('.');
  assert.equal(redeemTicket(`${body}x.${sig}`, AUD).ok, false, 'payload tamper');
  assert.equal(redeemTicket(`${body}.${sig}x`, AUD).ok, false, 'signature tamper');
  assert.equal(redeemTicket(mintTicket('hathor', AUD, { secret: 'a-different-secret' }), AUD).ok, false, 'foreign signature');
  // the classic: swap the subject and re-sign with nothing
  const forged = Buffer.from(JSON.stringify({ k: 'sso', sub: 'attacker', aud: AUD, exp: Date.now() + 60000 })).toString('base64url');
  assert.equal(redeemTicket(`${forged}.`, AUD).ok, false);
});

test('the sibling session round-trips and rejects junk', () => {
  const tok = makeSiblingSession('hathor');
  assert.deepEqual(sessionFromCookie(`${COOKIE}=${encodeURIComponent(tok)}`), { account: 'hathor' });
  assert.equal(sessionFromCookie(''), null);
  assert.equal(sessionFromCookie(`${COOKIE}=garbage`), null);
  // a TICKET is not a session — the two token kinds must not be interchangeable
  assert.equal(sessionFromCookie(`${COOKIE}=${encodeURIComponent(mintTicket('hathor', AUD))}`), null);
  assert.match(setCookie(tok), /HttpOnly/);
  assert.match(setCookie(tok), /Secure/);
  assert.match(setCookie(tok), /SameSite=Lax/);
});

test('the sibling handler: login bounces, callback sets a cookie, me/logout work', async () => {
  __resetSpent();
  const opts = { selfOrigin: 'https://herald.soapbox.community', idpOrigin: 'https://pentecaust.com' };

  let { res, o } = cap();
  await handler({ url: '/auth/login', headers: {} }, res, opts);
  assert.equal(o.code, 302);
  assert.match(o.headers.location, /^https:\/\/pentecaust\.com\/auth\/sso\?return=/);

  const ticket = mintTicket('hathor', AUD);
  ({ res, o } = cap());
  await handler({ url: `/auth/callback?sso=${encodeURIComponent(ticket)}`, headers: {} }, res, opts);
  assert.equal(o.code, 302);
  assert.equal(o.headers.location, '/');
  const cookie = o.headers['set-cookie'];
  assert.match(cookie, new RegExp(`^${COOKIE}=`));

  ({ res, o } = cap());
  await handler({ url: '/auth/me', headers: { cookie } }, res, opts);
  assert.equal(J(o).account, 'hathor');

  ({ res, o } = cap());
  await handler({ url: '/auth/me', headers: {} }, res, opts);
  assert.equal(o.code, 401);

  ({ res, o } = cap());
  await handler({ url: '/auth/logout', headers: {} }, res, opts);
  assert.match(o.headers['set-cookie'], /Max-Age=0/);
});

test('a bad ticket at the callback is a 401 and sets NO cookie', async () => {
  const { res, o } = cap();
  await handler({ url: '/auth/callback?sso=nonsense', headers: {} }, res,
    { selfOrigin: 'https://herald.soapbox.community' });
  assert.equal(o.code, 401);
  assert.equal(o.headers['set-cookie'], undefined, 'a failed redemption must not leave a session behind');
});
