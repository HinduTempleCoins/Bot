// pharma.mjs — the SoapBox Pharmacology vertical (queue task #111). Keyless federal / EBI data only,
// so the public site never needs an API key or a billing relationship for drug facts:
//   • PubChem PUG-REST (NIH/NLM)        — compound identity (formula, weight, IUPAC, SMILES, CID)
//   • openFDA (FDA)                     — structured drug labels, adverse-event reports, recalls
//   • RxNorm / RxNav (NLM)             — name → RxCUI normalization + drug–drug interactions
//   • ClinicalTrials.gov v2 (NIH)      — registered/active trials for a query
//   • ChEMBL (EMBL-EBI)                — curated bioactivity / molecule properties
//
// Same shape as macro.mjs: ESM, a __setFetch() seam for tests, and graceful soft-fail — every export
// returns a well-formed object/array (with an `error` note where useful) and NEVER throws. Results
// are cached so the site doesn't hammer the federal endpoints.
//
//   import { drug, adverseEvents, interactions, trials, compound } from './pharma.mjs'
//   node integrations/soapbox/pharma.mjs aspirin

import { cached, TTL } from './cache.mjs';

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Endpoint roots — kept in one place so a base-URL change is a one-line edit.
export const ENDPOINTS = {
  pubchem: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug',
  openfda: 'https://api.fda.gov',
  rxnav: 'https://rxnav.nlm.nih.gov/REST',
  clinicaltrials: 'https://clinicaltrials.gov/api/v2', // CURRENT v2 API (the legacy /api/query is retired)
  chembl: 'https://www.ebi.ac.uk/chembl/api/data',
};

