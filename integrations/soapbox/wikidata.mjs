// wikidata.mjs — a keyless reader over Wikidata, the structured-knowledge graph behind Wikipedia.
// Where scraper.mjs/grounding-sources.mjs reach Wikidata only for a SEARCH HIT (label + link), this
// module pulls the STRUCTURED CLAIMS: instance-of, country, date of birth, etc. — the machine-readable
// facts an entity actually carries — plus an escape hatch to run arbitrary SPARQL. That gives the
// Library / Cheetah / fact-checker (and the site) a way to ask "what does the knowledge graph KNOW
// about this entity," not just "is there a page."
//
// Two endpoints, both keyless (Wikidata data is CC0 — public domain). A descriptive User-Agent is
// required by Wikimedia policy on every request:
//   www.wikidata.org/w/api.php   — wbsearchentities (find QIDs), wbgetentities (claims/labels)
//   query.wikidata.org/sparql    — the SPARQL endpoint (JSON results)
//
// Conventions (mirror macro.mjs / datagov-catalog.mjs):
//   • ESM, injectable fetch (__setFetch), keyless (NO secrets), proper UA header,
//   • SOFT-FAILS to [] / null on any error, non-ok response, or bad shape — NEVER throws,
//   • escapes ALL source-controlled text before HTML, stamps an as-of date in dataNote().
//
//   import { searchEntities, entityFacts, sparql, factsAbout,
//            renderPage, dataNote, escapeHtml } from './wikidata.mjs'
//   node integrations/soapbox/wikidata.mjs search "marie curie"
//   node integrations/soapbox/wikidata.mjs facts Q7186

const API = 'https://www.wikidata.org/w/api.php';
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
// Wikimedia asks for a descriptive UA that identifies the tool + a contact. Sent on every request.
const UA = 'SoapBoxData/1.0 (+https://data.soapbox.community)';

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const clampInt = (v, lo, hi, dflt) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
};

