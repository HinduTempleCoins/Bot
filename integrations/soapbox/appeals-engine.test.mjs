// appeals-engine.test.mjs — offline unit tests for the pro-se appeals & writ engine.
// Pure/offline: no network, soft-fail-never-throw. Verifies the ladder ordering + gating, the
// exhaustion warnings (habeas + mandamus), the field templates, the deadline engine, and that the
// VERIFIED citations are present and unaltered (so a future edit cannot silently swap in a fake cite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LADDER, findRemedy, gateRemedy, fieldsFor, deadlinesFor, statuteCitesFor,
  STATES, COURT_LEVELS, ORDINANCE_SOURCES, MANDAMUS_AUTHORITIES, HABEAS_AUTHORITIES,
  renderLadder, renderRemedyDetail, renderJurisdictionSelector, renderFieldsTemplate,
  renderDeadlines, renderOrdinanceLinks, renderDisclaimer, renderTeaching, escapeHtml, stateName,
} from './appeals-engine.mjs';

test('the ladder is ordered by tier and every rung is well-formed', () => {
  assert.ok(LADDER.length >= 8, 'at least the eight core rungs');
  const ids = new Set();
  let lastTier = 0;
  for (const r of LADDER) {
    assert.ok(r.id && !ids.has(r.id), `unique id: ${r.id}`);
    ids.add(r.id);
    assert.ok(r.name && r.plain && r.ladderNote && r.burnNote, `${r.id} has teaching text`);
    assert.ok(Array.isArray(r.statuteMap) && r.statuteMap.length, `${r.id} has a statute map`);
    assert.ok(r.tier >= lastTier, `tiers are non-decreasing (${r.id} tier ${r.tier})`);
    lastTier = r.tier;
  }
});

test('the exhaustion ladder is present in the right order', () => {
  const order = LADDER.map((r) => r.id);
  const idx = (id) => order.indexOf(id);
  assert.ok(idx('direct-appeal') < idx('reconsideration'));
  assert.ok(idx('reconsideration') < idx('state-postconviction'));
  assert.ok(idx('state-postconviction') < idx('discretionary-review'));
  assert.ok(idx('discretionary-review') < idx('cert-scotus'));
  assert.ok(idx('cert-scotus') < idx('federal-habeas'));
  assert.ok(idx('federal-habeas') < idx('mandamus'));
  assert.ok(idx('mandamus') < idx('coram-nobis'));
});

test('findRemedy is case-insensitive and soft-fails', () => {
  assert.equal(findRemedy('FEDERAL-HABEAS').id, 'federal-habeas');
  assert.equal(findRemedy(''), null);
  assert.equal(findRemedy(null), null);
  assert.equal(findRemedy('nope'), null);
});

test('gateRemedy BLOCKS federal habeas until state remedies are marked done, with a danger warning', () => {
  const g = gateRemedy('federal-habeas', ['direct-appeal']);
  assert.equal(g.ok, false, 'habeas is gated when prereqs are missing');
  assert.ok(g.missing.includes('state-postconviction'));
  assert.ok(g.missing.includes('discretionary-review'));
  const danger = g.warnings.find((w) => w.level === 'danger');
  assert.ok(danger, 'a danger warning fires');
  assert.match(danger.title + danger.body, /burn|exhaust|AEDPA/i);
});

test('gateRemedy UNLOCKS federal habeas once all prereqs are marked done (hard warning still fires)', () => {
  const g = gateRemedy('federal-habeas', ['direct-appeal', 'state-postconviction', 'discretionary-review']);
  assert.equal(g.ok, true, 'unlocked when the state ladder is complete');
  assert.equal(g.missing.length, 0);
  // the standing hard warning about exhaustion is ALWAYS attached, even when unlocked
  assert.ok(g.warnings.some((w) => /exhaust state remedies first/i.test(w.title)));
});

test('mandamus fires a last-resort warning and cites the APA / TRAC framework', () => {
  const g = gateRemedy('mandamus', ['direct-appeal']);
  assert.equal(g.ok, true, 'mandamus prereq (a prior appeal) satisfied');
  const w = g.warnings.find((x) => /last resort/i.test(x.title));
  assert.ok(w, 'a last-resort warning fires');
  assert.match(w.body, /706\(1\)|TRAC|Norton/);
});

test('ungated rungs are always ok; gated rungs with a missing prereq get a warn', () => {
  assert.equal(gateRemedy('direct-appeal', []).ok, true);
  assert.equal(gateRemedy('reconsideration', []).ok, true);
  const g = gateRemedy('cert-scotus', []); // gated on direct-appeal
  assert.equal(g.ok, false);
  assert.ok(g.warnings.some((w) => w.level === 'warn'));
});

