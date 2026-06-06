// server.test.mjs — OFFLINE tests for the Hierophant site. Fully offline: the only outbound dependency
// (the "Ask the Hierophant" RAG) is behind the __setAsk() seam, so we inject a canned ask and the
// network is never touched. We drive the exported handler through a mock req/res (no port bound) and
// also exercise the view functions directly. We assert: every route serves (2xx/302), missing ids 404
// to an honest page, HTML is escaped against injected nasties, the text page carries its links-out +
// entities + companions, the entity page lists its texts, /ask soft-fails AND renders an injected
// grounded answer, and health/robots/sitemap respond.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  handler, __setAsk, esc,
  homePage, textsIndexView, textDetailView, godsIndexView, entityDetailView, traditionView, askView,
} from './server.mjs';

// ── mock req/res ──────────────────────────────────────────────────────────────────────────────────
function mockRes() {
  return {
    statusCode: null, headers: null, body: '', ended: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += String(chunk); this.ended = true; },
  };
}
// GET req — `on` is a no-op (no body)
function getReq(urlPath) { return { url: urlPath, method: 'GET', on() {} }; }
// POST req — replays a urlencoded body to the data/end listeners
function postReq(urlPath, q) {
  const body = `q=${encodeURIComponent(q)}`;
  return {
    url: urlPath, method: 'POST',
    on(ev, cb) {
      if (ev === 'data') cb(Buffer.from(body));
      if (ev === 'end') cb();
    },
  };
}
async function drive(req) { const res = mockRes(); await handler(req, res); return res; }

afterEach(() => { __setAsk(null); });

// ── routes serve ──────────────────────────────────────────────────────────────────────────────────
test('home serves 200 with the three pillars and the traditions grid', async () => {
  const res = await drive(getReq('/'));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /The Hierophant/);
  assert.ok(res.body.includes('href="/texts"'));
  assert.ok(res.body.includes('href="/gods"'));
  assert.ok(res.body.includes('href="/ask"'));
  assert.ok(res.body.includes('href="/traditions/egyptian"'));
});

test('/texts index serves 200 and lists texts grouped by tradition', async () => {
  const res = await drive(getReq('/texts'));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /The Texts/);
  assert.ok(res.body.includes('href="/texts/iliad"'));
  assert.ok(res.body.includes('href="/texts/book-of-the-dead"'));
});

test('a text detail page carries links-out + the gods in it + the companion path', async () => {
  const res = await drive(getReq('/texts/orphic-hymns'));
  assert.equal(res.statusCode, 200);
  // links out to a source
  assert.match(res.body, /sacred-texts\.com/);
  // gods & things block links to our entity pages
  assert.ok(res.body.includes('href="/gods/dionysos"'), 'links Dionysos entity');
  // companion reading path links to companion texts
  assert.ok(res.body.includes('href="/texts/theogony"'), 'links Theogony companion');
  assert.match(res.body, /Companion reading path/);
  assert.match(res.body, /Read &amp; download/);
});

test('a verified text shows a real download link; sections all render', async () => {
  const res = await drive(getReq('/texts/iliad'));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /gutenberg\.org\/ebooks\/2199/);
  assert.ok(res.body.includes('href="/gods/zeus"'));
});

test('unknown text id 404s to an honest page (noindex)', async () => {
  const res = await drive(getReq('/texts/not-a-real-text'));
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /Text not found/);
  assert.match(res.body, /noindex/);
});

test('/gods index serves 200 with tradition + type filters', async () => {
  const res = await drive(getReq('/gods'));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Gods &amp; Things/);
  assert.ok(res.body.includes('href="/gods/zeus"'));
  // filtered view
  const filtered = await drive(getReq('/gods?tradition=greek'));
  assert.equal(filtered.statusCode, 200);
  assert.ok(filtered.body.includes('href="/gods/zeus"'));
  assert.ok(!filtered.body.includes('href="/gods/odin"'), 'Norse Odin filtered out of Greek view');
});

test('an entity page lists its texts, relationships, and external links', async () => {
  const res = await drive(getReq('/gods/osiris'));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Osiris/);
  assert.ok(res.body.includes('href="/texts/book-of-the-dead"'), 'lists a text it appears in');
  assert.ok(res.body.includes('href="/gods/isis"'), 'links a related figure');
  assert.match(res.body, /en\.wikipedia\.org/);
});

test('a Greek entity page carries a Theoi link', async () => {
  const res = await drive(getReq('/gods/zeus'));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /theoi\.com/);
});

test('unknown entity id 404s honestly', async () => {
  const res = await drive(getReq('/gods/not-a-real-god'));
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /Figure not found/);
});

