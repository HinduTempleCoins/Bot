// relations.mjs — SoapBox Films: how films belong together (data/films/relations.json, built by
// integrations/films-relations.mjs from Wikidata). Organised from the top down:
//   brand (production company) → universes / franchises → series (in order) → films, plus sequels / prequels and
//   remakes. Film page box + /films/studios, /films/studio/<Q>, /films/group/<Q>. Pure builders; esc() all.

import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMPTY = { byFilm: {}, groups: {}, remadeAs: {}, studioGroups: {} };

let _cache = null;
export function loadRelations(dir) {
  const file = path.join(dir, 'relations.json');
  let mt = 0; try { mt = fs.statSync(file).mtimeMs; } catch { return EMPTY; }
  if (_cache && _cache.file === file && _cache.mt === mt) return _cache.data;
  let data = EMPTY;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = derive(j.byFilm || {}, j.groups || {});
  } catch {}
  _cache = { file, mt, data };
  return data;
}
export function __resetRelations() { _cache = null; }

/** Reverse indexes: remade-as, and for each studio the universes / franchises / series its films belong to. */
export function derive(byFilm, groups) {
  const remadeAs = {}; const studioGroups = {};
  for (const [f, e] of Object.entries(byFilm)) {
    for (const o of e.remakeOf || []) (remadeAs[o] ||= []).push(f);
    for (const s of e.studio || []) {
      const sg = (studioGroups[s.id] ||= new Set());
      for (const k of ['universe', 'franchise', 'series']) for (const g of e[k] || []) if (groups[g.id]) sg.add(g.id);
    }
  }
  const sgOut = {};
  for (const [k, v] of Object.entries(studioGroups)) sgOut[k] = [...v];
  return { byFilm, groups, remadeAs, studioGroups: sgOut };
}

const KIND_NAME = { universe: 'Universe', franchise: 'Franchise', series: 'Series', studio: 'Studio' };
const KIND_PLURAL = { universe: 'Universes', franchise: 'Franchises', series: 'Series', studio: 'Studios' };

/** Films of a group in order: series by ordinal, then by year. titleOf(id) → { t, y } | null */
export function orderedFilms(data, gid, titleOf) {
  const g = data.groups[gid];
  if (!g) return [];
  const ord = (f) => { const s = (data.byFilm[f] && data.byFilm[f].series || []).find((x) => x.id === gid); return s && Number.isFinite(s.n) ? s.n : null; };
  return g.films.map((f) => ({ id: f, n: ord(f), ...(titleOf(f) || { t: f, y: 0 }) }))
    .sort((a, b) => (a.n != null && b.n != null ? a.n - b.n : 0) || (a.y || 9999) - (b.y || 9999));
}

/** The film page box. titleOf(id) → { t, y } | null */
export function relationsBox(data, filmId, titleOf) {
  const e = data.byFilm[filmId];
  const remadeAs = data.remadeAs[filmId] || [];
  if (!e && !remadeAs.length) return '';
  const link = (id) => { const x = titleOf(id); return x ? `<a href="/films/${esc(id)}">${esc(x.t)}${x.y ? ` (${esc(x.y)})` : ''}</a>` : ''; };
  const group = (g) => `<a class=chip href="/films/group/${esc(g.id)}">${esc(g.t)}</a>`;
  const rows = [];
  if (e && (e.prev || e.next)) rows.push(`<p>${e.prev && link(e.prev) ? `← Previous: ${link(e.prev)}` : ''}${e.prev && e.next && link(e.prev) && link(e.next) ? ' &nbsp;·&nbsp; ' : ''}${e.next && link(e.next) ? `Next: ${link(e.next)} →` : ''}</p>`);
  for (const k of ['series', 'universe', 'franchise']) {
    const gs = (e && e[k] || []).filter((g) => data.groups[g.id]);
    if (gs.length) rows.push(`<p><b>${KIND_NAME[k]}:</b> ${gs.map(group).join(' ')}</p>`);
  }
  const studios = (e && e.studio || []).slice(0, 4);
  if (studios.length) rows.push(`<p><b>Studio:</b> ${studios.map((s) => `<a class=chip href="/films/studio/${esc(s.id)}">${esc(s.t)}</a>`).join(' ')}</p>`);
  const of = (e && e.remakeOf || []).map(link).filter(Boolean);
  if (of.length) rows.push(`<p><b>Remake of:</b> ${of.join(', ')}</p>`);
  const as = remadeAs.map(link).filter(Boolean);
  if (as.length) rows.push(`<p><b>Remade as:</b> ${as.join(', ')}</p>`);
  return rows.length ? `<h2>Series, universe &amp; remakes</h2><div class=box>${rows.join('')}</div>` : '';
}

export function groupBody(data, gid, titleOf, card) {
  const g = data.groups[gid];
  if (!g) return null;
  const films = orderedFilms(data, gid, titleOf);
  return `<h1>${esc(g.t)}</h1><p class=meta>${esc(KIND_NAME[g.kind] || g.kind)} · ${films.length} film${films.length === 1 ? '' : 's'}${g.kind === 'series' ? ' · in series order' : ' · by year'}</p>
<div class=grid>${films.map((f) => card(f.id)).filter(Boolean).join('')}</div>`;
}

export function studioBody(data, sid, titleOf, card) {
  const g = data.groups[sid];
  if (!g || g.kind !== 'studio') return null;
  const sub = (data.studioGroups[sid] || []).map((id) => ({ id, ...data.groups[id] })).filter((x) => x.films && x.films.length > 1)
    .sort((a, b) => ['universe', 'franchise', 'series'].indexOf(a.kind) - ['universe', 'franchise', 'series'].indexOf(b.kind) || b.films.length - a.films.length);
  const films = g.films.map((f) => ({ id: f, ...(titleOf(f) || {}) })).sort((a, b) => (b.y || 0) - (a.y || 0));
  const section = (kind) => { const xs = sub.filter((x) => x.kind === kind); return xs.length ? `<h2>${KIND_PLURAL[kind]}</h2><p class=tags>${xs.map((x) => `<a href="/films/group/${esc(x.id)}">${esc(x.t)} <span class=meta>(${x.films.length})</span></a>`).join(' ')}</p>` : ''; };
  return `<h1>${esc(g.t)}</h1><p class=meta>Studio · ${films.length} film${films.length === 1 ? '' : 's'} in SoapBox Films</p>
${section('universe')}${section('franchise')}${section('series')}
<h2>Films</h2><div class=grid>${films.slice(0, 120).map((f) => card(f.id)).filter(Boolean).join('')}</div>`;
}

export function studiosBody(data) {
  const studios = Object.entries(data.groups).filter(([, g]) => g.kind === 'studio' && g.films.length >= 3)
    .sort((a, b) => b[1].films.length - a[1].films.length).slice(0, 300);
  return `<h1>Studios, universes &amp; franchises</h1><p class=meta>Start from the brand, then its universes, franchises and series. Every film links to where to watch it and its reviews.</p>
<p class=tags>${studios.map(([id, g]) => `<a href="/films/studio/${esc(id)}">${esc(g.t)} <span class=meta>(${g.films.length})</span></a>`).join(' ')}</p>`;
}
