// genai-sky.mjs — cloud/sky knowledge for grounded scene reasoning. Default sky = the North Texas
// prairie sky (big fair-weather cumulus over a wide open sky); the full taxonomy incl. pyrocumulus so the
// system can render any sky on request. Pure data + helpers, no network.
export const CLOUDS = {
  cumulus: 'puffy white fair-weather cumulus, flat bases, bright cauliflower tops',
  'cumulus humilis': 'small flat fair-weather cumulus scattered across a wide sky',
  'cumulus congestus': 'tall building cumulus towers, pre-storm',
  cumulonimbus: 'towering thunderhead with an anvil top and dark base, dramatic',
  stratus: 'low flat grey overcast sheet',
  stratocumulus: 'lumpy low grey-white cloud rolls',
  altostratus: 'mid-level grey veil dimming the sun',
  altocumulus: 'mid-level white and grey cloudlets in patches',
  cirrus: 'high wispy ice-crystal streaks',
  cirrocumulus: 'high rippled mackerel sky',
  cirrostratus: 'thin high veil making a halo around the sun',
  nimbostratus: 'thick dark rain-bearing overcast',
  mammatus: 'pouch-like bulges hanging under a storm anvil, ominous',
  lenticular: 'smooth lens / UFO-shaped clouds stacked over mountains',
  'shelf cloud': 'low horizontal wedge riding a storm gust front',
  'roll cloud': 'long detached tube-shaped rolling cloud',
  supercell: 'rotating storm mothership with a lowered wall cloud',
  pyrocumulus: 'fire cloud — a cauliflower cloud boiling up over a wildfire or volcano, dirty grey-brown base',
  pyrocumulonimbus: 'towering fire-thunderstorm from an intense wildfire, generating its own lightning',
  noctilucent: 'rare electric-blue glowing clouds at the edge of space after dusk',
  'morning glory': 'rare vast rolling tube clouds sweeping in at dawn',
  fog: 'ground-level cloud, soft low-visibility haze',
  clear: 'clear deep-blue sky, few if any clouds',
};
export function skyCue(type) { const k = String(type || '').toLowerCase().trim(); return CLOUDS[k] || null; }
export function cloudTypes() { return Object.keys(CLOUDS); }
// Default sky for a place — defaults to the North Texas prairie sky when nothing else matches.
export function defaultSkyFor(place = '') {
  const p = String(place).toLowerCase();
  if (/desert|arizona|nevada|sahara/.test(p)) return 'clear deep-blue sky with a few high cirrus';
  if (/tropic|hawaii|caribbean|bali/.test(p)) return 'scattered puffy cumulus over a turquoise horizon';
  if (/mountain|alp|colorado|himalaya|andes/.test(p)) return `${CLOUDS.lenticular}, with building afternoon cumulus`;
  if (/uk|london|seattle|pacific northwest|ireland/.test(p)) return `${CLOUDS.stratus}, soft diffuse light`;
  // default (and explicitly North Texas): the big prairie cumulus sky
  return `${CLOUDS.cumulus} over a wide open sky (the classic North Texas prairie sky)`;
}
