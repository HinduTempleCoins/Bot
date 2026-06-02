// routes.test.js — end-to-end route smoke test. Boots the real server on a test port and asserts
// the page factory renders. To stay deterministic (no upstream-API flakiness), it only asserts on
// routes that don't call out: static content + cache-only pages + a 404. The data-driven routes
// (/, /coins/:id) are covered by the unit tests on the condenser/adapters/render layers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = 8137;
const server = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');
let proc;

const get = (p) => new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${PORT}${p}`, (res) => {
    let body = ''; res.on('data', (c) => (body += c)); res.on('end', () => resolve({ code: res.statusCode, body }));
  }).on('error', reject);
});

before(async () => {
  proc = spawn(process.execPath, [server], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 8000);
    proc.stdout.on('data', (d) => { if (String(d).includes('page factory')) { clearTimeout(t); resolve(); } });
    proc.on('error', reject);
  });
});

after(() => { if (proc) proc.kill(); });

test('static & cache-only routes render through the factory', async () => {
  for (const [p, needle] of [
    ['/health', 'ok'],
    ['/robots.txt', 'Sitemap'],
    ['/learn', 'Learn'],
    ['/learn/recognizing-scam-patterns', 'scam'],
    ['/ecosystem', 'Ecosystem'],
    ['/ecosystem/melek', 'MELEK'],
    ['/status', 'Cache'],
    ['/watchlist', 'Watchlist'],
    ['/portfolio', 'public'],
  ]) {
    const r = await get(p);
    assert.equal(r.code, 200, `${p} should be 200`);
    assert.ok(r.body.includes(needle), `${p} should contain "${needle}"`);
  }
});

test('unknown route → 404 with the layout', async () => {
  const r = await get('/definitely-not-a-page');
  assert.equal(r.code, 404);
  assert.ok(r.body.includes('404'));
});

test('learn article carries JSON-LD + canonical (SEO)', async () => {
  const r = await get('/learn/burn-to-feature');
  assert.match(r.body, /application\/ld\+json/);
  assert.match(r.body, /<link rel=canonical/);
});
