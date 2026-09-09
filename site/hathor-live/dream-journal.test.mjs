// dream-journal.test.mjs — R1, tested. Fully offline: the store's IO is injected, no fs, no network.
//
// The load-bearing test in this file is `⚠️ THE RAW PARTICIPANT KEY IS ABSENT FROM THE WRITTEN
// BYTES`. Everything else here is ordinary correctness; that one is the reason the build is allowed
// to exist. Dream content is the most intimate data on this site, so the assertion is not "we do not
// think we store the key" — it is a grep over exactly the bytes the store handed to IO, for the key
// and for every casing and grouping of it a careless caller could have produced.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esc, JOURNAL_ID, ROUTE, SHARE, CITATIONS, CHECKS, FIELDS,
  citation, checkStatus, testedChecks, cautionedChecks,
  within, lightSwitchTally, exportRecord, dreamJournalPageHTML, handler,
  LUCIDITY_LEVELS, RECALL_LEVELS, LIGHT_SWITCH_OUTCOMES, num,
} from './dream-journal.mjs';

import store, {
  __setIO, normaliseEntry, appendEntry, entriesFor, forget, participantCount,
} from './dream-journal-store.mjs';

import { participantId, formatKey, KEY_LENGTH } from './participant-key.mjs';

// A fake filesystem that records every byte written, so the privacy assertions can inspect them.
function fakeIO() {
  const files = new Map();
  return {
    files,
    read(p) { return files.get(p) || ''; },
    append(p, line) { files.set(p, (files.get(p) || '') + line); return true; },
    replace(p, contents) { files.set(p, contents); return true; },
    all() { return [...files.values()].join('\n'); },
  };
}

const FILE = '/dev/null/dreams.jsonl'; // never touched — the IO above is injected
// A real 25-symbol Crockford key, of exactly the shape participant-key.mjs generates.
const RAW_KEY = 'H4TH0R9QXKM2VWZ3B7NPC5RJ8';

test.after(() => __setIO(null));

// --- ⚠️ the privacy proof ----------------------------------------------------

test('⚠️ THE RAW PARTICIPANT KEY IS ABSENT FROM THE WRITTEN BYTES — grep returns 0', () => {
  const io = fakeIO();
  __setIO(io);
  assert.equal(RAW_KEY.length, KEY_LENGTH, 'the fixture must be a real-shaped key');

  // The boundary: the key is hashed HERE, and only the hash goes further. This is the same call the
  // server makes, so the test drives the real path rather than a paraphrase of it.
  const pid = participantId(RAW_KEY);
  assert.ok(pid && pid.length >= 32);
  assert.notEqual(pid, RAW_KEY);

  // And a caller who passes the key in the entry body by habit must have it dropped, not written.
  const r = appendEntry(pid, {
    night: '2026-09-08',
    text: 'A corridor of doors, and behind one of them the sea.',
    tags: ['water', 'doors'],
    recall: 'scene',
    lucidity: 2,
    key: RAW_KEY,            // ⛔ the habit this must survive
    participantKey: RAW_KEY, // ⛔ and this one
    email: 'someone@example.com',
    name: 'a person',
  }, { file: FILE, now: () => new Date('2026-09-08T06:12:00Z') });
  assert.equal(r.ok, true);

  const bytes = io.all();
  assert.ok(bytes.length > 0, 'something must actually have been written, or the grep proves nothing');

  // The grep. Every form a raw key could take on the way to disk.
  const forms = [
    RAW_KEY,
    RAW_KEY.toLowerCase(),
    formatKey(RAW_KEY),               // grouped XXXXX-XXXXX-…
    formatKey(RAW_KEY).toLowerCase(),
    RAW_KEY.slice(0, 10),             // even a prefix is a leak
  ];
  for (const f of forms) {
    const count = bytes.split(f).length - 1;
    assert.equal(count, 0, `raw key form found in the store bytes: ${f}`);
  }
  // The other identifiers a habitual caller might have attached.
  assert.equal(bytes.includes('someone@example.com'), false, 'an email reached disk');
  assert.equal(bytes.includes('"name"'), false, 'a name field reached disk');
  // The hash IS there — that is the point; it is what makes the record deletable by its owner.
  assert.ok(bytes.includes(pid));
});

