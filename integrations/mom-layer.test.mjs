// mom-layer.test.mjs — offline tests (node:test). Fully deterministic (fixed clock), no fs/network.
// Covers: summarizeToMinutes builds a structured MoM with NO transcript field; extractActionItems pulls
// "we will X" / "TODO: Y" / "owner: Z" / @name / imperative lines; forBriefWriter omits any raw /
// transcript / private / attendees field; appendMinutes is append-only; SCRUM_TEMPLATES has the three
// scaffolds; renderMinutes outputs markdown.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeToMinutes,
  extractActionItems,
  forBriefWriter,
  isBriefWriterSafe,
  appendMinutes,
  createMinutesStore,
  SCRUM_TEMPLATES,
  renderMinutes,
} from './mom-layer.mjs';

const CLOCK = () => Date.parse('2026-06-04T18:00:00Z');

const SAMPLE = {
  conferenceId: '12-and-12 / 2026-06-04',
  attendees: ['Claude Code', 'Qwen', 'ensemble'],
  notes: [
    'We discussed the brief pipeline at length.',
    'We will wire the MoM layer into the briefs.',
    'TODO: add SCRUM datasets to the repo.',
    'owner: Qwen — summarize the conference nightly',
    '@claude will ship the tests',
    'Build the conversation-parsing pipeline.',
    'Open question: should attendees be attributed?',
    'Is the append-only invariant enforced?',
  ].join('\n'),
  decisions: [
    'Brief-writers read the MoM layer, not raw transcripts.',
    'Minutes are append-only.',
  ],
  actionItems: [{ text: 'Ship mom-layer.mjs', owner: 'Claude Code' }],
};

test('summarizeToMinutes builds a structured MoM record — and has NO transcript field', () => {
  const mom = summarizeToMinutes(SAMPLE, { now: CLOCK });

  assert.equal(typeof mom.id, 'string');
  assert.ok(mom.id.startsWith('mom:'));
  assert.equal(mom.at, '2026-06-04T18:00:00.000Z'); // deterministic from the injected clock
  assert.deepEqual(mom.attendees, ['Claude Code', 'Qwen', 'ensemble']);
  assert.ok(Array.isArray(mom.decisions) && mom.decisions.length === 2);
  assert.ok(Array.isArray(mom.actionItems) && mom.actionItems.length >= 1);
  assert.ok(Array.isArray(mom.topics));
  assert.ok(Array.isArray(mom.openQuestions) && mom.openQuestions.length >= 1);

  // THE load-bearing invariant: minutes are distilled, NOT a transcript.
  assert.ok(!('transcript' in mom), 'no transcript field on a MoM record');
  assert.ok(!('raw' in mom), 'no raw field');
  assert.ok(!('notes' in mom), 'no notes/log field — minutes are not a log');
  assert.ok(!('conversation' in mom), 'no conversation field');

  // the explicit action item survived
  assert.ok(mom.actionItems.some((a) => /Ship mom-layer/.test(a.text) && a.owner === 'Claude Code'));
});

test('summarizeToMinutes is deterministic given a fixed clock', () => {
  const a = summarizeToMinutes(SAMPLE, { now: CLOCK });
  const b = summarizeToMinutes(SAMPLE, { now: CLOCK });
  assert.deepEqual(a, b);
});

test('summarizeToMinutes soft-fails on empty input', () => {
  const mom = summarizeToMinutes({}, { now: CLOCK });
  assert.equal(mom.conferenceId, null);
  assert.deepEqual(mom.attendees, []);
  assert.deepEqual(mom.decisions, []);
  assert.deepEqual(mom.actionItems, []);
  assert.ok(!('transcript' in mom));
  const empty = summarizeToMinutes(undefined, { now: CLOCK });
  assert.equal(typeof empty.id, 'string');
});

test('extractActionItems pulls "we will X", "TODO: Y", "owner: Z" and @name lines', () => {
  const items = extractActionItems([
    'Some background prose that is not an action.',
    'We will wire the MoM layer in.',
    'TODO: add SCRUM datasets',
    'owner: Qwen — summarize the conference nightly',
    '@claude will ship the tests',
    'Build the parser next',          // leading imperative
    'just a remark, nothing to do',   // ignored
  ]);

  const texts = items.map((i) => i.text);
  assert.ok(texts.some((t) => /wire the MoM layer/.test(t)), 'we will → action item');
  assert.ok(texts.some((t) => /add SCRUM datasets/.test(t)), 'TODO → action item');

  const ownerItem = items.find((i) => i.owner === 'Qwen');
  assert.ok(ownerItem && /summarize the conference/.test(ownerItem.text), 'owner: → owner captured');

  const atItem = items.find((i) => i.owner === 'claude');
  assert.ok(atItem && /ship the tests/.test(atItem.text), '@name → owner captured');

  assert.ok(texts.some((t) => /^Build the parser/.test(t)), 'leading imperative → action item');
  assert.ok(!texts.some((t) => /just a remark/.test(t)), 'non-action prose ignored');

  // every item carries a status
  assert.ok(items.every((i) => i.status === 'open'));
});

test('extractActionItems handles non-string / empty input', () => {
  assert.deepEqual(extractActionItems(null), []);
  assert.deepEqual(extractActionItems(''), []);
  assert.deepEqual(extractActionItems('   '), []);
});

