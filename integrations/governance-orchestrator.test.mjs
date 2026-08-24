// governance-orchestrator.test.mjs — offline `node --test`. Injected fake stage outputs; no network,
// no node_modules, no real fs. Asserts (a) the stage chain runs end-to-end, (b) each stage soft-fails in
// isolation, and (c) the itinerary write-back is APPEND-ONLY (never mutates a pre-existing byte).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runGovernanceLoop,
  buildAsks,
  buildItineraryDelta,
  appendItineraryDelta,
  handler,
} from './governance-orchestrator.mjs';

// ── fake stage modules (match the real signatures) ────────────────────────────────────────────────────
function fakeModules(calls = {}) {
  return {
    conversationParser: {
      parseConversation(input, deps) {
        calls.parse = (calls.parse || 0) + 1;
        calls.parseNow = deps && typeof deps.now === 'function' ? deps.now() : null;
        return {
          id: 'conv-1',
          source: input.source || 'chat',
          participants: ['operator', 'hathor'],
          decisions: [{ text: 'We will go with append-only.', from: 'operator', ts: null }],
          actionItems: [{ text: 'Wire the runner', from: 'hathor', ts: null }],
          corrections: [{ text: "Don't rewrite the itinerary", from: 'operator', ts: null }],
          openQuestions: [{ text: 'Run it hourly?', from: 'hathor', ts: null }],
        };
      },
    },
    momSynth: {
      async summarizeAsks(asks, opts) {
        calls.momSynth = (calls.momSynth || 0) + 1;
        calls.momSynthComplete = opts ? opts.complete : 'missing';
        calls.momSynthAsks = asks.length;
        return `# FAKE MINUTES\n\n- ${asks.map((a) => a.text).join('\n- ')}`;
      },
    },
    momLayer: {
      summarizeToMinutes(input, deps) {
        calls.momLayer = (calls.momLayer || 0) + 1;
        calls.momLayerNow = deps && typeof deps.now === 'function' ? deps.now() : null;
        return {
          id: 'mom:fake:1',
          at: '1970-01-01T00:00:00.000Z',
          conferenceId: input.conferenceId,
          decisions: input.decisions,
          actionItems: input.actionItems,
          openQuestions: [],
          topics: [],
        };
      },
      createMinutesStore() {
        const records = [];
        return { append(r) { records.push(r); return r; }, list() { return records.slice(); }, get size() { return records.length; } };
      },
      appendMinutes(mom, { store }) { calls.appendMinutes = (calls.appendMinutes || 0) + 1; store.append(mom); return { ok: true }; },
      forBriefWriter(mom) { calls.forBriefWriter = (calls.forBriefWriter || 0) + 1; return { id: mom.id, decisions: mom.decisions, actionItems: mom.actionItems, openQuestions: [] }; },
    },
    briefAssembler: {
      async assembleBrief({ date }) {
        calls.brief = (calls.brief || 0) + 1;
        return `# MELEK Brief — ${date}\n\n## FOR RYAN\n\nFake brief.`;
      },
    },
    annalHarvester: {
      async harvest(opts) {
        calls.harvest = (calls.harvest || 0) + 1;
        calls.harvestOpenItems = (opts.openItems || []).length;
        return { asOf: '1970-01-01T00:00:00.000Z', sources: ['_synthesis.md'], todos: ['Do the harvested thing'], raw: '- Do the harvested thing' };
      },
    },
  };
}

const sampleInput = {
  conferenceId: 'governance/test',
  conversations: [{ source: 'telegram', messages: [{ from: 'operator', text: 'hi', ts: null }] }],
  openItems: ['already open item'],
};

