// star-catalog.mjs — the bright NAMED stars (the brightest ~55, J2000), so Hathor can name an individual
// star, not just the constellation it's in. Reference DATA (positions are facts, like the pantheon and
// reagent datasets): { name, ra (hours), dec (degrees), mag (visual), constellation }. The sky lobe
// (brain-sky.mjs) computes each star's current altitude/azimuth from these via astronomy-engine, so this
// stays static. Coordinates are J2000; precession over the 21st century is well under the matching
// tolerance used for "which bright star is over there."

export const STARS = [
  { name: 'Sirius', ra: 6.752, dec: -16.72, mag: -1.46, constellation: 'Canis Major' },
  { name: 'Canopus', ra: 6.399, dec: -52.70, mag: -0.74, constellation: 'Carina' },
  { name: 'Rigil Kentaurus', ra: 14.660, dec: -60.83, mag: -0.27, constellation: 'Centaurus' },
  { name: 'Arcturus', ra: 14.261, dec: 19.18, mag: -0.05, constellation: 'Boötes' },
  { name: 'Vega', ra: 18.616, dec: 38.78, mag: 0.03, constellation: 'Lyra' },
  { name: 'Capella', ra: 5.278, dec: 45.998, mag: 0.08, constellation: 'Auriga' },
  { name: 'Rigel', ra: 5.242, dec: -8.20, mag: 0.13, constellation: 'Orion' },
  { name: 'Procyon', ra: 7.655, dec: 5.22, mag: 0.34, constellation: 'Canis Minor' },
  { name: 'Betelgeuse', ra: 5.919, dec: 7.41, mag: 0.42, constellation: 'Orion' },
  { name: 'Achernar', ra: 1.629, dec: -57.24, mag: 0.46, constellation: 'Eridanus' },
  { name: 'Hadar', ra: 14.064, dec: -60.37, mag: 0.61, constellation: 'Centaurus' },
  { name: 'Altair', ra: 19.846, dec: 8.87, mag: 0.77, constellation: 'Aquila' },
  { name: 'Acrux', ra: 12.443, dec: -63.10, mag: 0.77, constellation: 'Crux' },
  { name: 'Aldebaran', ra: 4.599, dec: 16.51, mag: 0.85, constellation: 'Taurus' },
  { name: 'Antares', ra: 16.490, dec: -26.43, mag: 1.09, constellation: 'Scorpius' },
  { name: 'Spica', ra: 13.420, dec: -11.16, mag: 1.04, constellation: 'Virgo' },
  { name: 'Pollux', ra: 7.755, dec: 28.03, mag: 1.14, constellation: 'Gemini' },
  { name: 'Fomalhaut', ra: 22.961, dec: -29.62, mag: 1.16, constellation: 'Piscis Austrinus' },
  { name: 'Deneb', ra: 20.690, dec: 45.28, mag: 1.25, constellation: 'Cygnus' },
  { name: 'Mimosa', ra: 12.795, dec: -59.69, mag: 1.25, constellation: 'Crux' },
  { name: 'Regulus', ra: 10.139, dec: 11.97, mag: 1.35, constellation: 'Leo' },
  { name: 'Adhara', ra: 6.977, dec: -28.97, mag: 1.50, constellation: 'Canis Major' },
  { name: 'Castor', ra: 7.577, dec: 31.89, mag: 1.57, constellation: 'Gemini' },
  { name: 'Shaula', ra: 17.560, dec: -37.10, mag: 1.62, constellation: 'Scorpius' },
  { name: 'Gacrux', ra: 12.519, dec: -57.11, mag: 1.63, constellation: 'Crux' },
  { name: 'Bellatrix', ra: 5.418, dec: 6.35, mag: 1.64, constellation: 'Orion' },
  { name: 'Elnath', ra: 5.438, dec: 28.61, mag: 1.65, constellation: 'Taurus' },
  { name: 'Miaplacidus', ra: 9.220, dec: -69.72, mag: 1.67, constellation: 'Carina' },
  { name: 'Alnilam', ra: 5.604, dec: -1.20, mag: 1.69, constellation: 'Orion' },
  { name: 'Alioth', ra: 12.900, dec: 55.96, mag: 1.76, constellation: 'Ursa Major' },
  { name: 'Alnitak', ra: 5.679, dec: -1.94, mag: 1.77, constellation: 'Orion' },
  { name: 'Dubhe', ra: 11.062, dec: 61.75, mag: 1.79, constellation: 'Ursa Major' },
  { name: 'Mirfak', ra: 3.405, dec: 49.86, mag: 1.79, constellation: 'Perseus' },
  { name: 'Wezen', ra: 7.140, dec: -26.39, mag: 1.83, constellation: 'Canis Major' },
  { name: 'Alkaid', ra: 13.792, dec: 49.31, mag: 1.85, constellation: 'Ursa Major' },
  { name: 'Sargas', ra: 17.622, dec: -42.998, mag: 1.86, constellation: 'Scorpius' },
  { name: 'Menkalinan', ra: 5.992, dec: 44.95, mag: 1.90, constellation: 'Auriga' },
  { name: 'Atria', ra: 16.811, dec: -69.03, mag: 1.91, constellation: 'Triangulum Australe' },
  { name: 'Alhena', ra: 6.629, dec: 16.40, mag: 1.93, constellation: 'Gemini' },
  { name: 'Peacock', ra: 20.427, dec: -56.74, mag: 1.94, constellation: 'Pavo' },
  { name: 'Alnair', ra: 22.137, dec: -46.96, mag: 1.74, constellation: 'Grus' },
  { name: 'Mirzam', ra: 6.378, dec: -17.96, mag: 1.98, constellation: 'Canis Major' },
  { name: 'Alphard', ra: 9.460, dec: -8.66, mag: 1.98, constellation: 'Hydra' },
  { name: 'Polaris', ra: 2.530, dec: 89.26, mag: 1.98, constellation: 'Ursa Minor' },
  { name: 'Hamal', ra: 2.119, dec: 23.46, mag: 2.00, constellation: 'Aries' },
  { name: 'Algieba', ra: 10.333, dec: 19.84, mag: 2.01, constellation: 'Leo' },
  { name: 'Diphda', ra: 0.726, dec: -17.99, mag: 2.04, constellation: 'Cetus' },
  { name: 'Nunki', ra: 18.921, dec: -26.30, mag: 2.05, constellation: 'Sagittarius' },
  { name: 'Alpheratz', ra: 0.140, dec: 29.09, mag: 2.06, constellation: 'Andromeda' },
  { name: 'Kochab', ra: 14.845, dec: 74.16, mag: 2.07, constellation: 'Ursa Minor' },
  { name: 'Rasalhague', ra: 17.582, dec: 12.56, mag: 2.08, constellation: 'Ophiuchus' },
  { name: 'Algol', ra: 3.136, dec: 40.96, mag: 2.12, constellation: 'Perseus' },
  { name: 'Denebola', ra: 11.818, dec: 14.57, mag: 2.11, constellation: 'Leo' },
  { name: 'Mintaka', ra: 5.533, dec: -0.30, mag: 2.23, constellation: 'Orion' },
  { name: 'Mizar', ra: 13.399, dec: 54.93, mag: 2.23, constellation: 'Ursa Major' },
  { name: 'Markab', ra: 23.079, dec: 15.21, mag: 2.49, constellation: 'Pegasus' },
];

const norm = (s) => String(s || '').toLowerCase().trim();
export function getStar(name) { const n = norm(name); return STARS.find((s) => norm(s.name) === n) || null; }
export function starsInConstellation(c) { const n = norm(c); return STARS.filter((s) => norm(s.constellation) === n); }
