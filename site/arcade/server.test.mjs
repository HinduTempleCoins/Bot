// server.test.mjs — GTArcade hub. OFFLINE. The page always renders; boards are graceful without a reader.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, loadGames } from './server.mjs';

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}
const req = (path) => ({ url: path, method: 'GET' });
const j = (o) => JSON.parse(o.body);

test('GET / serves the GTArcade hub with the Seed + Farming games + Alpha badge', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /GT<\/b>Arcade/);
  assert.match(o.body, /Alpha/);                       // standing alpha-badge convention
  assert.match(o.body, /Seed Raffle/);                 // the seed game / casino
  assert.match(o.body, /Kush Farm/);                   // the farming game (Pot-Farm style)
  assert.match(o.body, /Coming soon/);                 // extensible — other games later
});

test('/api/games lists the registry', async () => {
  const { res, o } = cap(); await handler(req('/api/games'), res);
  assert.equal(o.code, 200);
  const ids = j(o).games.map((g) => g.id);
  assert.ok(ids.includes('seed-raffle')); assert.ok(ids.includes('kush-farm'));
});

test('/api/board: a board game returns a season + (graceful) empty top without a reader', async () => {
  const board = loadGames().find((g) => g.gameId);
  const { res, o } = cap(); await handler(req('/api/board?game=' + board.id), res);
  assert.equal(o.code, 200);
  assert.equal(j(o).ok, true);
  assert.equal(typeof j(o).season, 'number');
  assert.deepEqual(j(o).top, []);                      // no reader wired → empty, never throws
});

test('/api/board 404s a non-board game; unknown path 404', async () => {
  let { res, o } = cap(); await handler(req('/api/board?game=seed-raffle'), res);
  assert.equal(o.code, 404);
  ({ res, o } = cap()); await handler(req('/nope'), res);
  assert.equal(o.code, 404);
});

test('the default page ships no real infra host', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.doesNotMatch(o.body, /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);   // no raw IPs
});
