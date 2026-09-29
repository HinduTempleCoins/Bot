// maps-stops.test.mjs — route-with-stops films on the /maps page: film link + per-stop clips (offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapsBody } from './maps.mjs';

test('a route-with-stops clip links its documentary and lists its stop clips; bad names are dropped', () => {
  const html = mapsBody({ clips: [{ id: 'hannibal-across-the-map', title: 'Hannibal: Across the Map', fromYear: -219, toYear: -201, file: 'hannibal-across-the-map.mp4', file720: 'hannibal-across-the-map_720.mp4', poster: 'hannibal-across-the-map.jpg', credit: 'CC BY 4.0',
    documentary: '/documentaries/hannibal-across-the-map',
    segments: [{ label: 'Cannae', date: '2 August 216 BC', file: 'hannibal-across-the-map-stop10.mp4' }, { label: 'x<script>', date: '', file: '../../etc/passwd' }] }] });
  assert.match(html, /href="\/documentaries\/hannibal-across-the-map">▶ Watch the film/);
  assert.match(html, /<summary>Stops \(1\)<\/summary>/); // the bad entry is not counted
  assert.match(html, /href="\/maps\/media\/hannibal-across-the-map-stop10\.mp4">Cannae<\/a> <span class=muted>· 2 August 216 BC/);
  assert.doesNotMatch(html, /etc\/passwd|<script>/);
  const plain = mapsBody({ clips: [{ id: 'rome', title: 'Rome', fromYear: -509, toYear: 476, file: 'rome.mp4', documentary: 'javascript:alert(1)' }] });
  assert.doesNotMatch(plain, /Watch the film|Stops \(/);
});

test('deep-time clips show "years ago" on their card', () => {
  const html = mapsBody({ clips: [{ id: 'neanderthals', title: 'Neanderthals', file: 'neanderthals.mp4', timeMode: 'ago', fromYear: -430000, toYear: -40000 }] });
  assert.match(html, /430,000 years ago – 40,000 years ago/);
});