test('forBriefWriter omits raw / transcript / private / attendees fields', () => {
  // build a record then deliberately graft on private fields, as if it carried more than minutes.
  const mom = summarizeToMinutes(SAMPLE, { now: CLOCK });
  const polluted = {
    ...mom,
    transcript: 'Claude: ... Qwen: ... (the full raw conversation)',
    raw: 'raw bytes',
    notes: 'the meeting notes log',
    conversation: [{ who: 'Claude', text: 'secret aside' }],
    operatorPrivate: 'app-password / vault token never for the AIs',
    secret: 'do-not-leak',
  };

  const view = forBriefWriter(polluted);

  // the view carries ONLY the brief-writer-safe fields
  assert.ok('decisions' in view);
  assert.ok('actionItems' in view);
  assert.ok('openQuestions' in view);
  assert.ok('topics' in view);

  // and NONE of the raw/private ones
  for (const k of ['transcript', 'raw', 'notes', 'conversation', 'operatorPrivate', 'secret', 'attendees']) {
    assert.ok(!(k in view), `forBriefWriter must omit "${k}"`);
  }

  // belt-and-suspenders: the JSON serialization contains no private content at all
  const json = JSON.stringify(view);
  assert.ok(!/raw conversation|secret aside|do-not-leak|vault token|app-password/.test(json),
    'no private content leaks into the brief-writer view');

  // the safety guard agrees
  assert.equal(isBriefWriterSafe(view), true);
  assert.equal(isBriefWriterSafe(polluted), false);

  // content preserved
  assert.deepEqual(view.decisions, mom.decisions);
  assert.ok(view.actionItems.length === mom.actionItems.length);
});

test('appendMinutes is append-only (never deletes or mutates existing records)', () => {
  const store = createMinutesStore();
  const m1 = summarizeToMinutes({ ...SAMPLE, conferenceId: 'conf-1' }, { now: CLOCK });
  const m2 = summarizeToMinutes({ ...SAMPLE, conferenceId: 'conf-2' }, { now: () => CLOCK() + 1000 });

  const r1 = appendMinutes(m1, { store });
  assert.deepEqual(r1, { ok: true, size: 1 });
  const r2 = appendMinutes(m2, { store });
  assert.deepEqual(r2, { ok: true, size: 2 });

  const list = store.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].conferenceId, 'conf-1');
  assert.equal(list[1].conferenceId, 'conf-2');

  // store exposes no delete/clear surface — append-only by construction
  assert.equal(typeof store.delete, 'undefined');
  assert.equal(typeof store.clear, 'undefined');
  assert.equal(typeof store.remove, 'undefined');

  // the first record is unchanged after the second append
  assert.equal(list[0].id, m1.id);
});

test('appendMinutes soft-fails without a usable store', () => {
  const mom = summarizeToMinutes(SAMPLE, { now: CLOCK });
  assert.deepEqual(appendMinutes(mom, {}), { ok: false });
  assert.deepEqual(appendMinutes(mom, { store: {} }), { ok: false });
  assert.deepEqual(appendMinutes(null, { store: createMinutesStore() }), { ok: false });
});

test('SCRUM_TEMPLATES has standup, retro and mom scaffolds', () => {
  assert.ok(SCRUM_TEMPLATES.mom, 'mom template');
  assert.ok(SCRUM_TEMPLATES.standup, 'standup template');
  assert.ok(SCRUM_TEMPLATES.retro, 'retro template');

  assert.deepEqual(SCRUM_TEMPLATES.standup.fields, ['yesterday', 'today', 'blockers']);
  assert.ok(SCRUM_TEMPLATES.standup.questions.length === 3);
  assert.ok(SCRUM_TEMPLATES.retro.prompts.length === 3);
  assert.ok(SCRUM_TEMPLATES.mom.fields.includes('decisions'));
  assert.ok(SCRUM_TEMPLATES.mom.fields.includes('actionItems'));

  // frozen (reference data, not mutable)
  assert.throws(() => { SCRUM_TEMPLATES.standup = {}; }, TypeError);
  assert.ok(Object.isFrozen(SCRUM_TEMPLATES.mom));
});

test('renderMinutes outputs markdown', () => {
  const mom = summarizeToMinutes(SAMPLE, { now: CLOCK });
  const md = renderMinutes(mom);

  assert.equal(typeof md, 'string');
  assert.ok(md.startsWith('# Minutes — 12-and-12'), 'markdown H1 title');
  assert.ok(md.includes('## Decisions'));
  assert.ok(md.includes('## Action items'));
  assert.ok(md.includes('## Open questions'));
  assert.ok(md.includes('- [ ] '), 'action items rendered as checkboxes');
  assert.ok(md.includes('Brief-writers read the MoM layer'), 'decision text rendered');
  assert.ok(/no transcript/i.test(md), 'footer states minutes carry no transcript');

  // markdown view also must not embed a raw transcript
  assert.ok(!/transcript:/i.test(md.replace(/no transcript/i, '')));
});

test('renderMinutes handles an empty record without throwing', () => {
  const md = renderMinutes({});
  assert.ok(md.includes('# Minutes'));
  assert.ok(md.includes('_none recorded_'));
});
