import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, PILLARS, categoriesFor, groupArticles, groupArticlesByPillars } from './categories.mjs';
import { slugify, titleize, renderWiki } from './render.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ARTICLE_DIRS = [path.join(__dir, 'articles'), path.join(__dir, 'seed-articles')];
const PRIVATE = /(_private|secret|operator|\.local|scripture)/i;

function getLiveArticles() {
  const seen = new Set();
  const out = [];
  for (const dir of ARTICLE_DIRS) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.wiki') && !PRIVATE.test(f)).sort(); } catch { continue; }
    for (const f of files) {
      const slug = slugify(f);
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push({ slug, title: titleize(f.replace(/\.wiki$/, '')), file: path.join(dir, f) });
    }
  }
  return out;
}

test('every article in the library is categorized with 0 unassigned items in other', () => {
  const arts = getLiveArticles();
  assert.ok(arts.length >= 243, `Expected at least 243 articles, found ${arts.length}`);

  const groups = groupArticles(arts);
  const otherGroup = groups.find((g) => g.id === 'other');
  assert.equal(otherGroup, undefined, 'No articles should land in the "other" category');

  // Verify all articles belong to at least one valid category
  for (const a of arts) {
    const cats = categoriesFor(a.title);
    assert.ok(cats.length > 0, `Article ${a.title} has no categories`);
    assert.ok(!cats.includes('other'), `Article ${a.title} landed in other`);
  }
});

test('new monographs for Ubulawu, Sublingual Absorption, and Bioavailability are fully populated', () => {
  const arts = getLiveArticles();
  const ubulawu = arts.find((a) => a.slug.toLowerCase().includes('ubulawu'));
  assert.ok(ubulawu, 'Ubulawu article must exist');
  const sublingual = arts.find((a) => a.slug.toLowerCase().includes('sublingual'));
  assert.ok(sublingual, 'Sublingual absorption article must exist');
  const bioavail = arts.find((a) => a.slug.toLowerCase().includes('bioavailability'));
  assert.ok(bioavail, 'Bioavailability article must exist');

  // Verify they render with markdown and wiki-links cleanly
  const ubulawuContent = fs.readFileSync(ubulawu.file, 'utf8');
  assert.ok(ubulawuContent.includes('Helinus integrifolius'), 'Ubulawu mentions Helinus integrifolius');
  assert.ok(ubulawuContent.includes('saponin'), 'Ubulawu mentions saponins');
  assert.ok(ubulawuContent.includes('amylase'), 'Ubulawu mentions amylase');
  assert.ok(ubulawuContent.includes('Ukuphahla'), 'Ubulawu mentions Ukuphahla');
  assert.ok(ubulawuContent.includes('Traditional Ubulawu Blend Examples'), 'Ubulawu contains blend examples');

  const renderedUbulawu = renderWiki(ubulawuContent);
  assert.ok(renderedUbulawu.html.includes('Ubulawu'), 'Renders Ubulawu heading');

  const sublingualContent = fs.readFileSync(sublingual.file, 'utf8');
  assert.ok(sublingualContent.includes('amylase'), 'Sublingual mentions amylase');
  assert.ok(sublingualContent.includes('first-pass'), 'Sublingual mentions first-pass metabolism');

  const bioContent = fs.readFileSync(bioavail.file, 'utf8');
  assert.ok(bioContent.includes('Ayahuasca'), 'Bioavailability mentions Ayahuasca');
  assert.ok(bioContent.includes('Grapefruit'), 'Bioavailability mentions Grapefruit');
  assert.ok(bioContent.includes('Piracetam'), 'Bioavailability mentions Piracetam');
  assert.ok(bioContent.includes('Alpha-GPC'), 'Bioavailability mentions Alpha-GPC');
  assert.ok(bioContent.includes('Vanilla'), 'Bioavailability mentions Vanilla');
  assert.ok(bioContent.includes('Cinnamon'), 'Bioavailability mentions Cinnamon');
  assert.ok(bioContent.includes('Turmeric'), 'Bioavailability mentions Turmeric');
  assert.ok(bioContent.includes('Glutathione'), 'Bioavailability mentions Glutathione');
  assert.ok(bioContent.includes('Alcohol'), 'Bioavailability mentions Alcohol');
});

