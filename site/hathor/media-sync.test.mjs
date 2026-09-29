// media-sync.test.mjs — worker → web media sync (HTTPS + worker token). Offline: real local HTTP server, temp dirs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msync-'));
for (const k of ['REMAKES_DIR', 'ANIMS_DIR', 'DOCS_DIR', 'MAPS_DIR', 'VSTUDIO_DIR', 'TRANSCRIPTS_DIR']) process.env[k] = path.join(root, k.toLowerCase());
process.env.VSTUDIO_WORKER_TOKEN = 'x'.repeat(32);
const { videoStudioRoute } = await import('./video-studio.mjs');
const { validRel } = await import('./media-sync.mjs');

const srv = http.createServer(async (req, res) => { const p = new URL(req.url, 'http://x').pathname; if (!(await videoStudioRoute(req, res, p, { base: 'http://x', loadRemakes: () => ({ scenes: [] }), pageShell: (t, b) => b, sendHtml: (r, h) => r.end(h), clientIp: () => '1.2.3.4' }))) { res.writeHead(404); res.end(); } });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const call = (method, p, body, auth = true) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: auth ? { authorization: `Bearer ${'x'.repeat(32)}` } : {} }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ code: res.statusCode, body: b ? JSON.parse(b) : {} })); });
  if (body != null) req.write(body);
  req.end();
});

test('validRel: allowlisted extensions, ≤4 levels, no traversal or dotfiles', () => {
  assert.equal(validRel('scene_a/1_real_nubian.jpg').ok, true);
  assert.equal(validRel('a/b/c/d.mp4').ok, true);
  for (const bad of ['../x.jpg', 'a/../b.jpg', '.env', 'a/.hidden.jpg', 'x.sh', 'a/b/c/d/e.jpg', '/abs.jpg', 'a//b.jpg', 'x.JS']) assert.equal(validRel(bad).ok, false, bad);
});

test('auth required; unknown target 404', async () => {
  assert.equal((await call('GET', '/video-studio/api/worker/sync/remakes/list', null, false)).code, 401);
  assert.equal((await call('GET', '/video-studio/api/worker/sync/nope/list')).code, 404);
});

test('media then manifest; manifest must have its list and may not shrink by more than half', async () => {
  let r = await call('PUT', '/video-studio/api/worker/sync/remakes/scene_a/1_real_nubian.jpg', Buffer.from('JPEGDATA'));
  assert.equal(r.code, 200);
  assert.equal(fs.readFileSync(path.join(process.env.REMAKES_DIR, 'scene_a', '1_real_nubian.jpg'), 'utf8'), 'JPEGDATA');
  assert.equal((await call('PUT', '/video-studio/api/worker/sync/remakes/manifest.json', '{not json')).code, 400);
  assert.equal((await call('PUT', '/video-studio/api/worker/sync/remakes/manifest.json', '{"clips":[]}')).code, 400);
  const scenes = Array.from({ length: 10 }, (_, i) => ({ key: `s${i}` }));
  assert.equal((await call('PUT', '/video-studio/api/worker/sync/remakes/manifest.json', JSON.stringify({ scenes }))).code, 200);
  r = await call('PUT', '/video-studio/api/worker/sync/remakes/manifest.json', JSON.stringify({ scenes: scenes.slice(0, 3) }));
  assert.equal(r.code, 400); assert.match(r.body.error, /shrink/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.REMAKES_DIR, 'manifest.json'), 'utf8')).scenes.length, 10); // untouched
  const l = await call('GET', '/video-studio/api/worker/sync/remakes/list');
  assert.equal(l.body.files['scene_a/1_real_nubian.jpg'], 8);
  assert.ok(!Object.keys(l.body.files).some((k) => k.includes('.sync-')), 'no temp files left');
});

test('rejects bad paths / extensions over HTTP', async () => {
  assert.equal((await call('PUT', '/video-studio/api/worker/sync/anims/..%2F..%2Fetc%2Fx.jpg', Buffer.from('x'))).code, 400);
  assert.equal((await call('PUT', '/video-studio/api/worker/sync/anims/run.sh', Buffer.from('x'))).code, 400);
  assert.equal((await call('PUT', '/video-studio/api/worker/sync/anims/a.jpg', Buffer.alloc(0))).code, 400);
});

test('transcripts: vtt then job.json → ingested into the transcript store', async () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello there, this is a test line.\n\n00:00:04.000 --> 00:00:06.000\nAnd a second line.\n';
  assert.equal((await call('PUT', '/video-studio/api/worker/sync/transcripts/ia/TestFilm/en.ai-whisper.vtt', vtt)).code, 200);
  const r = await call('PUT', '/video-studio/api/worker/sync/transcripts/ia/TestFilm/job.json', JSON.stringify({ title: 'Test Film', model: 'faster-whisper-small' }));
  assert.equal(r.code, 200);
  assert.equal(r.body.ingested, true);
  const meta = JSON.parse(fs.readFileSync(path.join(process.env.TRANSCRIPTS_DIR, 'ia', 'TestFilm', 'meta.json'), 'utf8'));
  assert.deepEqual(meta.tracks.map((t) => t.provenance).sort(), ['ai-edited', 'ai-whisper']);
  srv.close();
});