test('normaliseEntry strips key-shaped and identifying fields rather than ignoring them', () => {
  const e = normaliseEntry({
    key: 'X', participantKey: 'X', rawKey: 'X', secret: 'X',
    name: 'X', email: 'X', phone: 'X', text: 'kept',
  });
  for (const f of ['key', 'participantKey', 'rawKey', 'secret', 'name', 'email', 'phone']) {
    assert.equal(Object.hasOwn(e, f), false, `${f} survived normaliseEntry`);
  }
  assert.equal(e.text, 'kept');
});

test('nothing in this build goes on chain, is payable, or is shareable', () => {
  assert.equal(SHARE.onChain, false);
  assert.equal(SHARE.payable, false);
  assert.equal(SHARE.shareCard, false);
  assert.equal(SHARE.percentile, false);
  assert.equal(SHARE.comparison, false);
  assert.equal(SHARE.interpretation, false);
  assert.equal(SHARE.grade, 3);
  // The refusal must carry its reason, so deleting it is a visible act rather than a diff of `false`.
  assert.ok(SHARE.why.length > 80);
  assert.match(SHARE.interpretationWhy, /never a diagnosis/i);
});

test('⛔ there is NO cross-participant content read path in the store', () => {
  // exams-store.mjs has distribution() and readSittings() because a percentile needs a denominator.
  // A within-person journal has no such need, so no such function may exist here.
  for (const forbidden of ['distribution', 'readAll', 'readEntries', 'allEntries', 'readSittings', 'search']) {
    assert.equal(typeof store[forbidden], 'undefined', `${forbidden}() must not exist on the journal store`);
  }
  // And the one content reader refuses without a participant id, rather than returning everything.
  __setIO(fakeIO());
  assert.deepEqual(entriesFor(null, { file: FILE }), []);
  assert.deepEqual(entriesFor('', { file: FILE }), []);
  assert.deepEqual(entriesFor(undefined, { file: FILE }), []);
});

test('one participant cannot read another’s entries', () => {
  const io = fakeIO();
  __setIO(io);
  const a = participantId(RAW_KEY);
  const b = participantId('QQQQQ11111WWWWW22222EEEEE');
  appendEntry(a, { text: 'mine', night: '2026-09-01' }, { file: FILE });
  appendEntry(b, { text: 'theirs', night: '2026-09-01' }, { file: FILE });
  assert.equal(entriesFor(a, { file: FILE }).length, 1);
  assert.equal(entriesFor(a, { file: FILE })[0].text, 'mine');
  assert.equal(entriesFor(b, { file: FILE })[0].text, 'theirs');
  // The only aggregate counts people and touches no content.
  assert.equal(participantCount({ file: FILE }), 2);
});

test('⚠️ forget ACTUALLY EMPTIES IT — the bytes are gone, not hidden behind a tombstone', () => {
  const io = fakeIO();
  __setIO(io);
  const a = participantId(RAW_KEY);
  const b = participantId('QQQQQ11111WWWWW22222EEEEE');
  appendEntry(a, { text: 'the sea behind the door', night: '2026-09-01' }, { file: FILE });
  appendEntry(a, { text: 'a second dream', night: '2026-09-02' }, { file: FILE });
  appendEntry(b, { text: 'somebody else entirely', night: '2026-09-01' }, { file: FILE });
  assert.ok(io.all().includes('the sea behind the door'));

  const r = forget(a, { file: FILE });
  assert.equal(r.ok, true);
  assert.equal(r.removed, 2);
  assert.equal(r.method, 'rewritten', 'a tombstone is not a deletion for dream text');

  // The text is GONE from the file, not merely filtered on read.
  assert.equal(io.all().includes('the sea behind the door'), false);
  assert.equal(io.all().includes('a second dream'), false);
  assert.equal(io.all().includes(a), false, 'even the hashed id is gone');
  // And the other person is untouched.
  assert.ok(io.all().includes('somebody else entirely'));
  assert.deepEqual(entriesFor(a, { file: FILE }), []);
  assert.equal(entriesFor(b, { file: FILE }).length, 1);
  assert.equal(participantCount({ file: FILE }), 1);
});

