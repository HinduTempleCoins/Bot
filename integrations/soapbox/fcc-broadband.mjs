// fcc-broadband.mjs — the SoapBox "What internet can I actually get here?" reader. A keyless reader
// over the FCC's free public data: the Broadband Data / National Broadband Map (providers + advertised
// speeds available at a location), the FCC Area & Census Block API (lat/lon → census block + county),
// and the FCC consumer-complaint data (telecom). Like cfpb.mjs / macro.mjs / scanners.mjs this is a
// READER only — every source soft-fails to [] and the module never throws; a dead source just drops out.
//
// HONEST-SPEEDS CAVEAT: the FCC Broadband Data is *advertised* (carrier-reported maximum) speed, not the
// throughput a real subscriber sees. We carry that caveat in dataNote() and never imply the numbers are
// measured. No personal-info intake; coordinates in, public availability out.
//
// Keys: FCC publishes these datasets keyless. An OPTIONAL key (env name FCC_API_KEY) can be attached as a
// query param if present; absence is the normal case and changes nothing. The key is read by NAME only —
// never logged, never printed, never committed.
//
//   import { broadbandAt, areaLookup, complaints, summary, renderPage, dataNote } from './fcc-broadband.mjs'
//   node integrations/soapbox/fcc-broadband.mjs 38.0 -97.0

