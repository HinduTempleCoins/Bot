import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTemplate, buildAdSvg, esc, safeHero, wrapText, fitText, textWidth,
  FORMATS, FORMAT_IDS, THEMES, THEME_IDS, PRODUCTS, CTAS, BRAND_NEG,
} from './ad-templates.mjs';

// The format rotation in gen-marketing-batch.mjs — the engine must cover every one of these.
const FMT_ROT = ['ig-square', 'ig-portrait', 'story-reel', 'pinterest-pin', 'fb-link', 'x-post', 'yt-thumb',
  'fb-cover', 'li-banner', 'business-card', 'postcard-4x6', 'disp-medrect', 'disp-leaderboard', 'disp-halfpage',
  'web-hero', 'blog-featured', 'qr-card', 'podcast-cover'];
// The formats the generator excludes from the 'cover' layout — they still have to render 'standard'.
const NON_COVERABLE = ['disp-medrect', 'disp-leaderboard', 'disp-halfpage', 'business-card', 'li-banner', 'fb-cover', 'qr-card'];

let sharp;
test('setup: sharp is available', async () => {
  sharp = (await import('sharp')).default;
  assert.ok(typeof sharp === 'function');
});

// a real tiny PNG so the hero path is exercised with something rasterisable
async function heroUri() {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 180, g: 60, b: 140 } } }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

const STD = (hero) => ({ slogan: 'Mine right now in your browser — no install, even on a phone.', cta: 'Start mining', heroDataUri: hero, surfaces: ['pool.soapbox.community', 'melek.salon', 'hathor.live'], eyebrow: 'SoapBox Mining Pool' });
const COVER = (hero) => ({ layout: 'cover', slogan: 'Hathor is the founding artificial-intelligence witness of the MELEK blockchain.', eyebrow: 'Hathor Studio · MELEK', sub: 'hathor.soapbox.community', heroDataUri: hero });

// ── contract with the generator ──────────────────────────────────────────────────────────────────────
test('every format in the generator FMT_ROT is known to the engine', () => {
  for (const f of FMT_ROT) assert.ok(FORMATS[f], `missing format ${f}`);
  for (const f of NON_COVERABLE) assert.ok(FORMATS[f], `missing non-coverable format ${f}`);
  for (const f of FORMAT_IDS) {
    assert.ok(Number.isInteger(FORMATS[f].w) && FORMATS[f].w > 0, `${f} width`);
    assert.ok(Number.isInteger(FORMATS[f].h) && FORMATS[f].h > 0, `${f} height`);
  }
});

test('every FMT_ROT format renders a non-empty PNG at its real dimensions (standard layout)', async () => {
  const hero = await heroUri();
  for (const fmt of FMT_ROT) {
    const buf = await renderTemplate(fmt, 'vaporwave', STD(hero));
    assert.ok(Buffer.isBuffer(buf) && buf.length > 100, `${fmt} produced no bytes`);
    const m = await sharp(buf).metadata();
    assert.equal(m.format, 'png', `${fmt} not a png`);
    assert.equal(m.width, FORMATS[fmt].w, `${fmt} width`);
    assert.equal(m.height, FORMATS[fmt].h, `${fmt} height`);
  }
});

test('the coverable formats render the cover layout at their real dimensions', async () => {
  const hero = await heroUri();
  const coverable = FMT_ROT.filter((f) => !NON_COVERABLE.includes(f));
  assert.ok(coverable.length > 5);
  for (const fmt of coverable) {
    const buf = await renderTemplate(fmt, 'temple-gold', COVER(hero));
    const m = await sharp(buf).metadata();
    assert.equal(m.width, FORMATS[fmt].w, `${fmt} cover width`);
    assert.equal(m.height, FORMATS[fmt].h, `${fmt} cover height`);
  }
});

test('the non-coverable formats still render standard, including the tiny display units', async () => {
  const hero = await heroUri();
  for (const fmt of NON_COVERABLE) {
    const buf = await renderTemplate(fmt, 'midnight-neon', STD(hero));
    const m = await sharp(buf).metadata();
    assert.equal(m.width, FORMATS[fmt].w);
    assert.equal(m.height, FORMATS[fmt].h);
  }
});

test('both layout variants differ, and every theme renders', async () => {
  const hero = await heroUri();
  const a = await renderTemplate('ig-square', 'fantasy', STD(hero));
  const b = await renderTemplate('ig-square', 'fantasy', COVER(hero));
  assert.ok(!a.equals(b), 'cover and standard produced identical bytes');
  for (const th of THEME_IDS) {
    const buf = await renderTemplate('fb-link', th, STD(hero));
    assert.ok(Buffer.isBuffer(buf) && buf.length > 100, `theme ${th}`);
  }
});