test('a failed rewrite is reported as a FAILED deletion, never as a success', () => {
  // Charter: prove, don't claim. If the bytes could not be removed, the person is told.
  const io = fakeIO();
  io.replace = () => false;
  __setIO(io);
  const a = participantId(RAW_KEY);
  appendEntry(a, { text: 'still here', night: '2026-09-01' }, { file: FILE });
  const r = forget(a, { file: FILE });
  assert.equal(r.ok, false);
  assert.equal(r.method, 'tombstoned-only');
  assert.match(r.reason, /not the deletion you asked for/i);
  // The rows are at least hidden from every read path, which is what the tombstone buys.
  assert.deepEqual(entriesFor(a, { file: FILE }), []);
});

test('forgetting somebody with no entries is honest about having removed nothing', () => {
  __setIO(fakeIO());
  const r = forget(participantId(RAW_KEY), { file: FILE });
  assert.equal(r.ok, true);
  assert.equal(r.removed, 0);
  assert.equal(r.method, 'nothing-to-remove');
});

// --- ⚠️ the null / Number(null) family ---------------------------------------

test('⚠️ null is passed EXPLICITLY everywhere — `= {}` only fires for undefined', () => {
  __setIO(fakeIO());
  const pid = participantId(RAW_KEY);
  assert.doesNotThrow(() => appendEntry(pid, null, { file: FILE }));
  assert.doesNotThrow(() => appendEntry(pid, { text: 'x' }, null));
  assert.doesNotThrow(() => appendEntry(null, null, null));
  assert.doesNotThrow(() => entriesFor(pid, null));
  assert.doesNotThrow(() => forget(pid, null));
  assert.doesNotThrow(() => forget(null, null));
  assert.doesNotThrow(() => participantCount(null));
  assert.doesNotThrow(() => normaliseEntry(null));
  assert.doesNotThrow(() => within(null, null));
  assert.doesNotThrow(() => within([], null));
  assert.doesNotThrow(() => lightSwitchTally(null));
  assert.doesNotThrow(() => exportRecord(null, null));
  assert.doesNotThrow(() => dreamJournalPageHTML(null));
  assert.doesNotThrow(() => citation(null));
  assert.doesNotThrow(() => checkStatus(null));
});

test('⚠️ num(null) is null, NOT 0 — Number(null) === 0 and that would be a silent wrong answer', () => {
  assert.equal(Number(null), 0, 'the hazard this guard exists for');
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num(''), null);
  assert.equal(num('  '), null); // Number('  ') is 0 too
  assert.equal(num(true), null); // Number(true) is 1
  assert.equal(num(false), null);
  assert.equal(num([]), null);   // Number([]) is 0
  assert.equal(num('abc'), null);
  assert.equal(num(0), 0);
  assert.equal(num('7'), 7);
});

test('⚠️ windowDays: null means the WHOLE record, not a zero-day window', () => {
  const rows = [
    { at: '2020-01-01T00:00:00Z', night: '2020-01-01', recall: 'full', lucidity: 3 },
    { at: '2026-09-08T00:00:00Z', night: '2026-09-08', recall: 'scene', lucidity: 0 },
  ];
  const now = new Date('2026-09-09T00:00:00Z');
  // Explicit null must behave like "no window" — a Number(null)===0 bug would report 0 entries here.
  assert.equal(within(rows, { windowDays: null, now }).entries, 2);
  assert.equal(within(rows, { windowDays: undefined, now }).entries, 2);
  assert.equal(within(rows, { windowDays: '', now }).entries, 2);
  assert.equal(within(rows, null).entries, 2);
  // And a real window still narrows.
  assert.equal(within(rows, { windowDays: 30, now }).entries, 1);
});

