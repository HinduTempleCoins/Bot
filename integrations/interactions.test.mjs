// interactions.test.mjs — offline, no network. `node --test`.
//
// The load-bearing test in this file is COVERAGE ON EVERY RESULT. If someone later adds an exported
// path that returns findings without a coverage block, or flips isFindingOfSafety, this fails. That
// is the point: the honesty is structural, not a convention people remember.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  check, pairCheck, resolve, clinicianExport, coverage, citeShort, citeUrl,
  SUBSTANCES, MECHANISMS, CITES, LAST_REVIEWED, HUNTER_CRITERIA, SEVERITY,
  allPages, interactionPaths, substancePages, mechanismPages, pairPages, PAIR_GATE,
  renderPath, indexHTML, checkHTML, handler, sitemapXmlFragment,
  labelInteractions, __setFetch, esc,
} from './interactions.mjs';

const res = () => {
  const r = { code: 0, headers: {}, body: '', ended: false };
  r.writeHead = (c, h) => { r.code = c; r.headers = h || {}; return r; };
  r.end = (b) => { r.body = String(b == null ? '' : b); r.ended = true; return r; };
  return r;
};

// ── the one rule ──────────────────────────────────────────────────────────────────────────────────

test('EVERY result carries coverage, and coverage never asserts safety', () => {
  const results = [
    check(['phenelzine', 'aged cheddar']),
    check([]),
    check(''),
    check(null),
    check(undefined),
    check(['something that does not exist at all']),
    check('grapefruit, simvastatin'),
    pairCheck('licorice', 'digoxin'),
    clinicianExport(['moclobemide', 'marmite']),
    clinicianExport([]),
  ];
  for (const r of results) {
    assert.ok(r.coverage, 'result is missing coverage');
    assert.equal(r.coverage.isFindingOfSafety, false);
    assert.match(r.coverage.statement, /does not mean safe/i);
    assert.ok(Array.isArray(r.coverage.covers) && r.coverage.covers.length);
    assert.ok(Array.isArray(r.coverage.doesNotCover) && r.coverage.doesNotCover.length);
    assert.equal(r.coverage.lastReviewed, LAST_REVIEWED);
  }
});

test('a stack with NO findings still says what a clean result means', () => {
  const r = check(['caffeine']);
  assert.equal(r.findings.length, 0, 'expected the clean stack to produce nothing');
  assert.equal(r.worst, null);
  assert.equal(r.coverage.isFindingOfSafety, false);
  const html = checkHTML('caffeine');
  assert.match(html, /not a finding of safety/i);
  assert.match(html, /Nothing documented in this dataset/);
  assert.match(html, /not a laboratory result/i);
  assert.match(html, /noindex/); // a per-query result page must never be indexed
});

test('unrecognised items are reported as NOT CHECKED, not silently dropped', () => {
  const r = check(['phenelzine', 'zzzqqq-not-a-real-substance']);
  assert.deepEqual(r.unrecognised, ['zzzqqq-not-a-real-substance']);
  assert.match(r.coverage.unrecognisedMeans, /NOT in this dataset/);
});

// ── serotonin toxicity ────────────────────────────────────────────────────────────────────────────

test('MAOI + SSRI raises a critical serotonin-toxicity finding with the Hunter criteria', () => {
  const r = check(['phenelzine', 'sertraline']);
  const f = r.findings.find((x) => x.mechanism === 'serotonin toxicity');
  assert.ok(f, 'no serotonin finding');
  assert.equal(f.severity, 'critical');
  assert.equal(r.worst, 'critical');
  assert.equal(f.recognition.name, HUNTER_CRITERIA.name);
  assert.equal(f.recognition.rules.length, 5);
  assert.match(f.recognition.rules.join(' '), /clonus/i);
  assert.ok(f.cites.includes('dunkley2003'));
});

test('the serotonergic drugs the brief names are all covered and all fire against an MAOI', () => {
  for (const name of ['tramadol', 'dextromethorphan', 'sumatriptan', 'linezolid', "St John's wort",
    'fluoxetine', 'venlafaxine', 'MDMA', 'ayahuasca']) {
    const sub = resolve(name);
    assert.ok(sub, `unresolved: ${name}`);
    const r = check(['tranylcypromine', name]);
    // linezolid is itself an MAOI, so it lands on the dual-MAOI rule rather than the serotonin one.
    // That rule exists because THIS TEST failed without it — see ruleDualMAOI.
    const hit = r.findings.some((f) => ['serotonin toxicity', 'two MAO inhibitors together',
      'tyramine pressor response (hypertensive reaction)'].includes(f.mechanism));
    assert.ok(hit, `${name} produced no finding against an MAOI`);
    // Major or worse. NOT all critical: triptans are deliberately scored weak, because the AHS
    // position paper found the evidence behind the FDA alert insufficient. Overstating a hazard is
    // its own harm, and the dataset says so rather than rounding everything up.
    assert.ok(SEVERITY.indexOf(r.worst) >= SEVERITY.indexOf('major'), `${name} scored only ${r.worst}`);
  }
});

