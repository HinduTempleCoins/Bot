import test from 'node:test';
import assert from 'node:assert/strict';
import { handler, esc, SHELVES } from './server.mjs';
import * as books from '../../integrations/soapbox/books-open.mjs';

// Fully offline: every upstream call goes through books-open's injectable fetch.
function stubFetch(payloadFor) {
  books.__setFetch(async (url) => {
    const u = String(url);
    const body = payloadFor(u);
    return {
      ok: body !== null,
      status: body === null ? 500 : 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

const GUTENDEX = {
  results: [
    { id: 74, title: 'The Adventures of Tom Sawyer', authors: [{ name: 'Twain, Mark' }], copyright: false,
      formats: { 'text/html': 'https://www.gutenberg.org/ebooks/74.html.images',
                 'application/epub+zip': 'https://www.gutenberg.org/ebooks/74.epub3.images',
                 'text/plain; charset=us-ascii': 'https://www.gutenberg.org/files/74/74-0.txt' } },
    { id: 999, title: 'Still In Copyright', authors: [{ name: 'Someone' }], copyright: true, formats: {} },
  ],
};

function payload(u) {
  if (u.includes('gutendex')) return GUTENDEX;
  if (u.includes('openlibrary')) return { docs: [] };
  if (u.includes('archive.org')) return { response: { docs: [] } };
  return null;
}

// Minimal res double.
function mockRes() {
  return {
    code: 0, headers: {}, body: '',
    writeHead(c, h) { this.code = c; this.headers = h || {}; },
    end(b) { this.body = b == null ? '' : String(b); },
  };
}
const get = async (path) => { const res = mockRes(); await handler({ url: path, method: 'GET' }, res); return res; };

test.beforeEach(() => stubFetch(payload));
test.after(() => books.__setFetch(null));

test('health, robots, sitemap and llms.txt all answer', async () => {
  assert.equal((await get('/health')).body, 'ok');
  assert.equal((await get('/robots.txt')).code, 200);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /<urlset/);
  assert.equal((await get('/sitemap-index.xml')).code, 200);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /public-domain/i);
});

test('the landing page renders without a query and offers shelves', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /The SoapBox Library/);
  for (const s of SHELVES.slice(0, 3)) assert.ok(res.body.includes(esc(s)), `missing shelf ${s}`);
  // No search yet, so no result list is rendered (the class appears in CSS, so match the element).
  assert.equal(/<ul class="books-list">/.test(res.body), false);
});

test('a search renders results and labels their posture', async () => {
  const res = await get('/?q=twain');
  assert.equal(res.code, 200);
  assert.match(res.body, /Tom Sawyer/);
  assert.match(res.body, /posture-host/);
  assert.match(res.body, /Public Domain/);
});

test('a still-in-copyright record is dropped, never served', async () => {
  const res = await get('/?q=twain');
  assert.equal(/Still In Copyright/.test(res.body), false);
});

test('public-domain results expose epub and text downloads', async () => {
  const res = await get('/?q=twain');
  assert.match(res.body, /epub/);
  assert.match(res.body, /74-0\.txt/);
});

test('the api returns json with the provenance note', async () => {
  const res = await get('/api/search?q=twain');
  assert.equal(res.code, 200);
  const d = JSON.parse(res.body);
  assert.equal(d.query, 'twain');
  assert.ok(d.count >= 1);
  assert.match(d.note, /public-domain first/i);
  assert.equal(d.books[0].license, 'Public Domain');
  assert.equal(d.books[0].posture, 'host');
});

test('an empty api query returns an empty shelf rather than erroring', async () => {
  const d = JSON.parse((await get('/api/search')).body);
  assert.equal(d.count, 0);
  assert.deepEqual(d.books, []);
});

test('a dead upstream is an empty shelf, not a broken page', async () => {
  stubFetch(() => null);                       // every source fails
  const res = await get('/?q=anything');
  assert.equal(res.code, 200);
  assert.match(res.body, /No books found|books-empty/);
});

test('the query is escaped back into the page', async () => {
  const res = await get('/?q=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.code, 200);
  assert.equal(/<script>alert\(1\)<\/script>/.test(res.body), false);
  assert.match(res.body, /&lt;script&gt;/);
});

test('an unknown path redirects home', async () => {
  const res = await get('/nope');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('esc escapes every dangerous character', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
