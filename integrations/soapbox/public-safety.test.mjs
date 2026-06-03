// public-safety.test.mjs — OFFLINE tests. Focus: the PURE RSS parser + Socrata normalization with
// injected data (no network). Run: node --test integrations/soapbox/public-safety.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import {
  CITY_PORTALS, decodeEntities, tag, parseRss, normalizeIncident,
} from './public-safety.mjs';

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
