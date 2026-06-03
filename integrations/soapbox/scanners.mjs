// scanners.mjs — the SoapBox Scanner / SDR directory (queue task #80). This is an AGGREGATION /
// DIRECTORY layer only: it curates *where* the public live-audio and browser-SDR receivers are and
// links out to them. It does NOT decode, demodulate, record, or interface with any radio hardware.
//
// ── LEGAL ──────────────────────────────────────────────────────────────────────────────────────
// We relay/link ONLY public, lawfully-broadcast, UNENCRYPTED feeds (fire, EMS, aviation, rail,
// marine, weather, amateur radio). We do NOT intercept, decode, or facilitate interception of any
// private, cellular, paging, or ENCRYPTED communication — that is barred by the Electronic
// Communications Privacy Act (ECPA, 18 U.S.C. §2511) and analogous law abroad. As of the mid-2020s
// roughly ~40% of major-city POLICE traffic has moved to AES-256 encrypted P25 and is therefore
// lawfully unavailable; this directory is deliberately built AROUND that fact (fire/EMS/aviation/
// rail/weather/ham), and never around defeating encryption. All entries are link-outs to feeds the
// operator already publishes; SoapBox hosts none of the audio.
// ────────────────────────────────────────────────────────────────────────────────────────────────
//
//   import { SCANNER_CATEGORIES, sdrReceivers, atcFeeds, scannersSummary } from './scanners.mjs'
//   node integrations/soapbox/scanners.mjs

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

// Curated scanner categories — the lawful, unencrypted service types people actually listen to, each
// with the canonical Broadcastify browse path for that category. `encrypted` flags the service that is
// commonly AES-locked in major metros (police) so the UI can label it as frequently-unavailable rather
// than pretend a feed exists. No private/cellular/encrypted listening is offered.
export const SCANNER_CATEGORIES = [
  { id: 'fire', label: 'Fire & Rescue', desc: 'Fire dispatch & fireground — overwhelmingly in the clear', encrypted: false, browse: 'https://www.broadcastify.com/listen/ctid/Fire-Dispatch' },
  { id: 'ems', label: 'EMS / Medical', desc: 'Emergency medical services dispatch', encrypted: false, browse: 'https://www.broadcastify.com/listen/ctid/EMS-Dispatch' },
  { id: 'aviation', label: 'Aviation (ATC)', desc: 'Air-traffic control — public by ICAO convention', encrypted: false, browse: 'https://www.liveatc.net/' },
  { id: 'rail', label: 'Railroad', desc: 'Road/dispatch/yard channels (AAR VHF)', encrypted: false, browse: 'https://www.broadcastify.com/listen/coll/85' },
  { id: 'marine', label: 'Marine / Coast', desc: 'VHF marine + USCG working channels', encrypted: false, browse: 'https://www.broadcastify.com/listen/coll/93' },
  { id: 'weather', label: 'NOAA Weather Radio', desc: 'NWS all-hazards broadcast (162.400–162.550 MHz)', encrypted: false, browse: 'https://www.weather.gov/nwr/' },
  { id: 'ham', label: 'Amateur Radio', desc: 'Ham repeaters, nets, ARES/RACES — lawful to monitor', encrypted: false, browse: 'https://www.broadcastify.com/listen/coll/16' },
  { id: 'police', label: 'Police / Public Safety', desc: 'Often AES-encrypted in major metros — many channels unavailable', encrypted: true, browse: 'https://www.broadcastify.com/listen/cat/1' },
];

// WebSDR.org & KiwiSDR — *browser* software-defined-radio receivers: a worldwide map/list of public
// stations anyone can tune from a web page (no hardware, no decoding done by us). Static seed list;
// the live KiwiSDR map (kiwisdr.com/public / sdr.hu successor) is the canonical full directory.
export const SDR_DIRECTORIES = [
  { name: 'WebSDR.org', kind: 'index', url: 'http://websdr.org/', desc: 'Master list of public WebSDR receivers worldwide' },
  { name: 'KiwiSDR public map', kind: 'index', url: 'http://kiwisdr.com/public/', desc: 'Live map of public KiwiSDR receivers (HF, browser-tunable)' },
  { name: 'Receiver Book', kind: 'index', url: 'https://www.receiverbook.de/', desc: 'OpenWebRX / KiwiSDR aggregate receiver directory' },
];

