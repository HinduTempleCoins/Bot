// brief-assembler.test.mjs — offline tests (node:test). Inject canned section strings via __setSections
// so NO sibling module / fs / network is touched. Covers: full composition (every injected section
// present), per-section soft-fail isolation (a thrown/missing section is omitted, the brief still
// renders), FOR-RYAN-first + plain-English (no '.mjs'/'src/'/code-speak in that section), forRyanSummary
// is plain, and sectionsAvailable reports which sources resolved.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assembleBrief,
  forRyanSummary,
  sectionsAvailable,
  __setSections,
} from './brief-assembler.mjs';

// canned brief-ready section strings (mirror the real modules' headers + wording so the FOR RYAN
// sniffing has realistic input to translate).
const DIAG = [
  '### Diagnostics — signals → suggested moves → teaching',
  '**Signals** (news lean vs. price action):',
  '- ⚠ **crypto** — divergence: News lean (bullish) DISAGREES with price.',
  '**Teaching notes** (plain-English, for MELEK users):',
  '- **Advisory means advisory.** Nothing here places a trade.',
].join('\n');

const FACT = [
  '### Fact-check warnings (advisory)',
  '*Advisory only — the fact-checker FLAGS, it never edits the KB.*',
  '- ⚠ KB statement in knowledge/a.json may be inaccurate (confidence 0.90)',
].join('\n');

const TOKENS = [
  '### Token movement',
  '*HIVE-Engine price/volume vs. the previous snapshot. Observational.*',
  '- **▲ VKBT +12% on rising volume (+30%)** — notable move',
].join('\n');

const COMMUNITY = [
  '### Community (Discord)',
  '- **Volume:** 42 messages from 9 active members (recent).',
  '- **Mood:** 🙂 positive (+0.4).',
  '- **Talking about:** mining, faucet, rewards.',
].join('\n');

function injectAll() {
  __setSections({
    diagnostics: () => DIAG,
    factcheck: () => FACT,
    tokens: () => TOKENS,
    community: () => COMMUNITY,
  });
}
function reset() { __setSections(null); }

// extract just the "## FOR RYAN" section body (up to the next "## " header).
function forRyanSection(md) {
  const start = md.indexOf('## FOR RYAN');
  assert.ok(start >= 0, 'FOR RYAN header present');
  const after = md.slice(start + '## FOR RYAN'.length);
  const next = after.indexOf('\n## ');
  return next >= 0 ? after.slice(0, next) : after;
}

test('assembleBrief composes a brief including every injected section', async () => {
  injectAll();
  const md = await assembleBrief({ date: '2026-06-03' });
  assert.ok(md.includes('# MELEK Brief — 2026-06-03'));
  // three-part shape present
  assert.ok(md.includes('## FOR RYAN'));
  assert.ok(md.includes('## FOR CLAUDE CODE'));
  // each section's detailed content spliced in
  assert.ok(md.includes('### Diagnostics'));
  assert.ok(md.includes('### Fact-check warnings'));
  assert.ok(md.includes('### Token movement'));
  assert.ok(md.includes('### Community (Discord)'));
  reset();
});

test('FOR RYAN is FIRST (before any detailed section) and contains NO jargon/paths', async () => {
  injectAll();
  const md = await assembleBrief({ date: '2026-06-03' });
  // ordering: FOR RYAN appears before the detailed "###" sections
  assert.ok(md.indexOf('## FOR RYAN') < md.indexOf('### Diagnostics'), 'FOR RYAN precedes details');
  assert.ok(md.indexOf('## FOR RYAN') < md.indexOf('## FOR CLAUDE CODE'), 'FOR RYAN precedes FOR CLAUDE CODE');

  const ryan = forRyanSection(md);
  // no code-speak / file paths / module names in the operator-facing section
  assert.ok(!ryan.includes('.mjs'), 'no .mjs in FOR RYAN');
  assert.ok(!ryan.includes('src/'), 'no src/ in FOR RYAN');
  assert.ok(!/\bengineBlock\b|\bbriefNotes\b|\bwarningsBlock\b/.test(ryan), 'no function names in FOR RYAN');
  assert.ok(!ryan.includes('HIVE-Engine'), 'no backend system names in FOR RYAN');
  assert.ok(!ryan.includes('Discord'), 'no backend system names in FOR RYAN');
  assert.ok(!ryan.includes('###'), 'no markdown section headers leak into FOR RYAN');
  // it IS real plain English (has words, not empty)
  assert.ok(ryan.trim().length > 20, 'FOR RYAN has substantive plain-English content');
  reset();
});

test('soft-fail isolation: a thrown section is omitted, the brief still renders', async () => {
  __setSections({
    diagnostics: () => { throw new Error('boom — diagnostics source down'); },
    factcheck: () => FACT,
    tokens: () => { throw new Error('boom — tokens source down'); },
    community: () => COMMUNITY,
  });
  const md = await assembleBrief({ date: '2026-06-03' });
  // broken sections omitted
  assert.ok(!md.includes('### Diagnostics'), 'thrown diagnostics omitted');
  assert.ok(!md.includes('### Token movement'), 'thrown tokens omitted');
  // surviving sections still present + brief still well-formed
  assert.ok(md.includes('### Fact-check warnings'));
  assert.ok(md.includes('### Community (Discord)'));
  assert.ok(md.includes('## FOR RYAN'));
  assert.ok(md.includes('# MELEK Brief'));
  reset();
});

