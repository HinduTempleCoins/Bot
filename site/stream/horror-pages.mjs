// horror-pages.mjs — SoapBox Stream pages for the operator's two horror papers (integrations/soapbox/horror-map.mjs):
//   /horror/map                          A Map of Horror: the argument, the thread, the borders, every shelf, national
//                                        cinemas, where to watch, the eight-genre proposal
//   /horror/shelf/<id>                   one shelf with every title
//   /horror/girl-has-to-kill-everyone    the genre: its heart, the tests, every wing, the monster wing, adjacent,
//                                        near-but-not-in, where to watch, how to find more
//   /horror/stills  + /horror/img/<f>    Hathor's October horror stills (made on our own servers)
// Titles link to the Films database search for where-to-watch. Pure builders; esc() everything; the caller passes
// its own page shell.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as M from '../../integrations/soapbox/horror-map.mjs';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const STILLS_DIR = () => process.env.HORROR_STILLS_DIR || '/var/lib/soapbox-horror';
export const FILMS_SEARCH = () => process.env.FILMS_SEARCH_PATH || '/films';

const filmHref = (x) => `${FILMS_SEARCH()}?q=${encodeURIComponent(`${x.t}${x.y && /^\d{4}$/.test(x.y) ? ` ${x.y}` : ''}`)}`;
const titleLink = (x) => `<a href="${esc(filmHref(x))}" class=hz-t><i>${esc(x.t)}</i>${x.y ? ` <span class=hz-y>(${esc(x.y)})</span>` : ''}</a>`;
const inlineTitles = (list) => list.map(titleLink).join(' <span class=hz-dot>·</span> ');
const table = (list) => `<table class=hz-tbl><tr><th>Title (year)</th><th>Setup</th></tr>${list.map((x) => `<tr><td>${titleLink(x)}</td><td>${esc(x.note || '')}</td></tr>`).join('')}</table>`;
const paras = (arr) => arr.map((p) => `<p>${esc(p)}</p>`).join('');

export const HZ_STYLE = `<style>.hz p{line-height:1.6;max-width:820px}.hz h2{margin-top:28px}.hz h3{margin:18px 0 6px}
  .hz-t{color:var(--fg)}.hz-t:hover{text-decoration:underline}.hz-y{color:var(--mut);font-style:normal}.hz-dot{color:var(--mut);padding:0 3px}
  .hz-tbl{border-collapse:collapse;width:100%;max-width:920px;font-size:14px}.hz-tbl th,.hz-tbl td{border-bottom:1px solid var(--bd);padding:7px 8px;text-align:left;vertical-align:top}
  .hz-tbl th{color:var(--mut);font-size:12px}.hz-note{border-left:3px solid #b3202a;padding:8px 12px;background:#1a0c0e;border-radius:6px;max-width:820px}
  .hz-stills{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}.hz-stills img{width:100%;border-radius:10px;border:1px solid var(--bd);display:block}
  .hz-stills figcaption{font-size:12px;color:var(--mut);margin-top:4px}.hz-toc a{margin-right:10px;white-space:nowrap}</style>`;

// ── stills ─────────────────────────────────────────────────────────────────────────────────────────
export function loadStills(dir = STILLS_DIR()) {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'stills.json'), 'utf8'));
    return Array.isArray(m.stills) ? m.stills.filter((s) => /^[\w-]+\.(jpe?g|png|webp)$/.test(s.file || '')) : [];
  } catch { return []; }
}
export function serveStill(res, file, dir = STILLS_DIR()) {
  if (!/^[\w-]+\.(jpe?g|png|webp)$/.test(String(file || '')) || !existsSync(join(dir, file))) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  res.writeHead(200, { 'content-type': /\.png$/.test(file) ? 'image/png' : /\.webp$/.test(file) ? 'image/webp' : 'image/jpeg', 'cache-control': 'public, max-age=86400' });
  return res.end(readFileSync(join(dir, file)));
}
const stillsGrid = (stills) => stills.length ? `<div class=hz-stills>${stills.map((s) => `<figure style="margin:0"><img src="/horror/img/${esc(s.file)}" alt="${esc(s.caption)}" loading=lazy><figcaption>${esc(s.caption)}</figcaption></figure>`).join('')}</div>` : '';

