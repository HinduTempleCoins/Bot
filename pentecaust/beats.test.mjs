import { test } from 'node:test';
import assert from 'node:assert';
import { beatsPage, PRESETS, METERS, ROWS } from './beats.mjs';

test('every preset uses a known meter and fits its step count', () => {
  for (const [name, p] of Object.entries(PRESETS)) {
    assert.ok(METERS[p.meter], name);
    for (const [row, str] of Object.entries(p.rows)) {
      assert.ok(ROWS.some((r) => r.id === row), `${name}: ${row}`);
      assert.equal(str.length, METERS[p.meter], `${name}: ${row} length`);
    }
  }
});

test('the beat maker page has the grid, a metronome click, share and WAV export, and a Tools link', () => {
  const h = beatsPage();
  assert.match(h, /id=grid/);
  assert.match(h, /id=click type=checkbox/);
  assert.match(h, /id=share/);
  assert.match(h, /id=wav/);
  assert.match(h, /tools\.soapbox\.community/);
  const js = h.split('<script>')[1].split('</script>')[0];
  assert.doesNotThrow(() => new Function(js));
});
