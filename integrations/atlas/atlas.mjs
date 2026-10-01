// atlas.mjs — the population marker atlas: what the public and government genetic systems record about
// "everyone", which categories they use, and what those categories absorb.
//
// Two data sources:
//   1. crosswalk.json (in git) — the sourced system → categories → "how MENA/Levantine is handled" table,
//      the international systems, and the published ancient-ancestry model estimates.
//   2. ATLAS_DIR (on the host, not in git) — derived aggregate tables built on the worker from public
//      downloads (1000 Genomes Y calls, AADR ancient haplogroup calls). Aggregate only; no individual data.
//
// Pure builders + small fs readers; soft-fail, never throws; esc() on all interpolation.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ATLAS_DIR = () => process.env.ATLAS_DIR || '/var/lib/hathor-atlas';
export const CROSSWALK_FILE = () => process.env.ATLAS_CROSSWALK || path.join(HERE, 'crosswalk.json');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const EMPTY = { systems: [], international: [], ancestry_models: { entries: [] }, updated: '' };

function readJson(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; }
}

let _cw = null;
export function loadCrosswalk(file = CROSSWALK_FILE()) {
  if (_cw && _cw.file === file) return _cw.data;
  const j = readJson(file);
  const data = j ? { ...EMPTY, ...j, ancestry_models: { entries: [], ...(j.ancestry_models || {}) } } : EMPTY;
  _cw = { file, data };
  return data;
}
export function __resetAtlas() { _cw = null; }

/** Derived aggregate tables written by the worker build (1kg_y_by_population.json, aadr_ancient.json). */
export function loadDerived(dir = ATLAS_DIR()) {
  return {
    modernY: readJson(path.join(dir, '1kg_y_by_population.json')) || null,
    ancient: readJson(path.join(dir, 'aadr_ancient.json')) || null,
  };
}

/** Systems that have no Middle Eastern / North African / Levantine category at all. */
export function gapSystems(data = loadCrosswalk()) {
  return (data.systems || []).filter((s) => /^No (Middle Eastern|Levantine)|no Middle Eastern|No Middle Eastern, North African/i.test(String(s.mena || '')) || /zero-sample hole|none of them Middle Eastern|Three U\.S\. population groups only|Five major groups/i.test(String(s.mena || '')));
}

/** % of a haplogroup within one population of a derived modern table. → null when unknown. */
export function share(table, pop, hg) {
  const p = table && table[pop];
  if (!p || !p.n) return null;
  const counts = p.haplogroups || {};
  let hit = 0;
  for (const [k, v] of Object.entries(counts)) if (k === hg || k.startsWith(hg)) hit += v;
  return Math.round((1000 * hit) / p.n) / 10;
}

const row = (cells, tag = 'td') => `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;

function systemsTable(systems) {
  return `<table class=atbl><thead>${row(['System', 'Who runs it', 'Categories it uses', 'Where Levantine / Mesopotamian / North African people land'], 'th')}</thead><tbody>
${systems.map((s) => row([
    `<b>${esc(s.name)}</b><br><span class=meta>${esc(s.markers || '')}</span>`,
    esc(s.operator || ''),
    `<span class=cats>${(s.categories || []).map((c) => `<span class=cat>${esc(c)}</span>`).join(' ')}</span>`,
    `${esc(s.mena || '')}<br><span class=meta>Source: ${esc(s.source || '')}</span>`,
  ])).join('\n')}</tbody></table>`;
}

function intlTable(intl) {
  return `<table class=atbl><thead>${row(['Country / programme', 'How it categorises people', 'Access'], 'th')}</thead><tbody>
${intl.map((s) => row([
    `<b>${esc(s.name)}</b><br><span class=meta>${esc(s.country || '')}</span>`,
    `${esc(s.categories || '')}<br><span class=meta>Source: ${esc(s.source || '')}</span>`,
    esc(s.access || ''),
  ])).join('\n')}</tbody></table>`;
}

function modelsTable(entries) {
  return `<table class=atbl><thead>${row(['Population', 'Ancient component', 'Share', 'Later component', 'When', 'Source'], 'th')}</thead><tbody>
