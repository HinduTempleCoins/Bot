// server.test.mjs — site/moderation OFFLINE tests. Fake flag-pipe injected via __setFlagPipe.
// Asserts: severity ranking, resolve form presence, gated CSAM render (no evidence leak), escaping,
// the POST /resolve path (PRG + resolve called), and soft-fail when the pipe is broken.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  renderReview, handler, esc, __setFlagPipe, __resetFlagPipe,
} from './server.mjs';

// ── fakes ────────────────────────────────────────────────────────────────────────
function makeFakePipe(queue, { onResolve } = {}) {
  return {
    RESOLVE_ACTIONS: ['reviewed', 'dismissed', 'actioned', 'escalated'],
    reviewQueue() { return queue.slice(); },
    summary() {
      const byKind = {}; const byStatus = {}; let gatedPending = 0;
      for (const f of queue) {
        byKind[f.kind] = (byKind[f.kind] || 0) + 1;
        byStatus[f.status] = (byStatus[f.status] || 0) + 1;
        if (f.gated && f.status === 'pending') gatedPending += 1;
      }
      return { byKind, byStatus, total: queue.length, gatedPending };
    },
    resolve(id, fields) {
      if (onResolve) onResolve(id, fields);
      const f = queue.find((x) => x.id === id);
      if (!f) return null;
      if (!this.RESOLVE_ACTIONS.includes(fields.action)) return null;
      return { ...f, status: fields.action, action: fields.action };
    },
  };
}

const SAMPLE = [
  { id: 'a1', target: '@bob/post', kind: 'spam', severity: 2, reason: 'flood', reporter: 'alice', evidence: 'lots of links', gated: false, status: 'pending', filedAt: '2026-06-11T10:00:00Z' },
  { id: 'a2', target: '@evil/post', kind: 'csam', severity: 5, reason: 'reported by user', reporter: 'system', evidence: 'GATED(csam): flag-only marker recorded — no imagery stored.', gated: true, status: 'pending', filedAt: '2026-06-11T09:00:00Z' },
  { id: 'a3', target: '@scammer', kind: 'scam', severity: 4, reason: 'phishing', reporter: 'carol', evidence: 'fake giveaway', gated: false, status: 'pending', filedAt: '2026-06-11T11:00:00Z' },
];

// minimal req/res harness
function fakeReq({ url = '/', method = 'GET', body = '' } = {}) {
  const req = new EventEmitter();
  req.url = url; req.method = method;
  // deliver the body on next tick so handler can attach listeners first
  if (method === 'POST') {
    process.nextTick(() => { if (body) req.emit('data', body); req.emit('end'); });
  }
  return req;
}
function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: '',
    writeHead(code, h) { this.statusCode = code; if (h) Object.assign(this.headers, h); return this; },
    end(s) { if (s != null) this.body += s; this.ended = true; return this; },
  };
}

// ── renderReview: ranking ─────────────────────────────────────────────────────────
test('renderReview ranks most-severe first then oldest-first', () => {
  // pass intentionally out-of-order; view must re-sort
  const html = renderReview({ queue: [SAMPLE[0], SAMPLE[1], SAMPLE[2]], summary: makeFakePipe(SAMPLE).summary() });
  const iCsam = html.indexOf('@evil/post');   // sev 5
  const iScam = html.indexOf('@scammer');      // sev 4
  const iSpam = html.indexOf('@bob/post');     // sev 2
  assert.ok(iCsam < iScam, 'severity 5 before 4');
  assert.ok(iScam < iSpam, 'severity 4 before 2');
});

// ── resolve form present per flag ──────────────────────────────────────────────────
test('renderReview includes a resolve form with action select + submit per flag', () => {
  const html = renderReview({ queue: SAMPLE, actions: ['reviewed', 'dismissed', 'actioned', 'escalated'] });
  const forms = html.match(/<form class=resolve method=post action="\/resolve">/g) || [];
  assert.equal(forms.length, SAMPLE.length, 'one form per flag');
  assert.match(html, /<select name=action>/);
  assert.match(html, /<option value="escalated">escalated<\/option>/);
  assert.match(html, /<button type=submit>Resolve<\/button>/);
  // hidden id carried in the form
  assert.match(html, /<input type=hidden name=id value="a1">/);
});

// ── gated CSAM render: marker shown, NO evidence text ──────────────────────────────
test('gated CSAM flag renders gated marker and never shows its evidence', () => {
  const html = renderReview({ queue: SAMPLE });
  assert.match(html, /GATED · CSAM/, 'gated marker shown');
  assert.match(html, /Escalate to counsel \/ NCMEC/, 'escalate note shown');
  // the csam flag's evidence string must NOT appear in output (suppressed at the view)
  assert.ok(!html.includes('flag-only marker recorded'), 'gated evidence text suppressed');
  // non-gated evidence still shows
  assert.match(html, /lots of links/, 'non-gated evidence shown');
  // gated card gets the gated class
  assert.match(html, /class="card gated"/);
});

