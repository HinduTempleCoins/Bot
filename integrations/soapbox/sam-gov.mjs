// sam-gov.mjs — the SoapBox SAM.gov entity + exclusions reader. Reads api.sam.gov for:
//   • Entity Management (registration) lookup — is this org registered to receive federal awards?
//   • Exclusions ("debarment") check — is this person/org BARRED from federal awards/contracts?
//
// This is the honesty backstop for the Benefits Navigator: before anyone chases federal money, SAM.gov
// tells the truth about whether they can even legally receive it. An exclusions hit is a hard stop.
//
// SAM.gov REQUIRES an API key. We read it by env NAME only (SAM_API_KEY, with SAM_GOV_API_KEY as a
// fallback alias). When the key is ABSENT we SOFT-SKIP: every reader returns a clearly-marked
// { skipped: true } result with NO network call and NO throw — the navigator just omits this surface.
//
// Pattern matches worldbank.mjs / fed-opportunities.mjs: ESM, zero deps, key-by-env-NAME, __setFetch
// seam, graceful soft-fail (NEVER throw), guarded CLI, escaped rendered HTML, no secrets, provenance.
//
//   import { hasKey, entity, exclusions, eligibilityCheck, renderPage, dataNote } from './sam-gov.mjs'
//   SAM_API_KEY=… node integrations/soapbox/sam-gov.mjs entity "Acme Corp"
//   SAM_API_KEY=… node integrations/soapbox/sam-gov.mjs exclusions "John Doe"

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxSamGov/1.0 (+https://data.soapbox.community)' };

export const ENDPOINTS = {
  entity: 'https://api.sam.gov/entity-information/v3/entities',
  exclusions: 'https://api.sam.gov/entity-information/v4/exclusions',
};

// Env var NAMES holding the SAM.gov key — read by name only, never inlined. SAM_API_KEY is canonical;
// SAM_GOV_API_KEY is honored as an alias so this matches the older fed-opportunities env name too.
export const API_KEY_ENV = ['SAM_API_KEY', 'SAM_GOV_API_KEY'];

const str = (v) => (v == null ? '' : String(v)).trim();
const now = () => new Date().toISOString();

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** Resolve the SAM.gov key from env by NAME (canonical or alias), or '' if absent. */
function resolveKey() {
  for (const name of API_KEY_ENV) { const v = str(process.env[name]); if (v) return v; }
  return '';
}

/** True when a SAM.gov key is present in the environment. Lets callers gate the surface cleanly. */
export function hasKey() { return Boolean(resolveKey()); }

// The marker the navigator looks for to omit this surface when no key is configured.
const SKIPPED = () => ({ skipped: true, reason: 'no SAM.gov API key configured (set SAM_API_KEY)', source: 'SAM.gov' });

// ---- live data (key required; soft-SKIP without it, soft-fail to [] on error) ----

/**
 * Entity-registration lookup by legal business name. Returns
 *   { skipped:true, ... }              when no key is configured (no network call),
 *   { entities:[ {name, ueiSAM, cageCode, registrationStatus, ...} ], source, fetched_at }  otherwise.
 * Soft-fails to an empty `entities` list on any error.
 * @param {{name?:string, ueiSAM?:string, limit?:number}} opts
 */
export async function entity({ name = '', ueiSAM = '', limit = 10 } = {}) {
  const key = resolveKey();
  if (!key) return SKIPPED();
  try {
    const p = new URLSearchParams();
    p.set('api_key', key);
    if (str(ueiSAM)) p.set('ueiSAM', str(ueiSAM));
    else if (str(name)) p.set('legalBusinessName', str(name));
    p.set('registrationStatus', 'A');
    p.set('includeSections', 'entityRegistration');
    const r = await _fetch(`${ENDPOINTS.entity}?${p.toString()}`, { headers: { ...UA, Accept: 'application/json' } });
    if (!r || !r.ok) return { entities: [], source: 'SAM.gov', fetched_at: now() };
    const j = await r.json();
    const rows = Array.isArray(j?.entityData) ? j.entityData : [];
    const entities = rows.slice(0, Math.max(1, Math.min(50, Number(limit) || 10))).map((e) => {
      const reg = e?.entityRegistration || {};
      return {
        name: str(reg.legalBusinessName) || null,
        ueiSAM: str(reg.ueiSAM) || null,
        cageCode: str(reg.cageCode) || null,
        registrationStatus: str(reg.registrationStatus) || null,
        registrationExpirationDate: str(reg.registrationExpirationDate) || null,
      };
    });
    return { entities, source: 'SAM.gov', fetched_at: now() };
  } catch { return { entities: [], source: 'SAM.gov', fetched_at: now() }; }
}

/**
 * Exclusions ("debarment") check by name. Returns
 *   { skipped:true, ... }              when no key is configured,
 *   { excluded:boolean, records:[ {name, classification, exclusionType, agency, ...} ], ... }  otherwise.
 * `excluded` is true when ANY active exclusion record matches — a hard stop for federal eligibility.
 * Soft-fails to { excluded:false, records:[] } on any error.
 * @param {{name?:string, limit?:number}} opts
 */
export async function exclusions({ name = '', limit = 25 } = {}) {
  const key = resolveKey();
  if (!key) return SKIPPED();
  const who = str(name);
  if (!who) return { excluded: false, records: [], source: 'SAM.gov', fetched_at: now() };
  try {
    const p = new URLSearchParams();
    p.set('api_key', key);
    p.set('exclusionName', who);
    const r = await _fetch(`${ENDPOINTS.exclusions}?${p.toString()}`, { headers: { ...UA, Accept: 'application/json' } });
    if (!r || !r.ok) return { excluded: false, records: [], source: 'SAM.gov', fetched_at: now() };
    const j = await r.json();
    const rows = Array.isArray(j?.exclusionDetails) ? j.exclusionDetails
      : Array.isArray(j?.results) ? j.results : [];
    const records = rows.slice(0, Math.max(1, Math.min(100, Number(limit) || 25))).map((x) => {
      const nm = x?.exclusionName || x?.name || {};
      return {
        name: str(typeof nm === 'string' ? nm : (nm.fullName || nm.firstName))
          || str(x?.legalBusinessName) || null,
        classification: str(x?.classificationType || x?.classification) || null,
        exclusionType: str(x?.exclusionType) || null,
        agency: str(x?.excludingAgencyName || x?.agency) || null,
        activeDate: str(x?.activeDate) || null,
      };
    });
    return { excluded: records.length > 0, records, source: 'SAM.gov', fetched_at: now() };
  } catch { return { excluded: false, records: [], source: 'SAM.gov', fetched_at: now() }; }
}

/**
 * Combined honesty check for one name: is the org registered, and is anyone with this name excluded?
 * Returns { skipped:true } without a key, else { name, registered, excluded, entity, exclusions }.
 */
export async function eligibilityCheck({ name = '' } = {}) {
  if (!hasKey()) return SKIPPED();
  const who = str(name);
  const ent = await entity({ name: who });
  const exc = await exclusions({ name: who });
  return {
    name: who || null,
    registered: Array.isArray(ent.entities) && ent.entities.length > 0,
    excluded: Boolean(exc.excluded),
    entity: ent,
    exclusions: exc,
    source: 'SAM.gov',
    fetched_at: now(),
  };
}

// ---- rendering ----

/** Escaped HTML for an entity result, an exclusions result, an eligibilityCheck, or a skipped marker. */
export function renderPage(data = {}) {
  if (data && data.skipped) {
    return `<section class="sam-gov sam-skipped">
  <h2>SAM.gov — Entity &amp; Exclusions</h2>
  <p class="sam-note">This check is unavailable: ${esc(data.reason || 'no SAM.gov API key configured')}.</p>
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
  }
  // eligibilityCheck shape
  if (data && (Object.prototype.hasOwnProperty.call(data, 'registered'))) {
    const flag = data.excluded
      ? '<p class="sam-excluded"><strong>EXCLUDED — this name appears on the federal exclusions list. This is a hard stop for federal awards.</strong></p>'
      : '<p class="sam-clear">No active exclusion matched this name.</p>';
    return `<section class="sam-gov">
  <h2>SAM.gov — Eligibility for ${esc(data.name)}</h2>
  <p class="sam-registered">Registered in SAM.gov: <strong>${data.registered ? 'yes' : 'no'}</strong></p>
  ${flag}
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
  }
  // exclusions shape
  if (data && Object.prototype.hasOwnProperty.call(data, 'excluded')) {
    const rows = Array.isArray(data.records) ? data.records : [];
    const body = rows.map((x) => `      <tr><td>${esc(x.name)}</td><td>${esc(x.classification)}</td><td>${esc(x.agency)}</td></tr>`).join('\n');
    const tbody = body || '      <tr><td colspan="3">No active exclusions matched.</td></tr>';
    return `<section class="sam-gov">
  <h2>SAM.gov — Exclusions check</h2>
  <p class="sam-status"><strong>${data.excluded ? 'EXCLUSION(S) FOUND — hard stop for federal awards.' : 'No active exclusions matched.'}</strong></p>
  <table><thead><tr><th>Name</th><th>Classification</th><th>Agency</th></tr></thead><tbody>
${tbody}
  </tbody></table>
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
  }
  // entity shape (default)
  const rows = Array.isArray(data.entities) ? data.entities : [];
  const body = rows.map((e) => `      <tr><td>${esc(e.name)}</td><td>${esc(e.ueiSAM)}</td><td>${esc(e.registrationStatus)}</td><td>${esc(e.registrationExpirationDate)}</td></tr>`).join('\n');
  const tbody = body || '      <tr><td colspan="4">No registered entity matched.</td></tr>';
  return `<section class="sam-gov">
  <h2>SAM.gov — Entity registration</h2>
  <table><thead><tr><th>Name</th><th>UEI</th><th>Status</th><th>Expires</th></tr></thead><tbody>
${tbody}
  </tbody></table>
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
}

/** Provenance line — names SAM.gov + the verify caveat. */
export function dataNote() {
  const asOf = new Date().toISOString().slice(0, 10);
  return `Source: SAM.gov entity + exclusions API (key required), as of ${asOf}. Registration and ` +
    `exclusion status change; confirm on SAM.gov before relying on this for any award decision.`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('sam-gov.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  if (!hasKey()) {
    console.log('SAM.gov: no API key configured (set SAM_API_KEY). Skipping — no network call made.');
    process.exit(0);
  }
  let out;
  if (cmd === 'exclusions') out = await exclusions({ name: arg });
  else if (cmd === 'check') out = await eligibilityCheck({ name: arg });
  else out = await entity({ name: arg });
  console.log(`\n# SAM.gov ${cmd || 'entity'}: ${arg}\n`);
  console.log(JSON.stringify(out, null, 2));
  console.log(`\n${dataNote()}`);
}
