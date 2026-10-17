// server.test.mjs — offline tests for the recovery redirect (site/recovery/server.mjs). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, recoverTarget, RECOVER_URL } from './server.mjs';

function mockRes() {
  return {
    statusCode: null, headers: {}, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += String(chunk); },
  };
}
async function drive(url) { const res = mockRes(); await handler({ url, method: 'GET' }, res); return res; }

test('every path 301s to the MELEK-Signer recovery guide', async () => {
  assert.equal(RECOVER_URL, 'https://signer.melek.salon/recover');
  for (const p of ['/', '/recover_account_step_1', '/anything/else']) {
    const r = await drive(p);
    assert.equal(r.statusCode, 301, p);
    assert.equal(r.headers.location, RECOVER_URL);
  }
});

test('?account= is carried through, sanitized', async () => {
  assert.equal((await drive('/?account=MegaReigns')).headers.location, `${RECOVER_URL}?account=megareigns`);
  assert.equal(recoverTarget('@bob"><x'), `${RECOVER_URL}?account=bobx`);
  assert.equal(recoverTarget(''), RECOVER_URL);
});

test('health: 200 ok', async () => {
  const r = await drive('/health');
  assert.equal(r.statusCode, 200);
  assert.equal(r.body, 'ok');
});