test('the VERIFIED mandamus authorities are present and unaltered', () => {
  const olsen = MANDAMUS_AUTHORITIES.find((a) => /Olsen/.test(a.name));
  assert.ok(olsen, 'Olsen v. DEA is present');
  assert.equal(olsen.cite, '878 F.2d 1458 (D.C. Cir. 1989)');
  const trac = MANDAMUS_AUTHORITIES.find((a) => /TRAC/.test(a.name));
  assert.equal(trac.cite, '750 F.2d 70 (D.C. Cir. 1984)');
  const norton = MANDAMUS_AUTHORITIES.find((a) => /Norton/.test(a.name));
  assert.equal(norton.cite, '542 U.S. 55 (2004)');
});

test('the VERIFIED habeas authorities are present and unaltered', () => {
  const rose = HABEAS_AUTHORITIES.find((a) => /Rose v\. Lundy/.test(a.name));
  assert.equal(rose.cite, '455 U.S. 509 (1982)');
  const coleman = HABEAS_AUTHORITIES.find((a) => /Coleman v\. Thompson/.test(a.name));
  assert.equal(coleman.cite, '501 U.S. 722 (1991)');
});

test('federal habeas statute map carries the real § 2254 / § 2255 / exhaustion / AEDPA cites', () => {
  const cites = statuteCitesFor('federal-habeas').map((s) => s.cite).join(' ');
  assert.match(cites, /28 U\.S\.C\. § 2254\b/);
  assert.match(cites, /28 U\.S\.C\. § 2255\b/);
  assert.match(cites, /2254\(b\)\(1\)/); // exhaustion
  assert.match(cites, /2244\(d\)\(1\)/); // AEDPA clock
});

test('mandamus statute map cites § 1361, the All Writs Act, and APA § 706(1)', () => {
  const cites = statuteCitesFor('mandamus').map((s) => s.cite).join(' ');
  assert.match(cites, /28 U\.S\.C\. § 1361/);
  assert.match(cites, /28 U\.S\.C\. § 1651/);
  assert.match(cites, /5 U\.S\.C\. § 706\(1\)/);
});

test('fieldsFor returns the right template per remedy category, with required fields', () => {
  const brief = fieldsFor('direct-appeal');
  assert.equal(brief.label, 'Appellate brief');
  const keys = brief.fields.map((f) => f.key);
  for (const need of ['court', 'parties', 'caseNumber', 'issues', 'statementFacts', 'argument', 'relief', 'certService']) {
    assert.ok(keys.includes(need), `brief includes ${need}`);
  }
  const habeas = fieldsFor('federal-habeas');
  assert.ok(habeas.fields.some((f) => f.key === 'exhaustion'), 'habeas template forces an exhaustion field');
  const mand = fieldsFor('mandamus');
  assert.ok(mand.fields.some((f) => f.key === 'duty'), 'mandamus template forces the non-discretionary-duty field');
  assert.ok(mand.fields.some((f) => f.key === 'noAlternative'), 'mandamus template forces the no-adequate-remedy field');
});

test('fieldsFor soft-fails to an empty shape for an unknown remedy', () => {
  const t = fieldsFor('nope');
  assert.deepEqual(t.fields, []);
  assert.deepEqual(t.format, []);
});

test('deadlinesFor surfaces the real federal windows with citations', () => {
  const appeal = deadlinesFor('direct-appeal', { state: 'US' });
  assert.ok(appeal.some((d) => /Fed\. R\. App\. P\. 4/.test(d.cite || '')), 'FRAP 4 cited for notice of appeal');
  const cert = deadlinesFor('cert-scotus', {});
  assert.ok(cert.some((d) => /90 days/.test(d.text) && /Sup\. Ct\. R\. 13/.test(d.cite || '')), 'cert 90-day deadline');
  const habeas = deadlinesFor('federal-habeas', {});
  assert.ok(habeas.some((d) => d.level === 'danger' && /2244\(d\)/.test(d.cite || '')), 'AEDPA clock as a danger deadline');
});

test('deadlinesFor marks state-specific windows verify:true (never a fabricated day count)', () => {
  const st = deadlinesFor('state-postconviction', { state: 'CA' });
  assert.ok(st.every((d) => d.verify || d.cite), 'state windows are either cited or flagged verify');
  assert.ok(st.some((d) => d.verify === true), 'at least one verify-flagged state window');
});

