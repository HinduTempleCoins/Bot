// hathor-knows.test.mjs — the unified knowledge front door. Pure routing + injected readers; fully
// offline (no network, no real reader imports), soft-fails to safe shapes, never throws.
import { test } from 'node:test';
import assert from 'node:assert';
import { ask, routeVertical, VERTICALS, __setReaders } from './hathor-knows.mjs';

// a recording set of fake readers so we can assert WHICH surface a question routes to, offline.
function fakeReaders(calls) {
  return {
    hierophant: async (q) => { calls.push(['hierophant', q]); return { answer: 'H: ' + q, sources: [{ title: 'Book of the Dead', link: 'https://example/bod' }] }; },
    coupons: async (q) => { calls.push(['coupons', q]); return { answer: 'C: ' + q, sources: [] }; },
    cannabis: async (q) => { calls.push(['cannabis', q]); return { answer: 'W: ' + q, sources: [] }; },
    system: async (q) => { calls.push(['system', q]); return { answer: 'S: ' + q, intent: 'price', grounded: true, sources: [] }; },
    directory: async (q) => { calls.push(['directory', q]); return { answer: 'D: ' + q, sources: [{ title: 'Travel', link: 'https://t' }] }; },
  };
}

test('routeVertical: specific verticals match their keywords; everything else → system', () => {
  assert.equal(routeVertical('what does the Book of the Dead say?'), 'hierophant');
  assert.equal(routeVertical('is there a coupon for nike?'), 'coupons');
  assert.equal(routeVertical('is cannabis legal in texas?'), 'cannabis');
  assert.equal(routeVertical('price of HIVE'), 'system');     // markets → system-query
  assert.equal(routeVertical('where can I trade ADA?'), 'system');
  assert.equal(routeVertical(''), 'empty');
});

test('a religion question routes to the Hierophant and carries its sources', async () => {
  const calls = [];
  __setReaders(fakeReaders(calls));
  const r = await ask('tell me about the Egyptian Book of the Dead');
  assert.equal(r.vertical, 'hierophant');
  assert.match(r.answer, /^H:/);
  assert.equal(r.grounded, true);
  assert.equal(r.sources[0].title, 'Book of the Dead');
  assert.ok(calls.some(([id]) => id === 'hierophant'));
  __setReaders(null);
});

test('a coupon question routes to coupons; a hemp question routes to cannabis', async () => {
  const calls = [];
  __setReaders(fakeReaders(calls));
  assert.equal((await ask('any cashback for adidas?')).vertical, 'coupons');
  assert.equal((await ask('best THC strain?')).vertical, 'cannabis');
  __setReaders(null);
});

test('markets/data questions fall through to the system-query front door', async () => {
  const calls = [];
  __setReaders(fakeReaders(calls));
  const r = await ask('price of bitcoin');
  assert.equal(r.vertical, 'price');     // system-query intent surfaces as the vertical
  assert.match(r.answer, /^S:/);
  assert.equal(r.grounded, true);
  __setReaders(null);
});

test('a weak/open system answer yields to the directory pointer for the long tail', async () => {
  const calls = [];
  const readers = fakeReaders(calls);
  // system returns only a weak open-templated answer → directory should take over
  readers.system = async (q) => ({ answer: 'weak', intent: 'open-templated', grounded: false });
  __setReaders(readers);
  const r = await ask('cheap flights to tokyo');   // not a specific vertical, not markets
  assert.equal(r.vertical, 'directory');
  assert.match(r.answer, /^D:/);
  assert.equal(r.sources[0].title, 'Travel');
  __setReaders(null);
});

test('a confident system answer beats the directory (markets win over a page pointer)', async () => {
  const calls = [];
  __setReaders(fakeReaders(calls));   // system here returns grounded:true
  const r = await ask('top hive-engine markets');
  assert.equal(r.vertical, 'price');  // the fake system intent
  assert.ok(!calls.some(([id]) => id === 'directory'), 'directory not consulted when system is confident');
  __setReaders(null);
});

test('empty question returns the menu, never throws', async () => {
  const r = await ask('   ');
  assert.equal(r.vertical, 'empty');
  assert.equal(r.grounded, false);
  assert.match(r.answer, /Hierophant|markets|Library/i);
});

test('a reader that throws soft-fails through to the next surface (never throws to caller)', async () => {
  const calls = [];
  const readers = fakeReaders(calls);
  readers.hierophant = async () => { throw new Error('reader blew up'); };
  __setReaders(readers);
  // hierophant throws → falls to system, which answers
  const r = await ask('what does the Bible say about angels?');
  assert.equal(r.vertical, 'price');   // system fake answered
  assert.match(r.answer, /^S:/);
  __setReaders(null);
});

test('total miss returns an honest fallback, never throws', async () => {
  __setReaders({
    system: async () => null,
    directory: async () => null,
  });
  const r = await ask('zxqw nonsense token that matches nothing');
  assert.equal(r.vertical, 'none');
  assert.equal(r.grounded, false);
  assert.match(r.answer, /don't have that/i);
  __setReaders(null);
});

test('VERTICALS registry is well-formed (id, label, callable test)', () => {
  for (const v of VERTICALS) {
    assert.ok(v.id && typeof v.id === 'string');
    assert.ok(v.label && typeof v.label === 'string');
    assert.equal(typeof v.test, 'function');
    assert.doesNotThrow(() => v.test('a harmless probe string'));
  }
});
