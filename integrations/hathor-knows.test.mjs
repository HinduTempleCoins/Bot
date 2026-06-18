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

test('routeVertical: law + politics keywords route to their verticals', () => {
  assert.equal(routeVertical('what does 7 U.S.C. 1639o say?'), 'law');     // statute citation
  assert.equal(routeVertical('summarize the supreme court ruling'), 'law');
  assert.equal(routeVertical('who is my senator in Texas?'), 'politics');
  assert.equal(routeVertical('campaign finance for that candidate'), 'politics');
  // cannabis is checked before law, so a hemp-legality question stays cannabis
  assert.equal(routeVertical('is cannabis legal in texas?'), 'cannabis');
});

test('law + politics questions route to their readers and carry sources', async () => {
  const calls = [];
  const readers = fakeReaders(calls);
  readers.law = async (q) => { calls.push(['law', q]); return { answer: 'L: ' + q, sources: [{ title: 'Cornell LII', link: 'https://law' }] }; };
  readers.politics = async (q) => { calls.push(['politics', q]); return { answer: 'P: ' + q, sources: [{ title: 'Politics', link: 'https://pol' }] }; };
  __setReaders(readers);
  const a = await ask('what does 21 U.S.C. 802 define?');
  assert.equal(a.vertical, 'law');
  assert.match(a.answer, /^L:/);
  assert.equal(a.sources[0].title, 'Cornell LII');
  const b = await ask('who are the senators from California?');
  assert.equal(b.vertical, 'politics');
  assert.match(b.answer, /^P:/);
  __setReaders(null);
});

test('a law/politics reader returning null falls through to the directory pointer', async () => {
  const calls = [];
  const readers = fakeReaders(calls);
  readers.law = async () => null;        // no data this pass
  readers.system = async () => ({ answer: 'weak', intent: 'open-templated', grounded: false });
  __setReaders(readers);
  const r = await ask('the supreme court case about that');
  assert.equal(r.vertical, 'directory');  // directory pointer covers the miss
  __setReaders(null);
});

test('routeVertical: credentialing questions route to the credentials vertical', () => {
  assert.equal(routeVertical('how do I get TEFL certified?'), 'credentials');
  assert.equal(routeVertical('free college credit with CLEP'), 'credentials');
  assert.equal(routeVertical('what is an IACET CEU?'), 'credentials');
  assert.equal(routeVertical('CompTIA Security+ certification'), 'credentials');
});

test('the credentials reader answers from the catalog (offline, real data)', async () => {
  __setReaders(null); // use the real default readers (credentials catalog is pure/offline)
  const r = await ask('how do I get certified to teach English?', { llm: false });
  assert.equal(r.vertical, 'credentials');
  assert.match(r.answer, /TEFL|TESOL|CELTA/);
  assert.ok(r.sources.some((s) => /credentials\.soapbox\.community|cambridge|tesol|tefl/i.test(s.link)));
});

test('VERTICALS registry is well-formed (id, label, callable test)', () => {
  for (const v of VERTICALS) {
    assert.ok(v.id && typeof v.id === 'string');
    assert.ok(v.label && typeof v.label === 'string');
    assert.equal(typeof v.test, 'function');
    assert.doesNotThrow(() => v.test('a harmless probe string'));
  }
});
