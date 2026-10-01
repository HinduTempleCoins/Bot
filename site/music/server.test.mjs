import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { handler, loadCatalog, __setDir } from './server.mjs';
import * as openMusic from '../../integrations/soapbox/music-catalog.mjs';

const dir = mkdtempSync(join(tmpdir(), 'music-'));
mkdirSync(join(dir, 'media'));
mkdirSync(join(dir, 'notes'));
writeFileSync(join(dir, 'notes', 'lamp.notes.json'), JSON.stringify({ melody: [[0, 0.5, 60], [0.5, 0.5, 64]] }));
writeFileSync(join(dir, 'media', 'lamp.mp3'), Buffer.from('0123456789'));
writeFileSync(join(dir, 'catalog.json'), JSON.stringify({ tracks: [
  { id: 'lamp-upon-the-water', title: 'Lamp Upon the Water', artist: 'Hathor Sandalphon', genre: 'hymn', shelf: 'christian', seconds: 150, lyrics: 'A lamp <upon> the water', license: 'SoapBox original', file: 'lamp.mp3', notes: 'lamp.notes.json', made: 2 },
  { id: 'gentle-giants', title: 'Gentle Giants', album: 'Earths in the Universe', shelf: 'christian', license: 'SoapBox original', file: 'lamp.mp3', made: 1 },
  { id: 'no-file', title: 'Missing', license: 'x', file: 'gone.mp3' },
  { id: 'Bad ID', title: 'Bad', license: 'x', file: 'lamp.mp3' },
  { id: 'no-licence', title: 'No licence', file: 'lamp.mp3' },
] }));
__setDir(dir);

function res() {
  const chunks = [];
  const r = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } });
  r.writeHead = (code, h = {}) => { r.code = code; r.headers = h; };
  const end = r.end.bind(r);
  r.end = (b) => { if (b) chunks.push(Buffer.from(b)); return end(); };
  r.done = new Promise((ok) => r.on('finish', ok));
  r.body = () => Buffer.concat(chunks).toString();
  return r;
}
async function get(url, headers = {}) { const r = res(); await handler({ url, headers }, r); await r.done; return r; }

test('the catalog keeps only tracks with an id, a title, a licence and a real audio file', () => {
  const t = loadCatalog();
  assert.deepEqual(t.map((x) => x.id), ['lamp-upon-the-water', 'gentle-giants']);
});

test('/music lists the originals on the Christian shelf first, with a player', async () => {
  const r = await get('/music');
  assert.equal(r.code, 200);
  assert.match(r.body(), /Hymns, gospel and worship/);
  assert.match(r.body(), /class="sbp" id=sbp/);                       // the standard panel
  assert.match(r.body(), /data-sbp-track="[^"]*&quot;audio&quot;:&quot;\/music\/media\/lamp\.mp3&quot;/);
  assert.match(r.body(), /href="\/music\/t\/lamp-upon-the-water"/);
});

test('a track page shows escaped lyrics and the licence', async () => {
  const r = await get('/music/t/lamp-upon-the-water');
  assert.equal(r.code, 200);
  assert.match(r.body(), /A lamp &lt;upon&gt; the water/);
  assert.match(r.body(), /Licence:<\/b> SoapBox original/);
  assert.equal((await get('/music/t/nope')).code, 404);
});

test('audio is served whole and by byte range, and paths cannot escape the media folder', async () => {
  const whole = await get('/music/media/lamp.mp3');
  assert.equal(whole.code, 200);
  assert.equal(whole.headers['content-type'], 'audio/mpeg');
  assert.equal(whole.body(), '0123456789');
  const part = await get('/music/media/lamp.mp3', { range: 'bytes=2-5' });
  assert.equal(part.code, 206);
  assert.equal(part.headers['content-range'], 'bytes 2-5/10');
  assert.equal(part.body(), '2345');
  assert.equal((await get('/music/media/..%2Fcatalog.json')).code, 404);
  assert.equal((await get('/music/media/catalog.json')).code, 404);
});

test('catalog.json feed lists track and audio URLs', async () => {
  const j = JSON.parse((await get('/music/catalog.json')).body());
  assert.equal(j.tracks.length, 2);
  assert.match(j.tracks[0].audio, /\/music\/media\/lamp\.mp3$/);
});

test('open-music search soft-fails offline to an empty list', async () => {
  openMusic.__setFetch(async () => { throw new Error('offline'); });
  const r = await get('/music/search?q=organ');
  assert.equal(r.code, 200);
  assert.match(r.body(), /Free &amp; open music/);
});

test('album tracks are grouped under the album name, and the track page names the album', async () => {
  const home = (await get('/music')).body();
  assert.match(home, /<h3>Earths in the Universe<\/h3><ul class=tracks><li>.*gentle-giants/s);
  assert.match((await get('/music/t/gentle-giants')).body(), /From the album <b>Earths in the Universe<\/b>/);
});

test('notes are served for the player, and a song without notes gets none', async () => {
  const t = loadCatalog();
  assert.equal(t.find((x) => x.id === 'lamp-upon-the-water').notes, 'lamp.notes.json');
  assert.equal(t.find((x) => x.id === 'gentle-giants').notes, '');
  const r = await get('/music/notes/lamp.notes.json');
  assert.equal(r.code, 200);
  assert.deepEqual(JSON.parse(r.body()).melody[1], [0.5, 0.5, 64]);
  assert.equal((await get('/music/notes/..%2Fcatalog.json')).code, 404);
});

test('the player shows notes and tablature, never a level meter or waveform', async () => {
  const body = (await get('/music/t/lamp-upon-the-water')).body();
  assert.match(body, /class=sbp-marquee/);          // the scrolling artist — song display
  assert.match(body, /data-v=notes/);
  assert.match(body, /data-v=tab/);
  assert.match(body, /𝄞/);
  assert.doesNotMatch(body, /AnalyserNode|createAnalyser|getByteFrequencyData/);
  assert.match(body, /\/music\/embed\/lamp-upon-the-water/);   // embed snippet
});

test('the embed page is the panel alone', async () => {
  const r = await get('/music/embed/lamp-upon-the-water');
  assert.equal(r.code, 200);
  assert.match(r.body(), /sbp-compact/);
  assert.equal((await get('/music/embed/nope')).code, 404);
});
