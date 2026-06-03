// pharma.test.mjs — OFFLINE tests for the SoapBox Pharmacology vertical. No network: a fake fetch is
// installed via __setFetch() and routed by URL substring. We assert NORMALIZATION + SHAPE (what each
// export turns the raw federal/EBI JSON into) and the graceful soft-fail contract (never throws).
//
//   node --test integrations/soapbox/pharma.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  __setFetch, ENDPOINTS,
  compound, drug, adverseEvents, recalls, interactions, trials, bioactivity,
} from './pharma.mjs';
import { invalidate } from './cache.mjs';

// a fetch double: caller registers URL-substring → JSON; unmatched URLs return 404 (soft-fail path).
function fakeFetch(routes) {
  return async (url) => {
    for (const [needle, payload] of routes) {
      if (String(url).includes(needle)) {
        if (payload === 'NETWORK_ERROR') throw new Error('boom');
        if (payload === '404') return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => payload };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

beforeEach(() => { invalidate(); __setFetch(null); });

// ── compound() / PubChem ────────────────────────────────────────────────────────────────────────────
test('compound() normalizes the PubChem PropertyTable', async () => {
  __setFetch(fakeFetch([['pubchem.ncbi.nlm.nih.gov', {
    PropertyTable: { Properties: [{
      CID: 2244, MolecularFormula: 'C9H8O4', MolecularWeight: '180.16',
      IUPACName: '2-acetyloxybenzoic acid', CanonicalSMILES: 'CC(=O)OC1=CC=CC=C1C(=O)O',
      InChIKey: 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N', XLogP: '1.2',
    }] },
  }]]));
  const r = await compound('aspirin');
  assert.equal(r.found, true);
  assert.equal(r.cid, 2244);
  assert.equal(r.formula, 'C9H8O4');
  assert.equal(r.molecularWeight, 180.16, 'weight coerced to number');
  assert.equal(typeof r.xlogp, 'number');
  assert.equal(r.url, 'https://pubchem.ncbi.nlm.nih.gov/compound/2244');
  assert.match(r.source, /PubChem/);
});

test('compound() soft-fails on empty query and on 404', async () => {
  const empty = await compound('   ');
  assert.equal(empty.found, false);
  __setFetch(fakeFetch([['pubchem', '404']]));
  const miss = await compound('notarealdrug');
  assert.equal(miss.found, false);
  assert.equal(miss.query, 'notarealdrug');
});

// ── drug() / openFDA label ────────────────────────────────────────────────────────────────────────
test('drug() flattens SPL label sections and openfda fields', async () => {
  __setFetch(fakeFetch([['/drug/label.json', {
    results: [{
      indications_and_usage: ['Pain relief.', 'Fever.'],
      dosage_and_administration: ['Take one tablet.'],
      warnings: ['Do not exceed dose.'],
      openfda: {
        brand_name: ['Bayer'], generic_name: ['aspirin'],
        manufacturer_name: ['Bayer Inc'], route: ['ORAL'], rxcui: ['1191'],
      },
    }],
  }]]));
  const r = await drug('aspirin');
  assert.equal(r.found, true);
  assert.deepEqual(r.brandNames, ['Bayer']);
  assert.equal(r.manufacturer, 'Bayer Inc');
  assert.equal(r.sections.indications, 'Pain relief.\n\nFever.', 'array joined');
  assert.equal(r.sections.dosage, 'Take one tablet.');
  assert.equal(r.sections.boxedWarning, null, 'absent section is null, not undefined throw');
  assert.deepEqual(r.rxcui, ['1191']);
});

test('drug() returns found:false when openFDA has no results', async () => {
  __setFetch(fakeFetch([['/drug/label.json', { results: [] }]]));
  const r = await drug('aspirin');
  assert.equal(r.found, false);
});

// ── adverseEvents() / openFDA FAERS count facet ─────────────────────────────────────────────────────
test('adverseEvents() maps the count facet and totals it', async () => {
  __setFetch(fakeFetch([['/drug/event.json', {
    results: [{ term: 'NAUSEA', count: 120 }, { term: 'HEADACHE', count: 80 }],
  }]]));
  const r = await adverseEvents('aspirin');
  assert.equal(r.reactions.length, 2);
  assert.deepEqual(r.reactions[0], { reaction: 'NAUSEA', count: 120 });
  assert.equal(r.total, 200, 'counts summed');
  assert.match(r.source, /not causation/);
});

test('adverseEvents() soft-fails to empty on network error', async () => {
  __setFetch(fakeFetch([['/drug/event.json', 'NETWORK_ERROR']]));
  const r = await adverseEvents('aspirin');
  assert.deepEqual(r.reactions, []);
  assert.equal(r.total, 0);
});

// ── recalls() / openFDA enforcement ─────────────────────────────────────────────────────────────────
test('recalls() normalizes enforcement reports', async () => {
  __setFetch(fakeFetch([['/drug/enforcement.json', {
    results: [{
      product_description: 'Aspirin 81mg', reason_for_recall: 'Labeling error',
      classification: 'Class II', status: 'Ongoing', recalling_firm: 'Acme',
      recall_initiation_date: '20250101',
    }],
  }]]));
  const r = await recalls('aspirin');
  assert.equal(r.recalls.length, 1);
  assert.equal(r.recalls[0].reason, 'Labeling error');
  assert.equal(r.recalls[0].classification, 'Class II');
  assert.equal(r.recalls[0].date, '20250101');
});

// ── interactions() / RxNorm + RxNav ─────────────────────────────────────────────────────────────────
test('interactions() normalizes a name → RxCUI → interaction pairs', async () => {
  __setFetch(fakeFetch([
    ['/rxcui.json', { idGroup: { rxnormId: ['1191'] } }],
    ['/interaction/interaction.json', {
      interactionTypeGroup: [{
        sourceName: 'DrugBank',
        interactionType: [{
          minConceptItem: { name: 'aspirin' },
          interactionPair: [{
            severity: 'high',
            description: 'Increased bleeding risk.',
            interactionConcept: [
              { minConceptItem: { name: 'aspirin' } },
              { minConceptItem: { name: 'warfarin' } },
            ],
          }],
        }],
      }],
    }],
  ]));
  const r = await interactions('aspirin');
  assert.equal(r.rxcui, '1191', 'name normalized to RxCUI');
  assert.equal(r.interactions.length, 1);
  assert.equal(r.interactions[0].with, 'warfarin', 'self filtered out of the pair');
  assert.equal(r.interactions[0].severity, 'high');
  assert.equal(r.interactions[0].source, 'DrugBank');
});

test('interactions() accepts a numeric RxCUI directly (no name lookup)', async () => {
  __setFetch(fakeFetch([
    ['/rxcui.json', 'NETWORK_ERROR'], // would throw if name-lookup were attempted
    ['/interaction/interaction.json', { interactionTypeGroup: [] }],
  ]));
  const r = await interactions('1191');
  assert.equal(r.rxcui, '1191');
  assert.deepEqual(r.interactions, []);
});

test('interactions() soft-fails when a name has no RxCUI', async () => {
  __setFetch(fakeFetch([['/rxcui.json', { idGroup: {} }]]));
  const r = await interactions('notadrug');
  assert.equal(r.rxcui, null);
  assert.deepEqual(r.interactions, []);
});

// ── trials() / ClinicalTrials.gov v2 ────────────────────────────────────────────────────────────────
test('trials() uses the v2 endpoint and flattens protocolSection', async () => {
  let captured = '';
  __setFetch((url) => {
    captured = String(url);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      studies: [{
        protocolSection: {
          identificationModule: { nctId: 'NCT01234567', briefTitle: 'Aspirin in CVD' },
          statusModule: { overallStatus: 'RECRUITING' },
          designModule: { phases: ['PHASE3'] },
          conditionsModule: { conditions: ['Cardiovascular Disease'] },
          sponsorCollaboratorsModule: { leadSponsor: { name: 'NIH' } },
        },
      }],
    }) });
  });
  const r = await trials('aspirin');
  assert.ok(captured.startsWith(ENDPOINTS.clinicaltrials + '/studies'), 'hits v2 /studies');
  assert.match(captured, /query\.term=aspirin/);
  assert.equal(r.studies.length, 1);
  const s = r.studies[0];
  assert.equal(s.nctId, 'NCT01234567');
  assert.equal(s.title, 'Aspirin in CVD');
  assert.equal(s.status, 'RECRUITING');
  assert.deepEqual(s.phases, ['PHASE3']);
  assert.equal(s.url, 'https://clinicaltrials.gov/study/NCT01234567');
});