test('an unknown format or theme soft-fails to a default render instead of throwing', async () => {
  const buf = await renderTemplate('no-such-format', 'no-such-theme', { slogan: 'x' });
  const m = await sharp(buf).metadata();
  assert.equal(m.width, FORMATS['ig-square'].w);
  assert.equal(m.height, FORMATS['ig-square'].h);
});

// ── escaping ─────────────────────────────────────────────────────────────────────────────────────────
test('esc escapes every SVG-breaking character', () => {
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('text with &<>"\' is escaped and cannot break out of the SVG', async () => {
  const nasty = `</text><script>alert("x")</script> & 'quoted' <b>bold</b> "dq"`;
  const svg = buildAdSvg('ig-square', 'vaporwave', { slogan: nasty, cta: nasty, eyebrow: nasty, surfaces: [nasty] });
  assert.ok(!svg.includes('<script'), 'raw <script> reached the SVG');
  assert.ok(!svg.includes(nasty), 'the raw payload reached the SVG unescaped');
  assert.ok(!svg.includes('</text><script'), 'an unescaped </text> break-out reached the SVG');
  assert.ok(!svg.includes('<b>bold</b>'), 'raw markup reached the SVG');
  assert.ok(svg.includes('&lt;') && svg.includes('&amp;') && svg.includes('&#39;'));
  // only the tags we emit ourselves exist
  const tags = [...svg.matchAll(/<([a-zA-Z:]+)/g)].map((m) => m[1]);
  const allowed = new Set(['svg', 'defs', 'linearGradient', 'stop', 'rect', 'image', 'text', 'tspan']);
  for (const tg of tags) assert.ok(allowed.has(tg), `unexpected tag <${tg}> in output`);
  // and it still rasterises
  const buf = await renderTemplate('ig-square', 'vaporwave', { slogan: nasty, cta: nasty, eyebrow: nasty, surfaces: [nasty] });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 100);
});

test('the cover layout escapes sub and eyebrow too', () => {
  const svg = buildAdSvg('fb-link', 'parchment', { layout: 'cover', slogan: 'a&b', eyebrow: '<e>', sub: `s"u'b` });
  assert.ok(!svg.includes('<e>'));
  assert.ok(svg.includes('&lt;e&gt;'));
  assert.ok(svg.includes('&quot;') && svg.includes('&#39;'));
});

// ── hero soft-fail ───────────────────────────────────────────────────────────────────────────────────
test('safeHero accepts a real data URI and rejects everything else', async () => {
  const good = await heroUri();
  assert.equal(safeHero(good), good);
  for (const bad of [undefined, null, 0, {}, [], '', 'nope', 'data:image/png;base64,', 'http://x/y.png',
    'data:image/png;base64,abc', 'data:text/html;base64,' + 'A'.repeat(200),
    `data:image/png;base64,"/><script>x</script>`]) {
    assert.equal(safeHero(bad), '', `accepted ${String(bad).slice(0, 40)}`);
  }
});

test('a missing or invalid heroDataUri soft-fails to a render rather than throwing', async () => {
  const cases = [undefined, null, '', 'not-a-uri', 'data:image/png;base64,####',
    // well-formed base64 of bytes that are NOT an image — librsvg/sharp must not take the render down
    `data:image/png;base64,${Buffer.from('this is definitely not a png '.repeat(8)).toString('base64')}`];
  for (const hero of cases) {
    const buf = await renderTemplate('ig-square', 'cyan-egypt', { ...STD(hero), heroDataUri: hero });
    assert.ok(Buffer.isBuffer(buf) && buf.length > 100, `hero case ${String(hero).slice(0, 30)} produced nothing`);
    const m = await sharp(buf).metadata();
    assert.equal(m.width, 1080);
    const buf2 = await renderTemplate('fb-link', 'cyan-egypt', { layout: 'cover', slogan: 'x', heroDataUri: hero });
    assert.ok(Buffer.isBuffer(buf2) && buf2.length > 100);
  }
});

test('renderTemplate never throws on junk opts', async () => {
  for (const opts of [undefined, null, 'string', 42, {}, { slogan: null }, { surfaces: 'not-an-array' }, { surfaces: [null, undefined, 1] }]) {
    const buf = await renderTemplate('yt-thumb', 'rose-quartz', opts);
    assert.ok(Buffer.isBuffer(buf) && buf.length > 100, `opts ${JSON.stringify(opts)}`);
  }
});

// ── copy data the generator reads ────────────────────────────────────────────────────────────────────
test('PRODUCTS entries all have the required fields and non-empty slogans', () => {
  assert.ok(Array.isArray(PRODUCTS) && PRODUCTS.length > 0);
  const ids = new Set();
  for (const p of PRODUCTS) {
    assert.equal(typeof p.id, 'string'); assert.ok(p.id.length > 0, 'empty id');
    assert.ok(!ids.has(p.id), `duplicate product id ${p.id}`); ids.add(p.id);
    assert.ok(/^[a-z0-9-]+$/.test(p.id), `${p.id} must be filename-safe`);
    assert.ok(typeof p.kicker === 'string' && p.kicker.length > 0, `${p.id} kicker`);
    assert.ok(typeof p.surface === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}(\/[\w-]*)*$/.test(p.surface), `${p.id} surface must be a real domain: ${p.surface}`);
    assert.ok(Array.isArray(p.slogans) && p.slogans.length > 0, `${p.id} slogans`);
    for (const s of p.slogans) { assert.equal(typeof s, 'string'); assert.ok(s.trim().length > 0, `${p.id} blank slogan`); }
    assert.ok(Array.isArray(p.heroes) && p.heroes.length > 0, `${p.id} heroes`);
    for (const hname of p.heroes) { assert.equal(typeof hname, 'string'); assert.ok(hname.length > 0); }
  }
});