export function stillsBody(stills = loadStills()) {
  return `${HZ_STYLE}<div class=hz><p><a class=btn href="/horror">← All horror</a></p>
    <h1>October horror stills</h1><p class=lead>Monsters and scenes Hathor made on our own servers to get ready for Halloween — one for each corner of the map.</p>
    ${stillsGrid(stills) || '<p class=empty>The stills are still rendering. Check back soon.</p>'}
    <p style="margin-top:18px"><a class=btn href="/horror/map">A Map of Horror →</a> <a class=btn href="/horror/girl-has-to-kill-everyone">Girl Has to Kill Everyone →</a></p></div>`;
}

// ── A Map of Horror ────────────────────────────────────────────────────────────────────────────────
export function mapBody() {
  const shelfList = M.SHELVES.map((s) => `<h3 id="${esc(s.id)}"><a href="/horror/shelf/${esc(s.id)}">${esc(s.title)}</a></h3>
    ${s.note ? `<p class=lead>${esc(s.note)}</p>` : ''}<p>${inlineTitles(s.titles)}</p>`).join('');
  const borders = M.BORDERS.map((b) => `<h3 id="${esc(b.id)}">${esc(b.title)}</h3>${b.note ? `<p class=lead>${esc(b.note)}</p>` : ''}<p>${inlineTitles(b.titles)}</p>`).join('');
  const national = M.NATIONAL.map((n) => `<p><b>${esc(n.title)}</b> — ${inlineTitles(n.titles)}</p>`).join('');
  const proposal = `<table class=hz-tbl><tr><th>Standalone genre</th><th>What it is organized around</th><th>Subgenres it would absorb</th></tr>${M.PROPOSAL.map((p) => `<tr><td><b>${esc(p.genre)}</b></td><td>${esc(p.around)}</td><td>${esc(p.absorbs)}</td></tr>`).join('')}</table><p>${esc(M.PROPOSAL_CODA)}</p>`;
  const toc = M.SHELVES.map((s) => `<a href="#${esc(s.id)}">${esc(s.title.replace(/^The Religious Seam: /, 'Religious: '))}</a>`).join(' ');
  return `${HZ_STYLE}<div class=hz><p><a class=btn href="/horror">← All horror</a></p>
    <h1>A Map of Horror</h1><p class=lead>A working taxonomy of the horror genre, built out from the original thread. ${M.countTitles()} title entries across ${M.SHELVES.length} shelves, the borders, and nine national cinemas. Every title links to where to watch it.</p>
    <h2>The argument</h2>${paras(M.ARGUMENT)}
    <h2>Part one: the thread</h2>${paras(M.THREAD)}
    <h3>The usual setup</h3><p>${esc(M.USUAL_SETUP.intro)}</p><p>${esc(M.USUAL_SETUP.places)}</p><p>${esc(M.USUAL_SETUP.body)}</p>${M.USUAL_SETUP.lines.map((l) => `<p><i>${esc(l)}</i></p>`).join('')}
    <h2>Part two: the borders</h2><p>Horror doesn't have clean edges. Three genres bleed into it constantly, and knowing where the seam is helps you sort everything else.</p>${borders}
    <h2>Part three: the genres</h2><p class=hz-toc>${toc}</p>${shelfList}
    <h2>National cinemas</h2><p>The genre is not American. Each of these is its own shelf.</p>${national}
    <h2>Part four: Girl Has to Kill Everyone</h2><p>A genre mapped separately — <a href="/horror/girl-has-to-kill-everyone">the full catalogue is here</a>.</p>
    <h2>Part five: where to watch</h2><p>${esc(M.MAP_WHERE_TO_WATCH.text)}</p><p>${inlineTitles(M.MAP_WHERE_TO_WATCH.titles)}</p><p class=lead>${esc(M.MAP_WHERE_TO_WATCH.caveat)}</p>
    <h2>The proposal</h2><p>If the categories in Part Three were separated the way film culture separates comedy from drama from western, horror would resolve into roughly eight standalone genres, each with subgenres of its own:</p>${proposal}
    ${stillsGrid(loadStills().slice(0, 6))}</div>`;
}

export function shelfBody(s) {
  return `${HZ_STYLE}<div class=hz><p><a class=btn href="/horror/map">← A Map of Horror</a></p>
    <h1>${esc(s.title)}</h1>${s.note ? `<p class=lead>${esc(s.note)}</p>` : ''}
    <table class=hz-tbl><tr><th>Title</th><th>Year</th></tr>${s.titles.map((x) => `<tr><td>${titleLink({ t: x.t })}</td><td>${esc(x.y)}</td></tr>`).join('')}</table>
    <p class=lead style="margin-top:12px">Click a title for where to watch it.</p></div>`;
}

