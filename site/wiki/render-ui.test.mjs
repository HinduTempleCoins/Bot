// render-ui.test.mjs — the house-style redesign (render.mjs): table of contents, heading anchors,
// breadcrumbs, active nav, the two-column TOC shell, dark-mode tokens, and the theme toggle. Pure
// functions, fully offline. Guards the invariant that the redesign must NOT change the <hN>text</hN>
// byte-shape the renderer/tests already depend on.
// Run: node --test site/wiki/render-ui.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWiki, layout, tocAside, anchorId } from './render.mjs';

test('anchorId slugifies a heading to a safe #fragment', () => {
  assert.equal(anchorId('Consensus and parameters'), 'consensus-and-parameters');
  assert.equal(anchorId('APIS — the fee token!'), 'apis-the-fee-token');
  assert.equal(anchorId(''), 'section');
  assert.equal(anchorId('<b>x</b>'), 'x');
});

test('renderWiki returns a toc of h2/h3 with ids, and keeps <hN>text</hN> intact', () => {
  const { html, toc } = renderWiki('== History ==\nbody\n=== Detail ===\nmore\n==== Deep ====\n');
  // TOC only collects h2 + h3 (not h4)
  assert.deepEqual(toc.map((t) => [t.level, t.text]), [[2, 'History'], [3, 'Detail']]);
  // the exact heading shape the other tests assert on must survive
  assert.ok(html.includes('<h2>History</h2>'), 'h2 byte-shape unchanged');
  assert.ok(html.includes('<h3>Detail</h3>'), 'h3 byte-shape unchanged');
  // an invisible anchor precedes each heading with the toc id
  assert.ok(html.includes(`<span class=hx id="${toc[0].id}"></span><h2>History</h2>`), 'anchor precedes heading');
});

test('renderWiki de-duplicates repeated heading ids', () => {
  const { toc } = renderWiki('== Notes ==\na\n== Notes ==\nb');
  assert.equal(toc.length, 2);
  assert.notEqual(toc[0].id, toc[1].id, 'duplicate headings get distinct anchor ids');
  assert.equal(toc[0].id, 'notes');
  assert.equal(toc[1].id, 'notes-2');
});

test('renderWiki heading anchors cannot inject script (XSS)', () => {
  const { html, toc } = renderWiki('== <script>alert(1)</script> ==');
  assert.ok(!/<script>/i.test(html), 'no live script from a hostile heading');
  assert.ok(!/[<>"]/.test(toc[0].id), 'anchor id has no HTML metacharacters');
});

test('tocAside: empty for <2 headings, a nav of links otherwise', () => {
  assert.equal(tocAside([]), '');
  assert.equal(tocAside([{ level: 2, text: 'Only', id: 'only' }]), '', 'a single heading needs no TOC');
  const a = tocAside([{ level: 2, text: 'One', id: 'one' }, { level: 3, text: 'Two', id: 'two' }]);
  assert.ok(a.includes('<aside class=toc'), 'renders the toc aside');
  assert.ok(a.includes('href="#one"') && a.includes('href="#two"'), 'links to both anchors');
  assert.ok(a.includes('class="lvl3"'), 'nests h3 entries');
});

test('layout renders the two-column shell only when a TOC is supplied', () => {
  const withToc = layout({ title: 'T', body: '<h1>T</h1>', toc: '<aside class=toc></aside>' });
  assert.ok(withToc.includes('<div class="shell withtoc">'), 'two-column shell with a TOC');
  const plain = layout({ title: 'T', body: '<h1>T</h1>' });
  assert.ok(plain.includes('<main class=wrap>') && !plain.includes('<div class="shell withtoc">'), 'single column without a TOC');
});

test('layout marks the active nav tab and renders breadcrumbs', () => {
  const html = layout({ title: 'Search', body: 'x', active: 'search', crumbs: '<a href="/">Library</a>' });
  assert.ok(/<a href="\/search" class=active>Search<\/a>/.test(html), 'active tab flagged');
  assert.ok(html.includes('<p class=crumbs>'), 'breadcrumb bar rendered');
});

test('layout ships dark-mode tokens and a theme toggle', () => {
  const html = layout({ title: 'T', body: 'x' });
  assert.ok(html.includes('prefers-color-scheme:dark'), 'system dark-mode media query present');
  assert.ok(html.includes('[data-theme="dark"]'), 'explicit dark theme selector present');
  assert.ok(html.includes('la-theme'), 'theme preference is persisted');
  assert.ok(html.includes('class=themebtn'), 'theme toggle button rendered');
});
