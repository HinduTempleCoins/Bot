// Offline. The post must teach the CORRECTED history and must not become an advert.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TITLE, BODY, PERMLINK } from './hathor-writing-room-announcement.mjs';
import { SUCCESSORS, UNVERIFIED } from '../site/writing/history.mjs';

test('⭐ no paragraph is hard-wrapped — the condenser turns a single newline into a line break', () => {
  const offenders = BODY.split('\n\n')
    .filter((b) => b.includes('\n'))
    .filter((b) => !b.split('\n').every((l) => /^(- |#|\d\. )/.test(l)));
  assert.deepEqual(offenders.map((b) => b.slice(0, 60)), []);
  for (const l of BODY.split('\n')) assert.equal(/^\s+\S/.test(l), false, `continuation line: ${l.slice(0, 50)}`);
});

test('⭐ it teaches the three corrections, not the popular version', () => {
  assert.match(BODY, /unrelated code-of-conduct violations/);
  assert.match(BODY, /not established as a resignation/);
  assert.match(BODY, /deficit in four of the previous six years/);
  // the popular one-liner must be named AND refuted, never asserted
  assert.match(BODY, /"it died over AI\.?" is/i);
  assert.match(BODY, /not what the arithmetic says|were not the sole cause/);
});

test('⭐ it names every competitor honestly while still claiming the month', () => {
  // Naming them is credibility, not deference: the list is what makes the "where does your draft
  // live" argument land. What it must NOT do is hand them the month.
  for (const s of SUCCESSORS) assert.ok(BODY.includes(s.name), `missing successor: ${s.name}`);
  assert.match(BODY, /including the ones with more money than us/);
  assert.match(BODY, /Plenty of people kept November going/);
});

test('⭐ it owns the mistake it made about the four groups', () => {
  // All four are real. The post must name them AND say it got them wrong, in Hathor's own voice.
  for (const token of ['PaWriCo', 'Order of the Written Word', 'NaNo 2.0', 'Novel 90']) {
    assert.ok(BODY.includes(token), `${token} must be named as real`);
  }
  assert.match(BODY, /I got it wrong first/);
  assert.match(BODY, /Absence from a single search result is not absence from the world/);
  assert.match(BODY, /I am the sort of thing that makes that mistake confidently/);
  // and it must not still be claiming they are unconfirmed
  assert.doesNotMatch(BODY, /could not confirm exist at all/);
});

test('⭐ the draft/process split is explicit and not hedged', () => {
  // The DRAFT is never scored or paid. The shared PROCESS can be. Both halves must be unambiguous.
  assert.match(BODY, /The draft is not scored and not paid/);
  assert.match(BODY, /nobody gets money here for hitting a word count/);
  assert.match(BODY, /it can earn, across the whole month/);
  assert.match(BODY, /entirely optional/);
  assert.match(BODY, /never see a word of your manuscript unless you post it yourself/);
});

test('⭐ the privacy claim matches what the surface actually does', () => {
  assert.match(BODY, /never leaves your browser/);
  assert.match(BODY, /no server-side copy/);
  assert.match(BODY, /cannot read your draft/);
  assert.match(BODY, /export button is the most important control/);
});

test('it takes no side on AI, and says why that is deliberate', () => {
  assert.match(BODY, /I am an AI/);
  assert.match(BODY, /I do neither/);
  assert.doesNotMatch(BODY, /AI is (fine|bad|cheating)/i);
});

test('⭐ it teaches The Watch and links the genre map', () => {
  assert.match(BODY, /October is the watch\. November is the writing\./);
  assert.match(BODY, /ideas do not arrive in an empty room/);
  // we send watchers to the 13-year-old tradition too, same as we name the writing competitors
  assert.match(BODY, /Hooptober/);
  assert.match(BODY, /horror\/map/);
  assert.match(BODY, /girl-has-to-kill-everyone/);
  assert.match(BODY, /You do not have to write horror/);
  assert.match(BODY, /only painted on/);
  // and the old term is gone from the reader-facing copy
  assert.doesNotMatch(BODY, /Preptober/);
});

test('well-formed: title, permlink, balanced links, no placeholders', () => {
  assert.match(TITLE, /National Novel Writing Month/);
  assert.match(PERMLINK, /^[a-z0-9-]+$/);
  assert.equal((BODY.match(/\[/g) || []).length, (BODY.match(/\]/g) || []).length);
  assert.doesNotMatch(BODY, /\{[a-z_]+\}|undefined|\[object/i);
  // Long on purpose: a full timeline, 11 successors, 7 October traditions, 5 national months and the
  // design argument. The ceiling is a guard against runaway generation, not a style limit.
  assert.ok(BODY.length > 4000 && BODY.length < 28000, `body is ${BODY.length} chars`);
});

test('⭐ the child-safety position is stated before the timeline and is not even-handed', () => {
  assert.match(BODY, /not going to be even-handed about/);
  assert.match(BODY, /against this without qualification/);
  assert.match(BODY, /should outrank every other consideration/);
  assert.ok(BODY.indexOf('even-handed') < BODY.indexOf('Chris Baty'), 'position comes before the timeline');
});

test('⭐ it names the other October traditions too', async () => {
  const { WATCHING } = await import('../site/writing/watching.mjs');
  for (const w of WATCHING) assert.ok(BODY.includes(w.name), `missing: ${w.name}`);
  // ⭐ name them, do not send readers to them over us, and keep our own word ours
  assert.match(BODY, /\*\*The Watch\*\* is our name for it/);
  assert.doesNotMatch(BODY, /better at this than we are/);
  assert.doesNotMatch(BODY, /you should probably just do it/);
});

test('the word "pedagogy" never appears — this is not only about children', () => {
  assert.doesNotMatch(BODY, /pedagog/i);
});

test('⭐ it claims the month as a NATIONAL MONTH, and does not gloat over a corpse', () => {
  // The frame is not "the company died". Most people never knew there was a company — they knew a
  // month. A national observance does not belong to whoever was hosting the scoreboard.
  assert.match(TITLE, /Still National Novel Writing Month/);
  assert.match(BODY, /was a month, and separately there was a charity that ran the website/);
  assert.match(BODY, /National Poetry Month/);
  assert.match(BODY, /Nobody needs permission to observe November/);
  assert.match(BODY, /the month never left/);
  assert.match(BODY, /belongs to whoever shows up on the 1st/);
  // no death-notice framing, and no abdication either
  assert.doesNotMatch(TITLE, /Dead/i);
  assert.doesNotMatch(BODY, /rather you write somewhere than nowhere/);
});

test('⭐ the WHY is paying writers, and it is the operator\'s own story — not an invented one', () => {
  // Do not invent a why. The reason is: people should get paid to write and elsewhere they are not,
  // and the founder did NaNoWriMo by hand on DevTome, where writing paid.
  assert.match(BODY, /people should get paid to write/);
  assert.match(BODY, /did NaNoWriMo by hand on DevTome/);
  assert.match(BODY, /He wrote about Hannibal/);
  assert.match(BODY, /You write, you post, you get paid/);
  // attributed to the man who runs the chain, NOT claimed by Hathor
  assert.match(BODY, /The man who runs this chain/);
  assert.doesNotMatch(BODY, /I did NaNoWriMo/);
  // and the old invented architecture argument is gone
  assert.doesNotMatch(BODY, /rebuilt the exact failure/);
  // competitors still named and still credited
  for (const n of ['Reedsy', 'ProWritingAid', 'World Anvil', '4thewords', 'Authorlytica']) {
    assert.ok(BODY.includes(n), `must still name ${n}`);
  }
  assert.match(BODY, /If one of the others suits you better, use it/);
});

test('⭐ the national-month claim is evidenced, not just asserted', async () => {
  const { CALENDAR } = await import('../site/writing/calendar.mjs');
  for (const c of CALENDAR) {
    assert.ok(BODY.includes(c.name), `missing: ${c.name}`);
    assert.ok(BODY.includes(c.by), `${c.name} must credit who started it`);
  }
  assert.match(BODY, /Black History Month and Women's History Month/);
  assert.match(BODY, /caretakers can be replaced/);
  // NaNoGenMo is the strongest case: November, no organisation, outlived the charity
  assert.match(BODY, /NaNoGenMo/);
  assert.match(BODY, /Darius Kazemi/);
});

test('⭐ the post carries freshly generated images, not repo art', () => {
  const imgs = [...BODY.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)];
  assert.ok(imgs.length >= 3, `expected 3+ images, got ${imgs.length}`);
  for (const [, alt, url] of imgs) {
    assert.ok(alt.length > 10, `every image needs real alt text: "${alt}"`);
    assert.match(url, /^https:\/\/hathor\.soapbox\.community\/img\//, 'images must be Studio-generated and hosted');
  }
});

test('⭐ the draft stays unpaid while the shared process can earn', () => {
  assert.match(BODY, /The draft is not scored and not paid/);
  assert.match(BODY, /nobody gets money here for hitting a word count/);
  assert.match(BODY, /the other half of what the old forums were for can pay/i);
  assert.match(BODY, /free labour on somebody else's server/);
  assert.match(BODY, /never see a word of your manuscript unless you post it yourself/);
});
