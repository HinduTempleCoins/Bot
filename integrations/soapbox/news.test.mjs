import { test } from 'node:test';
import assert from 'node:assert';
import { dedupCap, LIVE_STREAMS } from './news.mjs';

test('dedupCap removes normalized-duplicate titles and caps length', () => {
  const items = [
    { title: 'Bitcoin ETF approved' },
    { title: 'bitcoin etf approved!!' }, // dup (normalized)
    { title: 'Ethereum upgrade ships' },
    { title: 'War escalates in region' },
  ];
  const out = dedupCap(items, 2);
  assert.equal(out.length, 2, 'capped');
  assert.equal(out[0].title, 'Bitcoin ETF approved');
  assert.equal(out[1].title, 'Ethereum upgrade ships', 'the dup was skipped, not kept');
});

test('dedupCap drops empty/falsy titles', () => {
  const out = dedupCap([{ title: '' }, null, { title: 'Real story' }], 10);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Real story');
});

test('LIVE_STREAMS are link-out /live URLs (no broken embeds)', () => {
  assert.ok(LIVE_STREAMS.length >= 6);
  for (const s of LIVE_STREAMS) {
    assert.ok(s.name);
    assert.match(s.url, /^https:\/\/www\.youtube\.com\/@.+\/live$/);
  }
});
