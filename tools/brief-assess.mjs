// brief-assess.mjs — the AUTO-ASSESSOR that completes the existing Server-4 brief-records system.
// brief-records.mjs already has the schema (pct_completed/undone/ignored/nonsense + hallucination
// tier + Done folder + ✓/✗) but its `assess` takes the numbers as MANUAL CLI args — its own header
// says "% values need ... instrumented to be real." This fills that gap: it READS a brief, checks
// every action item's references against real repo state, and COMPUTES the categories + tier, marks
// the brief up with ✓/✗/✎, and emits a record in the same schema so brief-records can promote it.
//
//   node tools/brief-assess.mjs <briefs-dir> [--repo .] [--out .local/brief-assess]
//
// Methodology (operator 2026-06-01 — percentile buckets, not done/not-done; flag hallucination):
//   per FOR-CLAUDE item -> classify:
//     ✓ completed  : references a real file AND git shows a commit touching it after the brief date
//     ○ undone     : references a real file/service that exists, but no completion evidence
//     ✗ nonsense   : references a file/path/service that does NOT exist (likely hallucinated)
//     ✎ vague      : no concrete reference to check (can't verify — needs a human or rewrite)
//   hallucination_tier: none | mistaken-structure-corrected | absolute-hallucination
//   bucket (percentile of grounded items): draft <40 | needs-work 40-70 | review-ready 70-90 | finished >=90

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const dir = process.argv[2];
const repo = (argval('--repo') || process.cwd());
const out = (argval('--out') || '.local/brief-assess');
function argval(f) { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; }
if (!dir || !fs.existsSync(dir)) { console.error('usage: brief-assess.mjs <briefs-dir>'); process.exit(1); }

// real repo file set (relative paths) + known live services for reference checking
const repoFiles = new Set();
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  if (['node_modules', '.git', '.local'].includes(e.name)) continue;
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else repoFiles.add(path.relative(repo, p));
} })(repo);
const KNOWN_SERVICES = new Set(['melek-telegram', 'melek-discord', 'melek-cheetah', 'melek-ai-network',
  'melek-conference', 'melek-tradefeed', 'melek-continue', 'melek-reconcile', 'melek-diagnostics',
  'melek-memindex', 'melek-guest-proxy', 'melek-watchdog', 'melek-botcheck', 'brief-records', 'brief-builder']);