const SDR_RECEIVERS = [
  { name: 'University of Twente WebSDR', type: 'WebSDR', band: 'LF–10m HF', location: 'Enschede, NL', url: 'http://websdr.ewi.utwente.nl:8901/' },
  { name: 'WebSDR Hack Green', type: 'WebSDR', band: 'HF / VHF', location: 'Nantwich, UK', url: 'http://hackgreensdr.org:8901/' },
  { name: 'K3FEF KiwiSDR', type: 'KiwiSDR', band: '0–30 MHz HF', location: 'Milford, PA, US', url: 'http://k3fef.com:8073/' },
  { name: 'Northern Utah WebSDR', type: 'WebSDR', band: 'VHF/UHF + HF', location: 'Utah, US', url: 'http://www.sdrutah.org/' },
  { name: 'WebSDR Maasbree', type: 'WebSDR', band: 'HF', location: 'Maasbree, NL', url: 'http://websdr.printar.nl:8901/' },
  { name: 'KFS KiwiSDR (Half Moon Bay)', type: 'KiwiSDR', band: '0–30 MHz HF', location: 'California, US', url: 'http://kfs.kiwisdr.com:8073/' },
];

// LiveATC.net — public air-traffic-control audio (tower/ground/approach/center). Link-out only.
const ATC_FEEDS = [
  { name: 'KJFK — New York JFK', icao: 'KJFK', city: 'New York, US', url: 'https://www.liveatc.net/search/?icao=KJFK' },
  { name: 'KLAX — Los Angeles', icao: 'KLAX', city: 'Los Angeles, US', url: 'https://www.liveatc.net/search/?icao=KLAX' },
  { name: 'KORD — Chicago O\'Hare', icao: 'KORD', city: 'Chicago, US', url: 'https://www.liveatc.net/search/?icao=KORD' },
  { name: 'KATL — Atlanta', icao: 'KATL', city: 'Atlanta, US', url: 'https://www.liveatc.net/search/?icao=KATL' },
  { name: 'EGLL — London Heathrow', icao: 'EGLL', city: 'London, UK', url: 'https://www.liveatc.net/search/?icao=EGLL' },
  { name: 'EHAM — Amsterdam Schiphol', icao: 'EHAM', city: 'Amsterdam, NL', url: 'https://www.liveatc.net/search/?icao=EHAM' },
  { name: 'CYYZ — Toronto Pearson', icao: 'CYYZ', city: 'Toronto, CA', url: 'https://www.liveatc.net/search/?icao=CYYZ' },
  { name: 'YSSY — Sydney', icao: 'YSSY', city: 'Sydney, AU', url: 'https://www.liveatc.net/search/?icao=YSSY' },
];

// NOAA Weather Radio — the seven all-hazards channels + where to find a local transmitter.
export const NOAA_WEATHER = {
  desc: 'NOAA Weather Radio All Hazards (NWR) — continuous NWS broadcast, lawful & unencrypted',
  channels: [
    { ch: 'WX1', mhz: 162.400 }, { ch: 'WX2', mhz: 162.425 }, { ch: 'WX3', mhz: 162.450 },
    { ch: 'WX4', mhz: 162.475 }, { ch: 'WX5', mhz: 162.500 }, { ch: 'WX6', mhz: 162.525 },
    { ch: 'WX7', mhz: 162.550 },
  ],
  coverage: 'https://www.weather.gov/nwr/Maps',
  stations: 'https://www.weather.gov/nwr/station_listing',
};

// Only lawful, unencrypted services may surface in the directory. Police is retained but flagged so the
// UI can show "frequently AES-encrypted / unavailable" rather than imply we offer encrypted listening.
export function listenableCategories(cats = SCANNER_CATEGORIES) {
  return cats.filter((c) => !c.encrypted);
}

