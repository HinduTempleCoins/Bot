// video-studio-toolkit.test.mjs — the toolkit: data validation, uploads, own-data jobs, API keys, pages. Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

process.env.VSTUDIO_DIR = mkdtempSync(join(tmpdir(), 'vstk-'));
process.env.VSTUDIO_WORKER_TOKEN = 'w'.repeat(40);
process.env.VSTUDIO_ENGINES = 'film,animate,subtitles';
const vs = await import('./video-studio.mjs');
const TK = await import('./video-studio-toolkit.mjs');

function mockReq({ method = 'GET', url = '/', body = null, headers = {} } = {}) {
  const buf = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const r = Readable.from(buf ? [buf] : []);
  return Object.assign(r, { method, url, headers: { 'x-forwarded-for': '8.8.4.4', ...(buf ? { 'content-length': String(buf.length) } : {}), ...headers }, socket: { remoteAddress: '8.8.4.4' } });
}
function mockRes() { return { code: 0, headers: {}, body: Buffer.alloc(0), writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(d) { if (d != null) this.body = Buffer.isBuffer(d) ? d : Buffer.from(String(d)); } }; }
const ctx = { pageShell: (t, b) => `<title>${vs.esc(t)}</title>${b}`, sendHtml: (res, html, code = 200) => { res.writeHead(code, { 'content-type': 'text/html' }); res.end(html); }, clientIp: () => '8.8.4.4', base: 'https://s', loadRemakes: () => ({ scenes: [] }) };
async function call(path, opts = {}) { const req = mockReq({ ...opts, url: path }); const res = mockRes(); await vs.videoStudioRoute(req, res, path.split('?')[0], ctx); return { code: res.code, text: res.body.toString(), json: () => JSON.parse(res.body.toString()), headers: res.headers }; }
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(64)]);
const V = 'visitor-aaaaaaaaaaaa';

test('validators: GeoJSON territories, route CSV, asset packs — clear errors', () => {
  assert.ok(TK.validate('geojson', TK.TEMPLATES['map-territories.geojson'].body).ok);
  const bad = TK.validate('geojson', JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { fromYear: 10, toYear: 5 } }] }));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /properties\.name/.test(e)));
  assert.ok(bad.errors.some((e) => /toYear is before fromYear/.test(e)));
  assert.ok(TK.validate('csv', TK.TEMPLATES['map-route.csv'].body).ok);
  assert.ok(TK.validate('csv', 'place,lat,lon,year\nA,95,0,1\nB,0,0,2\n').errors.some((e) => /lat out of range/.test(e)));
  assert.ok(TK.validate('assets', JSON.stringify({ files: [{ file: 'x', type: 'character', licence: 'mine' }] })).ok);
  assert.equal(TK.validate('assets', JSON.stringify({ files: [{ file: 'x', type: 'dragon' }] })).ok, false);
});

test('uploads: licence required, type + magic bytes checked, served back; invalid GeoJSON refused', async () => {
  assert.equal((await call(`/video-studio/api/uploads?kind=image&voter=${V}`, { method: 'PUT', body: PNG, headers: { 'content-type': 'image/png' } })).code, 400); // no licence
  assert.equal((await call(`/video-studio/api/uploads?kind=image&licence=mine&voter=${V}`, { method: 'PUT', body: Buffer.from('<html>nope</html>'.padEnd(80)), headers: { 'content-type': 'image/png' } })).code, 415);
  assert.equal((await call(`/video-studio/api/uploads?kind=image&licence=mine&voter=${V}`, { method: 'PUT', body: PNG, headers: { 'content-type': 'text/html' } })).code, 415);
  const ok = await call(`/video-studio/api/uploads?kind=image&licence=cc0&voter=${V}`, { method: 'PUT', body: PNG, headers: { 'content-type': 'image/png' } });
  assert.equal(ok.code, 200);
  const served = await call(ok.json().url);
  assert.equal(served.code, 200);
  assert.equal(served.headers['x-content-type-options'], 'nosniff');
  const geo = await call(`/video-studio/api/uploads?kind=geojson&licence=mine&voter=${V}`, { method: 'PUT', body: '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]},"properties":{}}]}', headers: { 'content-type': 'application/geo+json' } });
  assert.equal(geo.code, 422);
  assert.match(geo.json().error, /properties\.name/);
});

