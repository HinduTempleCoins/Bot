// search-widget.test.mjs — offline tests for the post widget/link generator. Pure string builders,
// no network. Proves: URL building + scoping, BBCode/Markdown/HTML forms, escaping, and the kit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  searchUrl, bbcodeLink, bbcodeBox, markdownLink, markdownBox, htmlLink, htmlBox,
  PRESETS, preset, widgetKit, esc,
} from './search-widget.mjs';

test('searchUrl builds front-door URLs with q/mode/scope, all encoded', () => {
  assert.equal(searchUrl({}), 'https://search.soapbox.community/?mode=site');
  const u = new URL(searchUrl({ q: 'privacy law', mode: 'site', scope: 'law' }));
  assert.equal(u.origin + u.pathname, 'https://search.soapbox.community/');
  assert.equal(u.searchParams.get('q'), 'privacy law');
  assert.equal(u.searchParams.get('mode'), 'site');
  assert.equal(u.searchParams.get('scope'), 'law');
  // web mode
  assert.equal(new URL(searchUrl({ q: 'x', mode: 'web' })).searchParams.get('mode'), 'web');
});

test('bbcodeLink + bbcodeBox render BBCode with pre-scoped doorways', () => {
  const link = bbcodeLink({ text: 'Search us', q: 'hemp', scope: 'hemp' });
  assert.ok(link.startsWith('[url=https://search.soapbox.community/'));
  assert.ok(link.includes('[/url]'));
  assert.ok(link.includes('Search us'));
  const box = bbcodeBox({});
  assert.ok(box.includes('[list]') && box.includes('[/list]'));
  assert.ok(box.includes('Search our legal corpus'));
  assert.ok(box.includes('scope=law'));
});

test('markdown variants render links', () => {
  assert.equal(
    markdownLink({ text: 'Search', q: 'a' }).slice(0, 9), '[Search](',
  );
  const box = markdownBox({});
  assert.ok(box.includes('- ['));
  assert.ok(box.includes('search.soapbox.community'));
});

test('htmlBox is a GET form to the front door, with scope + mode as hidden fields', () => {
  const f = htmlBox({ scope: 'law', mode: 'site' });
  assert.ok(f.startsWith('<form'));
  assert.ok(f.includes('method="get"'));
  assert.ok(f.includes('action="https://search.soapbox.community/"'));
  assert.ok(f.includes('name="q"'));
  assert.ok(f.includes('name="mode" value="site"'));
  assert.ok(f.includes('name="scope" value="law"'));
  assert.ok(f.includes('<button'));
  // no scope → no scope hidden field
  assert.ok(!htmlBox({}).includes('name="scope"'));
});

test('htmlLink renders an anchor', () => {
  const a = htmlLink({ text: 'Go', q: 'x' });
  assert.ok(a.startsWith('<a href="https://search.soapbox.community/'));
  assert.ok(a.endsWith('</a>'));
  assert.ok(a.includes('>Go<'));
});

test('esc neutralizes HTML/quotes; a hostile label/base cannot break the form', () => {
  assert.equal(esc('<b>"&\'</b>'), '&lt;b&gt;&quot;&amp;&#39;&lt;/b&gt;');
  const f = htmlBox({ base: 'https://search.soapbox.community', placeholder: '"><script>x</script>' });
  assert.ok(!f.includes('<script>'), 'no raw script survives');
});

test('PRESETS include the legal-corpus doorway; preset() looks up by key', () => {
  assert.ok(PRESETS.some((p) => p.scope === 'law' && /legal/i.test(p.label)));
  assert.equal(preset('law').scope, 'law');
  assert.equal(preset('nope'), null);
});

test('widgetKit returns every format at once with resolved preset URLs', () => {
  const kit = widgetKit({});
  for (const key of ['url', 'bbcodeLink', 'bbcodeBox', 'markdownLink', 'markdownBox', 'htmlLink', 'htmlBox', 'presets']) {
    assert.ok(kit[key] != null, `${key} present`);
  }
  assert.ok(Array.isArray(kit.presets) && kit.presets.every((p) => typeof p.url === 'string' && p.url.startsWith('http')));
});
