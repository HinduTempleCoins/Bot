// Offline. No network, no listen — the handler is driven directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { handler, pace, esc } from './server.mjs';
import { TIMELINE, SUCCESSORS, UNVERIFIED, POSITION } from './history.mjs';
import { WATCHING, OURS, WHY } from './watching.mjs';

function res() {
  const chunks = [];
  const r = new Writable({ write(c, e, cb) { chunks.push(c); cb(); } });
  r.writeHead = (code, h) => { r.code = code; r.headers = h || {}; };
  r.done = new Promise((ok) => r.on('finish', ok));
  r.body = () => Buffer.concat(chunks).toString();
  return r;
}
const get = async (url) => { const r = res(); await handler({ url, headers: {} }, r); r.end(); await r.done; return r; };

test('the pace maths is right at the edges', () => {
  const start = pace({ goal: 50000, days: 30, written: 0, dayNumber: 1 });
  assert.equal(start.dailyTarget, 1667);
  assert.equal(start.needPerDay, Math.ceil(50000 / 29));
  const half = pace({ goal: 50000, days: 30, written: 25000, dayNumber: 15 });
  assert.equal(half.parTotal, 25000);
  assert.equal(half.ahead, 0);
  const lastDay = pace({ goal: 50000, days: 30, written: 49000, dayNumber: 30 });
  assert.equal(lastDay.daysLeft, 0);
  assert.equal(lastDay.needPerDay, 1000, 'on the final day you need exactly what is left, never a divide-by-zero');
  const over = pace({ goal: 50000, days: 30, written: 60000, dayNumber: 20 });
  assert.equal(over.done, true);
  assert.equal(over.remaining, 0);
  assert.equal(over.percent, 100, 'percent is capped, not 120');
  // garbage in must not produce NaN
  const junk = pace({ goal: 'x', days: 0, written: -5, dayNumber: 999 });
  for (const v of Object.values(junk)) assert.equal(Number.isNaN(v), false);
});

test('every route renders, and an unknown path is a 404 not a 500', async () => {
  for (const p of ['/', '/preptober', '/history']) {
    const r = await get(p);
    assert.equal(r.code, 200, p);
    assert.match(r.body(), /<\/html>/);
  }
  assert.equal((await get('/health')).code, 200);
  assert.equal((await get('/nope')).code, 404);
  assert.match((await get('/nope')).body(), /noindex/);
});

