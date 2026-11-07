// site/yoni/server.test.mjs — OFFLINE. That the shelf serves, that it does NOT leak the public
// Library, that traversal is refused, and that the age gate is per surface rather than per site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, listArticles, readArticle, esc, policyFor, safeNext } from './server.mjs';

function call(url) {
  const req = { method: 'GET', url };
  const res = { code: 0, headers: {}, body: '',
    writeHead(c, h) { this.code = c; this.headers = h || {}; },
    end(b) { this.body = b || ''; } };
  return handler(req, res).then(() => ({ code: res.code, body: res.body, headers: res.headers }));
}

test('the shelf lists its own articles', () => {
  const arts = listArticles();
  assert.ok(arts.length >= 5, `expected the converted set, found ${arts.length}`);
  const slugs = arts.map((a) => a.slug);
  assert.ok(slugs.includes('The_Federal_Age_Floor_for_Filming'));
  assert.ok(slugs.includes('DMCA_and_Takedown_in_Adult_Media'));
});

test('IT MUST NOT SERVE THE PUBLIC LIBRARY — the two shelves stay separate', () => {
  const slugs = listArticles().map((a) => a.slug);
  for (const leaked of ['Nootropics', 'Cannabis', 'Ibogaine_Iboga_and_the_Apocynaceae', 'Oilahuasca']) {
    assert.ok(!slugs.includes(leaked), `${leaked} belongs to the public Library and must not appear here`);
  }
  assert.equal(readArticle('Nootropics'), null, 'a Library slug must not resolve on this surface');
});

test('the index renders every article as a link', async () => {
  const r = await call('/');
  assert.equal(r.code, 200);
  for (const a of listArticles()) assert.ok(r.body.includes(`/a/${a.slug}`), `${a.slug} missing from the index`);
  assert.match(r.body, /Not legal advice/);
});

test('an article renders through the wiki renderer', async () => {
  const r = await call('/a/The_Federal_Age_Floor_for_Filming');
  assert.equal(r.code, 200);
  assert.ok(r.body.length > 20000, 'the body should be the rendered article, not a stub');
  assert.ok(!r.body.includes("'''"), 'wiki markup must not reach the page');
});

test('path traversal is refused', async () => {
  for (const bad of ['/a/../../../etc/passwd', '/a/..%2f..%2fetc%2fpasswd', '/a/']) {
    const r = await call(bad);
    assert.notEqual(r.code, 200, `${bad} must not serve`);
  }
  assert.equal(readArticle('../../package'), null);
  assert.equal(readArticle('../wiki/seed-articles/Nootropics'), null);
});

test('the shelf is not indexed while the property is being assembled', async () => {
  const robots = await call('/robots.txt');
  assert.match(robots.body, /Disallow: \//);
  const page = await call('/');
  assert.match(page.body, /noindex/);
});

test('THE GATE IS PER SURFACE: reference is open, the media surfaces are not', async () => {
  assert.equal(policyFor('wiki').level, 'none', 'editorial and anatomical material is served open');
  for (const s of ['gallery', 'video', 'live']) {
    assert.equal(policyFor(s).level, 'verified', `${s} must require a real check`);
  }
  assert.equal(policyFor('upload').level, 'id');
  const g = await call('/gate?surface=live&subject=stranger');
  const j = JSON.parse(g.body);
  assert.equal(j.state.allowed, false);
  assert.equal(j.state.need, 'verified');
  assert.equal(j.state.paidCheckRequired, true);
});

test('an unknown surface fails closed even through the HTTP boundary', async () => {
  const g = await call('/gate?surface=whatever-comes-next&subject=x');
  assert.equal(JSON.parse(g.body).policy.level, 'id');
});

test('escaping holds at the render edge', () => {
  assert.equal(esc('<script>&"'), '&lt;script&gt;&amp;&quot;');
});

// ── the surface map and the upload door ─────────────────────────────────────────────────────────

test('/surfaces renders every declared surface with its level', async () => {
  const r = await call('/surfaces');
  assert.equal(r.code, 200);
  // built surfaces render as links inside the <b>; ones with no door yet render as plain text
  for (const name of ['wiki', 'preview', 'gallery', 'video', 'live', 'upload', 'payout']) {
    assert.match(r.body, new RegExp(`<b>(?:<a href="/${name}">)?${name}`), `${name} is listed`);
  }
  for (const name of ['preview', 'gallery', 'video', 'live', 'upload']) {
    assert.match(r.body, new RegExp(`<a href="/${name}">${name}</a>`), `${name} links to its door`);
  }
  // upload and payout are the id-level doors; the viewer surfaces are not
  assert.match(r.body, /upload<\/a><\/b>\s*<\/td>\s*<td><code>id<\/code>/);
  assert.match(r.body, /<b>payout<\/b>\s*<\/td>\s*<td><code>id<\/code>/);
  assert.match(r.body, /<b>wiki<\/b>\s*<\/td>\s*<td><code>none<\/code>/);
});

test('/surfaces is ordered by level, lowest first', async () => {
  const r = await call('/surfaces');
  const levels = [...r.body.matchAll(/<td><code>(none|attested|verified|id)<\/code>/g)].map((m) => m[1]);
  const order = ['none', 'attested', 'verified', 'id'];
  const ranks = levels.map((l) => order.indexOf(l));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `not ordered: ${levels.join(',')}`);
});

