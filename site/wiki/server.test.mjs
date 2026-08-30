// server.test.mjs — Library of Ashurbanipal route smoke test. Boots the real server on a test port
// over a temp ARTICLES_DIR fixture (so it's deterministic and offline — no live KB, no network: the
// crawl ping is gated on an https BASE_URL we never set). Covers: /health, home (index), an article
// route (/wiki/:slug), and a 404. Mirrors site/soapbox/routes.test.js.
// Run: node --test site/wiki/server.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8190;
const dir = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(dir, 'server.mjs');
let proc, tmp;

const get = (p) => new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${PORT}${p}`, (res) => {
    let body = ''; res.on('data', (c) => (body += c)); res.on('end', () => resolve({ code: res.statusCode, body }));
  }).on('error', reject);
});

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashur-'));
  // a minimal article exercising headers, a wikilink, bold, and a <ref> citation
  fs.writeFileSync(path.join(tmp, 'Test_Article.wiki'),
    '== Overview ==\nA test article about [[Oilahuasca]] with some \'\'\'bold\'\'\' text.<ref>source.md</ref>\n\n== Sources ==\n* source.md\n');
  // a private file that must NOT be published (privacy filter gate)
  fs.writeFileSync(path.join(tmp, 'operator_secret.wiki'), 'should never be served');

  proc = spawn(process.execPath, [server], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ARTICLES_DIR: tmp, NO_CRAWL_PING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 8000);
    proc.stdout.on('data', (d) => { if (String(d).includes('Library of Ashurbanipal')) { clearTimeout(t); resolve(); } });
    proc.on('error', reject);
  });
});

after(() => { if (proc) proc.kill(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

test('GET /health → 200 ok', async () => {
  const r = await get('/health');
  assert.equal(r.code, 200);
  assert.equal(r.body, 'ok');
});

test('GET / (index) → 200 listing the article (and never the private file)', async () => {
  const r = await get('/');
  assert.equal(r.code, 200);
  assert.ok(r.body.includes('Library of Ashurbanipal'), 'brand/title rendered');
  assert.ok(r.body.includes('Test Article'), 'the test article is listed');
  assert.ok(!/operator/i.test(r.body), 'the private/operator file must not be listed');
});

test('GET /wiki/:slug (article) → 200 with rendered markup + references', async () => {
  const r = await get('/wiki/Test_Article');
  assert.equal(r.code, 200);
  assert.ok(/<h2[^>]*>Overview<\/h2>/.test(r.body), '== header → h2');
  assert.ok(r.body.includes('<a href="/wiki/Oilahuasca">'), 'wikilink rendered');
  assert.ok(r.body.includes('<b>bold</b>'), 'bold rendered');
  assert.ok(r.body.includes('References'), 'references footnote block present');
  assert.ok(/application\/ld\+json/.test(r.body), 'Article JSON-LD present (SEO)');
});

test('GET /wiki/:slug for a missing article → 404 with the layout', async () => {
  const r = await get('/wiki/Nonexistent_Page');
  assert.equal(r.code, 404);
  assert.ok(/Not found/i.test(r.body), '404 shows the not-found layout');
});

test('GET an unknown top-level route → 404', async () => {
  const r = await get('/totally-unknown');
  assert.equal(r.code, 404);
  assert.ok(r.body.includes('404'), '404 page rendered');
});
