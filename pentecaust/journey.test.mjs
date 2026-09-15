// journey.test.mjs — Pentecaust end-to-end as TWO ORDINARY NON-WITNESS ACCOUNTS.
//
// ⚠️ WHY THIS SPAWNS THE SERVER INSTEAD OF IMPORTING THE HANDLER.
// registerMethod('melek-signer', …) lives inside server.mjs's `process.argv[1] === this file` CLI guard,
// so an IMPORTED module never registers it and "Login with MELEK" answers 404. Every other test in this
// directory imports the handler, which means none of them exercise the login production actually runs.
// The first draft of this file imported it too, and reported 13 failures against a server that works.
//
// The signer is stubbed on loopback with the real contract (a `code` back == password verified on-chain),
// so the genuine /auth/method/melek-signer HTTP path runs without any real credential leaving the machine.
// Passwords are generated here and exist nowhere else.
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
const USERS = { 'melekbot-pip': pw(), 'melekbot-nova': pw(), 'melekbot-dax': pw(), [ROOT]: pw() };

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
const signIn = (a) => call(a, '/auth/method/melek-signer', { method: 'POST', body: JSON.stringify({ account: a, password: USERS[a] }) });

before(async () => {
  stub = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      let j = {}; try { j = JSON.parse(b); } catch {}
      const ok = USERS[j.account] && USERS[j.account] === j.password;
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
      res.end(JSON.stringify(ok ? { code: randomBytes(8).toString('hex') } : { error: 'bad credentials' }));
    });
  });
  await new Promise((r) => stub.listen(SIGNER_PORT, '127.0.0.1', r));

  const tmp = (n) => join(tmpdir(), `pentecaust-journey-${process.pid}-${n}.json`);
  const env = {
    ...process.env,
    PORT: String(PORT), HOST: '127.0.0.1',
    MELEK_SIGNER_URL: `http://127.0.0.1:${SIGNER_PORT}`, MELEK_SIGNER_CLIENT: 'pentecaust',
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

test('a wrong password mints no session, and a forged cookie is refused', async () => {
  const bad = await call('bad', '/auth/method/melek-signer', {
    method: 'POST', body: JSON.stringify({ account: 'melekbot-pip', password: 'wrong' }) });
  assert.equal(bad.status, 401);
  assert.equal(jar.bad, undefined, 'a failed login must not leave a cookie behind');
  const forged = await fetch(`${B}/auth/me`, { headers: { cookie: 'pentecaust_session=not.a.real.token' } });
  assert.equal(forged.status, 401);
});

test('two ordinary accounts sign in and are themselves', async () => {
  for (const a of ['melekbot-pip', 'melekbot-nova']) {
    const r = await signIn(a);
    assert.equal(r.status, 200, `${a} could not sign in`);
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
