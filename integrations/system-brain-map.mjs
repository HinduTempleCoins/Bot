// system-brain-map.mjs — THE unified map of the whole system: every live site + every repo, in one
// index the AI reasons over. This is the "didn't know about Herald" fix (operator): Hathor should
// hold a map of the entire estate — all 94 sites and all 12 repos — not just the one repo she lives
// in. The map is the Crypt-ology-style "everything is everything" index at system scale.
//
// Native + pure + soft-fail: reads site/_dispatch/routes.json and each site's server.mjs header for
// its purpose, and a repos manifest (name/desc/readme/lang) for the GitHub side. No network at
// build time beyond what the caller passes in. Emits:
//   buildMap({reposFile}) -> { sites:[{host,app,purpose}], repos:[{name,desc,lang,readme}], counts }
//   renderMapPage(map, baseUrl) -> standalone HTML (the Map Surface Page)
//   mapAsCorpusText(map) -> one big text blob to embed into the brain corpus
//
//   node integrations/system-brain-map.mjs            # writes knowledge/system-map.json + .md
//   node integrations/system-brain-map.mjs --repos <file.jsonl>

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Pull a one-line purpose from a site's server.mjs header comment. Soft-fails to ''. */
function purposeOf(app) {
  const f = join(ROOT, 'site', app, 'server.mjs');
  if (!existsSync(f)) return '';
  let head;
  try { head = readFileSync(f, 'utf8').split('\n').slice(0, 12); } catch { return ''; }
  // Typical: "// server.mjs — The Writing Room (write.soapbox.community). Preptober + the November…"
  for (const line of head) {
    const m = line.match(/^\/\/\s*server\.mjs\s*[—–-]\s*(.+)$/);
    if (m) return m[1].trim().replace(/\s+/g, ' ').slice(0, 300);
  }
  // else first non-empty comment line
  for (const line of head) {
    const m = line.match(/^\/\/\s*(.+\S)\s*$/);
    if (m && !/^(server\.mjs|PORT=|import|eslint)/i.test(m[1])) return m[1].trim().slice(0, 300);
  }
  return '';
}

export function buildMap({ reposFile } = {}) {
  let routes = {};
  try { routes = JSON.parse(readFileSync(join(ROOT, 'site/_dispatch/routes.json'), 'utf8')); } catch {}
  const sites = Object.entries(routes)
    .map(([host, app]) => ({ host, app, purpose: purposeOf(app) }))
    .sort((a, b) => a.host.localeCompare(b.host));

  let repos = [];
  if (reposFile && existsSync(reposFile)) {
    const byName = {};
    for (const line of readFileSync(reposFile, 'utf8').split('\n').filter(Boolean)) {
      try { const o = JSON.parse(line); byName[o.name] = { ...(byName[o.name] || {}), ...o }; } catch {}
    }
    repos = Object.values(byName).sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    generated: new Date().toISOString(),
    counts: { sites: sites.length, apps: new Set(sites.map((s) => s.app)).size, repos: repos.length },
    sites, repos,
  };
}

/** The whole map as flat text the embedder can chunk — this is what the brain "knows". */
export function mapAsCorpusText(map) {
  const L = [];
  L.push('# MELEK / Van Kush Family — System Map (the whole estate)');
  L.push(`Generated ${map.generated}. ${map.counts.sites} live sites across ${map.counts.apps} apps; ${map.counts.repos} repositories.`);
  L.push('\n## Live sites');
  for (const s of map.sites) L.push(`- https://${s.host} — ${s.purpose || '(' + s.app + ')'}`);
  L.push('\n## Repositories');
  for (const r of map.repos) L.push(`- ${r.name} (${r.lang || '?'}) — ${r.desc || ''} ${r.readme ? '· ' + r.readme : ''}`);
  return L.join('\n');
}

export function renderMapPage(map, baseUrl = '') {
  const siteRows = map.sites.map((s) => `<tr><td><a href="https://${esc(s.host)}">${esc(s.host)}</a></td><td>${esc(s.purpose)}</td></tr>`).join('\n');
  const repoRows = map.repos.map((r) => `<tr><td><a href="https://github.com/HinduTempleCoins/${esc(r.name)}">${esc(r.name)}</a></td><td>${esc(r.lang || '')}</td><td>${esc(r.desc || r.readme || '')}</td></tr>`).join('\n');
  const title = 'The System Map — MELEK / Van Kush Family';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="The whole estate in one map: ${map.counts.sites} live sites and ${map.counts.repos} repositories of the MELEK ecosystem and the Van Kush Family Research Institute.">
<meta name=robots content="index,follow">
<style>
:root{--bg:#0f1317;--panel:#161b21;--ink:#e8eef2;--mut:#9fb0bd;--line:#273039;--green:#49c37a;--link:#7fd6a0}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,sans-serif}
header{padding:16px 18px;border-bottom:1px solid var(--line);background:var(--panel)}
header a{color:var(--green);text-decoration:none;font-weight:700}
main{max-width:60em;margin:0 auto;padding:24px 18px 60px}
h1{font-size:1.7em}h2{color:var(--green);margin-top:1.6em}
p.lead{color:var(--mut);max-width:42em}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid var(--line);padding:.45em .6em;text-align:left;vertical-align:top}
th{background:var(--panel);color:var(--green)}a{color:var(--link)}
td:first-child{white-space:nowrap}
tr:nth-child(even) td{background:#12171c}
@media(max-width:640px){td:first-child{white-space:normal}}
</style></head><body>
<header><a href="https://vankushfamily.com">← Van Kush Family</a></header>
<main>
<h1>The System Map</h1>
<p class=lead>The whole estate in one place — every live site and every repository of the MELEK ecosystem and the <a href="https://vankushfamily.com">Van Kush Family Research Institute</a>. This is the map the Witness reads, so she knows what exists. ${map.counts.sites} sites · ${map.counts.repos} repositories · generated ${esc(map.generated.slice(0, 10))}.</p>
<h2>Live sites (${map.counts.sites})</h2>
<table><thead><tr><th>Site</th><th>What it is</th></tr></thead><tbody>${siteRows}</tbody></table>
<h2>Repositories (${map.counts.repos})</h2>
<table><thead><tr><th>Repo</th><th>Lang</th><th>What it is</th></tr></thead><tbody>${repoRows}</tbody></table>
</main></body></html>`;
}

if (process.argv[1] && /system-brain-map\.mjs$/.test(process.argv[1])) {
  const i = process.argv.indexOf('--repos');
  const reposFile = i > -1 ? process.argv[i + 1] : join(ROOT, '.local', 'system-map-repos.jsonl');
  const map = buildMap({ reposFile });
  writeFileSync(join(ROOT, 'knowledge', 'system-map.json'), JSON.stringify(map, null, 2));
  writeFileSync(join(ROOT, 'knowledge', 'system-map.md'), mapAsCorpusText(map));
  console.log(`system-map: ${map.counts.sites} sites, ${map.counts.apps} apps, ${map.counts.repos} repos → knowledge/system-map.json + .md`);
}
