// md-audit.test.mjs — offline, fixture-driven. Asserts classification heuristics, that
// load-bearing/ITINERARY are protected, that archive candidates are SUPERSEDED-only, and
// (HARD) that the module performs NO fs move/rename — it only proposes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDoc,
  auditRoot,
  renderVerdict,
  proposeArchivePlan,
  loadRootDocs,
  __setFs,
  LOAD_BEARING,
  APPEND_ONLY,
} from './md-audit.mjs';

const FIXTURES = [
  { path: '/repo/CLAUDE.md', content: '# CLAUDE.md\nstatus: complete\nall done here.' }, // load-bearing despite "done"
  { path: '/repo/ITINERARY.md', content: '# Itinerary\n- [ ] open item\nstatus: done' },     // append-only
  { path: '/repo/MASTER_ITINERARY.md', content: 'phase 13 ...' },
  { path: '/repo/BRIEF.md', content: 'founding brief' },
  { path: '/repo/OLD_PLAN.md', content: '# Old Plan\n> SUPERSEDED by BRIEF.md\nthe six-surface plan.' },
  { path: '/repo/SIX_SURFACE.md', content: 'This document is deprecated. Replaced by the phased build.' },
  { path: '/repo/SCRATCH.md', content: '# Scratch\nstatus: done\nshipped the thing.' },
  { path: '/repo/WIP.md', content: '# WIP\n- [ ] todo: finish this' },
  { path: '/repo/IDEA.md', content: '# Idea\nThis is not yet built. Placeholder only.' },
  { path: '/repo/NEUTRAL.md', content: '# Neutral notes\nsome prose with no markers at all.' },
];

test('classifyDoc: SUPERSEDED header → SUPERSEDED', () => {
  const r = classifyDoc({ path: '/repo/OLD_PLAN.md', content: '> SUPERSEDED by BRIEF.md' });
  assert.equal(r.class, 'SUPERSEDED');
  assert.match(r.reason, /superseded|deprecated|replaced/i);
});

test('classifyDoc: deprecated/replaced phrasing → SUPERSEDED', () => {
  assert.equal(classifyDoc({ path: '/repo/x.md', content: 'This is deprecated.' }).class, 'SUPERSEDED');
  assert.equal(classifyDoc({ path: '/repo/y.md', content: 'Replaced by the new doc.' }).class, 'SUPERSEDED');
});

test('classifyDoc: load-bearing name → KEEP even when content looks done', () => {
  const r = classifyDoc({ path: '/repo/CLAUDE.md', content: 'status: complete\nall done.' });
  assert.equal(r.class, 'KEEP');
  assert.match(r.reason, /load-bearing/i);
});

test('classifyDoc: every load-bearing name classifies KEEP', () => {
  for (const name of LOAD_BEARING) {
    // even with a SUPERSEDED marker, the name wins
    const r = classifyDoc({ path: `/repo/${name}`, content: 'SUPERSEDED deprecated done todo' });
    assert.equal(r.class, 'KEEP', `${name} should be KEEP`);
  }
});

test('classifyDoc: ITINERARY/MASTER_ITINERARY → KEEP (append-only)', () => {
  for (const name of APPEND_ONLY) {
    const r = classifyDoc({ path: `/repo/${name}`, content: 'status: done\nSUPERSEDED' });
    assert.equal(r.class, 'KEEP');
    assert.match(r.reason, /append-only/i);
  }
});

test('classifyDoc: status: done → DONE; not-built → NOT-BUILT; todo → TODO; neutral → KEEP', () => {
  assert.equal(classifyDoc({ path: '/repo/SCRATCH.md', content: 'status: done' }).class, 'DONE');
  assert.equal(classifyDoc({ path: '/repo/IDEA.md', content: 'not yet built. placeholder only.' }).class, 'NOT-BUILT');
  assert.equal(classifyDoc({ path: '/repo/WIP.md', content: '- [ ] todo' }).class, 'TODO');
  assert.equal(classifyDoc({ path: '/repo/NEUTRAL.md', content: 'plain prose' }).class, 'KEEP');
});