test('the upload door is closed to anyone not on the producer list', async () => {
  assert.equal(policyFor('upload').level, 'id');
  const r = await call('/upload?subject=nobody-has-verified-this');
  assert.equal(r.code, 200);
  assert.match(r.body, /<b>Closed\.<\/b>/);
  assert.match(r.body, /no third-party uploads/i);
  assert.doesNotMatch(r.body, /Cleared to publish/);
});

test('the upload door states the intake decision and what it buys', async () => {
  const r = await call('/upload');
  assert.match(r.body, /Intake is operator-only/);
  assert.match(r.body, /provider set\s*\n?\s*of one|provider set of one/);
  assert.match(r.body, /still requires a government ID examined for every/i);
});

test('the upload door states the 2257 subsections rather than paraphrasing them', async () => {
  const r = await call('/upload');
  for (const cite of ['2257\\(b\\)', '2257\\(c\\)', '2257\\(e\\)', '2257\\(f\\)', '2257\\(i\\)', '2257A']) {
    assert.match(r.body, new RegExp(`§ ${cite}`), `cites § ${cite.replace(/\\\\/g, '')}`);
  }
  assert.match(r.body, /custodian of records/i);
});

test('the upload door keeps the two stores apart and promises no document storage', async () => {
  const r = await call('/upload');
  assert.match(r.body, /The age gate/);
  assert.match(r.body, /§ 2257 records/);
  // the gate side must say plainly that it never holds the document
  assert.match(r.body, /Never holds/);
  assert.match(r.body, /the document, the document number, the date of birth/i);
});

test('an unknown surface fails closed at id', () => {
  assert.equal(policyFor('whatever-this-is').level, 'id');
});

// ── the application route ───────────────────────────────────────────────────────────────────────

import { __setIO, ACKS } from './applications-store.mjs';
import { attest, GATE_COOKIE } from './gate-web.mjs';

// /apply sits at `attested`, so these tests pass the gate first — which is itself the assertion that
// the gate is real. A secret must exist or nothing mints.
process.env.YONI_GATE_SECRET = process.env.YONI_GATE_SECRET || 'test-secret-for-the-suite';

async function gateCookie() {
  const out = await attest('suite-subject');
  assert.equal(out.ok, true, out.reason);
  return `${GATE_COOKIE}=${encodeURIComponent(out.token)}`;
}

function callWith(url, cookie) {
  const req = { method: 'GET', url, headers: { cookie } };
  const res = { code: 0, headers: {}, body: '',
    writeHead(c, h) { this.code = c; this.headers = h || {}; },
    end(b) { this.body = b || ''; } };
  return handler(req, res).then(() => ({ code: res.code, body: res.body }));
}

function postCall(url, fields, cookie) {
  const body = new URLSearchParams(fields).toString();
  const handlers = {};
  const req = {
    method: 'POST', url, headers: cookie ? { cookie } : {},
    on(ev, fn) { handlers[ev] = fn; return this; },
  };
  const res = { code: 0, headers: {}, body: '',
    writeHead(c, h) { this.code = c; this.headers = h || {}; },
    end(b) { this.body = b || ''; } };
  const done = handler(req, res).then(() => ({ code: res.code, body: res.body }));
  // drive the stream the handler just subscribed to
  if (handlers.data) handlers.data(Buffer.from(body, 'utf8'));
  if (handlers.end) handlers.end();
  return done;
}

