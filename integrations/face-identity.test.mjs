import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { embed, verify, mapdir } from './face-identity.mjs';

// Works whether or not insightface is installed: non-face/empty inputs → ok:false, and a missing
// python core makes call() catch and also return ok:false. Either way, never throws.
test('embed/verify/mapdir return ok:false for non-face / empty inputs, never throw', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idt-'));
  fs.writeFileSync(path.join(tmp, 'notimg.jpg'), 'not an image');
  const e = await embed(path.join(tmp, 'notimg.jpg'));
  const v = await verify(path.join(tmp, 'notimg.jpg'), path.join(tmp, 'notimg.jpg'));
  const m = await mapdir(tmp); // no real faces in this fresh dir
  for (const r of [e, v, m]) { assert.equal(typeof r.ok, 'boolean'); assert.equal(r.ok, false); }
  fs.rmSync(tmp, { recursive: true, force: true });
});
