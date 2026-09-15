// The portfolio is the artifact handed to outsiders. Its one job is that every claim on it is
// checkable, so the tests are about honesty, not rendering.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handler, homePage, categoryPage, asJson, SITEMAP_PATHS } from './server.mjs';
import { SURFACES, CATEGORIES, counts, live, built, PROBED_ON } from '../../integrations/soapbox/portfolio.mjs';

const call = (path) => new Promise((resolve) => {
  const c = [];
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { c.push(b ?? ''); resolve({ status: this.statusCode, body: c.join('') }); } };
  handler({ url: path, method: 'GET' }, res);
});

test('every sitemap path renders 200; unknown category 404s', async () => {
  for (const p of SITEMAP_PATHS) assert.equal((await call(p)).status, 200, p);
  assert.equal((await call('/c/nope')).status, 404);
});

test('⭐ a surface that is NOT live is never hyperlinked', async () => {
  // The rule the page exists to enforce: a dead link costs more than a missing one, because a reader
  // who clicks one downgrades everything above it too.
  const html = (await call('/')).body;
  for (const s of built()) {
    assert.ok(!html.includes(`href="https://${s.host}/"`), `${s.host} must not be linked while undeployed`);
    assert.ok(html.includes(s.host), `${s.host} should still be LISTED, just not linked`);
  }
  for (const s of live()) {
    assert.ok(html.includes(`href="https://${s.host}/"`), `${s.host} is live and must be linked`);
  }
});

test('llms.txt advertises live hosts ONLY — a model that follows a dead link repeats it', async () => {
  const txt = (await call('/llms.txt')).body;
  for (const s of built()) assert.ok(!txt.includes(s.host), `${s.host} must not be advertised`);
  for (const s of live()) assert.ok(txt.includes(s.host), `${s.host} should be advertised`);
});

test('the page states the probe date and refuses to quote traffic it does not have', async () => {
  const html = (await call('/')).body;
  assert.ok(html.includes(PROBED_ON), 'probe date shown');
  assert.match(html, /does not quote a traffic number/i);
  assert.match(html, /probed .* by HTTPS GET/i);
});

test('counts are computed from the registry, never typed', () => {
  const c = counts();
  assert.equal(c.total, SURFACES.length);
  assert.equal(c.live + c.built + (c.soon || 0), c.total);
  assert.equal(c.live, SURFACES.filter((s) => s.state === 'live').length);
});

test('every surface has a known category and a known state', () => {
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const s of SURFACES) {
    assert.ok(cats.has(s.cat), `${s.slug} category ${s.cat}`);
    assert.ok(['live', 'built', 'soon'].includes(s.state), `${s.slug} state`);
    assert.match(s.host, /^[a-z0-9.-]+\.[a-z]{2,}$/, `${s.slug} host looks like a host`);
  }
});

test('⛔ no admin surface is ever listed', () => {
  // crawlers.mjs keeps admin out of the sitemap index; the portfolio must not reintroduce it.
  for (const s of SURFACES) {
    assert.doesNotMatch(s.host, /soapy\.blog|^admin\.|^console\.|^analytics\./, `${s.host} is an admin surface`);
  }
});

test('slugs and hosts are unique — a duplicate row is a claim counted twice', () => {
  assert.equal(new Set(SURFACES.map((s) => s.slug)).size, SURFACES.length);
  assert.equal(new Set(SURFACES.map((s) => s.host)).size, SURFACES.length);
});

test('the JSON copy carries the same states as the HTML', () => {
  const j = asJson();
  assert.equal(j.probed_on, PROBED_ON);
  assert.equal(j.surfaces.length, SURFACES.length);
  for (const s of j.surfaces) assert.equal(s.url, `https://${s.host}/`);
});

test('a category page shows exactly its own surfaces', () => {
  const html = categoryPage('media');
  for (const s of SURFACES.filter((x) => x.cat === 'media')) assert.ok(html.includes(s.host), s.host);
  assert.ok(!html.includes('grants.soapbox.community'), 'no cross-category leakage');
  assert.equal(categoryPage('nope'), null);
});

test('an undeployed surface is stated plainly wherever one exists', () => {
  // stream/player/cams were dark when this was written and are live now, so the media category no
  // longer carries the label. The property under test is that the label appears where it is TRUE —
  // asserted against whichever category still has a built surface, rather than a hardcoded one.
  const cat = CATEGORIES.map((c) => c.id).find((id) => SURFACES.some((s) => s.cat === id && s.state === 'built'));
  if (!cat) {
    assert.equal(built().length, 0, 'no built surfaces left — nothing to label');
    return;
  }
  const html = categoryPage(cat);
  assert.match(html, /Built, not deployed/, `${cat} has a built surface and must say so`);
});
