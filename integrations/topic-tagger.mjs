// topic-tagger.mjs — PURE, deterministic, LLM-free topic classifier for the MELEK corpus.
// No network, no chain calls, no keys, no I/O, no LLM. Backlog 0d5170c932.
//
// PURPOSE (read before changing the lexicon):
//   The itinerary asks for "Categorize by topic" and "Topic interest tracking
//   (mythology, religion, archaeology, esoteric, genetics, philosophy)". This module maps a
//   chunk of free text onto the MELEK corpus topics using a FROZEN keyword lexicon. It is the
//   domain-specific complement to tools/categorize.mjs:
//     - tools/categorize.mjs  is a general OPS bucketer (cheetah/trade/infra/signer/...) that
//                             picks ONE winning folder for an annal/brief.
//     - topic-tagger          is a CORPUS interest tagger: it returns ALL matching subject
//                             topics with per-topic scores and the exact terms that matched, so
//                             a reader/curator can track which corpus subjects a text touches.
//   Different lexicon, different question, multi-label output.
//
// MATCHING:
//   - case-insensitive
//   - word-boundary (a keyword matches only as a whole token, so "art" does not hit "earth";
//     multi-word phrases like "near death" match across a single space run)
//   - term-frequency weighted: each occurrence of a keyword adds 1 to that topic's score
//   - hits records the distinct matched terms (lower-cased) for explainability
//
// SOFT-FAIL, NEVER THROW: empty / null / non-string / no-signal input collapses to [].
//   The functions always return a well-formed value.
//
//   import { TOPICS, tagTopics, topTopic, allTopicsAbove } from './integrations/topic-tagger.mjs';
//   tagTopics('Osiris and the resurrection myth')  // -> [{topic:'mythology',...}, {topic:'religion',...}]
//   topTopic('haplogroup R1b ancient DNA')          // -> 'genetics'
//   allTopicsAbove(text, 2)                          // -> ['religion', ...]
//
// CLI:  node integrations/topic-tagger.mjs "your text here"   # print ranked topics

// ── FROZEN domain lexicon ───────────────────────────────────────────────────────────────────────
// Keywords are lower-case tokens or phrases. Order of topics here is the deterministic tie-break.
// Frozen on construction (Object.freeze) so callers cannot mutate the corpus contract at runtime.
export const TOPICS = Object.freeze({
  mythology: Object.freeze([
    'myth', 'mythology', 'mythos', 'legend', 'folklore', 'pantheon', 'deity', 'goddess', 'god',
    'hero', 'titan', 'olympus', 'osiris', 'isis', 'hathor', 'horus', 'zeus', 'odin', 'dragon',
    'creation myth', 'flood myth', 'underworld',
  ]),
  religion: Object.freeze([
    'religion', 'religious', 'faith', 'worship', 'prayer', 'scripture', 'gospel', 'biblical',
    'bible', 'church', 'temple', 'priest', 'prophet', 'salvation', 'divine', 'sacred', 'holy',
    'angel', 'angelic', 'theology', 'theological', 'liturgy', 'sacrament', 'covenant',
  ]),
  archaeology: Object.freeze([
    'archaeology', 'archaeological', 'archaeologist', 'excavation', 'excavate', 'artifact',
    'artefact', 'dig site', 'ruins', 'stratigraphy', 'potsherd', 'tomb', 'megalith', 'tumulus',
    'inscription', 'carbon dating', 'radiocarbon', 'antiquity', 'ancient site', 'necropolis',
  ]),
  esoteric: Object.freeze([
    'esoteric', 'occult', 'mysticism', 'mystical', 'hermetic', 'gnostic', 'gnosis', 'alchemy',
    'alchemical', 'kabbalah', 'tarot', 'astrology', 'ritual', 'initiation', 'egregore',
    'theosophy', 'arcane', 'sigil', 'divination', 'mystery school',
  ]),
  genetics: Object.freeze([
    'genetics', 'genetic', 'genome', 'genomic', 'dna', 'rna', 'chromosome', 'allele', 'gene',
    'haplogroup', 'haplotype', 'mutation', 'heredity', 'hereditary', 'phenotype', 'genotype',
    'ancient dna', 'crispr', 'sequencing', 'lineage', 'ancestry',
  ]),
  philosophy: Object.freeze([
    'philosophy', 'philosophical', 'philosopher', 'metaphysics', 'metaphysical', 'epistemology',
    'ontology', 'ethics', 'ethical', 'logic', 'dialectic', 'consciousness', 'existential',
    'phenomenology', 'stoic', 'stoicism', 'platonic', 'aristotelian', 'free will', 'reason',
  ]),
});

const TOPIC_ORDER = Object.freeze(Object.keys(TOPICS));

// Escape a string for safe use inside a regex.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary, global, case-insensitive matcher for a keyword/phrase.
// Whitespace in a phrase is treated as "one or more whitespace" so "near death" tolerates runs.
function termRegex(term) {
  const body = escapeRegex(term).replace(/\\?\s+/g, '\\s+');
  return new RegExp(`\\b${body}\\b`, 'gi');
}

// Count non-overlapping occurrences of term in text (already word-boundary anchored).
function countTerm(text, term) {
  const re = termRegex(term);
  let n = 0;
  while (re.exec(text) !== null) {
    n++;
    if (re.lastIndex === 0) break; // safety: never loop forever on a zero-width match
  }
  return n;
}

/**
 * Tag free text against the frozen corpus lexicon.
 * @returns Array<{topic, score, hits:string[]}> sorted by score desc (TOPIC_ORDER breaks ties).
 *          Topics with zero matches are omitted. Bad input -> [].
 */
export function tagTopics(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const haystack = text.toLowerCase();
  const out = [];
  for (const topic of TOPIC_ORDER) {
    let score = 0;
    const hits = [];
    for (const term of TOPICS[topic]) {
      const c = countTerm(haystack, term);
      if (c > 0) {
        score += c;
        hits.push(term);
      }
    }
    if (score > 0) out.push({ topic, score, hits });
  }
  // Stable sort by score desc; ties keep TOPIC_ORDER (out is already built in that order).
  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.score - a.r.score) || (a.i - b.i))
    .map(({ r }) => r);
}

/** Highest-scoring topic for the text, or null when nothing matches / bad input. */
export function topTopic(text) {
  const ranked = tagTopics(text);
  return ranked.length ? ranked[0].topic : null;
}

/**
 * All topic names scoring strictly above threshold, in ranked order.
 * @param {number} threshold default 0 (i.e. any positive match). Bad input -> [].
 */
export function allTopicsAbove(text, threshold = 0) {
  const min = Number.isFinite(threshold) ? threshold : 0;
  return tagTopics(text).filter((r) => r.score > min).map((r) => r.topic);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('topic-tagger.mjs')) {
  const input = process.argv.slice(2).join(' ');
  if (!input) {
    console.error('usage: node integrations/topic-tagger.mjs "text to classify"');
    process.exit(1);
  }
  const ranked = tagTopics(input);
  if (!ranked.length) {
    console.log('(no corpus topics matched)');
  } else {
    console.log('Ranked corpus topics:');
    for (const { topic, score, hits } of ranked) {
      console.log(`  ${topic.padEnd(12)} ${String(score).padStart(3)}  [${hits.join(', ')}]`);
    }
    console.log(`\ntop: ${ranked[0].topic}`);
  }
}