// --- within-person measures --------------------------------------------------

test('⛔ within() returns counts and proportions of THIS person, and no percentile', () => {
  const rows = [
    { at: '2026-09-01T06:00:00Z', night: '2026-09-01', recall: 'scene', lucidity: 2, backfilled: false, lagDays: 0, checksDone: [{ check: 're-reading', doubtHeld: true }] },
    { at: '2026-09-02T06:00:00Z', night: '2026-09-01', recall: 'none', lucidity: 0, backfilled: true, lagDays: 1, checksDone: [] },
  ];
  const w = within(rows, { now: new Date('2026-09-09T00:00:00Z') });
  assert.equal(w.entries, 2);
  assert.equal(w.nights, 1, 'two entries about the same night is one night');
  assert.equal(w.recalled, 1);
  assert.equal(w.recallRate, 50);
  assert.equal(w.lucidAny, 1);
  assert.equal(w.backfilled, 1);
  assert.equal(w.contemporaneous, 1);
  assert.equal(w.doubtHeld, 1);
  assert.equal(w.checksPerEntry, 0.5);
  // ⛔ The forbidden keys. A percentile here would need a comparison group this build refuses to have.
  for (const k of ['percentile', 'rank', 'compared', 'population', 'norm', 'zScore']) {
    assert.equal(Object.hasOwn(w, k), false, `within() must not return ${k}`);
  }
  assert.match(w.reference, /no comparison group, no norm and no percentile/i);
});

test('an empty journal produces nulls rather than a confident zero', () => {
  const w = within([], null);
  assert.equal(w.entries, 0);
  assert.equal(w.recallRate, null, 'a rate with no denominator is null, not 0%');
  assert.equal(w.checksPerEntry, null);
  assert.equal(w.medianLagDays, null);
});

test('⚠️ backfill is computed on write and marked permanently', () => {
  __setIO(fakeIO());
  const pid = participantId(RAW_KEY);
  const same = appendEntry(pid, { night: '2026-09-08' }, { file: FILE, now: () => new Date('2026-09-08T06:00:00Z') });
  assert.equal(same.entry.backfilled, false);
  assert.equal(same.entry.lagDays, 0);
  const late = appendEntry(pid, { night: '2026-09-01' }, { file: FILE, now: () => new Date('2026-09-08T15:00:00Z') });
  assert.equal(late.entry.backfilled, true);
  assert.equal(late.entry.lagDays, 7);
  assert.equal(late.entry.entryNumber, 2);
});

test('a write that fails is reported as a failure — a person is never told a dream was saved', () => {
  const io = fakeIO();
  io.append = () => false;
  __setIO(io);
  const r = appendEntry(participantId(RAW_KEY), { text: 'x' }, { file: FILE });
  assert.equal(r.ok, false);
  assert.match(r.reason, /nothing was saved/i);
});

// --- the contested light switch ---------------------------------------------

test('⚠️ the light-switch check is CONTESTED and is never presented as reliable', () => {
  assert.equal(checkStatus('light-switch'), 'contested');
  // Exactly one check has a sample-based result behind it, and it is not this one.
  assert.deepEqual(testedChecks().map((c) => c.id), ['re-reading']);
  assert.ok(cautionedChecks().some((c) => c.id === 'light-switch'));

  const t = lightSwitchTally([{ lightSwitch: 'flickered or dimmed' }, { lightSwitch: 'worked normally' }]);
  assert.equal(t.status, 'contested');
  assert.equal(t.tried, 2);
  assert.equal(t.counts['flickered or dimmed'], 1);
  // Both papers named, and the refusal stated in the note itself.
  assert.match(t.note, /Hearne/);
  assert.match(t.note, /Moss/);
  assert.match(t.note, /1989/);
  assert.match(t.note, /not evidence that a light switch tells you whether you are awake/i);
});

