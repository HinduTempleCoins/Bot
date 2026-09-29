// horror-pages.test.mjs — A Map of Horror + Girl Has to Kill Everyone pages. Offline. node --test site/stream/horror-pages.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as M from '../../integrations/soapbox/horror-map.mjs';
import { mapBody, girlBody, horrorMapRoute, HORROR_MAP_PATHS, serveStill } from './horror-pages.mjs';

function res() { return { code: 0, body: '', headers: {}, writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = String(b == null ? '' : b); } }; }
const ctx = { shell: (t, inner) => `<title>${t}</title>${inner}`, send: (r, html, code = 200) => { r.writeHead(code); r.end(html); }, base: 'https://s' };

test('the map carries every shelf, the borders, national cinemas and the proposal, titles linked to Films', () => {
  const h = mapBody();
  for (const s of M.SHELVES) assert.ok(h.includes(`/horror/shelf/${s.id}`), s.id);
  assert.match(h, /The argument/);
  assert.match(h, /Nerve keeps its motorcycle/);
  assert.match(h, /href="\/films\?q=Martyrs%202008"/);
  assert.match(h, /Hush\.\.\. Hush, Sweet Charlotte|Hush&#39;|Hush\.\.\./);
  assert.ok(M.countTitles() > 500, `only ${M.countTitles()} titles`);
  assert.doesNotMatch(h, /<i>[^<]*<script/i);
});

test('Girl Has to Kill Everyone: trafficking/captivity is the heart; siege fits but slower; The Liability and Taken are near, not in', () => {
  const h = girlBody();
  assert.match(h, /heart of the genre is trafficking and captivity/);
  assert.match(h, /Siege <span class=badge>fits · not primary · slower<\/span>/);
  assert.match(h, /Near the genre, but not in it[\s\S]*The Liability[\s\S]*Taken/);
  assert.match(h, /The Eyes of My Mother/);
  assert.match(h, /You&#39;re Next/); // escaped apostrophe
});

test('routes: map, genre page, every shelf, 404 for an unknown shelf; sitemap paths all resolve', () => {
  for (const p of HORROR_MAP_PATHS().filter((x) => x !== '/horror/stills')) {
    const r = res();
    assert.equal(horrorMapRoute(p, r, ctx), true, p);
    assert.equal(r.code, 200, p);
  }
  const r = res();
  assert.equal(horrorMapRoute('/horror/shelf/nope', r, ctx), true);
  assert.equal(r.code, 404);
  assert.equal(horrorMapRoute('/horror/supernatural', res(), ctx), false); // left to the taxonomy routes
});

test('stills are served only by safe names from the stills dir', () => {
  const d = mkdtempSync(join(tmpdir(), 'stills-'));
  writeFileSync(join(d, 'vampire_crypt.jpg'), 'JPG');
  let r = res(); serveStill(r, 'vampire_crypt.jpg', d); assert.equal(r.code, 200);
  for (const bad of ['../etc/passwd', 'stills.json', 'a/b.jpg', '..%2Fx.jpg']) { r = res(); serveStill(r, bad, d); assert.equal(r.code, 404, bad); }
});
