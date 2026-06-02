// Tests for wiki SEO (#91): safeJsonLd placeholder-stripping + layout head tags.
// Run: node --test site/wiki/seo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, safeJsonLd } from './render.mjs';

test('safeJsonLd produces valid JSON for a clean Article node', () => {
  const ld = { '@context': 'https://schema.org', '@type': 'Article', headline: 'Oilahuasca', author: { '@type': 'Organization', name: 'Library of Ashurbanipal' } };
  const s = safeJsonLd(ld);
  const parsed = JSON.parse(s);
  assert.equal(parsed.headline, 'Oilahuasca');
  assert.equal(parsed.author.name, 'Library of Ashurbanipal');
});

test('safeJsonLd drops string fields containing {placeholder} tokens', () => {
  const s = safeJsonLd({ '@type': 'Article', headline: 'Real Title', description: '{description}', datePublished: '{date_published}' });
  const parsed = JSON.parse(s);
  assert.equal(parsed.headline, 'Real Title');
  assert.ok(!('description' in parsed), 'placeholder description must be dropped');
  assert.ok(!('datePublished' in parsed), 'placeholder date must be dropped');
  assert.ok(!/\{[A-Za-z0-9_.\-]+\}/.test(s), 'no template token may survive in output');
});

test('safeJsonLd escapes </script to prevent breakout', () => {
  const s = safeJsonLd({ '@type': 'Article', headline: 'x</script><script>alert(1)</script>' });
  assert.ok(!/<\/script>/i.test(s), 'must not contain a raw </script>');
});

test('layout emits OG, Twitter card, canonical, and JSON-LD', () => {
  const html = layout({
    title: 'Oilahuasca',
    description: 'A test article.',
    canonical: 'https://wiki.example/wiki/Oilahuasca',
    ogType: 'article',
    jsonld: { '@context': 'https://schema.org', '@type': 'Article', headline: 'Oilahuasca' },
    body: '<h1>Oilahuasca</h1>',
  });
  assert.ok(html.includes('<meta property="og:title" content="Oilahuasca">'));
  assert.ok(html.includes('<meta property="og:type" content="article">'));
  assert.ok(html.includes('<meta property="og:url" content="https://wiki.example/wiki/Oilahuasca">'));
  assert.ok(html.includes('<meta name="twitter:card" content="summary">'));
  assert.ok(html.includes('<link rel=canonical href="https://wiki.example/wiki/Oilahuasca">'));
  assert.ok(html.includes('application/ld+json'));
  assert.ok(html.includes('"headline":"Oilahuasca"'));
});

test('layout never leaks a placeholder token through JSON-LD', () => {
  const html = layout({ title: 'T', jsonld: { '@type': 'Article', headline: 'T', description: '{leak}' } });
  assert.ok(!html.includes('{leak}'));
});
