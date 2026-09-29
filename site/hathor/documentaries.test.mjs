// documentaries.test.mjs — Hathor's documentaries page: alpha notice, film page, feedback incl. timestamped notes,
// feedback export with recipes, safe media serving with Range. Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as D from './documentaries.mjs';

const dir = mkdtempSync(join(tmpdir(), 'docs-'));
mkdirSync(join(dir, 'kush-nile'));
writeFileSync(join(dir, 'kush-nile', 'film.mp4'), Buffer.from('0123456789abcdef'));
writeFileSync(join(dir, 'kush-nile', 'poster.jpg'), 'JPG');
const film = { id: 'kush-nile', title: 'Kush and the <Nile>', summary: 's', seconds: 600, chapters: [{ title: 'The River', start: 7 }], onscreen: [{ at: 12, text: 'Meroë, c. 300 BC', kind: 'record', source: 'Excavations at Meroë' }], sources: { record: ['Excavations at Meroë'], tradition: ['Genesis 2:13'] }, recipe: { style: 'wonder', shots: [{ asset: 'remake:x' }] }, missing: [{ visual: 'a Kushite queen' }] };
writeFileSync(join(dir, 'kush-nile', 'film.json'), JSON.stringify(film));
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ films: [film] }));
const fb = join(dir, 'fb.jsonl');
const P = (o) => new URLSearchParams(o);

test('list + film pages carry the ALPHA notice, escape text, show kinds, chapters and missing parts', () => {
  const list = D.listBody(D.loadDocs(dir), {});
  assert.match(list, /ALPHA/); assert.match(list, /Kush and the &lt;Nile&gt;/);
  const page = D.filmBody(D.loadFilm('kush-nile', dir));
  assert.match(page, /ALPHA/); assert.match(page, /Historical record · Excavations at Meroë/);
  assert.match(page, /Tradition \/ scripture:<\/b> Genesis 2:13/); assert.match(page, /a Kushite queen/);
  assert.match(page, /Note at/);
});

test('feedback: votes count once per voter, timestamped notes keep their second, export joins recipes', () => {
  D.__resetDocsRate();
  const opt = { dir, path: fb };
  assert.equal(D.feedback(P({ id: 'kush-nile', voter: 'voterkey-aaaaaaaaaaaa', vote: 'up' }), 'ip', opt).code, 200);
  assert.deepEqual(D.feedback(P({ id: 'kush-nile', voter: 'voterkey-aaaaaaaaaaaa', vote: 'down' }), 'ip', opt).body, { ok: true, up: 0, down: 1 });
  assert.equal(D.feedback(P({ id: 'kush-nile', voter: 'voterkey-bbbbbbbbbbbb', comment: 'the pyramid shot <b> is too short', at: '192.4' }), 'ip', opt).code, 200);
  assert.equal(D.feedback(P({ id: 'kush-nile', voter: 'voterkey-bbbbbbbbbbbb', at: '5' }), 'ip', opt).code, 400); // note without text
  assert.equal(D.feedback(P({ id: 'nope', voter: 'voterkey-bbbbbbbbbbbb', vote: 'up' }), 'ip', opt).code, 404);
  assert.doesNotMatch(readFileSync(fb, 'utf8'), /voterkey-/);
  const agg = D.aggregate(D.readFeedback(fb))['kush-nile'];
  assert.equal(agg.notes[0].at, 192.4);
  assert.match(D.filmBody(film, agg), /3:12<\/span><\/a> the pyramid shot &lt;b&gt; is too short/);
  const ex = D.feedbackExport(dir, fb).films['kush-nile'];
  assert.equal(ex.down, 1); assert.equal(ex.recipe.style, 'wonder'); assert.equal(ex.notes.length, 1);
});

test('media: Range reads only the slice; traversal and unknown files 404', () => {
  const res = () => ({ code: 0, h: {}, body: null, writeHead(c, h) { this.code = c; Object.assign(this.h, h || {}); }, end(b) { this.body = b; } });
  let r = res(); D.serveDocMedia({ headers: { range: 'bytes=2-5' } }, r, 'kush-nile/film.mp4', dir);
  assert.equal(r.code, 206); assert.equal(String(r.body), '2345');
  for (const bad of ['../x/film.mp4', 'kush-nile/film.json', 'KUSH/film.mp4']) { r = res(); D.serveDocMedia({ headers: {} }, r, bad, dir); assert.equal(r.code, 404, bad); }
});

test('documentary media: a real HTTP response streams the WHOLE film (full GET and open-ended range), not a 4 MB slice', async () => {
  const { serveDocMedia } = await import('./documentaries.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const http = await import('node:http');
  const dir = mkdtempSync(join(tmpdir(), 'docs-stream-'));
  mkdirSync(join(dir, 'big-film'));
  const size = 5 * 1024 * 1024 + 123;
  writeFileSync(join(dir, 'big-film', 'film.mp4'), Buffer.alloc(size, 7));
  const srv = http.createServer((req, res) => serveDocMedia(req, res, 'big-film/film.mp4', dir));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const get = (headers = {}) => new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/', headers }, (res) => { let n = 0; res.on('data', (c) => { n += c.length; }); res.on('end', () => resolve({ code: res.statusCode, n, len: +res.headers['content-length'] })); }));
  const full = await get();
  assert.equal(full.code, 200); assert.equal(full.n, size);
  const open = await get({ range: 'bytes=1000-' });
  assert.equal(open.code, 206); assert.equal(open.n, size - 1000);
  const part = await get({ range: 'bytes=0-99' });
  assert.equal(part.code, 206); assert.equal(part.n, 100);
  srv.close();
});
