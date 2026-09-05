// site/hathor-live/reports.test.mjs — the report archive. Offline, no fs, no network.
//
// The tests that matter most here are the boundary ones: no personal information reaches the store,
// and nothing unreviewed reaches a public page. Both are design rules in reports.mjs, both are the
// kind of thing a later refactor quietly breaks, so both are asserted directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateReport, publicReports, reportStats, hasContact, reportId, __resetSeq,
  REPORTS_PAGE, CATEGORIES, CATEGORY_IDS, OUTCOMES, OUTCOME_IDS, UNDER_REPORTED,
  FAMILIES, STATUSES, LIMITS,
} from './reports.mjs';
import { readReports, appendReport, setStatus, __setIO } from './reports-store.mjs';

const good = (over = {}) => ({
  category: 'tdcs',
  outcome: 'nothing',
  protocol: 'Anode F3, cathode Fp2, 1.5 mA over 35 cm2 sponges, 20 minutes, daily for six weeks.',
  outcomeText: 'Nothing measurable. I tracked n-back scores three times a week and the trend is flat.',
  ...over,
});

// --- taxonomy ---------------------------------------------------------------

test('the taxonomy covers both families and every category has a hint', () => {
  const fams = new Set(CATEGORIES.map((c) => c.family));
  assert.deepEqual([...fams].sort(), ['biohacking', 'plant']);
  assert.ok(Object.keys(FAMILIES).length === 2);
  for (const c of CATEGORIES) {
    assert.ok(c.id && c.label, 'category needs id and label');
    assert.ok(c.hint && c.hint.length > 20, `${c.id} needs a real hint`);
  }
  assert.equal(new Set(CATEGORY_IDS).size, CATEGORY_IDS.length, 'category ids must be unique');
});

test('ayahuasca and the biohacking methods are BOTH in scope — one archive, one standard', () => {
  // CLAUDE.md § Scope: the plant-medicine shelves are settled IN scope and must not be gated.
  for (const id of ['ayahuasca', 'pharmahuasca', 'herb']) {
    assert.ok(CATEGORY_IDS.includes(id), `${id} must be reportable`);
  }
  for (const id of ['tdcs', 'tens', 'entrainment', 'nootropic']) {
    assert.ok(CATEGORY_IDS.includes(id), `${id} must be reportable`);
  }
});

test('null and adverse outcomes are first-class, not an afterthought', () => {
  assert.ok(OUTCOME_IDS.includes('nothing'), '"nothing happened" must be a valid outcome');
  for (const id of UNDER_REPORTED) assert.ok(OUTCOME_IDS.includes(id));
  assert.deepEqual([...UNDER_REPORTED].sort(), ['adverse', 'nothing', 'worse']);
});

// --- validation -------------------------------------------------------------

test('a complete report validates and lands as PENDING, never published', () => {
  const { ok, errors, report } = validateReport(good());
  assert.equal(ok, true, errors.join('; '));
  assert.equal(report.status, 'pending');
  assert.ok(STATUSES.includes(report.status));
  assert.equal(report.family, 'biohacking');
  assert.equal(report.handle, 'anonymous', 'no handle => anonymous, never empty');
  assert.ok(report.submitted.endsWith('Z'));
});

test('a null result is accepted with no special pleading', () => {
  const { ok, report } = validateReport(good({ outcome: 'nothing' }));
  assert.equal(ok, true);
  assert.equal(report.outcome, 'nothing');
});

test('missing category, outcome, protocol or result is refused with a usable message', () => {
  for (const field of ['category', 'outcome', 'protocol', 'outcomeText']) {
    const input = good(); delete input[field];
    const { ok, errors } = validateReport(input);
    assert.equal(ok, false, `${field} should be required`);
    assert.ok(errors.length > 0);
    assert.ok(errors.every((e) => /[a-z]/.test(e) && e.length > 12), 'errors must be readable prose');
  }
});

test('an unknown category is refused (no free-text category injection)', () => {
  assert.equal(validateReport(good({ category: 'made-up' })).ok, false);
  assert.equal(validateReport(good({ category: '<script>' })).ok, false);
});

test('a protocol with no detail is refused — a report without numbers helps nobody', () => {
  const { ok, errors } = validateReport(good({ protocol: 'did tdcs' }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /what you actually did|numbers|dose|settings/i.test(e)));
});

test('an adverse outcome with no description of the harm is refused', () => {
  const { ok, errors } = validateReport(good({
    outcome: 'adverse', adverse: '', outcomeText: 'it went badly',
  }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /went wrong|adverse/i.test(e)));
});

