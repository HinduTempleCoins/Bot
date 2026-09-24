import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundPlace, enrichPrompt, __setFetch } from './genai-place-grounding.mjs';

function stub() {
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('nominatim')) return { ok: true, json: async () => ([{ lat: '32.7', lon: '-97.1', display_name: 'North, Tarrant County, Texas, United States', address: { state: 'Texas', country: 'United States' } }]) };
    if (u.includes('open-meteo')) return { ok: true, json: async () => ({ current_weather: { temperature: 33.5 } }) };
    if (u.includes('wikipedia')) return { ok: true, json: async () => ({ extract: 'North Texas is the Dallas-Fort Worth metroplex region.' }) };
    if (u.includes('commons.wikimedia')) return { ok: true, json: async () => ({ query: { pages: { '1': { title: 'File:Dallas.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/dallas.jpg?utm_source=x', extmetadata: { LicenseShortName: { value: 'CC0' } } }] } } } }) };
    return { ok: false };
  });
}

test('groundPlace reasons a place into a visual brief (offline)', async () => {
  stub();
  const g = await groundPlace('North Texas');
  __setFetch(null);
  assert.equal(g.ok, true);
  assert.match(g.visualBrief, /prairie|mesquite|Dallas/i);   // region visual cues
  assert.match(g.visualBrief, /hot|autumn|°C/i);             // live climate
  assert.equal(g.climate.band, 'hot');
});

test('enrichPrompt appends grounding; no place → unchanged', async () => {
  stub();
  const e = await enrichPrompt('a market scene', 'North Texas');
  assert.equal(e.grounded, true);
  assert.match(e.prompt, /grounded in North Texas/);
  __setFetch(null);
  const none = await enrichPrompt('a market scene', '');
  assert.equal(none.grounded, false);
  assert.equal(none.prompt, 'a market scene');
});

test('referenceImagesFor returns real image models (not words), license-tagged, query stripped', async () => {
  stub();
  const { referenceImagesFor, groundPlace } = await import('./genai-place-grounding.mjs');
  const r = await referenceImagesFor('Dallas skyline', 3);
  assert.ok(r.length >= 1);
  assert.match(r[0].url, /\.jpg$/);           // ?utm_ stripped
  assert.equal(r[0].license, 'CC0');
  const g = await groundPlace('North Texas', { withImages: true });
  assert.ok(g.referenceImages.length >= 1);
});
