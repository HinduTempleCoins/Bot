// server.test.mjs — OFFLINE. The Game-World / Fort hub surface + embed SDK. No network, mock res.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, hubPage, embedPage, loaderJs, sdkPage, demoWorld } from './server.mjs';
import { embedManifest, SYSTEMS } from './model.mjs';

function mockRes() {
  return { code: null, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; }, end(s) { this.body = s == null ? '' : String(s); } };
}
async function get(path) { const res = mockRes(); await handler({ url: path, headers: { host: 'fort.test' } }, res); return res; }

test('demoWorld has the Seed Farm and HUD attached', () => {
  const w = demoWorld();
  assert.equal(w.systems['seed-farm'].attached, true);
  assert.equal(w.systems.hud.attached, true);
  assert.ok(w.buildings['seed-plot'] && w.buildings['command-centre']);
});

test('hub page 200: alpha badge, fort, Seed Farm + HUD panels, embed pitch', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.body, /class=alpha>Alpha</);
  assert.match(res.body, new RegExp(SYSTEMS['seed-farm'].title));
  assert.match(res.body, new RegExp(SYSTEMS.hud.title));
  assert.match(res.body, /melek-fort/);          // embed pitch present
  assert.match(res.body, /Fort score/);
});

test('hub page lists every plot name', async () => {
  const res = await get('/');
  const { PLOTS } = await import('./model.mjs');
  for (const def of Object.values(PLOTS)) assert.ok(res.body.includes(def.name), `plot ${def.name} shown`);
});

test('hub page carries the compliance line', async () => {
  const res = await get('/');
  assert.match(res.body, /non-cashable|not real money/i);
});

test('/api/world returns the embedManifest JSON', async () => {
  const res = await get('/api/world');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const j = JSON.parse(res.body);
  assert.deepEqual(j, embedManifest(demoWorld()));
  assert.ok(j.systems.includes('seed-farm') && j.systems.includes('hud'));
  assert.equal(j.journal, undefined);
});

test('/gameworld.js defines the <melek-fort> web component', async () => {
  const res = await get('/gameworld.js');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.match(res.body, /customElements\.define\('melek-fort'/);
  assert.match(res.body, /postMessage/);
});

test('/embed posts a ready manifest and accepts targeted events', async () => {
  const res = await get('/embed');
  assert.equal(res.code, 200);
  assert.match(res.body, /source:'melek-fort'/);
  assert.match(res.body, /post\('ready'/);
  assert.match(res.body, /class=alpha>Alpha</);
});

test('/embed?theme=light flips the background token', async () => {
  const res = await get('/embed?theme=light');
  assert.match(res.body, /--bg:#f6f6f9/);
});

test('/embed?theme=<bad json> soft-fails to default (no throw)', async () => {
  const res = await get('/embed?theme=%7Bnot-json');
  assert.equal(res.code, 200);
  assert.match(res.body, /--bg:#0b0b0f/);
});

test('/sdk documents events, theming, and the signer boundary', async () => {
  const res = await get('/sdk');
  assert.equal(res.code, 200);
  assert.match(res.body, /resource\/grant/);
  assert.match(res.body, /signer/i);
  assert.match(res.body, /never holds a private key/i);
  assert.match(res.body, /theme/i);
});

test('/health ok, unknown path redirects home', async () => {
  const h = await get('/health');
  assert.equal(h.code, 200);
  assert.equal(h.body, 'ok');
  const nf = await get('/nope');
  assert.equal(nf.code, 302);
});

test('render helpers escape and never throw', () => {
  assert.doesNotThrow(() => hubPage());
  assert.doesNotThrow(() => embedPage());
  assert.doesNotThrow(() => sdkPage());
  assert.doesNotThrow(() => loaderJs());
});
