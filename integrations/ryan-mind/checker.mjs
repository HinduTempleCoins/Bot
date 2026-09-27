// ryan-mind/checker.mjs — pluggable CHECKERS. A checker never corrects the operator. It does two jobs:
//   1. supplies MAINSTREAM CONTEXT for a claim (what tradition / scholarship says), so a deliberate
//      divergence is recorded as "diverges_from_consensus" with the mainstream view alongside;
//   2. flags PROBABLE SLIPS — a simple fact stated differently from tradition — into the review queue,
//      with where else in his own corpus he stated it the traditional way ("said X here, Y elsewhere").
// Consensus NEVER supersedes an operator claim. Only a later statement of his own can do that.
//
// Checker contract:
//   { name, async check(claim) -> { ok, stance: 'agrees'|'differs'|'none', kind: 'fact'|'identification'|null,
//                                    mainstream: [{text, source}], said?, tradition_says?, elsewhere?: [{title, source, text}] } }
//
// hierophantChecker() is the default adapter over the Hierophant's own data: the pantheon modules in
// knowledge/*-pantheon.mjs (entities + interpretatio identifications), a small editable table of
// consensus facts, and integrations/corpus-rag.mjs retrieval over the operator's own corpus (for the
// "elsewhere" half of a slip). Every input is injectable so tests run on fixtures, offline.

// ── built-in mainstream data (public classical references; editable/overridable per data dir) ──────────
export const CONSENSUS_FACTS = [
  { subject: 'Zeus', predicate: 'birthplace', cues: ['born', 'birthplace', 'birth', 'nursed', 'raised'], value: 'Crete', alternatives: ['Cretan', 'Mount Ida', 'Dikte', 'Dicte', 'Lyctus', 'Arcadia'], source: 'Hesiod, Theogony 477-484 (Rhea bears Zeus in Lyctus, Crete); Callimachus, Hymn 1 gives Arcadia' },
  { subject: 'Apollo', predicate: 'birthplace', cues: ['born', 'birthplace', 'birth'], value: 'Delos', alternatives: ['Ortygia'], source: 'Homeric Hymn to Delian Apollo 25-126' },
  { subject: 'Artemis', predicate: 'birthplace', cues: ['born', 'birthplace', 'birth'], value: 'Ortygia', alternatives: ['Delos'], source: 'Homeric Hymn to Apollo 16; Callimachus, Hymn 4' },
  { subject: 'Hermes', predicate: 'birthplace', cues: ['born', 'birthplace', 'birth'], value: 'Cyllene', alternatives: ['Kyllene', 'Arcadia'], source: 'Homeric Hymn to Hermes 1-7' },
  { subject: 'Athena', predicate: 'birth', cues: ['born', 'birth', 'sprang', 'emerged'], value: 'head', alternatives: ['forehead', 'brow'], source: 'Hesiod, Theogony 924-926' },
];

// Mainstream (ancient-attested) identifications between gods of different traditions. A claim that
// equates two entities NOT paired here diverges from consensus — that is a held position, not an error.
export const IDENTIFICATIONS = [
  ['Osiris', 'Dionysus', 'Herodotus 2.42, 2.144'],
  ['Isis', 'Demeter', 'Herodotus 2.59'],
  ['Horus', 'Apollo', 'Herodotus 2.144, 2.156'],
  ['Wadjet', 'Leto', 'Herodotus 2.155-156 (the oracle of "Leto" at Buto / Per-Wadjet)'],
  ['Thoth', 'Hermes', 'interpretatio graeca — Hermopolis Magna; Plato, Phaedrus 274c-d (Theuth)'],
];

export const EXTRA_ENTITIES = [
  { name: 'Wadjet', tradition: 'egyptian', summary: 'cobra goddess of Lower Egypt, patron of Buto (Per-Wadjet); the uraeus', source: 'Pyramid Texts; Herodotus 2.155-156' },
  { name: 'Theia', tradition: 'greek', summary: 'Titaness, daughter of Gaia and Uranus; by Hyperion mother of Helios, Selene and Eos', source: 'Hesiod, Theogony 135, 371-374' },
];

