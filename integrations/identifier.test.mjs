import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdentifier, DOMAINS } from './identifier.mjs';

// fake vision: embed maps a string to a tiny deterministic vector; classify ranks the label whose text
// appears in the image name first.
function fakeVision() {
  return {
    embed: async (img) => {
      // "ruby" -> [1,0,0]; "sapphire" -> [0,1,0]; else [0,0,1]
      if (/ruby/.test(img)) return [1, 0, 0];
      if (/sapphire/.test(img)) return [0, 1, 0];
      return [0, 0, 1];
    },
    classify: async (img, labels) => {
      const hit = labels.find((l) => img && l.toLowerCase().includes(img.replace(/\.\w+$/, '').toLowerCase()));
      const first = hit || labels[0];
      return [{ label: first, score: 0.88 }, { label: labels[1] || first, score: 0.05 }];
    },
  };
}

test('zero-shot identify works with no exemplars, over the domain vocabulary', async () => {
  const id = createIdentifier({ vision: fakeVision() });
  const out = await id.identify('ruby.jpg', 'minerals_gems');
  assert.equal(out.via, 'zero-shot');
  assert.match(out.label, /ruby/i);
  assert.ok(out.score > 0.5);
});

test('addExemplar grows a class; identify then matches by nearest neighbour', async () => {
  const id = createIdentifier({ vision: fakeVision(), threshold: 0.5 });
  assert.equal((await id.addExemplar('gems', 'ruby', 'ruby1.jpg')).ok, true);
  assert.equal((await id.addExemplar('gems', 'ruby', 'ruby2.jpg')).ok, true);
  assert.equal((await id.addExemplar('gems', 'sapphire', 'sapphire1.jpg')).ok, true);
  const out = await id.identify('a-new-ruby.jpg', 'gems');
  assert.equal(out.via, 'exemplar');
  assert.equal(out.label, 'ruby');
  assert.ok(out.score >= 0.5);
});

test('every wiki domain has a non-empty label vocabulary', () => {
  for (const [name, d] of Object.entries(DOMAINS)) {
    assert.ok(Array.isArray(d.labels) && d.labels.length >= 3, `${name} has labels`);
  }
  assert.ok(Object.keys(DOMAINS).length >= 18, 'covers the wiki domains');
});

test('unknown domain + no embedder soft-fails cleanly', async () => {
  const id = createIdentifier({ vision: {} });
  const out = await id.identify('x.jpg', 'pills');
  assert.equal(out.via, 'none'); // no classify on the vision stub
  assert.equal((await id.addExemplar('pills', 'x', 'y.jpg')).ok, false);
});
