import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embed, verify, mapdir } from './face-identity.mjs';

test('face-identity soft-fails (never throws) when the python core is unavailable', async () => {
  process.env.IDENTITY_PY = '/nonexistent/python';
  const e = await embed('/tmp/none.jpg');
  const v = await verify('/tmp/a.jpg', '/tmp/b.jpg');
  const m = await mapdir('/tmp');
  for (const r of [e, v, m]) assert.equal(r.ok, false);
  delete process.env.IDENTITY_PY;
});