function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function mentions(text, word) { return new RegExp(`\\b${esc(word)}\\b`, 'i').test(text); }

/** Load the Hierophant's pantheon modules into a flat entity list. Soft-fails to []. */
export async function loadPantheonEntities(importer = (p) => import(p)) {
  const out = [];
  const tries = [
    ['../../knowledge/greek-pantheon.mjs', 'greek'], ['../../knowledge/egyptian-pantheon.mjs', 'egyptian'],
    ['../../knowledge/roman-pantheon.mjs', 'roman'], ['../../knowledge/mesopotamian-pantheon.mjs', 'mesopotamian'],
  ];
  for (const [p, tradition] of tries) {
    try {
      const m = await importer(new URL(p, import.meta.url).href);
      const list = m.DEITIES || m.PANTHEON || [];
      for (const d of list) {
        const names = String(d.name || '').split(/\s*\/\s*/).concat([d.sumerianName, d.akkadianName].filter(Boolean));
        for (const n of new Set(names)) if (n) out.push({ name: n, tradition, aliases: names.filter((x) => x && x !== n), summary: d.domain || d.summary || '', source: d.source || `${tradition}-pantheon.mjs`, equivalent: d.greekEquivalent || null });
      }
    } catch { /* module missing → skip */ }
  }
  return out;
}

/** Is pair (a,b) a mainstream identification (interpretatio / alias / listed pair)? */
export function mainstreamPair(a, b, entities, identifications = IDENTIFICATIONS) {
  const A = a.toLowerCase(), B = b.toLowerCase();
  for (const [x, y, src] of identifications) { const X = x.toLowerCase(), Y = y.toLowerCase(); if ((X === A && Y === B) || (X === B && Y === A)) return src; }
  for (const e of entities) {
    const n = e.name.toLowerCase();
    if (n === A && (e.equivalent?.toLowerCase() === B || e.aliases?.some((x) => x.toLowerCase() === B))) return e.source;
    if (n === B && (e.equivalent?.toLowerCase() === A || e.aliases?.some((x) => x.toLowerCase() === A))) return e.source;
  }
  return null;
}

