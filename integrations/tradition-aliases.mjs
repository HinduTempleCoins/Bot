// tradition-aliases.mjs — ONE TRADITION, MANY NAMES. Search all of them or report a false absence.
//
// WHY THIS EXISTS, and it is a bug report against my own searching rather than a nice-to-have.
//
// In a single session I told the operator four times that material was missing from this repo. All
// four times it was present under a different name, and he had to correct me:
//
//   I searched          it was filed as
//   ────────────────    ──────────────────────────────────────────────────────────────────────
//   orisha              Church of the Lukumi Babalu Aye v. Hialeah — Lukumí IS the Orisha religion
//   Kamehameha          State v. Armitage — "our Constitution in the Kingdom… the Kapu system"
//   Native American     Bonnichsen / White v. Univ. of California — filed as population genetics
//     cosmology
//   Zarathustra         Zoroaster (0 hits vs 10 — the same man)
//
// The pattern is not carelessness about spelling. A tradition carries at least four different names
// and they live in different places:
//
//   ENDONYM     what practitioners call it            (Lucumí, Mazdayasna, Kanaka Maoli)
//   EXONYM      what outsiders call it                (Santería, Zoroastrianism, Hawaiian)
//   SCHOLARLY   what the literature indexes it under  (Yoruba diasporic religion)
//   LEGAL       what a court calls it                 (Church of the Lukumi Babalu Aye)
//
// A legal archive indexes by CASE NAME. A knowledge corpus indexes by SCHOLARLY name. Practitioners
// write the endonym. Searching one and reporting "not present" is a search failure being reported as
// a finding, and it costs the operator a correction every time.
//
// So this module is the expansion table, and `missingFrom()` is the thing to run BEFORE saying
// anything is absent.
//
//   import { expand, canonical, missingFrom, TRADITIONS } from './tradition-aliases.mjs'
//   node integrations/tradition-aliases.mjs orisha
//   node integrations/tradition-aliases.mjs --audit knowledge/

import { fileURLToPath } from 'node:url';

export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

/**
 * Each entry: the canonical id, then names grouped by WHERE they are used. `legal` is the field
 * most often missed, because a courtroom name looks nothing like a tradition's name.
 */
export const TRADITIONS = [
  {
    id: 'orisha',
    endonym: ['Lucumí', 'Lukumi', 'Ifá', 'Ifa', 'Òrìṣà', 'Orisa'],
    exonym: ['Santería', 'Santeria', 'Orisha', 'Orisha religion'],
    scholarly: ['Yoruba diasporic religion', 'Yoruba religion', 'Regla de Ocha', 'Candomblé', 'Candomble'],
    legal: ['Church of the Lukumi Babalu Aye', 'Lukumi Babalu Aye', 'Hialeah'],
    note: '⭐ The canonical miss. Lukumí IS the Orisha religion; the Supreme Court case is indexed under '
      + 'the church name, so a search for "orisha" in a legal archive returns nothing while a binding '
      + 'SCOTUS holding protecting Orisha ritual sits in the file.',
  },
  {
    id: 'zoroastrianism',
    endonym: ['Mazdayasna', 'Behdin'],
    exonym: ['Zoroastrianism', 'Parsi', 'Parsee', 'fire worship'],
    scholarly: ['Zoroaster', 'Zarathustra', 'Zarathushtra', 'Avesta', 'Avestan', 'Ahura Mazda', 'Bundahishn', 'Bundahišn', 'Gathas'],
    legal: [],
    note: '"Zarathustra" and "Zoroaster" are the same man — the first is the Avestan name, the second '
      + 'the Greek. In this corpus one returns nothing and the other returns ten files.',
  },
  {
    id: 'hawaiian',
    endonym: ['Kanaka Maoli', 'ʻōiwi', 'aliʻi', 'alii', 'kapu', 'Kumulipo', 'Lono', 'heiau', 'Menehune'],
    exonym: ['Hawaiian religion', 'Native Hawaiian'],
    scholarly: ['Hawaiian traditional and customary rights', 'Polynesian religion'],
    legal: ['State v. Armitage', 'Kalipi', 'PASH', 'Public Access Shoreline Hawaii', 'Ka Paʻakai', 'Ka Paakai',
      'Pele Defense Fund', 'State v. Fergerstrom', 'Newman v. Hawaii', 'Mauna Kea', 'Hanapi', 'Rice v. Cayetano'],
    note: '⭐ The operator asked for "King Kamehameha" material. The Kingdom-era religious-liberty '
      + 'language is in State v. Armitage, 132 Hawaiʻi 36 (2014) — a case name containing neither '
      + '"Kamehameha" nor "Hawaiian religion".',
  },
  {
    id: 'native-american-religion',
    endonym: ['Diné', 'Dine', 'Hopi', 'Lakota', 'Yaqui', 'Yoeme', 'huya aniya', 'Waehma'],
    exonym: ['Native American Church', 'NAC', 'peyotism', 'Indian religion'],
    scholarly: ['Indigenous North American religion', 'emergence narrative'],
    legal: ['People v. Woody', 'Employment Division v. Smith', 'Peyote Way', 'United States v. Boyll',
      'Lyng', 'Bonnichsen', 'White v. University of California', 'Native American Graves Protection',
      'NAGPRA', 'AIRFA', 'Apache Stronghold', 'Comanche Nation'],
    note: '⭐ Native American COSMOLOGY in this archive is filed as POPULATION GENETICS — Bonnichsen '
      + 'and White v. Univ. of California are NAGPRA ancestral-remains cases sitting on a page indexed '
      + '"ancestry-genetics". The cosmological question (who may say where a people came from) is '
      + 'invisible from the filename.',
  },
  {
    id: 'ayahuasca-church',
    endonym: ['União do Vegetal', 'UDV', 'Santo Daime'],
    exonym: ['ayahuasca church', 'Brazilian ayahuasca religion'],
    scholarly: ['ayahuasca', 'hoasca', 'daime'],
    legal: ['Gonzales v. O Centro', 'O Centro Espírita', 'O Centro Espirita', 'Church of the Holy Light of the Queen'],
    legalNote: 'O Centro is the RFRA anchor and is indexed by the church name, not by "ayahuasca".',
  },
  {
    id: 'shaivism',
    endonym: ['Śaiva', 'Shaiva', 'Shaivite', 'bhang', 'charas', 'prasad', 'soma'],
    exonym: ['Hinduism', 'Shaivism'],
    scholarly: ['Śaivism', 'Atharva Veda', 'Vedic', 'Purana', 'Puranic'],
    legal: ['Leary v. United States', 'Gallagher v. Dhillon'],
    note: 'The operator’s own tradition. The cannabis-sacrament argument is indexed under Woody and '
      + 'Leary, neither of which contains the word Shaivite.',
  },
  {
    id: 'witchcraft',
    endonym: ['Wicca', 'conjure', 'rootwork', 'Hoodoo'],
    exonym: ['witchcraft', 'occult', 'folk magic'],
    scholarly: ['Western esotericism', 'folk religion'],
    legal: ['Dettmer v. Landon', 'Cutter v. Wilkinson', 'Africa v. Commonwealth', 'United States v. Ballard'],
    note: 'Page ⑥ of the handwritten archive carries the bare heading "Witchcraft Religion" with no '
      + 'citation beneath it; the case law lives in a companion file under the case names.',
  },
  {
    id: 'falun-gong',
    endonym: ['Falun Dafa'],
    exonym: ['Falun Gong'],
    scholarly: ['qigong'],
    legal: ['Zhang Jingrong'],
    note: '⭐ THE COSMOLOGY CASE. Zhang Jingrong recognised Falun Gong as a religion having a '
      + '"complete Cosmology" — cosmology functioning as a legal element, which is Africa v. '
      + 'Commonwealth prong 1 doing work in a real opinion. Searching "cosmology" as a subject finds '
      + 'nothing; the holding is indexed under a party name.',
  },
  {
    id: 'phoenician',
    endonym: ['Punic', 'Canaanite', 'Melqart', 'Tanit', 'MLK', 'Carthage'],
    exonym: ['Phoenician'],
    scholarly: ['Punic', 'Levantine', 'Semitic'],
    legal: [],
    note: 'MLK / Melqart is the root the operator connects to MELEK. Corpus coverage is heavy (28 files '
      + 'mention Melqart) and none of it is under "Phoenician religion".',
  },
];

