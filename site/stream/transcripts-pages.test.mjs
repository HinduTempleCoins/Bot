// transcripts-pages.test.mjs — Pentecaust transcripts on SoapBox Stream. Offline, temp TRANSCRIPTS_DIR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TRANSCRIPTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'txp-'));
const { addTrack, listEdits } = await import('../../pentecaust/transcripts/store.mjs');
const { toVtt } = await import('../../pentecaust/transcripts/vtt.mjs');
const P = await import('./transcripts-pages.mjs');

addTrack('ia', 'Haunted_1921', { title: 'The <Haunted> House', body: toVtt([{ start: 1, end: 3, text: 'Who <goes> there?' }, { start: 4, end: 6, text: 'Nobody.' }]), provenance: 'ai-edited', model: 'faster-whisper small int8 + clean-pass' });

function res() { return { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = String(b == null ? '' : b); } }; }
function req(method, body = '') { const l = {}; const r = { method, headers: { 'x-forwarded-for': '9.9.9.9' }, socket: {}, on(e, f) { l[e] = f; if (e === 'end') setTimeout(() => { if (body && l.data) l.data(Buffer.from(body)); l.end(); }, 0); return r; } }; return r; }
const ctx = { shell: (t, b) => `<title>${t}</title>${b}`, send: (r, h, c = 200) => { r.writeHead(c, { 'content-type': 'text/html' }); r.end(h); }, clientIp: () => '9.9.9.9' };

test('VTT serves as text/vtt; unknown and unsafe ids 404', async () => {
  let r = res(); assert.equal(await P.transcriptsRoute(req('GET'), r, '/transcripts/ia/Haunted_1921.vtt', ctx), true);
  assert.equal(r.code, 200); assert.match(r.headers['content-type'], /text\/vtt/); assert.match(r.body, /Who <goes> there\?/);
  r = res(); await P.transcriptsRoute(req('GET'), r, '/transcripts/ia/Nope.vtt', ctx); assert.equal(r.code, 404);
  r = res(); assert.equal(await P.transcriptsRoute(req('GET'), r, '/transcripts/ia/..%2Fx.vtt', ctx), false);
});

test('player track + transcript link label AI provenance; transcript page escapes and invites corrections', async () => {
  assert.match(P.trackTag('ia', 'Haunted_1921'), /<track kind=subtitles srclang=en label="English \(AI-made\)" src="\/transcripts\/ia\/Haunted_1921\.vtt" default>/);
  assert.equal(P.trackTag('ia', 'Nope'), '');
  assert.match(P.transcriptLink('ia', 'Haunted_1921'), /AI-made — please help correct/);
  const r = res(); await P.transcriptsRoute(req('GET'), r, '/watch/ia/Haunted_1921/transcript', ctx);
  assert.equal(r.code, 200);
  assert.match(r.body, /#1<\/span> Who there\?/); // subtitle markup stripped, text escaped
  assert.doesNotMatch(r.body, /<goes>/);
  assert.match(r.body, /Transcript: The &lt;Haunted&gt; House/);
  assert.match(r.body, /Suggest a correction/);
});

test('corrections: stored with a hashed voter, validated, rate-limited', async () => {
  P.__resetTranscriptRate();
  const post = async (body) => { const r = res(); await P.transcriptsRoute(req('POST', body), r, '/api/transcripts/suggest', ctx); return r; };
  let r = await post('src=ia&id=Haunted_1921&cue=1&text=Who+goes+there%3F+(shouted)&voter=voterkey-aaaaaaaaaaaa');
  assert.deepEqual(JSON.parse(r.body), { ok: true });
  const e = listEdits('ia', 'Haunted_1921');
  assert.equal(e.length, 1); assert.equal(e[0].cue, 1); assert.doesNotMatch(JSON.stringify(e), /voterkey-/);
  assert.equal((await post('src=ia&id=Nope&text=hi+there&voter=voterkey-aaaaaaaaaaaa')).code, 404);
  assert.equal((await post('src=ia&id=Haunted_1921&text=hi+there&voter=x')).code, 400);
  process.env.TRANSCRIPT_RATE_PER_HOUR = '1';
  assert.equal((await post('src=ia&id=Haunted_1921&text=again+please&voter=voterkey-aaaaaaaaaaaa')).code, 429);
  delete process.env.TRANSCRIPT_RATE_PER_HOUR;
});
