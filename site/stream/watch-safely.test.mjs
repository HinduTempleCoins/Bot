import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchSafelyBody, LEGAL_FREE, RISKS } from './watch-safely.mjs';

test('watch-free-safely: says what SoapBox Stream is, lists legal services, explains risks, names no pirate site', () => {
  const h = watchSafelyBody();
  assert.match(h, /Everything that plays here is free to use/);
  assert.match(h, /Netflix, Hulu or Tubi/);
  for (const s of LEGAL_FREE) assert.ok(h.includes(s.name.replace(/'/g, '&#39;').replace(/&(?!#)/g, '&amp;')) || h.includes(s.name), s.name);
  assert.ok(RISKS.length >= 8);
  assert.match(h, /Never install anything to watch a video/);
  assert.ok(LEGAL_FREE.every((s) => /^https:\/\//.test(s.url)));
  assert.doesNotMatch(h, /putlocker|123movies|fmovies|soap2day|gomovies|solarmovie/i); // no pirate brands named
});
