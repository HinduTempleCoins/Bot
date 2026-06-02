// sources.mjs — a curated seed list of public esoteric / mythology corpora for the Book Memory
// System (RAG). The two anchor sites are old, static, hand-built HTML — no JS, no paywall, no
// auth, friendly robots — which makes them ideal for the scraper's keyless fetchClean() path:
// one GET → clean text. They are large reference indexes, so ingestion walks them page-by-page
// (an index page lists the chapter/section URLs; you ingest those leaf pages).
//
//   import { SEEDS, seedsFor, allSeedUrls } from './sources.mjs'
//
// NOTE ON POLITENESS: both sites are run by small non-profits / hobbyists on modest hosting.
// booklore.mjs spaces fetches out (POLITE_DELAY_MS) and caches aggressively. Ingest a handful of
// leaf pages at a time, not the whole tree in one burst.

// sacred-texts.com — John Bruno Hare's public-domain religion/esoterica archive (since 1999).
// Static HTML, predictable per-tradition index pages. Each index links the individual texts.
export const SACRED_TEXTS = {
  host: 'sacred-texts.com',
  note: 'Public-domain religion, mythology, folklore & esoterica. Plain static HTML. NOTE: the host 403s default/bot user-agents on a direct fetch, but fetchClean reaches it via Jina Reader (server-side), so ingest works. Walk a tradition index, then ingest the leaf chapter pages. Dead links serve a 200 "404: file not found" page — ingest() detects and skips those.',
  indexes: [
    { title: 'Main index (all traditions)', url: 'https://sacred-texts.com/index.htm' },
    { title: 'Esoteric & Occult', url: 'https://sacred-texts.com/eso/index.htm' },
    { title: 'Hinduism', url: 'https://sacred-texts.com/hin/index.htm' },
    { title: 'Egyptian', url: 'https://sacred-texts.com/egy/index.htm' },
    { title: 'Ancient Near East', url: 'https://sacred-texts.com/ane/index.htm' },
    { title: 'Classics (Greek/Roman)', url: 'https://sacred-texts.com/cla/index.htm' },
    { title: 'Mysticism', url: 'https://sacred-texts.com/myst/index.htm' },
    { title: 'Astrology', url: 'https://sacred-texts.com/astro/index.htm' },
    { title: 'Alchemy', url: 'https://sacred-texts.com/alc/index.htm' },
    { title: 'Tarot', url: 'https://sacred-texts.com/tarot/index.htm' },
    { title: 'Gnosticism & the Gnostic Gospels', url: 'https://sacred-texts.com/gno/index.htm' },
    { title: 'Sacred Sexuality', url: 'https://sacred-texts.com/sex/index.htm' },
    { title: 'Comparative / Mythology & Folklore', url: 'https://sacred-texts.com/etc/index.htm' },
  ],
};

// theoi.com — the Theoi Project, an exhaustively cross-referenced encyclopedia of Greek mythology
// quoting the primary classical sources (Hesiod, Homer, Ovid, etc.). Static HTML, deep index pages.
export const THEOI = {
  host: 'theoi.com',
  note: 'Greek mythology encyclopedia quoting primary classical texts. Static HTML. The Cult/Gallery/Genealogy index pages link the individual deity/figure pages — ingest those leaf pages.',
  indexes: [
    { title: 'Greek Mythology home', url: 'https://www.theoi.com/' },
    { title: 'Greek Gods index', url: 'https://www.theoi.com/greek-mythology/greek-gods.html' },
    { title: 'Olympian Gods', url: 'https://www.theoi.com/greek-mythology/olympian-gods.html' },
    { title: 'Titans', url: 'https://www.theoi.com/greek-mythology/titans.html' },
    { title: 'Nymphs', url: 'https://www.theoi.com/greek-mythology/nymphs.html' },
    { title: 'Bestiary (Fabulous Creatures)', url: 'https://www.theoi.com/greek-mythology/bestiary.html' },
    { title: 'Heroes & Heroines', url: 'https://www.theoi.com/greek-mythology/heroes.html' },
    { title: 'Personifications (Daimones)', url: 'https://www.theoi.com/greek-mythology/personifications.html' },
    { title: 'Classical Texts Library', url: 'https://www.theoi.com/Library.html' },
  ],
};

export const SEEDS = { sacredTexts: SACRED_TEXTS, theoi: THEOI };

/** Look up a seed bundle by host or short key (e.g. 'theoi', 'sacred-texts.com'). */
export function seedsFor(key = '') {
  const k = String(key).toLowerCase();
  for (const bundle of Object.values(SEEDS)) {
    if (bundle.host === k || bundle.host.split('.')[0] === k || k.includes(bundle.host.split('.')[0])) {
      return bundle;
    }
  }
  return null;
}

/** Flat list of every seed index URL (handy for a "what can I ingest?" listing). */
export function allSeedUrls() {
  return Object.values(SEEDS).flatMap((b) => b.indexes.map((i) => ({ host: b.host, ...i })));
}