// extract candidate references from an item line
function refsOf(line) {
  const files = [...line.matchAll(/`([^`]+)`|([\w./-]+\.(?:m?js|cjs|ts|py|sh|json|md|hpp))/g)]
    .map(m => (m[1] || m[2] || '').trim()).filter(Boolean);
  const services = [...line.matchAll(/\b(melek-[a-z-]+|brief-[a-z]+)\b/g)].map(m => m[1]);
  return { files: [...new Set(files)], services: [...new Set(services)] };
}
function fileExists(ref) {
  const r = ref.replace(/^`|`$/g, '').replace(/^\.?\//, '');
  if (repoFiles.has(r)) return true;
  for (const f of repoFiles) if (f === r || f.endsWith('/' + r) || f.endsWith(r)) return true;
  return false;
}
// git: was a real referenced file touched after the brief's date? (completion evidence)
function touchedAfter(file, sinceISO) {
  if (!sinceISO) return false;
  try { const r = execSync(`git -C "${repo}" log --since="${sinceISO}" --oneline -- "${file}" 2>/dev/null`, { encoding: 'utf8' }); return r.trim().length > 0; }
  catch { return false; }
}

function assess(file) {
  const body = fs.readFileSync(path.join(dir, file), 'utf8');
  const date = (body.match(/Brief\s+—\s+([0-9T:\-.Z]+)/) || body.match(/(\d{4}-\d{2}-\d{2}T[0-9:.\-Z]+)/) || [])[1] || '';
  // FOR CLAUDE section if present, else all bullet items
  const claudeSec = (body.split(/##\s*FOR\s+CLAUDE/i)[1] || body).split(/\n##\s/)[0];
  const items = (claudeSec.match(/^\s*[-*]\s+.+$/gm) || []).map(s => s.trim());
  let completed = 0, undone = 0, nonsense = 0, vague = 0, badRefs = 0, totalRefs = 0;
  const marked = [];
  for (const it of items) {
    const { files, services } = refsOf(it);
    const refs = [...files, ...services];
    let mark = '✎', why = 'no concrete reference to verify';
    if (!refs.length) { vague++; }
    else {
      totalRefs += refs.length;
      const realFiles = files.filter(fileExists);
      const realSvcs = services.filter(s => KNOWN_SERVICES.has(s));
      const bad = (files.length - realFiles.length) + (services.length - realSvcs.length);
      badRefs += bad;
      if (realFiles.length + realSvcs.length === 0) { nonsense++; mark = '✗'; why = `references not found: ${refs.join(', ')}`; }
      else if (realFiles.some(f => touchedAfter(f, date))) { completed++; mark = '✓'; why = `real ref + git activity after ${String(date).slice(0,10)}`; }
      else { undone++; mark = '○'; why = `real ref (${[...realFiles, ...realSvcs].join(', ')}), no completion evidence`; }
    }
    marked.push(`${mark} ${it.replace(/^[-*]\s*/, '')}\n    └ ${why}`);
  }
  const n = items.length || 1;
  const pct = (x) => Math.round(x / n * 100);
  const groundedPct = pct(completed + undone); // items tied to real, checkable things
  const hallRate = totalRefs ? badRefs / totalRefs : 0;
  const tier = hallRate === 0 ? 'none' : hallRate < 0.34 ? 'mistaken-structure-corrected' : 'absolute-hallucination';
  const bucket = groundedPct >= 90 && tier !== 'absolute-hallucination' ? 'finished'
    : groundedPct >= 70 ? 'review-ready' : groundedPct >= 40 ? 'needs-work' : 'draft';
  return {
    brief: file, items: items.length, date,
    pct_completed: pct(completed), pct_undone: pct(undone), pct_ignored: pct(vague), pct_nonsense: pct(nonsense),
    grounded_pct: groundedPct, hallucination_tier: tier, bucket,
    needs_operator: undone > 0 || vague > 0, marked,
  };
}

const briefs = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(`${out}/finished`, { recursive: true });
const summary = { total: briefs.length, buckets: {}, tiers: {}, assessed: [] };
for (const b of briefs) {
  let a; try { a = assess(b); } catch (e) { continue; }
  summary.buckets[a.bucket] = (summary.buckets[a.bucket] || 0) + 1;
  summary.tiers[a.hallucination_tier] = (summary.tiers[a.hallucination_tier] || 0) + 1;
  summary.assessed.push({ brief: a.brief, bucket: a.bucket, grounded_pct: a.grounded_pct, tier: a.hallucination_tier, items: a.items, needs_operator: a.needs_operator });
  const md = `# Assessment — ${a.brief}\n\n- bucket: **${a.bucket}** | grounded ${a.grounded_pct}% | hallucination: ${a.hallucination_tier}\n- completed ${a.pct_completed}% · undone ${a.pct_undone}% · vague/ignored ${a.pct_ignored}% · nonsense ${a.pct_nonsense}%\n- needs operator: ${a.needs_operator}\n\n## Items (✓ done · ○ undone · ✗ nonsense/hallucinated · ✎ too vague)\n${a.marked.join('\n')}\n`;
  fs.writeFileSync(`${out}/${a.bucket === 'finished' ? 'finished/' : ''}${a.brief}`, md);
}
fs.writeFileSync(`${out}/_summary.json`, JSON.stringify(summary, null, 2));
console.log(`Assessed ${briefs.length} briefs → ${out}`);
console.log('buckets:', JSON.stringify(summary.buckets));
console.log('hallucination tiers:', JSON.stringify(summary.tiers));
console.log(`finished folder: ${summary.buckets.finished || 0} brief(s)`);