// ── (a) the chain runs end-to-end ─────────────────────────────────────────────────────────────────────
test('runs every stage in order and threads the outputs through', async () => {
  const calls = {};
  const result = await runGovernanceLoop(sampleInput, {
    modules: fakeModules(calls),
    now: () => Date.parse('2026-08-24T00:00:00Z'),
  });

  // every stage was invoked
  assert.equal(calls.parse, 1, 'conversation-parser called');
  assert.equal(calls.momSynth, 1, 'mom-synth called');
  assert.equal(calls.momLayer, 1, 'mom-layer called');
  assert.equal(calls.appendMinutes, 1, 'minutes appended to store');
  assert.equal(calls.forBriefWriter, 1, 'brief-writer view produced');
  assert.equal(calls.brief, 1, 'brief-assembler called');
  assert.equal(calls.harvest, 1, 'annal-harvester called');

  // mom-synth was handed the deterministic floor (complete:null), never the model
  assert.equal(calls.momSynthComplete, null, 'mom-synth forced to deterministic floor');
  assert.ok(calls.momSynthAsks >= 4, 'asks flattened from decisions/actions/corrections/questions');

  // open items flowed into the harvester
  assert.equal(calls.harvestOpenItems, 1, 'openItems threaded into harvest');

  // all stages ok
  assert.equal(result.ok, true);
  for (const [name, s] of Object.entries(result.stages)) assert.equal(s.ok, true, `${name} ok`);

  // outputs are present and shaped
  assert.match(result.mom.minutesMarkdown, /FAKE MINUTES/);
  assert.equal(result.mom.record.id, 'mom:fake:1');
  assert.ok(result.mom.briefWriterView, 'brief-writer view carried');
  assert.match(result.brief.markdown, /MELEK Brief — 2026-08-24/);
  assert.deepEqual(result.harvest.todos, ['Do the harvested thing']);

  // the write-back is a PROPOSAL by default (nothing written; no paths given)
  assert.equal(result.writeback.gated, false);
  assert.ok(result.writeback.delta.includes('GOVERNANCE DELTA'));
  assert.match(result.summary, /PROPOSED \(not written\)/);

  // one clock instant flows to both parser (ISO) and mom-layer (ms)
  assert.equal(calls.parseNow, '2026-08-24T00:00:00.000Z');
  assert.equal(calls.momLayerNow, Date.parse('2026-08-24T00:00:00Z'));
});

// ── (b) soft-fail per stage ───────────────────────────────────────────────────────────────────────────
test('a throwing stage is isolated — the chain still completes', async () => {
  const mods = fakeModules({});
  mods.momSynth = { async summarizeAsks() { throw new Error('boom'); } }; // stage 2 explodes

  const result = await runGovernanceLoop(sampleInput, {
    modules: mods,
    now: () => Date.parse('2026-08-24T00:00:00Z'),
  });

  assert.equal(result.ok, false, 'overall not-ok when a stage soft-failed');
  assert.equal(result.stages.momSynth.ok, false);
  assert.match(result.stages.momSynth.error, /boom/);
  // downstream stages still ran
  assert.equal(result.stages.momLayer.ok, true);
  assert.equal(result.stages.brief.ok, true);
  assert.equal(result.stages.harvest.ok, true);
  assert.equal(result.stages.writeback.ok, true);
  assert.equal(result.mom.minutesMarkdown, '', 'failed stage yields empty, not a throw');
  assert.ok(result.writeback.delta.includes('GOVERNANCE DELTA'), 'delta still built');
});

test('a completely absent module set does not throw', async () => {
  const result = await runGovernanceLoop(sampleInput, { modules: {
    conversationParser: null, momSynth: null, momLayer: null, briefAssembler: null, annalHarvester: null,
  } });
  assert.equal(result.ok, false);
  assert.equal(result.stages.parse.ok, false);
  // the loop still returns a valid, fully-shaped object
  assert.ok(result.writeback && Array.isArray(result.writeback.results));
  assert.ok(typeof result.summary === 'string');
});

// ── (c) the write-back is APPEND-ONLY ─────────────────────────────────────────────────────────────────
// An in-memory fake fs — no real disk, fully offline.
function memFs(seed = {}) {
  const files = { ...seed };
  return {
    files,
    readFileSync(p) { if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files[p]; },
    writeFileSync(p, data) { files[p] = String(data); },
  };
}

const ORIGINAL = '# Itinerary\n\n## Old section 2026-01-01\n\n- [x] a real historical line\n- [ ] a standing open item\n';

