// audit-repo-vs-live.mjs — what is BUILT versus what a visitor can actually reach.
//
// The repo has ~107 site servers and ~680 shared modules. The question that matters is not how much
// exists, it is how much is REACHABLE — and the gap between those two numbers is the backlog.
//
// Three findings this produces:
//   1. site servers with no live hostname          → built, undeployed
//   2. modules imported by NO site server          → built, unreachable by any visitor
//   3. modules imported only by an undeployed site → reachable only once that site ships
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIVE = new Set(process.argv.slice(2));

const siteDirs = readdirSync('site', { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join('site', d.name, 'server.mjs')))
  .map((d) => d.name);

// Which local modules does each site pull in, transitively?
const IMPORT = /from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const resolve = (from, spec) => {
  const base = join(from, '..', spec);
  for (const c of [base, `${base}.mjs`, join(base, 'index.mjs')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
};
function closure(entry) {
  const seen = new Set(); const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    let src = ''; try { src = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(IMPORT)) {
      const r = resolve(f, m[1] || m[2]);
      if (r && !seen.has(r)) stack.push(r);
    }
  }
  return seen;
}

const usedBy = new Map();      // module -> Set(site)
const perSite = new Map();
for (const s of siteDirs) {
  const c = closure(join('site', s, 'server.mjs'));
  perSite.set(s, c);
  for (const f of c) {
    if (!f.startsWith('integrations/')) continue;
    if (!usedBy.has(f)) usedBy.set(f, new Set());
    usedBy.get(f).add(s);
  }
}

const allModules = [];
for (const dir of ['integrations', 'integrations/soapbox']) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.mjs') || f.includes('.test.')) continue;
    allModules.push(`${dir}/${f}`);
  }
}

const undeployed = siteDirs.filter((s) => !LIVE.has(s));
const orphan = allModules.filter((m) => !usedBy.has(m));
const onlyUndeployed = allModules.filter((m) => {
  const u = usedBy.get(m);
  return u && [...u].every((s) => !LIVE.has(s));
});

const lines = (n) => (f) => { try { return readFileSync(f, 'utf8').split('\n').length; } catch { return 0; } };
const L = lines();
const byLines = (a, b) => L(b) - L(a);

console.log(`SITE SERVERS      ${siteDirs.length}`);
console.log(`  live            ${siteDirs.length - undeployed.length}`);
console.log(`  no live host    ${undeployed.length}`);
console.log(`SHARED MODULES    ${allModules.length}`);
console.log(`  reachable       ${allModules.length - orphan.length}`);
console.log(`  ORPHANED        ${orphan.length}  (no site imports them — no visitor can reach this work)`);
console.log(`  gated on deploy ${onlyUndeployed.length}  (only an undeployed site uses them)`);

console.log(`\n── UNDEPLOYED SITE SERVERS (${undeployed.length}) ──`);
for (const s of undeployed.sort()) console.log(`  ${s.padEnd(22)} ${L(join('site', s, 'server.mjs'))} lines`);

console.log(`\n── 30 LARGEST ORPHANED MODULES — built, unreachable ──`);
for (const m of orphan.sort(byLines).slice(0, 30)) {
  let why = '';
  try { why = (readFileSync(m, 'utf8').split('\n').find((l) => l.startsWith('//') && l.length > 40) || '').replace(/^\/\/\s*/, '').slice(0, 78); } catch {}
  console.log(`  ${String(L(m)).padStart(5)}  ${m.replace('integrations/', '').padEnd(38)} ${why}`);
}