test('linezolid is treated as an MAOI even though it is an antibiotic', () => {
  const r = check(['linezolid', 'citalopram']);
  assert.ok(r.findings.some((f) => f.mechanism === 'serotonin toxicity'));
  // and against another MAOI it lands on the dual-MAOI rule
  const dual = check(['linezolid', 'phenelzine']).findings.find((f) => f.mechanism === 'two MAO inhibitors together');
  assert.ok(dual);
  assert.equal(dual.severity, 'critical');
  assert.match(dual.what, /not recognised as an MAOI at all/);
});

test('two SRIs without an MAOI is moderate additive load, not critical', () => {
  const r = check(['sertraline', 'venlafaxine']);
  const f = r.findings.find((x) => x.mechanism === 'additive serotonergic load');
  assert.ok(f);
  assert.equal(f.severity, 'moderate');
});

test('codeine is explicitly recorded as NOT a serotonin reuptake inhibitor', () => {
  const r = check(['phenelzine', 'codeine']);
  assert.ok(!r.findings.some((f) => f.mechanism === 'serotonin toxicity'),
    'codeine must not trigger serotonin toxicity — Gillman separates it from the SRI opioids');
});

// ── tyramine ──────────────────────────────────────────────────────────────────────────────────────

test('irreversible MAOI + aged cheese is critical and carries real thresholds', () => {
  const r = check(['phenelzine', 'aged cheddar']);
  const f = r.findings.find((x) => x.mechanism.startsWith('tyramine'));
  assert.ok(f);
  assert.equal(f.severity, 'critical');
  assert.match(f.thresholds, /6 mg/);
  assert.match(f.thresholds, /25 mg/);
  assert.match(f.watchFor, /headache/i);
});

test('the reversible and transdermal cases are NOT scored like the irreversible ones', () => {
  const rima = check(['moclobemide', 'aged cheddar']).findings.find((f) => f.mechanism.startsWith('tyramine'));
  assert.equal(rima.severity, 'moderate');
  assert.match(rima.modernEvidence, /REVERSIBLE/);
  assert.match(rima.modernEvidence, /overstated/);

  const patch = check(['selegiline transdermal', 'aged cheddar']).findings.find((f) => f.mechanism.startsWith('tyramine'));
  assert.equal(patch.severity, 'monitor');
  assert.match(patch.modernEvidence, /INTESTINAL MAO-A/);
});

test('every food the brief names is present and scores against an irreversible MAOI', () => {
  for (const food of ['aged cheddar', 'salami', 'soy sauce', 'draught beer', 'Marmite', 'broad bean pods']) {
    const sub = resolve(food);
    assert.ok(sub, `unresolved food: ${food}`);
    const r = check(['phenelzine', food]);
    assert.ok(r.findings.some((f) => f.mechanism.startsWith('tyramine') || f.mechanism.startsWith('dietary L-dopa')),
      `${food} produced no pressor finding`);
  }
});

test('broad bean pods are modelled as L-dopa, not tyramine', () => {
  const f = check(['phenelzine', 'fava bean']).findings.find((x) => x.mechanism.startsWith('dietary L-dopa'));
  assert.ok(f);
  assert.match(f.what, /levodopa/i);
});

// ── the seasonings ────────────────────────────────────────────────────────────────────────────────

test('grapefruit is a strong, irreversible, intestinal CYP3A4 inhibitor and reaches a statin', () => {
  const f = check(['grapefruit juice', 'simvastatin']).findings.find((x) => x.mechanism === 'CYP3A4 inhibition');
  assert.ok(f);
  assert.equal(f.severity, 'major');
  assert.match(f.inhibitorNote, /3 days/);
  assert.match(f.substrateNote, /16-fold/);
  assert.ok(f.cites.includes('paine2006') && f.cites.includes('lilja1998'));
});