// the WHOLE gap between two entity names must be an equating connector ("Wadjet = Theia", "Thoth is Hermes")
const EQUATE_RE = /^[\s,'"()*]*(?:=|≡|→|\/|is|was|are|were|(?:is|was) (?:the same as|identical (?:to|with)|really|actually)|identified (?:with|as)|equals|also known as|aka|i\.e\.,?|called)[\s,'"()*]*(?:the\s+)?(?:titaness\s+|titan\s+|goddess\s+|god\s+)?$/i;

/**
 * Detect "X = Y" identifications between known entities in a claim. Returns [{a, b, mainstream_source|null}].
 */
export function findIdentifications(text, entities, identifications = IDENTIFICATIONS) {
  const t = String(text);
  const hits = [];
  for (const e of entities) {
    const re = new RegExp(`\\b(?:${esc(e.name)}|${esc(e.name.toUpperCase())})\\b`, 'g'); let m;
    while ((m = re.exec(t))) hits.push({ name: e.name, start: m.index, end: m.index + m[0].length });
  }
  hits.sort((x, y) => x.start - y.start);
  const out = [];
  for (let i = 0; i < hits.length - 1; i++) {
    const a = hits[i], b = hits[i + 1];
    if (a.name.toLowerCase() === b.name.toLowerCase()) continue;
    const gap = t.slice(a.end, b.start);
    if (gap.length > 40 || !EQUATE_RE.test(gap) || /\b(not|never|no)\b/i.test(gap)) continue; // "Wadjet is not Leto" is a denial, not an identification
    out.push({ a: a.name, b: b.name, mainstream_source: mainstreamPair(a.name, b.name, entities, identifications) });
  }
  return out;
}

/** Fact check against the consensus table. Returns null when the claim does not touch a known fact. */
export function checkFact(text, facts = CONSENSUS_FACTS) {
  const t = String(text);
  for (const f of facts) {
    if (!mentions(t, f.subject) || !f.cues.some((c) => new RegExp(`\\b${esc(c)}`, 'i').test(t))) continue;
    const agrees = [f.value, ...(f.alternatives || [])].some((v) => mentions(t, v));
    return { fact: f, stance: agrees ? 'agrees' : 'differs' };
  }
  return null;
}

/**
 * Build the Hierophant checker.
 * @param {{entities?:Array, facts?:Array, identifications?:Array, retrieve?:Function, loadEntities?:Function}} opts
 *   retrieve(question) -> [{title, source, passage}] over the operator's own corpus (default: corpus-rag).
 */
export function hierophantChecker(opts = {}) {
  let entities = opts.entities || null;
  const facts = opts.facts || CONSENSUS_FACTS;
  const identifications = opts.identifications || IDENTIFICATIONS;
  let retrieve = opts.retrieve === undefined ? null : opts.retrieve;
  const ensure = async () => {
    if (!entities) entities = [...(await (opts.loadEntities || loadPantheonEntities)()), ...EXTRA_ENTITIES];
    if (retrieve === null && opts.retrieve === undefined) {
      try { const m = await import('../corpus-rag.mjs'); retrieve = (q) => m.retrieve(q, { topK: 5 }); } catch { retrieve = () => []; }
    }
  };
  const describe = (name) => {
    const e = entities.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return e ? { text: `${e.name} (${e.tradition}): ${e.summary}`, source: e.source } : null;
  };
  return {
    name: 'hierophant',
    async check(claim) {
      try {
        await ensure();
        const text = claim?.text || '';
        const fc = checkFact(text, facts);
        if (fc) {
          const f = fc.fact;
          const res = { ok: true, stance: fc.stance, kind: 'fact', fact: { subject: f.subject, predicate: f.predicate, value: f.value, alternatives: f.alternatives || [] }, mainstream: [{ text: `${f.subject} — ${f.predicate}: ${f.value}`, source: f.source }] };
          if (fc.stance === 'differs') {
            res.said = claim.quote || text;
            res.tradition_says = `${f.subject} — ${f.predicate}: ${f.value} (${f.source})`;
            let passages = [];
            try { passages = (await retrieve(`${f.subject} ${f.cues[0]} ${f.value}`)) || []; } catch { passages = []; }
            res.elsewhere = passages.filter((p) => mentions(p.passage || p.text || '', f.subject) && [f.value, ...(f.alternatives || [])].some((v) => mentions(p.passage || p.text || '', v)))
              .slice(0, 3).map((p) => ({ title: p.title, source: p.source, text: String(p.passage || p.text || '').slice(0, 300) }));
          }
          return res;
        }
        const ids = findIdentifications(text, entities, identifications);
        if (ids.length) {
          const diverging = ids.filter((x) => !x.mainstream_source);
          const mainstream = [];
          for (const x of ids) for (const n of [x.a, x.b]) { const d = describe(n); if (d && !mainstream.some((m) => m.text === d.text)) mainstream.push(d); }
          // what tradition DOES identify each diverging entity with (e.g. Wadjet ~ Leto per Herodotus)
          for (const x of diverging) for (const n of [x.a, x.b]) for (const [p, q, src] of identifications) {
            if (p.toLowerCase() === n.toLowerCase() || q.toLowerCase() === n.toLowerCase()) mainstream.push({ text: `mainstream identification: ${p} = ${q}`, source: src });
          }
          return { ok: true, stance: diverging.length ? 'differs' : 'agrees', kind: 'identification', identifications: ids, mainstream };
        }
        return { ok: true, stance: 'none', kind: null, mainstream: [] };
      } catch (e) { return { ok: false, stance: 'none', kind: null, mainstream: [], reason: String(e?.message || e) }; }
    },
  };
}
