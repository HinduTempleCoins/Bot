// public-safety.test.mjs — OFFLINE tests. Two layers:
//   1. The Police / Public-Safety vertical: the PURE RSS parser + Socrata normalization (no network).
//   2. The signage / incident-board layer: NWS alerts + USGS quakes normalize + soft-fail, scanner reuse,
//      and the combined safetyBoard payload + permanent disclaimer (all via the __setFetch seam, no network).
// Run: node --test integrations/soapbox/public-safety.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import {
  CITY_PORTALS, decodeEntities, tag, parseRss, normalizeIncident,
  nwsAlerts, usgsQuakes, toAlert, toQuake, quakeSeverity, usgsFeed, scannerStations,
  safetyBoard, safeHref, stateName, esc, DISCLAIMER, dataNote, __setFetch,
} from './public-safety.mjs';

// ══ Layer 1: the vertical (pure helpers + Socrata) ══════════════════════════════════════════════════
test('CITY_PORTALS has the four curated cities with a dataset + map + feeds', () => {
  for (const city of ['Dallas', 'New York', 'Los Angeles', 'Chicago']) {
    const p = CITY_PORTALS[city];
    assert.ok(p, `${city} present`);
    assert.ok(p.domain && p.dataset, `${city} has Socrata endpoint`);
    assert.ok(p.map && p.map.id && p.map.type, `${city} has a column map`);
    assert.ok(Array.isArray(p.feeds) && p.feeds.length >= 1, `${city} has a PD feed`);
  }
});

test('decodeEntities unwraps CDATA and decodes entities', () => {
  assert.equal(decodeEntities('<![CDATA[Robbery &amp; Assault]]>'), 'Robbery & Assault');
  assert.equal(decodeEntities('Smith &quot;Doc&quot; &lt;PD&gt;'), 'Smith "Doc" <PD>');
  assert.equal(decodeEntities('  trimmed  '), 'trimmed');
  assert.equal(decodeEntities(null), '');
});

test('tag pulls the first matching element, CDATA-aware, attrs ignored', () => {
  const xml = '<item><title>First</title><link>http://a</link></item><item><title>Second</title></item>';
  assert.equal(tag(xml, 'title'), 'First');
  assert.equal(tag('<title type="html"><![CDATA[Hi]]></title>', 'title'), 'Hi');
  assert.equal(tag('<item></item>', 'title'), null);
});

test('parseRss parses RSS items: title/link/date/summary', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title>Shooting reported downtown</title>
      <link>https://pd.example/1</link>
      <pubDate>Tue, 03 Jun 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[Officers responded to <b>Main St</b>]]></description>
    </item>
    <item>
      <title>Press: weekly blotter</title>
      <link>https://pd.example/2</link>
    </item>
  </channel></rss>`;
  const items = parseRss(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Shooting reported downtown');
  assert.equal(items[0].link, 'https://pd.example/1');
  assert.match(items[0].date, /2026/);
  assert.equal(items[0].summary, 'Officers responded to <b>Main St</b>');
  assert.equal(items[1].link, 'https://pd.example/2');
  assert.equal(items[1].summary, '');
});

test('parseRss handles Atom entries (href link + summary)', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title>Arrest made in burglary case</title>
      <link href="https://pd.example/atom/1" rel="alternate"/>
      <published>2026-06-01T08:00:00Z</published>
      <summary>Suspect in custody.</summary>
    </entry>
  </feed>`;
  const items = parseRss(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Arrest made in burglary case');
  assert.equal(items[0].link, 'https://pd.example/atom/1');
  assert.match(items[0].date, /2026-06-01/);
  assert.equal(items[0].summary, 'Suspect in custody.');
});

test('parseRss is soft on bad input and respects the limit', () => {
  assert.deepEqual(parseRss(null), []);
  assert.deepEqual(parseRss(''), []);
  assert.deepEqual(parseRss('<rss><channel></channel></rss>'), []);
  const many = '<rss>' + '<item><title>x</title></item>'.repeat(50) + '</rss>';
  assert.equal(parseRss(many, 5).length, 5);
});