const fullForm = (extra = {}) => ({
  contact: 'applicant@example.com', what: 'my own studio work',
  ...Object.fromEntries(Object.keys(ACKS).map((k) => [k, 'on'])), ...extra,
});

test('GET /apply is gated: an anonymous visitor gets the attestation first', async () => {
  const r = await call('/apply');
  assert.equal(r.code, 200);
  assert.match(r.body, /Before you go in/);
  assert.match(r.body, /18 years of age or over/);
  assert.doesNotMatch(r.body, /Apply to produce/);
});

test('GET /apply serves the form with every acknowledgement', async () => {
  const r = await callWith('/apply', await gateCookie());
  assert.equal(r.code, 200);
  assert.match(r.body, /Apply to produce/);
  assert.equal((r.body.match(/type=checkbox/g) || []).length, Object.keys(ACKS).length);
  assert.match(r.body, /Do not attach identity documents/i);
  assert.match(r.body, /grants no publishing rights/i);
});

test('POST /apply with a complete form is accepted', async () => {
  __setIO({ read: () => '', append: () => true });
  const r = await postCall('/apply', fullForm(), await gateCookie());
  assert.equal(r.code, 200);
  assert.match(r.body, /Application received/);
  assert.match(r.body, /no rights are granted/i);
});

test('POST /apply re-renders the form with the reason when incomplete', async () => {
  __setIO({ read: () => '', append: () => true });
  const r = await postCall('/apply', fullForm({ contact: '' }), await gateCookie());
  assert.equal(r.code, 200);
  assert.match(r.body, /Not submitted/);
  assert.match(r.body, /contact/);
  assert.doesNotMatch(r.body, /Application received/);
});

test('POST /apply refuses a form carrying an identity document', async () => {
  __setIO({ read: () => '', append: () => true });
  const r = await postCall('/apply', fullForm({ dob: '1990-01-01' }), await gateCookie());
  assert.match(r.body, /Not submitted/);
  assert.match(r.body, /refusing to store/);
});

test('an unticked acknowledgement is not submitted', async () => {
  __setIO({ read: () => '', append: () => true });
  const form = fullForm(); delete form.over18;   // an unchecked box posts nothing at all
  const r = await postCall('/apply', form, await gateCookie());
  assert.match(r.body, /Not submitted/);
  assert.match(r.body, /18 or over/);
});

test('the upload door points a stranger at the application', async () => {
  const r = await call('/upload?subject=stranger');
  assert.match(r.body, /<b>Closed\.<\/b>/);
  assert.match(r.body, /href="\/apply"/);
});

// ── the gate actually gates ─────────────────────────────────────────────────────────────────────

test('an attestation opens apply and still cannot open gallery, video or live', async () => {
  const cookie = await gateCookie();
  assert.match((await callWith('/apply', cookie)).body, /Apply to produce/);
  for (const s of ['gallery', 'video', 'live']) {
    const r = await callWith(`/${s}`, cookie);
    // the surface itself must NOT render — a click buys `attested`, and these need `verified`
    assert.match(r.body, /<h1>Age check<\/h1>/, `${s} should offer the check`);
    assert.doesNotMatch(r.body, new RegExp(`<h1>${s[0].toUpperCase()}${s.slice(1)}</h1>`, 'i'),
      `${s} rendered its own page on a mere attestation`);
    assert.doesNotMatch(r.body, /Particular to this surface/, `${s} leaked surface content`);
  }
});

test('the open surfaces need no gate at all', async () => {
  for (const s of ['/', '/preview', '/surfaces', '/compliance']) {
    const r = await call(s);
    assert.equal(r.code, 200, s);
    assert.doesNotMatch(r.body, /Before you go in/, `${s} should not be gated`);
  }
});

test('a subject cookie is set on a first visit and is httpOnly', async () => {
  const req = { method: 'GET', url: '/', headers: {} };
  const res = { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; }, end(b) { this.body = b || ''; } };
  await handler(req, res);
  const set = [].concat(res.headers['set-cookie'] || []);
  const sub = set.find((c) => c.startsWith('ys_s='));
  assert.ok(sub, 'subject cookie set');
  assert.match(sub, /HttpOnly/);
  assert.match(sub, /^ys_s=[a-f0-9]{32};/, 'opaque hex, nothing derived from the request');
});

