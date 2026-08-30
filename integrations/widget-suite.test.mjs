// widget-suite.test.mjs — offline tests for the Soapy.Blog embeddable widget suite. Pure functions +
// a thin auth-gated handler; no network, no disk, no env required.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WIDGETS, CATEGORIES, listWidgets, getWidget, embedSnippet, loaderScript,
  catalogJson, catalogPage, handler, __setAuth, esc,
} from './widget-suite.mjs';

// tiny mock res
function mockRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(c, h) { this.code = c; this.headers = h; },
    end(b) { this.body = b == null ? '' : String(b); },
  };
}

test('catalog: every widget has the required typed fields', () => {
  assert.ok(WIDGETS.length >= 3);
  for (const w of WIDGETS) {
    for (const k of ['id', 'name', 'tagline', 'category', 'mount', 'asset', 'source']) {
      assert.ok(w[k], `${w.id} missing ${k}`);
    }
    assert.ok(['script', 'module', 'iframe'].includes(w.mount), `${w.id} bad mount`);
  }
  // ids unique
  const ids = WIDGETS.map((w) => w.id);
  assert.equal(ids.length, new Set(ids).size);
});

test('CATEGORIES is the deduped set of widget categories', () => {
  for (const w of WIDGETS) assert.ok(CATEGORIES.includes(w.category));
});

test('listWidgets filters by category and returns copies', () => {
  const all = listWidgets();
  assert.equal(all.length, WIDGETS.length);
  const ai = listWidgets({ category: 'ai' });
  assert.ok(ai.every((w) => w.category === 'ai'));
  assert.equal(listWidgets({ category: 'nope' }).length, 0);
  // mutating a returned config must not touch the frozen source
  const one = listWidgets({ category: 'ai' })[0];
  if (one.exampleConfig) { one.exampleConfig.mode = 'HACKED'; }
  assert.notEqual(getWidget(one.id).exampleConfig?.mode, 'HACKED');
});

test('getWidget returns a descriptor or null', () => {
  assert.equal(getWidget('hathor-chat').id, 'hathor-chat');
  assert.equal(getWidget('does-not-exist'), null);
  assert.equal(getWidget(null), null);
});

test('embedSnippet: script/module widget carries origin + type', () => {
  const s = embedSnippet('hathor-chat', { origin: 'https://example.test' });
  assert.match(s, /type="module"/);
  assert.match(s, /https:\/\/example\.test\/widgets\/hathor-widget\.mjs/);
  // its window-global config is present and escaped
  assert.match(s, /window\.__HATHOR_WIDGET/);
});

test('embedSnippet: iframe widget yields an <iframe>', () => {
  const s = embedSnippet('ad-maker', { origin: 'https://x.test' });
  assert.match(s, /^<iframe /);
  assert.match(s, /src="https:\/\/x\.test\/ads\/"/);
});

test('embedSnippet: unknown id → empty string; never throws', () => {
  assert.equal(embedSnippet('nope'), '');
  assert.doesNotThrow(() => embedSnippet(null));
});

test('embedSnippet: a config value containing </script> cannot break out of the tag', () => {
  const s = embedSnippet('hathor-chat', { config: { endpoint: '</script><script>alert(1)</script>' } });
  // the raw closing tag sequence must not appear literally inside the emitted config script
  assert.ok(!s.includes('</script><script>alert(1)'));
  assert.match(s, /\\u003c\/script/);
});

test('loaderScript: self-contained, idempotent-guarded, bakes catalog + origin', () => {
  const js = loaderScript({ origin: 'https://soapy.test' });
  assert.match(js, /__soapyWidgetsLoaded/);
  assert.match(js, /https:\/\/soapy\.test/);
  assert.match(js, /data-widgets/);
  // the alias map is present so "chat" resolves to hathor-chat
  assert.match(js, /hathor-chat/);
  assert.ok(!js.includes('</script'), 'loader must not contain a raw </script>');
});

test('catalogJson: origin + categories + per-widget snippet', () => {
  const j = catalogJson({ origin: 'https://o.test' });
  assert.equal(j.origin, 'https://o.test');
  assert.deepEqual(j.categories, CATEGORIES);
  assert.equal(j.widgets.length, WIDGETS.length);
  assert.ok(j.widgets[0].snippet.length > 0);
});

test('catalogPage: renders a card per widget with an Alpha badge, all escaped', () => {
  const html = catalogPage({ origin: 'https://o.test' });
  assert.match(html, /Alpha/);
  for (const w of WIDGETS) assert.ok(html.includes(esc(w.name)));
  assert.match(html, /loader\.js/);
});

test('handler: default-deny (no auth) → 401', async () => {
  __setAuth(() => false);
  const res = mockRes();
  await handler({ url: '/widgets', method: 'GET' }, res);
  assert.equal(res.code, 401);
});

test('handler: authed serves gallery, loader.js, catalog.json', async () => {
  __setAuth(() => true);
  let res = mockRes();
  await handler({ url: '/widgets', method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.match(res.headers['Content-Type'], /text\/html/);

  res = mockRes();
  await handler({ url: '/widgets/loader.js', method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.match(res.headers['Content-Type'], /javascript/);

  res = mockRes();
  await handler({ url: '/widgets/catalog.json', method: 'GET' }, res);
  assert.equal(res.code, 200);
  const parsed = JSON.parse(res.body);
  assert.ok(Array.isArray(parsed.widgets));

  res = mockRes();
  await handler({ url: '/widgets/unknown', method: 'GET' }, res);
  assert.equal(res.code, 404);
  __setAuth(() => false); // restore fail-closed for other test files
});
