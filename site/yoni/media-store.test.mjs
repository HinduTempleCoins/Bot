// site/yoni/media-store.test.mjs — OFFLINE, injected IO and a fake storage config. The properties that
// matter: the size is signed into the URL, nothing is published until commit, and a key cannot be
// smuggled from one surface into another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotFor, commit, remove, listMedia, viewUrlFor, extOf, SURFACES, __setIO, indexPath }
  from './media-store.mjs';

const CFG = {
  endpoint: 'https://drive.example.invalid', bucket: 'b', accessKeyId: 'AK', secretAccessKey: 'SK',
  region: 'garage', configured: true,
};
const P = { path: '/x/media.jsonl', env: {}, config: CFG };

function memIO() {
  const files = new Map();
  __setIO({ read: (p) => files.get(p) || '', append: (p, l) => { files.set(p, (files.get(p) || '') + l); return true; } });
  return files;
}

test('extensions are read off the name, case-insensitively', () => {
  assert.equal(extOf('a.JPG'), 'jpg');
  assert.equal(extOf('x/y/clip.mp4'), 'mp4');
  assert.equal(extOf('noext'), '');
  assert.equal(extOf(null), '');
});

test('a gallery slot signs a PUT with the exact byte count in it', () => {
  memIO();
  const r = slotFor({ handle: 'ryan', surface: 'gallery', filename: 'shot.jpg', bytes: 12345 }, P);
  assert.equal(r.ok, true, r.reason);
  assert.match(r.key, /^yoni\/gallery\/u\/ryan\//);
  assert.match(r.putUrl, /^https:\/\/drive\.example\.invalid\//);
  assert.match(r.putUrl, /X-Amz-Signature=/);
  assert.match(r.putUrl, /X-Amz-Expires=900/);
  assert.equal(r.bytes, 12345);
});

test('each surface takes only its own kinds', () => {
  memIO();
  assert.equal(slotFor({ handle: 'r', surface: 'gallery', filename: 'c.mp4', bytes: 10 }, P).ok, false);
  assert.equal(slotFor({ handle: 'r', surface: 'video', filename: 'c.jpg', bytes: 10 }, P).ok, false);
  assert.equal(slotFor({ handle: 'r', surface: 'video', filename: 'c.mp4', bytes: 10 }, P).ok, true);
  const bad = slotFor({ handle: 'r', surface: 'gallery', filename: 'x.exe', bytes: 10 }, P);
  assert.match(bad.reason, /not exe/);
});

test('a size is required and the cap is per surface', () => {
  memIO();
  assert.match(slotFor({ handle: 'r', surface: 'gallery', filename: 'a.jpg' }, P).reason, /exact file size/);
  assert.match(slotFor({ handle: 'r', surface: 'gallery', filename: 'a.jpg', bytes: 0 }, P).reason, /exact file size/);
  const over = slotFor({ handle: 'r', surface: 'gallery', filename: 'a.jpg', bytes: SURFACES.gallery.maxBytes + 1 }, P);
  assert.equal(over.ok, false);
  assert.match(over.reason, /up to 25MB/);
  // a video of the same size is fine
  assert.equal(slotFor({ handle: 'r', surface: 'video', filename: 'a.mp4', bytes: SURFACES.gallery.maxBytes + 1 }, P).ok, true);
});

test('an unknown surface, a missing handle and unconfigured storage are each refused', () => {
  memIO();
  assert.match(slotFor({ handle: 'r', surface: 'live', filename: 'a.jpg', bytes: 5 }, P).reason, /not an uploadable surface/);
  assert.match(slotFor({ handle: '', surface: 'gallery', filename: 'a.jpg', bytes: 5 }, P).reason, /no producer handle/);
  assert.match(slotFor({ handle: 'r', surface: 'gallery', filename: 'a.jpg', bytes: 5 },
    { ...P, config: { configured: false } }).reason, /not configured/);
});

test('nothing is published until commit — a slot alone shows nothing', () => {
  memIO();
  const s = slotFor({ handle: 'ryan', surface: 'gallery', filename: 'shot.jpg', bytes: 100 }, P);
  assert.equal(listMedia({ surface: 'gallery' }, P).length, 0, 'an uploaded-but-uncommitted object is an orphan');
  assert.equal(commit({ key: s.key, handle: 'ryan', surface: 'gallery', caption: 'a shot', bytes: 100 }, P).ok, true);
  const items = listMedia({ surface: 'gallery' }, P);
  assert.equal(items.length, 1);
  assert.equal(items[0].caption, 'a shot');
  assert.equal(items[0].handle, 'ryan');
});

test('a key cannot be committed to a surface it does not belong to', () => {
  memIO();
  const s = slotFor({ handle: 'ryan', surface: 'gallery', filename: 'shot.jpg', bytes: 100 }, P);
  const r = commit({ key: s.key, handle: 'ryan', surface: 'video', bytes: 100 }, P);
  assert.equal(r.ok, false);
  assert.match(r.reason, /does not belong to this surface/);
  // and a hand-written key from outside our prefix is refused
  assert.equal(commit({ key: '../../etc/passwd', handle: 'ryan', surface: 'gallery' }, P).ok, false);
  assert.equal(commit({ key: 'yoni/gallery/ok.jpg', handle: '', surface: 'gallery' }, P).ok, false);
});

test('removal takes it off the surface immediately and a re-add works', () => {
  memIO();
  const s = slotFor({ handle: 'r', surface: 'gallery', filename: 'a.jpg', bytes: 10 }, P);
  commit({ key: s.key, handle: 'r', surface: 'gallery', bytes: 10 }, P);
  assert.equal(listMedia({ surface: 'gallery' }, P).length, 1);
  assert.equal(remove(s.key, P).ok, true);
  assert.equal(listMedia({ surface: 'gallery' }, P).length, 0);
  commit({ key: s.key, handle: 'r', surface: 'gallery', bytes: 10 }, P);
  assert.equal(listMedia({ surface: 'gallery' }, P).length, 1);
});

test('listing is newest first and filters by surface', () => {
  memIO();
  let t = 1000;
  const o = { ...P, now: () => t };
  const g = slotFor({ handle: 'r', surface: 'gallery', filename: 'a.jpg', bytes: 10 }, o);
  commit({ key: g.key, handle: 'r', surface: 'gallery', bytes: 10 }, o);
  t = 2000;
  const v = slotFor({ handle: 'r', surface: 'video', filename: 'b.mp4', bytes: 10 }, o);
  commit({ key: v.key, handle: 'r', surface: 'video', bytes: 10 }, o);
  assert.equal(listMedia({}, o).length, 2);
  assert.equal(listMedia({}, o)[0].surface, 'video', 'newest first');
  assert.equal(listMedia({ surface: 'gallery' }, o).length, 1);
  assert.equal(listMedia({ surface: 'gallery' }, o)[0].surface, 'gallery');
});

test('the index holds no viewer data and no uploader identity beyond the handle', () => {
  const files = memIO();
  const s = slotFor({ handle: 'ryan', surface: 'gallery', filename: 'a.jpg', bytes: 10 }, P);
  commit({ key: s.key, handle: 'ryan', surface: 'gallery', caption: 'c', bytes: 10 }, P);
  for (const line of files.get('/x/media.jsonl').trim().split('\n')) {
    for (const k of Object.keys(JSON.parse(line))) {
      assert.ok(['op', 'key', 'surface', 'handle', 'caption', 'bytes', 'at'].includes(k), `unexpected field: ${k}`);
    }
  }
});

test('a view URL is short-lived, and empty when storage is unconfigured', () => {
  const u = viewUrlFor('yoni/gallery/a.jpg', P);
  assert.match(u, /X-Amz-Signature=/);
  assert.match(u, /X-Amz-Expires=600/);
  assert.equal(viewUrlFor('k', { config: { configured: false } }), '');
});

test('a torn line does not break the listing', () => {
  const files = memIO();
  const s = slotFor({ handle: 'r', surface: 'gallery', filename: 'a.jpg', bytes: 10 }, P);
  commit({ key: s.key, handle: 'r', surface: 'gallery', bytes: 10 }, P);
  files.set('/x/media.jsonl', `${files.get('/x/media.jsonl')}{broken\n`);
  assert.equal(listMedia({ surface: 'gallery' }, P).length, 1);
});

test('the index path comes from the environment', () => {
  assert.match(indexPath({}), /media\.jsonl$/);
  assert.equal(indexPath({ YONI_MEDIA_FILE: '/e/m.jsonl' }), '/e/m.jsonl');
});