test('new monographs for Balm of Gilead, Old World vs New World Herbs, Apotropaic Magic, Hydrosols, Tropanes, and Bupropion/Buspirone are verified', () => {
  const arts = getLiveArticles();
  const gilead = arts.find((a) => a.slug.toLowerCase().includes('gilead'));
  assert.ok(gilead, 'Balm of Gilead and Uziza article must exist');
  const oldWorld = arts.find((a) => a.slug.toLowerCase().includes('old_world') || a.slug.toLowerCase().includes('magic_herbs'));
  assert.ok(oldWorld, 'Old World vs New World Magic Herbs article must exist');
  const apotropaic = arts.find((a) => a.slug.toLowerCase().includes('apotropaic'));
  assert.ok(apotropaic, 'Apotropaic Magic article must exist');
  const hydrosols = arts.find((a) => a.slug.toLowerCase().includes('hydrosol'));
  assert.ok(hydrosols, 'Hydrosols and Absolutes article must exist');
  const tropanes = arts.find((a) => a.slug.toLowerCase().includes('tropane'));
  assert.ok(tropanes, 'Tropane Alkaloids article must exist');
  const bupropion = arts.find((a) => a.slug.toLowerCase().includes('bupropion') || a.slug.toLowerCase().includes('buspirone'));
  assert.ok(bupropion, 'Bupropion and Buspirone article must exist');
  const huasca = arts.find((a) => a.slug.toLowerCase().includes('huasca_phenomenon'));
  assert.ok(huasca, 'The Huasca Phenomenon article must exist');

  const gileadContent = fs.readFileSync(gilead.file, 'utf8');
  assert.ok(gileadContent.includes('Commiphora gileadensis'), 'Mentions Commiphora gileadensis');
  assert.ok(gileadContent.includes('Piper guineense'), 'Mentions Piper guineense');
  assert.ok(gileadContent.includes('guineensine'), 'Mentions guineensine');

  const oldWorldContent = fs.readFileSync(oldWorld.file, 'utf8');
  assert.ok(oldWorldContent.includes('Benztropine'), 'Mentions Benztropine model');
  assert.ok(oldWorldContent.includes('venom'), 'Mentions snake venom');
  assert.ok(oldWorldContent.includes('Sadhu'), 'Mentions Sadhu traditions');
  assert.ok(oldWorldContent.includes('Museum Level'), 'Mentions Museum Level dose');
  assert.ok(oldWorldContent.includes('Tasting'), 'Mentions Shulgin tasting protocol');

  const apotropaicContent = fs.readFileSync(apotropaic.file, 'utf8');
  assert.ok(apotropaicContent.includes('Bes'), 'Mentions Bes deity and Bes mugs');
  assert.ok(apotropaicContent.includes('Peganum harmala'), 'Mentions Peganum harmala');
  assert.ok(apotropaicContent.includes('Bastet'), 'Mentions Bastet');
  assert.ok(apotropaicContent.includes('Egyptian Magic'), 'Mentions Egyptian Magic skin balm');
  assert.ok(apotropaicContent.includes('Imphepho'), 'Mentions beeswax and imphepho soap');

  const hydrosolContent = fs.readFileSync(hydrosols.file, 'utf8');
  assert.ok(hydrosolContent.includes('Florentine receiver'), 'Mentions Florentine receiver');
  assert.ok(hydrosolContent.includes('Concrete'), 'Mentions Concrete');
  assert.ok(hydrosolContent.includes('Absolute'), 'Mentions Absolute');
  assert.ok(hydrosolContent.includes('Winterization'), 'Mentions Winterization');
  assert.ok(hydrosolContent.includes('Enfleurage'), 'Mentions Enfleurage');
  assert.ok(hydrosolContent.includes('cannabutter'), 'Mentions cannabutter biphasic extraction');

  const tropaneContent = fs.readFileSync(tropanes.file, 'utf8');
  assert.ok(tropaneContent.includes('Brugmansia'), 'Mentions Brugmansia');
  assert.ok(tropaneContent.includes('Cocaine'), 'Mentions Cocaine');
  assert.ok(tropaneContent.includes('Cocaethylene'), 'Mentions Cocaethylene');
  assert.ok(tropaneContent.includes('hCE1'), 'Mentions hCE1 transesterification');
  assert.ok(tropaneContent.includes('8-azabicyclo[3.2.1]octane'), 'Mentions core tropane nucleus');

  const bupContent = fs.readFileSync(bupropion.file, 'utf8');
  assert.ok(bupContent.includes('Wellbutrin'), 'Mentions Wellbutrin');
  assert.ok(bupContent.includes('Buspar'), 'Mentions Buspar');
  assert.ok(bupContent.includes('cathinone'), 'Mentions substituted cathinone');
  assert.ok(bupContent.includes('azapirone'), 'Mentions azapirone');
  assert.ok(bupContent.includes('HT'), 'Mentions serotonin receptor 5-HT');
  assert.ok(bupContent.includes('CYP2B6'), 'Mentions CYP2B6');
  assert.ok(bupContent.includes('CYP3A4'), 'Mentions CYP3A4');
  assert.ok(bupContent.includes('Contrave'), 'Mentions Contrave');

  const huascaContent = fs.readFileSync(huasca.file, 'utf8');
  assert.ok(huascaContent.includes('HerbPedia'), 'Mentions HerbPedia');
  assert.ok(huascaContent.includes('Auvelity'), 'Mentions Auvelity');
  assert.ok(huascaContent.includes('ECA'), 'Mentions ECA stack');
  assert.ok(huascaContent.includes('transamination'), 'Mentions transamination hypothesis');

  // Verify Kyphi blend examples
  const kyphi = arts.find((a) => a.slug.toLowerCase() === 'kyphi');
  assert.ok(kyphi, 'Kyphi article must exist');
  const kyphiContent = fs.readFileSync(kyphi.file, 'utf8');
  assert.ok(kyphiContent.includes('Edfu'), 'Kyphi mentions Edfu temple');
  assert.ok(kyphiContent.includes('Philae'), 'Kyphi mentions Philae temple');
  assert.ok(kyphiContent.includes('Plutarch'), 'Kyphi mentions Plutarch');
  assert.ok(kyphiContent.includes('Dioscorides'), 'Kyphi mentions Dioscorides');
  assert.ok(kyphiContent.includes('Galen'), 'Kyphi mentions Galen');
});

test('7 high-level knowledge pillars cover all disciplines', () => {
  const arts = getLiveArticles();
  const pillars = groupArticlesByPillars(arts);
  assert.equal(pillars.length, 7, 'Must have 7 pillars');
  for (const p of pillars) {
    assert.ok(p.items.length >= 20, `Pillar ${p.name} has ${p.items.length} items, expected >= 20`);
  }
});