const BY_ID = new Map(TRADITIONS.map((t) => [t.id, t]));

/** Every name a tradition travels under, deduped, lowercased. */
export function expand(query) {
  const q = norm(query);
  if (!q) return [];
  const hit = TRADITIONS.find((t) => t.id === q
    || [...t.endonym, ...t.exonym, ...t.scholarly, ...t.legal].some((n) => norm(n) === q
      || norm(n).includes(q) || q.includes(norm(n))));
  if (!hit) return [q];
  const all = [hit.id, ...hit.endonym, ...hit.exonym, ...hit.scholarly, ...hit.legal];
  return [...new Set(all.map(norm))].filter(Boolean);
}

/** Which tradition a name belongs to, or null. */
export function canonical(name) {
  const n = norm(name);
  if (!n) return null;
  if (BY_ID.has(n)) return n;
  const hit = TRADITIONS.find((t) => [...t.endonym, ...t.exonym, ...t.scholarly, ...t.legal]
    .some((x) => norm(x) === n));
  return hit ? hit.id : null;
}

/** The names most often missed: the legal ones. */
export const legalNames = (id) => (BY_ID.get(norm(id)) || {}).legal || [];

/**
 * Given a set of terms already searched, report which OTHER names should have been searched.
 * This is the function to run before telling anyone something is absent.
 */
export function missingFrom(query, searched = []) {
  const want = expand(query);
  const had = new Set((Array.isArray(searched) ? searched : []).map(norm));
  const missed = want.filter((w) => !had.has(w));
  return {
    tradition: canonical(query),
    searched: [...had],
    missed,
    ok: missed.length === 0,
    advice: missed.length
      ? `Searched ${had.size} of ${want.length} names. Also search: ${missed.slice(0, 8).join(', ')}`
      : 'All known names for this tradition were searched.',
  };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'tradition-aliases',
    traditions: TRADITIONS.length,
    note: 'one tradition, many names: endonym, exonym, scholarly, legal. A legal archive indexes by '
        + 'case name; a corpus indexes by scholarly name. Search all of them before reporting absence.',
  }, null, 2));
}

export default { TRADITIONS, expand, canonical, legalNames, missingFrom, handler };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const q = process.argv[2];
  if (!q) {
    for (const t of TRADITIONS) console.log(`${t.id.padEnd(26)} ${[...t.endonym, ...t.exonym, ...t.scholarly, ...t.legal].length} names (${t.legal.length} legal)`);
  } else {
    const names = expand(q);
    console.log(`${canonical(q) || '(unknown)'} — ${names.length} names:\n  ${names.join('\n  ')}`);
  }
}
