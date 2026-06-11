// server.test.mjs — offline tests for the Private Mail mailbox page. No network, no keys.
// Asserts inbox + outbox render, HTML is escaped, and the empty state renders cleanly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, renderMailbox, esc, __setReader } from './server.mjs';

// minimal mock res that captures status + body
function mockRes() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers || {};
    },
    end(chunk) {
      this.body = chunk == null ? '' : String(chunk);
    },
  };
}

const FAKE = {
  inbox: [
    { from: 'admin1', to: 'hathor', ts: '2026-06-11T10:00:00Z', id: 'm_in1', subject: 'Hello there', body: 'Inbox body one' },
    { from: 'admin2', to: 'hathor', ts: '2026-06-10T09:00:00Z', id: 'm_in2', subject: '', body: '' },
  ],
  outbox: [
    { from: 'hathor', to: 'admin1', ts: '2026-06-11T11:00:00Z', id: 'm_out1', subject: 'Reply <subject>', body: 'Outbox & "danger"' },
  ],
};

test('esc() escapes all five HTML-significant characters', () => {
  assert.equal(esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('renderMailbox is pure and renders inbox + outbox messages', () => {
  const html = renderMailbox({ account: 'hathor', inbox: FAKE.inbox, outbox: FAKE.outbox });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Mailbox: hathor/);
  // inbox subject + body present
  assert.ok(html.includes('Hello there'));
  assert.ok(html.includes('Inbox body one'));
  // outbox subject + body present
  assert.ok(html.includes('Outbox &amp; &quot;danger&quot;'));
  // counts shown
  assert.match(html, /Inbox <span class="muted">\(2\)/);
  assert.match(html, /Outbox <span class="muted">\(1\)/);
  // determinism: same input -> same output
  assert.equal(html, renderMailbox({ account: 'hathor', inbox: FAKE.inbox, outbox: FAKE.outbox }));
});

test('renderMailbox escapes dangerous subject/body — no raw injection', () => {
  const html = renderMailbox({
    account: '<script>',
    inbox: [{ from: 'x', to: 'y', ts: 't', id: 'i', subject: '<img src=x onerror=alert(1)>', body: '</div><script>bad()</script>' }],
    outbox: [],
  });
  assert.ok(!html.includes('<script>bad()'));
  assert.ok(!html.includes('<img src=x onerror'));
  assert.ok(html.includes('&lt;img src=x onerror'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderMailbox empty state renders "No messages." for both boxes', () => {
  const html = renderMailbox({ account: 'nobody', inbox: [], outbox: [] });
  const matches = html.match(/No messages\./g) || [];
  assert.equal(matches.length, 2);
  assert.match(html, /Mailbox: nobody/);
});

test('renderMailbox handles missing/garbage input softly', () => {
  assert.doesNotThrow(() => renderMailbox());
  assert.doesNotThrow(() => renderMailbox({}));
  const html = renderMailbox({ account: null, inbox: 'notarray', outbox: undefined });
  assert.match(html, /No messages\./);
});

test('handler GET / renders the injected reader mailbox', async () => {
  __setReader(async (account) => {
    assert.equal(account, 'hathor');
    return { inbox: FAKE.inbox, outbox: FAKE.outbox };
  });
  const res = mockRes();
  await handler({ url: '/?account=hathor' }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.body.includes('Hello there'));
  assert.ok(res.body.includes('Outbox &amp; &quot;danger&quot;'));
  __setReader(null);
});

test('handler GET / with no messages renders empty mailbox, never throws', async () => {
  __setReader(async () => ({ inbox: [], outbox: [] }));
  const res = mockRes();
  await handler({ url: '/' }, res);
  assert.equal(res.statusCode, 200);
  const matches = res.body.match(/No messages\./g) || [];
  assert.equal(matches.length, 2);
  __setReader(null);
});

test('handler soft-fails when the reader throws — still 200 + valid HTML', async () => {
  __setReader(async () => {
    throw new Error('reader boom');
  });
  const res = mockRes();
  await handler({ url: '/?account=hathor' }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<!doctype html>/i);
  assert.match(res.body, /No messages\./);
  __setReader(null);
});

test('handler /health returns ok json', async () => {
  const res = mockRes();
  await handler({ url: '/health' }, res);
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.service, 'mail');
});

test('handler unknown path returns 404 with valid HTML', async () => {
  const res = mockRes();
  await handler({ url: '/nope' }, res);
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /<!doctype html>/i);
});

test('reader can hand a flat messages list — split via envelope filters', async () => {
  __setReader(async () => ({
    messages: [
      { from: 'admin1', to: 'hathor', ts: '2026-06-11T10:00:00Z', id: 'a', subject: 'to me', body: 'b1' },
      { from: 'hathor', to: 'admin1', ts: '2026-06-11T11:00:00Z', id: 'b', subject: 'from me', body: 'b2' },
      { from: 'admin2', to: 'someoneelse', ts: '2026-06-11T12:00:00Z', id: 'c', subject: 'not mine', body: 'b3' },
    ],
  }));
  const res = mockRes();
  await handler({ url: '/?account=hathor' }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('to me')); // inbox
  assert.ok(res.body.includes('from me')); // outbox
  assert.ok(!res.body.includes('not mine')); // filtered out
  __setReader(null);
});
