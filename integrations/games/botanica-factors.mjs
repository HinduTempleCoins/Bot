// botanica-factors.mjs — the NON-GROWING factors of the Botanica economy.
//
// Operator, 2026-09-08: "we need to Start looking at Things like Diatemachious Earth, and Pottery
// with Gods on it and stuff, just like non-Growing maybe Burnable, maybe Makable, Factors."
//
// Everything Botanica has modelled so far grows. plant-catalog grows plants, plant-products
// processes what they yield, industrial-alchemical runs the deep chains. But a real botanica — the
// shop and the farm both — is at least half made of things that were never alive on your land:
// the diatomaceous earth you dust the beds with, the clay the pots are thrown from, the resin that
// burns on the charcoal, the bowl the offering sits in. Those behave NOTHING like a plant. A plant
// is a faucet that mints on a timer. A burnable is a terminal sink. A vessel is a durable you buy
// once and keep. A mineral is an import you pay for. A made good converts inputs into outputs.
//
// So the five classes are the five economic behaviours, not five vibes:
//
//   grown     seeds, live plants, cuttings          — mints on a timer (the existing catalogs)
//   mineral   diatomaceous earth, clay, lime, salt  — imported/dug; a CURRENCY sink at purchase
//   burnable  incense, resin, charcoal, smudge      — consumed on use; the TERMINAL sink
//   vessel    pottery, censers, planters, murtis    — durable; one-time sink, held forever
//   made      what a holder crafts from the rest    — converter: burns inputs, mints one output
//
// ── The four attributes that actually differ from a live plant ────────────────────────────────────
//   shelfLifeDays   null = indefinite. Fired clay and dry mineral do not spoil; a resin does not
//                   either, but an infused oil or a hydrosol does. A seed has viability; a stone
//                   does not. This is the field a live plant has no analogue for.
//   consumedOnUse   true = it leaves circulation the moment it is used. The deflation lever.
//   makeable        true = the HOLDER can produce it themselves from things they already have.
//                   The difference between a shop item and a cottage industry.
//   inputTo         what this is an input TO. A factor nothing consumes is dead stock.
//
// ── Why the safety fields are structural, not footnotes ───────────────────────────────────────────
// validateFactors() FAILS if a food-contact vessel does not declare its lead/cadmium status and a
// leach test, if a burnable does not declare ventilation and CITES status, or if a mineral does not
// declare its dust PPE. The facts are load-bearing because they are real-world true:
//   • Food-grade vs calcined (pool/filter) diatomaceous earth is the whole ballgame. Calcining
//     converts amorphous silica to CRISTOBALITE. Inhalation is a hazard for BOTH grades.
//   • A devotional bowl that holds prasad people eat IS a food-contact surface. Lead glaze on
//     low-fired earthenware is a documented poisoning route, not a theoretical one.
//   • Agarwood is CITES Appendix II. "Palo santo" is two different trees, one of which is also
//     Appendix II. Sourcing provenance is a field.
// This is the charter's rule: teach the safety AS PART OF the build. Nothing here is withheld.
//
// PURE: no network, no clock, no disk, no keys. Soft-fail-never-throw. Offline-tested.
//
//   import { FACTORS, FACTOR_CLASSES, factorById, factorsByClass, safetyOf, sourcingOf,
//            FACTOR_RECIPES, FACTOR_VALUE, auditNoPump, economyRoleOf, factorEconomy,
//            validateFactors, esc } from './games/botanica-factors.mjs'
//   node integrations/games/botanica-factors.mjs

import { validateNoMoneyPump } from './recipes.mjs';
import { createLedger, registerFaucet, registerDrain, project, assertBalanced } from './economy-balance.mjs';

export const FACTOR_CLASSES = ['grown', 'mineral', 'burnable', 'vessel', 'made'];

