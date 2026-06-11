// swedenborg-correspondences.mjs — a compact, frozen, sourced table of Swedenborgian
// "correspondences" (a natural symbol -> its inner spiritual meaning), for the book-library /
// Crypt-ology esoteric-topic enrichment (backlog d504603ec8).
//
// Hand-curated public-domain doctrinal facts. Emanuel Swedenborg's theological works are firmly
// out of copyright: all source works cited here are pre-1772 (Arcana Coelestia, 1749–1756; Heaven
// and Hell / "De Caelo et Inferno", 1758; Earths in the Universe / "De Telluribus", 1758). His
// "science of correspondences" holds that every natural object answers to an interior spiritual
// reality; this module is a modest, CLEARLY-EXTENSIBLE seed of that table — enter more by hand from
// the same public-domain texts, no scraping.
//
// Sibling in spirit to knowledge/*-pantheon.mjs: everything is local, static, and frozen. There is
// no network call, no remote reader, and no live dependency. DISTINCT from
// integrations/knowledge-graph.mjs (a remote reader); here all data is in-file.
//
// PURE / deterministic. No network, no LLM, no secrets, soft-fail everywhere (never throws). CLI
// guarded by process.argv[1]. Every render path HTML-escapes its interpolated fields.
//
//   import { CORRESPONDENCES, lookup, search, byTheme, toMarkdown } from './swedenborg-correspondences.mjs'
//   node knowledge/swedenborg-correspondences.mjs              # print the full Markdown table
//   node knowledge/swedenborg-correspondences.mjs water        # lookup a single term
//   node knowledge/swedenborg-correspondences.mjs --search sun # substring search of term/meaning

// --- HTML escape (single local copy; identical behavior to the engine's esc) ----------------
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- static data: a seed set of Swedenborgian correspondences -------------------------------
//
// Each entry: { term, meaning, source, ref, theme }.
//   term    — the natural object/symbol (the "correspondent")
//   meaning — its inner spiritual signification, per the doctrine
//   source  — the public-domain work it is drawn from (pre-1772, PD provenance)
//   ref     — the specific section/number within that work (provenance pointer)
//   theme   — a coarse grouping for byTheme()
// Frozen (deep) so callers cannot mutate the shared corpus. This is a SEED — extensible by adding
// further hand-entered entries from the same public-domain works.
function freezeEntry(e) {
  return Object.freeze({
    term: e.term,
    meaning: e.meaning,
    source: e.source,
    ref: e.ref,
    theme: e.theme,
  });
}

export const CORRESPONDENCES = Object.freeze(
  [
    {
      term: 'Sun',
      meaning: 'the Lord as to Divine Love; the source of all spiritual heat and life in heaven',
      source: 'Heaven and Hell',
      ref: 'n. 116–125',
      theme: 'celestial',
    },
    {
      term: 'Moon',
      meaning: 'faith from the Lord, the light of truth received where love is dim',
      source: 'Heaven and Hell',
      ref: 'n. 118',
      theme: 'celestial',
    },
    {
      term: 'Light',
      meaning: 'Divine truth; the understanding illumined by it',
      source: 'Heaven and Hell',
      ref: 'n. 126–140',
      theme: 'celestial',
    },
    {
      term: 'Heat',
      meaning: 'Divine love; the affection of good felt as warmth of life',
      source: 'Heaven and Hell',
      ref: 'n. 126–140',
      theme: 'celestial',
    },
    {
      term: 'Water',
      meaning: 'truth, and the things of faith; in the contrary sense, falsity',
      source: 'Arcana Coelestia',
      ref: 'n. 2702',
      theme: 'nature',
    },
    {
      term: 'Fire',
      meaning: 'celestial love and the good of love; in the contrary sense, the lusts of self-love',
      source: 'Arcana Coelestia',
      ref: 'n. 934',
      theme: 'nature',
    },
    {
      term: 'Stone',
      meaning: 'truth in the natural degree; the truths of faith on which the church is built',
      source: 'Arcana Coelestia',
      ref: 'n. 643',
      theme: 'nature',
    },
    {
      term: 'Mountain',
      meaning: 'the good of love; the height of celestial things and worship from love',
      source: 'Arcana Coelestia',
      ref: 'n. 795',
      theme: 'nature',
    },
    {
      term: 'Garden',
      meaning: 'intelligence and wisdom; the things of the understanding planted by the Lord',
      source: 'Arcana Coelestia',
      ref: 'n. 100',
      theme: 'nature',
    },
    {
      term: 'Tree',
      meaning: 'man as to his perceptions and knowledges; the regenerate person bearing fruit',
      source: 'Arcana Coelestia',
      ref: 'n. 103',
      theme: 'nature',
    },
    {
      term: 'Bread',
      meaning: 'the good of love, all celestial nourishment that sustains the inner life',
      source: 'Arcana Coelestia',
      ref: 'n. 276',
      theme: 'sustenance',
    },
    {
      term: 'Wine',
      meaning: 'the truth of faith and spiritual good drawn from love',
      source: 'Arcana Coelestia',
      ref: 'n. 1071',
      theme: 'sustenance',
    },
    {
      term: 'Garment',
      meaning: 'truths that clothe and present the goods of the inner man',
      source: 'Arcana Coelestia',
      ref: 'n. 297',
      theme: 'human',
    },
    {
      term: 'Eye',
      meaning: 'the understanding; the sight of the mind that perceives truth',
      source: 'Arcana Coelestia',
      ref: 'n. 2701',
      theme: 'human',
    },
    {
      term: 'Heart',
      meaning: "the will and its love; the seat of the affections of good",
      source: 'Heaven and Hell',
      ref: 'n. 95',
      theme: 'human',
    },
    {
      term: 'Lungs',
      meaning: 'the understanding and the truths of faith, corresponding to respiration',
      source: 'Heaven and Hell',
      ref: 'n. 95',
      theme: 'human',
    },
    {
      term: 'Dove',
      meaning: 'the goods and truths of faith in the regenerate person',
      source: 'Arcana Coelestia',
      ref: 'n. 870',
      theme: 'creature',
    },
    {
      term: 'Serpent',
      meaning: 'the sensual and lowest things of man; in the contrary sense, cunning and the love of self',
      source: 'Arcana Coelestia',
      ref: 'n. 195',
      theme: 'creature',
    },
    {
      term: 'Lamb',
      meaning: 'innocence and the good of innocence',
      source: 'Arcana Coelestia',
      ref: 'n. 3994',
      theme: 'creature',
    },
    {
      term: 'Horse',
      meaning: 'the intellectual principle; the understanding of the Word',
      source: 'Arcana Coelestia',
      ref: 'n. 2761',
      theme: 'creature',
    },
  ].map(freezeEntry),
);

