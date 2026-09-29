// free-film-registry.mjs — every curated, license-cleared FREE film list SoapBox Stream plays, in one place.
// SoapBox Films reads allFreeFilms() for "Watch free on SoapBox Stream" and the Stream <-> Films bridge.
// Adding a new curated list = one import + one entry in LISTS below (each list registers its own IA ids with
// archive-video.registerClearedIds at import). Entries: { id: <IA identifier>, title, year, ... }.
import * as horror from './horror-taxonomy.mjs';
import * as classics from './classic-films.mjs';
import * as pdMore from './pd-films-more.mjs';

import * as narco from './narco-cinema.mjs';

export const LISTS = [
  { name: 'horror', films: () => horror.PD_HORROR_FILMS || [] },
  { name: 'classics', films: () => classics.PD_CLASSICS || [] },
  { name: 'more', films: () => pdMore.PD_MORE || [] },
  { name: 'narco', films: () => narco.NARCO_PD || [] },
];

/** All free films across lists, first occurrence of an IA id wins. */
export function allFreeFilms() {
  const seen = new Set(); const out = [];
  for (const l of LISTS) for (const f of l.films()) { if (f && f.id && !seen.has(String(f.id))) { seen.add(String(f.id)); out.push({ ...f, list: l.name }); } }
  return out;
}