// fetch JSON with soft-fail: any network/parse/non-ok error resolves to null, never throws.
async function getJSON(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const clean = (s) => String(s == null ? '' : s).trim();

// ── PubChem PUG-REST: compound(name) ───────────────────────────────────────────────────────────────
// Resolve a chemical/drug name to its core identity. PubChem returns a PropertyTable of one+ records;
// we take the first and normalize the field names into something the site can render directly.
export async function compound(name) {
  const q = clean(name);
  if (!q) return { query: '', found: false, error: 'empty query' };
  return cached(`pharma:compound:${q.toLowerCase()}`, TTL.metadata, async () => {
    const props = 'MolecularFormula,MolecularWeight,IUPACName,CanonicalSMILES,InChIKey,XLogP';
    const u = `${ENDPOINTS.pubchem}/compound/name/${encodeURIComponent(q)}/property/${props}/JSON`;
    const j = await getJSON(u);
    const rec = j?.PropertyTable?.Properties?.[0];
    if (!rec) return { query: q, found: false };
    return {
      query: q,
      found: true,
      source: 'PubChem (NIH/NLM)',
      cid: rec.CID ?? null,
      formula: rec.MolecularFormula ?? null,
      molecularWeight: rec.MolecularWeight != null ? Number(rec.MolecularWeight) : null,
      iupacName: rec.IUPACName ?? null,
      smiles: rec.CanonicalSMILES ?? null,
      inchiKey: rec.InChIKey ?? null,
      xlogp: rec.XLogP != null ? Number(rec.XLogP) : null,
      url: rec.CID != null ? `https://pubchem.ncbi.nlm.nih.gov/compound/${rec.CID}` : null,
    };
  });
}

// ── openFDA drug label: drug(name) ──────────────────────────────────────────────────────────────────
// openFDA indexes the structured product label (SPL). Match on brand OR generic name. We pull the
// label sections people actually want (indications, dosage, warnings, contraindications) and flatten
// the arrays-of-strings that SPL returns into single readable blocks.
const SPL_SECTIONS = [
  ['indications', 'indications_and_usage'],
  ['dosage', 'dosage_and_administration'],
  ['warnings', 'warnings'],
  ['boxedWarning', 'boxed_warning'],
  ['contraindications', 'contraindications'],
  ['adverseReactions', 'adverse_reactions'],
  ['drugInteractions', 'drug_interactions'],
  ['mechanism', 'mechanism_of_action'],
];
const joinSection = (v) => Array.isArray(v) ? v.join('\n\n').trim() : clean(v) || null;

export async function drug(name) {
  const q = clean(name);
  if (!q) return { query: '', found: false, error: 'empty query' };
  return cached(`pharma:drug:${q.toLowerCase()}`, TTL.metadata, async () => {
    const safe = q.replace(/["\\]/g, '');
    const search = `(openfda.brand_name:"${safe}"+openfda.generic_name:"${safe}")`;
    const u = `${ENDPOINTS.openfda}/drug/label.json?search=${encodeURIComponent(search).replace(/%2B/g, '+')}&limit=1`;
    const j = await getJSON(u);
    const rec = j?.results?.[0];
    if (!rec) return { query: q, found: false };
    const of = rec.openfda || {};
    const out = {
      query: q,
      found: true,
      source: 'openFDA drug label (FDA)',
      brandNames: of.brand_name || [],
      genericNames: of.generic_name || [],
      manufacturer: (of.manufacturer_name || [])[0] || null,
      route: of.route || [],
      rxcui: of.rxcui || [],
      sections: {},
    };
    for (const [key, field] of SPL_SECTIONS) out.sections[key] = joinSection(rec[field]);
    return out;
  });
}

// ── openFDA adverse events (FAERS): adverseEvents(name) ──────────────────────────────────────────────
// Counts of reported reactions for a drug, via openFDA's `count` facet on the event endpoint. Useful
// signal, NOT causation — the count is reports, not proven side effects. We surface the top reactions.
export async function adverseEvents(name, { limit = 15 } = {}) {
  const q = clean(name);
  if (!q) return { query: '', total: 0, reactions: [], error: 'empty query' };
  return cached(`pharma:ae:${q.toLowerCase()}:${limit}`, TTL.metadata, async () => {
    const safe = q.replace(/["\\]/g, '');
    const search = `patient.drug.openfda.generic_name:"${safe}"`;
    const u = `${ENDPOINTS.openfda}/drug/event.json?search=${encodeURIComponent(search)}` +
      `&count=patient.reaction.reactionmeddrapt.exact&limit=${limit}`;
    const j = await getJSON(u);
    const rows = j?.results;
    if (!Array.isArray(rows)) return { query: q, total: 0, reactions: [] };
    const reactions = rows.map((r) => ({ reaction: clean(r.term), count: Number(r.count) || 0 }));
    const total = reactions.reduce((s, r) => s + r.count, 0);
    return {
      query: q,
      source: 'openFDA / FAERS (FDA) — report counts, not causation',
      total,
      reactions,
    };
  });
}

// ── openFDA recalls/enforcement: recalls(name) ──────────────────────────────────────────────────────
// Drug recall / enforcement reports. Not in the required export list but the same endpoint family and
// part of the "drug labels + adverse events + recalls" brief — exported for the site's safety panel.
export async function recalls(name, { limit = 10 } = {}) {
  const q = clean(name);
  if (!q) return { query: '', recalls: [], error: 'empty query' };
  return cached(`pharma:recall:${q.toLowerCase()}:${limit}`, TTL.metadata, async () => {
    const safe = q.replace(/["\\]/g, '');
    const search = `(product_description:"${safe}"+openfda.generic_name:"${safe}")`;
    const u = `${ENDPOINTS.openfda}/drug/enforcement.json?search=${encodeURIComponent(search).replace(/%2B/g, '+')}&limit=${limit}`;
    const j = await getJSON(u);
    const rows = j?.results;
    if (!Array.isArray(rows)) return { query: q, recalls: [] };
    return {
      query: q,
      source: 'openFDA enforcement (FDA)',
      recalls: rows.map((r) => ({
        product: clean(r.product_description) || null,
        reason: clean(r.reason_for_recall) || null,
        classification: clean(r.classification) || null,
        status: clean(r.status) || null,
        recallingFirm: clean(r.recalling_firm) || null,
        date: clean(r.recall_initiation_date) || null,
      })),
    };
  });
}

// ── RxNorm / RxNav: interactions(rxcui-or-name) ────────────────────────────────────────────────────
// Accepts either an RxCUI (the numeric NLM identifier) or a drug name. A name is first normalized to
// its RxCUI via the RxNav rxcui endpoint, then the interaction list is fetched. RxNav returns nested
// interactionTypeGroup → interactionType → interactionPair; we flatten to a clean pair list.
async function nameToRxcui(name) {
  const j = await getJSON(`${ENDPOINTS.rxnav}/rxcui.json?name=${encodeURIComponent(name)}`);
  const ids = j?.idGroup?.rxnormId;
  return Array.isArray(ids) && ids.length ? clean(ids[0]) : null;
}

export async function interactions(rxcuiOrName) {
  const raw = clean(rxcuiOrName);
  if (!raw) return { query: '', rxcui: null, interactions: [], error: 'empty query' };
  return cached(`pharma:rxi:${raw.toLowerCase()}`, TTL.metadata, async () => {
    const rxcui = /^\d+$/.test(raw) ? raw : await nameToRxcui(raw);
    if (!rxcui) return { query: raw, rxcui: null, interactions: [] };
    const j = await getJSON(`${ENDPOINTS.rxnav}/interaction/interaction.json?rxcui=${encodeURIComponent(rxcui)}`);
    const groups = j?.interactionTypeGroup;
    if (!Array.isArray(groups)) return { query: raw, rxcui, interactions: [] };
    const pairs = [];
    for (const g of groups) {
      for (const t of g.interactionType || []) {
        for (const p of t.interactionPair || []) {
          const partner = (p.interactionConcept || [])
            .map((c) => clean(c?.minConceptItem?.name))
            .filter((n) => n && n.toLowerCase() !== clean(t.minConceptItem?.name).toLowerCase());
          pairs.push({
            with: partner.join(', ') || clean(t.comment) || null,
            severity: clean(p.severity) || null,
            description: clean(p.description) || null,
            source: clean(g.sourceName) || 'RxNav (NLM)',
          });
        }
      }
    }
    return { query: raw, rxcui, source: 'RxNorm / RxNav (NLM)', interactions: pairs };
  });
}

// ── ClinicalTrials.gov v2: trials(q) ────────────────────────────────────────────────────────────────
// CURRENT v2 endpoint: /api/v2/studies?query.term=...&format=json. The response nests each study under
// protocolSection; we pull the fields a list view needs (NCT id, title, status, phase, conditions).
export async function trials(q, { limit = 10 } = {}) {
  const query = clean(q);
  if (!query) return { query: '', studies: [], error: 'empty query' };
  return cached(`pharma:trials:${query.toLowerCase()}:${limit}`, TTL.metadata, async () => {
    const fields = ['NCTId', 'BriefTitle', 'OverallStatus', 'Phase', 'Condition', 'LeadSponsorName'];
    const u = `${ENDPOINTS.clinicaltrials}/studies?query.term=${encodeURIComponent(query)}` +
      `&pageSize=${limit}&format=json&fields=${fields.join('|')}`;
    const j = await getJSON(u);
    const rows = j?.studies;
    if (!Array.isArray(rows)) return { query, studies: [] };
    const studies = rows.map((s) => {
      const ps = s.protocolSection || {};
      const id = ps.identificationModule || {};
      const status = ps.statusModule || {};
      const design = ps.designModule || {};
      const cond = ps.conditionsModule || {};
      const spon = ps.sponsorCollaboratorsModule || {};
      const nct = clean(id.nctId) || null;
      return {
        nctId: nct,
        title: clean(id.briefTitle) || null,
        status: clean(status.overallStatus) || null,
        phases: design.phases || [],
        conditions: cond.conditions || [],
        sponsor: clean(spon.leadSponsor?.name) || null,
        url: nct ? `https://clinicaltrials.gov/study/${nct}` : null,
      };
    });
    return { query, source: 'ClinicalTrials.gov v2 (NIH)', studies };
  });
}

// ── ChEMBL (EMBL-EBI): bioactivity(name) ────────────────────────────────────────────────────────────
// Curated molecule lookup by name (pref_name / synonym search). Returns ChEMBL id + key molecular
// properties + max clinical phase. Exposed so the vertical can cross-reference EBI's curation against
// the FDA/PubChem identity. Not in the required-export list but completes the "ChEMBL (EBI)" source.
export async function bioactivity(name) {
  const q = clean(name);
  if (!q) return { query: '', found: false, error: 'empty query' };
  return cached(`pharma:chembl:${q.toLowerCase()}`, TTL.metadata, async () => {
    const u = `${ENDPOINTS.chembl}/molecule/search.json?q=${encodeURIComponent(q)}&limit=1`;
    const j = await getJSON(u);
    const m = j?.molecules?.[0];
    if (!m) return { query: q, found: false };
    const props = m.molecule_properties || {};
    return {
      query: q,
      found: true,
      source: 'ChEMBL (EMBL-EBI)',
      chemblId: m.molecule_chembl_id ?? null,
      prefName: m.pref_name ?? null,
      moleculeType: m.molecule_type ?? null,
      maxPhase: m.max_phase != null ? Number(m.max_phase) : null,
      molecularWeight: props.full_mwt != null ? Number(props.full_mwt) : null,
      alogp: props.alogp != null ? Number(props.alogp) : null,
      url: m.molecule_chembl_id ? `https://www.ebi.ac.uk/chembl/compound_report_card/${m.molecule_chembl_id}/` : null,
    };
  });
}

// ── CLI: node integrations/soapbox/pharma.mjs <drug name> ───────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('pharma.mjs')) {
  const name = process.argv.slice(2).join(' ') || 'aspirin';
  const [c, d, ae, ix, tr, bio] = await Promise.all([
    compound(name), drug(name), adverseEvents(name), interactions(name), trials(name), bioactivity(name),
  ]);
  console.log(`\n# Pharmacology: ${name}\n`);
  console.log('Compound (PubChem):', c.found ? `${c.formula} · MW ${c.molecularWeight} · CID ${c.cid}` : 'not found');
  console.log('Label (openFDA):   ', d.found ? `${(d.brandNames[0] || d.genericNames[0] || '')} · ${d.manufacturer || ''}` : 'not found');
  console.log('Top adverse events:', (ae.reactions || []).slice(0, 5).map((r) => `${r.reaction} (${r.count})`).join(', ') || 'none');
  console.log('Interactions:      ', ix.rxcui ? `${ix.interactions.length} pairs (RxCUI ${ix.rxcui})` : 'none / not normalized');
  console.log('Trials:            ', (tr.studies || []).length, 'studies');
  console.log('ChEMBL:            ', bio.found ? `${bio.chemblId} · max phase ${bio.maxPhase}` : 'not found');
}
