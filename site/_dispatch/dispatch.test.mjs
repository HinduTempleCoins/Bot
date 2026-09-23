import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { dispatch, hostToDir, ROUTES } from './server.mjs';

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeRes() {
  return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; return this; } };
}
async function req(host, url = '/') {
  const res = fakeRes();
  await dispatch({ url, method: 'GET', headers: { host } }, res);
  return res;
}

test('routes.json is a non-empty host->dir map', () => {
  assert.ok(Object.keys(ROUTES).length > 50, 'has the full surface set');
  for (const [host, dir] of Object.entries(ROUTES)) {
    assert.match(host, /\./, `${host} looks like a hostname`);
    assert.match(dir, /^[a-z0-9._-]+$/i, `${dir} looks like a dir`);
  }
});

test('every routed dir present in this tree has a server.mjs', () => {
  // A handful of surfaces live only on the production box (uncommitted); those are
  // verified over HTTP on the box after deploy. Here we assert that every routed dir
  // which DOES exist in the tree exposes a server.mjs (no dangling/mistyped routes).
  let checked = 0;
  for (const dir of new Set(Object.values(ROUTES))) {
    if (!existsSync(path.join(SITE_ROOT, dir))) continue; // box-only surface
    assert.ok(existsSync(path.join(SITE_ROOT, dir, 'server.mjs')), `site/${dir}/server.mjs exists`);
    checked++;
  }
  assert.ok(checked > 50, 'checked the bulk of surfaces locally');
});

test('hostToDir normalizes case, port, and www.', () => {
  const r = { 'wiki.soapbox.community': 'wiki' };
  assert.equal(hostToDir('wiki.soapbox.community', r), 'wiki');
  assert.equal(hostToDir('WIKI.soapbox.community:443', r), 'wiki');
  assert.equal(hostToDir('www.wiki.soapbox.community', r), 'wiki');
  assert.equal(hostToDir('nope.example.com', r), null);
  assert.equal(hostToDir(undefined, r), null);
});

test('unknown host soft-fails to 404 (no throw)', async () => {
  const res = await req('nothing.example.com');
  assert.equal(res.code, 404);
});

test('a known content surface renders 200 through the dispatcher', async () => {
  // wiki is the Library of Ashurbanipal, served — a pure content surface, no secrets
  const res = await req('wiki.soapbox.community', '/health').catch(() => null);
  // health may or may not exist per surface; hit / as the real check
  const home = await req('wiki.soapbox.community', '/');
  assert.equal(home.code, 200, 'wiki home is 200');
  assert.ok(home.body.length > 100, 'wiki renders a real page');
});

test('hathor.live renders and still mounts the Almanack', async () => {
  const home = await req('hathor.live', '/');
  assert.equal(home.code, 200);
  const alm = await req('hathor.live', '/almanack');
  assert.equal(alm.code, 200, 'almanack mounted under hathor.live');
  assert.match(alm.body, /Almanack/);
});

test('central SEO: every host serves a welcoming robots.txt with the sitemap-index', async () => {
  const r = await req('hathor.soapbox.community', '/robots.txt');
  assert.equal(r.code, 200);
  assert.match(r.body, /ClaudeBot/);          // AI crawler welcomed (GEO)
  assert.match(r.body, /GPTBot/);
  assert.match(r.body, /Sitemap: https:\/\/hathor\.soapbox\.community\/sitemap-index\.xml/);
});

test('central SEO: master sitemap-index covers ALL routed hosts', async () => {
  const r = await req('soapbox.community', '/sitemap-index.xml');
  assert.equal(r.code, 200);
  assert.match(r.headers['content-type'], /xml/);
  const n = (r.body.match(/<sitemap>/g) || []).length;
  assert.ok(n > 50, `index lists the full set (${n})`);
  assert.match(r.body, /hathor\.soapbox\.community/);
  assert.match(r.body, /vankushfamily\.com/);
});

test('central SEO never shadows a real page (surface routing intact)', async () => {
  const r = await req('vankushfamily.com', '/');
  assert.equal(r.code, 200);
});
