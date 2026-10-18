// build.test.mjs — OFFLINE: CSV parsing, who is listed, the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, holderRows, renderPage } from './build.mjs';

test('parses quoted CSV and lists real holders only', () => {
  const recs = parseCsv('account,vkbt,cure,steem_exists,blurt_exists,exclude_reason\nalice,1000,2,True,False,\nkalivankush,9,9,False,True,operator/issuer\nbotx,5,0,False,False,name looks like a bot\nzero,0,0,True,True,\n"q,uote",1,0,False,False,\n');
  const rows = holderRows(recs);
  assert.deepEqual(rows.map((r) => r[0]), ['alice', 'botx', 'q,uote']);
  assert.deepEqual(rows[0], ['alice', 1000, 2, 1, 0]);
});

test('page escapes names and links each wallet', () => {
  const html = renderPage([['a<b', 1, 0, 0, 0]], { asOf: '2026-10-18' });
  assert.match(html, /1 accounts as of 2026-10-18/);
  assert.ok(!html.includes('<td>a<b'));
  assert.match(html, /he\.dtools\.dev\/@/);
});
