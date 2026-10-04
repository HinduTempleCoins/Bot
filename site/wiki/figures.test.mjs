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

test('the Graphene matrix shows every family member and does not present side tokens as chains', async () => {
  const { grapheneMatrix } = await import('./figures.mjs');
  const svg = grapheneMatrix();
  for (const name of ['STEEM', 'HIVE', 'BLURT', 'MELEK', 'PRANA', 'VKBT', 'CURE']) {
    assert.ok(svg.includes(name), `${name} must be in the matrix`);
  }
  // a coin has a chain; a token is on one — the header must say which each column is
  assert.ok(svg.includes('token — on a chain'), 'VKBT and CURE must be labelled as tokens on a chain');
  assert.ok(svg.includes('coin — has a chain'), 'the coins must be labelled as coins that have a chain');
  assert.match(svg, /A coin has a chain\. A token is on one\./);
  assert.match(svg, /Inherits/, 'a side token inherits its host chain consensus');
  // every dimension row is present
  for (const label of ['Consensus', 'Throughput class', 'Governance', 'Launched']) {
    assert.ok(svg.includes(label), label);
  }
});

test('the token specs matrix compares tokens with tokens, on tokenomics', async () => {
  const { tokenSpecsMatrix } = await import('./figures.mjs');
  const svg = tokenSpecsMatrix();
  for (const n of ['VKBT', 'CURE', 'POB', 'BBH', 'BLURT']) assert.ok(svg.includes(n), n);
  for (const d of ['Total supply', 'Holders', 'VKF position', 'How acquired', 'Emission']) assert.ok(svg.includes(d), d);
  assert.match(svg, /PURCHASED at market, not allocated/);
  assert.match(svg, /given away through curation/i);
  assert.ok(svg.includes('2,315,564') && svg.includes('70,974'), 'the live supply figures');
  assert.ok(svg.includes('25,038') && svg.includes('14,965'), 'the live holder counts');
  // and the >=1-token row, without which the raw count flatters an airdropped token
  assert.ok(svg.includes('5,375') && svg.includes('1,337'), 'the holders-of-a-whole-token counts');
  assert.match(svg, /Holders of ≥1 token/);
  assert.match(svg, /A side token is not a chain/);
  assert.match(svg, /never a guess/);
  // chain dimensions must not appear here
  for (const never of ['Consensus', 'Smart-contract VM', 'Throughput']) {
    assert.equal(svg.includes(never), false, `${never} belongs to the chain matrix`);
  }
});

test('⭐ no figure is orphaned — every registered figure is actually on a page', async () => {
  // A figure that nobody can see is work that was done and then lost. This test is the guard: if a
  // generator is registered in FIGURES it must appear either inline in an article (a [[Figure:name]]
  // directive) or in PAGE_FIGURES. The seven aroma wheels were orphaned exactly this way once.
  const { FIGURES, PAGE_FIGURES } = await import('./figures.mjs');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = path.dirname(fileURLToPath(import.meta.url));

  const placed = new Set(Object.values(PAGE_FIGURES).flat());
  for (const d of ['articles', 'seed-articles']) {
    let files = [];
    try { files = fs.readdirSync(path.join(dir, d)); } catch { continue; }
    for (const f of files.filter((x) => x.endsWith('.wiki'))) {
      const text = fs.readFileSync(path.join(dir, d, f), 'utf8');
      for (const m of text.matchAll(/\[\[Figure:([a-z0-9-]+)/gi)) placed.add(m[1]);
    }
  }
  const orphans = Object.keys(FIGURES).filter((k) => !placed.has(k));
  assert.deepEqual(orphans, [], `these figures are not on any page: ${orphans.join(', ')}`);
  // and nothing is placed that does not exist
  const unknown = [...placed].filter((k) => !FIGURES[k]);
  assert.deepEqual(unknown, [], `these pages ask for figures that do not exist: ${unknown.join(', ')}`);
});

test('⭐ no page both declares a figure inline and gets it injected (no double render)', async () => {
  const { PAGE_FIGURES } = await import('./figures.mjs');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const { slugify } = await import('./render.mjs');

  for (const d of ['articles', 'seed-articles']) {
    let files = [];
    try { files = fs.readdirSync(path.join(dir, d)); } catch { continue; }
    for (const f of files.filter((x) => x.endsWith('.wiki'))) {
      const slug = slugify(f);
      const injected = PAGE_FIGURES[slug] || [];
      if (!injected.length) continue;
      const text = fs.readFileSync(path.join(dir, d, f), 'utf8');
      for (const name of injected) {
        assert.equal(text.includes(`[[Figure:${name}`), false,
          `${slug} declares ${name} inline AND in PAGE_FIGURES — it would render twice`);
      }
    }
  }
});
