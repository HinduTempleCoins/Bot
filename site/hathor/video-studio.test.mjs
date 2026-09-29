// video-studio.test.mjs — Video Studio: planner, plan hygiene, limits, worker pull API, pages. Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

process.env.VSTUDIO_DIR = mkdtempSync(join(tmpdir(), 'vs-'));
process.env.VSTUDIO_WORKER_TOKEN = 'w'.repeat(40);
process.env.VSTUDIO_PRODUCTION_TOKEN = 'p'.repeat(40);
process.env.VSTUDIO_PER_VISITOR = '2';
process.env.VSTUDIO_OURS_MINUTES = '12';
const vs = await import('./video-studio.mjs');

const MANIFEST = { scenes: [
  { key: 'meroe_pyramids', title: 'The pyramids of Meroë, Kush', group: 'Nubia', credit: 'Photo, Meroë (CC BY-SA)', looks: { '1_real': { nubian: 'a.jpg', egyptian: 'b.jpg' }, '2_half': { nubian: 'c.jpg' } } },
  { key: 'nile_barque', title: 'A barque on the Nile', group: 'The Nile', credit: 'Tomb painting', looks: { '1_real': { egyptian: 'd.jpg' } } },
  { key: 'minoan_bull', title: 'Bull-leaping at Knossos', group: 'Minoans', credit: 'Fresco', looks: { '1_real': { minoan: 'e.jpg' } } },
] };

