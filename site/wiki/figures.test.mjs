import { test } from 'node:test';
import assert from 'node:assert';
import { figureHtml, FIGURES, hasFigure, FIGURE_CSS } from './figures.mjs';
import { renderWiki } from './render.mjs';

test('every registered figure draws a real SVG with a title', () => {
  for (const [name, fig] of Object.entries(FIGURES)) {
    const svg = fig.fn();
    assert.match(svg, /^<svg /, name);
    assert.match(svg, /<\/svg>$/, name);
    assert.match(svg, /role="img"/, name);
    assert.match(svg, /aria-label="[^"]+"/, name);
    assert.ok(svg.length > 500, `${name} must be a real diagram`);
    assert.ok(fig.alt && fig.alt.length > 8, `${name} needs alt text`);
  }
});

test('figures are deterministic — the same page never changes meaning between loads', () => {
  for (const name of Object.keys(FIGURES)) {
    assert.equal(figureHtml(name), figureHtml(name), name);
  }
});

test('a figure renders as a captioned block, and an unknown one disappears quietly', () => {
  const html = figureHtml('note-pyramid', 'A caption <with> markup');
  assert.match(html, /<figure class="wiki-figure" id="fig-note-pyramid">/);
  assert.match(html, /<figcaption>A caption &lt;with&gt; markup<\/figcaption>/);
  assert.match(html, /style="max-width:100%;height:auto"/);
  assert.equal(figureHtml('does-not-exist', 'x'), '');
  assert.equal(figureHtml(''), '');
  assert.equal(hasFigure('note-pyramid'), true);
  assert.equal(hasFigure('nope'), false);
});

test('[[Figure:…]] is expanded by the wiki renderer and is not mistaken for a link', () => {
  const { html } = renderWiki('Intro.\n\n[[Figure:mobile-immobile|Where it shows.]]\n\nAfter.');
  assert.match(html, /wiki-figure/);
  assert.match(html, /<svg/);
  assert.match(html, /Where it shows\./);
  assert.equal(html.includes('href="/wiki/Figure'), false, 'must not become a wiki link');
  const bad = renderWiki('[[Figure:nope|x]]').html;
  assert.equal(bad.includes('<svg'), false);
});

test('an ordinary wiki link still works beside figures', () => {
  const { html } = renderWiki('See [[Some Page]] and [[Other|that]].\n\n[[Figure:note-pyramid]]');
  assert.match(html, /href="\/wiki\/Some_Page"/);
  assert.match(html, /href="\/wiki\/Other">that</);
  assert.match(html, /wiki-figure/);
});

test('the figure styles ship with the page', () => {
  assert.match(FIGURE_CSS, /\.wiki-figure/);
  assert.match(FIGURE_CSS, /figcaption/);
});

test('existing articles get figures server-side — the .wiki file is never touched', async () => {
  const { PAGE_FIGURES, figuresForPage } = await import('./figures.mjs');
  const { readFileSync, existsSync } = await import('node:fs');
  for (const slug of Object.keys(PAGE_FIGURES)) {
    const html = figuresForPage(slug);
    assert.match(html, /<svg/, slug);
    const file = `site/wiki/seed-articles/${slug}.wiki`;
    if (existsSync(file)) {
      assert.equal(readFileSync(file, 'utf8').includes('[[Figure:'), false,
        `${slug}.wiki must not have been edited to add a figure`);
    }
  }
  assert.equal(figuresForPage('Not_A_Page'), '');
  assert.equal(figuresForPage(''), '');
});
