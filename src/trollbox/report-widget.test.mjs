// report-widget.test.mjs — OFFLINE tests for the condenser report/flag widget (task #300).
// No network, no DOM: fetch is injected (__setFetch) and a tiny fake document/element drives the
// browser-wiring path. Soft-fail behavior is asserted.
//
//   node --test src/trollbox/report-widget.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esc, REPORT_KINDS, submitReport, reportFormHtml, mountReportWidget, __setFetch, __setBase,
} from './report-widget.mjs';

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<b>"x"&\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;&lt;/b&gt;');
});

test('reportFormHtml renders one option per kind and escapes the target', () => {
  const html = reportFormHtml({ target: '@a/<script>' });
  for (const k of REPORT_KINDS) assert.match(html, new RegExp(`value="${k}"`));
  assert.match(html, /&lt;script&gt;/); // target escaped, not raw
  assert.match(html, /does not remove the post/); // honest UX note present
});

test('submitReport POSTs the report and returns the server JSON', async () => {
  let captured = null;
  __setBase('');
  __setFetch(async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body), method: opts.method };
    return { json: async () => ({ ok: true, id: 'mod_1', status: 'open', deduped: false, message: 'Thanks' }) };
  });
  const res = await submitReport({ target: '@alice/post', kind: 'spam', reason: 'bot', reporter: 'bob' });
  assert.equal(res.ok, true);
  assert.equal(res.id, 'mod_1');
  assert.equal(captured.method, 'POST');
  assert.match(captured.url, /\/api\/report$/);
  assert.deepEqual(captured.body, { target: '@alice/post', kind: 'spam', reason: 'bot', reporter: 'bob' });
});

test('submitReport rejects a missing target without calling fetch', async () => {
  let called = false;
  __setFetch(async () => { called = true; return { json: async () => ({}) }; });
  const res = await submitReport({ kind: 'spam' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'missing-target');
  assert.equal(called, false);
});

test('submitReport soft-fails (no throw) when the endpoint is unreachable', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const res = await submitReport({ target: '@a/p', kind: 'spam' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unreachable');
});

// ── tiny fake DOM to exercise mountReportWidget ────────────────────────────────────────────────────
function fakeEl(tag = 'div') {
  const listeners = {};
  const el = {
    tagName: tag, innerHTML: '', textContent: '', value: '', disabled: false,
    _children: [],
    addEventListener(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
    async _fire(ev, e) { for (const cb of listeners[ev] || []) await cb(e); },
    querySelector(sel) { return el._byClass[sel] || null; },
    _byClass: {},
  };
  return el;
}

function fakeRoot({ kind = 'spam', reason = '' } = {}) {
  const root = fakeEl();
  const form = fakeEl('form');
  const result = fakeEl();
  const submit = fakeEl('button');
  const cancel = fakeEl('button');
  const kindSel = fakeEl('select'); kindSel.value = kind;
  const reasonTa = fakeEl('textarea'); reasonTa.value = reason;
  root._byClass = {
    '.report-form': form, '.report-result': result, '.report-submit': submit,
    '.report-cancel': cancel, '.report-kind': kindSel, '.report-reason': reasonTa,
  };
  // The form looks up the same children.
  form.querySelector = root.querySelector.bind(root);
  root.querySelector = (sel) => root._byClass[sel] || null;
  return { root, form, result, submit, cancel };
}

test('mountReportWidget refuses to wire without a target', () => {
  const { root } = fakeRoot();
  assert.equal(mountReportWidget(root, { doc: {} }), false);
});

test('mountReportWidget submit path posts the chosen kind/reason and shows the result', async () => {
  let body = null;
  __setFetch(async (_url, opts) => { body = JSON.parse(opts.body); return { json: async () => ({ ok: true, deduped: false, message: 'Sent for review' }) }; });
  const { root, form, result, submit } = fakeRoot({ kind: 'scam', reason: 'fake giveaway' });
  // mountReportWidget overwrites innerHTML then reads children via querySelector — point it at our fakes.
  const ok = mountReportWidget(root, { target: '@a/p', reporter: 'bob', doc: { } });
  assert.equal(ok, true);
  await form._fire('submit', { preventDefault() {} });
  assert.deepEqual(body, { target: '@a/p', kind: 'scam', reason: 'fake giveaway', reporter: 'bob' });
  assert.equal(result.textContent, 'Sent for review');
  assert.equal(submit.disabled, true);
});

test('mountReportWidget shows a friendly message on rate-limit and re-enables submit', async () => {
  __setFetch(async () => ({ json: async () => ({ ok: false, reason: 'rate-limited' }) }));
  const { root, form, result, submit } = fakeRoot();
  mountReportWidget(root, { target: '@a/p', doc: {} });
  await form._fire('submit', { preventDefault() {} });
  assert.match(result.textContent, /reporting a little fast/);
  assert.equal(submit.disabled, false); // re-enabled so they can retry
});
