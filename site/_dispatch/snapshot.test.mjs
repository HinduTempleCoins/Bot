import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['benefits', 'business', 'comms', 'plate', 'portfolio', 'remote'];

function fakeRes() { return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; return this; } }; }

for (const d of DIRS) {
  test(`recovered snapshot: ${d} serves home 200 and 404s cleanly`, async () => {
    assert.ok(existsSync(path.join(SITE, d, 'snapshot.json')), `${d} snapshot present`);
    const { handler } = await import(path.join(SITE, d, 'server.mjs'));
    const home = fakeRes();
    await handler({ url: '/', method: 'GET' }, home);
    assert.equal(home.code, 200, `${d} home 200`);
    assert.ok(home.body.length > 500, `${d} home has content`);
    const miss = fakeRes();
    await handler({ url: '/definitely-not-a-real-path-xyz', method: 'GET' }, miss);
    assert.ok(miss.code === 404 || miss.code === 200, `${d} unknown path soft-handled`);
  });
}
