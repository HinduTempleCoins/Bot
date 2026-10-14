// identifier.mjs — Hathor's UNIVERSAL IDENTIFIER. One ID brain for every domain the wiki implies, so
// "does a brain for X exist?" becomes "add a few photos of X and she knows it." Two ways to identify,
// both native-CPU:
//   1. EXEMPLAR (grows): DINOv2 image embedding -> FAISS/hnswlib nearest-neighbour against labelled
//      reference photos you add. Gets better every photo (the "only more training solves it" lesson,
//      as a growing index instead of a retrain).
//   2. ZERO-SHOT (works now, no photos): CLIP over the domain's label vocabulary (mined from the wiki).
// identify() tries exemplars first, falls back to zero-shot — so every domain works immediately and
// sharpens as references accrue.
//
// Injectable (pass a vision head + an index factory in tests) + soft-fail. No external API.
//
//   import { createIdentifier, DOMAINS } from './identifier.mjs';
//   const id = createIdentifier({ vision });           // vision = brain-head-vision (embed + classify)
//   await id.identify('photo.jpg', 'pills');            // -> { label, score, via, domain }
//   await id.addExemplar('gems', 'ruby', 'ruby1.jpg');  // grow the ruby class

// Domain -> candidate label vocabulary (for zero-shot) + note. Mined from the wiki's own subjects.
// Labels are phrased as "a photo of X" works best for CLIP; identify() wraps them.
export const DOMAINS = {
  pills:        { note: 'pressed tablets / ecstasy pill forensics', labels: ['an MDMA ecstasy pill', 'a pressed tablet with a logo', 'a prescription pill', 'a capsule', 'a blotter tab', 'a powder', 'a crystal rock'] },
  reagent:      { note: 'presumptive reagent test color (Marquis/Mecke/etc.)', labels: ['a purple-to-black reagent reaction', 'an orange-brown reagent reaction', 'a yellow reagent reaction', 'a green reagent reaction', 'a blue reagent reaction', 'no color change clear reagent'] },
  plants:       { note: 'botanical / entheogen & medicinal plants', labels: ['a cannabis plant', 'hops flowers', 'kava root', 'maca root', 'mucuna pruriens seeds', 'white sage', 'datura flower', 'brugmansia flower', 'Syrian rue seeds', 'mace spice', 'a mint plant', 'an unknown green plant'] },
  herbs_spices: { note: 'culinary & medicinal dried herbs/spices', labels: ['black pepper', 'cinnamon', 'turmeric', 'cloves', 'nutmeg', 'star anise', 'dried sage', 'dried rosemary', 'saffron threads', 'cardamom pods', 'an unknown dried spice'] },
  mushrooms:    { note: 'fungi — SAFETY-CRITICAL, human verify', labels: ['a gilled mushroom', 'a bolete mushroom', 'a bracket fungus', 'a puffball', 'a psilocybe mushroom', 'an amanita mushroom', 'an unknown wild mushroom'] },
  resins_wax:   { note: 'resins, waxes, botanical extracts', labels: ['beeswax', 'a resin lump', 'frankincense resin', 'myrrh resin', 'a wax head cone', 'an encaustic wax block', 'a hash or concentrate', 'an essential oil bottle'] },
  minerals_gems:{ note: 'gemstones, crystals, minerals, rocks', labels: ['a ruby', 'a sapphire', 'an emerald', 'a diamond', 'an amethyst crystal', 'a quartz crystal', 'granite rock', 'marble', 'sandstone', 'a raw mineral ore', 'an unknown gemstone'] },
  soil:         { note: 'soil / dirt types', labels: ['sandy soil', 'clay soil', 'loam soil', 'silty soil', 'peat soil', 'chalky soil', 'dark rich topsoil'] },
  materials:    { note: 'what is it made of (MINC)', labels: ['wood', 'metal', 'fabric', 'stone', 'glass', 'plastic', 'leather', 'paper', 'ceramic', 'water'] },
  symbols:      { note: 'magical/alchemical/ancient symbols & sigils (Crypt-ology)', labels: ['an alchemical symbol', 'an Egyptian hieroglyph', 'a protective amulet', 'an eye of Horus', 'an ankh', 'a pentagram', 'a sigil', 'a planetary symbol', 'a Phoenician letter'] },
  deities:      { note: 'ancient deities / iconography', labels: ['the Egyptian god Khepri (scarab)', 'the goddess Neith', 'the god Melqart', 'the goddess Tanit', 'a Shiva figure', 'a winged sun disk', 'a seated pharaoh statue'] },
  artifacts:    { note: 'ancient art/artifacts', labels: ['a Fayum mummy portrait', 'an encaustic painting', 'an Egyptian wax head cone', 'a Punic stele', 'a clay tablet with cuneiform', 'an ancient amphora', 'a carved relief'] },
  lab_equipment:{ note: 'lab glassware & extraction gear', labels: ['a round-bottom flask', 'a separatory funnel', 'a Buchner funnel', 'a rotary evaporator', 'a graduated cylinder', 'a reflux condenser', 'a TLC plate', 'a magnetic stirrer'] },
  neurostim:    { note: 'TENS/tDCS devices & electrode placement', labels: ['a TENS unit', 'a tDCS headset', 'skin electrodes', 'an EEG cap', 'electrode placement on the head', 'a 9-volt battery circuit'] },
  dishes:       { note: 'food / dishes (culinary corpus)', labels: ['a mother sauce', 'a bowl of soup or broth', 'a fermented food', 'pickled vegetables', 'spiced coffee', 'a plated dish', 'bread', 'a dessert'] },
  logos:        { note: 'crypto / ecosystem logos', labels: ['the STEEM logo', 'the HIVE logo', 'the BLURT logo', 'the BitShares logo', 'the MELEK logo', 'a Bitcoin logo', 'an Ethereum logo', 'an unknown crypto logo'] },
  chart:        { note: 'candlestick chart patterns', labels: ['a bullish candlestick chart going up', 'a bearish candlestick chart going down', 'a sideways ranging chart', 'a double top pattern', 'a head and shoulders pattern', 'a breakout'] },
  faces:        { note: 'historical figures in the wiki', labels: ['Albert Einstein', 'Nikola Tesla', 'Swami Vivekananda', 'Alexander Shulgin', 'a portrait of an unknown person'] },
  documents:    { note: 'legal/doc type (pair with OCR)', labels: ['a court filing', 'a government form', 'a handwritten letter', 'a contract', 'an ID card', 'a receipt', 'a printed article'] },
};