${entries.map((e) => row([
    `<b>${esc(e.group)}</b>`,
    esc(e.ancient_component || ''),
    /NEEDS-EXTRACTION/.test(String(e.share)) ? '<span class=todo>not yet read from the paper</span>' : esc(e.share || ''),
    esc(e.later_component || ''),
    /NEEDS-EXTRACTION/.test(String(e.later_date)) ? '<span class=todo>not yet read</span>' : esc(e.later_date || ''),
    `<span class=meta>${esc(e.source || '')}</span>${e.note ? `<br><span class=note>${esc(e.note)}</span>` : ''}`,
  ])).join('\n')}</tbody></table>`;
}

function modernTable(modernY) {
  if (!modernY) return '<p class=meta>The modern haplogroup table has not been built on this host yet.</p>';
  const pops = Object.entries(modernY).sort((a, b) => String(a[1].super).localeCompare(String(b[1].super)) || a[0].localeCompare(b[0]));
  return `<table class=atbl><thead>${row(['Population', 'Region label', 'Men called', 'Most common paternal lineages'], 'th')}</thead><tbody>
${pops.map(([code, p]) => row([
    `<b>${esc(code)}</b> <span class=meta>${esc(p.desc || '')}</span>`,
    esc(p.super || ''),
    esc(p.n),
    Object.entries(p.haplogroups || {}).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([h, n]) => `${esc(h)} ${Math.round((1000 * n) / p.n) / 10}%`).join(', '),
  ])).join('\n')}</tbody></table>`;
}

/** The interactive map of ancient individuals (AADR, CC BY 4.0): filter by Y / mtDNA haplogroup, date, and
 *  close-kin parentage (long runs of homozygosity). Data is fetched from /atlas/ancient.json (built on the worker). */
export function ancientMapBlock() {
  return `<h2>Ancient individuals: haplogroups by place and time</h2>
<p>Every ancient person in the Allen Ancient DNA Resource with a date and a findspot — about 19,000 people — plotted where they were buried. Filter by paternal (Y) or maternal (mtDNA) haplogroup and by date. <b>Close-kin parentage</b> marks individuals whose genomes carry more than 50 cM of long identical stretches (runs of homozygosity over 20 cM) — the signature of related parents, such as the Newgrange tomb burial NG10 (Cassidy et al. 2020).</p>
<div class=box style="max-width:none">
<label>Y haplogroup starts with <input id=fy size=8 placeholder="J2a"></label>
<label>mtDNA starts with <input id=fm size=8 placeholder="U5"></label>
<label>from <input id=fa size=7 value=50000> to <input id=fb size=6 value=0> years before 1950</label>
<label><input id=fk type=checkbox> close-kin parentage only</label>
<span id=fc class=meta></span>
<div id=amap style="height:540px;margin-top:10px;border-radius:10px"></div>
<p class=meta>Source: Allen Ancient DNA Resource v66 (Mallick et al. 2024, <i>Scientific Data</i>), CC BY 4.0 — haplogroup calls as published there (Y from YFull-based automatic calls unless manually corrected). Ancient individuals only; dates are calibrated means. Colour = age.</p>
</div>
<link rel=stylesheet href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  var map = L.map('amap', { preferCanvas: true, worldCopyJump: true }).setView([35, 25], 3);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap contributors &copy; CARTO', maxZoom: 12 }).addTo(map);
  var layer = L.layerGroup().addTo(map), rows = [];
  function col(bp) { var t = Math.min(1, Math.log10(Math.max(bp, 100)) / 4.7); return 'hsl(' + Math.round(50 + 230 * t) + ',85%,60%)'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function draw() {
    var y = document.getElementById('fy').value.trim().toUpperCase(), m = document.getElementById('fm').value.trim().toUpperCase();
    var a = +document.getElementById('fa').value || 1e9, b = +document.getElementById('fb').value || 0, k = document.getElementById('fk').checked, n = 0;
    layer.clearLayers();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r[6] > a || r[6] < b) continue;
      if (y && String(r[8]).toUpperCase().indexOf(y) !== 0) continue;
      if (m && String(r[9]).toUpperCase().indexOf(m) !== 0) continue;
      if (k && !(r[10] > 50)) continue;
      n++;
      L.circleMarker([r[4], r[5]], { radius: k ? 6 : 4, weight: 0, fillOpacity: 0.8, fillColor: col(r[6]) }).bindPopup(
        '<b>' + esc(r[0]) + '</b> — ' + esc(r[1]) + '<br>' + esc(r[2]) + ', ' + esc(r[3]) + '<br>~' + esc(r[6]) + ' years before 1950' +
        '<br>Y: ' + esc(r[8] || '—') + ' &middot; mt: ' + esc(r[9] || '—') + (r[10] ? '<br>long ROH: ' + esc(r[10]) + ' cM' : '') + '<br><span style="opacity:.7">' + esc(r[11]) + '</span>').addTo(layer);
    }
    document.getElementById('fc').textContent = n.toLocaleString() + ' individuals shown';
  }
  ['fy', 'fm', 'fa', 'fb', 'fk'].forEach(function (id) { document.getElementById(id).addEventListener('change', draw); });
  fetch('/atlas/ancient.json').then(function (r) { return r.json(); }).then(function (d) { rows = d.rows || []; draw(); })
    .catch(function () { document.getElementById('fc').textContent = 'map data not available yet'; });
})();
</script>`;
}

/** The /atlas page body. */
export function atlasBody(data = loadCrosswalk(), derived = loadDerived()) {
  const systems = data.systems || [];
  const gaps = gapSystems(data);
  const modern = derived.modernY && derived.modernY.populations ? derived.modernY.populations : derived.modernY;
  return `<style>
