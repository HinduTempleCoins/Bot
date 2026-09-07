// indo-european.mjs — the INDO-EUROPEAN research harvester for the Library of Ashurbanipal.
//
// Runs the scholarly side of scraper.mjs (Crossref, OpenAlex, Semantic Scholar, arXiv, PubMed,
// Wikidata) plus web search across a fixed, versioned set of research tracks, dedupes on normalized
// URL, and emits JSONL corpus records with full provenance.
//
// WHY A FIXED TRACK LIST AND NOT FREE-TEXT QUERIES. A one-off search is not a corpus. The tracks
// below are the actual shape of the field, so a re-run months later fetches the SAME questions and
// the diff is new literature rather than new phrasing. Add a track; never quietly reword one.
//
// ETYMOLOGY IS WEIGHTED HEAVIEST — it is what the corpus is actually for. The `etymology`,
// `sound-laws` and `lexicon` tracks together carry more queries than the rest of the file, and
// `PRIMARY_REFERENCES` names the standard dictionaries by author so the harvest can be checked
// against them rather than floating free.
//
// A NOTE ON THE FRINGE TRACK. Nostratic, Proto-World and glottochronology are included ON PURPOSE
// and flagged `contested: true`. The corpus argues about deep-time linguistic connection, so it has
// to hold the literature that tried it and the literature that refuted it. Flagging is not
// dismissal — it is the difference between citing Greenberg and citing him as though he had won.
//
//   import { TRACKS, harvest, toJsonl, queriesFor } from './scrapers/indo-european.mjs'
//   node integrations/scrapers/indo-european.mjs --out ie.jsonl --tracks etymology,sound-laws
//   node integrations/scrapers/indo-european.mjs --all --out ie.jsonl
//
// SECURITY / DISCIPLINE: no keys, no writes outside --out, injectable fetch, soft-fail per query so
// one dead provider cannot kill a multi-hour run.

import { searchAll, __setFetch as __setScraperFetch } from '../scraper.mjs';

export const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot; Indo-European corpus archival)';
export const RATE_LIMIT_MS = +(process.env.IE_RATE_LIMIT_MS || 1500);