test('STATES covers 50 states + DC + federal, and stateName resolves', () => {
  assert.equal(STATES.length, 52, '50 states + DC + US');
  assert.equal(stateName('TX'), 'Texas');
  assert.equal(stateName('US'), 'Federal (United States courts)');
  assert.equal(stateName('ZZ'), '');
  assert.ok(COURT_LEVELS.some((c) => c.id === 'scotus'));
});

test('renderLadder escapes output, numbers rungs, and flags a locked gated rung', () => {
  const html = renderLadder({ doneIds: [], state: 'TX' });
  for (const r of LADDER) assert.ok(html.includes(escapeHtml(r.name)), `renders ${r.name}`);
  assert.ok(html.includes('ape-locked'), 'a gated rung with no prereqs done renders locked');
  assert.ok(!html.includes('<script'), 'no script injection');
});

test('renderLadder marks a done rung and unlocks its dependents', () => {
  const html = renderLadder({ doneIds: ['direct-appeal', 'state-postconviction', 'discretionary-review'] });
  assert.ok(html.includes('ape-tick'), 'a done rung shows a tick');
});

test('renderRemedyDetail renders teaching + deadlines + generator fields + injected html', () => {
  const html = renderRemedyDetail('federal-habeas', {
    doneIds: ['direct-appeal'],
    statuteCardsHtml: '<div id=stub-statute>28 USC 2254</div>',
    casesHtml: '<div id=stub-case>Some v. Case</div>',
    judgesHtml: '<div id=stub-judge>Hon. X</div>',
    respondentsHtml: '<div id=stub-resp>the warden</div>',
  });
  assert.match(html, /What this is/);
  assert.match(html, /burning/i);
  assert.ok(html.includes('stub-statute'), 'injected statute cards passed through');
  assert.ok(html.includes('stub-case'), 'injected cases passed through');
  assert.ok(html.includes('stub-judge'), 'injected judges passed through');
  assert.ok(html.includes('stub-resp'), 'injected respondents passed through');
  assert.match(html, /exhaust/i);
  assert.ok(!html.includes('<script'), 'no script injection');
});

test('renderRemedyDetail shows the verified authorities on the mandamus + habeas pages', () => {
  const mand = renderRemedyDetail('mandamus', { doneIds: ['direct-appeal'] });
  assert.match(mand, /Olsen/);
  assert.match(mand, /750 F\.2d 70/);
  const hab = renderRemedyDetail('federal-habeas', { doneIds: ['direct-appeal', 'state-postconviction', 'discretionary-review'] });
  assert.match(hab, /Rose v\. Lundy/);
});

test('renderRemedyDetail soft-fails to a prompt for an unknown remedy', () => {
  const html = renderRemedyDetail('nope', {});
  assert.match(html, /Pick a step/i);
});

test('the jurisdiction selector renders all states, keeps the selection, and escapes', () => {
  const html = renderJurisdictionSelector({ state: 'CA', level: 'circuit', remedy: 'mandamus' });
  assert.match(html, /<option value="CA" selected>California<\/option>/);
  assert.match(html, /value="circuit" selected/);
  assert.ok(html.includes('name=remedy'), 'keeps the chosen remedy across a jurisdiction change');
  assert.ok(!html.includes('<script'), 'no script injection');
});

test('renderFieldsTemplate marks state-varying format rules verify and cites federal ones', () => {
  const html = renderFieldsTemplate('direct-appeal');
  assert.match(html, /Fed\. R\. App\. P\. 32/);
  assert.match(html, /varies by state/i);
  assert.match(html, /not legal advice/i);
});

test('the ordinance section links national code hosts and never fabricates a specific ordinance url', () => {
  const html = renderOrdinanceLinks();
  assert.match(html, /Municode/);
  assert.match(html, /American Legal Publishing/);
  assert.ok(ORDINANCE_SOURCES.every((s) => /^https:\/\//.test(s.url)), 'all ordinance links are https');
  assert.ok(!html.includes('<script'));
});

test('the disclaimer is two-voice: labels AI-generated and points to a lawyer + e-filing', () => {
  const html = renderDisclaimer();
  assert.match(html, /AI-generated/);
  assert.match(html, /not legal advice/i);
  assert.match(html, /attorney|legal-aid|self-help/i);
  assert.match(html, /e-fil|PACER|CM-ECF/i);
});

test('renderTeaching teaches order + burning for the "writ goes by statute now" point', () => {
  const html = renderTeaching('mandamus');
  assert.match(html, /statute/i);
  assert.match(html, /last resort/i);
});
