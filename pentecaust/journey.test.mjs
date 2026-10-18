// journey.test.mjs — Pentecaust end-to-end as TWO ORDINARY NON-WITNESS ACCOUNTS.
//
// ⚠️ WHY THIS SPAWNS THE SERVER INSTEAD OF IMPORTING THE HANDLER: it exercises the login production
// actually runs, through server.mjs's real routing + startup.
//
// "Login with MELEK" is the MELEK-Signer REDIRECT flow: GET /auth/melek-signer/start → (signer page) →
// GET /auth/melek-signer/callback?code&state. The signer's POST /oauth2/token is stubbed on loopback with the
// real contract ({code, client_id} → {access_token, account}); each account's one-time code is random and
// exists only here. No password exists anywhere in this test — Pentecaust never sees one.
//
// PENTECAUST_DEV_TRUST is deliberately UNSET: production posture, identity must be proven.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8931, SIGNER_PORT = 8932, ROOT = 'hathor';
const B = `http://127.0.0.1:${PORT}`;
const SERVER = join(fileURLToPath(new URL('.', import.meta.url)), 'server.mjs');
const pw = () => randomBytes(24).toString('base64url');
const USERS = { 'melekbot-pip': pw(), 'melekbot-nova': pw(), 'melekbot-dax': pw(), [ROOT]: pw() }; // account → its signer code

let srv, stub;
const jar = {};

