// leaderboard.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaderboardRows, leaderboardPage, handler, esc } from './leaderboard.mjs';
import { makeMemoryStore } from './index.mjs';

function seeded() {
  const s = makeMemoryStore();
  // append-only karma entries (account, points)
  s.append({ account: 'alice', points: 30 });
  s.append({ account: 'bob', points: 50 });
  s.append({ account: 'alice', points: 15 }); // alice total 45
  s.append({ account: 'carol', points: 10 });
  return s;
}

test('leaderboardRows ranks accounts by summed karma, top-first', async () => {
  const rows = await leaderboardRows(seeded(), { limit: 10 });
  assert.equal(rows[0].account, 'bob');   // 50
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].account, 'alice'); // 45
  assert.equal(rows[2].account, 'carol'); // 10
  assert.equal(rows.length, 3);
});

test('leaderboardPage lists accounts linking to their profiles; empty state when no data', async () => {
  const rows = await leaderboardRows(seeded());
  const page = leaderboardPage(rows);
  assert.match(page, /@bob/);
  assert.match(page, /href="https:\/\/melek\.salon\/@bob"/);  // profile link
  assert.match(page, /class=badge>Alpha/);
  const empty = leaderboardPage([]);
  assert.match(empty, /board is empty|No one has been graded/i);
  assert.doesNotMatch(empty, /<ol/);   // no board rendered when empty
});

test('page escapes account names (no injection)', () => {
  const page = leaderboardPage([{ rank: 1, account: 'a<b>"x', score: 5 }]);
  assert.doesNotMatch(page, /<b>/);
  assert.match(page, /a&lt;b&gt;/);
});

test('handler serves the page, the JSON, and health; 404 else', async () => {
  const store = seeded();
  function res() { return { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = b || ''; } }; }
  let r = res(); await handler({ url: '/', headers: {} }, r, { store });
  assert.equal(r.code, 200); assert.match(r.body, /@bob/);
  r = res(); await handler({ url: '/api/leaderboard', headers: {} }, r, { store });
  assert.equal(r.code, 200); const j = JSON.parse(r.body); assert.equal(j.rows[0].account, 'bob'); assert.equal(j.count, 3);
  r = res(); await handler({ url: '/health', headers: {} }, r, { store });
  assert.equal(r.code, 200);
  r = res(); await handler({ url: '/nope', headers: {} }, r, { store });
  assert.equal(r.code, 404);
});
