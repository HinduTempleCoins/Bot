// server.test.mjs — hathor.live chat surface. Brain injected; offline, never throws.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, esc, __setConverse, __setVideo, __setAgency } from './server.mjs';
// The exam store is injected for the whole file: the offline suite must not write to a real disk
// path, and an in-memory buffer is the same contract the module ships for reports-store.
import { __setIO as __setExamIO } from './exams-store.mjs';
import { __setIO as __setDreamIO } from './dream-journal-store.mjs';

// An in-memory store whose written bytes a test can inspect — how the "no raw key on disk"
// assertion is actually proved rather than asserted.
function memIO() {
  const files = new Map();
  return {
    files,
    read(p) { return files.get(p) || ''; },
    append(p, line) { files.set(p, (files.get(p) || '') + line); return true; },
    replace(p, contents) { files.set(p, contents); return true; },
    all() { return [...files.values()].join('\n'); },
  };
}

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}
// a fake request with an optional JSON body streamed via on('data')/on('end')
function req(path, method = 'GET', bodyObj) {
  const handlers = {};
  const r = { url: path, method, on: (ev, fn) => { handlers[ev] = fn; return r; }, destroy: () => {} };
  // drive the body after the handler subscribes
  queueMicrotask(() => {
    if (bodyObj !== undefined && handlers.data) handlers.data(JSON.stringify(bodyObj));
    if (handlers.end) handlers.end();
  });
  return r;
}