test('an adverse outcome WITH the detail is accepted', () => {
  const { ok, report } = validateReport(good({
    outcome: 'adverse',
    adverse: 'Persistent metallic taste and a burn mark under the anode that took nine days to fade.',
  }));
  assert.equal(ok, true);
  assert.equal(report.outcome, 'adverse');
});

// --- BOUNDARY: no personal information --------------------------------------

test('hasContact catches emails and phone numbers', () => {
  assert.equal(hasContact('reach me at a@b.co'), true);
  assert.equal(hasContact('call 555 123 4567 after six'), true);
  assert.equal(hasContact('+1 (555) 123-4567'), true);
  assert.equal(hasContact('1.5 mA over 35 cm2 for 20 minutes'), false);
  assert.equal(hasContact(''), false);
  assert.equal(hasContact(null), false);
});

test('a report carrying an email address is REFUSED, not stored and stripped', () => {
  for (const field of ['protocol', 'outcomeText', 'timeline', 'adverse', 'notes', 'handle']) {
    const input = good();
    input[field] = `${input[field] || 'x'} contact me at someone@example.com`;
    const { ok, errors, report } = validateReport(input);
    assert.equal(ok, false, `an email in ${field} must be refused`);
    assert.equal(report, null, 'nothing is returned for storage');
    assert.ok(errors.some((e) => /email address or phone number/i.test(e)));
  }
});

test('a report carrying a phone number is refused', () => {
  const { ok } = validateReport(good({ notes: 'text me on 555-867-5309 if you try this' }));
  assert.equal(ok, false);
});

test('there is no name or email FIELD at all — the boundary is structural', () => {
  const { report } = validateReport(good({ name: 'Real Person', email: 'a@b.co', phone: '5551234567' }));
  assert.ok(report, 'unknown extra fields must not break validation');
  for (const forbidden of ['name', 'email', 'phone']) {
    assert.equal(forbidden in report, false, `${forbidden} must never be carried into the stored report`);
  }
});

// --- publication gate -------------------------------------------------------

test('publicReports shows ONLY published — pending and rejected never leak', () => {
  const all = [
    { id: 'a', status: 'pending', protocol: 'p', outcomeText: 'o', submitted: '2026-01-01' },
    { id: 'b', status: 'published', protocol: 'p', outcomeText: 'o', submitted: '2026-01-02' },
    { id: 'c', status: 'rejected', protocol: 'p', outcomeText: 'o', submitted: '2026-01-03' },
  ];
  const pub = publicReports(all);
  assert.equal(pub.length, 1);
  assert.equal(pub[0].id, 'b');
});

test('publicReports is newest-first and never throws on junk', () => {
  const all = [
    { id: 'a', status: 'published', submitted: '2026-01-01', protocol: 'p', outcomeText: 'o' },
    { id: 'b', status: 'published', submitted: '2026-03-01', protocol: 'p', outcomeText: 'o' },
  ];
  assert.deepEqual(publicReports(all).map((r) => r.id), ['b', 'a']);
  for (const junk of [null, undefined, 0, 'x', [null], [{}]]) {
    assert.doesNotThrow(() => publicReports(junk));
  }
});

test('reportStats counts only published reports', () => {
  const all = [
    { id: 'a', status: 'published', category: 'tdcs', outcome: 'nothing', protocol: 'p', outcomeText: 'o', submitted: '1' },
    { id: 'b', status: 'pending', category: 'tdcs', outcome: 'strong', protocol: 'p', outcomeText: 'o', submitted: '2' },
  ];
  const s = reportStats(all);
  assert.equal(s.total, 1);
  assert.equal(s.byOutcome.nothing, 1);
  assert.equal(s.byOutcome.strong, 0, 'a pending report must not be counted');
});

// --- ids --------------------------------------------------------------------

test('report ids are unique within a millisecond', () => {
  __resetSeq();
  const d = new Date('2026-09-04T00:00:00Z');
  const ids = new Set([reportId(d), reportId(d), reportId(d)]);
  assert.equal(ids.size, 3);
});

test('reportId survives an invalid date', () => {
  assert.doesNotThrow(() => reportId(new Date('nope')));
  assert.doesNotThrow(() => reportId(null));
});

// --- page -------------------------------------------------------------------

test('the page renders, states the model, and asks for null results', () => {
  const html = REPORTS_PAGE([], { baseUrl: 'https://hathor.live' });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Erowid/, 'the model should be named plainly');
  assert.match(html, /nothing happened/i, 'null results must be solicited on the page');
  assert.match(html, /not medical advice/i);
  assert.match(html, /No published reports yet/, 'an empty archive says so rather than seeding fakes');
});