test('the page states the contest rather than teaching the check', () => {
  const html = dreamJournalPageHTML(null);
  assert.match(html, /contested/);
  assert.match(html, /Hearne/);
  assert.match(html, /Moss/);
  assert.match(html, /Nobody has looked since 1989/i);
  assert.match(html, /Do not use a light switch to\s+decide whether you are awake/i);
  // And it asks about brightness, which is what Hearne's subjects actually described.
  assert.match(html, /brightness rather than success/i);
  assert.ok(LIGHT_SWITCH_OUTCOMES.includes('brighter than expected'));
});

// --- the export --------------------------------------------------------------

test('⭐ the export is clinician-legible and says in its own text that it is not a lab result', () => {
  const rows = [{
    at: '2026-09-08T06:12:00Z', night: '2026-09-08', recall: 'scene', lucidity: 2,
    lagDays: 0, backfilled: false, tags: ['water'], text: 'A corridor of doors.',
    checksDone: [{ check: 're-reading', doubtHeld: true }], lightSwitch: 'flickered or dimmed',
  }];
  const out = exportRecord(rows, { now: new Date('2026-09-09T00:00:00Z') });
  assert.match(out, /DREAM JOURNAL/);
  assert.match(out, /not a laboratory result/i);
  assert.match(out, /Consult your doctor/i);
  assert.match(out, /this person against this person/i);
  assert.match(out, /A corridor of doors\./);
  assert.match(out, /tags \(the person's own\): water/);
  assert.match(out, /\[same day\]/);
  assert.match(out, /CONTESTED/);
  // The scale is disclaimed inside the document a clinician will actually read.
  assert.match(out, /NOT a validated instrument/);
  assert.match(out, /no comparison group and no percentile/i);
  // And nothing on chain is asserted in the document itself.
  assert.match(out, /written to any blockchain/i);
});

test('⛔ the export contains no interpretation of any kind', () => {
  const out = exportRecord([{
    at: '2026-09-08T06:12:00Z', night: '2026-09-08', recall: 'full', lucidity: 4,
    tags: ['snake', 'water'], text: 'A snake in the water.',
  }], { now: new Date('2026-09-09T00:00:00Z') });
  // No symbol reading, no mood arithmetic, no verdict about the person.
  for (const forbidden of [/means that you/i, /symbolis|symbolize/i, /your subconscious/i,
    /% anxiety/i, /suggests you are/i, /indicates that you/i]) {
    assert.ok(!forbidden.test(out), `the export interpreted the dream: ${forbidden}`);
  }
});

test('a backfilled entry is visibly marked in the export, and the lag is printed', () => {
  const out = exportRecord([{
    at: '2026-09-08T15:00:00Z', night: '2026-09-01', lagDays: 7, backfilled: true, recall: 'fragment',
  }], { now: new Date('2026-09-09T00:00:00Z') });
  assert.match(out, /\[BACKFILLED \+7d\]/);
  assert.match(out, /written later\s+1/);
});

// --- the page and the handler ------------------------------------------------

test('the page renders, escapes hostile content, and loads nothing external', () => {
  const html = dreamJournalPageHTML({ participants: 12 });
  assert.match(html, /The dream journal/);
  assert.match(html, /12 people keep a journal here/);
  assert.ok(!/<script/i.test(html));
  assert.ok(!/\bsrc\s*=/i.test(html));
  assert.ok(!/@import|url\(/i.test(html));
  // Every link is internal — this page cites by DOI string, not by hotlinking.
  const external = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)];
  assert.equal(external.length, 0, `unexpected external link: ${external.map((m) => m[1]).join(', ')}`);
});

test('esc is applied to interpolated values — participant count cannot inject', () => {
  const html = dreamJournalPageHTML({ participants: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('<img'));
  // A non-numeric count is dropped rather than printed as junk.
  assert.ok(!html.includes('people keep a journal here'));
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
});

test('the page carries the privacy design as copy the reader can act on', () => {
  const html = dreamJournalPageHTML(null);
  assert.match(html, /raw key is never written to disk/i);
  assert.match(html, /Nothing goes on the chain/i);
  assert.match(html, /Forget actually empties it/i);
  // The cost of not asking who you are, stated BEFORE they start rather than after.
  assert.match(html, /If you lose your key, nothing can be deleted/i);
});

test('handler serves the shape as JSON, and no participant data', () => {
  let status = 0; let headers = null; let body = '';
  handler({}, {
    writeHead(s, h) { status = s; headers = h; },
    end(b) { body = b; },
  });
  assert.equal(status, 200);
  assert.match(headers['content-type'], /application\/json/);
  const json = JSON.parse(body);
  assert.equal(json.ok, true);
  assert.equal(json.service, JOURNAL_ID);
  assert.equal(json.route, ROUTE);
  assert.equal(json.shareCard, false);
  assert.equal(json.onChain, false);
  assert.equal(json.payable, false);
  assert.equal(json.interpretation, false);
  assert.equal(json.grade, 3);
  assert.match(json.notALab, /not a laboratory result/i);
  // No content, no participant, no enumeration anywhere in the payload.
  assert.equal(Object.hasOwn(json, 'entries'), false);
  assert.equal(Object.hasOwn(json, 'participants'), false);
  assert.equal(body.includes('pid'), false);
});

// --- fields, scale and citations ---------------------------------------------

test('the fields are the ones the paper specified', () => {
  const names = FIELDS.map((f) => f.name);
  for (const want of ['night', 'wakeTime', 'wbtb', 'technique', 'recall', 'lucidity',
    'checkFiredInDream', 'tags', 'text']) {
    assert.ok(names.includes(want), `missing specified field: ${want}`);
  }
  // Lucidity is an ordinal, not a boolean — the near miss is the trainable part.
  assert.equal(LUCIDITY_LEVELS.length, 5);
  assert.deepEqual(LUCIDITY_LEVELS.map((l) => l.level), [0, 1, 2, 3, 4]);
  assert.deepEqual(RECALL_LEVELS, ['none', 'fragment', 'scene', 'full']);
});

test('tags are the person’s own words — no controlled vocabulary is imposed', () => {
  const e = normaliseEntry({ tags: ['  Snake ', 'snake ', 'water', ''] });
  // Trimmed and de-duplicated, but never mapped, translated or rejected for not being on a list.
  assert.deepEqual(e.tags, ['Snake', 'snake', 'water']);
  const field = FIELDS.find((f) => f.name === 'tags');
  assert.equal(Object.hasOwn(field, 'options'), false, 'a tag vocabulary would be interpretation by the back door');
});

test('every citation carries a DOI and a note that it was resolved against Crossref', () => {
  assert.ok(CITATIONS.length >= 5);
  for (const c of CITATIONS) {
    assert.match(c.doi, /^10\.\d{4,9}\//, c.id);
    assert.match(c.crossref, /2026-09-09/, c.id);
    assert.ok(c.label.length > 40, c.id);
    assert.ok(Object.isFrozen(c));
  }
  // ⚠️ The correction the pass produced: Crossref registers the 2017 Dreaming paper under
  // Adventure-Heart, not Aspy. Both names must appear or a reader cannot find the paper.
  const a = citation('aspy-2017');
  assert.match(a.label, /Adventure-Heart/);
  assert.match(a.label, /Aspy/);
  assert.equal(citation('nope'), null);
});

test('the reality-check grades come from practices.mjs, not a copy of them', () => {
  // Restating the grades here would let the two drift, and the light-switch grading is the product.
  assert.ok(CHECKS.length >= 6);
  assert.deepEqual([...new Set(CHECKS.map((c) => c.status))].sort(),
    ['contested', 'extrapolated', 'folklore', 'tested']);
  assert.equal(checkStatus('nonexistent-check'), null);
});