// Escape source-controlled text before it lands in HTML. Mirrors the project convention.
export function escapeHtml(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The common, human-meaningful properties we resolve into readable facts. Keeping a curated set means
// entityFacts() returns the few claims a person cares about instead of hundreds of raw P-codes. The
// value for each is rendered from the claim's datavalue (see readClaimValue): item refs become QIDs we
// resolve to labels in a single follow-up wbgetentities call; time/quantity/string render inline.
export const COMMON_PROPS = {
  P31: 'instance of',
  P279: 'subclass of',
  P17: 'country',
  P27: 'country of citizenship',
  P21: 'sex or gender',
  P569: 'date of birth',
  P570: 'date of death',
  P19: 'place of birth',
  P20: 'place of death',
  P106: 'occupation',
  P39: 'position held',
  P50: 'author',
  P57: 'director',
  P136: 'genre',
  P495: 'country of origin',
  P571: 'inception',
  P159: 'headquarters location',
  P112: 'founded by',
  P625: 'coordinate location',
  P856: 'official website',
};

// Properties whose values are item references (QIDs) we want to resolve to labels for readability.
const ITEM_PROPS = new Set([
  'P31', 'P279', 'P17', 'P27', 'P21', 'P19', 'P20', 'P106', 'P39',
  'P50', 'P57', 'P136', 'P495', 'P159', 'P112',
]);

// GET the Wikidata Action API. Returns parsed JSON, or null on any failure. Never throws.
async function api(params) {
  try {
    const p = new URLSearchParams({ format: 'json', origin: '*' });
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') p.set(k, String(v));
    }
    const r = await _fetch(`${API}?${p.toString()}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    if (!j || j.error) return null;
    return j;
  } catch { return null; }
}

// ── searchEntities ───────────────────────────────────────────────────────────────────────────────
/**
 * Find entities matching free text via wbsearchentities.
 *   searchEntities('marie curie', { limit = 7, language = 'en' })
 * Returns [{ id, label, description }], soft-fails to [].
 */
export async function searchEntities(query, { limit = 7, language = 'en' } = {}) {
  const q = str(query);
  if (!q) return [];
  const j = await api({
    action: 'wbsearchentities',
    search: q,
    language,
    uselang: language,
    limit: clampInt(limit, 1, 50, 7),
  });
  const rows = Array.isArray(j?.search) ? j.search : [];
  return rows
    .map((e) => ({ id: str(e?.id), label: str(e?.label) || str(e?.id), description: str(e?.description) }))
    .filter((e) => e.id);
}

// Render a single claim's mainsnak into a human string, plus the QID it references (if any) so the
// caller can resolve it to a label later. Returns null for novalue/somevalue/unknown shapes.
function readClaimValue(snak) {
  const dv = snak?.datavalue;
  if (!dv) return null;
  const t = dv.type;
  const v = dv.value;
  if (t === 'wikibase-entityid') {
    const qid = str(v?.id) || (v?.['numeric-id'] != null ? `Q${v['numeric-id']}` : '');
    return qid ? { text: qid, qid } : null;
  }
  if (t === 'time') {
    // +1867-11-07T00:00:00Z → trim sign + zero time. Best-effort; raw value is the fallback.
    const m = str(v?.time).match(/^[+-](\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?/);
    if (m) {
      const [, y, mo, d] = m;
      const parts = [y]; if (mo && mo !== '00') parts.push(mo); if (d && d !== '00') parts.push(d);
      return { text: parts.join('-') };
    }
    return { text: str(v?.time) };
  }
  if (t === 'quantity') {
    const amt = str(v?.amount).replace(/^\+/, '');
    return { text: amt };
  }
  if (t === 'monolingualtext') return { text: str(v?.text) };
  if (t === 'globecoordinate') {
    const lat = v?.latitude, lon = v?.longitude;
    if (lat != null && lon != null) return { text: `${lat}, ${lon}` };
    return null;
  }
  if (t === 'string') return { text: str(v) };
  if (typeof v === 'string') return { text: str(v) };
  return null;
}

// Pull label/description/claims for a set of QIDs in one wbgetentities call. Returns the raw entities
// map ({ Qxxx: {...} }) or {} on failure.
async function getEntities(ids, { props = 'labels|descriptions|claims', language = 'en' } = {}) {
  const list = (Array.isArray(ids) ? ids : [ids]).map(str).filter(Boolean);
  if (!list.length) return {};
  const j = await api({
    action: 'wbgetentities',
    ids: list.slice(0, 50).join('|'),
    props,
    languages: language,
  });
  return (j && typeof j.entities === 'object' && j.entities) ? j.entities : {};
}

// ── entityFacts ──────────────────────────────────────────────────────────────────────────────────
/**
 * Resolve a QID to its human-readable key facts (curated to COMMON_PROPS).
 *   entityFacts('Q7186', { language = 'en' })
 * Returns { id, label, description, facts:[{ property, value }] }, soft-fails to null.
 * Item-valued claims (QIDs) are resolved to labels via a single follow-up wbgetentities call.
 */
export async function entityFacts(qid, { language = 'en' } = {}) {
  const id = str(qid);
  if (!id) return null;
  const entities = await getEntities(id, { language });
  // wbgetentities marks unknown ids with a `missing` key; treat as no entity.
  const ent = entities[id];
  if (!ent || ent.missing !== undefined) return null;
  const label = str(ent.labels?.[language]?.value) || id;
  const description = str(ent.descriptions?.[language]?.value);

  const claims = (ent.claims && typeof ent.claims === 'object') ? ent.claims : {};
  const raw = [];           // { property, prop, text, qid? }
  const refQids = new Set();
  for (const [prop, label2] of Object.entries(COMMON_PROPS)) {
    const statements = Array.isArray(claims[prop]) ? claims[prop] : [];
    for (const st of statements) {
      const read = readClaimValue(st?.mainsnak);
      if (!read) continue;
      raw.push({ property: label2, prop, text: read.text, qid: read.qid });
      if (read.qid && ITEM_PROPS.has(prop)) refQids.add(read.qid);
    }
  }

  // Resolve referenced QIDs to labels in one batched call (best-effort; falls back to the QID).
  let refLabels = {};
  if (refQids.size) {
    const refs = await getEntities([...refQids], { props: 'labels', language });
    for (const [rid, rent] of Object.entries(refs)) {
      const l = str(rent?.labels?.[language]?.value);
      if (l) refLabels[rid] = l;
    }
  }

  const facts = raw.map((r) => ({
    property: r.property,
    value: (r.qid && refLabels[r.qid]) ? refLabels[r.qid] : r.text,
  }));

  return { id, label, description, facts };
}

// ── sparql ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Run a SPARQL query against the Wikidata Query Service and return normalized binding rows.
 *   sparql('SELECT ?item ?itemLabel WHERE { ?item wdt:P31 wd:Q5 } LIMIT 5')
 * Each row is a plain object { varName: stringValue, ... } from the result bindings.
 * Soft-fails to [] on any error / non-ok / bad shape. Never throws.
 */
export async function sparql(query) {
  const q = str(query);
  if (!q) return [];
  try {
    const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(q)}&format=json`;
    const r = await _fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const bindings = j?.results?.bindings;
    if (!Array.isArray(bindings)) return [];
    return bindings.map((b) => {
      const row = {};
      for (const [k, cell] of Object.entries(b || {})) {
        row[k] = str(cell?.value);
      }
      return row;
    });
  } catch { return []; }
}

// ── factsAbout ───────────────────────────────────────────────────────────────────────────────────
/**
 * Convenience for the fact-checker / library: free-text name → top entity → its key facts.
 *   factsAbout('Marie Curie')
 * Returns the entityFacts shape ({ id, label, description, facts }) for the best match, or null if
 * nothing matches / facts can't be resolved. Never throws.
 */
export async function factsAbout(name, opts = {}) {
  const hits = await searchEntities(name, opts);
  const top = hits[0];
  if (!top?.id) return null;
  return entityFacts(top.id, opts);
}

// ── renderPage ───────────────────────────────────────────────────────────────────────────────────
/**
 * Escaped HTML fact panel for an entityFacts() result. ALL source-controlled text is escaped.
 *   renderPage({ id, label, description, facts })
 * Returns a string of HTML; returns an empty-state panel for null/empty input.
 */
export function renderPage(data) {
  if (!data || !data.id) {
    return '<section class="wikidata"><p class="empty">No Wikidata entity.</p></section>';
  }
  const id = escapeHtml(data.id);
  const label = escapeHtml(data.label || data.id);
  const desc = data.description ? `<p class="desc">${escapeHtml(data.description)}</p>` : '';
  const facts = Array.isArray(data.facts) ? data.facts : [];
  const rows = facts.length
    ? facts.map((f) => `<tr><th>${escapeHtml(f.property)}</th><td>${escapeHtml(f.value)}</td></tr>`).join('\n      ')
    : '<tr><td class="empty" colspan="2">No key facts.</td></tr>';
  return `<section class="wikidata">
  <h2><a href="https://www.wikidata.org/wiki/${id}" rel="noopener noreferrer">${label}</a> <span class="qid">${id}</span></h2>
  ${desc}
  <table class="facts">
      ${rows}
  </table>
  <p class="note">${escapeHtml(dataNote())}</p>
</section>`;
}

// ── dataNote ─────────────────────────────────────────────────────────────────────────────────────
/** Provenance line, with an as-of date. Wikidata content is released under CC0 (public domain). */
export function dataNote() {
  return `Source: Wikidata (CC0, public domain), as of ${new Date().toISOString().slice(0, 10)}`;
}

// ── CLI (offline-safe wrapper around live endpoints) ─────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('wikidata.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  if (cmd === 'facts' && arg) {
    const f = await entityFacts(arg);
    if (!f) { console.log('(no entity)'); }
    else {
      console.log(`\n${f.label} (${f.id}) — ${f.description || ''}\n`);
      for (const x of f.facts) console.log(`  ${x.property.padEnd(22)} ${x.value}`);
    }
  } else if (cmd === 'sparql' && arg) {
    const rows = await sparql(arg);
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const hits = await searchEntities(arg || cmd || 'phoenix');
    for (const h of hits) console.log(`  ${h.id.padEnd(10)} ${h.label} — ${h.description}`);
  }
}
