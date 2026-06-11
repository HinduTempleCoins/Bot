// knowledge/cryptocurrency/kb-query.test.mjs
//
// Offline tests for the read-only knowledge-base query helper. No network, no
// disk: the reader seam is injected with in-memory JSON.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadKb,
  topics,
  getTopic,
  search,
  render,
  esc,
  __setReader,
  __resetReader,
  DEFAULT_KB_PATH,
} from './kb-query.mjs';

const SAMPLE = {
  bot_identity: {
    name: 'Van Kush Family Assistant',
    signature: 'Angels and demons? We are cousins, really.',
  },
  crypto: {
    coins: ['Bitcoin', 'Dogecoin'],
    note: 'Steem forked into Hive in 2020.',
  },
  empty_topic: {},
};

function withReader(jsonOrString, fn) {
  __setReader(() =>
    typeof jsonOrString === 'string' ? jsonOrString : JSON.stringify(jsonOrString),
  );
  try {
    return fn();
  } finally {
    __resetReader();
  }
}

test('loadKb returns the parsed object via injected reader', () => {
  withReader(SAMPLE, () => {
    const kb = loadKb('/anything.json');
    assert.equal(kb.bot_identity.name, 'Van Kush Family Assistant');
  });
});

test('loadKb soft-fails to {} on missing file (reader returns null)', () => {
  __setReader(() => null);
  try {
    assert.deepEqual(loadKb('/missing.json'), {});
  } finally {
    __resetReader();
  }
});

test('loadKb soft-fails to {} on malformed JSON', () => {
  withReader('{ this is not json', () => {
    assert.deepEqual(loadKb('/bad.json'), {});
  });
});

test('loadKb soft-fails to {} when root is an array, not an object', () => {
  withReader('[1,2,3]', () => {
    assert.deepEqual(loadKb('/arr.json'), {});
  });
});

test('DEFAULT_KB_PATH points at the synthesis knowledge-base.json', () => {
  assert.match(DEFAULT_KB_PATH, /synthesis\/knowledge-base\.json$/);
});

test('topics lists top-level keys in order', () => {
  assert.deepEqual(topics(SAMPLE), ['bot_identity', 'crypto', 'empty_topic']);
});

test('topics soft-fails to [] for non-object', () => {
  assert.deepEqual(topics(null), []);
  assert.deepEqual(topics([1, 2]), []);
  assert.deepEqual(topics('x'), []);
});

test('getTopic returns the stored value, exact and case-insensitive', () => {
  assert.equal(getTopic(SAMPLE, 'bot_identity').name, 'Van Kush Family Assistant');
  assert.equal(getTopic(SAMPLE, 'BOT_IDENTITY').name, 'Van Kush Family Assistant');
  assert.equal(getTopic(SAMPLE, '  crypto  ').note, 'Steem forked into Hive in 2020.');
});

test('getTopic soft-fails to null for unknown / empty / bad kb', () => {
  assert.equal(getTopic(SAMPLE, 'nope'), null);
  assert.equal(getTopic(SAMPLE, ''), null);
  assert.equal(getTopic(SAMPLE, null), null);
  assert.equal(getTopic(null, 'crypto'), null);
});

test('search finds substring matches across nested strings with dotted paths', () => {
  const r = search(SAMPLE, 'hive');
  assert.equal(r.length, 1);
  assert.equal(r[0].path, 'crypto.note');
  assert.match(r[0].snippet, /Hive/);
});

test('search indexes into arrays', () => {
  const r = search(SAMPLE, 'dogecoin');
  assert.equal(r.length, 1);
  assert.equal(r[0].path, 'crypto.coins[1]');
  assert.equal(r[0].snippet, 'Dogecoin');
});

test('search is case-insensitive and can match multiple values', () => {
  const r = search(SAMPLE, 'van kush');
  assert.ok(r.length >= 1);
  assert.ok(r.every((x) => typeof x.path === 'string' && typeof x.snippet === 'string'));
});

test('search soft-fails to [] for empty term / null / non-object kb', () => {
  assert.deepEqual(search(SAMPLE, ''), []);
  assert.deepEqual(search(SAMPLE, null), []);
  assert.deepEqual(search(null, 'x'), []);
});

test('search does not mutate the source object', () => {
  const before = JSON.stringify(SAMPLE);
  search(SAMPLE, 'bitcoin');
  assert.equal(JSON.stringify(SAMPLE), before);
});

test('render plain text lists path: snippet lines', () => {
  const r = search(SAMPLE, 'hive');
  const text = render(r);
  assert.equal(text, 'crypto.note: Steem forked into Hive in 2020.');
});

test('render html escapes interpolated values and wraps in a list', () => {
  const results = [{ path: 'a.b', snippet: '<script>"x"</script>' }];
  const html = render(results, { html: true });
  assert.match(html, /<ul class="kb-results">/);
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes('<script>'));
});

test('render soft-fails on empty / non-array input', () => {
  assert.equal(render([]), '');
  assert.equal(render(null), '');
  assert.equal(render(undefined, { html: true }), '<ul class="kb-results"></ul>');
});

test('esc escapes the five HTML-sensitive characters', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});