/**
 * Browser-SDR receiver directory (WebSDR + KiwiSDR). Static seed list, always returned. If a
 * BROADCASTIFY_KEY is present we *could* enrich elsewhere, but SDR receivers are independent of it —
 * this stays keyless. Optional `type` filter ('WebSDR' | 'KiwiSDR'). Never throws.
 */
export async function sdrReceivers({ type } = {}) {
  let rows = SDR_RECEIVERS.slice();
  if (type) rows = rows.filter((r) => r.type.toLowerCase() === String(type).toLowerCase());
  return { directories: SDR_DIRECTORIES, receivers: rows };
}

/**
 * Air-traffic audio feeds (LiveATC.net link-outs). Optional `icao` filter. Never throws.
 */
export async function atcFeeds({ icao } = {}) {
  let rows = ATC_FEEDS.slice();
  if (icao) rows = rows.filter((f) => f.icao.toLowerCase() === String(icao).toLowerCase());
  return rows;
}

// Broadcastify enrichment — only attempted when an API key is configured. On no-key / any error we
// soft-fail back to the static category browse list. We pull category-level feed counts, nothing more.
async function broadcastifyEnrich() {
  const key = process.env.BROADCASTIFY_KEY;
  if (!key) return { enriched: false, source: 'static' };
  try {
    const u = `https://api.broadcastify.com/owner/?a=feeds&type=top&format=json&key=${encodeURIComponent(key)}`;
    const r = await _fetch(u, { headers: UA });
    if (!r || !r.ok) return { enriched: false, source: 'static' };
    const j = await r.json();
    const top = Array.isArray(j) ? j : (j?.Feeds || j?.feeds || []);
    return { enriched: true, source: 'broadcastify', top: (top || []).slice(0, 20) };
  } catch { return { enriched: false, source: 'static' }; }
}

/**
 * The whole Scanner/SDR tab as one object: categories, the browser-SDR directory, ATC feeds, NOAA
 * weather radio, and (optionally) Broadcastify enrichment. Always resolves — never throws.
 */
export async function scannersSummary() {
  const [sdr, atc, bcfy] = await Promise.all([
    sdrReceivers().catch(() => ({ directories: SDR_DIRECTORIES, receivers: [] })),
    atcFeeds().catch(() => []),
    broadcastifyEnrich().catch(() => ({ enriched: false, source: 'static' })),
  ]);
  return {
    legal: 'Public, unencrypted feeds only. No interception of private/cellular/encrypted comms (ECPA).',
    categories: SCANNER_CATEGORIES,
    listenable: listenableCategories(),
    sdr,
    atc,
    weather: NOAA_WEATHER,
    broadcastify: bcfy,
    counts: { categories: SCANNER_CATEGORIES.length, sdr: sdr.receivers.length, atc: atc.length },
  };
}

if (process.argv[1] && process.argv[1].endsWith('scanners.mjs')) {
  const s = await scannersSummary().catch((e) => ({ error: e.message }));
  if (s.error) { console.error(s.error); process.exit(1); }
  console.log(`\n${s.legal}\n`);
  console.log('== SCANNER CATEGORIES ==');
  for (const c of s.categories) console.log(`  ${c.label.padEnd(24)} ${c.encrypted ? '[often ENCRYPTED]' : ''}  ${c.browse}`);
  console.log('\n== BROWSER SDR RECEIVERS ==');
  for (const r of s.sdr.receivers) console.log(`  ${r.name.padEnd(34)} ${r.type.padEnd(8)} ${r.location.padEnd(18)} ${r.url}`);
  console.log('\n== ATC (LiveATC.net) ==');
  for (const f of s.atc) console.log(`  ${f.name.padEnd(30)} ${f.url}`);
  console.log('\n== NOAA WEATHER RADIO ==');
  for (const ch of s.weather.channels) console.log(`  ${ch.ch}  ${ch.mhz.toFixed(3)} MHz`);
  console.log(`\nBroadcastify enrichment: ${s.broadcastify.source}`);
}