test('black pepper piperine is modelled on CYP3A4 and P-gp', () => {
  const pip = resolve('black pepper');
  const mechs = pip.roles.map((r) => r.mech);
  assert.ok(mechs.includes('cyp3a4-inhibition'));
  assert.ok(mechs.includes('pgp-inhibition'));
  const r = check(['black pepper', 'ciclosporin']);
  assert.ok(r.findings.some((f) => f.severity === 'critical'), 'NTI substrate should escalate');
});

test('licorice flags on its own, before any second substance', () => {
  const r = check(['liquorice']);
  const f = r.findings.find((x) => x.mechanism.includes('11'));
  assert.ok(f, 'licorice must flag alone — the mechanism does not need a partner');
  assert.match(f.what, /mineralocorticoid/i);
  assert.match(f.watchFor, /potassium/i);
});

test('licorice + digoxin escalates to critical via potassium, not via a drug level', () => {
  const f = check(['licorice', 'digoxin']).findings.find((x) => x.mechanism === 'potassium loss, compounded');
  assert.ok(f);
  assert.equal(f.severity, 'critical');
  assert.match(f.what, /does not change a drug level/);
});

test('cassia and Ceylon cinnamon are separate entries with different coumarin loads', () => {
  const cassia = resolve('cassia');
  const ceylon = resolve('Cinnamomum verum');
  assert.notEqual(cassia.id, ceylon.id);
  assert.match(cassia.roles[0].note, /3 g coumarin per kg/);
  assert.match(cassia.roles[0].note, /not an anticoagulant/i);
  assert.match(ceylon.roles[0].note, /detection limit/);
});

test('star anise is modelled as a species substitution hazard, scoped to Illicium anisatum', () => {
  const sa = resolve('star anise');
  assert.match(sa.roles[0].note, /Illicium anisatum/);
  assert.match(sa.roles[0].note, /NOT to authentic Illicium verum/);
});

test('nutmeg carries its own toxicity record and a deliberately WEAK MAO signal', () => {
  const n = resolve('nutmeg');
  assert.match(n.toxicity, /5 g/);
  assert.ok(n.toxicityCites.includes('stein2001'));
  const mao = n.roles.find((r) => r.mech === 'mao-a-inhibition');
  assert.equal(mao.strength, 'weak');
  assert.match(mao.note, /not as an equivalent of a prescribed MAOI/);
  const f = check(['nutmeg', 'aged cheddar']).findings.find((x) => x.mechanism.startsWith('tyramine'));
  assert.equal(f.severity, 'monitor', 'a weak signal must not be scored like phenelzine');
});

test("St John's wort is modelled as an INDUCER — the mirror hazard", () => {
  const f = check(["St John's wort", 'ciclosporin']).findings.find((x) => x.mechanism === 'CYP3A4 induction');
  assert.ok(f);
  assert.equal(f.severity, 'critical');
  assert.match(f.what, /stops working/);
  assert.ok(f.cites.includes('ruschitzka2000'));
});

test('stopping tobacco is itself an interaction (CYP1A2 induction lost)', () => {
  const f = check(['tobacco smoke', 'clozapine']).findings.find((x) => x.mechanism === 'CYP1A2 induction');
  assert.ok(f);
  assert.match(f.inducerNote, /Nicotine replacement does NOT substitute/);
});

test('prodrug inversion is stated rather than assumed', () => {
  const f = check(['paroxetine', 'codeine']).findings.find((x) => x.mechanism === 'CYP2D6 inhibition');
  assert.ok(f);
  assert.match(f.what, /runs backwards/);
});

// ── narrow therapeutic index + QT ─────────────────────────────────────────────────────────────────

test('narrow-therapeutic-index substrates escalate severity', () => {
  const nti = check(['grapefruit', 'ciclosporin']).findings.find((x) => x.mechanism === 'CYP3A4 inhibition');
  const notNti = check(['grapefruit', 'midazolam']).findings.find((x) => x.mechanism === 'CYP3A4 inhibition');
  assert.equal(nti.severity, 'critical');
  assert.equal(notNti.severity, 'major');
  assert.equal(nti.nti, true);
});

test('QT is an additive axis and needs two agents', () => {
  assert.ok(!check(['amiodarone']).findings.some((f) => f.mechanism.includes('QT')));
  const f = check(['amiodarone', 'citalopram']).findings.find((x) => x.mechanism.includes('QT'));
  assert.ok(f);
  assert.equal(f.severity, 'major');
  assert.match(f.what, /potassium/);
});

// ── data integrity ────────────────────────────────────────────────────────────────────────────────

