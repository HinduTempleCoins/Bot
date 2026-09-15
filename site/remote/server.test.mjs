// The remote's correctness is mostly about honesty: it must not imply it can control brands it cannot,
// and it must not send anything anywhere except from the user's own browser to their own TV.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handler, page, SITEMAP_PATHS } from './server.mjs';
import { ecpBase, keypressUrl, launchUrl, channel, platform, KEYS, CHANNELS, PLATFORMS } from '../../integrations/soapbox/tv-remote.mjs';

const call = (path) => new Promise((resolve) => {
  const c = [];
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { c.push(b ?? ''); resolve({ status: this.statusCode, body: c.join('') }); } };
  handler({ url: path, method: 'GET' }, res);
});

test('routes answer; a bad IP is rejected rather than built into a URL', async () => {
  for (const p of [...SITEMAP_PATHS, '/robots.txt', '/sitemap.xml', '/llms.txt', '/healthz']) {
    assert.equal((await call(p)).status, 200, p);
  }
  assert.equal((await call('/api/urls?ip=192.168.1.42')).status, 200);
  assert.equal((await call('/api/urls?ip=bad!!')).status, 400);
  assert.equal((await call('/api/urls')).status, 400);
  assert.equal((await call('/nope')).status, 404);
});

test('ecpBase accepts what a person actually types, rejects what they should not', () => {
  assert.equal(ecpBase('192.168.1.42'), 'http://192.168.1.42:8060');
  assert.equal(ecpBase('http://192.168.1.42/'), 'http://192.168.1.42:8060');
  assert.equal(ecpBase('192.168.1.42:8060'), 'http://192.168.1.42:8060');
  assert.equal(ecpBase('roku.local'), 'http://roku.local:8060');
  for (const bad of ['', '   ', 'not a host!!', '192.168.1.42:99999', null, undefined]) {
    assert.equal(ecpBase(bad), null, JSON.stringify(bad));
  }
});

test('only known keys and numeric app ids ever become URLs', () => {
  const b = ecpBase('10.0.0.5');
  assert.equal(keypressUrl(b, 'PowerOn'), 'http://10.0.0.5:8060/keypress/PowerOn');
  assert.equal(keypressUrl(b, 'DropTable'), null, 'unknown key must not build a URL');
  assert.equal(launchUrl(b, '41468'), 'http://10.0.0.5:8060/launch/41468');
  assert.equal(launchUrl(b, '../../evil'), null);
  assert.equal(launchUrl(b, 'abc'), null);
});

test('Tubi is present, marked free, and is a high-confidence id', () => {
  const t = channel('Tubi');
  assert.ok(t);
  assert.equal(t.id, '41468');
  assert.equal(t.free, true);
  assert.equal(t.confidence, 'high');
  assert.ok(page().includes('data-app="41468"'), 'the Tubi button is on the page');
});

test('⭐ the page never claims to control a platform it cannot', () => {
  const html = page();
  // Roku is the only open one; every other row must say No and name the real route.
  assert.equal(platform('roku').thisPageWorks, true);
  for (const p of PLATFORMS.filter((x) => x.id !== 'roku')) {
    assert.equal(p.thisPageWorks, false, `${p.id} must not claim to work`);
    assert.ok(p.how && p.how.length > 10, `${p.id} must name the real route`);
    assert.ok(html.includes(p.name), `${p.id} is listed so the reader is not left guessing`);
  }
  assert.match(html, /only one with an open local API/i);
});

test('the LAN constraint is stated, because it is the thing that breaks for people', () => {
  const html = page();
  assert.match(html, /same Wi-Fi as the TV/i);
  assert.match(html, /cannot work from cellular data/i);
  assert.match(html, /no-cors/, 'the send-but-cannot-read technique is used');
});

test('the unconfirmed channel ids are labelled as such', () => {
  const html = page();
  for (const c of CHANNELS.filter((x) => x.confidence !== 'high')) {
    assert.ok(html.includes(c.name), `${c.name} listed`);
  }
  assert.match(html, /ID unconfirmed/);
  assert.match(html, /launches nothing rather than the wrong\s+thing/i);
});

test('the server itself never talks to the TV and stores nothing', async () => {
  const html = page();
  assert.match(html, /Nothing is sent to us/i);
  assert.match(html, /localStorage/, 'the IP stays client-side');
  // No server-side fetch of the device anywhere in the handler path.
  const { body } = await call('/api/urls?ip=192.168.1.42');
  const j = JSON.parse(body);
  assert.equal(j.base, 'http://192.168.1.42:8060');
  assert.ok(j.channels.Tubi.endsWith('/launch/41468'));
});

test('every key in the registry has a label', () => {
  for (const k of KEYS) { assert.ok(k.key, 'key'); assert.ok(k.label, `${k.key} label`); }
});
