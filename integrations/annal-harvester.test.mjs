import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickSources, buildPrompt, parseTodos, dedupe, harvest, toMarkdown } from './annal-harvester.mjs';

// in-memory fs stub
function mkFs(files) {
  const now = Date.now();
  const meta = Object.fromEntries(Object.keys(files).map((p, i) => [p, now - i * 1000]));
  return {
    readdirSync: (d) => Object.keys(files).filter((p) => p.startsWith(d + '/')).map((p) => p.slice(d.length + 1)),
    readFileSync: (p) => { if (files[p] == null) throw new Error('ENOENT'); return files[p]; },
    statSync: (p) => ({ mtimeMs: meta[p] || 0 }),
  };
}

const ANN = '/ann';
const BR = '/br';
const files = {
  '/ann/_connections.2026-06-20.codestral.md': '# Map\nSignup feeds commands. Hathor uses src/chain.',
  '/ann/_conference-audit.md': '## Action Items\n- Decide the rotation tweaks never chosen\n- Verify groq rejoined',
  '/ann/_diagnostics.trivy.md': 'two CVEs still unpatched in deps',
  '/ann/raw-transcript-9999.md': 'this is a raw transcript, NOT signal',
  '/br/brief-2026-06-20T04.md': '## FOR RYAN\nblah\n## FOR CLAUDE CODE\n- finish the welcomer\n## DRAFTED CODE\nx',
};

test('pickSources selects signal annals + brief FOR-CLAUDE, skips raw transcripts', () => {
  const s = pickSources({ annalsDir: ANN, briefsDir: BR, fsmod: mkFs(files) });
  const names = s.map((x) => x.name);
  assert.ok(names.includes('_connections.2026-06-20.codestral.md'));
  assert.ok(names.includes('_conference-audit.md'));
  assert.ok(!names.some((n) => n.startsWith('raw-transcript')));
  // brief source carries only the FOR CLAUDE text
  const brief = s.find((x) => x.name.startsWith('brief-'));
  assert.ok(brief && /finish the welcomer/.test(brief.text) && !/FOR RYAN/.test(brief.text));
});

test('buildPrompt embeds sources + known-open and asks for actions only', () => {
  const p = buildPrompt([{ name: 'a', text: 'foo' }], ['already doing X']);
  assert.match(p, /CONCRETE, SPECIFIC next actions/);
  assert.match(p, /already doing X/);
  assert.match(p, /do not repeat/i);
});

test('parseTodos strips bullets and junk', () => {
  const t = parseTodos('- Fix the welcomer crash\n* Verify groq rejoined\n# heading\n- ok');
  assert.ok(t.includes('Fix the welcomer crash'));
  assert.ok(t.includes('Verify groq rejoined'));
  assert.ok(!t.some((x) => x.startsWith('#')));
});

test('dedupe drops items overlapping known-open and self-dups', () => {
  const out = dedupe(
    ['Finish the welcomer onboarding flow', 'Patch the two trivy CVEs in deps', 'Patch the two Trivy CVEs in dependencies'],
    ['finish the welcomer'],
  );
  assert.ok(!out.some((x) => /welcomer/i.test(x)), 'welcomer echo dropped');
  assert.equal(out.filter((x) => /trivy/i.test(x)).length, 1, 'self-dup collapsed');
});

test('harvest runs end-to-end with injected ensemble', async () => {
  const complete = async () => '- Patch the two trivy CVEs\n- Decide the rotation tweaks never chosen\n- finish the welcomer';
  const r = await harvest({ annalsDir: ANN, briefsDir: BR, fsmod: mkFs(files), openItems: ['finish the welcomer'], complete });
  assert.ok(r.todos.length >= 2);
  assert.ok(!r.todos.some((t) => /welcomer/i.test(t)), 'known-open filtered');
  assert.ok(r.sources.length >= 3);
});

test('harvest soft-fails to empty when no ensemble', async () => {
  const r = await harvest({ annalsDir: ANN, briefsDir: BR, fsmod: mkFs(files) });
  assert.deepEqual(r.todos, []);
});

test('harvest soft-fails when ensemble throws', async () => {
  const complete = async () => { throw new Error('all providers down'); };
  const r = await harvest({ annalsDir: ANN, briefsDir: BR, fsmod: mkFs(files), complete });
  assert.deepEqual(r.todos, []);
});

test('toMarkdown renders a checklist', () => {
  const md = toMarkdown({ asOf: 'NOW', sources: ['a.md'], todos: ['do thing'], raw: '' });
  assert.match(md, /Harvested next-actions/);
  assert.match(md, /- \[ \] do thing/);
  assert.match(md, /sources: a\.md/);
});

test('toMarkdown handles an empty harvest', () => {
  const md = toMarkdown({ asOf: 'NOW', sources: [], todos: [], raw: '' });
  assert.match(md, /nothing new surfaced/);
});

// ---------------------------------------------------------------------------
// The "[object Object]" regression, at this end of the pipe.
// See llm-router.test.js for the root cause; these are the two defences here.
// ---------------------------------------------------------------------------
test('parseTodos rejects stringified-object garbage as a to-do item', () => {
  const out = parseTodos('[object Object]\nundefined\nnull\n- a genuinely actionable line here');
  assert.deepEqual(out, ['a genuinely actionable line here']);
  assert.ok(!out.some((t) => t.includes('[object')), 'garbage must never become a to-do');
});

test('a failing ensemble is REPORTED, not rendered as an empty queue', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harv-'));
  try {
    fs.mkdirSync(`${dir}/annals`); fs.mkdirSync(`${dir}/briefs`);
    fs.writeFileSync(`${dir}/annals/_connections.x.md`, '# c\n- the brain noticed a thing\n');
    const down = async () => ({ text: '', error: 'all providers failed or no keys present', attempts: [] });
    const r = await harvest({ annalsDir: `${dir}/annals`, briefsDir: `${dir}/briefs`, complete: down });
    assert.deepEqual(r.todos, [], 'no fabricated items');
    assert.match(r.llmError, /all providers failed/);
    const md = toMarkdown(r);
    assert.match(md, /LLM ensemble was unreachable/);
    assert.ok(!md.includes('[object'), 'never emits a stringified object');
    // the critical distinction: "we could not look" must not read as "there is nothing to do"
    assert.ok(!md.includes('nothing new surfaced this run'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a working ensemble still produces normal to-do items', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harv-'));
  try {
    fs.mkdirSync(`${dir}/annals`); fs.mkdirSync(`${dir}/briefs`);
    fs.writeFileSync(`${dir}/annals/_connections.x.md`, '# c\n- noticed\n');
    const up = async () => ({ text: '- deploy the store vertical\n- rotate the burned PATs', provider: 'groq' });
    const r = await harvest({ annalsDir: `${dir}/annals`, briefsDir: `${dir}/briefs`, complete: up });
    assert.deepEqual(r.todos, ['deploy the store vertical', 'rotate the burned PATs']);
    assert.equal(r.llmError, '');
    assert.match(toMarkdown(r), /- \[ \] deploy the store vertical/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