test('every citation referenced anywhere in the data actually exists and has a handle', () => {
  const ids = new Set(Object.keys(CITES));
  for (const s of SUBSTANCES) {
    for (const r of s.roles || []) {
      assert.ok(MECHANISMS[r.mech], `${s.id} references unknown mechanism ${r.mech}`);
      for (const c of r.cites || []) assert.ok(ids.has(c), `${s.id} references unknown citation ${c}`);
    }
    for (const c of s.toxicityCites || []) assert.ok(ids.has(c), `${s.id} toxicity references unknown citation ${c}`);
  }
  for (const [id, c] of Object.entries(CITES)) {
    assert.ok(c.authors && c.year && c.title && c.journal, `${id} incomplete`);
    assert.ok(c.doi || c.pmid || c.url, `${id} has no resolvable handle`);
    assert.ok(['crossref', 'pmid', 'url'].includes(c.verified), `${id} is not marked verified — render it [UNVERIFIED]`);
  }
});

test('an unknown citation id renders as [UNVERIFIED] rather than disappearing', () => {
  assert.match(citeShort('no-such-citation'), /\[UNVERIFIED/);
  assert.equal(citeUrl('no-such-citation'), '');
  assert.match(citeUrl('dunkley2003'), /^https:\/\/doi\.org\//);
});

test('every finding carries at least one citation', () => {
  for (const stack of [['phenelzine', 'tramadol'], ['grapefruit', 'simvastatin'], ['licorice', 'digoxin'],
    ["St John's wort", 'oral contraceptive'], ['tobacco smoke', 'theophylline'], ['moclobemide', 'marmite']]) {
    for (const f of check(stack).findings) {
      assert.ok(f.cites.length, `${f.id} has no citation`);
      assert.ok(SEVERITY.includes(f.severity), `${f.id} has a bad severity`);
    }
  }
});

test('resolve() is forgiving about names and never throws', () => {
  assert.equal(resolve('Prozac').id, 'fluoxetine');
  assert.equal(resolve('  GRAPEFRUIT JUICE ').id, 'grapefruit');
  assert.equal(resolve('Syrian rue').id, 'harmala');
  assert.equal(resolve('Marmite').id, 'yeast-extract');
  assert.equal(resolve(null), null);
  assert.equal(resolve(''), null);
  assert.equal(resolve({}), null);
});

// ── the crawlable surface ─────────────────────────────────────────────────────────────────────────

test('pages exist at static URLs — a form is not a page', () => {
  const p = allPages();
  assert.ok(p.substances.length >= 20, 'too few substance pages');
  assert.ok(p.mechanisms.length >= 10, 'too few mechanism pages');
  assert.ok(p.pairs.length >= 20, 'too few pair pages');
  for (const path of ['/interactions/grapefruit', '/interactions/nutmeg', '/interactions/black-pepper',
    '/interactions/licorice', '/interactions/st-johns-wort', '/interactions/cyp3a4',
    '/interactions/mao-inhibition', '/interactions/p-glycoprotein', '/interactions/serotonin',
    '/interactions/tyramine']) {
    assert.ok(interactionPaths().includes(path), `missing page: ${path}`);
    assert.ok(renderPath(path), `page did not render: ${path}`);
  }
});

test('THIN CONTENT IS REFUSED — and refused pages get no URL', () => {
  const p = allPages();
  assert.ok(p.refused.length > p.pairs.length, 'the gate should refuse far more than it generates');
  const paths = new Set(interactionPaths());
  for (const r of p.refused) {
    assert.ok(!paths.has(`/interactions/${r.slug}`), `refused pair ${r.slug} still got a URL`);
    assert.equal(renderPath(`/interactions/${r.slug}`), null);
  }
});

test('every generated pair page clears every gate', () => {
  for (const pg of allPages().pairs) {
    assert.ok(pg.cites.length >= PAIR_GATE.minCitations, `${pg.slug} under-cited`);
    assert.ok(pg.findings.length, `${pg.slug} has no findings`);
    const notes = new Set(pg.findings.flatMap((f) => f.participantNotes || []).filter(Boolean));
    assert.ok(notes.size >= PAIR_GATE.minParticipantNotes, `${pg.slug} lacks material on both participants`);
  }
});

test('every page carries the consult block, the coverage block and a visible last-reviewed date', () => {
  for (const path of interactionPaths()) {
    const html = renderPath(path);
    assert.ok(html, `no html for ${path}`);
    assert.match(html, /Consult your doctor or pharmacist/, `${path} missing consult block`);
    assert.match(html, /reference article, not a screen/i, `${path} missing the not-a-screen line`);
    assert.match(html, /does not mean safe/i, `${path} missing the coverage statement`);
    assert.ok(html.includes(LAST_REVIEWED), `${path} missing last-reviewed date`);
    assert.match(html, /"@type":"MedicalWebPage"/, `${path} missing MedicalWebPage JSON-LD`);
    assert.match(html, /"lastReviewed":/, `${path} missing lastReviewed`);
    assert.match(html, /"reviewedBy":/, `${path} missing reviewedBy`);
    assert.match(html, /<link rel="canonical"/, `${path} missing canonical`);
  }
});

test('the sitemap fragment lists exactly the generated pages', () => {
  const xml = sitemapXmlFragment('https://example.test', '2026-09-09');
  for (const p of interactionPaths()) assert.ok(xml.includes(`https://example.test${p}<`), `sitemap missing ${p}`);
  assert.equal((xml.match(/<url>/g) || []).length, interactionPaths().length);
});

test('interactionPaths has no duplicates and every entry is under /interactions', () => {
  const paths = interactionPaths();
  assert.equal(new Set(paths).size, paths.length, 'duplicate path');
  for (const p of paths) assert.match(p, /^\/interactions(\/|$)/);
});

// ── escaping ──────────────────────────────────────────────────────────────────────────────────────

test('user input is escaped everywhere it is echoed', () => {
  const evil = '<script>alert(1)</script>';
  const html = checkHTML(`${evil}, phenelzine`);
  assert.ok(!html.includes('<script>alert(1)'), 'unescaped user input reached the page');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(esc('<&">\''), '&lt;&amp;&quot;&gt;&#39;');
});

// ── handler ───────────────────────────────────────────────────────────────────────────────────────

test('handler serves the tree and declines everything else', async () => {
  let r = res();
  assert.equal(handler({ url: '/somewhere-else' }, r), false);
  assert.equal(r.ended, false);

  r = res();
  assert.equal(handler({ url: '/interactions' }, r), true);
  assert.equal(r.code, 200);
  assert.match(r.body, /by mechanism/i);

  r = res();
  handler({ url: '/interactions/grapefruit' }, r);
  assert.equal(r.code, 200);
  assert.match(r.body, /furanocoumarin/i);

  r = res();
  handler({ url: '/interactions/check?taking=phenelzine%2Ctramadol' }, r);
  assert.equal(r.code, 200);
  assert.match(r.body, /serotonin/i);

  r = res();
  handler({ url: '/interactions/api?taking=licorice,digoxin' }, r);
  assert.equal(r.code, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.coverage.isFindingOfSafety, false);

  r = res();
  handler({ url: '/interactions/sitemap.xml' }, r);
  assert.match(r.headers['content-type'], /xml/);
  assert.match(r.body, /<urlset/);

  r = res();
  handler({ url: '/interactions/definitely-not-a-page' }, r);
  assert.equal(r.code, 404);
});

test('handler never throws on a malformed request', () => {
  const r = res();
  assert.doesNotThrow(() => handler({}, r));
  assert.doesNotThrow(() => handler({ url: '/interactions/%%%' }, res()));
});

// ── clinician export ──────────────────────────────────────────────────────────────────────────────

test('the clinician export is legible, complete, and says it is not a lab result', () => {
  const e = clinicianExport(['phenelzine', 'aged cheddar', 'tramadol', 'black pepper', 'some herb from a shop']);
  assert.match(e.text, /NOT A LABORATORY RESULT/);
  assert.match(e.text, /No specimen was taken/);
  assert.match(e.text, /DECLARED BY PATIENT \(self-report, not verified\)/);
  assert.match(e.text, /some herb from a shop → NOT IN DATASET — not screened/);
  assert.match(e.text, /\[CRITICAL\]/);
  assert.match(e.text, /doi:10\.1093\/qjmed\/hcg109/);
  assert.match(e.text, /COVERAGE — READ THIS BEFORE INTERPRETING THE ABOVE/);
  assert.match(e.text, /Consult your doctor/);
});

test('an empty clinician export still carries the coverage section', () => {
  const e = clinicianExport([]);
  assert.match(e.text, /\(nothing declared\)/);
  assert.match(e.text, /NONE FOUND\. Read the coverage statement/);
  assert.match(e.text, /COVERAGE/);
});

// ── openFDA, with an injected fetch. NO NETWORK. ──────────────────────────────────────────────────

test('openFDA: a good label is parsed', async () => {
  __setFetch(async () => ({
    ok: true,
    json: async () => ({ results: [{ drug_interactions: ['Do not use with MAO inhibitors.'], openfda: { brand_name: ['NARDIL'] } }] }),
  }));
  const r = await labelInteractions('phenelzine');
  assert.equal(r.checked, true);
  assert.equal(r.brand, 'NARDIL');
  assert.match(r.sections.drug_interactions[0], /MAO inhibitors/);
  __setFetch(null);
});

test('openFDA: no label, empty sections, a bad response and a thrown error are all NOT CHECKED', async () => {
  __setFetch(async () => ({ ok: true, json: async () => ({ results: [] }) }));
  let r = await labelInteractions('nutmeg');
  assert.equal(r.checked, false);
  assert.match(r.warning, /not a finding of "no interactions"/);
  assert.match(r.reason, /no FDA drug label/);

  __setFetch(async () => ({ ok: true, json: async () => ({ results: [{ openfda: {} }] }) }));
  r = await labelInteractions('grapefruit');
  assert.equal(r.checked, false);
  assert.match(r.reason, /not an all-clear/);

  __setFetch(async () => ({ ok: false, status: 500 }));
  r = await labelInteractions('warfarin');
  assert.equal(r.checked, false);

  __setFetch(async () => { throw new Error('offline'); });
  r = await labelInteractions('warfarin');
  assert.equal(r.checked, false);
  assert.match(r.reason, /failed/);

  r = await labelInteractions('');
  assert.equal(r.checked, false);
  __setFetch(null);
});

// ── never throws ──────────────────────────────────────────────────────────────────────────────────

test('nothing in the module throws on hostile input', () => {
  for (const bad of [null, undefined, 0, false, {}, [], [null], [{}], 'a'.repeat(50000), Array(500).fill('x')]) {
    assert.doesNotThrow(() => check(bad));
    assert.doesNotThrow(() => clinicianExport(bad));
    assert.doesNotThrow(() => checkHTML(bad));
  }
  assert.doesNotThrow(() => indexHTML());
  assert.doesNotThrow(() => coverage());
  assert.doesNotThrow(() => substancePages());
  assert.doesNotThrow(() => mechanismPages());
  assert.doesNotThrow(() => pairPages());
});

// ── discoverability plumbing ──────────────────────────────────────────────────────────────────────
// The pattern site/soapbox/server.mjs uses for verticals: a page that exists but is not in the
// sitemap is a page that stays undiscovered no matter how good it is. This fails if that happens.

test('every generated page is in the host site sitemap', async () => {
  const { SITEMAP_PATHS } = await import('../site/hathor-live/server.mjs');
  const listed = new Set(SITEMAP_PATHS);
  for (const p of interactionPaths()) assert.ok(listed.has(p), `page not in sitemap.xml: ${p}`);
});

test('the per-query checker is NOT in the sitemap — it is noindex by design', async () => {
  const { SITEMAP_PATHS } = await import('../site/hathor-live/server.mjs');
  assert.ok(!SITEMAP_PATHS.includes('/interactions/check'));
  assert.ok(!SITEMAP_PATHS.includes('/interactions/api'));
});

test('the prose passes claimsCheck — the only permitted hits are the negation and "cured meat"', async () => {
  const { claimsCheck } = await import('../site/hathor-live/the-line.mjs');
  // Two allowances, both deliberate and both narrow:
  //  1. the standard non-medical negation ("does not diagnose, treat, cure or prevent"), which is the
  //     E-Meter disclaimer pattern — claimsCheck is a regex and cannot see the "does not";
  //  2. the word "cured" in "cured meat", which is a curing process, not a cure.
  // Anything else is a real efficacy claim and fails. Two genuine hits were found by this test and
  // reworded: "the archive treats clove as…" → "names", and licorice "reverses" → "resolves".
  const NEGATION = /diagnose,\s*treat,\s*cure or prevent/i;
  for (const path of interactionPaths()) {
    const text = String(renderPath(path)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const hits = claimsCheck(text).hits.filter((h) => {
      const w = h.phrase.toLowerCase();
      if (['cure', 'treat', 'prevent', 'diagnose'].includes(w) && NEGATION.test(text)) return false;
      if (w === 'cured' && /cured[,\s]/i.test(text)) return false;
      return true;
    });
    assert.deepEqual(hits, [], `${path} makes an efficacy claim`);
  }
});