test('animate job uses only your own uploads; the worker gets their URLs', async () => {
  const up = (await call(`/video-studio/api/uploads?kind=image&licence=mine&voter=${V}`, { method: 'PUT', body: PNG, headers: { 'content-type': 'image/png' } })).json();
  const other = (await call(`/video-studio/api/uploads?kind=image&licence=mine&voter=someone-else-bbbbbb`, { method: 'PUT', body: PNG, headers: { 'content-type': 'image/png' } })).json();
  assert.equal((await call('/video-studio/api/jobs', { method: 'POST', body: { tool: 'animate', inputs: [other.id], voter: V } })).code, 400);
  const j = await call('/video-studio/api/jobs', { method: 'POST', body: { tool: 'animate', params: { title: 'My tomb', secs: 6 }, inputs: [up.id], voter: V } });
  assert.equal(j.code, 200);
  const id = j.json().id;
  await call(`/video-studio/api/jobs/${id}/render`, { method: 'POST', body: '' });
  assert.equal(vs.getJob(id).status, 'queued');
  const pulled = (await call('/video-studio/api/worker/next', { method: 'POST', body: {}, headers: { authorization: `Bearer ${'w'.repeat(40)}` } })).json().job;
  assert.equal(pulled.tool, 'animate');
  assert.equal(pulled.inputs[0].url, `https://s/video-studio/u/${up.id}`);
  assert.equal(pulled.params.title, 'My tomb');
});

test('subtitles need an https video; map inputs are accepted but rendering waits for its engine', async () => {
  assert.equal((await call('/video-studio/api/jobs', { method: 'POST', body: { tool: 'subtitles', params: { url: 'http://x/a.mp4' }, voter: V } })).code, 400);
  assert.equal((await call('/video-studio/api/jobs', { method: 'POST', body: { tool: 'subtitles', params: { url: 'https://archive.org/download/x/film.mp4' }, voter: 'visitor-cccccccccccc' } })).code, 200);
  const csv = (await call(`/video-studio/api/uploads?kind=csv&licence=mine&voter=visitor-dddddddddddd`, { method: 'PUT', body: TK.TEMPLATES['map-route.csv'].body, headers: { 'content-type': 'text/csv' } })).json();
  const mj = (await call('/video-studio/api/jobs', { method: 'POST', body: { tool: 'map', params: { title: 'Piye marches north' }, inputs: [csv.id], voter: 'visitor-dddddddddddd' } })).json();
  await call(`/video-studio/api/jobs/${mj.id}/render`, { method: 'POST', body: '' });
  assert.equal(vs.getJob(mj.id).status, 'planned');
  assert.match(vs.getJob(mj.id).error, /opens soon/);
  assert.equal(TK.toolStatus('map'), 'engine-pending');
  assert.equal(TK.toolStatus('remake'), 'page');
});

test('API keys: issued once, stored hashed, act as the visitor for uploads and jobs', async () => {
  const k = (await call('/video-studio/api/keys', { method: 'POST', body: { voter: 'visitor-eeeeeeeeeeee' } })).json();
  assert.match(k.key, /^vsk_[a-f0-9]{40}$/);
  const H = { authorization: `Bearer ${k.key}` };
  const up = (await call('/video-studio/api/uploads?kind=image&licence=mine', { method: 'PUT', body: PNG, headers: { ...H, 'content-type': 'image/png' } })).json();
  assert.ok(up.ok);
  const j = await call('/video-studio/api/jobs', { method: 'POST', body: { tool: 'animate', inputs: [up.id] }, headers: H });
  assert.equal(j.code, 200);
  const { readFileSync } = await import('node:fs');
  assert.doesNotMatch(readFileSync(join(process.env.VSTUDIO_DIR, 'keys.jsonl'), 'utf8'), /vsk_/); // only the hash is stored
});

test('pages: toolkit shows live vs pending, data page has templates + schemas + curl; downloads work', async () => {
  const tk = (await call('/video-studio/toolkit')).text;
  assert.match(tk, /Animate your images <span[^>]*>live/);
  assert.match(tk, /Animated history map <span[^>]*>inputs accepted/);
  assert.match(tk, /Alpha\./);
  const data = (await call('/video-studio/data')).text;
  assert.match(data, /map-territories\.schema\.json/);
  assert.match(data, /curl -X PUT/);
  const t = await call('/video-studio/data/map-route.csv');
  assert.equal(t.code, 200);
  assert.match(t.text, /^place,lat,lon,year/);
  assert.equal(JSON.parse((await call('/video-studio/data/job.schema.json')).text).title, 'Video Studio job');
  assert.equal((await call('/video-studio/data/../../etc/passwd')).code, 404);
});
