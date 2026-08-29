// music-charts.mjs — SoapBox MUSIC charts + lyrics/tab AGGREGATOR (SEO long-tail engine).
//
// Two jobs, one module:
//   1. CHARTS — "Top N <thing> in <genre>, <year>" list pages, the programmatic long-tail SEO play
//      (thousands of genre×year×category permutations). Each chart is a normalized, SOURCED ItemList
//      with schema.org JSON-LD (ItemList of MusicRecording) so it ranks. Rankings are OUR aggregated /
//      editorial / community picks, every entry provenance-tagged — never a proprietary chart echoed
//      as truth.
//   2. LYRICS + TABLATURE AGGREGATOR — a META-DIRECTORY. For a song it emits LINK-OUTS to where the
//      lyrics/tabs live (Genius, Musixmatch, AZLyrics; Ultimate Guitar, Songsterr, GuitarTabs). It
//      indexes and points; it NEVER stores or renders lyric or tab TEXT. Lyrics and tablature are
//      copyrighted — hosting them is infringement, so this module holds none. Deep-links only.
//
// DISCIPLINE: facts + sources, never verdicts. No copyrighted lyric/tab TEXT anywhere in this module or
//   its data. esc() every interpolation. Soft-fail-never-throw. Public-domain / CC-open recordings that
//   ARE ours to play route through music-catalog.mjs; this module is metadata + link-outs only.
//
//   import { LYRICS_SITES, TAB_SITES, musicRefs, chartEntry, topChart, chartSeo,
//            renderChart, renderRefs, dataNote, SAMPLE_CHART } from './music-charts.mjs'

const str = (v) => (v == null ? '' : String(v));
export function esc(s) {
  return str(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const q = (s) => encodeURIComponent(str(s).trim());
const slug = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Safe JSON for a <script type="application/ld+json"> block: escape '<' so a "</script>" in the data
// cannot break out of the tag. Valid JSON-LD (unicode escapes are legal in JSON strings).
const jsonLdSafe = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

// ── where lyrics / tabs actually live — we index + link out, we do not host the text ────────────────
export const LYRICS_SITES = [
  { id: 'genius', name: 'Genius', search: (a, t) => `https://genius.com/search?q=${q(`${a} ${t}`)}` },
  { id: 'musixmatch', name: 'Musixmatch', search: (a, t) => `https://www.musixmatch.com/search/${q(`${a} ${t}`)}` },
  { id: 'azlyrics', name: 'AZLyrics', search: (a, t) => `https://search.azlyrics.com/search.php?q=${q(`${a} ${t}`)}` },
  { id: 'lyricsfreak', name: 'LyricsFreak', search: (a, t) => `https://www.lyricsfreak.com/search.php?q=${q(`${a} ${t}`)}` },
];
export const TAB_SITES = [
  { id: 'ultimate-guitar', name: 'Ultimate Guitar', search: (a, t) => `https://www.ultimate-guitar.com/search.php?search_type=title&value=${q(`${a} ${t}`)}` },
  { id: 'songsterr', name: 'Songsterr', search: (a, t) => `https://www.songsterr.com/?pattern=${q(`${a} ${t}`)}` },
  { id: 'guitartabs', name: 'GuitarTabs.cc', search: (a, t) => `https://www.guitartabs.cc/search.php?q=${q(`${a} ${t}`)}` },
];

/**
 * musicRefs(artist, title) → { artist, title, lyrics:[{site,url}], tabs:[{site,url}] }. Pure link-outs
 * to each site's SEARCH for the song. Emits NO lyric/tab text. Soft: blank artist/title still returns
 * the site list (search home).
 */
export function musicRefs(artist, title) {
  const a = str(artist), t = str(title);
  const map = (sites) => sites.map((s) => ({ site: s.name, id: s.id, url: s.search(a, t) }));
  return { artist: a, title: t, lyrics: map(LYRICS_SITES), tabs: map(TAB_SITES) };
}

// ── charts: normalized, sourced Top-N entries ───────────────────────────────────────────────────────
/** One chart row. rank optional (assigned by topChart). Every entry SHOULD carry a source. */
export function chartEntry(raw = {}) {
  return {
    rank: Number.isFinite(+raw.rank) ? +raw.rank : null,
    title: str(raw.title),
    artist: str(raw.artist),
    year: str(raw.year),
    genre: str(raw.genre),
    note: str(raw.note),
    source: raw.source && raw.source.name ? { name: str(raw.source.name), url: str(raw.source.url) } : null,
  };
}

/**
 * topChart({ genre, year, category, entries, n }) → { title, genre, year, category, entries[], n }.
 * entries are normalized, ranked 1..n (respecting any explicit rank, else input order). Pure.
 */
export function topChart({ genre = '', year = '', category = 'songs', entries = [], n = 10 } = {}) {
  const rows = (Array.isArray(entries) ? entries : []).map(chartEntry);
  rows.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)); // explicit ranks first, stable otherwise
  const ranked = rows.slice(0, n).map((e, i) => ({ ...e, rank: e.rank ?? i + 1 }));
  const cat = str(category) || 'songs';
  const title = `Top ${ranked.length || n} ${cat}${genre ? ` in ${genre}` : ''}${year ? `, ${year}` : ''}`;
  return { title, genre: str(genre), year: str(year), category: cat, entries: ranked, n };
}

