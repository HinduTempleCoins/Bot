// pentecaust/herald/qr-tracker.test.mjs — offline suite for the Herald QR / landing tracker.
//   node --test pentecaust/herald/qr-tracker.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerCampaign, getCampaign, qrTargetUrl, qrSvgPlaceholder, scanStats, handler, __setAuth,
} from './qr-tracker.mjs';

// In-memory fs so nothing touches disk / network.
function memFs() {
  const box = { data: null };
  return {
    fs: { read: () => box.data, write: (_p, s) => { box.data = s; } },
    file: '/mem/qr-scans.json',
    box,
  };
}
// Fake req/res: res captures { code, headers, body }.
function fakeReq(url, headers = {}, method = 'GET') { return { url, method, headers }; }
function fakeRes() {
  const cap = { code: 0, headers: {}, body: '' };
  return {
    cap,
    writeHead(code, headers) { cap.code = code; cap.headers = headers || {}; },
    end(body) { cap.body = body == null ? '' : body; },
  };
}

test('register + GET /go/{code} → 301 with landing URL + utm_campaign, scan recorded', () => {
  const m = memFs();
  const reg = registerCampaign('laundro-03', { landingUrl: 'https://melek.salon/signup', label: 'Laundromat #3' }, { fs: m.fs, file: m.file });
  assert.equal(reg.ok, true);

  const res = fakeRes();
  handler(fakeReq('/go/laundro-03', { 'user-agent': 'iPhone', referer: 'https://qr.example.com/flyer?x=1' }), res, { fs: m.fs, file: m.file, now: 1_600_000_000_000 });

  assert.equal(res.cap.code, 301);
  const loc = res.cap.headers.Location;
  assert.match(loc, /^https:\/\/melek\.salon\/signup\?/);
  assert.match(loc, /utm_campaign=laundro-03/);
  assert.match(loc, /utm_source=qr/);
  assert.match(loc, /utm_medium=print/);

  const stats = scanStats({ fs: m.fs, file: m.file });
  assert.equal(stats['laundro-03'].total, 1);
  // referer stored as HOST only (no path/query leak)
  const stored = JSON.parse(m.box.data);
  assert.equal(stored.scans[0].ref, 'qr.example.com');
  assert.equal(stored.scans[0].ua, 'iPhone');
});

test('UTM merges into a landing URL that already has a query', () => {
  const m = memFs();
  registerCampaign('pizza-01', { landingUrl: 'https://melek.salon/l?ref=pizza#top', label: 'Pizza' }, { fs: m.fs, file: m.file });
  const res = fakeRes();
  handler(fakeReq('/go/pizza-01', {}), res, { fs: m.fs, file: m.file });
  const loc = res.cap.headers.Location;
  assert.match(loc, /\?ref=pizza&utm_source=qr/);
  assert.match(loc, /utm_campaign=pizza-01#top$/); // hash preserved at the end
});

test('unknown code → 302 to default BASE_URL, no scan logged', () => {
  const m = memFs();
  const res = fakeRes();
  handler(fakeReq('/go/does-not-exist', {}), res, { fs: m.fs, file: m.file });
  assert.equal(res.cap.code, 302);
  assert.equal(res.cap.headers.Location, 'https://melek.salon');
  assert.deepEqual(scanStats({ fs: m.fs, file: m.file }), {});
});

test('/go-dashboard without auth → 401', () => {
  const m = memFs();
  __setAuth(() => false);
  const res = fakeRes();
  handler(fakeReq('/go-dashboard', {}), res, { fs: m.fs, file: m.file });
  assert.equal(res.cap.code, 401);
  __setAuth(null); // reset to default (allow)
});

test('/go-dashboard with injected auth true → 200 HTML with code, malicious UA escaped', () => {
  const m = memFs();
  registerCampaign('dart-a', { landingUrl: 'https://melek.salon/darts', label: 'Dart League' }, { fs: m.fs, file: m.file });
  // A scan carrying an XSS-y user-agent — the dashboard must escape it.
  handler(fakeReq('/go/dart-a', { 'user-agent': '<script>alert(1)</script>' }, 'GET'), fakeRes(), { fs: m.fs, file: m.file });

  __setAuth(() => true);
  const res = fakeRes();
  handler(fakeReq('/go-dashboard', {}), res, { fs: m.fs, file: m.file });
  __setAuth(null);

  assert.equal(res.cap.code, 200);
  assert.match(res.cap.headers['content-type'], /text\/html/);
  assert.match(res.cap.body, /dart-a/);
  // escaped, not raw
  assert.match(res.cap.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!res.cap.body.includes('<script>alert(1)</script>'));
});

test('scanStats groups by ISO week and totals correctly', () => {
  const m = memFs();
  registerCampaign('wk', { landingUrl: 'https://melek.salon/x' }, { fs: m.fs, file: m.file });
  // Three scans: two in one ISO week, one a week later.
  const wk31 = Date.UTC(2026, 6, 29); // 2026-07-29 → 2026-W31
  const wk32 = Date.UTC(2026, 7, 5);  // 2026-08-05 → 2026-W32
  handler(fakeReq('/go/wk', {}), fakeRes(), { fs: m.fs, file: m.file, now: wk31 });
  handler(fakeReq('/go/wk', {}), fakeRes(), { fs: m.fs, file: m.file, now: wk31 + 3600000 });
  handler(fakeReq('/go/wk', {}), fakeRes(), { fs: m.fs, file: m.file, now: wk32 });

  const stats = scanStats({ fs: m.fs, file: m.file });
  assert.equal(stats.wk.total, 3);
  assert.equal(stats.wk.byWeek['2026-W31'], 2);
  assert.equal(stats.wk.byWeek['2026-W32'], 1);
});

test('registerCampaign validates code + landingUrl; soft-fails, never throws', () => {
  const m = memFs();
  assert.equal(registerCampaign('BAD CODE!', { landingUrl: 'https://x.io' }, { fs: m.fs, file: m.file }).ok, false);
  assert.equal(registerCampaign('ok-1', { landingUrl: 'ftp://nope' }, { fs: m.fs, file: m.file }).ok, false);
  assert.equal(registerCampaign('ok-1', { landingUrl: 'https://x.io' }, { fs: m.fs, file: m.file }).ok, true);
  assert.ok(getCampaign('ok-1', { fs: m.fs, file: m.file }));
});

test('qrTargetUrl + qrSvgPlaceholder', () => {
  assert.equal(qrTargetUrl('laundro-03'), 'https://melek.salon/go/laundro-03');
  const svg = qrSvgPlaceholder('laundro-03');
  assert.match(svg, /^<svg /);
  assert.match(svg, /laundro-03/);
  assert.match(svg, /melek\.salon\/go\/laundro-03/);
});

test('unknown path → 404', () => {
  const m = memFs();
  const res = fakeRes();
  handler(fakeReq('/nope', {}), res, { fs: m.fs, file: m.file });
  assert.equal(res.cap.code, 404);
});