test('write-back never mutates existing lines — original is a verbatim prefix', () => {
  const fs = memFs({ '/x/ITINERARY.md': ORIGINAL });
  const delta = buildItineraryDelta({ date: '2026-08-24', decisions: ['D1'], actionItems: [{ text: 'A1', owner: 'hathor' }], harvestedTodos: ['T1'] });

  const res = appendItineraryDelta({ paths: ['/x/ITINERARY.md'], delta, gated: true, fs });

  const after = fs.files['/x/ITINERARY.md'];
  assert.ok(after.startsWith(ORIGINAL), 'existing content is preserved verbatim as a prefix');
  assert.ok(after.length > ORIGINAL.length, 'content was appended');
  assert.ok(after.includes('GOVERNANCE DELTA'), 'the delta was appended');
  // not one pre-existing line was altered or removed
  for (const line of ORIGINAL.split('\n')) assert.ok(after.includes(line), `original line kept: ${line}`);
  assert.equal(res.results[0].wrote, true);
  assert.equal(res.results[0].appendOnly, true);
});

test('propose-only (gated:false) writes NOTHING but reports the would-be append', () => {
  const fs = memFs({ '/x/ITINERARY.md': ORIGINAL });
  const delta = buildItineraryDelta({ date: '2026-08-24', decisions: ['D1'] });

  const res = appendItineraryDelta({ paths: ['/x/ITINERARY.md'], delta, gated: false, fs });

  assert.equal(fs.files['/x/ITINERARY.md'], ORIGINAL, 'file untouched when not gated');
  assert.equal(res.gated, false);
  assert.equal(res.results[0].wrote, false);
  assert.equal(res.results[0].appendOnly, true);
  assert.ok(res.results[0].appended > 0, 'reports how many bytes it WOULD append');
});

test('the runner only writes when writeback:true AND paths are given', async () => {
  const fs = memFs({ '/x/MASTER_ITINERARY.md': ORIGINAL });
  const result = await runGovernanceLoop(sampleInput, {
    modules: fakeModules({}),
    now: () => Date.parse('2026-08-24T00:00:00Z'),
    writeback: true,
    itineraryPaths: ['/x/MASTER_ITINERARY.md'],
    fs,
  });
  const after = fs.files['/x/MASTER_ITINERARY.md'];
  assert.ok(after.startsWith(ORIGINAL), 'append-only through the runner too');
  assert.ok(after.includes('GOVERNANCE DELTA'));
  assert.equal(result.writeback.gated, true);
  assert.equal(result.writeback.results[0].wrote, true);
  assert.match(result.summary, /1 file\(s\) appended/);
});

test('write-back soft-fails per path on an unreadable file', () => {
  const fs = memFs({}); // no files
  const res = appendItineraryDelta({ paths: ['/nope/ITINERARY.md'], delta: 'x', gated: true, fs });
  assert.equal(res.results[0].wrote, false);
  assert.match(res.results[0].error, /unreadable/);
});

// ── buildAsks unit ────────────────────────────────────────────────────────────────────────────────────
test('buildAsks flattens all four categories and tags corrections', () => {
  const asks = buildAsks([{
    decisions: [{ text: 'go with X' }],
    actionItems: [{ text: 'do Y', from: 'hathor' }],
    corrections: [{ text: 'not like that', from: 'operator' }],
    openQuestions: [{ text: 'when?' }],
  }]);
  assert.equal(asks.length, 4);
  assert.ok(asks.some((a) => a.kind === 'decision' && a.text === 'go with X'));
  assert.ok(asks.some((a) => a.kind === 'action' && a.owner === 'hathor'));
  assert.ok(asks.some((a) => a.text.startsWith('Correction:')), 'corrections kept as their own tagged category');
});

// ── handler ───────────────────────────────────────────────────────────────────────────────────────────
test('handler returns injected result as JSON without running the chain', async () => {
  let code, body, headers;
  const res = {
    writeHead(c, h) { code = c; headers = h; },
    end(b) { body = b; },
  };
  const injected = { ok: true, summary: 'injected', stages: { parse: { ok: true } } };
  await handler({ headers: {} }, res, injected);
  assert.equal(code, 200);
  assert.match(headers['Content-Type'], /application\/json/);
  assert.deepEqual(JSON.parse(body), injected);
});

test('handler renders an HTML status view when asked', async () => {
  let body, headers;
  const res = { writeHead(c, h) { headers = h; }, end(b) { body = b; } };
  await handler({ headers: { accept: 'text/html' } }, res, { ok: true, summary: 'hi', stages: { parse: { ok: true }, momSynth: { ok: false, error: 'x' } } });
  assert.match(headers['Content-Type'], /text\/html/);
  assert.match(body, /Governance loop/);
  assert.match(body, /soft-fail/);
});