test('a tradition page serves 200 with its texts and figures', async () => {
  const res = await drive(getReq('/traditions/egyptian'));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Egyptian/);
  assert.ok(res.body.includes('href="/texts/book-of-the-dead"'));
  assert.ok(res.body.includes('href="/gods/hathor"'));
});

test('unknown tradition 404s', async () => {
  const res = await drive(getReq('/traditions/klingon'));
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /Tradition not found/);
});

// ── /ask ────────────────────────────────────────────────────────────────────────────────────────
test('/ask GET with no question renders the form, index,follow', async () => {
  const res = await drive(getReq('/ask'));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Ask the Hierophant/);
  assert.match(res.body, /method=post/);
  assert.match(res.body, /index,follow/);
});

test('/ask renders an injected grounded answer with its sources (corpus-labeled)', async () => {
  __setAsk(async (qn) => ({
    answer: `On that: ${qn} — per the corpus.`,
    sources: [{ title: 'The Convergence', url: 'https://wiki.soapbox.community/wiki/the-convergence' }],
    grounded: true,
  }));
  const res = await drive(postReq('/ask', 'What is the Convergence?'));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /The Hierophant answers/);
  assert.match(res.body, /per the corpus/);
  assert.match(res.body, /Temple's corpus/);
  assert.ok(res.body.includes('the-convergence'), 'shows the source link');
  assert.match(res.body, /noindex,follow/, 'answered ask page is noindex');
});

test('/ask soft-fails to an honest empty state when the corpus has nothing', async () => {
  __setAsk(async () => ({ answer: "The Temple's corpus doesn't cover that.", sources: [], grounded: false }));
  const res = await drive(postReq('/ask', 'price of dogecoin'));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /doesn&#39;t cover that|doesn't cover that/);
});

test('/ask never throws even if the RAG seam blows up', async () => {
  __setAsk(async () => { throw new Error('llm down'); });
  const res = await drive(postReq('/ask', 'anything'));
  // askCorpus catches → grounded:false honest state, page still 200
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Ask the Hierophant/);
});

// ── escaping ──────────────────────────────────────────────────────────────────────────────────────
test('esc() neutralizes HTML metacharacters', () => {
  assert.equal(esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
});

test('injected nasties are escaped on the /ask answer (no raw script)', async () => {
  const nasty = '<script>alert(1)</script>';
  __setAsk(async () => ({ answer: `echo ${nasty}`, sources: [{ title: nasty, url: 'https://x/' + nasty }], grounded: true }));
  const res = await drive(postReq('/ask', nasty));
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw script never reaches the page');
  assert.match(res.body, /&lt;script&gt;/, 'the nasty is escaped');
});

test('a bad text-id with HTML is escaped on the 404 page', async () => {
  const res = await drive(getReq('/texts/' + encodeURIComponent('<img src=x onerror=alert(1)>')));
  assert.equal(res.statusCode, 404);
  assert.ok(!res.body.includes('<img src=x onerror=alert(1)>'), 'raw injection never rendered');
  assert.match(res.body, /&lt;img/);
});

// ── infra routes ──────────────────────────────────────────────────────────────────────────────────
test('/health returns ok:true JSON with catalog/entity counts', async () => {
  const res = await drive(getReq('/health'));
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.ok(j.texts >= 35);
  assert.ok(j.entities >= 60);
  assert.deepEqual(j.catalogErrors, []);
  assert.deepEqual(j.entityErrors, []);
});

test('robots.txt, sitemap.xml, sitemap-index.xml, llms.txt all serve 200', async () => {
  for (const p of ['/robots.txt', '/sitemap.xml', '/sitemap-index.xml', '/llms.txt']) {
    const res = await drive(getReq(p));
    assert.equal(res.statusCode, 200, `${p} serves 200`);
    assert.ok(res.body.length > 10, `${p} has a body`);
  }
});

test('sitemap.xml includes text + entity + tradition urls', async () => {
  const res = await drive(getReq('/sitemap.xml'));
  assert.match(res.body, /\/texts\/iliad/);
  assert.match(res.body, /\/gods\/zeus/);
  assert.match(res.body, /\/traditions\/egyptian/);
});

test('unknown path redirects home (302)', async () => {
  const res = await drive(getReq('/no-such-page'));
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

// ── direct view smoke (no handler) ──────────────────────────────────────────────────────────────
test('view functions render strings directly', () => {
  assert.match(homePage(), /Hierophant/);
  assert.match(textsIndexView(), /The Texts/);
  assert.match(textDetailView('gilgamesh'), /Gilgamesh/);
  assert.match(godsIndexView('', ''), /Gods/);
  assert.match(entityDetailView('thor'), /Thor/);
  assert.match(traditionView('norse'), /Norse/);
});

test('askView resolves to a string and soft-fails with no question', async () => {
  const html = await askView('');
  assert.match(html, /Ask the Hierophant/);
});