// ── SEO: title / description / canonical / JSON-LD ItemList of MusicRecording ────────────────────────
export function chartSeo(chart, { baseUrl = '' } = {}) {
  const c = chart || {};
  const path = `/music/top/${slug(c.category || 'songs')}/${slug(c.genre || 'all')}/${slug(c.year || 'all-time')}`;
  const canonical = `${str(baseUrl).replace(/\/$/, '')}${path}`;
  const description = `${c.title} — a SoapBox aggregated chart with sources for each pick, plus lyrics and guitar-tab links for every track.`;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'ItemList', name: c.title, url: canonical,
    numberOfItems: (c.entries || []).length,
    itemListElement: (c.entries || []).map((e) => ({
      '@type': 'ListItem', position: e.rank,
      item: { '@type': 'MusicRecording', name: e.title, byArtist: { '@type': 'MusicGroup', name: e.artist } },
    })),
  };
  return { title: c.title, description, canonical, path, jsonLd };
}

export function dataNote() {
  return 'Charts are SoapBox aggregated / editorial picks, each entry provenance-tagged — not a '
    + 'proprietary chart reproduced as fact. Lyrics and tablature are copyrighted: we link out to the '
    + 'sites that host them and store none of that text ourselves. Public-domain / Creative-Commons '
    + 'recordings that are free to play are served via the SoapBox music catalog.';
}

// ── render: an SEO chart page; each row deep-links to lyrics + tabs ──────────────────────────────────
export function renderChart(chart, { baseUrl = '' } = {}) {
  const c = chart || {};
  const seo = chartSeo(c, { baseUrl });
  const rows = (c.entries || []).map((e) => {
    const refs = musicRefs(e.artist, e.title);
    const ly = refs.lyrics.map((r) => `<a href="${esc(r.url)}" rel="nofollow noopener">${esc(r.site)}</a>`).join(' · ');
    const tb = refs.tabs.map((r) => `<a href="${esc(r.url)}" rel="nofollow noopener">${esc(r.site)}</a>`).join(' · ');
    const srcH = e.source ? ` <a class="src" href="${esc(e.source.url)}" rel="nofollow noopener">${esc(e.source.name)}</a>` : '';
    return `<li class="row"><span class="rk">${esc(e.rank)}</span>
      <span class="ttl"><b>${esc(e.title)}</b>${e.artist ? ` — ${esc(e.artist)}` : ''}${e.year ? ` <span class="yr">(${esc(e.year)})</span>` : ''}</span>
      ${e.note ? `<span class="nt">${esc(e.note)}</span>` : ''}${srcH}
      <span class="refs">Lyrics: ${ly} &nbsp;|&nbsp; Tabs: ${tb}</span></li>`;
  }).join('');
  return `<section class="music-chart">
  <h1>${esc(c.title)}</h1>
  <ol class="chart">${rows || '<li class="empty">No entries yet — this chart fills from sourced picks.</li>'}</ol>
  <p class="note">${esc(dataNote())}</p>
  <script type="application/ld+json">${jsonLdSafe(seo.jsonLd)}</script>
</section>`;
}

/** Standalone lyrics/tab link-out block for one song (no chart needed). */
export function renderRefs(artist, title) {
  const r = musicRefs(artist, title);
  const list = (arr) => arr.map((x) => `<a href="${esc(x.url)}" rel="nofollow noopener">${esc(x.site)}</a>`).join(' · ');
  return `<div class="song-refs"><h3>${esc(r.artist)} — ${esc(r.title)}</h3>
    <p><b>Lyrics:</b> ${list(r.lyrics)}</p><p><b>Guitar tabs:</b> ${list(r.tabs)}</p>
    <p class="note">${esc(dataNote())}</p></div>`;
}

// ── seed example (illustrative structure; production charts fill from sourced/community data) ────────
export const SAMPLE_CHART = topChart({
  genre: 'Delta Blues', year: '1929', category: 'recordings', n: 5,
  entries: [
    { rank: 1, title: 'Some These Days I\'ll Be Gone', artist: 'Charley Patton', year: '1929', note: 'illustrative — public-era recording', source: { name: 'Internet Archive', url: 'https://archive.org' } },
    { rank: 2, title: 'Pony Blues', artist: 'Charley Patton', year: '1929', source: { name: 'Internet Archive', url: 'https://archive.org' } },
    { rank: 3, title: 'Rollin\' and Tumblin\'', artist: 'Hambone Willie Newbern', year: '1929', source: { name: 'Internet Archive', url: 'https://archive.org' } },
  ],
});

// ── CLI (guarded) ───────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('music-charts.mjs')) {
  const [cmd = 'chart', a = '', b = ''] = process.argv.slice(2);
  if (cmd === 'refs') {
    console.log(JSON.stringify(musicRefs(a, b), null, 2));
  } else if (cmd === 'sites') {
    console.log('Lyrics:', LYRICS_SITES.map((s) => s.name).join(', '));
    console.log('Tabs:  ', TAB_SITES.map((s) => s.name).join(', '));
  } else {
    console.log(renderChart(SAMPLE_CHART, { baseUrl: 'https://music.soapbox.community' }));
  }
  console.log(`\n${dataNote()}`);
}
