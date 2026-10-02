import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { noticesForPage, NOTICES, NOTICE_CSS } from './safety-notices.mjs';

test('the foxglove warning says the specific thing that kills, not a general disclaimer', () => {
  const html = noticesForPage('Old_World_vs_New_World_Magic_Herbs');
  assert.match(html, /wiki-safety/);
  assert.match(html, /cardiac glycosides/);
  assert.match(html, /digoxin/);
  assert.match(html, /NO psychoactive/);
  assert.match(html, /stops the heart/);
  // it must distinguish foxglove from the deliriants, which is the actual confusion
  assert.match(html, /Datura, henbane and belladonna are dangerous in a different way/);
});

test('⭐ the notice is injected server-side — the .wiki file is never edited', () => {
  for (const slug of Object.keys(NOTICES)) {
    const f = `site/wiki/seed-articles/${slug}.wiki`;
    if (existsSync(f)) {
      const text = readFileSync(f, 'utf8');
      assert.equal(text.includes('wiki-safety'), false, `${slug}.wiki must not have been edited`);
      assert.equal(text.includes('⚠️ Foxglove'), false, `${slug}.wiki must not have been edited`);
    }
  }
});

test('a page with no notice gets nothing, and the markup is escaped', () => {
  assert.equal(noticesForPage('Some_Other_Page'), '');
  assert.equal(noticesForPage(''), '');
  assert.equal(noticesForPage(), '');
  const html = noticesForPage('Old_World_vs_New_World_Magic_Herbs');
  assert.equal(html.includes('<script'), false);
  assert.match(html, /role="note"/);
});

test('every notice declares a level and the styles cover both', () => {
  for (const [slug, list] of Object.entries(NOTICES)) {
    for (const n of list) {
      assert.ok(['lethal', 'serious'].includes(n.level), slug);
      assert.ok(n.title.length > 10 && n.body.length > 60, slug);
    }
  }
  assert.match(NOTICE_CSS, /\.wiki-safety/);
  assert.match(NOTICE_CSS, /\.wiki-safety\.serious/);
});