// ── Girl Has to Kill Everyone ──────────────────────────────────────────────────────────────────────
export function girlBody() {
  const G = M.GIRL;
  const wings = G.wings.map((w) => `<h3 id="${esc(w.id)}">${esc(w.title)}${w.rank === 'fits' ? ' <span class=badge>fits · not primary · slower</span>' : ''}</h3><p>${esc(w.intro)}</p>${table(w.titles)}`).join('');
  const lf = G.findMore.loglines.map((l) => `<p><b>${esc(l.wing)}:</b> ${l.phrases.map((p) => `"${esc(p)}"`).join(', ')}</p>`).join('');
  return `${HZ_STYLE}<div class=hz><p><a class=btn href="/horror">← All horror</a> <a class=btn href="/horror/map">A Map of Horror</a></p>
    <h1>Girl Has to Kill Everyone</h1><p class=lead>A horror genre. Primary title: ${titleLink(G.primary)}, ${esc(G.primary.note)}.</p>
    <p class=hz-note>${esc(G.heart)}</p>
    <h2>The two tests</h2><ul>${G.tests.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    <h2>The core wing — she has to kill everyone to survive or escape</h2>${wings}
    <h2>Secondary genre: she is the monster</h2><p>Primary title: ${titleLink(M.GIRL.monster.primary)}, ${esc(M.GIRL.monster.primary.note)}. ${esc(M.GIRL.monster.intro)}</p>
    <h3>With a snapping point — an ordinary girl and then a clear before and after</h3>${table(M.GIRL.monster.snapping)}
    <h3>Without one — no break, no trigger, this is simply who she is</h3>${table(M.GIRL.monster.without)}
    <h2>Adjacent genres</h2>${table(G.adjacent)}
    <h2>Near the genre, but not in it</h2><p>These have the premise, but nobody is a girl who has to kill everyone.</p>${table(G.near)}
    <h2>Where to watch</h2><p class=lead>As of ${esc(G.whereToWatch.asOf)}</p>
    <p>${esc(G.whereToWatch.seen)}</p><p>${esc(G.whereToWatch.cycles)}</p><p>${esc(G.whereToWatch.elsewhere)}</p>
    <h2>How to find more</h2><p>Logline mining — search these phrases plus "movie":</p>${lf}
    <p>Keyword databases:</p><ul>${G.findMore.databases.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
    <p><b>People to follow:</b> ${esc(G.findMore.people)}</p>
    ${stillsGrid(loadStills().filter((s) => /final_girl|slasher|hathor/.test(s.file)))}</div>`;
}

/** handled? → true after responding. shell(title, inner, opts) and send(res, html, code) come from the stream server. */
export function horrorMapRoute(path, res, { shell, send, base }) {
  if (path === '/horror/map') { send(res, shell('A Map of Horror · SoapBox Stream', mapBody(), { canonical: `${base}/horror/map`, description: 'A working taxonomy of the horror genre: why horror is a family of genres, not the intense end of thriller — every shelf with its titles, the borders, national cinemas, where to watch, and the eight-genre proposal.' })); return true; }
  if (path === '/horror/girl-has-to-kill-everyone') { send(res, shell('Girl Has to Kill Everyone · SoapBox Stream', girlBody(), { canonical: `${base}/horror/girl-has-to-kill-everyone`, description: 'Girl Has to Kill Everyone, a horror genre: Martyrs and the captivity and trafficking core, siege, backwoods, the she-is-the-monster wing, adjacent films, and where to watch.' })); return true; }
  if (path === '/horror/stills') { send(res, shell('October horror stills · SoapBox Stream', stillsBody(), { canonical: `${base}/horror/stills`, description: 'Monsters and horror scenes Hathor made for October.' })); return true; }
  if (path.startsWith('/horror/img/')) { serveStill(res, decodeURIComponent(path.slice('/horror/img/'.length))); return true; }
  const m = /^\/horror\/shelf\/([a-z0-9-]+)$/.exec(path);
  if (m) {
    const s = M.shelfById(m[1]);
    if (!s) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('unknown shelf'); return true; }
    send(res, shell(`${s.title} · Horror · SoapBox Stream`, shelfBody(s), { canonical: `${base}/horror/shelf/${s.id}`, description: `${s.title}: ${s.titles.length} horror films${s.note ? ` — ${s.note}` : ''}` }));
    return true;
  }
  return false;
}

export const HORROR_MAP_PATHS = () => ['/horror/map', '/horror/girl-has-to-kill-everyone', '/horror/stills', ...[...M.SHELVES, ...M.BORDERS, ...M.NATIONAL].map((s) => `/horror/shelf/${s.id}`)];