test('the page escapes report content — no HTML injection from a submitter', () => {
  const nasty = `<img src=x onerror="alert(1)">'"`;
  const html = REPORTS_PAGE([{
    id: 'x', status: 'published', category: 'tdcs', family: 'biohacking', outcome: 'mild',
    handle: nasty, protocol: nasty, outcomeText: nasty, timeline: nasty, adverse: nasty,
    notes: nasty, submitted: '2026-09-04T00:00:00.000Z',
  }], {});
  // The payload appears, escaped...
  assert.ok(html.includes('&lt;img src=x'), 'the content should appear, escaped');
  // ...and NO angle bracket, quote or apostrophe from it survives raw. Checking the escaped form
  // is the whole test: un-escaping the output first (as an earlier version of this test did) just
  // reconstructs the payload and proves nothing.
  assert.ok(!/<img/i.test(html), 'no raw tag may survive');
  assert.ok(!html.includes('onerror="alert'), 'no live attribute handler');
  assert.ok(html.includes('&quot;'), 'double quotes are escaped');
  assert.ok(html.includes('&#39;'), 'apostrophes are escaped');
});

test('a pending report is not rendered into the page', () => {
  const html = REPORTS_PAGE([{
    id: 'p1', status: 'pending', category: 'tdcs', family: 'biohacking', outcome: 'strong',
    handle: 'someone', protocol: 'UNREVIEWED-MARKER', outcomeText: 'x', submitted: '2026-09-04',
  }], {});
  assert.ok(!html.includes('UNREVIEWED-MARKER'), 'pending content must never reach the page');
});

test('every category and outcome appears as a form option', () => {
  const html = REPORTS_PAGE([], {});
  for (const c of CATEGORIES) assert.ok(html.includes(`value="${c.id}"`), `${c.id} missing from form`);
  for (const o of OUTCOMES) assert.ok(html.includes(`value="${o.id}"`), `${o.id} missing from form`);
});

test('the form has no name, email or phone input', () => {
  const html = REPORTS_PAGE([], {});
  assert.ok(!/name="email"/.test(html));
  assert.ok(!/name="phone"/.test(html));
  assert.ok(!/type="email"/.test(html));
  assert.ok(!/name="realname"/i.test(html));
});

test('limits are reflected in the form maxlength attributes', () => {
  const html = REPORTS_PAGE([], {});
  assert.ok(html.includes(`maxlength="${LIMITS.protocol}"`));
  assert.ok(html.includes(`maxlength="${LIMITS.outcomeText}"`));
});

// --- store ------------------------------------------------------------------

function memIO() {
  let buf = '';
  return {
    read() { return buf; },
    append(_p, line) { buf += line; return true; },
    dump() { return buf; },
  };
}

test('store: append then read round-trips', () => {
  const io = memIO(); __setIO(io);
  const { report } = validateReport(good());
  assert.equal(appendReport(report), true);
  const back = readReports();
  assert.equal(back.length, 1);
  assert.equal(back[0].id, report.id);
  assert.equal(back[0].status, 'pending');
  __setIO(null);
});

test('store: a status patch is folded over the submission, history is kept', () => {
  const io = memIO(); __setIO(io);
  const { report } = validateReport(good());
  appendReport(report);
  setStatus(report.id, 'published');
  const back = readReports();
  assert.equal(back.length, 1, 'a patch must not create a second report');
  assert.equal(back[0].status, 'published');
  assert.equal(back[0].protocol, report.protocol, 'the original text survives moderation');
  assert.ok(io.dump().split('\n').filter(Boolean).length === 2, 'both records are on disk');
  __setIO(null);
});

test('store: a torn line loses one report, not the file', () => {
  const io = memIO(); __setIO(io);
  const { report } = validateReport(good());
  appendReport(report);
  io.append(null, '{"id":"broken","protocol":\n');  // truncated JSON
  const { report: r2 } = validateReport(good({ category: 'ayahuasca',
    protocol: 'Caapi 30 g decocted three hours, chacruna 25 g, taken 20 minutes apart.' }));
  appendReport(r2);
  const back = readReports();
  assert.equal(back.length, 2, 'the good records still parse');
  __setIO(null);
});

test('store: soft-fails on an unwritable target rather than throwing', () => {
  __setIO({ read() { return ''; }, append() { return false; } });
  const { report } = validateReport(good());
  assert.equal(appendReport(report), false, 'a failed write reports false, so the route can 503');
  assert.deepEqual(readReports(), []);
  __setIO(null);
});

test('store: never throws on garbage input', () => {
  __setIO(memIO());
  for (const junk of [null, undefined, 0, '', {}, { id: '' }, []]) {
    assert.doesNotThrow(() => appendReport(junk));
    assert.equal(appendReport(junk), false);
  }
  assert.equal(setStatus('', 'published'), false);
  assert.equal(setStatus('x', ''), false);
  __setIO(null);
});
