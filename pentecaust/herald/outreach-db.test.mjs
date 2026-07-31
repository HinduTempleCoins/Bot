// pentecaust/herald/outreach-db.test.mjs — offline tests for the Herald backlink/outreach DB + dashboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addRow, getRow, updateRow, allRows, importRows, totals, handler, __setAuth,
} from './outreach-db.mjs';

// In-memory fs so no disk/network is touched; one store per test.
function memfs() {
  const mem = { data: null };
  return {
    fs: { read: () => mem.data, write: (_p, s) => { mem.data = s; } },
    file: '/mem/outreach.json',
  };
}
// Minimal fake res that captures the response.
function fakeRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(c, h) { this.code = c; this.headers = h; return this; },
    end(b) { this.body = b == null ? '' : String(b); return this; },
  };
}

test('addRow / getRow / updateRow round-trip', () => {
  const o = { ...memfs(), now: 1000 };
  const a = addRow({ site: 'permies.com', category: 'Forum', status: 'planned' }, o);
  assert.equal(a.ok, true);
  const got = getRow(a.row.id, o);
  assert.equal(got.site, 'permies.com');
  const up = updateRow(a.row.id, { status: 'link_live', liveLinkUrl: 'https://permies.com/t/1' }, o);
  assert.equal(up.ok, true);
  assert.equal(getRow(a.row.id, o).status, 'link_live');
  // bad status is normalised back to a safe default, never stored raw
  const up2 = updateRow(a.row.id, { status: 'HACKED' }, o);
  assert.equal(up2.row.status, 'planned');
});

test('importRows bulk + totals counts', () => {
  const o = { ...memfs(), now: 2000 };
  const r = importRows([
    { site: 'a', category: 'Forum', status: 'planned', assignedTo: 'ryan' },
    { site: 'b', category: 'Wiki', status: 'link_live', assignedTo: 'kali' },
    { site: 'c', category: 'Forum', status: 'link_live', assignedTo: 'ryan' },
  ], o);
  assert.equal(r.ok, true);
  assert.equal(r.added, 3);
  const t = totals(o);
  assert.equal(t.total, 3);
  assert.equal(t.byStatus.link_live, 2);
  assert.equal(t.byStatus.planned, 1);
  assert.equal(t.byCategory.Forum, 2);
  assert.equal(t.byAssignee.ryan, 2);
});

test('handler GET /outreach: 401 unauthed, 200 authed with escaped notes', async () => {
  const o = { ...memfs(), now: 3000 };
  addRow({ site: 'evil.example', notes: '<script>alert(1)</script>' }, o);

  __setAuth(() => false);
  const r1 = fakeRes();
  await handler({ method: 'GET', url: '/outreach' }, r1, o);
  assert.equal(r1.code, 401);

  __setAuth(() => true);
  const r2 = fakeRes();
  await handler({ method: 'GET', url: '/outreach' }, r2, o);
  assert.equal(r2.code, 200);
  assert.ok(r2.body.includes('evil.example'), 'renders the row');
  assert.ok(!r2.body.includes('<script>alert(1)</script>'), 'raw script not present');
  assert.ok(r2.body.includes('&lt;script&gt;'), 'notes are HTML-escaped');
  __setAuth(() => false);
});

test('handler POST /outreach/update persists a status change', async () => {
  const o = { ...memfs(), now: 4000 };
  const a = addRow({ site: 's', status: 'planned' }, o);
  __setAuth(() => true);
  const res = fakeRes();
  await handler({ method: 'POST', url: '/outreach/update', body: { id: a.row.id, status: 'verified_dofollow' } }, res, o);
  assert.equal(res.code, 200);
  assert.equal(getRow(a.row.id, o).status, 'verified_dofollow');
  __setAuth(() => false);
});
