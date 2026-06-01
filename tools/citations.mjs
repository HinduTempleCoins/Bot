// citations.mjs — provenance for the annal + brief system. Operator rule (2026-06-01):
// "Everything needs to be cited in a way, so that the other AI can always find the documents and
// things that were used to come to a decision." Citation is the through-line: the hallucination
// check (does the cited thing exist?), the recency rule (which citation is freshest?), and the
// corroboration count (how many sources cite the same thing?) are all provenance.
//
//   import { CITATION_RULE, citationCoverage } from './citations.mjs'
//   node tools/citations.mjs <file.md> [--repo .]   # score one annal/brief's citation coverage

import fs from 'node:fs';
import path from 'node:path';

// Drop into the annal/brief-writer prompts so every claim carries its source.
export const CITATION_RULE = [
  'CITATION RULE: every claim, decision, or recommendation must cite WHERE it came from — the',
  'real file(s), annal(s), brief(s), diagnostic(s), or operator message it is based on. Write the',
  'citation inline as a `path/to/file` or [[annal-name]] reference so another AI (or a person) can',
  'open the exact source and verify the decision. An uncited claim is treated as unverified. Prefer',
  'the NEWEST source when several exist (recency rule); when several sources agree, note the count',
  '(corroboration). No invented files — cite only things that actually exist.',
].join(' ');

// build a set of real, citable references from a repo (relative paths + basenames)
export function citableSet(repo) {
  const set = new Set();
  (function walk(d) {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (['node_modules', '.git', '.local'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { const rel = path.relative(repo, p); set.add(rel); set.add(path.basename(rel)); }
    }
  })(repo);
  return set;
}

// citation coverage: of the claim-bearing lines, how many carry a citation that RESOLVES to a real
// source? Returns { claims, cited, resolved, coveragePct, unresolved:[...] }.
export function citationCoverage(text, citable, { extraRefs = [] } = {}) {
  const known = citable instanceof Set ? citable : new Set(citable);
  for (const r of extraRefs) known.add(r);
  const lines = text.split('\n').filter(l => /^\s*[-*0-9]/.test(l) && l.trim().length > 12); // claim-ish lines
  let cited = 0, resolved = 0; const unresolved = [];
  for (const l of lines) {
    const refs = [...l.matchAll(/`([^`]+)`|\[\[([^\]]+)\]\]|([\w./-]+\.(?:m?js|cjs|ts|py|sh|json|md|hpp))/g)]
      .map(m => (m[1] || m[2] || m[3] || '').trim()).filter(Boolean);
    if (!refs.length) continue;
    cited++;
    const ok = refs.some(r => { const c = r.replace(/^\.?\//, ''); return known.has(c) || known.has(path.basename(c)) || [...known].some(k => k.endsWith(c)); });
    if (ok) resolved++; else unresolved.push({ line: l.trim().slice(0, 80), refs });
  }
  return { claims: lines.length, cited, resolved, coveragePct: lines.length ? Math.round(resolved / lines.length * 100) : 0, unresolved: unresolved.slice(0, 10) };
}

if (process.argv[1] && process.argv[1].endsWith('citations.mjs')) {
  const file = process.argv[2];
  const ri = process.argv.indexOf('--repo');
  const repo = ri >= 0 ? process.argv[ri + 1] : process.cwd();
  if (!file || !fs.existsSync(file)) { console.error('usage: citations.mjs <file.md> [--repo .]'); process.exit(1); }
  const cov = citationCoverage(fs.readFileSync(file, 'utf8'), citableSet(repo));
  console.log(`Citation coverage — ${path.basename(file)}\n${'─'.repeat(56)}`);
  console.log(`  claims: ${cov.claims} | cited: ${cov.cited} | resolved-to-real-source: ${cov.resolved}`);
  console.log(`  COVERAGE: ${cov.coveragePct}% of claims trace to a real document`);
  if (cov.unresolved.length) { console.log('  uncited / unresolved (sample):'); for (const u of cov.unresolved) console.log(`   ✗ ${u.line}  →  ${u.refs.join(', ') || '(no citation)'}`); }
  console.log(`\n${CITATION_RULE}`);
}