// What each class DOES to the token economy. This is the whole reason the taxonomy exists.
export const ECONOMY_ROLES = {
  grown: { role: 'faucet', note: 'mints material on a timer — the emission side' },
  mineral: { role: 'import', note: 'bought/dug — currency leaves the player at purchase; no token minted' },
  burnable: { role: 'sink', note: 'consumed on use — the material leaves circulation permanently' },
  vessel: { role: 'durable', note: 'one-time purchase sink, then held forever; tradeable, never burned' },
  made: { role: 'converter', note: 'destroys inputs to mint one output — net material sink at effort cost' },
};

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// MINERAL — dug or bought, never grown. Dry, indefinite shelf life, and every one of them is a DUST.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const MINERALS = [
  {
    id: 'de_food_grade',
    name: 'Diatomaceous Earth (food grade)',
    class: 'mineral',
    domains: ['ranch', 'medicine', 'industrial', 'trade', 'external'],
    shelfLifeDays: null,
    consumedOnUse: true,          // dusted onto a bed, it is gone into the environment
    makeable: false,              // mined from a freshwater diatomite deposit
    inputTo: ['pest_dusting', 'seed_pelleting', 'anticaking', 'de_slurry'],
    grade: 'food',
    safety: {
      dust: true,
      // Food-grade DE is >80% AMORPHOUS silica; crystalline silica is specified under 1%.
      crystallineSilica: '<1% (amorphous diatomite, uncalcined)',
      // The load-bearing correction: "food grade" is about INGESTION, not INHALATION.
      // Any fine dust is a respiratory irritant, and the amorphous/crystalline line does not
      // make a lungful of it harmless.
      ppe: 'N95 minimum when dusting; P100 for sustained or overhead application. Eye protection. Dust applicator, not a hand-toss.',
      inhalationNote: '"Food grade" describes what is safe to SWALLOW, not what is safe to BREATHE. Wear the respirator for both grades.',
      foodContactSafe: true,
      regulatory: 'US FDA 21 CFR 573.940 — diatomaceous earth as an animal-feed anticaking agent, not to exceed 2% by weight of the complete feed. EPA-registered as a mechanical insecticide.',
      ecological: 'NON-SELECTIVE. It kills any arthropod that walks through it, including honeybees and other pollinators. Do not dust open blooms or anywhere foragers land. Inert once wet; reapply after rain, which is also the window in which it is not killing bees.',
      mechanism: 'Mechanical, not chemical: the diatom frustules abrade the insect cuticle wax and the insect dies of desiccation. No resistance develops. Also means it does nothing while damp.',
    },
    cite: ['US FDA 21 CFR 573.940', 'US EPA insecticide registration (mechanical/desiccant mode of action)'],
  },
  {
    id: 'de_calcined',
    name: 'Diatomaceous Earth (pool / filter grade, calcined)',
    class: 'mineral',
    domains: ['industrial', 'trade', 'external'],
    shelfLifeDays: null,
    consumedOnUse: true,
    makeable: false,
    inputTo: ['filtration'],
    grade: 'calcined',
    safety: {
      dust: true,
      // Calcining (roughly 800–1100 °C, higher with a soda-ash flux) converts the amorphous
      // silica of raw diatomite into CRISTOBALITE — a crystalline polymorph. Flux-calcined
      // filter aids are commonly the majority crystalline by weight.
      crystallineSilica: 'HIGH — calcining converts amorphous silica to cristobalite; flux-calcined filter grades are commonly 60%+ crystalline silica',
      ppe: 'P100 / half-face respirator, wet handling, no dry sweeping, no compressed-air cleanup. Treat as a regulated silica dust.',
      inhalationNote: 'Respirable crystalline silica is IARC Group 1 (carcinogenic to humans) for occupational inhalation exposure, and the cause of silicosis. US OSHA respirable crystalline silica PEL is 50 µg/m³ as an 8-hour TWA with a 25 µg/m³ action level (29 CFR 1910.1053).',
      foodContactSafe: false,
      neverDo: 'NEVER use pool/filter grade as an insecticide, in a garden bed, on an animal, or in feed. It is not a stronger version of the food grade — it is a different, worse material for that job and a genuine respiratory hazard.',
      regulatory: 'Swimming-pool and industrial filtration medium only.',
    },
    cite: ['IARC Monograph 100C — crystalline silica (quartz and cristobalite)', 'US OSHA 29 CFR 1910.1053'],
  },
  {
    id: 'clay_body',
    name: 'Clay Body (throwing clay)',
    class: 'mineral',
    domains: ['craft', 'building', 'art', 'trade', 'external'],
    shelfLifeDays: null,              // wedge and re-wet forever; it is only "dead" once fired
    consumedOnUse: true,              // consumed into a vessel
    makeable: false,                  // dug and levigated from a deposit
    inputTo: ['terracotta_planter', 'offering_bowl', 'censer', 'diya', 'murti_small'],
    safety: {
      dust: true,
      crystallineSilica: 'present — most clay bodies carry free quartz; dry clay dust is respirable crystalline silica',
      ppe: 'Wet-clean the studio. Mop and sponge, never sweep or vacuum dry. N95/P100 while mixing dry body or sanding greenware.',
      inhalationNote: 'Potters get silicosis from studio housekeeping, not from throwing. The wet process is safe; the dry dust is the hazard.',
      foodContactSafe: false,         // only once fired AND glazed to a food-safe standard
    },
    cite: ['US OSHA 29 CFR 1910.1053'],
  },
  {
    id: 'kaolin',
    name: 'Kaolin (china clay)',
    class: 'mineral',
    domains: ['craft', 'art', 'medicine', 'cosmetic', 'trade', 'external'],
    shelfLifeDays: null,
    consumedOnUse: true,
    makeable: false,
    inputTo: ['clay_body', 'glaze_frit', 'particle_film'],
    safety: {
      dust: true,
      crystallineSilica: 'low but non-zero in most commercial grades',
      ppe: 'N95 when handling dry powder.',
      foodContactSafe: true,
      regulatory: 'Also a horticultural particle film — a white kaolin coating on leaves and fruit deters some insects and reduces sunscald. Distinct use from the pottery use, same mineral.',
    },
    cite: [],
  },
  {
    id: 'ag_lime',
    name: 'Agricultural Lime (calcium carbonate)',
    class: 'mineral',
    domains: ['ranch', 'building', 'trade', 'external'],
    shelfLifeDays: null,
    consumedOnUse: true,
    makeable: false,
    inputTo: ['soil_amendment', 'glaze_frit'],
    safety: {
      dust: true,
      ppe: 'Dust mask and eye protection. Mildly alkaline, not caustic.',
      neverDo: 'Do not confuse with QUICKLIME or HYDRATED LIME — see quicklime. Getting the wrong bag is the injury.',
      foodContactSafe: true,
    },
    cite: [],
  },
  {
    id: 'quicklime',
    name: 'Quicklime / Hydrated Lime (CaO, Ca(OH)₂)',
    class: 'mineral',
    domains: ['building', 'industrial', 'trade', 'external'],
    shelfLifeDays: 365,               // absorbs CO₂ and reverts; a real, finite shelf life
    consumedOnUse: true,
    makeable: true,                   // calcine limestone in the kiln — a real chain
    station: 'kiln',
    recipe: [{ item: 'ag_lime', qty: 2 }, { item: 'charcoal', qty: 1 }],
    effort: 4,
    inputTo: ['mortar', 'lime_wash', 'tanning', 'nixtamal'],
    safety: {
      dust: true,
      // This is the one in the mineral shelf that will actually hurt someone today.
      ppe: 'Sealed goggles (not safety glasses), chemical gloves, long sleeves, P100. Non-negotiable.',
      corrosive: 'CAUSTIC. Quicklime reacts EXOTHERMICALLY with water — including the water in your eyes, your sweat and your lungs. It causes alkaline burns that keep burning, and alkaline eye burns can blind. Slaking is a heat-and-spatter event: add lime to water, never water to lime, and stand back.',
      firstAid: 'Skin: brush the DRY powder off first, then flood with water for 15+ minutes. Eyes: irrigate 15+ minutes and get emergency care — alkaline eye injury is a genuine emergency, not a wait-and-see.',
      neverDo: 'Never store in a container that can trap moisture and pressure. Never use in place of agricultural lime for pH — it will scorch soil biology and burn skin.',
      foodContactSafe: false,
    },
    cite: [],
  },
  {
    id: 'natron',
    name: 'Natron (soda ash / sodium bicarbonate)',
    class: 'mineral',
    domains: ['industrial', 'craft', 'food', 'trade', 'external'],
    shelfLifeDays: null,
    consumedOnUse: true,
    makeable: false,
    inputTo: ['glaze_frit', 'preservation', 'soap'],
    safety: {
      dust: true,
      ppe: 'Dust mask. Mildly alkaline; irritating to eyes.',
      foodContactSafe: true,
      regulatory: 'The Egyptian preservative and the flux behind soda glaze — the mineral that ties the Mediterranean corpus to the kiln.',
    },
    cite: [],
  },
  {
    id: 'copper_stock',
    name: 'Copper / Brass Stock',
    class: 'mineral',
    domains: ['craft', 'industrial', 'trade', 'external'],
    shelfLifeDays: null,
    consumedOnUse: true,
    makeable: false,
    inputTo: ['kalash', 'censer'],
    safety: {
      dust: false,
      ppe: 'Gloves when cutting or filing; swarf cuts. Respirator for hot work — brass fume contains zinc (metal fume fever).',
      foodContactSafe: false,
      // The reason traditional copper water pots are TIN-LINED (kalai) and get re-lined.
      corrosive: 'Copper leaches into ACIDIC contents. The US FDA Food Code prohibits copper in contact with foods below about pH 6 — citrus, vinegar, wine, buttermilk, tamarind. A copper vessel for plain water is traditional and fine; the same vessel for lemon water is a copper-toxicity route (nausea, vomiting, liver injury at dose). Traditional practice tin-lines the interior (kalai) and RE-LINES it as the tin wears — the re-lining is the safety step, not a cosmetic one.',
    },
    cite: ['US FDA Food Code — copper limitation on acidic foods'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// BURNABLE — consumed on use. The terminal sink, and the shelf with the sourcing problem.
//
// sourcing.cites values: 'appendix-i' | 'appendix-ii' | 'appendix-iii' | 'none'
//   'none' means NOT CITES-listed as of verifiedOn — it does NOT mean unregulated or unthreatened.
//   citesWatch flags a taxon under active listing pressure, so a stale table is visibly stale.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const SOURCING_VERIFIED_ON = '2026-09-08';

const BURNABLES = [
  {
    id: 'frankincense_tears',
    name: 'Frankincense Tears (Boswellia)',
    class: 'burnable',
    domains: ['incense', 'medicine', 'perfume', 'trade'],
    shelfLifeDays: null,              // resin does not spoil; aroma fades over years
    consumedOnUse: true,
    makeable: true,
    station: 'sorting-bench',
    recipe: [{ item: 'resin', qty: 2 }],
    effort: 2,
    inputTo: ['dhoop_cone', 'havan_samagri', 'incense_stick', 'vibhuti'],
    sourcing: {
      species: 'Boswellia sacra / B. carterii / B. papyrifera',
      cites: 'none',
      citesWatch: true,
      iucn: 'B. papyrifera assessed as declining; several Boswellia populations are failing to regenerate',
      pressure: 'Over-tapping is the mechanism. A tree tapped too often or too deep produces resin now and no seedlings later — stands are aging out with no replacement. Frequency of tapping, not the act of tapping, is the harm.',
      askYourSupplier: 'Which species, which country, how many taps per tree per season, and is the stand under a community management agreement?',
      verifiedOn: SOURCING_VERIFIED_ON,
    },
    safety: { combustion: true },
    cite: ['IUCN Red List — Boswellia papyrifera'],
  },
  {
    id: 'myrrh_resin',
    name: 'Myrrh Resin (Commiphora)',
    class: 'burnable',
    domains: ['incense', 'medicine', 'perfume', 'trade'],
    shelfLifeDays: null,
    consumedOnUse: true,
    makeable: true,
    station: 'sorting-bench',
    recipe: [{ item: 'resin', qty: 2 }],
    effort: 2,
    inputTo: ['dhoop_cone', 'havan_samagri'],
    sourcing: {
      species: 'Commiphora myrrha and relatives',
      cites: 'none',
      citesWatch: false,
      iucn: 'not broadly assessed; wild-harvested from dryland stands under grazing and drought pressure',
      pressure: 'Wild collection from rangeland; the risk is land-use change and drought more than harvest itself.',
      askYourSupplier: 'Country of origin and whether the collectors are the community that holds the land.',
      verifiedOn: SOURCING_VERIFIED_ON,
    },
    safety: { combustion: true },
    cite: [],
  },
  {
    id: 'agarwood_chips',
    name: 'Agarwood / Oud Chips (Aquilaria)',
    class: 'burnable',
    domains: ['incense', 'perfume', 'trade', 'external'],
    shelfLifeDays: null,
    consumedOnUse: true,
    makeable: false,
    inputTo: ['censer_burn'],
    sourcing: {
      species: 'Aquilaria spp. and Gyrinops spp.',
      // Confident: ALL Aquilaria and Gyrinops species have been on Appendix II since 2005.
      cites: 'appendix-ii',
      citesWatch: false,
      iucn: 'several Aquilaria species threatened in the wild',
      pressure: 'Wild agarwood forms only when a tree is infected; harvesters fell many trees to find one that has it. That is the whole problem. Inoculated PLANTATION agarwood is the sustainable product and it is widely available.',
      permit: 'International trade requires CITES documentation. A seller who cannot produce it is either not exporting legally or is not selling agarwood.',
      askYourSupplier: 'Plantation or wild? Inoculated in what year? CITES export permit number?',
      verifiedOn: SOURCING_VERIFIED_ON,
    },
    safety: { combustion: true },
    cite: ['CITES Appendices — Aquilaria spp. and Gyrinops spp., Appendix II (listed 2005)'],
  },
  {
    id: 'sandalwood_powder',
    name: 'Sandalwood Powder (Santalum)',
    class: 'burnable',
    domains: ['incense', 'perfume', 'cosmetic', 'trade'],
    shelfLifeDays: null,
    consumedOnUse: true,
    makeable: true,
    station: 'mill',
    recipe: [{ item: 'timber', qty: 1 }],
    effort: 3,
    inputTo: ['incense_stick', 'dhoop_cone', 'havan_samagri', 'mala'],
    sourcing: {
      species: 'Santalum album (Indian) / Santalum spicatum (Australian)',
      cites: 'none',
      citesWatch: false,
      iucn: 'Santalum album assessed as Vulnerable',
      pressure: 'S. album is slow-growing, hemiparasitic and heavily poached. India regulates it hard — historically state-vested trees even on private land, with export controls on the raw wood and oil. Australian S. spicatum plantation is the honest substitute and smells like itself, not like a fake S. album.',
      nameCollision: 'Do not confuse with Pterocarpus santalinus ("red sandalwood" / red sanders), which IS CITES Appendix II. Same English word, different regulatory world.',
      askYourSupplier: 'Species binomial — not "sandalwood" — plus plantation and country.',
      verifiedOn: SOURCING_VERIFIED_ON,
    },
    safety: { combustion: true },
    cite: ['IUCN Red List — Santalum album', 'CITES Appendices — Pterocarpus santalinus, Appendix II'],
  },
  {
    id: 'palo_santo_sticks',
    name: 'Palo Santo Sticks (Bursera graveolens)',
    class: 'burnable',
    domains: ['incense', 'trade', 'external'],
    shelfLifeDays: null,
    consumedOnUse: true,
    makeable: false,
    inputTo: ['censer_burn'],
    sourcing: {
      species: 'Bursera graveolens',
      cites: 'none',
      citesWatch: false,
      iucn: 'Bursera graveolens is not the threatened one — the confusion is',
      // This name collision is the actual sourcing hazard on this shelf.
      nameCollision: 'CRITICAL: "palo santo" names at least two unrelated trees. Bursera graveolens (the incense stick) is NOT CITES-listed. Guaiacum spp. — lignum vitae, also sold as "palo santo" — IS CITES Appendix II. A vendor using the Spanish common name alone has told you nothing about what is legal to ship.',
      pressure: 'The traditional and legal harvest is NATURALLY FALLEN DEADWOOD that has aged on the forest floor for years — that ageing is what develops the aroma, so freshly cut wood is both illegal and bad product. Peru and Ecuador require harvest and transport permits; cutting living trees is prohibited in Peru.',
      askYourSupplier: 'Binomial (Bursera graveolens), country, and the harvest/transport permit. "Sustainably sourced" on a label is not a permit.',
      verifiedOn: SOURCING_VERIFIED_ON,
    },
    safety: { combustion: true },
    cite: ['CITES Appendices — Guaiacum spp., Appendix II'],
  },
  {
    id: 'white_sage_bundle',
    name: 'White Sage Bundle (Salvia apiana)',
    class: 'burnable',
    domains: ['incense', 'trade'],
    shelfLifeDays: 1095,              // dried herb: aroma and oils fade; ~3 years is honest
    consumedOnUse: true,
    makeable: true,
    station: 'drying-shed',
    recipe: [{ item: 'herb', qty: 3 }],
    effort: 2,
    inputTo: ['censer_burn'],
    sourcing: {
      species: 'Salvia apiana',
      cites: 'none',
      citesWatch: false,
      iucn: 'not listed as threatened rangewide; local Southern California populations under real poaching pressure',
      pressure: 'Commercial wild-poaching from public and tribal land in Southern California is documented and prosecuted. CULTIVATED white sage is easy, cheap, and removes the entire problem — it grows readily in a dry garden.',
      culturalNote: 'Salvia apiana is a ceremonial plant of specific Southern California Indigenous nations, and its mass sale as a wellness product is contested BY those nations — not by outside observers on their behalf. Botanica sells the cultivated plant and the seed, names whose plant it is, and does not market it with borrowed ceremonial language. A Shaivite temple that expects its own murtis to be handled with care extends the same to somebody else\'s ceremony.',
      askYourSupplier: 'Cultivated or wild? If wild, on whose land and with what permission?',
      verifiedOn: SOURCING_VERIFIED_ON,
    },
    safety: { combustion: true },
    cite: [],
  },
  {
    id: 'charcoal_disc',
    name: 'Charcoal Disc (self-igniting)',
    class: 'burnable',
    domains: ['incense', 'energy', 'trade', 'external'],
    shelfLifeDays: 730,               // the oxidiser absorbs moisture and stops lighting cleanly
    consumedOnUse: true,
    makeable: false,                  // the saltpetre-impregnated quick-light kind is bought
    inputTo: ['censer_burn'],
    sourcing: { species: 'n/a — manufactured', cites: 'none', citesWatch: false, iucn: 'n/a',
      pressure: 'Charcoal feedstock can be mangrove or tropical hardwood; coconut-shell discs avoid that.',
      verifiedOn: SOURCING_VERIFIED_ON },
    safety: {
      combustion: true,
      // The real hazard on this item is not the incense — it is the charcoal itself.
      carbonMonoxide: 'A self-igniting disc is charcoal impregnated with an OXIDISER (potassium or sodium nitrate) so it lights from a flame. It burns hot for 30–60 minutes and produces CARBON MONOXIDE — colourless, odourless, and the reason unattended charcoal in a closed room kills people. Burn it with a window open. Never in a bedroom, never in a car, never in a tent, never left burning while you sleep. If you use these often, put a CO alarm in the room — that is a $25 fix for the only failure mode here that is fatal rather than irritating.',
      thermal: 'The disc reaches several hundred °C. It sits on SAND inside a censer, not on the censer floor, and the censer sits on a non-combustible surface — not on a wooden altar, not on cloth. It stays hot long after it looks dead; drown it before you bin it.',
      ignition: 'Light it held in TONGS over a non-flammable surface. The oxidiser makes it spit sparks as it catches.',
    },
    cite: [],
  },
  {
    id: 'incense_stick',
    name: 'Incense Stick (agarbatti)',
    class: 'burnable',
    domains: ['incense', 'trade'],
    shelfLifeDays: 1095,
    consumedOnUse: true,
    makeable: true,
    station: 'rolling-bench',
    // bamboo splint + a binder (makko/jigat gum) + the aromatic
    recipe: [{ item: 'fiber', qty: 1 }, { item: 'gum', qty: 1 }, { item: 'sandalwood_powder', qty: 1 }],
    effort: 3,
    inputTo: ['ritual_use'],
    sourcing: {
      species: 'blend',
      cites: 'none',
      citesWatch: false,
      iucn: 'n/a — inherits the status of whatever aromatic went into it',
      pressure: 'A stick is only as clean as its aromatic. A blend containing wild agarwood inherits agarwood\'s CITES obligation.',
      // "Dipped" sticks are unscented blanks soaked in fragrance oil — often synthetic, sometimes
      // solvent-heavy. Not a safety emergency, but a labelling fact buyers deserve.
      askYourSupplier: 'Rolled with the aromatic in the paste, or a blank dipped in fragrance oil? Both are legitimate; only one is what people think they are buying.',
      verifiedOn: SOURCING_VERIFIED_ON,
    },
    safety: { combustion: true },
    cite: [],
  },
  {
    id: 'dhoop_cone',
    name: 'Dhoop Cone',
    class: 'burnable',
    domains: ['incense', 'trade'],
    shelfLifeDays: 1095,
    consumedOnUse: true,
    makeable: true,
    station: 'rolling-bench',
    recipe: [{ item: 'frankincense_tears', qty: 1 }, { item: 'gum', qty: 1 }, { item: 'charcoal', qty: 1 }],
    effort: 3,
    inputTo: ['ritual_use'],
    sourcing: { species: 'blend', cites: 'none', citesWatch: false, iucn: 'n/a — inherits its aromatics',
      pressure: 'Inherits the sourcing status of its resin.', verifiedOn: SOURCING_VERIFIED_ON },
    safety: { combustion: true },
    cite: [],
  },
  {
    id: 'havan_samagri',
    name: 'Havan Samagri (fire-offering blend)',
    class: 'burnable',
    domains: ['incense', 'trade'],
    shelfLifeDays: 540,               // contains ghee/oils and dried botanicals — it does go rancid
    consumedOnUse: true,
    makeable: true,
    station: 'blending-bench',
    recipe: [{ item: 'frankincense_tears', qty: 1 }, { item: 'herb', qty: 2 }, { item: 'sandalwood_powder', qty: 1 }, { item: 'sugar', qty: 1 }],
    effort: 4,
    inputTo: ['ritual_use', 'vibhuti'],
    sourcing: { species: 'blend', cites: 'none', citesWatch: false, iucn: 'n/a — inherits its aromatics',
      pressure: 'A samagri blend inherits every constituent\'s status; the sandalwood is usually the binding constraint.',
      verifiedOn: SOURCING_VERIFIED_ON },
    safety: {
      combustion: true,
      thermal: 'A havan/homa is an OPEN FIRE indoors. It wants a proper kunda on a non-combustible base, clearance overhead, a way out of the room, and water or sand within arm\'s reach. Ghee flares.',
      rancidity: 'The oils in a blend go rancid. A samagri that smells sour or sharp rather than sweet is past it — the shelf life on this one is real, unlike the resins.',
    },
    cite: [],
  },
  {
    id: 'beeswax_candle',
    name: 'Beeswax Candle',
    class: 'burnable',
    domains: ['incense', 'energy', 'craft', 'trade'],
    shelfLifeDays: null,
    consumedOnUse: true,
    makeable: true,
    station: 'chandlery',
    recipe: [{ item: 'beeswax', qty: 2 }, { item: 'fiber', qty: 1 }],
    effort: 3,
    inputTo: ['ritual_use'],
    sourcing: { species: 'Apis mellifera wax', cites: 'none', citesWatch: false, iucn: 'n/a',
      pressure: 'Comes off your own apiary in the insect-ecosystem module — this is the fully closed-loop burnable.',
      verifiedOn: SOURCING_VERIFIED_ON },
    safety: {
      combustion: true,
      wick: 'Cotton or paper-cored wick only. Metal-cored wicks containing LEAD have been banned in the US since 2003 (CPSC, 16 CFR 1500.17(a)(13)); pre-ban and grey-import candles can still carry them. If a wick core is metal and you cannot confirm it is zinc or tin, do not burn it indoors.',
      thermal: 'Trim the wick to ~6 mm. Non-combustible holder, level surface, out of a draught, never unattended, never within reach of a child or an animal that jumps.',
    },
    cite: ['US CPSC 16 CFR 1500.17(a)(13) — lead-cored candle wicks banned 2003'],
  },
];

// Every burnable shares one physical fact, so it is stated once and attached to all of them rather
// than being restated ten times or, worse, stated on some and forgotten on others.
const COMBUSTION_SAFETY = {
  particulate: 'Burning anything indoors produces fine particulate (PM2.5) and combustion gases. Incense in an unventilated room drives indoor PM2.5 far above the WHO 2021 24-hour air-quality guideline of 15 µg/m³ — routinely by an order of magnitude — along with CO, VOCs and polycyclic aromatic hydrocarbons. This is not a reason not to burn incense. It is the reason the guidance is VENTILATION rather than abstinence.',
  ventilation: 'Cross-ventilate: a window open on the burn and for 20–30 minutes after. Do not burn in a closed bedroom, a car, or a room where someone sleeps. One stick in a ventilated room is a different exposure from a shrine burning all day in a sealed flat.',
  vulnerable: 'People with asthma, COPD or other reactive airway disease, infants, and pregnant people take the worst of it. Burn elsewhere, or do not burn while they are in the room. Household birds are killed by combustion products at concentrations humans do not notice — this is a real and common accident.',
  fire: 'Non-combustible holder on a non-combustible surface. Ash falls where you did not think it would. Never unattended, never asleep, never near hanging cloth. Drown the ash before it goes in the bin.',
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// VESSEL — durable. The class where "with gods on it" lives, and where food contact is a hazard.
//
// foodContact: true means people EAT or DRINK what has been in it. A bowl that holds prasad,
// naivedya, charanamrita or tirtha is a food-contact surface even though nobody calls it tableware.
// That is the whole reason this field exists.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// US FDA Compliance Policy Guide 545.450 action levels for LEACHABLE lead from ceramicware,
// and the parallel cadmium levels, in µg/mL of leaching solution. These are the numbers a lab
// reports against, so they belong in the model rather than in a paragraph.
export const CERAMIC_LEACH_LIMITS = {
  flatware: { lead: 3.0, cadmium: 0.5 },
  small_hollowware: { lead: 2.0, cadmium: 0.5 },
  large_hollowware: { lead: 1.0, cadmium: 0.25 },
  cups_mugs_pitchers: { lead: 0.5, cadmium: 0.5 },
  units: 'µg/mL of leaching solution (4% acetic acid, 24 h at 22 °C)',
  method: 'ASTM C738 — lead and cadmium extracted from glazed ceramic surfaces; ASTM C927 for the lip and rim of drinking vessels',
  note: 'US FDA CPG Sec. 545.450 action levels. California sets tighter limits and requires Prop 65 warning below them. These are IMPORT/ENFORCEMENT action levels, not a target — a food-safe studio glaze should release essentially nothing.',
};

const VESSELS = [
  {
    id: 'terracotta_planter',
    name: 'Terracotta Planter',
    class: 'vessel',
    domains: ['decor', 'craft', 'building', 'trade'],
    shelfLifeDays: null,
    consumedOnUse: false,
    makeable: true,
    station: 'kiln',
    recipe: [{ item: 'clay_body', qty: 3 }],
    effort: 4,
    inputTo: ['plant_growing'],
    vessel: {
      foodContact: false,
      glaze: 'none (unglazed earthenware)',
      leadFree: true,
      leachTest: 'not required — no food contact and no glaze',
      firedTo: 'earthenware, roughly cone 06–04 (~1000 °C)',
      hazard: 'Porous and low-fired: it will absorb water, and water in the wall FREEZES and splits the pot. Bring them in before a hard frost. Unglazed terracotta also wicks moisture out of the soil, which is a feature for a succulent and a problem for a fern.',
    },
    devotional: null,
    cite: [],
  },
  {
    id: 'offering_bowl',
    name: 'Glazed Offering Bowl',
    class: 'vessel',
    domains: ['decor', 'craft', 'food', 'trade'],
    shelfLifeDays: null,
    consumedOnUse: false,
    makeable: true,
    station: 'kiln',
    recipe: [{ item: 'clay_body', qty: 2 }, { item: 'glaze_frit', qty: 1 }],
    effort: 6,
    inputTo: ['ritual_use'],
    vessel: {
      // THE load-bearing one. Prasad and naivedya are eaten. Charanamrita and tirtha are drunk.
      foodContact: true,
      glaze: 'lead-free and cadmium-free studio glaze, fired to maturity',
      leadFree: true,
      leachTest: 'ASTM C738 leach test against US FDA CPG 545.450 action levels — see CERAMIC_LEACH_LIMITS',
      firedTo: 'stoneware, cone 6–10 — a glaze fired below its maturing range leaches even when its recipe is lead-free',
      hazard: 'An offering bowl is FOOD-CONTACT WARE. What goes in it gets eaten, and it holds it for hours, warm, and often acidic (yoghurt, lemon, tamarind, fruit). Those are exactly the conditions that pull lead and cadmium out of a glaze. Low-fired lead-glazed devotional and folk earthenware — imported bean pots, painted candy dishes, souvenir ware — is a documented cause of childhood lead poisoning, not a theoretical risk. Bright red, orange and yellow glazes are the cadmium-and-lead colours. Rules that actually work: buy food-safe-rated glaze and fire it to its range; test-fire and leach-test a tile from any glaze you mix yourself; never use a lustre, overglaze enamel or unfired paint on a surface food touches; and if a vessel came from a market stall with no glaze information, keep it for flowers.',
    },
    devotional: {
      tradition: 'pan-devotional; Shaivite use as naivedya/prasad ware',
      iconography: 'A bowl may carry a deity mark. If it does, it is not stacked under other ware, not used for waste, and not put on the floor.',
      handling: 'Kept for offering use only. Washed separately from ordinary dishes in most household practice.',
    },
    cite: ['US FDA CPG Sec. 545.450', 'ASTM C738 / C927'],
  },
  {
    id: 'censer',
    name: 'Censer / Dhoopdani',
    class: 'vessel',
    domains: ['incense', 'decor', 'craft', 'trade'],
    shelfLifeDays: null,
    consumedOnUse: false,
    makeable: true,
    station: 'kiln',
    recipe: [{ item: 'clay_body', qty: 2 }, { item: 'sand', qty: 1 }],
    effort: 5,
    inputTo: ['censer_burn'],
    vessel: {
      foodContact: false,
      glaze: 'unglazed interior; any glaze on the exterior only',
      leadFree: true,
      leachTest: 'not required — no food contact',
      firedTo: 'stoneware preferred; earthenware cracks under repeated thermal cycling',
      hazard: 'Thermal shock and heat transfer. A charcoal disc sits on a SAND BED inside the censer, never on the ceramic floor — the sand is what stops the base cracking and what stops the outside getting hot enough to scorch what it stands on. The censer then sits on a trivet or tile, not on wood or cloth. It stays dangerously hot for a long time after the coal looks out.',
    },
    devotional: {
      tradition: 'pan-devotional; dhoopdani in Hindu practice',
      iconography: 'Commonly carries deity or yantra relief.',
      handling: 'Emptied and cleaned between uses; ash from a consecrated fire is not ordinary waste (see vibhuti).',
    },
    cite: [],
  },
  {
    id: 'diya',
    name: 'Diya (oil lamp)',
    class: 'vessel',
    domains: ['decor', 'craft', 'energy', 'trade'],
    shelfLifeDays: null,
    consumedOnUse: false,
    makeable: true,
    station: 'kiln',
    recipe: [{ item: 'clay_body', qty: 1 }],
    effort: 2,
    inputTo: ['ritual_use'],
    vessel: {
      foodContact: false,
      glaze: 'none',
      leadFree: true,
      leachTest: 'not required — no food contact',
      firedTo: 'earthenware',
      hazard: 'An open oil flame at floor or shelf height, usually in a room with fabric and often with children and animals moving through it. Level, non-combustible surface; clear of curtains, hanging cloth and torans; extinguished before the room is left. Unglazed terracotta wicks oil through the wall — set it on a tray, not straight on wood.',
    },
    devotional: {
      tradition: 'Hindu; Deepavali and daily puja',
      iconography: 'usually plain; sometimes moulded with a deity face',
      handling: 'Broken diyas are traditionally returned to earth or water rather than binned.',
    },
    cite: [],
  },
  {
    id: 'kalash',
    name: 'Kalash (copper water pot)',
    class: 'vessel',
    domains: ['decor', 'craft', 'food', 'trade'],
    shelfLifeDays: null,
    consumedOnUse: false,
    makeable: true,
    station: 'metal-bench',
    recipe: [{ item: 'copper_stock', qty: 3 }],
    effort: 7,
    inputTo: ['ritual_use'],
    vessel: {
      foodContact: true,              // it holds water and tirtha that people drink
      glaze: 'n/a — metal; tin-lined interior (kalai) where acidic contents are possible',
      leadFree: true,
      leachTest: 'not ceramic — the equivalent control is the tin lining and its RE-LINING schedule; see copper_stock for the acid limit',
      firedTo: 'n/a',
      hazard: 'Copper and acid do not mix. Plain water in bare copper is the traditional use and is fine. Lemon water, buttermilk, tamarind, wine, yoghurt, or fruit left standing in bare copper leaches copper into what people then drink — the US FDA Food Code prohibits copper contact with foods below about pH 6 for exactly this reason. Traditional practice tin-lines the interior (kalai) and RE-LINES it as the tin wears through; a worn lining showing bare copper under acidic contents is the failure mode. Also: verdigris on the outside is cosmetic, verdigris on a food surface is not.',
    },
    devotional: {
      tradition: 'Hindu; kalasha sthapana — the pot itself is treated as a seat of the divine during a rite',
      iconography: 'often engraved; dressed with mango leaves and a coconut in use',
      handling: 'During a rite the kalash is not moved casually and is not used for any other purpose.',
    },
    cite: ['US FDA Food Code — copper limitation on acidic foods'],
  },
  {
    id: 'murti_small',
    name: 'Murti (small devotional image)',
    class: 'vessel',
    domains: ['decor', 'craft', 'trade'],
    shelfLifeDays: null,
    consumedOnUse: false,
    makeable: true,
    station: 'kiln',
    recipe: [{ item: 'clay_body', qty: 3 }, { item: 'pigment_stick', qty: 1 }],
    effort: 9,
    inputTo: ['ritual_use'],
    vessel: {
      foodContact: false,
      glaze: 'exterior decoration only',
      leadFree: true,
      leachTest: 'not required — no food contact. Pigments must still be lead- and cadmium-free: a murti is handled, bathed in abhisheka, and touched by people who then touch food.',
      firedTo: 'earthenware or stoneware; unfired clay murtis are made deliberately for immersion',
      hazard: 'The material question here is IMMERSION. A murti made for visarjan goes into water, so it is made of unfired clay and natural pigment for that reason — plaster of Paris and synthetic paint do not dissolve and are what fouls the water body. If the piece is meant to be immersed, it must be made to dissolve.',
    },
    devotional: {
      tradition: 'Hindu; in this shop, Shaivite first — this is the operator\'s own tradition, not a theme',
      iconography: 'A murti is a form of a deity, made to iconographic standards (shilpa shastra proportion, correct attributes, correct mudra, correct vahana). Getting the attributes wrong is not a stylistic liberty, it is a wrong image.',
      // The distinction that governs the whole product line.
      handling: 'A murti sold from a shop is UNINSTALLED. Consecration — prana pratishtha — is a rite performed at installation, by the person who will keep it, and it is what makes an image a seat of the deity. Botanica sells the image; it does not sell a consecrated deity, and it says so on the listing. Once installed, an image is not merchandise: it is not resold as decor, not stacked in a box, not left on the floor, and not put in the bin. Damaged or retired images are given to water or earth (visarjan), which is the other reason immersion-grade material matters.',
      neverDo: 'Deity iconography does not go on anything that meets the floor, a shoe, a doormat, a toilet, a bin, or underwear, and does not go on a surface that carries waste. This is not squeamishness — it is the recurring, well-documented offence that gets products pulled, and the shop of a Shaivite temple has no excuse for committing it. Placing a deity image on a food-contact surface additionally makes the lead-and-cadmium question above non-negotiable rather than advisory.',
    },
    cite: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// MADE — what a holder can craft from the rest. The converter class: inputs die, one output is born.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const MADE = [
  {
    id: 'glaze_frit',
    name: 'Glaze Frit (lead-free)',
    class: 'made',
    domains: ['craft', 'art', 'industrial', 'trade'],
    shelfLifeDays: null,
    consumedOnUse: true,
    makeable: true,
    station: 'furnace',
    recipe: [{ item: 'sand', qty: 2 }, { item: 'natron', qty: 1 }, { item: 'ag_lime', qty: 1 }],
    effort: 5,
    inputTo: ['offering_bowl', 'censer'],
    safety: {
      dust: true,
      ppe: 'Respirator for dry glaze materials — this is silica plus alkali dust. Mix wet where you can.',
      // Why a frit exists at all: it is the answer to the lead-glaze problem, not a footnote to it.
      note: 'A frit is a glaze flux pre-melted and re-ground so it is insoluble and stable. Sand + soda + lime is the classic lead-free alkaline frit — the reason to make one is precisely so the shelf never needs a lead glaze. Everything the shop fires for food contact goes through here.',
    },
    cite: [],
  },
  {
    id: 'pigment_stick',
    name: 'Pigment Stick (earth colour)',
    class: 'made',
    domains: ['art', 'craft', 'trade'],
    shelfLifeDays: 1825,
    consumedOnUse: true,
    makeable: true,
    station: 'ink-bench',
    recipe: [{ item: 'dye', qty: 1 }, { item: 'kaolin', qty: 1 }, { item: 'gum', qty: 1 }],
    effort: 3,
    inputTo: ['murti_small', 'kumkum'],
    safety: {
      dust: true,
      ppe: 'Dust mask while grinding.',
      note: 'Earth and plant colour bound with gum. Lead- and cadmium-free by construction — which is the point, since it decorates things that get handled and bathed.',
    },
    cite: [],
  },
  {
    id: 'vibhuti',
    name: 'Vibhuti (sacred ash)',
    class: 'made',
    domains: ['medicine', 'trade'],
    shelfLifeDays: null,
    consumedOnUse: true,
    makeable: true,
    station: 'kiln',
    // The keystone: the burnable sink's own residue becomes a made good. Nothing is wasted.
    recipe: [{ item: 'havan_samagri', qty: 2 }, { item: 'ash', qty: 1 }],
    effort: 3,
    inputTo: ['ritual_use'],
    safety: {
      dust: true,
      ppe: 'Fine ash is a respirable dust like any other; do not make clouds of it.',
      note: 'Vibhuti is the ash of a completed fire offering, sieved. It is applied to skin, so what went into the fire matters: a homa fed with treated wood, painted timber, plastic, or synthetic incense produces ash that should not go on anyone\'s forehead. Clean feedstock is a safety property, not a purity metaphor.',
    },
    devotional: {
      tradition: 'Shaivite — the tripundra',
      iconography: 'n/a',
      handling: 'Ash from a consecrated fire is not swept into the bin with the rest of the room.',
    },
    cite: [],
  },
  {
    id: 'kumkum',
    name: 'Kumkum',
    class: 'made',
    domains: ['cosmetic', 'trade'],
    shelfLifeDays: 730,
    consumedOnUse: true,
    makeable: true,
    station: 'blending-bench',
    recipe: [{ item: 'spice', qty: 1 }, { item: 'ag_lime', qty: 1 }, { item: 'pigment_stick', qty: 1 }],
    effort: 2,
    inputTo: ['ritual_use'],
    safety: {
      dust: true,
      ppe: 'n/a for use; dust mask while blending.',
      // A real, repeatedly documented adulteration problem in commercial kumkum and sindoor.
      note: 'Traditional kumkum is turmeric turned red by alkali (slaked lime) — that reaction is the colour. Commercial kumkum and sindoor have repeatedly been found ADULTERATED with lead compounds, most notoriously lead tetroxide (sindoor red), and with synthetic azo dyes, and it is applied to skin daily and to children. Make it from turmeric and lime, or buy from a supplier who will show you a heavy-metals assay. A red powder that is suspiciously bright and cheap is the one to be suspicious of.',
    },
    devotional: { tradition: 'Hindu', iconography: 'n/a', handling: 'applied to forehead; kept covered and dry' },
    cite: [],
  },
  {
    id: 'mala',
    name: 'Mala (108 beads)',
    class: 'made',
    domains: ['craft', 'decor', 'trade'],
    shelfLifeDays: null,
    consumedOnUse: false,             // a mala is a durable made good — the exception in this class
    makeable: true,
    station: 'stringing-bench',
    recipe: [{ item: 'sandalwood_powder', qty: 1 }, { item: 'timber', qty: 1 }, { item: 'fiber', qty: 1 }],
    effort: 6,
    inputTo: ['ritual_use'],
    safety: { note: 'No hazard beyond the sourcing of the wood — see sandalwood_powder for the species question.' },
    devotional: {
      tradition: 'Shaivite (rudraksha) / Vaishnava (tulsi) / Buddhist — the bead material is the tradition marker, not decoration',
      iconography: 'n/a',
      handling: 'A japa mala used for practice is not jewellery and is not sold as a bracelet-with-a-vibe. Rudraksha and tulsi malas carry specific tradition; selling one as generic "boho" stock is the same error as the murti-on-a-doormat, in a smaller size.',
    },
    cite: [],
  },
  {
    id: 'wax_seal',
    name: 'Wax Seal',
    class: 'made',
    domains: ['craft', 'art', 'trade'],
    shelfLifeDays: null,
    consumedOnUse: true,
    makeable: true,
    station: 'chandlery',
    recipe: [{ item: 'beeswax', qty: 1 }, { item: 'resin', qty: 1 }, { item: 'pigment_stick', qty: 1 }],
    effort: 2,
    inputTo: ['document_sealing'],
    safety: { note: 'Molten wax burns. Melt in a spoon over a low flame, not in a hand.' },
    cite: [],
  },
  {
    id: 'de_slurry',
    name: 'DE Wet Slurry (dust-free application)',
    class: 'made',
    domains: ['ranch', 'industrial', 'trade'],
    shelfLifeDays: 30,                // it is water and mineral; it goes off and it settles
    consumedOnUse: true,
    makeable: true,
    station: 'blending-bench',
    recipe: [{ item: 'de_food_grade', qty: 2 }, { item: 'water', qty: 1 }],
    effort: 1,
    inputTo: ['pest_dusting'],
    safety: {
      dust: false,
      ppe: 'None for the wet slurry — that is the entire reason to make it.',
      note: 'Food-grade DE suspended in water and painted or sprayed on. It goes on wet, so nobody breathes it, and it works once it dries and the water leaves behind the mineral film. This is the honest answer to "the dust is the hazard": do not make dust. It still kills pollinators once dry, so the bloom rule from de_food_grade still applies.',
    },
    cite: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Assembly
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** External inputs the factor recipes draw from the existing catalogs (plant/insect/industrial). */
export const EXTERNAL_INPUTS = {
  resin: 6, herb: 6, gum: 8, timber: 6, fiber: 8, sand: 2, water: 1, ash: 2,
  charcoal: 8, beeswax: 10, dye: 6, sugar: 6, spice: 6,
};

/** Every non-growing factor, in one list. `grown` is deliberately empty here — it lives in
 *  plant-catalog.mjs and is named in FACTOR_CLASSES so the taxonomy is complete, not so this
 *  module can re-declare 48 plants somebody else already owns. */
export const FACTORS = [...MINERALS, ...BURNABLES, ...VESSELS, ...MADE].map((f) => ({
  domains: [],
  shelfLifeDays: null,
  consumedOnUse: false,
  makeable: false,
  inputTo: [],
  station: null,
  recipe: null,
  effort: 0,
  safety: {},
  sourcing: null,
  devotional: null,
  cite: [],
  ...f,
  // Every burnable inherits the shared combustion facts; a per-item note wins on a key clash.
  safety: f.class === 'burnable' ? { ...COMBUSTION_SAFETY, ...(f.safety || {}) } : (f.safety || {}),
}));

const BY_ID = Object.fromEntries(FACTORS.map((f) => [f.id, f]));

export const factorById = (id) => BY_ID[String(id == null ? '' : id)] || null;
export const factorsByClass = (cls) => FACTORS.filter((f) => f.class === cls);
export const factorIds = () => FACTORS.map((f) => f.id);

/** economyRoleOf — what this factor DOES to the token supply. The point of the taxonomy. */
export function economyRoleOf(id) {
  const f = factorById(id);
  if (!f) return null;
  return { ...ECONOMY_ROLES[f.class], class: f.class, consumedOnUse: f.consumedOnUse };
}

/** safetyOf — every safety fact for a factor, flattened to lines. Never throws, never empty for a
 *  factor that has facts. Callers render these; they do not get to drop them. */
export function safetyOf(id) {
  const f = factorById(id);
  if (!f) return [];
  const out = [];
  for (const [k, v] of Object.entries(f.safety || {})) {
    if (v === true) continue;                       // boolean flags are queried, not rendered
    if (v === false || v == null || v === '') continue;
    out.push({ key: k, text: String(v) });
  }
  if (f.vessel && f.vessel.hazard) out.push({ key: 'vesselHazard', text: String(f.vessel.hazard) });
  if (f.vessel && f.vessel.foodContact) {
    out.push({ key: 'foodContact', text: `FOOD CONTACT: people eat or drink what is in this. Leach limits: ${CERAMIC_LEACH_LIMITS.method}.` });
  }
  return out;
}

/** sourcingOf — the provenance record for a burnable (or null). CITES status is a field. */
export function sourcingOf(id) {
  const f = factorById(id);
  return f && f.sourcing ? { ...f.sourcing } : null;
}

/** devotionalOf — the cultural-handling record, or null. */
export function devotionalOf(id) {
  const f = factorById(id);
  return f && f.devotional ? { ...f.devotional } : null;
}

export const isFoodContact = (id) => !!(factorById(id)?.vessel?.foodContact);
export const requiresRespirator = (id) => !!(factorById(id)?.safety?.dust);
export const isCitesListed = (id) => String(sourcingOf(id)?.cites || 'none').startsWith('appendix');

/** Factors that are an input to a given target (recipe id, factor id or use tag). */
export const inputsTo = (target) => FACTORS.filter((f) => (f.inputTo || []).includes(String(target)));

/** Factors whose shelf life expires within `days`. A live plant has no analogue for this. */
export const perishableWithin = (days) => FACTORS
  .filter((f) => f.shelfLifeDays != null && f.shelfLifeDays <= Number(days || 0))
  .sort((a, b) => a.shelfLifeDays - b.shelfLifeDays);

// ── recipes + value (recipes.mjs shape, value=labor law) ─────────────────────────────────────────
export const FACTOR_RECIPES = FACTORS
  .filter((f) => f.makeable && Array.isArray(f.recipe) && f.recipe.length)
  .map((f) => ({
    id: `make-${f.id}`,
    inputs: f.recipe.map((i) => ({ item: i.item, qty: i.qty })),
    output: { item: f.id, qty: 1 },
    station: f.station || 'bench',
    effort: f.effort || 1,
  }));

/** Value table. Bought factors get a base price; made factors are inputs + effort — value=labor,
 *  so validateNoMoneyPump() can prove the shelf does not print money. Built in dependency order. */
export const FACTOR_VALUE = (() => {
  const v = { ...EXTERNAL_INPUTS };
  // non-makeable factors are IMPORTS — priced, not derived
  const BASE = {
    de_food_grade: 6, de_calcined: 4, clay_body: 4, kaolin: 5, ag_lime: 3, natron: 5,
    copper_stock: 12, agarwood_chips: 40, palo_santo_sticks: 9, charcoal_disc: 3,
  };
  Object.assign(v, BASE);
  // makeable factors, resolved in dependency order (a few passes settles the shallow graph)
  for (let pass = 0; pass < 6; pass += 1) {
    for (const r of FACTOR_RECIPES) {
      const inVal = r.inputs.reduce((n, i) => n + (v[i.item] == null ? 2 : v[i.item]) * i.qty, 0);
      v[r.output.item] = Math.max(1, Math.floor(inVal + r.effort));
    }
  }
  return v;
})();

/** Prove the factor recipes obey value=labor. */
export function auditNoPump() {
  try { return validateNoMoneyPump(FACTOR_RECIPES, FACTOR_VALUE); }
  catch (e) { return { ok: false, violations: [{ error: String(e && e.message) }] }; }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The economy tie-in — sinks vs emission, measured rather than asserted.
//
// The operator's standing instruction is MORE SINKS, LESS EMISSION. The non-growing shelf is where
// that is easy to honour, because three of its four classes take value OUT:
//   burnable  every unit bought is a unit destroyed          → pure sink
//   made      inputs die so one output can exist             → net material sink at effort cost
//   vessel    currency leaves once, the item never returns   → one-time sink
//   mineral   currency leaves the player to an NPC importer  → one-time sink
// Only `grown` emits. So this module registers ZERO faucets and only drains, and factorEconomy()
// runs it through economy-balance.mjs so the claim is a computed number, not a sentence.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Per-class drain weights: how much of a period's currency each class is modelled to absorb.
 *  Burnables dominate because they are the only class bought again and again.
 *
 *  HONEST LABEL: these weights are a MODELLING ASSUMPTION, not measured demand. Nothing in this
 *  repo yet observes how often a player actually buys a censer versus a box of cones. The real
 *  numbers have to come from material-demand.mjs once the shelf is wired to games that consume it,
 *  and from the engine's shop contract once one exists. Until then, factorEconomy() proves a
 *  structural fact — this shelf registers only drains and no faucets, so it can only ever remove
 *  currency — and the magnitude is a placeholder the caller should override. */
export const DRAIN_WEIGHTS = { burnable: 4, made: 2, vessel: 1, mineral: 2 };

/** sinkProfile — every factor as a drain line, with the reason it drains. */
export function sinkProfile() {
  return FACTORS
    .filter((f) => f.class !== 'grown')
    .map((f) => {
      const price = FACTOR_VALUE[f.id] || 1;
      const weight = DRAIN_WEIGHTS[f.class] || 1;
      return {
        id: f.id,
        class: f.class,
        role: ECONOMY_ROLES[f.class].role,
        price,
        // rate = currency absorbed per period at the modelled repeat-purchase weight
        rate: price * weight,
        terminal: !!f.consumedOnUse,
        why: f.consumedOnUse
          ? 'consumed on use — leaves circulation permanently'
          : 'durable — currency leaves once, item is held or traded',
      };
    })
    .sort((a, b) => b.rate - a.rate);
}

/**
 * factorEconomy — register the non-growing shelf against a grow-side faucet and report the balance.
 * Pass the emission you actually run; the default is the emission the shelf can absorb, so the
 * caller can see the headroom rather than being handed a flattering number.
 *
 * Returns { balance, month, sinkTotal, emission, headroom, healthy }.
 */
export function factorEconomy({ growEmissionPerPeriod = 0, period = 30 } = {}) {
  const ledger = createLedger();
  const profile = sinkProfile();
  let sinkTotal = 0;
  for (const s of profile) {
    registerDrain(`factor:${s.id}`, { rate: s.rate, category: 'factor-shelf', label: `${s.class} — ${s.why}` }, ledger);
    sinkTotal += s.rate;
  }
  const emission = Math.max(0, Number(growEmissionPerPeriod) || 0);
  if (emission > 0) {
    // The grow side is the ONLY faucet; the factor shelf is its matching drain.
    registerFaucet('grow-side', { rate: emission, drainCategory: 'factor-shelf', label: 'grown material emission' }, ledger);
  }
  const balance = assertBalanced({ throwOnFail: false }, ledger);
  const month = project({ period }, ledger);
  return {
    balance,
    month,
    sinkTotal,
    emission,
    headroom: sinkTotal - emission,
    healthy: month.healthy,
    faucets: emission > 0 ? 1 : 0,
    drains: profile.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// validateFactors — the structural integrity check. This does NOT gate or withhold content; it
// fails when a factor is missing a fact it must carry. A shelf that cannot state its own hazards
// is the defect, not the shelf.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
export function validateFactors(list = FACTORS) {
  const problems = [];
  const seen = new Set();
  const push = (id, issue) => problems.push({ id: String(id), issue });
  const all = Array.isArray(list) ? list : [];

  for (const f of all) {
    if (!f || typeof f !== 'object') { push('(non-object)', 'not a factor record'); continue; }
    if (!f.id) { push('(anonymous)', 'missing id'); continue; }
    if (seen.has(f.id)) push(f.id, 'duplicate factor id');
    seen.add(f.id);
    if (!FACTOR_CLASSES.includes(f.class)) push(f.id, `unknown class "${f.class}"`);
    if (!f.name) push(f.id, 'missing name');
    if (!Array.isArray(f.domains) || f.domains.length === 0) push(f.id, 'no domains — nothing can want it');
    if (!Array.isArray(f.inputTo) || f.inputTo.length === 0) push(f.id, 'inputTo empty — dead stock, nothing consumes it');
    if (f.makeable && !(Array.isArray(f.recipe) && f.recipe.length)) push(f.id, 'makeable but has no recipe');
    if (f.makeable && !f.station) push(f.id, 'makeable but names no station');
    if (!f.makeable && f.recipe) push(f.id, 'has a recipe but is not marked makeable');

    // MINERAL — every one of these is a dust; it must say what to wear.
    if (f.class === 'mineral') {
      if (!f.safety || f.safety.dust == null) push(f.id, 'mineral does not declare whether it is a dust');
      if (f.safety && f.safety.dust && !f.safety.ppe) push(f.id, 'dust mineral declares no PPE');
      if (f.safety && f.safety.foodContactSafe == null) push(f.id, 'mineral does not declare food-contact status');
    }

    // BURNABLE — combustion facts and a sourcing record with a CITES field and a verification date.
    if (f.class === 'burnable') {
      if (!f.safety || !f.safety.ventilation) push(f.id, 'burnable declares no ventilation guidance');
      if (!f.safety || !f.safety.particulate) push(f.id, 'burnable declares no particulate guidance');
      if (!f.sourcing) push(f.id, 'burnable has no sourcing record');
      else {
        if (!f.sourcing.cites) push(f.id, 'burnable sourcing omits CITES status');
        if (!f.sourcing.verifiedOn) push(f.id, 'burnable sourcing has no verification date — a stale table must look stale');
        if (!f.sourcing.species) push(f.id, 'burnable sourcing omits the species');
      }
    }

    // VESSEL — food contact is the hazard; a food-contact vessel must declare its leach position.
    if (f.class === 'vessel') {
      if (!f.vessel) push(f.id, 'vessel has no vessel record');
      else {
        if (f.vessel.foodContact == null) push(f.id, 'vessel does not declare food-contact status');
        if (f.vessel.leadFree == null) push(f.id, 'vessel does not declare lead status');
        if (!f.vessel.leachTest) push(f.id, 'vessel does not declare a leach-test position');
        if (f.vessel.foodContact && f.vessel.leadFree !== true) push(f.id, 'FOOD-CONTACT vessel is not declared lead-free');
        if (f.vessel.foodContact && !f.vessel.hazard) push(f.id, 'FOOD-CONTACT vessel states no hazard');
      }
      if (f.devotional && !f.devotional.handling) push(f.id, 'devotional vessel states no handling practice');
    }

    // Anything carrying deity iconography must say how it is handled.
    if (f.devotional && !f.devotional.tradition) push(f.id, 'devotional record names no tradition');
  }

  // recipe inputs must resolve to a factor or a declared external input
  const known = new Set([...Object.keys(BY_ID), ...Object.keys(EXTERNAL_INPUTS)]);
  for (const r of FACTOR_RECIPES) {
    for (const i of r.inputs) if (!known.has(i.item)) push(r.output.item, `recipe input "${i.item}" is not a factor or a declared external input`);
  }

  if (all === FACTORS) {
    const pump = auditNoPump();
    if (!pump.ok) push('(economy)', `money pump: ${JSON.stringify(pump.violations || []).slice(0, 300)}`);
  }

  return {
    ok: problems.length === 0,
    problems,
    counts: {
      factors: all.length,
      byClass: Object.fromEntries(FACTOR_CLASSES.map((c) => [c, all.filter((f) => f && f.class === c).length])),
      recipes: FACTOR_RECIPES.length,
      makeable: all.filter((f) => f && f.makeable).length,
      terminalSinks: all.filter((f) => f && f.consumedOnUse).length,
      foodContact: all.filter((f) => f && f.vessel && f.vessel.foodContact).length,
      citesListed: all.filter((f) => f && String((f.sourcing || {}).cites || '').startsWith('appendix')).length,
    },
  };
}

export default {
  FACTOR_CLASSES, ECONOMY_ROLES, FACTORS, CERAMIC_LEACH_LIMITS, EXTERNAL_INPUTS,
  FACTOR_RECIPES, FACTOR_VALUE, DRAIN_WEIGHTS,
  factorById, factorsByClass, factorIds, economyRoleOf, safetyOf, sourcingOf, devotionalOf,
  isFoodContact, requiresRespirator, isCitesListed, inputsTo, perishableWithin,
  auditNoPump, sinkProfile, factorEconomy, validateFactors, esc,
};

if (process.argv[1] && process.argv[1].endsWith('botanica-factors.mjs')) {
  const v = validateFactors();
  console.log('BOTANICA — non-growing factors');
  console.log('─'.repeat(78));
  console.log(`  factors ${v.counts.factors}  ·  recipes ${v.counts.recipes}  ·  makeable ${v.counts.makeable}`);
  console.log(`  by class: ${Object.entries(v.counts.byClass).map(([k, n]) => `${k}=${n}`).join(' ')}`);
  console.log(`  terminal sinks ${v.counts.terminalSinks}  ·  food-contact ${v.counts.foodContact}  ·  CITES-listed ${v.counts.citesListed}`);
  console.log(`  no-money-pump: ${auditNoPump().ok ? 'PASS' : 'FAIL'}`);
  console.log(`  structural validate: ${v.ok ? 'PASS' : 'FAIL'}`);
  for (const p of v.problems.slice(0, 12)) console.log(`    ! ${p.id}: ${p.issue}`);

  console.log('\nDIATOMACEOUS EARTH — the distinction that matters:');
  for (const id of ['de_food_grade', 'de_calcined']) {
    const f = factorById(id);
    console.log(`\n  ${f.name}  [grade=${f.grade}]  respirator required: ${requiresRespirator(id)}`);
    console.log(`    crystalline silica: ${f.safety.crystallineSilica}`);
    console.log(`    PPE: ${f.safety.ppe}`);
    if (f.safety.neverDo) console.log(`    NEVER: ${f.safety.neverDo}`);
  }

  console.log('\nBURNABLES — sourcing:');
  for (const f of factorsByClass('burnable')) {
    const s = f.sourcing || {};
    console.log(`  ${f.name.padEnd(34)} CITES=${String(s.cites).padEnd(13)}${s.citesWatch ? '(watch) ' : ''}${s.nameCollision ? '⚠ name collision' : ''}`);
  }

  console.log('\nVESSELS — food contact:');
  for (const f of factorsByClass('vessel')) {
    console.log(`  ${f.name.padEnd(34)} foodContact=${String(f.vessel.foodContact).padEnd(6)} leadFree=${f.vessel.leadFree}`);
  }

  const econ = factorEconomy({ growEmissionPerPeriod: 200, period: 30 });
  console.log('\nECONOMY — the shelf against a 200/period grow faucet:');
  console.log(`  drains ${econ.drains}  ·  faucets ${econ.faucets}  ·  sink/period ${econ.sinkTotal}  ·  emission/period ${econ.emission}`);
  console.log(`  headroom ${econ.headroom}  ·  net over 30 periods ${econ.month.net}  ·  healthy ${econ.healthy}`);
  console.log('\n  top sinks:');
  for (const s of sinkProfile().slice(0, 8)) console.log(`    ${s.id.padEnd(22)} ${String(s.rate).padStart(4)}/period  ${s.role.padEnd(9)} ${s.why}`);
}
