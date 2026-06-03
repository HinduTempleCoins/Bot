// reader.test.mjs — offline tests for the Library self-host reader layer (queue #86).
// Run: node --test integrations/soapbox/reader.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableKind, readerManifest, renderReader, cdnAssets } from './reader.mjs';

// ── public-domain PDF → embeddable via pdf.js ──────────────────────────────────────────────────
test('public-domain PDF → kind pdf, canEmbed, viewer pdfjs', () => {
  const item = { title: 'Moby-Dick', source: 'gutenberg', year: 1851, format: 'pdf', src: 'https://example.org/moby.pdf' };
  assert.equal(readableKind(item), 'pdf');
  const m = readerManifest(item);
  assert.equal(m.kind, 'pdf');
  assert.equal(m.canEmbed, true);
  assert.equal(m.viewer, 'pdfjs');
  assert.equal(m.src, 'https://example.org/moby.pdf');

  const html = renderReader(item);
  assert.match(html, /reader-viewer-pdf/);
  assert.match(html, /pdfjs-dist/); // CDN bootstrap present
});

// ── own-corpus EPUB → embeddable via epub.js ───────────────────────────────────────────────────
test('own-corpus EPUB → kind epub, canEmbed, viewer epubjs', () => {
  const item = { title: 'The Convergence', owner: 'melek', format: 'epub', src: '/corpus/convergence.epub' };
  assert.equal(readableKind(item), 'epub');
  const m = readerManifest(item);
  assert.equal(m.kind, 'epub');
  assert.equal(m.canEmbed, true);
  assert.equal(m.viewer, 'epubjs');

  const html = renderReader(item);
  assert.match(html, /reader-viewer-epub/);
  assert.match(html, /epubjs/); // CDN bootstrap present
});

// ── in-copyright → ALWAYS link-out, never host the bytes ────────────────────────────────────────
test('in-copyright item → link-out, canEmbed false, fallbackUrl present, NO viewer container', () => {
  const item = {
    title: 'A 2023 novel', year: 2023, rights: 'All rights reserved',
    format: 'pdf', src: 'https://pirate.example/novel.pdf', url: 'https://openlibrary.org/works/X',
  };
  assert.equal(readableKind(item), 'link-out');
  const m = readerManifest(item);
  assert.equal(m.kind, 'link-out');
  assert.equal(m.canEmbed, false);
  assert.equal(m.viewer, null);
  assert.ok(m.fallbackUrl, 'fallbackUrl should be present for link-out');
  assert.equal(m.src, undefined, 'must NOT expose a hostable src for an in-copyright work');

  const html = renderReader(item);
  // No viewer container of any kind.
  assert.doesNotMatch(html, /reader-viewer/);
  assert.doesNotMatch(html, /pdfjs-dist/);
  assert.doesNotMatch(html, /epub\.min\.js/);
  // The read-at-source link points at the legitimate external URL, not the byte src.
  assert.match(html, /Read at the source/);
  assert.match(html, /openlibrary\.org/);
  assert.doesNotMatch(html, /pirate\.example/);
});

// ── escaping ────────────────────────────────────────────────────────────────────────────────────
test('renderReader escapes a title containing <script>', () => {
  const item = { title: '<script>alert(1)</script>', owner: 'melek', format: 'pdf', src: '/corpus/x.pdf' };
  const html = renderReader(item);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('renderReader escapes a malicious title on the link-out card too', () => {
  const item = { title: '"><img src=x onerror=alert(1)>', year: 2024, rights: 'All rights reserved', url: 'https://ok.example/' };
  const html = renderReader(item);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.match(html, /&lt;img/);
});

// ── soft handling of missing / garbage input ───────────────────────────────────────────────────
test('readableKind handles missing/garbage item safely', () => {
  assert.equal(readableKind(null), 'link-out');
  assert.equal(readableKind(undefined), 'link-out');
  assert.equal(readableKind(42), 'link-out');
  assert.equal(readableKind('nope'), 'link-out');
  assert.equal(readableKind({}), 'link-out'); // no clearing signal → safe default
  // a hostable item with an UNKNOWN format also degrades to link-out (can't embed safely)
  assert.equal(readableKind({ owner: 'melek', title: 'x', format: 'mystery' }), 'link-out');
});

test('readerManifest never throws on garbage and never embeds it', () => {
  for (const bad of [null, undefined, 42, 'str', [], {}]) {
    const m = readerManifest(bad);
    assert.equal(m.canEmbed, false);
    assert.equal(m.kind, 'link-out');
    assert.equal(m.viewer, null);
    assert.equal(m.src, undefined);
  }
  // renderReader on garbage is a link-out card, no viewer
  const html = renderReader(null);
  assert.doesNotMatch(html, /reader-viewer/);
});

// ── hostable-but-no-src degrades to link-out (never a broken/empty viewer) ───────────────────────
test('hostable PD item with no src → link-out (cannot embed nothing)', () => {
  const item = { title: 'PD work', year: 1900, format: 'pdf', url: 'https://archive.org/details/x' };
  const m = readerManifest(item);
  assert.equal(m.kind, 'link-out');
  assert.equal(m.canEmbed, false);
  assert.equal(m.fallbackUrl, 'https://archive.org/details/x');
});

// ── HTML/plain-text host path → inline viewer ───────────────────────────────────────────────────
test('CC-licensed HTML → kind html, viewer inline', () => {
  const item = { title: 'An OA study', license: 'CC BY 4.0', source: 'doaj', format: 'html', src: 'https://example.org/study.html' };
  assert.equal(readableKind(item), 'html');
  const m = readerManifest(item);
  assert.equal(m.viewer, 'inline');
  assert.equal(m.canEmbed, true);
  assert.match(renderReader(item), /reader-viewer-inline/);
});

// ── format inferred from extension when no explicit format field ─────────────────────────────────
test('format inferred from src extension', () => {
  assert.equal(readableKind({ owner: 'melek', title: 'x', src: '/corpus/a.epub' }), 'epub');
  assert.equal(readableKind({ owner: 'melek', title: 'x', src: '/corpus/a.pdf' }), 'pdf');
});

// ── cdnAssets shape ──────────────────────────────────────────────────────────────────────────────
test('cdnAssets returns pdf.js + epub.js URLs', () => {
  const a = cdnAssets();
  assert.ok(a.pdfjs.lib && a.pdfjs.worker);
  assert.ok(a.epubjs.lib && a.epubjs.jszip);
  assert.match(a.pdfjs.lib, /^https:\/\//);
  assert.match(a.epubjs.lib, /^https:\/\//);
});