// ── escaping ────────────────────────────────────────────────────────────────────
test('renderReview escapes hostile content in flag fields', () => {
  const evil = [{
    id: '<b>x</b>', target: '<script>alert(1)</script>', kind: 'spam', severity: 2,
    reason: '"><img src=x onerror=alert(1)>', reporter: "a'b", evidence: '<iframe>', gated: false,
    status: 'pending', filedAt: '2026-06-11T10:00:00Z',
  }];
  const html = renderReview({ queue: evil });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script not present');
  assert.ok(!html.includes('<iframe>'), 'raw iframe not present');
  assert.ok(!html.includes('onerror=alert(1)>'), 'raw onerror img not present');
  assert.match(html, /&lt;script&gt;/, 'target escaped');
  assert.match(html, /&#39;/, 'single quote escaped');
});

test('esc handles null/undefined and all special chars', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

// ── empty queue ────────────────────────────────────────────────────────────────
test('renderReview shows clear-queue message when empty', () => {
  const html = renderReview({ queue: [], summary: { byKind: {}, byStatus: {}, total: 0, gatedPending: 0 } });
  assert.match(html, /No pending flags/);
});

// ── handler GET / renders queue from injected pipe ─────────────────────────────
test('handler GET / serves the queue from the injected flag-pipe', async () => {
  __setFlagPipe(makeFakePipe(SAMPLE));
  const res = fakeRes();
  await handler(fakeReq({ url: '/' }), res);
  __resetFlagPipe();
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Flag review/);
  assert.match(res.body, /@scammer/);
  assert.match(res.body, /GATED · CSAM/);
});

// ── handler POST /resolve calls resolve + redirects (PRG) ──────────────────────
test('handler POST /resolve resolves and redirects with an ok banner', async () => {
  let called = null;
  __setFlagPipe(makeFakePipe(SAMPLE, { onResolve: (id, f) => { called = { id, f }; } }));
  const res = fakeRes();
  await handler(fakeReq({ url: '/resolve', method: 'POST', body: 'id=a3&action=dismissed&note=not+a+scam' }), res);
  __resetFlagPipe();
  assert.equal(res.statusCode, 303, 'redirect-after-post');
  assert.ok(called, 'resolve was called');
  assert.equal(called.id, 'a3');
  assert.equal(called.f.action, 'dismissed');
  assert.equal(called.f.note, 'not a scam');
  assert.match(res.headers.location, /^\/\?/);
  // URLSearchParams encodes spaces as '+'; decode them too for a readable assertion.
  const loc = decodeURIComponent(res.headers.location.replace(/\+/g, ' '));
  assert.match(loc, /resolved as "dismissed"/);
});

test('handler POST /resolve with unknown id redirects with a bad banner', async () => {
  __setFlagPipe(makeFakePipe(SAMPLE));
  const res = fakeRes();
  await handler(fakeReq({ url: '/resolve', method: 'POST', body: 'id=nope&action=dismissed' }), res);
  __resetFlagPipe();
  assert.equal(res.statusCode, 303);
  assert.match(decodeURIComponent(res.headers.location.replace(/\+/g, ' ')), /Could not resolve flag nope/);
});

test('handler POST /resolve with missing id reports nothing resolved', async () => {
  __setFlagPipe(makeFakePipe(SAMPLE));
  const res = fakeRes();
  await handler(fakeReq({ url: '/resolve', method: 'POST', body: 'action=dismissed' }), res);
  __resetFlagPipe();
  assert.equal(res.statusCode, 303);
  assert.match(decodeURIComponent(res.headers.location.replace(/\+/g, ' ')), /No flag id supplied/);
});

// ── banner round-trips from query into the rendered page ────────────────────────
test('handler GET / surfaces a banner from the PRG query', async () => {
  __setFlagPipe(makeFakePipe(SAMPLE));
  const res = fakeRes();
  await handler(fakeReq({ url: '/?b=1&m=' + encodeURIComponent('Flag a3 resolved as "dismissed".') }), res);
  __resetFlagPipe();
  assert.match(res.body, /banner ok/);
  assert.match(res.body, /resolved as &quot;dismissed&quot;/);
});

// ── health + robots ─────────────────────────────────────────────────────────────
test('handler serves /health and noindex /robots.txt', async () => {
  const r1 = fakeRes();
  await handler(fakeReq({ url: '/health' }), r1);
  assert.equal(r1.statusCode, 200);
  assert.equal(r1.body, 'ok');

  const r2 = fakeRes();
  await handler(fakeReq({ url: '/robots.txt' }), r2);
  assert.match(r2.body, /Disallow: \//);
});

// ── soft-fail: a throwing pipe never crashes the handler ────────────────────────
test('handler soft-fails when the injected pipe throws', async () => {
  __setFlagPipe({
    reviewQueue() { throw new Error('boom'); },
    summary() { throw new Error('boom'); },
  });
  const res = fakeRes();
  await handler(fakeReq({ url: '/' }), res);
  __resetFlagPipe();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Flag review/);
  assert.match(res.body, /No pending flags/);
});

// ── unknown path redirects home ──────────────────────────────────────────────────
test('handler redirects unknown paths to /', async () => {
  __setFlagPipe(makeFakePipe(SAMPLE));
  const res = fakeRes();
  await handler(fakeReq({ url: '/whatever' }), res);
  __resetFlagPipe();
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

// ── integration with the REAL flag-pipe (offline, in-memory store) ──────────────
test('handler works against the real flag-pipe module offline', async () => {
  __resetFlagPipe(); // let it import the real module
  const res = fakeRes();
  await handler(fakeReq({ url: '/' }), res);
  // real module, empty in-memory store → clear queue, still a valid page
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Flag review/);
});
