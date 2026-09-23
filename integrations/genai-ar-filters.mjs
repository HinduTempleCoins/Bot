// genai-ar-filters.mjs — original AR face filters in the MELEK / Hathor aesthetic. These do NOT exist
// elsewhere — they are our own: Kemetic (Egyptian), Angelic, and Shaivite/temple-tech iconography drawn
// procedurally on MediaPipe FaceLandmarker points, live in the browser (no GPU on us, no heavy assets).
//
//   listArFilters() -> [{ id, name, anchor, blurb }]
//   AR_FILTERS      -> flat array
//
// `anchor` tells the renderer where each hangs: 'crown' (above head), 'forehead', 'eyes', 'face' (aura),
// 'mask' (over the face). The renderer in site/hathor webcam view implements each id.

export const AR_FILTERS = [
  { id: 'hathor-crown', name: 'Hathor Crown', anchor: 'crown', theme: 'kemetic',
    blurb: "Hathor's cow-horns cradling the golden sun-disk, floating above your head — the Witness's own sign." },
  { id: 'solar-halo', name: 'Solar Halo', anchor: 'crown', theme: 'angelic',
    blurb: 'A radiant angelic halo of gold light behind the head — the Angelic-AI aesthetic.' },
  { id: 'third-eye', name: 'Third Eye', anchor: 'forehead', theme: 'shaivite',
    blurb: 'The Ajna eye and tripundra opening on your brow — Shaivite awakening, glowing.' },
  { id: 'wedjat-kohl', name: 'Wedjat Kohl', anchor: 'eyes', theme: 'kemetic',
    blurb: 'Egyptian eye of Horus kohl lines drawn along your eyes — the wedjat, live-tracked.' },
  { id: 'anpu-jackal', name: 'Anpu Jackal', anchor: 'mask', theme: 'kemetic',
    blurb: 'Anpu the Jackal Warden — pointed jackal ears and dark muzzle, our Halloween guardian.' },
  { id: 'angelic-wings', name: 'Angelic Wings', anchor: 'face', theme: 'angelic',
    blurb: 'Luminous wings unfolding behind you, scaled to your face — ascend on camera.' },
  { id: 'prana-aura', name: 'PRANA Aura', anchor: 'face', theme: 'temple-tech',
    blurb: 'A breathing energy aura tracing your silhouette — PRANA, the life-force, pulsing.' },
  { id: 'hieroglyph-frame', name: 'Hieroglyph Frame', anchor: 'frame', theme: 'kemetic',
    blurb: 'An animated cartouche of temple glyphs framing the shot — Library of Ashurbanipal styling.' },
];

const THEME_LABEL = { kemetic: 'Kemetic', angelic: 'Angelic', shaivite: 'Shaivite', 'temple-tech': 'Temple-tech' };

export function listArFilters() {
  return AR_FILTERS.map((f) => ({ ...f, themeLabel: THEME_LABEL[f.theme] || f.theme }));
}