test('missing section (returns empty) is omitted but brief still renders', async () => {
  __setSections({
    diagnostics: () => DIAG,
    factcheck: () => '',          // empty → omitted
    tokens: () => null,           // missing → omitted
    community: () => COMMUNITY,
  });
  const md = await assembleBrief({ date: '2026-06-03' });
  assert.ok(md.includes('### Diagnostics'));
  assert.ok(md.includes('### Community (Discord)'));
  assert.ok(!md.includes('### Fact-check warnings'), 'empty factcheck omitted');
  assert.ok(!md.includes('### Token movement'), 'null tokens omitted');
  reset();
});

test('all sections empty → clean empty brief, not an error', async () => {
  __setSections({ strategies: () => '', diagnostics: () => '', factcheck: () => '', tokens: () => '', community: () => '' });
  const md = await assembleBrief({ date: '2026-06-03' });
  assert.ok(md.includes('## FOR RYAN'));
  assert.ok(md.includes('Quiet pass'), 'quiet-pass FOR RYAN line');
  assert.ok(md.includes('No detailed sections available'), 'clean empty details');
  reset();
});

test('forRyanSummary is plain English, no jargon', () => {
  const summary = forRyanSummary({ diagnostics: DIAG, tokens: TOKENS, community: COMMUNITY, factcheck: FACT });
  assert.ok(summary.length > 20);
  assert.ok(!summary.includes('.mjs'));
  assert.ok(!summary.includes('src/'));
  assert.ok(!/\bengineBlock\b|\bbriefNotes\b/.test(summary));
  // a divergence diagnostic → the "wait for them to line up" plain phrasing
  assert.ok(/wait for them to line up|mixed/i.test(summary));
  // a notable token move surfaces
  assert.ok(/notable move/i.test(summary));
});

test('strategies section: renders + surfaces a money line in FOR RYAN, stamped suggestion-only', async () => {
  const STRAT = '### Strategies (SUGGESTIONS ONLY)\n\n> Nobody has placed any of these.\n\n### Cross-venue arbitrage\nBest round trip: **SWAP.BTC**. 2 clear the fee stack.';
  __setSections({ strategies: () => STRAT, diagnostics: () => '', factcheck: () => '', tokens: () => '', community: () => '' });
  const brief = await assembleBrief({ date: '2026-06-09' });
  reset();
  assert.match(brief, /SUGGESTIONS ONLY/, 'strategies section rendered');
  assert.match(brief, /money opportunities that clear ALL the fees/i, 'FOR RYAN surfaces the money line');
  assert.match(brief, /suggestions only/i, 'suggestion-only framing present');
});

test('forRyanSummary with nothing → quiet-pass line', () => {
  const summary = forRyanSummary({});
  assert.ok(/quiet pass/i.test(summary));
});

test('sectionsAvailable reports which sources resolved', async () => {
  const avail = await sectionsAvailable({ strategies: '', diagnostics: DIAG, factcheck: '', tokens: TOKENS, community: null });
  assert.deepEqual(avail, { strategies: false, diagnostics: true, factcheck: false, tokens: true, community: false });
});

test('sectionsAvailable resolves the injected sources when called with no arg', async () => {
  __setSections({ strategies: () => '', diagnostics: () => DIAG, factcheck: () => '', tokens: () => '', community: () => COMMUNITY });
  const avail = await sectionsAvailable();
  assert.deepEqual(avail, { strategies: false, diagnostics: true, factcheck: false, tokens: false, community: true });
  reset();
});

test('opts.sections overrides per-call without disturbing module-level injection', async () => {
  __setSections({ diagnostics: () => DIAG, factcheck: () => '', tokens: () => '', community: () => '' });
  // per-call override adds tokens + community
  const md = await assembleBrief({ date: '2026-06-03' }, { sections: { tokens: () => TOKENS, community: () => COMMUNITY } });
  assert.ok(md.includes('### Token movement'));
  assert.ok(md.includes('### Community (Discord)'));
  // module-level injection intact after the call (diagnostics still wired, tokens NOT)
  const md2 = await assembleBrief({ date: '2026-06-03' });
  assert.ok(md2.includes('### Diagnostics'));
  assert.ok(!md2.includes('### Token movement'), 'per-call override did not leak into module state');
  reset();
});

test('invalid date falls back to today (YYYY-MM-DD)', async () => {
  __setSections({ diagnostics: () => DIAG, factcheck: () => '', tokens: () => '', community: () => '' });
  const md = await assembleBrief({ date: 'not-a-date' });
  assert.ok(/# MELEK Brief — \d{4}-\d{2}-\d{2}/.test(md), 'falls back to a valid ISO date');
  reset();
});
