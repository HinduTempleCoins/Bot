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

test('⭐ it names the competitors, so it is a lesson and not an advert', () => {
  for (const s of SUCCESSORS) assert.ok(BODY.includes(s.name), `missing successor: ${s.name}`);
  assert.match(BODY, /better resourced than we are/);
  assert.match(BODY, /rather you write somewhere than nowhere/);
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

test('well-formed: title, permlink, balanced links, no placeholders', () => {
  assert.match(TITLE, /NaNoWriMo/);
  assert.match(PERMLINK, /^[a-z0-9-]+$/);
  assert.equal((BODY.match(/\[/g) || []).length, (BODY.match(/\]/g) || []).length);
  assert.doesNotMatch(BODY, /\{[a-z_]+\}|undefined|\[object/i);
  assert.ok(BODY.length > 4000 && BODY.length < 20000);
});
