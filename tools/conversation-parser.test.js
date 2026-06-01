// conversation-parser.test.js — proves the parser keeps the operator's VERBATIM words and files
// them as decisions/actions, ignores assistant turns + noise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConversation, toMoM } from './conversation-parser.mjs';

const MARKED = `
Human: We need to build the parser first. Make sure you keep my words verbatim.
Assistant: Sure, I'll build it. We need to add tests too.
Human: Ok thanks.
You: Don't paraphrase what I say, the briefs get worse.
`;

test('uses only operator turns when speakers are marked', () => {
  const p = parseConversation(MARKED);
  assert.equal(p.speakersKnown, true);
  // operator's "We need to build the parser first" -> action (it's a build directive), verbatim
  assert.ok(p.actions.some((a) => a.includes('We need to build the parser first')));
  // operator's "Make sure you keep my words verbatim" -> action
  assert.ok(p.actions.some((a) => a.includes('Make sure you keep my words verbatim')));
  // the assistant's "We need to add tests too" must NOT be captured
  assert.ok(!p.decisions.some((d) => d.includes('add tests')) && !p.actions.some((a) => a.includes('add tests')));
  // "Ok thanks." is noise -> dropped
  assert.ok(!p.decisions.concat(p.actions).some((s) => /Ok thanks/.test(s)));
});

test('preserves exact phrasing (no paraphrase)', () => {
  const p = parseConversation('Human: Go ahead and deploy the timer every 15 minutes.');
  assert.deepEqual(p.actions, ['Go ahead and deploy the timer every 15 minutes.']);
});

test('falls back to whole-text scan when speakers are unmarked', () => {
  const p = parseConversation('We need the trade bot to be intelligent. Make sure it records data.');
  assert.equal(p.speakersKnown, false);
  assert.ok(p.decisions.some((d) => /trade bot to be intelligent/.test(d)));
  assert.ok(p.actions.some((a) => /records data/.test(a)));
});

test('toMoM renders the brief-builder format', () => {
  const mom = toMoM(parseConversation('Human: We want VKBT weighted. Make sure it fires every 15 min.'), { title: 'T' });
  assert.match(mom, /## Decisions/);
  assert.match(mom, /## Action items/);
  assert.match(mom, /- \[ \] Make sure it fires every 15 min/);
});

test('empty/!o-signal text yields empty sections without crashing', () => {
  const mom = toMoM(parseConversation('Assistant: here is the result.\nHuman: cool'), { title: 'E' });
  assert.match(mom, /\(none extracted\)/);
});