test('normalizeIncident maps Dallas-shaped row onto the normalized shape', () => {
  const map = CITY_PORTALS.Dallas.map;
  const row = {
    incidentnum: '123-2026',
    nibrs_crime: 'THEFT',
    ucr_offense: 'BURGLARY OF VEHICLE',
    incident_address: '100 MAIN ST',
    date1: '2026-06-03T00:00:00.000',
    latitude: '32.7767',
    longitude: '-96.7970',
  };
  const n = normalizeIncident(row, map);
  assert.equal(n.id, '123-2026');
  assert.equal(n.type, 'THEFT');
  assert.equal(n.description, 'BURGLARY OF VEHICLE');
  assert.equal(n.address, '100 MAIN ST');
  assert.equal(n.lat, 32.7767);
  assert.equal(n.lon, -96.797);
});

test('normalizeIncident coerces bad/empty coords to null, not NaN', () => {
  const map = CITY_PORTALS['Los Angeles'].map;
  const n = normalizeIncident({ dr_no: '9', crm_cd: '510', crm_cd_desc: 'VEHICLE STOLEN', lat: '', lon: 'oops' }, map);
  assert.equal(n.lat, null);
  assert.equal(n.lon, null);
  assert.equal(n.type, '510');
});

test('normalizeIncident returns null for empty/garbage rows', () => {
  assert.equal(normalizeIncident(null, CITY_PORTALS.Chicago.map), null);
  assert.equal(normalizeIncident({}, CITY_PORTALS.Chicago.map), null);
  assert.equal(normalizeIncident({ unrelated: 1 }, CITY_PORTALS.Chicago.map), null);
});

// ══ Layer 2: signage / incident board (NWS + USGS + scanner) ════════════════════════════════════════
const NWS = {
  features: [
    { id: 'https://api.weather.gov/alerts/a1', properties: { event: 'Severe Thunderstorm Warning', severity: 'Severe', headline: 'STORM until 5pm', areaDesc: 'Dallas, TX', sent: '2026-08-23T14:00:00Z', url: 'https://weather.gov/a1' } },
    { id: 'a2', properties: { event: 'Flash Flood Watch', severity: 'Moderate', areaDesc: 'Tarrant, TX', sent: '2026-08-23T13:00:00Z' } },
    { id: 'a3', properties: {} }, // no title → dropped
  ],
};
const QUAKES = {
  features: [
    { id: 'q1', properties: { mag: 4.2, place: '12mi NW of Somewhere', time: 1756000000000, url: 'https://usgs.gov/q1', title: 'M 4.2 - 12mi NW of Somewhere' } },
    { id: 'q2', properties: { mag: 1.1, place: 'Nowhere', time: 1755990000000 } }, // below default 2.5 floor
    { id: 'q3', properties: { mag: 5.6, place: 'Bigplace', time: 1756010000000 } },
  ],
};
const SCANNER_ROWS = [{ stationuuid: 'scan-1', name: 'Dallas Police & Fire Scanner', url_resolved: 'https://scan.example/dpd.mp3', tags: 'scanner,police', state: 'Texas', bitrate: 64 }];

function fakeFetch(over = {}) {
  const fn = async (url) => {
    const u = String(url);
    let body = {};
    if (u.includes('api.weather.gov')) body = over.nws ?? NWS;
    else if (u.includes('earthquake.usgs.gov')) body = over.usgs ?? QUAKES;
    else if (u.includes('radio-browser')) body = over.radio ?? SCANNER_ROWS;
    else body = over.other ?? {};
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  };
  return fn;
}
function install(over) { __setFetch(fakeFetch(over)); }
function restore() { __setFetch(null); }

test('esc escapes html incl. quotes; safeHref allows only http(s)', () => {
  assert.equal(esc(`<b>&"'`), '&lt;b&gt;&amp;&quot;&#39;');
  assert.equal(safeHref('https://usgs.gov/x'), 'https://usgs.gov/x');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref(null), '');
});

test('stateName maps codes to full names, passes names through', () => {
  assert.equal(stateName('TX'), 'Texas');
  assert.equal(stateName('ca'), 'California');
  assert.equal(stateName('Texas'), 'Texas');
  assert.equal(stateName(''), 'Texas');
});