async function call(who, path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (jar[who]) headers.cookie = jar[who];
  if (opts.body) headers['content-type'] = 'application/json';
  const r = await fetch(B + path, { ...opts, headers, redirect: 'manual' });
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
    const m = /^pentecaust_session=([^;]*)/.exec(c);
    if (m) jar[who] = `pentecaust_session=${m[1]}`;
  }
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t.slice(0, 200); }
  return { status: r.status, body };
}
// The redirect round-trip, as the browser does it: start (state cookie) → signer → callback with the code.
async function signerRoundTrip(who, code) {
  const st = await fetch(`${B}/auth/melek-signer/start`, { redirect: 'manual' });
  const state = new URL(st.headers.get('location')).searchParams.get('state');
  const ms = (st.headers.getSetCookie() || []).map((c) => /^pentecaust_ms_state=([^;]*)/.exec(c)).find(Boolean);
  return call(who, `/auth/melek-signer/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    { headers: { cookie: `pentecaust_ms_state=${ms ? ms[1] : ''}` } });
}
const signIn = (a) => signerRoundTrip(a, USERS[a]);

before(async () => {
  stub = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      let j = {}; try { j = JSON.parse(b); } catch {}
      const acct = req.url === '/oauth2/token' && j.client_id === 'pentecaust'
        ? Object.keys(USERS).find((a) => USERS[a] === j.code) : null;
      res.writeHead(acct ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(acct ? { access_token: randomBytes(8).toString('hex'), account: acct, scope: 'identity' } : { error: 'invalid_grant' }));
    });
  });
  await new Promise((r) => stub.listen(SIGNER_PORT, '127.0.0.1', r));

  const tmp = (n) => join(tmpdir(), `pentecaust-journey-${process.pid}-${n}.json`);
  const env = {
    ...process.env,
    PORT: String(PORT), HOST: '127.0.0.1',
    MELEK_SIGNER_URL: `http://127.0.0.1:${SIGNER_PORT}`, MELEK_SIGNER_CLIENT: 'pentecaust',
    MELEK_SIGNER_PUBLIC_URL: `http://127.0.0.1:${SIGNER_PORT}`,
    PENTECAUST_SESSION_SECRET: 'journey-secret', PENTECAUST_BASE_URL: B,
    TEAMS_DATA: tmp('teams'), TEAMS_CHAT_DATA: tmp('chat'), CRM_DATA: tmp('crm'),
    MAILBOX_DATA: tmp('mail'), HERALD_LEDGER_DATA: tmp('ledger'), PENTECAUST_AUTH_DATA: tmp('auth'),
    DM_DATA: tmp('dm'), FOLLOW_DATA: tmp('follow'), INVITES_DATA: tmp('invites'),
  };
  delete env.PENTECAUST_DEV_TRUST;
  srv = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  for (let i = 0; i < 80; i++) {
    try { await fetch(`${B}/health`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not come up');
});
after(() => { try { srv.kill(); } catch {} try { stub.close(); } catch {} });

test('nothing identity-bearing is readable without a session', async () => {
  for (const p of ['/me/entitlements', '/me/mailbox', '/inbox', '/dm?with=melekbot-nova']) {
    assert.equal((await call('anon', p)).status, 401, `${p} must refuse an anonymous caller`);
  }
  const iss = await call('anon', '/invites/issue', { method: 'POST', body: '{}' });
  assert.ok(iss.status === 401 || iss.status === 403);
});

test('a bad signer code mints no session, the old password endpoint is gone, and a forged cookie is refused', async () => {
  const bad = await signerRoundTrip('bad', 'not-a-real-code');
  assert.equal(bad.status, 502);
  const pwPost = await call('bad', '/auth/method/melek-signer', {
    method: 'POST', body: JSON.stringify({ account: 'melekbot-pip', password: 'anything' }) });
  assert.equal(pwPost.status, 404, 'no password-forwarding login exists any more');
  assert.equal(jar.bad, undefined, 'a failed login must not leave a cookie behind');
  const forged = await fetch(`${B}/auth/me`, { headers: { cookie: 'pentecaust_session=not.a.real.token' } });
  assert.equal(forged.status, 401);
});

test('two ordinary accounts sign in and are themselves', async () => {
  for (const a of ['melekbot-pip', 'melekbot-nova']) {
    const r = await signIn(a);
    assert.equal(r.status, 302, `${a} could not sign in`);
    assert.equal((await call(a, '/auth/me')).body.account, a);
  }
});

test('a non-witness gets real messaging, not an empty shell', async () => {
  const e = await call('melekbot-pip', '/me/entitlements');
  assert.equal(e.status, 200);
  assert.ok(e.body.can.includes('pm'), 'an ordinary account must be able to send private messages');

  assert.equal((await call('melekbot-pip', '/dm', { method: 'POST',
    body: JSON.stringify({ to: 'melekbot-nova', text: 'first message' }) })).status, 200);
  assert.match(JSON.stringify((await call('melekbot-nova', '/dm?with=melekbot-pip')).body), /first message/);

  assert.equal((await call('melekbot-nova', '/dm', { method: 'POST',
    body: JSON.stringify({ to: 'melekbot-pip', text: 'a reply' }) })).status, 200);
  assert.match(JSON.stringify((await call('melekbot-pip', '/dm?with=melekbot-nova')).body), /a reply/);

  const team = await call('melekbot-pip', '/teams', { method: 'POST',
    body: JSON.stringify({ name: 'ordinary channel', owner: 'melekbot-pip', kind: 'public' }) });
  assert.notEqual(team.body.ok, false, 'a non-witness must be able to create a channel');
});

test('⚠️ a third signed-in account cannot read someone else\'s thread', async () => {
  await signIn('melekbot-dax');
  const snoop = JSON.stringify((await call('melekbot-dax', '/dm?with=melekbot-pip')).body);
  assert.ok(!/first message|a reply/.test(snoop), 'IDOR: the pip↔nova thread leaked to a third party');
});

test('the invite tree: outside it you cannot invite, inside it you can, and a code burns once', async () => {
  // Invites ARE the signup gate. An account that was never invited handing out invitations is the hole,
  // so the refusal is the first thing asserted here — not an inconvenience to work around.
  const premature = await call('melekbot-pip', '/invites/issue', { method: 'POST', body: '{}' });
  assert.ok(premature.status !== 200 || premature.body.ok === false,
    'an account outside the tree must not be able to issue invites');

  await signIn(ROOT);
  const rootInv = await call(ROOT, '/invites/issue', { method: 'POST', body: '{}' });
  assert.equal(rootInv.body.ok, true, 'root is unlimited and self-registers on first use');

  const code = rootInv.body.code;
  assert.equal((await call('melekbot-pip', '/invites/redeem', { method: 'POST', body: JSON.stringify({ code }) })).body.ok, true);
  assert.equal((await call('melekbot-pip', '/invites/issue', { method: 'POST', body: '{}' })).body.ok, true,
    'having joined, an ordinary account may now invite');

  const reuse = await call('melekbot-nova', '/invites/redeem', { method: 'POST', body: JSON.stringify({ code }) });
  assert.ok(reuse.status !== 200 || reuse.body.ok === false, 'a single-use code was redeemed twice');
});