/** Injectable for tests — forwards to scraper.mjs so the whole stack is offline-testable. */
export function __setFetch(fn) { __setScraperFetch(fn); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The tracks ─────────────────────────────────────────────────────────────────────────────────
export const TRACKS = [
  {
    id: 'etymology', weight: 3,
    label: 'Etymology and reconstructed roots',
    queries: [
      'Proto-Indo-European root reconstruction etymology',
      'Indo-European etymological dictionary methodology',
      'PIE verbal root ablaut grade reconstruction',
      'Indo-European kinship terminology etymology',
      'Proto-Indo-European numerals reconstruction',
      'Indo-European body-part vocabulary reconstruction',
      'Proto-Indo-European colour terms etymology',
      'Indo-European wheel wagon vocabulary chronology',
      'Proto-Indo-European horse terminology archaeology',
      'Indo-European agricultural vocabulary reconstruction',
      'PIE animal names reconstruction semantics',
      'Indo-European legal and social vocabulary Benveniste',
      'Wanderwort loanword Indo-European Semitic contact',
      'Substrate vocabulary pre-Indo-European Europe',
      'Indo-European river names hydronymy Krahe',
      'Proto-Indo-European homeland vocabulary palaeolinguistics',
    ],
  },
  {
    id: 'sound-laws', weight: 3,
    label: 'Sound laws and historical phonology',
    queries: [
      'Grimm law Germanic consonant shift',
      'Verner law accent Germanic voicing',
      'Grassmann law dissimilation aspirates Greek Sanskrit',
      'centum satem isogloss Indo-European',
      'laryngeal theory Indo-European Kurylowicz',
      'Bartholomae law Indo-Iranian',
      'Sievers law Indo-European syllabification',
      'Winter law Balto-Slavic lengthening',
      'ruki rule Indo-Iranian Balto-Slavic',
      'glottalic theory Indo-European stops Gamkrelidze Ivanov',
      'Proto-Indo-European accent ablaut system',
      'Neogrammarian regularity hypothesis exceptionless sound change',
    ],
  },
  {
    id: 'lexicon', weight: 2,
    label: 'Lexica, corpora and reference works',
    queries: [
      'Pokorny Indogermanisches etymologisches Woerterbuch',
      'Lexikon der indogermanischen Verben LIV',
      'Mallory Adams Oxford Introduction Proto-Indo-European',
      'Beekes Etymological Dictionary of Greek',
      'de Vaan Etymological Dictionary of Latin',
      'Kroonen Etymological Dictionary of Proto-Germanic',
      'Derksen Slavic Baltic etymological dictionary',
      'Cheung Iranian verb etymological dictionary',
      'Indo-European lexicon digital database',
    ],
  },
  {
    id: 'comparative-method', weight: 2,
    label: 'The comparative method and its limits',
    queries: [
      'comparative method historical linguistics reconstruction',
      'internal reconstruction methodology limits',
      'Bayesian phylogenetics Indo-European language tree',
      'Indo-European subgrouping cladistics',
      'linguistic palaeontology critique',
      'chance resemblance false cognate methodology',
    ],
  },
  {
    id: 'branches', weight: 2,
    label: 'The branches, especially the old ones',
    queries: [
      'Hittite Anatolian Indo-European position archaic',
      'Tocharian Indo-European Tarim Basin',
      'Mycenaean Greek Linear B Indo-European',
      'Vedic Sanskrit archaic Indo-European',
      'Avestan Old Persian Indo-Iranian',
      'Old Irish Celtic Indo-European reconstruction',
      'Armenian Indo-European position',
      'Albanian Indo-European position',
      'Balto-Slavic unity problem',
      'Phrygian Thracian Illyrian fragmentary Indo-European',
    ],
  },
  {
    id: 'homeland', weight: 2,
    label: 'Homeland and expansion',
    queries: [
      'Kurgan hypothesis Gimbutas steppe',
      'Anatolian farming hypothesis Renfrew Indo-European',
      'Yamnaya steppe ancestry Indo-European expansion',
      'Corded Ware Bell Beaker ancient DNA Europe',
      'Anthony Horse Wheel Language steppe',
      'Indo-Aryan migration debate archaeology genetics',
      'Sintashta chariot Indo-Iranian',
      'Southern Arc hypothesis Indo-European Reich',
    ],
  },
  {
    id: 'genetics', weight: 2,
    label: 'Ancient DNA and population genetics',
    queries: [
      'ancient DNA steppe ancestry Bronze Age Europe',
      'Y-chromosome R1a R1b Indo-European expansion',
      'Haak Lazaridis massive migration steppe Europe',
      'Narasimhan formation South Central Asia genomic',
      'ancient DNA Anatolia Hittite population',
      'archaeogenetics language spread correlation critique',
    ],
  },
  {
    id: 'religion', weight: 2,
    label: 'Reconstructed religion and comparative mythology',
    queries: [
      'Dumezil trifunctional hypothesis Indo-European ideology',
      'Proto-Indo-European religion reconstruction Dyeus',
      'Perkwunos thunder god Indo-European',
      'Indo-European dragon-slaying myth Watkins',
      'Watkins How to Kill a Dragon poetics',
      'Indo-European divine twins Ashvins Dioscuri',
      'Indo-European dawn goddess Hausos Eos Ushas',
      'Indo-European poetic formula imperishable fame kleos',
      'Indo-European cosmogony Manu Yemo twin sacrifice',
      'Indo-European sacred kingship horse sacrifice ashvamedha',
      'Dumezil critique trifunctionalism scholarly reception',
    ],
  },
  {
    id: 'contact', weight: 2,
    label: 'Contact with non-Indo-European: the boundary cases',
    queries: [
      'Indo-European Semitic lexical contact ancient Near East',
      'Uralic Indo-European loanword contact',
      'Etruscan non-Indo-European substrate Italy',
      'Basque pre-Indo-European Europe',
      'Afroasiatic Indo-European proposed relationship critique',
      'Sumerian Indo-European contact loanwords',
      'Hurrian Hittite contact Mitanni Indo-Aryan',
      'Mitanni Indo-Aryan superstrate horse-training treaty',
    ],
  },
  {
    id: 'writing', weight: 2,
    label: 'Scripts and the alphabet route',
    queries: [
      'Proto-Sinaitic alphabet origin Egyptian hieroglyphs',
      'Phoenician alphabet transmission to Greek Cadmus',
      'acrophonic principle alphabet origin',
      'Serabit el-Khadim inscriptions Proto-Sinaitic',
      'Ugaritic cuneiform alphabet abecedary',
      'Linear A undeciphered Minoan language',
      'Libyco-Berber script Tifinagh origins',
      'Old Italic scripts Etruscan alphabet transmission',
    ],
  },
  {
    id: 'fringe', weight: 1, contested: true,
    label: 'Deep-time proposals and their refutations — held with both sides',
    queries: [
      'Nostratic macrofamily hypothesis evidence critique',
      'Proto-World monogenesis language critique',
      'glottochronology lexicostatistics reliability critique',
      'mass comparison Greenberg methodology criticism',
      'Eurasiatic hypothesis Bomhard Dolgopolsky',
      'long-range comparison historical linguistics debate',
    ],
  },
];

export const TRACK_IDS = TRACKS.map((t) => t.id);
export const getTrack = (id) => TRACKS.find((t) => t.id === id) || null;

/** The standard reference works, named so a harvest can be checked against them. */
export const PRIMARY_REFERENCES = [
  { author: 'Pokorny, J.', work: 'Indogermanisches etymologisches Wörterbuch', year: 1959, note: 'Still the default index of roots; superseded in detail, not in coverage.' },
  { author: 'Rix, H. et al.', work: 'Lexikon der indogermanischen Verben (LIV²)', year: 2001, note: 'The verbal roots, done properly.' },
  { author: 'Mallory, J.P. & Adams, D.Q.', work: 'The Oxford Introduction to PIE and the PIE World', year: 2006, note: 'The one-volume entry point.' },
  { author: 'Watkins, C.', work: 'How to Kill a Dragon: Aspects of Indo-European Poetics', year: 1995, note: 'Where reconstructed poetics stops being hand-waving.' },
  { author: 'Benveniste, É.', work: 'Le vocabulaire des institutions indo-européennes', year: 1969, note: 'Social, legal and religious vocabulary.' },
  { author: 'Beekes, R.', work: 'Etymological Dictionary of Greek', year: 2010, note: 'Heavy on pre-Greek substrate — use with the reviews.' },
  { author: 'de Vaan, M.', work: 'Etymological Dictionary of Latin and the other Italic Languages', year: 2008 },
  { author: 'Kroonen, G.', work: 'Etymological Dictionary of Proto-Germanic', year: 2013 },
  { author: 'Anthony, D.', work: 'The Horse, the Wheel, and Language', year: 2007, note: 'The archaeological case for the steppe.' },
];

/** Every query for the selected tracks, tagged with its track. */
export function queriesFor(trackIds = TRACK_IDS) {
  const want = new Set(trackIds);
  const out = [];
  for (const t of TRACKS) {
    if (!want.has(t.id)) continue;
    for (const q of t.queries) out.push({ track: t.id, contested: !!t.contested, query: q });
  }
  return out;
}

/** A search hit turned into a corpus record. Pure — no network, easy to assert against. */
export function toRecord(hit, { track, query, contested = false, harvestedAt }) {
  return {
    kind: 'research',
    corpus: 'indo-european',
    track,
    query,
    contested,
    title: (hit.title || '').trim(),
    url: hit.url,
    snippet: hit.snippet || '',
    abstract: hit.abstract || '',
    doi: hit.doi || null,
    year: hit.year || null,
    authors: hit.authors || [],
    venue: hit.venue || null,
    cited: hit.cited ?? null,
    openAccess: hit.openAccess ?? null,
    providers: hit.providers || [],
    harvestedAt,
  };
}

/**
 * Run the harvest. Soft-fails per query: one dead provider or one bad query cannot kill a run that
 * may take hours. Returns { records, stats } with records deduped on URL across the whole run.
 */
export async function harvest({
  tracks = TRACK_IDS,
  perQuery = 12,
  throttleMs = RATE_LIMIT_MS,
  now = () => new Date().toISOString(),
  onProgress = null,
} = {}) {
  const plan = queriesFor(tracks);
  const seen = new Map();
  const stats = { queries: plan.length, ok: 0, failed: 0, byTrack: {} };

  for (let i = 0; i < plan.length; i += 1) {
    const { track, query, contested } = plan[i];
    stats.byTrack[track] = stats.byTrack[track] || { queries: 0, records: 0 };
    stats.byTrack[track].queries += 1;
    let hits = [];
    try {
      hits = await searchAll(query, { limit: perQuery });
      stats.ok += 1;
    } catch {
      stats.failed += 1;
    }
    const harvestedAt = now();
    for (const h of hits || []) {
      if (!h || !h.url || seen.has(h.url)) continue;
      seen.set(h.url, toRecord(h, { track, query, contested, harvestedAt }));
      stats.byTrack[track].records += 1;
    }
    if (onProgress) onProgress({ i: i + 1, of: plan.length, track, query, total: seen.size });
    if (throttleMs && i < plan.length - 1) await sleep(throttleMs);
  }

  return { records: [...seen.values()], stats };
}

/** JSONL, one record per line. */
export function toJsonl(records = []) {
  return records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('indo-european.mjs')) {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const out = arg('--out', '');
  const all = argv.includes('--all');
  const tracks = all ? TRACK_IDS : (arg('--tracks', '').split(',').map((s) => s.trim()).filter(Boolean));
  if (!tracks.length) {
    console.error('usage: node integrations/scrapers/indo-european.mjs --all [--out FILE] [--per 12]');
    console.error('tracks: ' + TRACK_IDS.join(', '));
    process.exit(1);
  }
  const perQuery = +arg('--per', 12);
  const { records, stats } = await harvest({
    tracks,
    perQuery,
    onProgress: ({ i, of, track, query, total }) =>
      process.stderr.write(`[${String(i).padStart(3)}/${of}] ${track.padEnd(18)} ${total.toString().padStart(5)} recs  ${query.slice(0, 58)}\n`),
  });
  const jsonl = toJsonl(records);
  if (out) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(out, jsonl);
    console.error(`\nwrote ${records.length} records to ${out}`);
  } else {
    process.stdout.write(jsonl);
  }
  console.error(JSON.stringify(stats.byTrack, null, 2));
  console.error(`queries ${stats.queries}  ok ${stats.ok}  failed ${stats.failed}  records ${records.length}`);
}
