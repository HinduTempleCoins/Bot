import { test } from 'node:test';
import assert from 'node:assert';
import { handler, loadPins, addPin, __setIO, __setData, __setPostReader } from './server.mjs';
import { makePin } from '../../integrations/melek-pinboard.mjs';

let FILE = {};
__setIO({ read: (p) => FILE[p] || null, write: (p, s) => { FILE[p] = s; } });
__setData('pins.json');
const reset = () => { FILE = {}; };

function cap() {
  const o = { code: 0, body: '', headers: {} };
  return { res: { writeHead: (c, h) => { o.code = c; o.headers = h || {}; }, end: (b) => { o.body = String(b || ''); } }, o };
}
async function get(url, method = 'GET', body = '') {
  const { res, o } = cap();
  const handlers = {};
  const req = { url, method, headers: {}, on: (e, fn) => { handlers[e] = fn; return req; }, destroy: () => {} };
  const p = handler(req, res);
  if (handlers.data && body) handlers.data(body);
  if (handlers.end) handlers.end();
  await p;
  return o;
}

const IMG = 'https://hathor.soapbox.community/img/a1.png';

test('the wall is a grid, and an empty board says so', async () => {
  reset();
  const o = await get('/');
  assert.equal(o.code, 200);
  assert.match(o.body, /The picture side of MELEK/);
  assert.match(o.body, /Nothing pinned yet/);
  assert.match(o.body, /<b>Alpha\. A MELEK front end\.<\/b>/);
  assert.match(o.body, /small record — not a blog post/);
});

test('pinning a picture stores it and the wall shows a thumbnail', async () => {
  reset();
  const o = await get('/pin', 'POST', `url=${encodeURIComponent(IMG)}&title=The+lyre&author=ryan`);
  assert.equal(o.code, 302);
  assert.match(o.headers.location, /^\/p\//);
  assert.equal(loadPins().length, 1);
  const wall = await get('/');
  assert.match(wall.body, /class=pb-grid/);
  assert.match(wall.body, /img src="https:\/\/hathor\.soapbox\.community\/img\/a1\.png"/);
});

test('a saved picture from any website keeps the page it came from', async () => {
  reset();
  const o = await get(`/save?url=${encodeURIComponent(IMG)}&source=${encodeURIComponent('https://example.org/story')}&title=Found`);
  assert.equal(o.code, 200);
  const p = loadPins()[0];
  assert.equal(p.kind, 'saved');
  assert.equal(p.sourceUrl, 'https://example.org/story');
  assert.match(o.body, /example\.org/);
});

test('a MELEK blog post\'s pictures all become pins that link back to it', async () => {
  reset();
  __setPostReader(async (author, permlink) => ({ author, permlink, title: 'The Lyre of Ur', body: `![a](${IMG}) ![b](https://example.org/b.jpg)`, url: `https://melek.salon/@${author}/${permlink}` }));
  const o = await get('/save?post=@ryan/the-lyre-of-ur&as=friend');
  assert.equal(o.code, 200);
  assert.match(o.body, /Saved 2 pictures/);
  const pins = loadPins();
  assert.equal(pins.length, 2);
  assert.equal(pins[0].sourceUrl, 'https://melek.salon/@ryan/the-lyre-of-ur');
  assert.equal(pins[0].sourceAuthor, 'ryan');
  assert.equal(pins[0].author, 'friend');
});

test('pasting a post address on the wall sends you to the post saver', async () => {
  reset();
  const o = await get('/pin', 'POST', 'url=%40ryan%2Fthe-lyre-of-ur&author=friend');
  assert.equal(o.code, 302);
  assert.match(o.headers.location, /\/save\?post=@ryan\/the-lyre-of-ur/);
});

test('a pin page gives the markdown to put it back in a blog post', async () => {
  reset();
  const pin = makePin({ author: 'ryan', title: 'The lyre', images: [IMG] });
  addPin(pin);
  const o = await get(`/p/${encodeURIComponent(pin.id)}`);
  assert.equal(o.code, 200);
  assert.match(o.body, /Put it in a MELEK blog post/);
  assert.match(o.body, /!\[The lyre\]/);
  assert.equal((await get('/p/nope')).code, 404);
});

test('junk is refused and never stored', async () => {
  reset();
  assert.equal((await get('/save?url=javascript:alert(1)')).code, 400);
  assert.equal((await get('/pin', 'POST', 'url=https%3A%2F%2Fexample.org%2Fnot-an-image')).code, 400);
  assert.equal(loadPins().length, 0);
});

test('boards list what has been filed, and the feed is readable as JSON', async () => {
  reset();
  addPin(makePin({ author: 'ryan', images: [IMG], board: 'Old Instruments' }));
  const b = await get('/boards');
  assert.match(b.body, /old-instruments/);
  assert.match((await get('/b/old-instruments')).body, /class=pb-grid/);
  const feed = JSON.parse((await get('/pins.json')).body);
  assert.equal(feed.pins.length, 1);
});

test('the bookmarklet is offered and points back here', async () => {
  const o = await get('/how');
  assert.equal(o.code, 200);
  assert.match(o.body, /Save to MELEK/);
  assert.match(o.body, /javascript:/);          // it is a bookmarklet by nature
  assert.match(o.body, /\/save\?url=/);
});

test('the post reader talks standard Graphene and soft-fails when the chain is unreachable', async () => {
  reset();
  const { __setFetch } = await import('./server.mjs');
  let sent = null;
  __setFetch(async (url, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ result: { author: 'ryan', permlink: 'p1', title: 'T', body: `![a](${IMG})` } }) }; });
  __setPostReader(null);                                   // back to the real reader
  const o = await get('/save?post=@ryan/p1');
  assert.equal(sent.method, 'condenser_api.get_content');
  assert.deepEqual(sent.params, ['ryan', 'p1']);
  assert.equal(o.code, 200);
  assert.equal(loadPins().length, 1);
  __setFetch(async () => { throw new Error('offline'); });
  assert.equal((await get('/save?post=@ryan/p2')).code, 404);
});

