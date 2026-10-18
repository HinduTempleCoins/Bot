// melek-signer-only.test.mjs — MELEK chains are MELEK-Signer only. OFFLINE: the server is bound to
// 127.0.0.1:0 and never reaches a chain RPC (the refusal fires before any key check).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(here, `.test-msonly-${process.pid}.json`);
process.env.AUTOVOTE_DB = DB;
process.env.MELEK_SIGNER_URL = 'https://signer.example';

const { server, store } = await import('./server.js');
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => { server.close(); try { fs.unlinkSync(DB); } catch {} });

async function postLogin(body) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie') };
}

test('/api/login refuses a posting-key login on MELEK mainnet + testnet (no key stored, no session)', async () => {
  for (const chain of ['melek', 'melek-testnet']) {
    const r = await postLogin({ chain, username: 'alice', postingKey: '5Jnotarealkey' });
    assert.equal(r.status, 400, chain);
    assert.match(r.body.error, /MELEK-Signer/);
    assert.match(r.body.login, /^\/melek-signer\/login\?chain=/);
    assert.equal(r.cookie, null, 'no session issued');
    assert.equal(store.getUser(chain, 'alice'), null, 'nothing stored');
  }
});

test('/api/config advertises only melek-signer for MELEK chains', async () => {
  const cfg = await (await fetch(`${base}/api/config`)).json();
  for (const id of ['melek', 'melek-testnet']) {
    assert.deepEqual(cfg.chains.find((c) => c.id === id).authMethods, ['melek-signer']);
  }
});

test('/melek-signer/login redirects to the signer authorize endpoint', async () => {
  const r = await fetch(`${base}/melek-signer/login?chain=melek`, { redirect: 'manual', headers: { host: 'auto.example' } });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://signer.example/oauth2/authorize');
  assert.equal(loc.searchParams.get('client_id'), 'autovote');
  assert.ok(loc.searchParams.get('state'));
});

test('a stored posting key is NOT deleted when the same account later logs in via MELEK-Signer', () => {
  store.upsertUser('melek-testnet', 'legacy', 'postingkey', { postingKey: '5Jlegacy' });
  store.upsertUser('melek-testnet', 'legacy', 'melek-signer', { msToken: 'TOK' });
  const u = store.getUser('melek-testnet', 'legacy');
  assert.equal(u.authMethod, 'melek-signer');
  assert.equal(u.postingKey, '5Jlegacy');
});
