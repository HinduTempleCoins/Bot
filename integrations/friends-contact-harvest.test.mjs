// OFFLINE. Injected fetch, no network, no real site touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlsFor, harvestPage, harvestPerson, harvestAll, __setFetch, CONTACT_PATHS } from './friends-contact-harvest.mjs';

const person = (over = {}) => ({
  name: 'Jordan Coats', id: 'jc',
  enrichment: { business: { name: 'Coats Studio' }, links: ['https://coatsstudio.example'], sources: [] },
  ...over,
});
const page = (html) => ({ status: 200, text: async () => html });
const noSleep = { sleep: async () => {} };

test('urlsFor takes a person\'s own sites and drops what confers nothing', () => {
  const p = person({ enrichment: { links: [
    'https://coatsstudio.example',
    'https://linktr.ee/jordan',          // a hub is nobody's own site
    'https://twitter.com',               // a platform apex — was NOT caught until this list grew
    'not-a-url', '', null,
    'https://coatsstudio.example',       // duplicate
  ] } });
  assert.deepEqual(urlsFor(p), ['https://coatsstudio.example']);
  assert.deepEqual(urlsFor(null), []);
});

test('⭐ an address on the person\'s OWN domain is kept', () => {
  const hits = harvestPage('<a href="mailto:jordan@coatsstudio.example">email</a>',
    { site: 'https://coatsstudio.example', foundOn: 'https://coatsstudio.example/contact' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].ok, true, hits[0].why);
  assert.equal(hits[0].email, 'jordan@coatsstudio.example');
});

test('⚠️ THE SPAMINATOR LESSON — a third-party address on the page is refused', () => {
  // The holder harvest kept read.cash/contact 18 times and an amzn.to affiliate link. Those are a
  // support desk and a footer ad. Mailing them is what put the operator's Hive accounts in front of
  // Spaminator, and the same rule has to hold here or the same thing happens to a real friend's inbox.
  const html = `
    <a href="mailto:jordan@coatsstudio.example">mine</a>
    <a href="mailto:support@squarespace.com">platform support</a>
    <a href="mailto:pages@facebook.com">social platform</a>
    <a href="mailto:noreply@coatsstudio.example">role mailbox</a>`;
  const hits = harvestPage(html, { site: 'https://coatsstudio.example', foundOn: 'https://coatsstudio.example/contact' });
  const refused = Object.fromEntries(hits.filter((h) => !h.ok).map((h) => [h.email, h.verdict]));
  assert.ok(refused['support@squarespace.com'], 'a platform address must be refused');
  assert.ok(refused['pages@facebook.com'], 'a mainstream social apex is a platform too');
  assert.ok(refused['noreply@coatsstudio.example'], 'a noreply mailbox is not a person');
  assert.ok(hits.find((h) => h.email === 'jordan@coatsstudio.example').ok, "the person's own address survives");

  // ⚠️ NOT refused, and deliberately so — these are the module's actual rule, not an oversight:
  //   · info@ownsite is a small business's PUBLISHED contact address. pitch-letters warns it is the
  //     lowest-yield address rather than refusing it, and the two must agree.
  //   · an outside-domain address printed on the person's OWN contact page counts, because they chose
  //     to put it there — that is what 'published-on-site' means.
  const onOwnPage = harvestPage('<a href="mailto:info@coatsstudio.example">i</a><a href="mailto:jordan@gmail.com">g</a>',
    { site: 'https://coatsstudio.example', foundOn: 'https://coatsstudio.example/contact' });
  assert.ok(onOwnPage.every((h) => h.ok), 'both are routes the person published themselves');
});

test('a person with no site yields nothing and does not crash', async () => {
  __setFetch(async () => { throw new Error('should not be called'); });
  const r = await harvestPerson(person({ enrichment: { links: [] } }), noSleep);
  assert.deepEqual(r.kept, []);
  assert.equal(r.urls, 0);
  assert.equal(r.pagesRead, 0);
  __setFetch(null);
});

test('a dead site is a result, not an error', async () => {
  __setFetch(async () => ({ status: 404, text: async () => '' }));
  const r = await harvestPerson(person(), noSleep);
  assert.deepEqual(r.kept, []);
  assert.ok(r.results.every((x) => x.ok === false));

  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  const r2 = await harvestPerson(person(), noSleep);
  assert.deepEqual(r2.kept, [], 'a thrown fetch must not throw out of the harvester');
  __setFetch(null);
});

test('it stops as soon as it has one good address — this is a visit, not a scrape', async () => {
  let calls = 0;
  __setFetch(async () => { calls++; return page('<a href="mailto:jordan@coatsstudio.example">e</a>'); });
  const r = await harvestPerson(person(), noSleep);
  assert.equal(r.kept.length, 1);
  assert.equal(calls, 1, 'the first page had it; nothing else should have been fetched');
  __setFetch(null);
});

test('it tries the contact pages when the homepage has nothing', async () => {
  const seen = [];
  __setFetch(async (u) => { seen.push(u); return page(u.includes('/contact') ? '<a href="mailto:jordan@coatsstudio.example">e</a>' : '<p>nothing</p>'); });
  const r = await harvestPerson(person(), noSleep);
  assert.equal(r.kept.length, 1);
  assert.ok(seen.some((u) => u.endsWith('/contact')));
  assert.ok(CONTACT_PATHS.includes('/contact'));
  __setFetch(null);
});

test('harvestAll reports what it refused and why, not just what it kept', async () => {
  __setFetch(async () => page('<a href="mailto:support@squarespace.com">x</a><a href="mailto:jordan@coatsstudio.example">y</a>'));
  const out = await harvestAll([person(), person({ name: 'Ilissa Brown' })], noSleep);
  assert.equal(out.people, 2);
  assert.equal(out.withASite, 2);
  assert.equal(out.kept.length, 2);
  assert.ok(out.rejectedCount > 0);
  assert.ok(Object.keys(out.rejectedByReason).length, 'a refusal without a reason teaches nobody anything');
  __setFetch(null);
});

test('⛔ a template placeholder is not a person', async () => {
  // A live crawl returned `email@address.com` as a confident 'published-on-site' hit — the dummy
  // address a site template ships with, sitting in a footer nobody edited.
  const hits = harvestPage('<p>Contact: email@address.com</p><p>Real: owner@wtroofs.example</p>',
    { site: 'https://wtroofs.example', foundOn: 'https://wtroofs.example/contact' });
  const kept = hits.filter((h) => h.ok).map((h) => h.email);
  assert.ok(!kept.includes('email@address.com'), 'a harvester that cannot spot a placeholder will mail a template');
  assert.ok(kept.includes('owner@wtroofs.example'));
});