function mockReq({ method = 'GET', url = '/', body = null, headers = {} } = {}) {
  const r = Readable.from(body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  return Object.assign(r, { method, url, headers: { 'x-forwarded-for': '9.9.9.9', ...headers }, socket: { remoteAddress: '9.9.9.9' } });
}
function mockRes() { return { code: 0, headers: {}, body: Buffer.alloc(0), writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(d) { if (d != null) this.body = Buffer.isBuffer(d) ? d : Buffer.from(String(d)); } }; }
const ctx = { pageShell: (t, b) => `<title>${vs.esc(t)}</title>${b}`, sendHtml: (res, html, code = 200) => { res.writeHead(code, { 'content-type': 'text/html' }); res.end(html); }, clientIp: () => '9.9.9.9', base: 'https://s', loadRemakes: () => MANIFEST };
async function call(path, opts = {}) { const req = mockReq({ ...opts, url: path }); const res = mockRes(); await vs.videoStudioRoute(req, res, path, ctx); return res; }
const W = { authorization: `Bearer ${'w'.repeat(40)}` };

test('our planner reuses remakes that match the topic, moving through places before repeating', () => {
  const p = vs.ourPlan({ topic: 'Kush and the pyramids of Meroë', minutes: 1, style: 'eerie' }, MANIFEST, 'https://s');
  const shots = p.chapters.flatMap((c) => c.shots);
  assert.equal(shots.length, Math.round(60 / 8));
  assert.equal(shots[0].scene, 'meroe_pyramids'); // the match leads
  assert.ok(shots.some((s) => s.scene === 'nile_barque')); // then the rest of the gallery
  assert.match(shots[0].image, /^https:\/\/s\/remakes\/img\/meroe_pyramids\/a\.jpg$/);
  assert.ok(p.sources.includes('Photo, Meroë (CC BY-SA)'));
  assert.equal(p.matched, 1);
});

test('cleanPlan keeps https/data images and prompts, drops scripts and junk', () => {
  const p = vs.cleanPlan({ title: 'T', chapters: [{ title: 'c', shots: [{ image: 'javascript:alert(1)', card: 'x' }, { image: 'https://a/b.jpg', card: '<b>', secs: 999 }, { prompt: 'a ziggurat at dawn' }] }] });
  const shots = p.chapters[0].shots;
  assert.equal(shots.length, 2);
  assert.equal(shots[0].secs, 30);
  assert.equal(vs.cleanPlan({ chapters: [] }), null);
  assert.match(vs.planPrompt({ topic: 'Giants in the old stories', minutes: 10, style: 'eerie' }), /as the tradition tells it/);
});

test('create → plan page → render → worker pulls, uploads, finishes → film served with Range', async () => {
  let r = await call('/video-studio/api/jobs', { method: 'POST', body: { topic: 'Kush and the Nile', minutes: 1, style: 'eerie', voter: 'v'.repeat(20), public: true } });
  assert.equal(r.code, 200);
  const id = JSON.parse(r.body).id;
  let page = await call(`/video-studio/job/${id}`);
  assert.match(page.body.toString(), /Alpha\./);
  assert.match(page.body.toString(), /Render it/);
  r = await call(`/video-studio/api/jobs/${id}/render`, { method: 'POST', body: '' });
  assert.equal(r.code, 303);
  assert.equal(vs.getJob(id).status, 'queued');
  assert.equal((await call('/video-studio/api/worker/next', { method: 'POST', body: {} })).code, 401); // no token
  r = await call('/video-studio/api/worker/next', { method: 'POST', body: {}, headers: W });
  const pulled = JSON.parse(r.body).job;
  assert.equal(pulled.id, id);
  assert.ok(pulled.plan.chapters.length);
  assert.equal(vs.getJob(id).status, 'rendering');
  assert.equal((await call(`/video-studio/api/worker/${id}/video.mp4`, { method: 'PUT', body: Buffer.from('MP4DATA0123456789'), headers: W })).code, 200);
  assert.equal((await call(`/video-studio/api/worker/${id}/poster.jpg`, { method: 'PUT', body: Buffer.from('JPG'), headers: W })).code, 200);
  assert.equal((await call(`/video-studio/api/worker/${id}/done`, { method: 'POST', body: { durationSecs: 62, renderSecs: 40 }, headers: W })).code, 200);
  assert.equal(vs.getJob(id).status, 'done');
  const part = await call(`/video-studio/media/${id}/video.mp4`, { headers: { range: 'bytes=3-6' } });
  assert.equal(part.code, 206);
  assert.equal(part.body.toString(), 'DATA');
  const gal = await call('/video-studio/gallery');
  assert.match(gal.body.toString(), new RegExp(`/video-studio/job/${id}`));
  const pub = JSON.parse((await call(`/video-studio/api/jobs/${id}`)).body).job;
  assert.equal(pub.voter, undefined); // the visitor hash is never exposed
});

test('limits: per-visitor per day, and the daily budget of our CPU', async () => {
  const mk = (t, m) => call('/video-studio/api/jobs', { method: 'POST', body: { topic: t, minutes: m, voter: 'z'.repeat(20) } });
  const a = JSON.parse((await mk('Babylon', 10)).body);
  assert.ok(a.ok);
  assert.equal((await mk('Persia', 1)).code, 200);
  assert.equal((await mk('India', 1)).code, 429); // 2 per visitor per day
  // budget 12 min/day; 1 min already done above; a 10-min fits, another would not
  await call(`/video-studio/api/jobs/${a.id}/render`, { method: 'POST', body: '' });
  assert.equal(vs.getJob(a.id).status, 'queued');
  const b = JSON.parse((await call('/video-studio/api/jobs', { method: 'POST', body: { topic: 'Minoans', minutes: 10, voter: 'y'.repeat(20) } })).body);
  await call(`/video-studio/api/jobs/${b.id}/render`, { method: 'POST', body: '' });
  assert.equal(vs.getJob(b.id).status, 'planned');
  assert.match(vs.getJob(b.id).error, /full for today/);
});

test('pages: create form (engines per stage, keys client-side), tools, docs; everything escaped; Alpha everywhere', async () => {
  const home = (await call('/video-studio')).body.toString();
  assert.match(home, /Alpha\./);
  assert.match(home, /name=eng_plan/);
  assert.match(home, /localStorage/);
  assert.doesNotMatch(home, /api_key=|\bkey:\s*'sk-/);
  const tools = (await call('/video-studio/tools')).body.toString();
  assert.match(tools, /FFmpeg/);
  assert.match(tools, /faster-whisper/);
  const docs = (await call('/video-studio/docs')).body.toString();
  assert.match(docs, /Add your own API/);
  assert.match(docs, /&quot;chapters&quot;/);
  const r = await call('/video-studio/api/jobs', { method: 'POST', body: { topic: '<script>alert(1)</script> Nile', minutes: 1, voter: 'x'.repeat(20) } });
  const page = (await call(`/video-studio/job/${JSON.parse(r.body).id}`)).body.toString();
  assert.doesNotMatch(page, /<script>alert/);
  assert.equal((await call('/video-studio/media/0000000000000000/../x')).code, 404);
});

test('production jobs: own token, queued at once, worker gets docPlan, done only when published, capped', async () => {
  const P = { authorization: `Bearer ${'p'.repeat(40)}` };
  const scenes = [{ visual: 'a', seconds: 6 }, { visual: 'b', seconds: 6 }, { visual: 'c', seconds: 6 }];
  assert.equal((await call('/video-studio/api/production/jobs', { method: 'GET' })).code, 401);
  assert.equal((await call('/video-studio/api/production/jobs', { method: 'POST', body: { docId: 'kush-nile', docPlan: { scenes } }, headers: W })).code, 401); // worker token is not the production token
  let r = await call('/video-studio/api/production/jobs', { method: 'POST', body: { docId: 'Bad Id', docPlan: { scenes } }, headers: P });
  assert.equal(r.code, 400);
  r = await call('/video-studio/api/production/jobs', { method: 'POST', body: { docId: 'giants-10', topic: 'giants', minutes: 10, style: 'wonder', docPlan: { topic: 'giants', scenes } }, headers: P });
  assert.equal(r.code, 200);
  const id = JSON.parse(r.body).id;
  assert.equal((await call('/video-studio/api/production/jobs', { method: 'POST', body: { docId: 'giants-10', docPlan: { scenes } }, headers: P })).code, 409); // same film already open
  const st = JSON.parse((await call('/video-studio/api/production/jobs', { method: 'GET', headers: P })).body);
  assert.equal(st.queued >= 1, true);
  // drain older public jobs until the worker hands out the production one
  let got = null;
  for (let i = 0; i < 20 && !got; i++) { const n = JSON.parse((await call('/video-studio/api/worker/next', { method: 'POST', body: {}, headers: W })).body); if (!n.job) break; if (n.job.id === id) got = n.job; }
  assert.ok(got, 'worker receives the production job');
  assert.equal(got.tool, 'hathor-documentary');
  assert.equal(got.docId, 'giants-10');
  assert.equal(got.docPlan.scenes.length, 3);
  await call(`/video-studio/api/worker/${id}/done`, { method: 'POST', body: { published: false }, headers: W });
  assert.equal(vs.getJob(id).status, 'failed');
  r = await call('/video-studio/api/production/jobs', { method: 'POST', body: { docId: 'giants-10', docPlan: { scenes } }, headers: P });
  const id2 = JSON.parse(r.body).id;
  for (let i = 0; i < 20; i++) { const n = JSON.parse((await call('/video-studio/api/worker/next', { method: 'POST', body: {}, headers: W })).body); if (!n.job || n.job.id === id2) break; }
  await call(`/video-studio/api/worker/${id2}/done`, { method: 'POST', body: { published: true }, headers: W });
  assert.equal(vs.getJob(id2).status, 'done');
});

test('production status: submitter snapshot (production token) + worker heartbeat (worker token) → read-only page', async () => {
  const { loadStatus, statusBody } = await import('./production-status.mjs');
  const P = { authorization: `Bearer ${'p'.repeat(40)}` };
  assert.equal((await call('/video-studio/api/production/status', { method: 'POST', body: { paused: true }, headers: W })).code, 401);
  let r = await call('/video-studio/api/production/status', { method: 'POST', body: { paused: false, madeToday: 3, open: 1, queue: { total: 290, remaining: 280, published: 10, byLength: { 10: 220, 30: 40, 60: 0 } }, next: [{ docId: 'scheria-30', name: 'Scheria <b>', minutes: 30 }] }, headers: P });
  assert.equal(r.code, 200);
  r = await call('/video-studio/api/worker/heartbeat', { method: 'POST', body: { paused: true, load: 12.5 }, headers: W });
  assert.equal(r.code, 200);
  const st = loadStatus();
  assert.equal(st.submitter.queue.remaining, 280);
  assert.equal(st.worker.paused, true);
  const html = statusBody(st, 10);
  assert.match(html, /Paused/);
  assert.match(html, /280 films waiting/);
  assert.match(html, /Scheria &lt;b&gt;/);
  assert.doesNotMatch(html, /<form|<button/); // no controls on the public web
});