test('the tabs are there: wall, albums, saved, upload, make a post', async () => {
  reset();
  const o = await get('/');
  for (const t of ['/boards', '/saved', '/upload', '/post']) assert.match(o.body, new RegExp(`href="${t}"`));
});

test('a pin can be filed into an album, and the album page shows it', async () => {
  reset();
  const pin = makePin({ author: 'ryan', images: [IMG], title: 'A lyre' });
  addPin(pin);
  const o = await get('/board', 'POST', `pin=${encodeURIComponent(pin.id)}&board=Old Instruments`);
  assert.equal(o.code, 302);
  assert.equal(o.headers.location, '/b/old-instruments');
  assert.equal(loadPins()[0].board, 'old-instruments');
  assert.match((await get('/b/old-instruments')).body, /class=pb-grid/);
  assert.match((await get('/boards')).body, /old-instruments/);
  assert.equal((await get('/board', 'POST', 'pin=nope&board=x')).code, 404);
});

test('Saved is a private bookmarks page — nothing is posted anywhere', async () => {
  const o = await get('/saved');
  assert.equal(o.code, 200);
  assert.match(o.body, /bookmarks page/);
  assert.match(o.body, /nothing here is posted anywhere/);
});

test('Make a post is deliberate, never automatic', async () => {
  reset();
  addPin(makePin({ author: 'ryan', images: [IMG], title: 'A lyre' }));
  const o = await get('/post');
  assert.match(o.body, /Nothing on the Pinboard is posted anywhere on its own/);
  assert.match(o.body, /id=pick/);
});

test('Upload explains why the chain holds the record and not the picture', async () => {
  const o = await get('/upload');
  assert.match(o.body, /never the picture itself/);
  assert.match(o.body, /imgbb/);
});
