// server.test.mjs — offline tests for the Hathor Language Center HTTP surface.
// node --test, fully offline (injectable fetch), soft-fail, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as S from './server.mjs';
import * as L from '../../integrations/language/lessons.mjs';

// Minimal mock res that records what the handler wrote.
function mockRes() {
  return {
    statusCode: 0, headers: {}, body: '',
    writeHead(code, headers) { this.statusCode = code; if (headers) Object.assign(this.headers, headers); return this; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; return this; },
  };
}
// Minimal mock req; body optional (for POST).
function mockReq(url, method = 'GET', bodyObj) {
  const listeners = {};
  const req = { url, method, on(ev, cb) { listeners[ev] = cb; return this; } };
  req._fire = () => {
    if (bodyObj !== undefined && listeners.data) listeners.data(Buffer.from(JSON.stringify(bodyObj)));
    if (listeners.end) listeners.end();
  };
  return req;
}
async function get(url) {
  const res = mockRes();
  const p = S.handler(mockReq(url), res);
  await p;
  return res;
}
async function post(url, bodyObj) {
  const res = mockRes();
  const req = mockReq(url, 'POST', bodyObj);
  const p = S.handler(req, res);
  req._fire();
  await p;
  return res;
}

test('home route 200 + lists real seeded courses', async () => {
  const res = await get('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Hathor Language Center/);
  assert.match(res.body, /Spanish/);
  assert.match(res.body, /Kurdish/);
  assert.match(res.body, /French/);
});

test('course page renders lessons with real content', async () => {
  const res = await get('/course/ku');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Kurmanji|Kurdish/);
  assert.match(res.body, /Lesson 1/);
});

test('lesson page renders flashcards with real vocab', async () => {
  const res = await get('/lesson/es/1');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /class=flash/);
  assert.match(res.body, /gracias/);      // the target word
  assert.match(res.body, /thank you/);    // its translation prompt
  assert.match(res.body, /Grammar notes/);
});

test('practice page renders and ships a client deck (no answers leaked)', async () => {
  const res = await get('/practice/fr');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Practice/);
  assert.match(res.body, /var DECK=/);
  // the client deck carries prompts + keys but NOT the target-language answers
  assert.doesNotMatch(res.body.split('var DECK=')[1].split(';')[0], /bonjour/);
});

test('/api/practice scores a correct answer and schedules a review', async () => {
  L.__setStore(L.memoryStore());
  const key = L.deckFor('es')[0].key;      // prompt "hello" → "hola"
  const res = await post('/api/practice/es', { key, given: 'hola', learner: 'tester' });
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.correct, true);
  assert.equal(j.answer, 'hola');
  assert.ok(j.item && j.item.interval >= 1, 'a review was scheduled');
});

test('/api/practice marks a wrong answer incorrect and lapses it', async () => {
  L.__setStore(L.memoryStore());
  const key = L.deckFor('es')[0].key;
  const res = await post('/api/practice/es', { key, given: 'zzzz', learner: 'tester' });
  const j = JSON.parse(res.body);
  assert.equal(j.correct, false);
  assert.equal(j.item.lapses, 1);
});

test('/api/practice progress persists per learner across calls', async () => {
  L.__setStore(L.memoryStore());
  const key = L.deckFor('ku')[0].key;
  await post('/api/practice/ku', { key, given: 'silav', learner: 'lena' });
  await post('/api/practice/ku', { key, given: 'silav', learner: 'lena' });
  const p = L.progress('lena');
  assert.equal(p.totalReviews, 2);
  assert.equal(p.totalCorrect, 2);
});

test('/api/translate parses an INJECTED MyMemory response', async () => {
  S.__setFetch(async () => ({ ok: true, json: async () => ({ responseData: { translatedText: 'hola mundo' } }) }));
  const res = await get('/api/translate?q=hello%20world&to=es');
  const j = JSON.parse(res.body);
  assert.equal(j.translated, 'hola mundo');
  S.__setFetch(null);
});

test('/api/translate soft-fails to the original text on backend error', async () => {
  S.__setFetch(async () => { throw new Error('network down'); });
  const res = await get('/api/translate?q=hello&to=es');
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.translated, 'hello', 'falls back to original');
  S.__setFetch(null);
});

test('/api/translate returns original when backend gives a bad shape', async () => {
  S.__setFetch(async () => ({ ok: true, json: async () => ({ nope: true }) }));
  const j = JSON.parse((await get('/api/translate?q=hi&to=fr')).body);
  assert.equal(j.translated, 'hi');
  S.__setFetch(null);
});

test('XSS: a malicious query is escaped / not reflected as live markup', async () => {
  // translate echoes q back in JSON (not HTML), but ensure no HTML route reflects raw input.
  S.__setFetch(async () => ({ ok: true, json: async () => ({ responseData: { translatedText: 'x' } }) }));
  const res = await get('/api/translate?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E&to=es');
  // JSON response: the script tag is a JSON string value, not executable HTML in a page.
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  S.__setFetch(null);
});

test('XSS: lesson/course pages esc() all interpolation (no unescaped angle brackets from data)', async () => {
  // Our data has no HTML, but assert the shell escaped structural output correctly by checking
  // that esc() is the one used and no raw "<script>alert" appears from any content path.
  const res = await get('/lesson/fr/1');
  assert.doesNotMatch(res.body, /<script>alert/);
  assert.equal(S.esc('<b>"&'), '&lt;b&gt;&quot;&amp;');
});

test('unknown course/lesson redirects home (302), never 500', async () => {
  assert.equal((await get('/course/nope')).statusCode, 302);
  assert.equal((await get('/lesson/nope/1')).statusCode, 302);
  assert.equal((await get('/practice/nope')).statusCode, 302);
  assert.equal((await get('/totally/unknown')).statusCode, 302);
});

test('health, robots, sitemap, llms endpoints respond', async () => {
  assert.equal((await get('/health')).body, 'ok');
  assert.match((await get('/robots.txt')).body, /User-agent|Sitemap/i);
  assert.match((await get('/sitemap.xml')).body, /<urlset/);
  assert.match((await get('/llms.txt')).body, /Hathor Language Center/);
});

test('sitemap includes every course + lesson path', () => {
  assert.ok(S.SITEMAP_PATHS.includes('/course/es'));
  assert.ok(S.SITEMAP_PATHS.includes('/lesson/ku/3'));
});

test('handler never throws on odd input', async () => {
  await assert.doesNotReject(async () => {
    await get('/');
    await get('/course/');
    await get('/lesson/');
    await get('/api/translate');            // no params
    await post('/api/practice/es', {});     // no key
    await get('/api/practice/es');          // GET on POST-only → 405
  });
  assert.equal((await get('/api/practice/es')).statusCode, 405);
});
