// server.test.mjs — Kush Farm page. OFFLINE. Server-renders from the kush-farm model; deterministic.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler } from './server.mjs';

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}
const req = (path) => ({ url: path });
const j = (o) => JSON.parse(o.body);

test('GET / renders the Kush Farm page with the live season, tiers + a strain', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /Kush<\/b> Farm/);
  assert.match(o.body, /Alpha/);
  assert.match(o.body, /Van Kush/);                 // a strain renders
  assert.match(o.body, /Daily|Weekly|Yearly/);      // the grow tiers
  assert.match(o.body, /KULA/);                      // yields shown
});

test('/api/catalog returns the live season + strains + plantable-now', async () => {
  const { res, o } = cap(); await handler(req('/api/catalog'), res);
  assert.equal(o.code, 200);
  const c = j(o);
  assert.equal(c.ok, true);
  assert.ok(['spring', 'summer', 'autumn', 'winter'].includes(c.season));
  assert.ok(Array.isArray(c.strains) && c.strains.length >= 10);
  assert.ok(Array.isArray(c.plantableNow));
});

test('/health ok; unknown path 404', async () => {
  let { res, o } = cap(); await handler(req('/health'), res);
  assert.equal(o.code, 200); assert.equal(j(o).ok, true);
  ({ res, o } = cap()); await handler(req('/nope'), res);
  assert.equal(o.code, 404);
});