const esc = (s) => String(s || '');

export function createIdentifier({ vision, indexFactory = null, threshold = 0.35 } = {}) {
  // per-domain exemplar index + the label each exemplar id maps to
  const indices = new Map();     // domain -> vector index
  const labelOf = new Map();     // domain -> Map(exemplarId -> label)
  let _mkIndex = indexFactory;

  async function mkIndex(dim) {
    if (_mkIndex) return _mkIndex(dim);
    const { createVectorIndex } = await import('./faiss-index.mjs');
    return createVectorIndex(dim);
  }

  async function ensureDomain(domain, dim) {
    if (!indices.has(domain)) { indices.set(domain, await mkIndex(dim)); labelOf.set(domain, new Map()); }
    return indices.get(domain);
  }

  return {
    domains() { return Object.keys(DOMAINS).concat([...indices.keys()].filter((d) => !DOMAINS[d])); },
    labelsFor(domain) { return (DOMAINS[domain] && DOMAINS[domain].labels) || []; },

    /** Add a labelled reference photo to a domain — the index grows, ID sharpens. */
    async addExemplar(domain, label, image) {
      if (!vision || typeof vision.embed !== 'function') return { ok: false, reason: 'no embedder' };
      const vec = await vision.embed(image);
      if (!vec || !vec.length) return { ok: false, reason: 'embed failed' };
      const idx = await ensureDomain(domain, vec.length);
      const lm = labelOf.get(domain);
      const id = `${esc(label)}#${lm.size}`;
      try { idx.add(id, vec); lm.set(id, esc(label)); return { ok: true, id, count: lm.size }; }
      catch { return { ok: false, reason: 'index add failed' }; }
    },

    /** Identify an image. Exemplars first (if any); else CLIP zero-shot over the domain vocabulary. */
    async identify(image, domain, { k = 3 } = {}) {
      const dom = DOMAINS[domain] ? domain : (indices.has(domain) ? domain : null);
      // 1) exemplar nearest-neighbour, if this domain has reference photos
      if (indices.has(dom) && vision && vision.embed) {
        try {
          const vec = await vision.embed(image);
          if (vec && vec.length) {
            const hits = indices.get(dom).search(vec, k) || [];
            const lm = labelOf.get(dom);
            if (hits.length && (hits[0].score ?? 0) >= threshold) {
              return { label: lm.get(hits[0].id) || hits[0].id, score: hits[0].score, via: 'exemplar', domain: dom,
                candidates: hits.map((h) => ({ label: lm.get(h.id) || h.id, score: h.score })) };
            }
          }
        } catch { /* fall through to zero-shot */ }
      }
      // 2) zero-shot over the domain vocabulary (works with no exemplars)
      const labels = this.labelsFor(dom);
      if (labels.length && vision && vision.classify) {
        const out = await vision.classify(image, labels.map((l) => `a photo of ${l}`), k);
        if (out && out.length) {
          const strip = (s) => String(s).replace(/^a photo of /, '');
          return { label: strip(out[0].label), score: out[0].score, via: 'zero-shot', domain: dom,
            candidates: out.map((o) => ({ label: strip(o.label), score: o.score })) };
        }
      }
      return { label: null, score: 0, via: 'none', domain: dom };
    },
  };
}