test('trials() soft-fails to empty studies on 404', async () => {
  __setFetch(fakeFetch([['/studies', '404']]));
  const r = await trials('aspirin');
  assert.deepEqual(r.studies, []);
});

// ── bioactivity() / ChEMBL ──────────────────────────────────────────────────────────────────────────
test('bioactivity() normalizes a ChEMBL molecule record', async () => {
  __setFetch(fakeFetch([['ebi.ac.uk/chembl', {
    molecules: [{
      molecule_chembl_id: 'CHEMBL25', pref_name: 'ASPIRIN', molecule_type: 'Small molecule',
      max_phase: 4, molecule_properties: { full_mwt: '180.16', alogp: '1.31' },
    }],
  }]]));
  const r = await bioactivity('aspirin');
  assert.equal(r.found, true);
  assert.equal(r.chemblId, 'CHEMBL25');
  assert.equal(r.maxPhase, 4);
  assert.equal(r.molecularWeight, 180.16, 'mwt coerced to number');
  assert.equal(r.url, 'https://www.ebi.ac.uk/chembl/compound_report_card/CHEMBL25/');
});

// ── cross-cutting: nothing throws ───────────────────────────────────────────────────────────────────
test('every export soft-fails (never throws) on a total network outage', async () => {
  __setFetch(() => { throw new Error('offline'); });
  await assert.doesNotReject(Promise.all([
    compound('x'), drug('x'), adverseEvents('x'), recalls('x'),
    interactions('x'), trials('x'), bioactivity('x'),
  ]));
});