test('⭐ the page promises privacy and the markup keeps the promise', async () => {
  const b = (await get('/')).body();
  assert.match(b, /never leaves your browser|stays in your browser/i);
  // no form posts anything anywhere, and nothing is fetched at runtime
  assert.doesNotMatch(b, /<form/i);
  assert.doesNotMatch(b, /fetch\(|XMLHttpRequest|navigator\.sendBeacon/);
  assert.doesNotMatch(b, /src=["']https?:/, 'no third-party script or CDN');
  assert.match(b, /localStorage/);
  // export is offered, because a file on your own disk is the only copy nobody can switch off
  assert.match(b, /Export \.json/);
  assert.match(b, /Export \.csv/);
});

test('⭐ no payouts, no score — the operator rule, pinned', async () => {
  const b = (await get('/')).body();
  assert.match(b, /no payout|No payouts/i);
  assert.doesNotMatch(b, /earn (MELEK|rewards)|reward pool|leaderboard rank/i);
  // posting to MELEK is offered only as an optional, separate choice
  assert.match(b, /optional/i);
});

test('the history is graded, and nothing ungraded sneaks in', () => {
  const ok = new Set(['established', 'contested', 'unverified']);
  for (const t of TIMELINE) {
    assert.ok(ok.has(t.grade), `${t.when} has grade ${t.grade}`);
    assert.ok(t.what.length > 40, `${t.when} needs a real sentence`);
  }
  // the two corrections we made to the briefing we were handed must survive edits
  const all = TIMELINE.map((t) => t.what).join(' ');
  assert.match(all, /unrelated code-of-conduct/, 'the moderator was removed for something else — keep that');
  assert.match(all, /not the sole cause|long trend rather than a single scandal/, 'the org blamed six years of finances, not just the AI post');
  const faulkner = TIMELINE.find((t) => /Faulkner/.test(t.what));
  assert.equal(faulkner.grade, 'contested', 'we record the departure, not the motive');
});

test('⭐ anything still graded unverified is badged, never listed as real', async () => {
  const names = SUCCESSORS.map((s) => s.name.toLowerCase());
  for (const u of UNVERIFIED) {
    assert.equal(names.some((n) => n.includes(u.toLowerCase().split(' ')[0])), false,
      `${u} must not appear in the confirmed successor list`);
  }
  const b = (await get('/history')).body();
  for (const u of UNVERIFIED) {
    const i = b.indexOf(esc(u));
    if (i === -1) continue;
    assert.match(b.slice(Math.max(0, i - 120), i), /g unverified/, `${u} must carry the unverified badge`);
  }
  assert.ok(SUCCESSORS.length >= 10, 'the successor list must stay comprehensive');
  for (const s of SUCCESSORS) assert.ok(s.what.length > 30, s.name);
});

test('⭐ the four that were wrongly doubted are listed as real, with who runs them', async () => {
  // These were marked unverified off ONE broad search. All four exist. The page must name them and
  // must carry the note explaining how the mistake happened, so it is not repeated.
  const b = (await get('/history')).body();
  for (const [name, by] of [['PaWriCo', 'Rain and Jen'], ['Order of the Written Word', 'Holly Rhiannon'],
    ['NaNo 2.0', 'Kristina Horner'], ['Novel 90', 'AutoCrit']]) {
    const s = SUCCESSORS.find((x) => x.name.includes(name));
    assert.ok(s, `${name} must be a confirmed successor`);
    assert.match(s.by, new RegExp(by.split(' ')[0]), `${name} must say who runs it`);
    assert.ok(b.includes(esc(s.name)), `${name} must render on the page`);
  }
  assert.match(b, /Absence from a single search result is not absence from the world/);
});

test('every interpolated value is escaped', () => {
  assert.equal(esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
});

test('⭐ The Watch is watching first, and the old paths still land', async () => {
  // October is the watch — ideas do not arrive in an empty room. The horror map is the worked example
  // of a genre's grammar, and it must be linked before the planning cards.
  const r = await get('/watch');
  assert.equal(r.code, 200);
  const b = r.body();
  assert.match(b, /The Watch/);
  assert.match(b, /October is the watch\. November is the writing\./);
  assert.match(b, /ideas do not arrive in an empty room/);
  assert.match(b, /stream\.soapbox\.community\/horror\/map/);
  assert.match(b, /stream\.soapbox\.community\/horror\/girl-has-to-kill-everyone/);
  assert.ok(b.indexOf('horror/map') < b.indexOf('data-prep'), 'look at the shapes before filling in cards');
  // horror is the example, not a requirement
  assert.match(b, /You do not have to write horror/);
  // the words people actually type in October still resolve, canonicalised to /watch
  for (const alias of ['/october', '/preptober']) {
    const a = await get(alias);
    assert.equal(a.code, 200, alias);
    assert.match(a.body(), /canonical" href="[^"]*\/watch"/, alias);
  }
});

test('⭐ the child-safety failure is condemned, not neutrally reported', async () => {
  // Operator instruction: this must not read as even-handed. The position is stated before the
  // timeline, in our own voice, and it says what we would do differently.
  const b = (await get('/history')).body();
  assert.match(b, /against this without qualification/);
  assert.match(b, /no part of it we are neutral about/);
  assert.match(b, /should outrank every other consideration/);
  // our own answer is stated and is not self-congratulatory
  assert.match(b, /not a safety feature we are taking credit for/);
  assert.match(b, /named person with the authority to remove someone that day/);
  // and it appears ABOVE the timeline, not buried under it
  assert.ok(b.indexOf(esc(POSITION.heading)) < b.indexOf('Chris Baty'), 'the position comes first');
});

test('the word "pedagogy" is never used — this is not only about children', async () => {
  for (const p of ['/', '/watch', '/history']) {
    assert.doesNotMatch((await get(p)).body(), /pedagog/i, p);
  }
});

test('⭐ the October page names other people\'s traditions, not just ours', async () => {
  const b = (await get('/watch')).body();
  for (const w of WATCHING) assert.ok(b.includes(esc(w.name)), `missing: ${w.name}`);
  // ⭐ Credit other people's work; never recommend over our own. An earlier revision led with
  // Hooptober and told readers to "just do it" instead — that is sending our readers away.
  assert.doesNotMatch(b, /better at this than we are/);
  assert.doesNotMatch(b, /you should probably just do it/);
  assert.ok(b.indexOf('Hooptober') > b.indexOf('Shudder'), 'other names are credited, none is the headline');
  // and the word for our own month is The Watch, nobody else's
  assert.match(b, /<h1>The Watch<\/h1>/);
  for (const o of OURS) assert.ok(b.includes(esc(o.name)), `missing ours: ${o.name}`);
  // watching is framed as work, with a reason
  for (const [h] of WHY) assert.ok(b.includes(esc(h)), `missing why: ${h}`);
});

test('⭐ the surface claims the month too, not just the post', async () => {
  const b = (await get('/')).body();
  assert.match(b, /NaNoWriMo is dead and we are taking November/);
  assert.match(b, /never intellectual property/);
  assert.match(b, /rebuilt the thing that killed it/);
});