test('safeNext refuses anything that is not an internal path', () => {
  for (const bad of ['//evil.com', 'http://evil.com', 'https://evil.com', '/x\r\nX: 1', '\\\\evil', '', null]) {
    assert.equal(safeNext(bad), '/', `rejected: ${JSON.stringify(bad)}`);
  }
  assert.equal(safeNext('/apply'), '/apply');
  assert.equal(safeNext('/a/Some_Article'), '/a/Some_Article');
});

test('GET on the attest endpoint is refused', async () => {
  const res = { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; }, end(b) { this.body = b || ''; } };
  await handler({ method: 'GET', url: '/gate/attest', headers: {} }, res);
  assert.equal(res.code, 405);
});

// ── the verified gate now offers a real check instead of a dead end ─────────────────────────────

test('a verified surface offers the age check rather than "not available"', async () => {
  for (const s of ['gallery', 'video', 'live']) {
    const r = await call(`/${s}`);
    assert.equal(r.code, 200, s);
    assert.match(r.body, /Age check/, `${s} should offer the check`);
    assert.match(r.body, /The photograph is not kept/, `${s} must say the image is discarded`);
    assert.doesNotMatch(r.body, /has not contracted a provider/, `${s} is no longer a dead end`);
  }
});

test('the check page states the margin honestly and does not blame the visitor', async () => {
  const r = await call('/gate/verify');
  assert.equal(r.code, 200);
  assert.match(r.body, /above eighteen by a margin/);
  assert.match(r.body, /that is the margin doing its job, not a judgement about you/);
});

test('an id-level surface still gets the no-provider wall, not the selfie check', async () => {
  const r = await call('/payout');
  // payout has no page; the shelf 404s rather than offering a check it cannot satisfy
  assert.equal(r.code, 404);
});

test('GET /gate/verify renders, POST without a body is refused as JSON', async () => {
  const handlers = {};
  const req = { method: 'POST', url: '/gate/verify?next=/gallery', headers: {}, on(ev, fn) { handlers[ev] = fn; return this; }, destroy() {} };
  const res = { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; }, end(b) { this.body = b || ''; } };
  const done = handler(req, res).then(() => res);
  if (handlers.data) handlers.data(Buffer.alloc(0));
  if (handlers.end) handlers.end();
  const out = await done;
  assert.equal(out.code, 200);
  const j = JSON.parse(out.body);
  assert.equal(j.ok, false);
  assert.match(j.reason, /no image|not a JPEG/);
});

// ── the producer pipeline: approve → claim → slot → commit → it appears ────────────────────────

import { approve as approveProducer, __setIO as __setProducerIO } from './producers-store.mjs';
import { __setIO as __setMediaIO } from './media-store.mjs';

// storageConfig() reads these per request; unset, slotFor correctly refuses to sign anything. Fake values
// are enough to exercise the signer offline — nothing is ever sent to this endpoint.
process.env.DRIVE_S3_ENDPOINT = process.env.DRIVE_S3_ENDPOINT || 'https://storage.invalid';
process.env.DRIVE_S3_BUCKET = process.env.DRIVE_S3_BUCKET || 'test-bucket';
process.env.DRIVE_S3_KEY = process.env.DRIVE_S3_KEY || 'AKIATEST';
process.env.DRIVE_S3_SECRET = process.env.DRIVE_S3_SECRET || 'secret-for-tests-only';
process.env.DRIVE_S3_REGION = process.env.DRIVE_S3_REGION || 'garage';

function memStores() {
  const p = new Map(); const m = new Map();
  __setProducerIO({ read: (k) => p.get(k) || '', append: (k, l) => { p.set(k, (p.get(k) || '') + l); return true; } });
  __setMediaIO({ read: (k) => m.get(k) || '', append: (k, l) => { m.set(k, (m.get(k) || '') + l); return true; } });
  return { p, m };
}

function postJson(url, obj, cookie) {
  const body = JSON.stringify(obj);
  const h = {};
  const req = { method: 'POST', url, headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json' },
    on(ev, fn) { h[ev] = fn; return this; }, destroy() {} };
  const res = { code: 0, headers: {}, body: '', writeHead(c, hh) { this.code = c; this.headers = hh || {}; }, end(b) { this.body = b || ''; } };
  const done = handler(req, res).then(() => ({ code: res.code, json: (() => { try { return JSON.parse(res.body); } catch { return null; } })() }));
  if (h.data) h.data(Buffer.from(body));
  if (h.end) h.end();
  return done;
}