.atbl{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}
.atbl th,.atbl td{border:1px solid var(--bd);padding:8px 10px;vertical-align:top;text-align:left}
.atbl th{background:var(--panel);font-weight:600}
.cat{display:inline-block;border:1px solid var(--bd);border-radius:9px;padding:1px 7px;margin:1px;font-size:12px}
.atbl .meta{font-size:12px;opacity:.75}
.todo{font-size:12px;opacity:.7;font-style:italic}
.note{font-size:12px;color:#e0a11b}
.box{border:1px solid var(--bd);border-radius:12px;padding:12px 16px;background:var(--panel);max-width:980px}
.atlas p,.atlas li{line-height:1.6;max-width:900px}
</style>
<div class=atlas>
<h1>The marker atlas: what the genetic databases record, and who they leave out</h1>
<p class=lead><b>Alpha.</b> This page gathers, at population level only, the categories that government and public genetic systems use to file people — and shows what those categories absorb. No individual data is held here. Every row cites its source.</p>

<div class=box>
<h2 style="margin-top:0">The finding in one line</h2>
<p>The systems that hold genetic markers on the general population sort people into a handful of racial bins inherited from statistical policy, not from genetics. ${esc(gaps.length)} of the ${esc(systems.length)} systems listed below have <b>no Middle Eastern, North African or Levantine category at all</b>. In those systems a person of Lebanese, Syrian, Assyrian, Mesopotamian or Phoenician-descended ancestry is counted as <b>&ldquo;Caucasian&rdquo;</b> or <b>&ldquo;White&rdquo;</b>. The most widely used research reference panel in the world, the 1000 Genomes Project, sampled 26 populations and <b>not one of them is from the Levant, Mesopotamia or North Africa</b>.</p>
<p>Meanwhile the ancient-DNA record resolves those same people precisely, by site and by century. The categories are the thing that cannot see them.</p>
</div>

<h2>United States and international forensic, clinical and research systems</h2>
${systemsTable(systems)}

<h2>National programmes elsewhere</h2>
<p>How other countries' genetic resources categorise people — and where the region in question is resolved or absorbed.</p>
${intlTable(data.international || [])}

${ancientMapBlock()}

<h2>What the ancient DNA says about the modern populations</h2>
<p>Published model estimates, not measurements of any person. Where a per-group figure has not yet been read out of a paper's supplementary tables, it is marked as such rather than guessed.</p>
${modelsTable((data.ancestry_models || {}).entries || [])}

<h2>Paternal lineages in the open reference panel</h2>
<p>Counted from the 1000 Genomes Project's own published Y-haplogroup calls. Read it alongside the gap above: these are the populations the panel actually sampled.</p>
${modernTable(modern)}

<p class=meta>Sources are listed against each row. Aggregate and population-level data only. Categories quoted from each system's own documentation. Last updated ${esc(data.updated || '')}. This is Alpha work and will contain errors; corrections are welcome.</p>
</div>`;
}

export function atlasLd(data = loadCrosswalk(), base = '') {
  return {
    '@context': 'https://schema.org', '@type': 'Dataset',
    name: 'The marker atlas: population categories in government and public genetic databases',
    description: 'Which categories forensic, clinical and research genetic systems use to classify people, and where Levantine, Mesopotamian and North African populations land in them. Aggregate data only.',
    url: `${base}/atlas`, creator: { '@type': 'Organization', name: 'MELEK / Hathor' },
    dateModified: data.updated || undefined, isAccessibleForFree: true,
  };
}
