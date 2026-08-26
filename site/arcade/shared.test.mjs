// shared.test.mjs — the compliance shell primitives. OFFLINE.
import { test } from 'node:test';
import assert from 'node:assert';
import { esc, safeHref, shell, DISCLAIMER, PLAY_EXPLAINER, AGE_GATE, commonRoutes } from './shared.mjs';

test('esc neutralizes HTML metacharacters', () => {
  assert.equal(esc(`<script>"'&`), '&lt;script&gt;&quot;&#39;&amp;');
});

test('safeHref allows same-origin paths, http(s), mailto; rejects scripts/junk', () => {
  assert.equal(safeHref('/lotto'), '/lotto');
  assert.equal(safeHref('https://spin.soapbox.community'), 'https://spin.soapbox.community');
  assert.equal(safeHref('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('//evil.example'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref(''), '');
});

test('DISCLAIMER carries every load-bearing phrase', () => {
  assert.match(DISCLAIMER, /Entertainment only/i);
  assert.match(DISCLAIMER, /not gambling or investment/i);
  assert.match(DISCLAIMER, /no cash value/i);
  assert.match(DISCLAIMER, /cannot be cashed out/i);
  assert.match(DISCLAIMER, /not available where prohibited/i);
});

test('AGE_GATE + PLAY_EXPLAINER assert 18+ and non-cashable', () => {
  assert.match(AGE_GATE, /18\+|18 or older/i);
  assert.match(PLAY_EXPLAINER, /non-cashable/i);
  assert.match(PLAY_EXPLAINER, /no fiat on-ramp/i);
});

test('shell renders disclaimer, alpha badge, geo notice, and a BASE_PATH-prefixed brand link', () => {
  const html = shell({ title: 'T', body: '<p>hi</p>', basePath: '/arcade', baseUrl: 'https://x.test', nav: [{ label: 'Lotto', href: '/lotto' }] });
  assert.match(html, /Entertainment only/);            // disclaimer baked in
  assert.match(html, /alpha-badge/);
  assert.match(html, /arcade-geo/);                    // geofence scaffolding notice
  assert.match(html, /href="\/arcade\/"/);             // brand link prefixed
  assert.match(html, /href="\/arcade\/lotto"/);        // nav link prefixed
  assert.match(html, /not available where prohibited/i);
});

test('shell default basePath leaves self-URLs unprefixed', () => {
  const html = shell({ title: 'T', body: '', baseUrl: 'https://x.test', nav: [{ label: 'Lotto', href: '/lotto' }] });
  assert.match(html, /href="\/lotto"/);
  assert.doesNotMatch(html, /href="\/arcade\//);
});

test('commonRoutes handles health/robots/sitemap/llms', () => {
  const mk = () => { const o = { code: 0, body: '', type: '' }; return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o }; };
  const cfg = { baseUrl: 'https://x.test', name: 'K', summary: 's', sitemapPaths: ['/'], links: [] };
  for (const [p, re] of [['/health', /"ok":true/], ['/robots.txt', /User-?agent/i], ['/sitemap.xml', /<urlset/], ['/sitemap-index.xml', /<sitemapindex/], ['/llms.txt', /K/]]) {
    const { res, o } = mk();
    assert.equal(commonRoutes({}, res, p, cfg), true, p);
    assert.equal(o.code, 200, p);
    assert.match(o.body, re, p);
  }
  const { res, o } = mk();
  assert.equal(commonRoutes({}, res, '/nope', cfg), false);   // not handled
  assert.equal(o.code, 0);
});
