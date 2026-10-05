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
  assert.match(BODY, /noticed the chair was empty/);
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

test('⭐ the no-payout promise is explicit and not hedged', () => {
  assert.match(BODY, /no payout and no score/i);
  assert.match(BODY, /Writing here earns nothing/);
  assert.doesNotMatch(BODY, /earn (MELEK|rewards|tokens)\b/i);
  // posting afterwards must be framed as separate and optional
  assert.match(BODY, /separate choice/);
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
  assert.match(TITLE, /NaNoWriMo/);
  assert.match(PERMLINK, /^[a-z0-9-]+$/);
  assert.equal((BODY.match(/\[/g) || []).length, (BODY.match(/\]/g) || []).length);
  assert.doesNotMatch(BODY, /\{[a-z_]+\}|undefined|\[object/i);
  assert.ok(BODY.length > 4000 && BODY.length < 20000);
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

test('⭐ it claims the month instead of abdicating it', async () => {
  // This is a takeover, not a humble entry in a list of successors. The old copy said "I would
  // rather you write somewhere than nowhere", which hands the month to whoever else shows up.
  assert.match(TITLE, /Taking November/);
  assert.match(BODY, /we are taking the month off the floor/);
  assert.match(BODY, /What died was an organisation\. What is vacant is a role\. We want it\./);
  assert.match(BODY, /belongs to whoever shows up on the 1st/);
  assert.doesNotMatch(BODY, /rather you write somewhere than nowhere/);
  assert.doesNotMatch(BODY, /better resourced than we are/);
});

test('⭐ the differentiator is stated as a checkable claim, not a boast', async () => {
  const { SUCCESSORS } = await import('../site/writing/history.mjs');
  // Every platform successor requires an account on someone's server — which is the failure that
  // lost 25 years of archives. The post must make that argument, and name them while doing it.
  assert.match(BODY, /where does your draft live/i);
  assert.match(BODY, /rebuilt the exact failure/);
  assert.match(BODY, /cannot do it to you/);
  for (const n of ['Reedsy', 'ProWritingAid', 'World Anvil', '4thewords', 'Authorlytica']) {
    assert.ok(BODY.includes(n), `the argument must name ${n}`);
  }
  assert.ok(SUCCESSORS.length >= 10);
  // still not sneering at them — they stay credited as real options
  assert.match(BODY, /If one of the others suits you better, use it/);
});