test('the operator-specified products are present by id', () => {
  const ids = PRODUCTS.map((p) => p.id);
  for (const want of ['vkbt', 'pool', 'hathor']) assert.ok(ids.includes(want), `missing product ${want}`);
  // Retired by the operator on 2026-10-22: no "Temple of Van Kush", no "Book of Tanit" ad product,
  // and none of the invented products from the first creative pool.
  for (const gone of ['temple', 'tanit', 'book-of-tanit', 'writing', 'music', 'streaming', 'games', 'dex', 'social', 'wiki']) {
    assert.ok(!ids.includes(gone), `retired product ${gone} is back in PRODUCTS`);
  }
});

test('no product reuses the invented slogans the operator objected to', () => {
  const banned = ['earn for blogging', 'game on-chain', 'join the family', 'make music. get paid'];
  for (const p of PRODUCTS) for (const s of p.slogans) {
    const low = s.toLowerCase();
    for (const b of banned) assert.ok(!low.includes(b), `${p.id} carries the retired slogan "${b}"`);
  }
});

test('every product has enough slogans to keep the rotation from repeating itself', () => {
  // The complaint on 2026-10-17 was that every post looked the same: one slogan per product repeated.
  for (const p of PRODUCTS) assert.ok(p.slogans.length >= 3, `${p.id} has only ${p.slogans.length} slogan(s)`);
  assert.ok(new Set(PRODUCTS.flatMap((p) => p.slogans)).size === PRODUCTS.reduce((n, p) => n + p.slogans.length, 0), 'duplicate slogans across products');
});

test('CTAS and BRAND_NEG are usable by the generator', () => {
  assert.ok(Array.isArray(CTAS) && CTAS.length > 0);
  for (const c of CTAS) { assert.equal(typeof c, 'string'); assert.ok(c.trim().length > 0); }
  assert.equal(typeof BRAND_NEG, 'string');
  assert.ok(BRAND_NEG.length > 20);
  assert.match(BRAND_NEG, /text/); // the ad engine lays the words on; the hero must carry none
});