test('GET / serves the chat page', async () => {
  const { res, o } = cap();
  await handler(req('/'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /Hathor/);
  assert.match(o.body, /\/api\/chat/);   // the client posts here
});

test('POST /api/chat goes to the ONE brain (/perceive) first — same Hathor, with the visitor as the person', async () => {
  let seen = null;
  __setAgency(async (text, { from }) => { seen = { text, from }; return { reply: 'one self: ' + text, sources: [] }; });
  __setConverse(async () => { throw new Error('converse must NOT be reached when the brain answers'); });
  const { res, o } = cap();
  await handler(req('/api/chat', 'POST', { message: 'who are you?' }), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(seen.text, 'who are you?');
  assert.match(seen.from, /^web:/);                 // a per-visitor identity is passed for her memory
  assert.match(j.reply, /one self/);
  __setAgency(null); __setConverse(null);
});

test('POST /api/chat falls back to the local converse when the brain is unreachable', async () => {
  let seen = null;
  __setAgency(async () => null);                     // brain offline
  __setConverse(async (msg) => { seen = msg; return { reply: 'I am here, ' + msg, sources: [{ title: 'Rule 1', link: 'https://x/rule1' }], grounded: true }; });
  const { res, o } = cap();
  await handler(req('/api/chat', 'POST', { message: 'what is rule 1?' }), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(seen, 'what is rule 1?');
  assert.match(j.reply, /I am here/);
  assert.equal(j.sources[0].title, 'Rule 1');
  assert.equal(j.grounded, true);
  __setAgency(null); __setConverse(null);
});

test('POST /api/chat with empty message → 400 friendly', async () => {
  __setConverse(async () => ({ reply: 'should not be called', sources: [] }));
  const { res, o } = cap();
  await handler(req('/api/chat', 'POST', { message: '   ' }), res);
  assert.equal(o.code, 400);
  assert.match(JSON.parse(o.body).reply, /Ask me/i);
  __setConverse(null);
});

test('POST /api/chat soft-handles a brain that throws (never 500s the user)', async () => {
  __setAgency(async () => null);
  __setConverse(async () => { throw new Error('llm down'); });
  const { res, o } = cap();
  await handler(req('/api/chat', 'POST', { message: 'hello' }), res);
  assert.equal(o.code, 200);
  assert.match(JSON.parse(o.body).reply, /another way|do not have|resting/i);
  __setAgency(null); __setConverse(null);
});

test('POST /api/chat with neither brain available degrades gracefully', async () => {
  __setAgency(async () => null);
  __setConverse(async () => null);
  const { res, o } = cap();
  await handler(req('/api/chat', 'POST', { message: 'hi' }), res);
  assert.equal(o.code, 200);
  assert.ok(JSON.parse(o.body).reply.length > 0);
  __setAgency(null); __setConverse(null);
});

test('health + robots + 404', async () => {
  let { res, o } = cap(); await handler(req('/health'), res);
  assert.equal(o.code, 200); assert.match(o.type, /json/);
  ({ res, o } = cap()); await handler(req('/robots.txt'), res);
  assert.equal(o.code, 200); assert.match(o.body, /Disallow: \/api\//);
  ({ res, o } = cap()); await handler(req('/nope'), res);
  assert.equal(o.code, 404);
});

test('GET /studio serves the AI video studio page', async () => {
  const { res, o } = cap();
  await handler(req('/studio'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /Hathor Studio/);
  assert.match(o.body, /\/api\/video-plan/);   // the studio posts here
});

test('POST /api/video-plan routes to the director and returns a plan', async () => {
  let seen = null;
  __setVideo(async (opts) => { seen = opts; return { ok: true, title: 'T', hook: 'H', cta: 'C', scenes: [{ n: 1 }], music: { mood: 'm' }, renderManifest: {}, durationSec: 20, aspect: '9:16', kind: 'ad' }; });
  const { res, o } = cap();
  await handler(req('/api/video-plan', 'POST', { brief: 'an ad for MELEK Move', kind: 'ad', format: 'ad' }), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(seen.brief, 'an ad for MELEK Move');
  assert.equal(j.ok, true);
  assert.equal(j.title, 'T');
  __setVideo(null);
});

test('POST /api/video-plan with empty brief → 400 friendly', async () => {
  const { res, o } = cap();
  await handler(req('/api/video-plan', 'POST', { brief: '  ' }), res);
  assert.equal(o.code, 400);
  assert.match(JSON.parse(o.body).reason, /Describe your video/i);
});

test('POST /api/video-plan soft-handles a director that throws', async () => {
  __setVideo(async () => { throw new Error('boom'); });
  const { res, o } = cap();
  await handler(req('/api/video-plan', 'POST', { brief: 'x' }), res);
  assert.equal(o.code, 200);
  assert.equal(JSON.parse(o.body).ok, false);
  __setVideo(null);
});

test('esc neutralizes HTML', () => {
  assert.equal(esc('<x>&"'), '&lt;x&gt;&amp;&quot;');
});

// ── /chamber — wired 2026-09-08 ───────────────────────────────────────────────────────────────────
// chamber.mjs was written 2026-09-06, tested, and imported by nothing. These tests exist so it stays
// reachable, and so the gate it enforces is verified through the ROUTE rather than only in isolation.

test('GET /chamber with no session lists the sessions as doors', async () => {
  const { res, o } = cap();
  await handler(req('/chamber'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /The Chamber/);
  assert.match(o.body, /\/chamber\?s=/);
});

test('GET /api/chamber returns a plan with the tier ladder', async () => {
  const { res, o } = cap();
  await handler(req('/api/chamber?s=chamber-alpha'), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(j.ok, true);
  assert.deepEqual(j.tiers, ['immersive', 'cardboard', 'flat3d', 'plain']);
  assert.ok(j.plan.tier);
  assert.ok(j.plan.disclaimer, 'a plan always carries its disclaimer');
});

test('an unknown session is a 404 and names the real ones', async () => {
  const { res, o } = cap();
  await handler(req('/api/chamber?s=not-a-session'), res);
  assert.equal(o.code, 404);
  const j = JSON.parse(o.body);
  assert.equal(j.ok, false);
  assert.ok(Array.isArray(j.sessions) && j.sessions.length);
});

test('NO capabilities means plain — the server never assumes a headset is there', async () => {
  const { res, o } = cap();
  await handler(req('/api/chamber?s=chamber-alpha'), res);
  assert.equal(JSON.parse(o.body).plan.tier, 'plain');
});

test('capabilities are read from the request, and xr reaches the immersive tier', async () => {
  const { res, o } = cap();
  await handler(req('/api/chamber?s=chamber-alpha&caps=xr&consent=immersive'), res);
  assert.equal(JSON.parse(o.body).plan.tier, 'immersive');
});

test('screen consent does NOT carry into a headset — the gate holds through the route', async () => {
  const { res, o } = cap();
  await handler(req('/api/chamber?s=chamber-alpha&caps=xr&consent=screen'), res);
  const p = JSON.parse(o.body).plan;
  assert.equal(p.allowed, false);
  assert.equal(p.method, 'auditory', 'the auditory path is offered instead of nothing');
  assert.match(p.reason, /strapped to your face/);
});

test('no consent at all closes the visual path', async () => {
  const { res, o } = cap();
  await handler(req('/api/chamber?s=chamber-alpha&caps=xr'), res);
  assert.equal(JSON.parse(o.body).plan.allowed, false);
});

test('GET /chamber?s= renders the scene for that tier', async () => {
  const { res, o } = cap();
  await handler(req('/chamber?s=chamber-alpha&caps=xr&consent=immersive'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /chamber/i);
});

test('the session id is escaped into the door list', async () => {
  const { res, o } = cap();
  await handler(req('/chamber'), res);
  assert.ok(!o.body.includes('<script>alert'), 'no unescaped markup from session data');
});

// ── Temple Exams: the spine ───────────────────────────────────────────────────────────────────────

test('GET /exams serves the battery index with its limits and its refusals', async () => {
  const { res, o } = cap();
  await handler(req('/exams'), res);
  assert.equal(o.code, 200);
  assert.match(o.body, /Temple Exams/);
  assert.match(o.body, /Nothing here pays anything/);
  assert.match(o.body, /Nothing here goes on the chain/);
  assert.match(o.body, /No web page can test for tetrachromacy/);
});

test('GET /api/exams reports perception as unpayable and carries the completion counts', async () => {
  const { res, o } = cap();
  await handler(req('/api/exams'), res);
  assert.equal(o.code, 200);
  const d = JSON.parse(o.body);
  assert.equal(d.payable, false);
  assert.equal(d.onChain, false);
  assert.ok(d.completions && typeof d.completions === 'object');
});

test('POST /api/exams/forget refuses anything that is not a participant key', async () => {
  const { res, o } = cap();
  await handler(req('/api/exams/forget', 'POST', { key: 'nope' }), res);
  assert.equal(o.code, 400);
  assert.match(o.body, /Nothing was deleted/);
});

// ── Temple Exams: the grapheme–colour consistency test ────────────────────────────────────────────

test('GET /exams/grapheme serves the exam with its refusal printed on it', async () => {
  const { res, o } = cap();
  await handler(req('/exams/grapheme'), res);
  assert.equal(o.code, 200);
  assert.match(o.body, /never be worded as/);
  assert.match(o.body, /Your display is not calibrated/);
});

test('the trial order comes from the server, interleaved and never repeating', async () => {
  const { res, o } = cap();
  await handler(req('/api/exams/grapheme/trials'), res);
  const d = JSON.parse(o.body);
  assert.equal(d.trials.length, 108);
  for (let i = 1; i < d.trials.length; i += 1) {
    assert.notEqual(d.trials[i].grapheme, d.trials[i - 1].grapheme);
  }
});

test('a submission with no participant key is refused and nothing is saved', async () => {
  const { res, o } = cap();
  await handler(req('/api/exams/grapheme', 'POST', { responses: [] }), res);
  assert.equal(o.code, 400);
  assert.match(o.body, /Nothing was saved/);
});

test('a submission whose state card carries a dose is refused outright', async () => {
  const { res, o } = cap();
  await handler(req('/api/exams/grapheme', 'POST', {
    key: '0123456789ABCDEFGHJKMNPQR',
    stateCard: { affected: 'yes', classes: ['alcohol'], dose: '3 units' },
    responses: [],
  }), res);
  assert.equal(o.code, 400);
  assert.match(o.body, /does not accept/);
});

// ── Temple Exams: VVIQ ────────────────────────────────────────────────────────────────────────────

test('GET /exams/vviq states the scale direction on the page', async () => {
  const { res, o } = cap();
  await handler(req('/exams/vviq'), res);
  assert.equal(o.code, 200);
  assert.match(o.body, /1 means no image at all/);
  assert.match(o.body, /never be worded as/);
});

test('the VVIQ form is served with its four scenes and sixteen items', async () => {
  const { res, o } = cap();
  await handler(req('/api/exams/vviq/form'), res);
  const d = JSON.parse(o.body);
  assert.equal(d.form.length, 4);
  assert.equal(d.form.reduce((n, s) => n + s.items.length, 0), 16);
});

test('a VVIQ submission with a key scores, stores and reports the pair honestly', async () => {
  let buf = '';
  __setExamIO({ read: () => buf, append: (_p, line) => { buf += line; return true; } });
  const answers = {};
  for (const s of ['person', 'sunrise', 'shop', 'country']) for (let i = 1; i <= 4; i += 1) answers[`${s}.${i}`] = 1;
  const { res, o } = cap();
  await handler(req('/api/exams/vviq', 'POST', { key: '0123456789ABCDEFGHJKMNPQR', answers }), res);
  assert.equal(o.code, 200);
  const d = JSON.parse(o.body);
  assert.equal(d.result.score.total, 16);
  assert.match(d.copy.headline, /VVIQ 16 of 80/);
  // The only place that phrase may appear is the `neverSay` field, which exists so the page can
  // print "this result will never be worded as ..." out loud. Nowhere in the copy itself.
  const said = [d.copy.headline, ...d.copy.lines, ...d.copy.landmarks.map((l) => `${l.text} ${l.source}`)].join(' ');
  assert.ok(!/you have aphantasia/i.test(said), said);
  assert.equal(d.copy.neverSay, 'You have aphantasia.');
  assert.match(d.copy.landmarks[0].text, /no consensus cut-off/);
  assert.match(buf, /"exam":"vviq"/, 'the sitting must actually reach the store');
  assert.ok(!buf.includes('0123456789ABCDEFGHJKMNPQR'), 'the raw participant key must never be written');
  __setExamIO(null);
});

// ── /the-line — the pair, made reachable to a reader ──────────────────────────────────────────────

test('GET /the-line serves both precedents, both sentences, and the failed defences', async () => {
  const { res, o } = cap();
  await handler(req('/the-line'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /Two lamps/);
  assert.match(o.body, /333 F\. Supp\. 357/);
  assert.match(o.body, /165 F\.2d 957/);
  assert.match(o.body, /Attuned Color Waves/);            // the condemned label, verbatim
  assert.match(o.body, /not medically or scientifically useful/);  // the ordered disclaimer, verbatim
  assert.match(o.body, /The devices are not what differ/);
  assert.match(o.body, /He was religious, and it is in the record/);
  assert.match(o.body, /class="consult"/);
  // Self-contained: nothing to load, no script.
  assert.ok(!/<script/i.test(o.body));
});

test('the context query is an allow-list and junk falls back rather than erroring', async () => {
  for (const ctx of ['colour', 'entrainment', 'practices', 'exams']) {
    const { res, o } = cap();
    await handler(req(`/the-line?context=${ctx}`), res);
    assert.equal(o.code, 200, ctx);
  }
  const { res, o } = cap();
  await handler(req('/the-line?context=%3Cscript%3Ealert(1)%3C/script%3E'), res);
  assert.equal(o.code, 200);
  assert.ok(!o.body.includes('<script>alert'));
  assert.match(o.body, /no colour is matched to a condition/, 'junk falls back to the colour context');
});

test('/api/the-line serves the pair as JSON for other surfaces', async () => {
  const { res, o } = cap();
  await handler(req('/api/the-line?context=colour'), res);
  assert.equal(o.code, 200);
  const d = JSON.parse(o.body);
  assert.equal(d.pair.length, 2);
  assert.equal(d.pair[0].outcome, 'released');
  assert.equal(d.pair[1].outcome, 'condemned');
  assert.match(d.disclaimer, /no colour is matched to a condition/);
});

test('⭐ the colour surfaces render the colour context, and the non-colour ones do not', async () => {
  const banner = (body) => String(body).split('</aside>')[0];

  for (const path of ['/exams/colour-naming', '/exams/thread?set=colour']) {
    const { res, o } = cap();
    await handler(req(path), res);
    assert.equal(o.code, 200, path);
    assert.match(banner(o.body), /no colour is matched to a condition/, path);
    // AND the exams wording, which says who may interpret a number. Neither substitutes for the other.
    assert.match(banner(o.body), /that reading is theirs to make, not ours/, path);
  }

  // A disclaimer printed where it does not apply teaches a reader to skip disclaimers.
  for (const path of ['/exams/vviq', '/exams/thread?set=rhythm', '/exams/human-or-model']) {
    const { res, o } = cap();
    await handler(req(path), res);
    assert.ok(!/no colour is matched to a condition/.test(banner(o.body)), path);
  }
});

test('the entrainment library carries the colour doctrine too — half that page is light', async () => {
  const { res, o } = cap();
  await handler(req('/40hz'), res);
  assert.equal(o.code, 200);
  assert.match(o.body, /no colour is matched to a condition/);
  assert.match(o.body, /href="\/the-line\?context=colour"/);
  assert.match(o.body, /five coloured glass slides/);
});

test('every exam page links to where the line is', async () => {
  for (const path of ['/exams', '/exams/vviq', '/the-256']) {
    const { res, o } = cap();
    await handler(req(path), res);
    assert.match(o.body, /href="\/the-line"/, path);
  }
});

// ── /the-256 — the refusal IS the content (R2) ────────────────────────────────────────────────────

test('GET /the-256 teaches the structure and refuses the content in the same breath', async () => {
  const { res, o } = cap();
  await handler(req('/the-256'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /2<sup>8<\/sup> = 256/);
  assert.match(o.body, /has performed a divination/);
  assert.match(o.body, /Copyright expiry is not consent/);
  assert.match(o.body, /508 U\.S\. 520 \(1993\)/);
  assert.match(o.body, /00146/);
  assert.match(o.body, /class="consult"/);
  // The grid is 256 unlabelled cells.
  assert.equal((o.body.match(/<i class="cell/g) || []).length, 256);
});

test('⛔ the cast endpoint hands back an address and nothing that could be read as an answer', async () => {
  const seen = new Set();
  for (let i = 0; i < 25; i += 1) {
    const { res, o } = cap();
    await handler(req('/api/the-256/cast'), res);
    assert.equal(o.code, 200);
    const d = JSON.parse(o.body);
    assert.deepEqual(Object.keys(d.cast).sort(), ['address', 'addressSpace', 'bits', 'marks']);
    assert.ok(Number.isInteger(d.cast.address) && d.cast.address >= 0 && d.cast.address < 256);
    seen.add(d.says);
  }
  // ⭐ One sentence, at every address. There is no branch on the cast anywhere in the path.
  assert.equal(seen.size, 1);
  assert.match([...seen][0], /neither of those is software/);
});

test('the comparative table is served and the geomancy link is marked contested, not asserted', async () => {
  const { res, o } = cap();
  await handler(req('/the-256'), res);
  assert.match(o.body, /I Ching/);
  assert.match(o.body, /Dilog[úu]n/);
  assert.match(o.body, /ʿilm al-raml/);
  assert.match(o.body, /contested/);
  assert.ok(!/derived from Arabic geomancy/i.test(o.body));
});

// ── Temple Exams: the Thread Protocol (R1) ────────────────────────────────────────────────────────

test('GET /exams/thread states the attribution and the refusal before anything else', async () => {
  const { res, o } = cap();
  await handler(req('/exams/thread'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /khayt/);
  assert.match(o.body, /kodia/);
  assert.match(o.body, /borrowing the method/i);
  assert.match(o.body, /It will never name a spirit, a Thread or a deity/);
  assert.match(o.body, /class="consult"/);
});

test('GET /exams/thread?set=colour serves the colour set with the colour disclaimer', async () => {
  const { res, o } = cap();
  await handler(req('/exams/thread?set=colour'), res);
  assert.equal(o.code, 200);
  assert.match(o.body, /no colour is matched to a condition/);
  assert.match(o.body, /not calibrated and cannot be/);
});

test('a junk set falls back to the rhythms rather than erroring', async () => {
  const { res, o } = cap();
  await handler(req('/exams/thread?set=%3Cscript%3E'), res);
  assert.equal(o.code, 200);
  assert.ok(!o.body.includes('<script>alert'), 'nothing from the query string is interpolated raw');
  assert.match(o.body, /sixteen rhythms/i);
});

test('the run endpoint serves three blocks and never tells the browser which is a repeat', async () => {
  const { res, o } = cap();
  await handler(req('/api/exams/thread/run?set=rhythm'), res);
  assert.equal(o.code, 200);
  const d = JSON.parse(o.body);
  assert.equal(d.run.trials.length, 48);
  assert.equal(d.run.blocks, 3);
  // `block` is present because the SCORING needs it; the page never renders it. What must not be
  // present is anything naming a repeat, which would turn a reproduction test into a memory test.
  assert.ok(!/repeat|again|second time/i.test(o.body));
  assert.ok(!/seed/i.test(o.body), 'the run seed stays on the server');
});

test('⭐ a Thread sitting whose profile repeats names the STIMULUS and nothing else', async () => {
  let buf = '';
  __setExamIO({ read: () => buf, append: (_p, line) => { buf += line; return true; } });
  // A synthetic participant with a real, reproducible profile: intensity rises with the figure index,
  // with a small block-dependent wobble so the blocks agree strongly rather than identically.
  const ids = Array.from({ length: 16 }, (_, i) => `r${String(i + 1).padStart(2, '0')}`);
  const responses = [];
  for (let b = 0; b < 3; b += 1) ids.forEach((id, i) => responses.push({ block: b, stimulus: id, intensity: i * 5 + ((i + b) % 3) }));
  const { res, o } = cap();
  await handler(req('/api/exams/thread', 'POST',
    { key: '0123456789ABCDEFGHJKMNPQR', set: 'rhythm', responses, blocks: 3 }), res);
  assert.equal(o.code, 200);
  const d = JSON.parse(o.body);
  assert.equal(d.result.repeats, true);
  assert.equal(d.result.peak.id, 'r16');
  assert.equal(d.result.peak.wonBlocks, 3);
  assert.ok(d.result.score.meanR > 0.99);
  assert.ok(d.result.score.p < 0.05);
  assert.match(d.copy.peakLine, /r16/);
  const said = [d.copy.headline, ...d.copy.lines].join(' ');
  assert.match(said, /It does not name a spirit, a Thread, a deity/);
  assert.ok(!/your Thread is|this is your Thread/i.test(said), said);
  assert.match(buf, /"exam":"thread"/);
  assert.ok(!buf.includes('0123456789ABCDEFGHJKMNPQR'), 'the raw participant key must never be written');
  __setExamIO(null);
});

test('⭐ a Thread sitting that does not repeat says so and refuses to name a peak', async () => {
  let buf = '';
  __setExamIO({ read: () => buf, append: (_p, line) => { buf += line; return true; } });
  const ids = Array.from({ length: 16 }, (_, i) => `r${String(i + 1).padStart(2, '0')}`);
  const perms = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [7, 2, 14, 5, 0, 11, 3, 15, 8, 1, 12, 6, 9, 4, 13, 10],
    [12, 9, 4, 15, 6, 1, 13, 0, 11, 7, 2, 10, 5, 14, 3, 8],
  ];
  const responses = [];
  perms.forEach((p, b) => ids.forEach((id, i) => responses.push({ block: b, stimulus: id, intensity: p[i] * 5 })));
  const { res, o } = cap();
  await handler(req('/api/exams/thread', 'POST',
    { key: '0123456789ABCDEFGHJKMNPQR', set: 'rhythm', responses, blocks: 3 }), res);
  assert.equal(o.code, 200);
  const d = JSON.parse(o.body);
  assert.equal(d.result.repeats, false);
  assert.match(d.copy.peakLine, /cannot tell your largest response from noise/);
  // ⭐ The bad number is printed. Especially when it is bad.
  assert.match(d.copy.repeatLine, /Mean r = /);
  assert.match(d.copy.repeatLine, /p = /);
  assert.ok(!/Your largest response was to/.test(d.copy.lines.join(' ')));
  __setExamIO(null);
});

test('one block is refused — the repeat statistic IS the instrument, so nothing is stored', async () => {
  let buf = '';
  __setExamIO({ read: () => buf, append: (_p, line) => { buf += line; return true; } });
  const responses = Array.from({ length: 16 }, (_, i) => ({ block: 0, stimulus: `r${String(i + 1).padStart(2, '0')}`, intensity: i * 4 }));
  const { res, o } = cap();
  await handler(req('/api/exams/thread', 'POST',
    { key: '0123456789ABCDEFGHJKMNPQR', set: 'rhythm', responses, blocks: 3 }), res);
  assert.equal(o.code, 400);
  assert.match(JSON.parse(o.body).error, /Fewer than two complete blocks/);
  assert.equal(buf, '', 'nothing may be stored when there is nothing to compare');
  __setExamIO(null);
});

test('the Thread result carries the R7 covariate — sixteen sliders is a report, not a behaviour', async () => {
  let buf = '';
  __setExamIO({ read: () => buf, append: (_p, line) => { buf += line; return true; } });
  const ids = Array.from({ length: 16 }, (_, i) => `r${String(i + 1).padStart(2, '0')}`);
  const responses = [];
  for (let b = 0; b < 3; b += 1) ids.forEach((id, i) => responses.push({ block: b, stimulus: id, intensity: i * 5 + ((i + b) % 3) }));
  const { res, o } = cap();
  await handler(req('/api/exams/thread', 'POST',
    { key: '0123456789ABCDEFGHJKMNPQR', set: 'rhythm', responses }), res);
  const d = JSON.parse(o.body);
  assert.ok(d.covariate, 'the expectancy covariate must print beside a Thread result');
  assert.equal(d.covariate.hasIndex, false);
  assert.match(d.covariate.lines.join(' '), /the Thread Protocol/);
  __setExamIO(null);
});

// ── Temple Exams: the expectancy index, and the covariate it prints elsewhere (R7) ────────────────

test('GET /exams/suggestibility names its refusals and does not call itself hypnotisability', async () => {
  const { res, o } = cap();
  await handler(req('/exams/suggestibility'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /Tellegen Absorption Scale/);
  assert.match(o.body, /NOT a hypnotisability scale/);
  assert.match(o.body, /never be worded as/);
  assert.match(o.body, /You are highly hypnotisable\./);   // only inside the never-worded-as line
  assert.match(o.body, /class="consult"/);
});

test('the expectancy form serves twelve items and two probes, and hides which probe suggests', async () => {
  const { res, o } = cap();
  await handler(req('/api/exams/suggestibility/form'), res);
  assert.equal(o.code, 200);
  const d = JSON.parse(o.body);
  assert.equal(d.form.items.length, 12);
  assert.equal(d.form.probes.length, 2);
  assert.ok(!JSON.stringify(d.form.probes).includes('suggests'),
    'telling the browser which passage is the suggestion would wreck the difference');
});

test('an expectancy submission scores, stores, and never writes the raw key', async () => {
  let buf = '';
  __setExamIO({ read: () => buf, append: (_p, line) => { buf += line; return true; } });
  const answers = { e1: 3, e2: 2, e3: 4, c1: 1, c2: 2, c3: 3, d1: 4, d2: 4, d3: 2, s1: 1, s2: 3, s3: 0 };
  const { res, o } = cap();
  await handler(req('/api/exams/suggestibility', 'POST',
    { key: '0123456789ABCDEFGHJKMNPQR', answers, probes: { suggested: 62, unsuggested: 31 } }), res);
  assert.equal(o.code, 200);
  const d = JSON.parse(o.body);
  // 3+2+4 + 1+2+3 + 4+4+2 + 1+3+0 = 9 + 6 + 10 + 4 = 29
  assert.equal(d.result.score.total, 29);
  assert.deepEqual(d.result.byFacet, { expectancy: 9, control: 6, described: 10, social: 4 });
  assert.equal(d.result.score.probeDifference, 31);
  assert.match(d.copy.headline, /Expectancy uptake 29 of 48/);
  const said = [d.copy.headline, ...d.copy.lines].join(' ');
  assert.ok(!/you are highly hypnotisable/i.test(said), said);
  assert.match(buf, /"exam":"suggestibility"/);
  assert.ok(!buf.includes('0123456789ABCDEFGHJKMNPQR'), 'the raw participant key must never be written');
  __setExamIO(null);
});

test('a submission with no key is refused and nothing is stored', async () => {
  let buf = '';
  __setExamIO({ read: () => buf, append: (_p, line) => { buf += line; return true; } });
  const { res, o } = cap();
  await handler(req('/api/exams/suggestibility', 'POST', { answers: { e1: 1 } }), res);
  assert.equal(o.code, 400);
  assert.equal(buf, '');
  __setExamIO(null);
});

test('⭐ R7 END TO END: the VVIQ result carries the taker\'s expectancy index beside it', async () => {
  let buf = '';
  __setExamIO({ read: () => buf, append: (_p, line) => { buf += line; return true; } });
  const KEY = 'ZZZZZ11111ZZZZZ22222ZZZZZ';

  // First sitting: the VVIQ, with no expectancy index on file yet.
  const answers = {};
  for (const s of ['person', 'sunrise', 'shop', 'country']) for (let i = 1; i <= 4; i += 1) answers[`${s}.${i}`] = 3;
  let c = cap();
  await handler(req('/api/exams/vviq', 'POST', { key: KEY, answers }), c.res);
  let d = JSON.parse(c.o.body);
  assert.equal(d.result.score.total, 48);
  assert.equal(d.covariate.hasIndex, false, 'nothing on file yet, and it must say so rather than assume');
  assert.match(d.covariate.headline, /have not sat/);
  assert.match(d.covariate.source, /10\.1038\/s41467-020-18591-6/);

  // Now sit the expectancy index under the same key.
  const sugg = {}; for (const k of ['e1', 'e2', 'e3', 'c1', 'c2', 'c3', 'd1', 'd2', 'd3', 's1', 's2', 's3']) sugg[k] = 3;
  c = cap();
  await handler(req('/api/exams/suggestibility', 'POST', { key: KEY, answers: sugg, probes: { suggested: 80, unsuggested: 20 } }), c.res);
  assert.equal(JSON.parse(c.o.body).result.score.total, 36);

  // And take the VVIQ again. The covariate is now printed beside it.
  c = cap();
  await handler(req('/api/exams/vviq', 'POST', { key: KEY, answers }), c.res);
  d = JSON.parse(c.o.body);
  assert.equal(d.covariate.hasIndex, true);
  assert.equal(d.covariate.total, 36);
  assert.match(d.covariate.headline, /Expectancy uptake: 36 of 48/);
  // n is 1, far below 100, so there is a raw score and NO percentile.
  assert.equal(d.covariate.percentile, null);
  assert.match(d.covariate.lines.join(' '), /too few to place you among them/);
  assert.match(d.covariate.lines.join(' '), /report more of everything/);
  __setExamIO(null);
});

test('the covariate does not appear on the exams whose datum is a behaviour', async () => {
  let buf = '';
  __setExamIO({ read: () => buf, append: (_p, line) => { buf += line; return true; } });
  const { res, o } = cap();
  await handler(req('/api/exams/colour-naming', 'POST',
    { key: '0123456789ABCDEFGHJKMNPQR', responses: [{ hex: '#ff0000', name: 'red' }] }), res);
  const d = JSON.parse(o.body);
  assert.equal(o.code, 200);
  assert.equal(d.covariate, undefined,
    'typing a word for a swatch is a behaviour, and blanket-flagging it would be theatre');
  __setExamIO(null);
});

// ── Temple Exams: X7, human or model ──────────────────────────────────────────────────────────────

test('GET /exams/human-or-model states the design and the never-worded-as before anything else', async () => {
  const { res, o } = cap();
  await handler(req('/exams/human-or-model'), res);
  assert.equal(o.code, 200);
  assert.match(o.body, /exactly one passage written by a person and one passage written by a model/);
  assert.match(o.body, /never be worded as/);
  assert.match(o.body, /Philip K. Dick/);
  assert.match(o.body, /built-in SEED set/);
});

test('the trials endpoint serves the pairs and leaks no provenance to the browser', async () => {
  const { res, o } = cap();
  await handler(req('/api/exams/human-or-model/trials'), res);
  const d = JSON.parse(o.body);
  assert.ok(d.seed, 'the seed IS the stateless answer key and must come back');
  assert.ok(d.trials.length >= 6);
  assert.equal(d.kind, 'seed');
  const json = JSON.stringify(d.trials);
  assert.ok(!/Austen|Melville|Claude|generatedAt|modelSide/i.test(json), 'provenance leaked into the trials');
});

test('a human-or-model submission scores, stores, debriefs and hands back a clean share link', async () => {
  let buf = '';
  __setExamIO({ read: () => buf, append: (_p, line) => { buf += line; return true; } });

  // Build a real answer set against the real key: seven right, three wrong, all at 85% confidence.
  const { answerKey, buildTrials } = await import('./exam-human-or-model.mjs');
  const seed = 'server-test-seed';
  const key = answerKey({ seed });
  const flip = (x) => (x === 'a' ? 'b' : 'a');
  const responses = buildTrials({ seed }).trials.map((t, i) => ({
    id: t.id,
    choice: i < 7 ? key.get(t.id).modelSide : flip(key.get(t.id).modelSide),
    confidence: 85,
    recognised: false,
  }));

  const { res, o } = cap();
  await handler(req('/api/exams/human-or-model', 'POST', {
    key: '0123456789ABCDEFGHJKMNPQR', seed, responses,
  }), res);
  assert.equal(o.code, 200);
  const d = JSON.parse(o.body);
  assert.equal(d.result.graded.correct, 7);
  assert.equal(d.result.graded.n, 10);
  // √2 · z(0.7) = 1.414214 × 0.5244005 = 0.7416, hand-checked.
  assert.match(d.copy.headline, /d′ 0\.74 — 7 of 10 pairs, at an average stated confidence of 85%/);
  // The debrief arrives WITH the result, not after it.
  assert.ok(d.copy.debrief.rows.length === 10);
  assert.match(d.copy.debrief.rows[0].modelSource, /generated 2026-09-08/);
  // The moving-target limit is on the result screen.
  assert.ok(d.copy.lines.some((l) => /against that vintage of model and no other/.test(l)));
  // No identity, ever.
  const said = [d.copy.headline, ...d.copy.lines].join(' ');
  assert.ok(!/replicant/i.test(said), said);
  // The share link carries numbers and the stimulus date, and nothing about the person.
  assert.match(d.shareUrl, /\/exams\/human-or-model\/result\?/);
  assert.match(d.shareUrl, /v=2026-09-08/);
  assert.ok(!d.shareUrl.includes('0123456789ABCDEFGHJKMNPQR'));
  assert.ok(!/seed|key|pid/.test(d.shareUrl), d.shareUrl);
  // The sitting reached the store, with the vintage attached and the raw key nowhere near it.
  assert.match(buf, /"exam":"human-or-model"/);
  assert.match(buf, /"stimulusVintage"/);
  assert.ok(!buf.includes('0123456789ABCDEFGHJKMNPQR'), 'the raw participant key must never be written');
  __setExamIO(null);
});

test('a submission with no participant key and one with no judgements are both refused, storing nothing', async () => {
  let buf = '';
  __setExamIO({ read: () => buf, append: (_p, line) => { buf += line; return true; } });
  const a = cap();
  await handler(req('/api/exams/human-or-model', 'POST', { seed: 'x', responses: [] }), a.res);
  assert.equal(a.o.code, 400);
  assert.match(JSON.parse(a.o.body).error, /Nothing was saved/);
  const b = cap();
  await handler(req('/api/exams/human-or-model', 'POST', { key: '0123456789ABCDEFGHJKMNPQR', seed: 'x', responses: [] }), b.res);
  assert.equal(b.o.code, 400);
  assert.match(JSON.parse(b.o.body).error, /No pair was judged/);
  assert.equal(buf, '', 'a refused submission must not write a sitting');
  __setExamIO(null);
});

test('the share page and the share card render from the URL alone, with the vintage stamp on both', async () => {
  const q = '?d=0.7&k=7&n=10&c=85&b=0.19&v=2026-09-08';
  const page = cap();
  await handler(req(`/exams/human-or-model/result${q}`), page.res);
  assert.equal(page.o.code, 200);
  assert.match(page.o.type, /text\/html/);
  assert.match(page.o.body, /og:image/);
  assert.match(page.o.body, /Stimuli generated 2026-09-08/);
  assert.match(page.o.body, /7<\/b> of <b>10/);

  const card = cap();
  await handler(req(`/exams/human-or-model/card.svg${q}`), card.res);
  assert.equal(card.o.code, 200);
  assert.match(card.o.type, /image\/svg\+xml/);
  assert.match(card.o.body, /d′ 0\.7/);
  assert.match(card.o.body, /stimuli generated 2026-09-08/);
});

// ── Temple Exams: free colour naming ──────────────────────────────────────────────────────────────

test('GET /exams/colour-naming says it keeps answers verbatim and is not a vision test', async () => {
  const { res, o } = cap();
  await handler(req('/exams/colour-naming'), res);
  assert.equal(o.code, 200);
  assert.match(o.body, /nothing is snapped to a list of approved colour words/);
  assert.match(o.body, /It is not a vision test and cannot become one/);
});

test('the swatch block is served in gamut, stratified, and bounded', async () => {
  const { res, o } = cap();
  await handler(req('/api/exams/colour-naming/swatches?n=9999'), res);
  const d = JSON.parse(o.body);
  assert.equal(d.swatches.length, 200);
  assert.ok(d.swatches.every((s) => s.inGamut));
});

test('a naming submission stores the words exactly as typed and never the raw key', async () => {
  let buf = '';
  __setExamIO({ read: () => buf, append: (_p, line) => { buf += line; return true; } });
  const { res, o } = cap();
  await handler(req('/api/exams/colour-naming', 'POST', {
    key: '0123456789ABCDEFGHJKMNPQR',
    responses: [
      { hex: '#3366cc', name: 'Cerulean-ish', ms: 900 },
      { hex: '#7fff00', name: 'chartreuse', ms: 700 },
    ],
    display: { gamut: 'p3', scheme: 'dark', dpr: 2 },
  }), res);
  assert.equal(o.code, 200);
  const d = JSON.parse(o.body);
  assert.match(d.copy.headline, /2 words for 2 colours/);
  assert.match(buf, /Cerulean-ish/, 'the verbatim spelling must reach the store');
  assert.ok(!buf.includes('0123456789ABCDEFGHJKMNPQR'), 'the raw participant key must never be written');
  assert.ok(!/you have|your eyes are/i.test(d.copy.lines.join(' ')));
  __setExamIO(null);
});

test('GET /metronome serves the metronome, and it is listed in the sitemap', async () => {
  const { res, o } = cap();
  await handler(req('/metronome'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /<title>Metronome/);
  assert.ok(!/setInterval\s*\(/.test(o.body), 'the metronome must never call setInterval');

  const { res: r2, o: o2 } = cap();
  await handler(req('/sitemap.xml'), r2);
  assert.equal(o2.code, 200);
  assert.match(o2.body, /\/metronome/);
});

// --- /dreams — R1, the dream journal ------------------------------------------------------------
// The IO is injected so the offline suite never touches a real path, and so the privacy assertion
// can grep exactly the bytes the store handed to it — which is the only form of that proof worth
// having. See dream-journal.test.mjs for the module-level version.

test('GET /dreams serves the journal with the consult banner and no share card', async () => {
  const io = memIO();
  __setDreamIO(io);
  const { res, o } = cap();
  await handler(req('/dreams'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /The dream journal/);
  assert.match(o.body, /class="consult"/);          // examShell carries it
  assert.match(o.body, /not a laboratory result/i); // CONSULT.notALab
  assert.match(o.body, /contested/);                // the light switch, graded honestly
  assert.ok(!/share|percentile/i.test(o.body.replace(/refuses to do|no score, no percentile[^<]*/gi, '')));
  __setDreamIO(null);
});

test('/dreams is in the sitemap — a page nobody can find is not shipped', async () => {
  const { SITEMAP_PATHS } = await import('./server.mjs');
  assert.ok(SITEMAP_PATHS.includes('/dreams'));
});

test('⚠️ POST /api/dreams/entry hashes the key — the raw key never reaches the store', async () => {
  const io = memIO();
  __setDreamIO(io);
  const KEY = 'H4TH0R9QXKM2VWZ3B7NPC5RJ8';
  const { res, o } = cap();
  await handler(req('/api/dreams/entry', 'POST', {
    key: KEY,
    entry: { night: '2026-09-08', recall: 'scene', lucidity: 2, text: 'A corridor of doors.' },
  }), res);
  assert.equal(o.code, 200);
  const json = JSON.parse(o.body);
  assert.equal(json.ok, true);
  assert.equal(json.entryNumber, 1);

  const bytes = io.all();
  assert.ok(bytes.includes('A corridor of doors.'), 'the entry must actually have been written');
  assert.equal(bytes.split(KEY).length - 1, 0, 'the raw key reached the store');
  assert.equal(bytes.split(KEY.toLowerCase()).length - 1, 0);
  assert.equal(bytes.split('H4TH0-R9QXK').length - 1, 0, 'a grouped key reached the store');
  // And the reply carries no key either.
  assert.equal(o.body.includes(KEY), false);
  __setDreamIO(null);
});

test('POST /api/dreams/entry refuses a bad key and says nothing was saved', async () => {
  const io = memIO();
  __setDreamIO(io);
  const { res, o } = cap();
  await handler(req('/api/dreams/entry', 'POST', { key: 'not-a-key', entry: { text: 'x' } }), res);
  assert.equal(o.code, 400);
  assert.match(o.body, /Nothing was saved/);
  assert.equal(io.all(), '');
  __setDreamIO(null);
});

test('POST /api/dreams/export returns THIS person’s record as a downloadable text file', async () => {
  const io = memIO();
  __setDreamIO(io);
  const KEY = 'H4TH0R9QXKM2VWZ3B7NPC5RJ8';
  await handler(req('/api/dreams/entry', 'POST', { key: KEY, entry: { night: '2026-09-08', recall: 'full', text: 'the sea' } }), cap().res);
  const { res, o } = cap();
  await handler(req('/api/dreams/export', 'POST', { key: KEY }), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/plain/);
  assert.match(o.body, /DREAM JOURNAL/);
  assert.match(o.body, /the sea/);
  assert.match(o.body, /not a laboratory result/i);
  assert.match(o.body, /no comparison group and no percentile/i);
  __setDreamIO(null);
});

test('⚠️ POST /api/dreams/forget actually empties the store', async () => {
  const io = memIO();
  __setDreamIO(io);
  const KEY = 'H4TH0R9QXKM2VWZ3B7NPC5RJ8';
  await handler(req('/api/dreams/entry', 'POST', { key: KEY, entry: { night: '2026-09-08', text: 'the sea behind the door' } }), cap().res);
  assert.ok(io.all().includes('the sea behind the door'));
  const { res, o } = cap();
  await handler(req('/api/dreams/forget', 'POST', { key: KEY }), res);
  assert.equal(o.code, 200);
  const json = JSON.parse(o.body);
  assert.equal(json.ok, true);
  assert.equal(json.removed, 1);
  assert.equal(json.method, 'rewritten');
  assert.equal(io.all().includes('the sea behind the door'), false, 'the bytes are still there');
  __setDreamIO(null);
});

test('GET /api/dreams describes the build and serves no participant data', async () => {
  const { res, o } = cap();
  await handler(req('/api/dreams'), res);
  assert.equal(o.code, 200);
  const json = JSON.parse(o.body);
  assert.equal(json.grade, 3);
  assert.equal(json.shareCard, false);
  assert.equal(json.onChain, false);
  assert.equal(json.payable, false);
  assert.equal(json.interpretation, false);
  assert.equal(o.body.includes('pid'), false);
});
