// site/plate/server.test.mjs — offline, no network. The rule this site exists under is that it never
// renders a finding, so the tests assert that directly, not just that the pages return 200.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handler, plateView, tierView, screenerResult, whyView, SITEMAP_PATHS, esc } from './server.mjs';
import { STATE_IDS, TIER_IDS } from '../../integrations/temple-plate.mjs';
import { RULES } from '../../integrations/temple-mycin.mjs';

function call(path) {
  return new Promise((resolve) => {
    const chunks = [];
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(b) { chunks.push(b == null ? '' : b); resolve({ status: this.statusCode, type: this.headers['content-type'] || '', body: chunks.join('') }); },
    };
    handler({ url: path, method: 'GET' }, res);
  });
}

test('every sitemap path renders 200', async () => {
  for (const p of SITEMAP_PATHS) {
    const r = await call(p);
    assert.equal(r.status, 200, `${p} -> ${r.status}`);
  }
});

test('crawl surfaces exist and the sitemap is the real route list', async () => {
  assert.equal((await call('/robots.txt')).status, 200);
  const sm = await call('/sitemap.xml');
  assert.equal(sm.status, 200);
  assert.equal((sm.body.match(/<loc>/g) || []).length, SITEMAP_PATHS.length);
  assert.match((await call('/llms.txt')).body, /Temple Plate/);
  const h = JSON.parse((await call('/healthz')).body);
  assert.equal(h.ok, true);
  assert.equal(h.shares.ok, true, 'tier shares still sum to 1');
});

test('unknown state, tier and rule are 404, not a blank page', async () => {
  for (const p of ['/state/nope', '/tier/nope', '/why/nope', '/nothing']) {
    assert.equal((await call(p)).status, 404, p);
  }
});

test('the MAOI state names the ferment guard AND the mechanism slug', () => {
  const html = plateView('maoi');
  assert.match(html, /OFF THE PLATE/);
  assert.match(html, /TYRAMINE/);
  assert.match(html, /tyramine-load/);           // points at interactions-data, one source of truth
  assert.match(html, /ldopa-load/);              // broad bean pods are a different mechanism
  assert.match(html, /which inhibitor/i);        // a RIMA is not an irreversible oral MAOI
});

test('the scarcity state routes to benefits, not to a food rule', () => {
  const html = plateView('scarcity');
  assert.match(html, /not a dietary state/i);
  assert.match(html, /benefits\.soapbox\.community/);
});

test('every state and tier has a page', () => {
  for (const s of STATE_IDS) assert.ok(plateView(s), s);
  for (const t of TIER_IDS) assert.ok(tierView(t), t);
});

test('the screener returns TESTS TO ASK FOR and never a finding', () => {
  const html = screenerResult(['vegan_diet', 'numb_hands_feet', 'balance_off']);
  assert.match(html, /Methylmalonic acid/);              // the test, not the diagnosis
  assert.match(html, /Take this to a clinician/i);
  assert.match(html, /not a diagnosis/i);
  // The forbidden shape: a page that asserts the person HAS the deficiency.
  assert.doesNotMatch(html, /you have (a )?(vitamin )?b12 deficiency/i);
  assert.doesNotMatch(html, /diagnos(ed|is) (of|with)/i);
});

test('an empty screener run says so without issuing a clearance', () => {
  const html = screenerResult([]);
  assert.match(html, /not a clearance/i);
});

test('every rule has an inspectable WHY page — MYCIN explanation facility intact', () => {
  for (const r of RULES) {
    const html = whyView(r.id);
    assert.ok(html, r.id);
    assert.match(html, new RegExp(esc(r.why).slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('hostile input is escaped, not reflected', async () => {
  const r = await call('/screener?s=%3Cscript%3Ealert(1)%3C/script%3E');
  assert.equal(r.status, 200);
  assert.ok(!r.body.includes('<script>alert(1)'), 'no raw script reflected');
});

test('the JSON APIs answer without storing anything', async () => {
  const p = JSON.parse((await call('/api/plate?state=maoi')).body);
  assert.equal(p.state, 'maoi');
  const s = JSON.parse((await call('/api/screen?s=pica&s=fatigue')).body);
  assert.ok(s.conclusions.some((c) => c.points_at === 'iron'));
  assert.match(s.disclaimer, /not a diagnosis/i);
});