test('THEME_IDS is a non-empty list of unique ids matching THEMES', () => {
  assert.ok(Array.isArray(THEME_IDS) && THEME_IDS.length > 1);
  assert.equal(new Set(THEME_IDS).size, THEME_IDS.length);
  assert.equal(THEME_IDS.length, THEMES.length);
  for (const t of THEMES) for (const k of ['bg0', 'bg1', 'bg2', 'panel', 'ink', 'dim', 'accent', 'onAccent', 'scrim']) {
    assert.match(t[k], /^#[0-9a-f]{6}$/i, `${t.id}.${k}`);
  }
});

// ── the generator's own rotation, exercised end to end (no network, no files) ────────────────────────
test('the generator rotation picks a valid slogan/hero/theme for every index', () => {
  for (let i = 0; i < 60; i++) {
    const prod = PRODUCTS[i % PRODUCTS.length];
    const th = THEME_IDS[(i + prod.id.length) % THEME_IDS.length];
    assert.ok(THEME_IDS.includes(th));
    assert.ok(prod.slogans[i % prod.slogans.length]);
    assert.ok(prod.heroes[i % prod.heroes.length]);
    assert.ok(CTAS[i % CTAS.length]);
  }
});

// ── text fitting ─────────────────────────────────────────────────────────────────────────────────────
test('wrapText keeps lines inside the box and breaks unbreakable words', () => {
  const lines = wrapText('The SoapBox mining pool is the ecosystem’s mining pool.', 24, 200);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(textWidth(l, 24) <= 200 + 1, `line too wide: ${l}`);
  const long = wrapText('A'.repeat(400), 20, 120);
  assert.ok(long.length > 1);
  for (const l of long) assert.ok(textWidth(l, 20, true) <= 200);
  assert.deepEqual(wrapText('', 20, 100), ['']);
  assert.deepEqual(wrapText(null, 20, 100), ['']);
});

test('fitText shrinks to fit and never returns zero lines', () => {
  const big = fitText('Short', { maxW: 800, maxH: 300, max: 90, min: 10, maxLines: 3 });
  const small = fitText('x '.repeat(400), { maxW: 200, maxH: 80, max: 90, min: 10, maxLines: 3 });
  assert.ok(big.size > small.size);
  assert.ok(big.lines.length >= 1 && small.lines.length >= 1 && small.lines.length <= 3);
  const zero = fitText('', { maxW: 0, maxH: 0, max: 90, min: 10, maxLines: 2 });
  assert.ok(Array.isArray(zero.lines) && zero.lines.length >= 1);
});

test('the longest real slogan still fits the smallest display unit', async () => {
  const longest = PRODUCTS.flatMap((p) => p.slogans).sort((a, b) => b.length - a.length)[0];
  for (const fmt of ['disp-leaderboard', 'disp-medrect', 'disp-halfpage']) {
    const buf = await renderTemplate(fmt, 'parchment', { slogan: longest, cta: CTAS[0], surfaces: ['pool.soapbox.community'], eyebrow: 'SoapBox Mining Pool' });
    const m = await sharp(buf).metadata();
    assert.equal(m.width, FORMATS[fmt].w);
    assert.equal(m.height, FORMATS[fmt].h);
  }
});

test('buildAdSvg is pure and deterministic', () => {
  const o = { slogan: 'Start mining', cta: 'Start mining', eyebrow: 'SoapBox Mining Pool', surfaces: ['pool.soapbox.community'] };
  assert.equal(buildAdSvg('x-post', 'kurdish-sun', o), buildAdSvg('x-post', 'kurdish-sun', o));
  assert.match(buildAdSvg('x-post', 'kurdish-sun', o), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(buildAdSvg('x-post', 'kurdish-sun', o), /width="1600" height="900"/);
});

test('wrapText keeps a free-standing dash spaced, but splits inside a long compound', () => {
  const l = wrapText('Start mining in 5 seconds — no install, even on your phone.', 24, 400, true);
  assert.ok(l.some((x) => x.startsWith('— no') || x.includes(' — no')), `dash lost its space: ${JSON.stringify(l)}`);
  assert.ok(!l.some((x) => x.includes('—no')), `dash glued to the next word: ${JSON.stringify(l)}`);
  const c = wrapText('Hathor is the founding artificial-intelligence witness.', 24, 150, true);
  assert.ok(c.includes('artificial-'), `compound not split at its hyphen: ${JSON.stringify(c)}`);
  for (const line of c) assert.ok(!/[a-z]{3}$/.test(line) || !line.endsWith('intellige'), 'broke mid-syllable');
});

test('CALIBRATION: textWidth never under-estimates what sharp actually draws', async () => {
  // The 2026-10-17 pool shipped copy running off the edge of the ad. The estimator has no font metrics,
  // so it is deliberately calibrated to over-estimate; this test rasterises real copy and pins that.
  const measure = async (s, size, family, bold) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3400" height="72"><rect width="3400" height="72" fill="#000"/>`
      + `<text x="10" y="52" font-family="${family}" font-size="${size}"${bold ? ' font-weight="bold"' : ''} fill="#fff">${esc(s)}</text></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return (await sharp(png).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true })).info.width;
  };
  const samples = [...PRODUCTS.flatMap((p) => p.slogans), ...CTAS, ...PRODUCTS.map((p) => p.kicker),
    ...PRODUCTS.map((p) => p.surface), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', 'WWWWWWWW',
    'pool.soapbox.community · melek.salon · hathor.live'];
  for (const [family, bold] of [['DejaVu Sans', true], ['DejaVu Serif', true], ['DejaVu Sans', false]]) {
    for (const s of samples) {
      const actual = await measure(s, 20, family, bold);
      const est = textWidth(s, 20, bold);
      assert.ok(est >= actual, `${family}${bold ? ' bold' : ''}: estimated ${est.toFixed(0)}px < actual ${actual}px for "${s.slice(0, 48)}"`);
    }
  }
});