// --- internal index: lowercase term -> frozen entry -----------------------------------------
const BY_TERM = Object.freeze(
  CORRESPONDENCES.reduce((acc, e) => {
    acc[e.term.toLowerCase()] = e;
    return acc;
  }, Object.create(null)),
);

// --- lookup(term) -> entry | null (case-insensitive, trims, soft-fail) ----------------------
export function lookup(term) {
  const key = String(term ?? '').trim().toLowerCase();
  if (!key) return null;
  return BY_TERM[key] ?? null;
}

// --- search(query) -> entries whose term OR meaning includes the query (case-insensitive) ---
//
// An empty/whitespace query returns []. Order follows corpus order, so the result is stable.
export function search(query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  return CORRESPONDENCES.filter(
    (e) =>
      e.term.toLowerCase().includes(q) || e.meaning.toLowerCase().includes(q),
  );
}

// --- byTheme(theme) -> entries in that theme (case-insensitive, exact theme match) ----------
export function byTheme(theme) {
  const t = String(theme ?? '').trim().toLowerCase();
  if (!t) return [];
  return CORRESPONDENCES.filter((e) => e.theme.toLowerCase() === t);
}

// --- toMarkdown(entries) -> a readable, deterministic table ---------------------------------
//
// Defaults to the full corpus. Every interpolated cell is esc()'d. A non-array argument soft-fails
// to an empty table body rather than throwing.
export function toMarkdown(entries = CORRESPONDENCES) {
  const rows = Array.isArray(entries) ? entries : [];
  const lines = [];
  lines.push('# Swedenborg — Correspondences');
  lines.push('');
  lines.push(
    '*A natural symbol and its inner spiritual meaning, hand-curated from Emanuel ' +
      'Swedenborg’s public-domain works (Arcana Coelestia; Heaven and Hell; Earths in the ' +
      'Universe — all pre-1772). A seed set; extensible.*',
  );
  lines.push('');
  lines.push('| Term | Spiritual meaning | Source | Ref |');
  lines.push('| --- | --- | --- | --- |');
  for (const e of rows) {
    lines.push(
      `| ${esc(e?.term)} | ${esc(e?.meaning)} | ${esc(e?.source)} | ${esc(e?.ref)} |`,
    );
  }
  // Trim trailing blank lines for a stable, newline-terminated document.
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

// --- CLI (guarded; pure stdout) -------------------------------------------------------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log(toMarkdown());
  } else if (args[0] === '--search' || args[0] === '-s') {
    const q = args.slice(1).join(' ');
    const hits = search(q);
    if (!hits.length) {
      console.log(`no correspondences match: ${q}`);
    } else {
      for (const e of hits) {
        console.log(`${e.term} — ${e.meaning}  [${e.source} ${e.ref}]`);
      }
    }
  } else {
    const term = args.join(' ');
    const e = lookup(term);
    if (!e) {
      const known = CORRESPONDENCES.map((x) => x.term).join(', ');
      console.log(`unknown term: ${term}\nknown terms: ${known}`);
    } else {
      console.log(`${e.term} — ${e.meaning}`);
      console.log(`theme:  ${e.theme}`);
      console.log(`source: ${e.source} ${e.ref}`);
    }
  }
}