import { cached, TTL } from './cache.mjs';

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Escape user/provider-controlled text before it lands in HTML. Mirrors the project convention.
export function escapeHtml(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// FCC's National Broadband Map exposes technology codes; map the common ones to friendly labels. Unknown
// codes pass through as-is so the data is never silently dropped.
const TECH_LABELS = {
  '10': 'Copper / DSL', '40': 'Cable', '50': 'Fiber', '60': 'Satellite',
  '70': 'Fixed Wireless', '71': 'Fixed Wireless (licensed)', '72': 'Fixed Wireless (unlicensed)',
  '0': 'Other', '90': 'Other',
};
const techLabel = (code) => TECH_LABELS[str(code)] || (str(code) || 'Unknown');

// Optional key (by NAME only). Returns '' when unset so URLs stay clean and keyless by default.
function keyParam() {
  const k = process.env.FCC_API_KEY;
  return k ? `&api_key=${encodeURIComponent(k)}` : '';
}

// ── Area & Census Block API ─────────────────────────────────────────────────────────────────────────
// FCC Area API: lat/lon → the 15-digit census block FIPS + county/state names. Keyless. Soft-fail null.
//   https://geo.fcc.gov/api/census/block/find?latitude=..&longitude=..&format=json
export async function areaLookup({ lat, lon } = {}) {
  const la = num(lat), lo = num(lon);
  if (la == null || lo == null) return null;
  return cached(`fcc:area:${la},${lo}`, TTL.metadata, async () => {
    try {
      const u = `https://geo.fcc.gov/api/census/block/find?latitude=${la}&longitude=${lo}&format=json${keyParam()}`;
      const r = await _fetch(u, { headers: UA });
      if (!r || !r.ok) return null;
      const j = await r.json();
      const block = str(j?.Block?.FIPS);
      if (!block) return null;
      return {
        blockFips: block,
        county: str(j?.County?.name),
        countyFips: str(j?.County?.FIPS),
        state: str(j?.State?.code || j?.State?.name),
        stateFips: str(j?.State?.FIPS),
        lat: la, lon: lo,
        source: 'FCC Area API',
      };
    } catch { return null; }
  });
}

// ── Broadband Data (National Broadband Map) ───────────────────────────────────────────────────────────
// Providers + advertised speeds available at a location. Accepts coordinates (resolved to a block via the
// Area API) OR a block FIPS directly. Normalizes to [{ provider, technology, downMbps, upMbps }]; soft-fail [].
// The public availability endpoint takes a block FIPS; we read its rows and normalize the carrier fields.
export async function broadbandAt({ lat, lon, blockFips } = {}) {
  let block = str(blockFips);
  if (!block) {
    const area = await areaLookup({ lat, lon }).catch(() => null);
    block = area ? str(area.blockFips) : '';
  }
  if (!block) return [];
  return cached(`fcc:bb:${block}`, TTL.metadata, async () => {
    try {
      const u = `https://broadbandmap.fcc.gov/nbm/map/api/published/fixed/location/${encodeURIComponent(block)}${keyParam().replace(/^&/, '?')}`;
      const r = await _fetch(u, { headers: UA });
      if (!r || !r.ok) return [];
      const j = await r.json();
      // The dataset shape varies; accept a top-level array, .data, or .results of provider rows.
      const rows = Array.isArray(j) ? j : (j?.data || j?.results || j?.providers || []);
      return (Array.isArray(rows) ? rows : [])
        .map((p) => {
          const down = num(p.maxAdDown ?? p.downMbps ?? p.max_advertised_download_speed ?? p.maxAdvertisedDownloadSpeed);
          const up = num(p.maxAdUp ?? p.upMbps ?? p.max_advertised_upload_speed ?? p.maxAdvertisedUploadSpeed);
          return {
            provider: str(p.brandName ?? p.providerName ?? p.holdingCompanyName ?? p.provider ?? p.name),
            technology: techLabel(p.techCode ?? p.technology ?? p.tech),
            downMbps: down,
            upMbps: up,
            source: 'FCC Broadband Data',
          };
        })
        .filter((p) => p.provider);
    } catch { return []; }
  });
}

// ── FCC consumer complaints (telecom) ─────────────────────────────────────────────────────────────────
// The FCC Consumer Complaint Center publishes its data on its Socrata portal (opendata.fcc.gov). Keyless.
// Filter by free-text issue; normalize to a small, honest shape. Soft-fail to [].
export async function complaints({ issue = '', limit = 20 } = {}) {
  const q = str(issue);
  const lim = Math.max(1, Math.min(num(limit) || 20, 200));
  return cached(`fcc:complaints:${q.toLowerCase()}|${lim}`, TTL.metadata, async () => {
    try {
      const p = new URLSearchParams();
      p.set('$limit', String(lim));
      p.set('$order', 'date_received DESC');
      if (q) p.set('$q', q); // Socrata full-text search
      const u = `https://opendata.fcc.gov/resource/4z3v-9o5p.json?${p.toString()}${keyParam()}`;
      const r = await _fetch(u, { headers: UA });
      if (!r || !r.ok) return [];
      const j = await r.json();
      const rows = Array.isArray(j) ? j : (j?.data || []);
      return rows.map((c) => ({
        id: str(c.ticket_no ?? c.id ?? c.ticket),
        date: str(c.date_received ?? c.date ?? c.created_date),
        issue: str(c.issue ?? c.type_of_complaint ?? c.method),
        method: str(c.method ?? c.contact_method),
        state: str(c.state),
        source: 'FCC Consumer Complaints',
      })).filter((c) => c.id || c.issue);
    } catch { return []; }
  });
}

// ── summary — best available speed + provider count for a location ────────────────────────────────────
// Picks the single best advertised download (and that row's up) across providers, counts providers and the
// distinct technologies present. Safe on []: returns zeros and null best.
export function summary(providers = []) {
  const rows = Array.isArray(providers) ? providers.filter((p) => p && p.provider) : [];
  let best = null;
  for (const p of rows) {
    const d = num(p.downMbps);
    if (d == null) continue;
    if (!best || d > best.downMbps) best = { provider: p.provider, technology: p.technology, downMbps: d, upMbps: num(p.upMbps) };
  }
  const techs = [...new Set(rows.map((p) => str(p.technology)).filter(Boolean))];
  const hasFiber = techs.some((t) => /fiber/i.test(t));
  return {
    providerCount: rows.length,
    technologies: techs,
    hasFiber,
    bestDownMbps: best ? best.downMbps : null,
    bestUpMbps: best ? best.upMbps : null,
    bestProvider: best ? best.provider : '',
    best,
  };
}

// ── provenance note ───────────────────────────────────────────────────────────────────────────────────
export function dataNote() {
  const asOf = new Date().toISOString().slice(0, 10);
  return `Source: FCC Broadband Data (National Broadband Map) + FCC Area API + FCC consumer complaints, as of ${asOf}. ` +
    `Advertised speeds are carrier-reported maximums and may differ from actual speeds you experience. ` +
    `Availability is reported at the census-block level; presence here is not a guarantee of service at your exact address.`;
}

// ── renderPage — escaped HTML providers table ─────────────────────────────────────────────────────────
// data: { providers, area, summary } (any field optional). EVERY interpolated value is escaped.
export function renderPage(data = {}) {
  const providers = Array.isArray(data.providers) ? data.providers : [];
  const sum = data.summary || summary(providers);
  const area = data.area || null;

  const rows = providers.map((p) => `<tr>` +
    `<td>${escapeHtml(p.provider)}</td>` +
    `<td>${escapeHtml(p.technology)}</td>` +
    `<td>${p.downMbps == null ? '—' : escapeHtml(p.downMbps)}</td>` +
    `<td>${p.upMbps == null ? '—' : escapeHtml(p.upMbps)}</td>` +
    `</tr>`).join('');

  const areaLine = area
    ? `<p class="area">Census block ${escapeHtml(area.blockFips)} — ${escapeHtml(area.county)}, ${escapeHtml(area.state)}</p>`
    : '';

  const sumLine = sum.providerCount
    ? `<p class="summary">${escapeHtml(sum.providerCount)} provider(s); best advertised ${sum.bestDownMbps == null ? '—' : escapeHtml(sum.bestDownMbps)} Mbps down` +
      `${sum.bestProvider ? ` via ${escapeHtml(sum.bestProvider)}` : ''}.</p>`
    : `<p class="summary">No reported providers at this location.</p>`;

  return `<section class="fcc-broadband">
  <h2>Internet available here</h2>
  ${areaLine}
  ${sumLine}
  <table class="providers">
    <thead><tr><th>Provider</th><th>Technology</th><th>Down (Mbps)</th><th>Up (Mbps)</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="note">${escapeHtml(dataNote())}</p>
</section>`;
}

if (process.argv[1] && process.argv[1].endsWith('fcc-broadband.mjs')) {
  const [lat, lon] = process.argv.slice(2).map(Number);
  const la = Number.isFinite(lat) ? lat : 38.0;
  const lo = Number.isFinite(lon) ? lon : -97.0;
  const area = await areaLookup({ lat: la, lon: lo }).catch(() => null);
  const providers = await broadbandAt({ lat: la, lon: lo }).catch(() => []);
  const sum = summary(providers);
  console.log(`\nBroadband at ${la}, ${lo}`);
  if (area) console.log(`  block ${area.blockFips} — ${area.county}, ${area.state}`);
  console.log(`  providers: ${sum.providerCount}   best down: ${sum.bestDownMbps ?? '—'} Mbps   fiber: ${sum.hasFiber}`);
  for (const p of providers) console.log(`  • ${p.provider.padEnd(28)} ${String(p.technology).padEnd(20)} ${p.downMbps ?? '—'}/${p.upMbps ?? '—'} Mbps`);
  console.log(`\n${dataNote()}`);
}
