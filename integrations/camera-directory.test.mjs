import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listCams, searchCams, allCams, windyCams, toCam, toWindyCam, refuseHost,
  esc, safeHref, dataNote, POSTURE, __setFetch,
} from './camera-directory.mjs';

test('esc escapes html', () => assert.equal(esc(`<b>&"'`), '&lt;b&gt;&amp;&quot;&#39;'));

test('safeHref allows http(s) only, drops javascript:/data:', () => {
  assert.equal(safeHref('https://example.com/x'), 'https://example.com/x');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('rtsp://cam/stream'), '');
});

test('seed list has the required shape + valid posture (window|point, never host)', () => {
  const cams = listCams();
  assert.ok(cams.length >= 5, 'seed directory should be non-trivial');
  for (const c of cams) {
    for (const k of ['id', 'name', 'region', 'source', 'posture', 'attribution']) {
      assert.ok(k in c, `cam ${c.id} missing ${k}`);
    }
    assert.match(c.source, /^https?:\/\//, `${c.id} source must be http(s)`);
    assert.ok([POSTURE.WINDOW, POSTURE.POINT].includes(c.posture), `${c.id} posture must be window|point`);
    assert.notEqual(c.posture, 'host', 'a public cam is never HOST posture (we never store frames)');
    assert.ok(c.attribution.length > 0, `${c.id} must carry attribution`);
    // window posture requires an embeddable http(s) surface; point has no embed.
    if (c.posture === POSTURE.WINDOW) assert.match(c.embed, /^https?:\/\//);
    else assert.equal(c.embed, '');
  }
});

test('directory contains official traffic (DOT/511) sources', () => {
  const traffic = searchCams({ category: 'traffic', limit: 50 });
  assert.ok(traffic.length >= 1);
  assert.ok(traffic.every((c) => c.category === 'traffic'));
});

test('searchCams filters by q, region, category and clamps limit', () => {
  assert.ok(searchCams({ q: 'venice' }).some((c) => /venice/i.test(c.name)));
  assert.ok(searchCams({ region: 'CA, USA' }).every((c) => /CA, USA/i.test(c.region)));
  assert.ok(searchCams({ category: 'nature' }).every((c) => c.category === 'nature'));
  assert.ok(searchCams({ limit: 1 }).length <= 1);
  assert.ok(searchCams({ limit: 99999 }).length <= 200);
});

test('searchCams soft-fails to [] on a bad arg (never throws)', () => {
  assert.deepEqual(searchCams(null), searchCams({}));       // null → defaults, not a throw
});

test('refuseHost blocks Insecam-style / scraper / probe markers (the hard line)', () => {
  for (const bad of ['insecam.org', 'https://opentopia.com/x', 'shodan camera', 'default-password cam', 'scraper-feed', 'admin:admin@1.2.3.4']) {
    assert.equal(refuseHost(bad), true, `${bad} must be refused`);
  }
  assert.equal(refuseHost('https://wsdot.com/travel/'), false);
  assert.equal(refuseHost(''), false);
});

test('toCam refuses a scraper-sourced record even with valid fields', () => {
  assert.equal(toCam({ id: 'x', name: 'bedroom cam', source: 'https://insecam.org/en/view/1' }), null);
  assert.equal(toCam({ id: 'x', name: 'open cam', source: 'https://ok.example.com', embed: 'https://scraper.example/x' }), null);
  assert.equal(toCam({ id: 'x', name: 'no source' }), null);
  assert.equal(toCam({ id: 'x', name: 'bad scheme', source: 'rtsp://cam/1' }), null);
});

// ── Windy adapter: OFF without a key; ON via mocked fetch when a key is present ──────────────────────
test('windyCams is OFF (returns []) when WINDY_API_KEY is not set', async () => {
  const saved = process.env.WINDY_API_KEY;
  delete process.env.WINDY_API_KEY;
  __setFetch(async () => { throw new Error('must not be called without a key'); });
  assert.deepEqual(await windyCams({ q: 'nature' }), []);
  __setFetch(null);
  if (saved !== undefined) process.env.WINDY_API_KEY = saved;
});

test('windyCams adapter shapes rows via mocked fetch when a key is set', async () => {
  const saved = process.env.WINDY_API_KEY;
  process.env.WINDY_API_KEY = 'test-key';
  __setFetch(async () => ({
    ok: true,
    json: async () => ({ webcams: [
      { webcamId: 42, title: 'Harbor Cam', viewUrl: 'https://www.windy.com/webcams/42', player: 'https://webcams.windy.com/embed/42', location: { city: 'Nice', country: 'France' }, category: 'harbor' },
      { webcamId: 7, title: 'Insecam leak', viewUrl: 'https://insecam.org/7' }, // refused by marker
    ] }),
  }));
  const out = await windyCams({ q: 'harbor', limit: 10 });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'windy-42');
  assert.equal(out[0].posture, POSTURE.WINDOW);
  assert.match(out[0].attribution, /Windy/i);
  __setFetch(null);
  if (saved === undefined) delete process.env.WINDY_API_KEY; else process.env.WINDY_API_KEY = saved;
});

test('windyCams soft-fails to [] on a bad response / thrown fetch', async () => {
  const saved = process.env.WINDY_API_KEY;
  process.env.WINDY_API_KEY = 'test-key';
  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await windyCams({}), []);
  __setFetch(async () => { throw new Error('network'); });
  assert.deepEqual(await windyCams({}), []);
  __setFetch(null);
  if (saved === undefined) delete process.env.WINDY_API_KEY; else process.env.WINDY_API_KEY = saved;
});

test('allCams returns the seed list keyless (no key → seed only), never throws', async () => {
  const saved = process.env.WINDY_API_KEY;
  delete process.env.WINDY_API_KEY;
  const out = await allCams({ limit: 80 });
  assert.ok(out.length >= 5);
  assert.equal(out.length, listCams().length);
  if (saved !== undefined) process.env.WINDY_API_KEY = saved;
});

test('dataNote states the consent boundary', () => {
  assert.match(dataNote(), /consensual|never scrape|never rehost/i);
});