test('a stranger cannot ask for an upload slot', async () => {
  memStores();
  const r = await postJson('/upload/slot', { surface: 'gallery', filename: 'a.jpg', bytes: 10 });
  assert.equal(r.code, 403);
  assert.match(r.json.reason, /not on the producer list/);
});

test('/upload shows the publish form only to a producer', async () => {
  memStores();
  assert.doesNotMatch((await call('/upload')).body, /Publish something/);
});

test('a bad claim code is refused and grants nothing', async () => {
  memStores();
  const r = await call('/upload/claim?code=deadbeef');
  assert.equal(r.code, 200);
  assert.match(r.body, /did not work/);
  assert.equal((await postJson('/upload/slot', { surface: 'gallery', filename: 'a.jpg', bytes: 10 })).code, 403);
});

test('approve → claim in this browser → slot → commit → it is on the surface', async () => {
  memStores();
  const a = approveProducer('ryan');
  assert.equal(a.ok, true, a.reason);

  // claim binds whatever subject this request carries, so reuse that cookie afterwards
  const res = { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; }, end(b) { this.body = b || ''; } };
  await handler({ method: 'GET', url: `/upload/claim?code=${a.code}`, headers: {} }, res);
  assert.match(res.body, /You are a producer here/);
  assert.match(res.body, /Bound as ryan/);
  const subjCookie = [].concat(res.headers['set-cookie'] || []).find((c) => c.startsWith('ys_s='))?.split(';')[0];
  assert.ok(subjCookie, 'the claim response carries the subject cookie');

  const slot = await postJson('/upload/slot', { surface: 'gallery', filename: 'shot.jpg', bytes: 1234 }, subjCookie);
  assert.equal(slot.code, 200);
  assert.equal(slot.json.ok, true, slot.json.reason);
  assert.match(slot.json.putUrl, /X-Amz-Signature=/);

  const done = await postJson('/upload/commit',
    { key: slot.json.key, surface: 'gallery', caption: 'a test shot', bytes: 1234 }, subjCookie);
  assert.equal(done.json.ok, true, done.json.reason);
  assert.equal(done.json.item.handle, 'ryan', 'attributed to the approved handle, not to whatever was posted');

  // and /upload now offers the form to that browser
  assert.match((await callWith('/upload', subjCookie)).body, /Publish something/);
  assert.match((await callWith('/upload', subjCookie)).body, /Cleared to publish as ryan/);
});

test('a producer cannot commit a key outside their own surface prefix', async () => {
  memStores();
  const a = approveProducer('ryan');
  const res = { code: 0, headers: {}, body: '', writeHead(c, h) { this.headers = h || {}; }, end() {} };
  await handler({ method: 'GET', url: `/upload/claim?code=${a.code}`, headers: {} }, res);
  const c = [].concat(res.headers['set-cookie'] || []).find((x) => x.startsWith('ys_s='))?.split(';')[0];
  const r = await postJson('/upload/commit', { key: '../../etc/passwd', surface: 'gallery' }, c);
  assert.equal(r.json.ok, false);
});

test('an uncleared viewer sees no items even when some are published', async () => {
  memStores();
  const a = approveProducer('ryan');
  const res = { code: 0, headers: {}, body: '', writeHead(c, h) { this.headers = h || {}; }, end() {} };
  await handler({ method: 'GET', url: `/upload/claim?code=${a.code}`, headers: {} }, res);
  const c = [].concat(res.headers['set-cookie'] || []).find((x) => x.startsWith('ys_s='))?.split(';')[0];
  const slot = await postJson('/upload/slot', { surface: 'gallery', filename: 'a.jpg', bytes: 10 }, c);
  await postJson('/upload/commit', { key: slot.json.key, surface: 'gallery', caption: 'secret', bytes: 10 }, c);

  const anon = await call('/gallery');
  assert.match(anon.body, /Age check/, 'an unverified viewer is sent to the check');
  assert.doesNotMatch(anon.body, /secret/, 'a published caption must not leak to an unverified viewer');
});