test('auditRoot: SUPERSEDED docs become archiveCandidates; load-bearing/ITINERARY → neverTouch', () => {
  const plan = auditRoot({ files: FIXTURES });

  const candNames = plan.archiveCandidates.map((c) => c.path.split('/').pop());
  assert.ok(candNames.includes('OLD_PLAN.md'), 'OLD_PLAN.md (superseded) should be a candidate');
  assert.ok(candNames.includes('SIX_SURFACE.md'), 'SIX_SURFACE.md (deprecated) should be a candidate');
  // every candidate is SUPERSEDED only
  for (const c of plan.archiveCandidates) assert.equal(c.class, 'SUPERSEDED');

  const neverNames = plan.neverTouch.map((c) => c.path.split('/').pop());
  assert.ok(neverNames.includes('ITINERARY.md'), 'ITINERARY must be neverTouch');
  assert.ok(neverNames.includes('MASTER_ITINERARY.md'), 'MASTER_ITINERARY must be neverTouch');
  assert.ok(neverNames.includes('CLAUDE.md'), 'CLAUDE.md must be neverTouch');
  assert.ok(neverNames.includes('BRIEF.md'), 'BRIEF.md must be neverTouch');

  // ITINERARY / load-bearing must NOT appear as archive candidates
  assert.ok(!candNames.includes('ITINERARY.md'));
  assert.ok(!candNames.includes('CLAUDE.md'));
});

test('auditRoot: DONE/TODO/NOT-BUILT non-load-bearing land in keep (not archived)', () => {
  const plan = auditRoot({ files: FIXTURES });
  const keepNames = plan.keep.map((c) => c.path.split('/').pop());
  assert.ok(keepNames.includes('SCRATCH.md'));   // DONE but not archived (conservative)
  assert.ok(keepNames.includes('WIP.md'));        // TODO
  assert.ok(keepNames.includes('IDEA.md'));       // NOT-BUILT
});

test('renderVerdict: operator-facing markdown, proposal-only framing', () => {
  const plan = auditRoot({ files: FIXTURES });
  const md = renderVerdict(plan);
  assert.match(md, /^# Root \.md audit/m);
  assert.match(md, /PROPOSAL ONLY/);
  assert.match(md, /Nothing has been moved or deleted/);
  assert.match(md, /OLD_PLAN\.md/);
  assert.match(md, /Never touch/);
  assert.match(md, /ITINERARY\.md/);
});

test('proposeArchivePlan: emits git mv TEXT for candidates only', () => {
  const plan = auditRoot({ files: FIXTURES });
  const text = proposeArchivePlan(plan);
  assert.match(text, /TEXT ONLY/);
  assert.match(text, /git mv OLD_PLAN\.md archive\/OLD_PLAN\.md/);
  assert.match(text, /git mv SIX_SURFACE\.md archive\/SIX_SURFACE\.md/);
  // never proposes moving protected docs
  assert.doesNotMatch(text, /git mv (CLAUDE|BRIEF|ITINERARY|MASTER_ITINERARY)\.md/);
});

test('proposeArchivePlan: no candidates → no commands', () => {
  const plan = auditRoot({ files: [{ path: '/repo/NEUTRAL.md', content: 'prose' }] });
  const text = proposeArchivePlan(plan);
  assert.match(text, /no archive candidates/i);
  assert.doesNotMatch(text, /git mv/);
});

test('HARD: module performs NO fs move/rename/write — only reads via injected fs', () => {
  const calls = [];
  const guard = (name) => () => { calls.push(name); throw new Error(`fs.${name} must never be called`); };
  __setFs({
    list: (dir) => { calls.push('list'); return ['OLD_PLAN.md', 'CLAUDE.md', 'ITINERARY.md']; },
    read: (path) => {
      calls.push('read');
      if (path.endsWith('OLD_PLAN.md')) return '> SUPERSEDED by BRIEF.md';
      return 'content';
    },
    // any mutation hook, were it ever invoked, would throw:
    rename: guard('rename'),
    move: guard('move'),
    write: guard('write'),
    writeFileSync: guard('writeFileSync'),
    rmSync: guard('rmSync'),
    unlink: guard('unlink'),
  });

  const files = loadRootDocs('/repo');
  const plan = auditRoot({ files });
  renderVerdict(plan);
  proposeArchivePlan(plan);

  // only read-side calls happened
  assert.ok(calls.includes('list'));
  assert.ok(calls.includes('read'));
  assert.ok(!calls.includes('rename'), 'no rename');
  assert.ok(!calls.includes('move'), 'no move');
  assert.ok(!calls.includes('write'), 'no write');
  assert.ok(!calls.includes('writeFileSync'), 'no writeFileSync');
  assert.ok(!calls.includes('rmSync'), 'no delete');
  assert.ok(!calls.includes('unlink'), 'no unlink');

  __setFs({ list: () => [], read: () => '' }); // reset
});

test('loadRootDocs: soft-fails per file on read error', () => {
  __setFs({
    list: () => ['A.md', 'B.md'],
    read: (p) => { if (p.endsWith('B.md')) throw new Error('boom'); return 'ok'; },
  });
  const files = loadRootDocs('/repo');
  assert.equal(files.length, 2);
  assert.equal(files.find((f) => f.path.endsWith('B.md')).content, ''); // soft-failed to empty
  __setFs({ list: () => [], read: () => '' });
});