test('DISCLAIMER is the exact required copy; dataNote repeats call 911', () => {
  assert.equal(DISCLAIMER, 'Not an official emergency source — in an emergency, call 911.');
  assert.match(dataNote(), /call 911/);
});

test('quakeSeverity + usgsFeed tiers', () => {
  assert.equal(quakeSeverity(6.1), 'Extreme');
  assert.equal(quakeSeverity(4.6), 'Severe');
  assert.equal(quakeSeverity(3.2), 'Moderate');
  assert.equal(quakeSeverity(2.0), 'Minor');
  assert.equal(quakeSeverity('x'), 'Unknown');
  assert.equal(usgsFeed(4.5, 'week'), '4.5_week');
  assert.equal(usgsFeed(2.5, 'day'), '2.5_day');
  assert.equal(usgsFeed(0.5, 'bogus'), 'all_day'); // bad window → day
});

test('toAlert normalizes an NWS feature to the shaped incident', () => {
  const a = toAlert(NWS.features[0]);
  assert.equal(a.kind, 'alert');
  assert.equal(a.severity, 'Severe');
  assert.equal(a.title, 'Severe Thunderstorm Warning');
  assert.equal(a.area, 'Dallas, TX');
  assert.equal(a.source, 'NWS');
  assert.equal(a.posture, 'point');
  assert.equal(a.url, 'https://weather.gov/a1');
  assert.equal(toAlert(NWS.features[2]), null);
});

test('nwsAlerts returns shaped alerts, drops the titleless one; soft-fails to []', async () => {
  install();
  const out = await nwsAlerts({ state: 'TX' });
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'Severe Thunderstorm Warning');
  restore();
  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await nwsAlerts({ state: 'TX' }), []);
  __setFetch(async () => { throw new Error('network'); });
  assert.deepEqual(await nwsAlerts({ state: 'TX' }), []);
  restore();
});

test('toQuake normalizes a USGS feature', () => {
  const q = toQuake(QUAKES.features[0]);
  assert.equal(q.kind, 'quake');
  assert.equal(q.mag, 4.2);
  assert.equal(q.severity, 'Moderate');
  assert.equal(q.area, '12mi NW of Somewhere');
  assert.equal(q.source, 'USGS');
  assert.equal(q.url, 'https://usgs.gov/q1');
  assert.match(q.time, /^2025-/); // epoch ms → ISO
});

test('usgsQuakes applies the magnitude floor + sorts newest-first; soft-fails to []', async () => {
  install();
  const out = await usgsQuakes({ minMagnitude: 2.5 });
  assert.equal(out.length, 2); // the M1.1 is filtered out
  assert.ok(out.every((q) => q.mag >= 2.5));
  assert.equal(out[0].id, 'q3'); // newest time first
  restore();
  __setFetch(async () => { throw new Error('down'); });
  assert.deepEqual(await usgsQuakes({}), []);
  restore();
});

test('scannerStations reuses radio.scannerStations via the shared fetch seam; soft-fails to []', async () => {
  install();
  const out = await scannerStations({ state: 'TX', limit: 10 });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Dallas Police & Fire Scanner');
  assert.equal(out[0].posture, 'point');
  restore();
  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await scannerStations({ state: 'TX' }), []);
  restore();
});

test('safetyBoard returns alerts/quakes/scanners + the permanent disclaimer', async () => {
  install();
  const board = await safetyBoard({ state: 'TX' });
  assert.ok(Array.isArray(board.alerts) && board.alerts.length >= 1);
  assert.ok(Array.isArray(board.quakes) && board.quakes.length >= 1);
  assert.ok(Array.isArray(board.scanners) && board.scanners.length >= 1);
  assert.equal(board.disclaimer, DISCLAIMER);
  restore();
});

test('safetyBoard never throws — all sources down → empty sections + disclaimer', async () => {
  __setFetch(async () => { throw new Error('all down'); });
  const board = await safetyBoard({ state: 'TX' });
  assert.deepEqual(board.alerts, []);
  assert.deepEqual(board.quakes, []);
  assert.deepEqual(board.scanners, []);
  assert.equal(board.disclaimer, DISCLAIMER);
  restore();
});
