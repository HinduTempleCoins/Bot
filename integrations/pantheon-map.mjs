// pantheon-map.mjs — the CROSS-PANTHEON EQUATION LAYER.
//
// `hierophant-entities.mjs` answers "who is this god?" one tradition at a time. This file answers
// the harder question the corpus actually turns on: "is THIS god THAT god, and who says so?"
//
// WHY THIS IS NOT A LIST OF EQUALS SIGNS. Every popular correspondence chart in this genre —
// chakra-to-planet, tarot-to-sephirah, "all gods are the sun" — collapses because it does not
// distinguish an equation an ancient writer actually made from one a modern author proposed.
// Herodotus writing "the Egyptians call Athena Neith" is evidence. A 19th-century occultist
// assigning Saturn to the Root chakra is not. Both look identical once flattened into a table,
// and flattening them is how a real transmission argument gets buried under an invented one.
//
// So every edge here carries a TIER and a SOURCE, and the tiers are ranked:
//
//   attested   — a named ancient author states the equation. Cite book and line.
//   epigraphic — a bilingual inscription states it. The strongest kind: two scripts, one altar.
//   cultic     — one god received under both names at one site, shown by archaeology/continuity.
//   structural — same function and position, no ancient source equates them. A hypothesis.
//   conjecture — modern or VKFRI-proposed. Held openly as ours, never laundered as ancient.
//
// `cluster()` defaults to cultic-and-above precisely so a conjecture cannot silently join a chain
// of attested links and inherit their authority. That is the whole point of the module.
//
// TRIANGULATION. GEO_MYTHO_CALCULUS §7.2 sets the house rule: no claim stands on one evidentiary
// system; it needs convergence across three. `triangulate()` implements that literally — it unions
// the `systems` tags along every path between two figures and reports whether the rule is met.
// It returns `false` a lot. That is the function working.
//
//   import { EQUATIONS, cluster, triangulate, weakLinks, registryGap } from './pantheon-map.mjs';
//
// SECURITY / DISCIPLINE: pure data, no network, no keys, no clock. Soft surface — unknown ids
// return empty rather than throwing.

import { ENTITY_IDS } from './hierophant-entities.mjs';

// ── Tiers, ranked weakest to strongest ─────────────────────────────────────────────────────────
export const TIERS = ['conjecture', 'structural', 'cultic', 'attested', 'epigraphic'];
export const tierRank = (t) => TIERS.indexOf(t);

// The seven evidentiary systems of GEO_MYTHO_CALCULUS §7.1.
export const SYSTEMS = [
  'biblical', 'greek-myth', 'egyptian', 'genetics', 'linguistics', 'archaeology', 'trade-routes',
];

// ── Nodes ──────────────────────────────────────────────────────────────────────────────────────
// Figures the equations reference. Many are already in hierophant-entities.mjs; the ones that are
// not are the registry backlog, and `registryGap()` prints exactly that list rather than hiding it.
export const NODES = [
  // Egyptian
  { id: 'neith', name: 'Neith', tradition: 'egyptian', seat: 'Sais' },
  { id: 'wadjet', name: 'Wadjet', tradition: 'egyptian', seat: 'Buto' },
  { id: 'bastet', name: 'Bastet', tradition: 'egyptian', seat: 'Bubastis' },
  { id: 'anhur', name: 'Anhur (Onuris)', tradition: 'egyptian', seat: 'Thinis / Sebennytos' },
  { id: 'amun', name: 'Amun', tradition: 'egyptian', seat: 'Thebes' },
  { id: 'ptah', name: 'Ptah', tradition: 'egyptian', seat: 'Memphis' },
  { id: 'khepri', name: 'Khepri', tradition: 'egyptian', seat: 'Heliopolis' },
  { id: 'shu', name: 'Shu', tradition: 'egyptian' },
  { id: 'isis', name: 'Isis', tradition: 'egyptian' },
  { id: 'osiris', name: 'Osiris', tradition: 'egyptian' },
  { id: 'horus', name: 'Horus', tradition: 'egyptian' },
  { id: 'thoth', name: 'Thoth', tradition: 'egyptian' },
  { id: 'hathor', name: 'Hathor', tradition: 'egyptian' },
  { id: 'set', name: 'Set', tradition: 'egyptian' },

  // Phoenician / Punic
  { id: 'melqart', name: 'Melqart', tradition: 'phoenician', seat: 'Tyre' },
  { id: 'tanit', name: 'Tanit', tradition: 'punic', seat: 'Carthage' },
  { id: 'baal-hammon', name: 'Baal Hammon', tradition: 'punic', seat: 'Carthage' },
  { id: 'astarte', name: 'Astarte', tradition: 'phoenician', seat: 'Sidon' },
  { id: 'eshmun', name: 'Eshmun', tradition: 'phoenician', seat: 'Sidon' },
  { id: 'baal-shamem', name: 'Baal Shamem', tradition: 'phoenician' },

  // Levantine / Hebrew
  { id: 'asherah', name: 'Asherah', tradition: 'canaanite' },
  { id: 'athirat', name: 'Athirat', tradition: 'canaanite', seat: 'Ugarit' },
  { id: 'el', name: 'El', tradition: 'canaanite', seat: 'Ugarit' },
  { id: 'baal-hadad', name: 'Baal Hadad', tradition: 'canaanite', seat: 'Ugarit' },
  { id: 'azazel', name: 'Azazel', tradition: 'hebrew' },
  { id: 'yahweh', name: 'Yahweh', tradition: 'hebrew' },
  { id: 'molech', name: 'Molech', tradition: 'hebrew' },

  // Mesopotamian
  { id: 'ishtar', name: 'Ishtar (Inanna)', tradition: 'mesopotamian' },
  { id: 'mylitta', name: 'Mylitta', tradition: 'mesopotamian' },
  { id: 'ninkasi', name: 'Ninkasi', tradition: 'mesopotamian' },
  { id: 'marduk', name: 'Marduk', tradition: 'mesopotamian' },
  { id: 'ea', name: 'Ea (Enki)', tradition: 'mesopotamian' },

  // Greek
  { id: 'athena', name: 'Athena', tradition: 'greek' },
  { id: 'zeus', name: 'Zeus', tradition: 'greek' },
  { id: 'poseidon', name: 'Poseidon', tradition: 'greek' },
  { id: 'herakles', name: 'Herakles', tradition: 'greek' },
  { id: 'demeter', name: 'Demeter', tradition: 'greek' },
  { id: 'dionysos', name: 'Dionysos', tradition: 'greek' },
  { id: 'apollo', name: 'Apollo', tradition: 'greek' },
  { id: 'artemis', name: 'Artemis', tradition: 'greek' },
  { id: 'leto', name: 'Leto', tradition: 'greek' },
  { id: 'ares', name: 'Ares', tradition: 'greek' },
  { id: 'hermes', name: 'Hermes', tradition: 'greek' },
  { id: 'hephaistos', name: 'Hephaistos', tradition: 'greek' },
  { id: 'aphrodite', name: 'Aphrodite', tradition: 'greek' },
  { id: 'atlas', name: 'Atlas', tradition: 'greek' },
  { id: 'kronos', name: 'Kronos', tradition: 'greek' },
  { id: 'ouranos', name: 'Ouranos', tradition: 'greek' },
  { id: 'asklepios', name: 'Asklepios', tradition: 'greek' },
  { id: 'hera', name: 'Hera', tradition: 'greek' },

  // Roman
  { id: 'minerva', name: 'Minerva', tradition: 'roman' },
  { id: 'jupiter', name: 'Jupiter', tradition: 'roman' },
  { id: 'saturn', name: 'Saturn', tradition: 'roman' },
  { id: 'juno-caelestis', name: 'Juno Caelestis (Dea Caelestis)', tradition: 'roman', seat: 'Carthage' },
  { id: 'hercules', name: 'Hercules', tradition: 'roman' },
  { id: 'ceres', name: 'Ceres', tradition: 'roman' },
  { id: 'mercury', name: 'Mercury', tradition: 'roman' },
  { id: 'mars', name: 'Mars', tradition: 'roman' },
  { id: 'vulcan', name: 'Vulcan', tradition: 'roman' },
  { id: 'venus', name: 'Venus', tradition: 'roman' },
  { id: 'liber', name: 'Liber Pater', tradition: 'roman' },
  { id: 'pomona', name: 'Pomona', tradition: 'roman' },
  { id: 'fornax', name: 'Fornax', tradition: 'roman' },
  { id: 'concordia', name: 'Concordia', tradition: 'roman' },

  // Etruscan
  { id: 'uni', name: 'Uni', tradition: 'etruscan', seat: 'Pyrgi' },
  { id: 'tinia', name: 'Tinia', tradition: 'etruscan' },
  { id: 'menrva', name: 'Menrva', tradition: 'etruscan' },
  { id: 'sethlans', name: 'Sethlans', tradition: 'etruscan' },

  // Berber / Libyan — operator's explicit ask; primary source is Corippus unless noted
  { id: 'anzar', name: 'Anzar', tradition: 'berber', seat: 'Kabylia' },
  { id: 'gurzil', name: 'Gurzil', tradition: 'berber', seat: 'Tripolitania' },
  { id: 'sinifere', name: 'Sinifere', tradition: 'berber' },
  { id: 'mastiman', name: 'Mastiman', tradition: 'berber' },
  { id: 'ifri', name: 'Ifri (Dii Ausrivales)', tradition: 'berber', seat: 'Numidia' },
  { id: 'amun-siwa', name: 'Ammon of Siwa', tradition: 'libyan', seat: 'Siwa Oasis' },
  { id: 'antaeus', name: 'Antaeus', tradition: 'libyan', seat: 'Tingis' },
  { id: 'africa-dea', name: 'Africa (Dea Africa)', tradition: 'berber',
    seat: 'Numidia \u2014 named from Berber ifri, "cave"' },
  { id: 'tritonis-athena', name: 'Athena of Lake Tritonis', tradition: 'libyan', seat: 'Lake Tritonis' },

  // Norse / Germanic
  { id: 'odin', name: 'Odin (Woden)', tradition: 'norse' },
  { id: 'thor', name: 'Thor (Thunor)', tradition: 'norse' },
  { id: 'tyr', name: 'Tyr (Tiw)', tradition: 'norse' },
  { id: 'frigg', name: 'Frigg', tradition: 'norse' },

  // Vedic / Hindu
  { id: 'indra', name: 'Indra', tradition: 'hindu' },
  { id: 'dyaus', name: 'Dyaus Pitar', tradition: 'vedic' },
  { id: 'varuna', name: 'Varuna', tradition: 'hindu' },
  { id: 'soma-deva', name: 'Soma', tradition: 'hindu' },
  { id: 'dhanvantari', name: 'Dhanvantari', tradition: 'hindu' },
  { id: 'vishvakarma', name: 'Vishvakarma', tradition: 'hindu' },
  { id: 'pashupati', name: 'Pashupati (Shiva)', tradition: 'hindu' },

  // Iranian
  { id: 'mithra', name: 'Mithra', tradition: 'zoroastrian' },
  { id: 'anahita', name: 'Anahita', tradition: 'zoroastrian' },

  // Arabian
  { id: 'allat', name: 'Allat (Alilat)', tradition: 'arabian' },
];

const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]));
export const getNode = (id) => NODE_BY_ID.get(id) || null;
export const nodesByTradition = (t) => NODES.filter((n) => n.tradition === t);
export const TRADITIONS = [...new Set(NODES.map((n) => n.tradition))].sort();

// ── Equations ──────────────────────────────────────────────────────────────────────────────────
// `source` is the citation a reader can check. Where we have no citation the tier is not 'attested'.
export const EQUATIONS = [
  // ── Herodotus, Book II: the single densest interpretatio graeca text we have ────────────────
  { a: 'neith', b: 'athena', tier: 'attested', systems: ['greek-myth', 'egyptian'],
    source: 'Plato, Timaeus 21e; Herodotus, Histories II.59, II.170',
    note: 'Plato states it flatly of Sais: the city goddess "whose Egyptian name is Neith, and in Greek, as they say, Athena." Herodotus independently places the Athena festival at Sais.' },
  { a: 'isis', b: 'demeter', tier: 'attested', systems: ['greek-myth', 'egyptian'],
    source: 'Herodotus, Histories II.59, II.156',
    note: 'Named directly: "Isis, who is in the Greek tongue Demeter."' },
  { a: 'osiris', b: 'dionysos', tier: 'attested', systems: ['greek-myth', 'egyptian'],
    source: 'Herodotus, Histories II.42, II.144' },
  { a: 'horus', b: 'apollo', tier: 'attested', systems: ['greek-myth', 'egyptian'],
    source: 'Herodotus, Histories II.144, II.156' },
  { a: 'bastet', b: 'artemis', tier: 'attested', systems: ['greek-myth', 'egyptian'],
    source: 'Herodotus, Histories II.59, II.137, II.156',
    note: 'Bubastis is named as the city of the goddess the Greeks call Artemis.' },
  { a: 'amun', b: 'zeus', tier: 'attested', systems: ['greek-myth', 'egyptian'],
    source: 'Herodotus, Histories II.42' },
  { a: 'ptah', b: 'hephaistos', tier: 'attested', systems: ['greek-myth', 'egyptian'],
    source: 'Herodotus, Histories II.99, II.101' },
  { a: 'thoth', b: 'hermes', tier: 'attested', systems: ['greek-myth', 'egyptian'],
    source: 'Herodotus II.138; Cicero, De Natura Deorum III.56' },
  { a: 'set', b: 'ares', tier: 'attested', systems: ['greek-myth', 'egyptian'],
    source: 'Herodotus, Histories II.63 (the festival at Papremis)' },
  { a: 'hathor', b: 'aphrodite', tier: 'attested', systems: ['greek-myth', 'egyptian'],
    source: 'Herodotus II.41 (Atarbechis); the Greek "Aphrodite of the foreign woman" at Memphis' },

  // The Leto problem — kept because it CUTS AGAINST our Solar Theory chain, not because it helps.
  { a: 'wadjet', b: 'leto', tier: 'attested', systems: ['greek-myth', 'egyptian'],
    source: 'Herodotus, Histories II.59, II.155–156',
    note: 'Herodotus puts Leto at Buto — Wadjet\'s own city — and calls Buto\'s oracle the oracle of Leto. This is an obstacle to any chain that routes Wadjet elsewhere, and it is recorded here so the obstacle stays visible.' },

  // ── Bilingual inscriptions: two scripts, one altar. The strongest tier we have. ─────────────
  { a: 'melqart', b: 'herakles', tier: 'epigraphic', systems: ['archaeology', 'linguistics', 'trade-routes'],
    source: 'Cippi of Melqart, Malta (KAI 47), c. 2nd c. BCE — Punic and Greek on one monument',
    note: 'The same dedication reads "to our lord Melqart" in Punic and "to Herakles" in Greek. This bilingual is also what let Barthelemy begin reading Punic in 1758.' },
  { a: 'uni', b: 'astarte', tier: 'epigraphic', systems: ['archaeology', 'linguistics', 'trade-routes'],
    source: 'Pyrgi Tablets, c. 500 BCE — gold sheets in Etruscan and Phoenician',
    note: 'Thefarie Velianas dedicates to Uni in Etruscan and to Astarte in Phoenician. Direct proof of Phoenician cult inside Etruria.' },
  { a: 'melqart', b: 'hercules', tier: 'attested', systems: ['greek-myth', 'trade-routes', 'archaeology'],
    source: 'Herodotus II.44 (the temple at Tyre); Cicero, De Natura Deorum III.42 (the Tyrian Hercules)' },

  // ── Roman Africa: the cult continuity is archaeological, and it is unusually clean ──────────
  { a: 'tanit', b: 'juno-caelestis', tier: 'cultic', systems: ['archaeology', 'linguistics'],
    source: 'Roman-era Carthage; Tertullian, Apologeticum 24 (Caelestis as the African goddess)',
    note: 'After 146 BCE the Carthaginian tophet goddess is received in Latin as Caelestis. Same site, same offerings, Latin name.' },
  { a: 'baal-hammon', b: 'saturn', tier: 'cultic', systems: ['archaeology', 'linguistics'],
    source: 'Saturnus Africanus stelae, Roman North Africa',
    note: 'The Punic Baal Hammon is continued as Saturn across hundreds of North African stelae — the single best-documented interpretatio in the western Mediterranean.' },
  { a: 'eshmun', b: 'asklepios', tier: 'cultic', systems: ['archaeology', 'greek-myth'],
    source: 'The Eshmun sanctuary at Bustan esh-Sheikh, Sidon, rededicated to Asklepios' },
  { a: 'baal-shamem', b: 'zeus', tier: 'cultic', systems: ['archaeology', 'linguistics'],
    source: 'Zeus Olympios/Baalshamin at Palmyra and Baetocaece' },

  // ── Interpretatio romana / germanica: Tacitus and Caesar naming foreign gods as Roman ───────
  { a: 'odin', b: 'mercury', tier: 'attested', systems: ['linguistics', 'archaeology'],
    source: 'Tacitus, Germania 9',
    note: 'The equation that produced Wednesday: dies Mercurii → Wodnesdæg.' },
  { a: 'thor', b: 'hercules', tier: 'attested', systems: ['linguistics', 'archaeology'],
    source: 'Tacitus, Germania 9',
    note: 'Tacitus says Hercules; the WEEKDAY calque used Jupiter instead (dies Iovis → Thursday). The two disagree, and that disagreement is itself the evidence that two separate transmissions happened.' },
  { a: 'tyr', b: 'mars', tier: 'attested', systems: ['linguistics'],
    source: 'Tacitus, Germania 9; dies Martis → Tiwesdæg' },
  { a: 'frigg', b: 'venus', tier: 'structural', systems: ['linguistics'],
    source: 'dies Veneris → Frigedæg. The weekday calque is documented; no ancient author states the identification.' },
  { a: 'thor', b: 'jupiter', tier: 'structural', systems: ['linguistics'],
    source: 'dies Iovis → Þórsdagr. Calque-attested, author-unattested — and in direct tension with Tacitus above.' },

  // ── Libya and the African origin claim: Herodotus is explicit, and he is one source ─────────
  { a: 'tritonis-athena', b: 'athena', tier: 'attested', systems: ['greek-myth', 'archaeology'],
    source: 'Herodotus, Histories IV.180, IV.188',
    note: 'Herodotus derives Athena from Lake Tritonis in Libya and says her aegis copies the dress of Libyan women.' },
  { a: 'amun-siwa', b: 'amun', tier: 'cultic', systems: ['archaeology', 'egyptian'],
    source: 'The oracle at Siwa; Herodotus II.32, II.42; Alexander\'s visit, 331 BCE' },
  { a: 'amun-siwa', b: 'zeus', tier: 'attested', systems: ['greek-myth', 'archaeology'],
    source: 'Zeus Ammon — Herodotus II.42; the Siwa oracle as Zeus\'s' },
  { a: 'gurzil', b: 'amun-siwa', tier: 'attested', systems: ['archaeology', 'linguistics'],
    source: 'Corippus, Iohannis II.109–112, IV.681–688 (6th c. CE)',
    note: 'Corippus makes Gurzil the son of Ammon by a cow — a bull-formed war god whose idol the Laguatan carried into battle against the Byzantines. This is the best primary attestation of any named Berber deity.' },
  { a: 'gurzil', b: 'mars', tier: 'structural', systems: ['archaeology'],
    source: 'Function only: Corippus shows Gurzil carried as a war standard. No ancient writer equates him with Mars.' },
  { a: 'africa-dea', b: 'ifri', tier: 'cultic', systems: ['archaeology', 'linguistics'],
    source: 'Pliny, Natural History; the Dea Africa personification and the ifri ("cave") cult of the Ifri tribe.',
    note: 'The continent is named for her. Worth stating plainly because it is checkable and almost nobody knows it.' },
  { a: 'ifri', b: 'juno-caelestis', tier: 'cultic', systems: ['archaeology', 'linguistics'],
    source: 'Dii Ausrivales / Ifru dedications, Numidia; the Ifri cave-goddess absorbed into the Caelestis cult' },
  { a: 'anzar', b: 'baal-hadad', tier: 'structural', systems: ['linguistics'],
    source: 'Function only: both are rain-bringers petitioned by rite. The Kabyle "bride of Anzar" ritual is recorded ethnographically, not anciently.' },
  { a: 'antaeus', b: 'atlas', tier: 'structural', systems: ['greek-myth'],
    source: 'Both are Libyan giants defeated by Herakles in the far west (Plutarch, Sertorius 9, on the Tingis tomb).' },
  { a: 'tanit', b: 'neith', tier: 'structural', systems: ['linguistics', 'egyptian'],
    source: 'The Egyptian etymology TA-NIT = "she of Neith" / "land of Neith"; Neith\u2019s own Libyan-Delta origin tradition.',
    note: 'UPGRADED from conjecture: the ta-Nit derivation is a stated linguistic proposal, not a resemblance. It stops short of attested because no ancient author equates them \u2014 Herodotus and Plato both had Neith in front of them and reached for Athena, never Tanit \u2014 and the competing derivations of Tanit from Semitic and Berber roots remain live. This is the load-bearing weak link in the whole Tanit-Neith-Athena chain.' },
  { a: 'tanit', b: 'athena', tier: 'structural', systems: ['linguistics', 'archaeology'],
    source: 'Modern scholarship on Tanit as the matriarchal figure of Numidian society, read through Neith; Herodotus IV.180 for the Libyan Athena rite.',
    note: 'Frequently reported as though ancient. It is not. The Romans meeting Tanit reached for CAELESTIS, not Minerva \u2014 see the tanit=juno-caelestis edge, which is the one with archaeology behind it. Held at structural for that reason.' },
  { a: 'poseidon', b: 'tritonis-athena', tier: 'attested', systems: ['greek-myth', 'archaeology'],
    source: 'Herodotus, Histories IV.180 \u2014 Athena as daughter of Poseidon and the Tritonian lake.' },
  { a: 'poseidon', b: 'antaeus', tier: 'attested', systems: ['greek-myth'],
    source: 'Apollodorus, Bibliotheca II.5.11 \u2014 Antaeus as son of Poseidon and Gaia, in Libya.',
    note: 'Herodotus II.50 says the Greeks took the NAME Poseidon from the Libyans and that no one else ever had it. That is the strongest single statement of African priority in Herodotus, and it is about a name, which is the part that travels.' },
  { a: 'tanit', b: 'asherah', tier: 'conjecture', systems: ['linguistics', 'biblical'],
    source: 'VKFRI, following the common scholarly derivation of Tanit from a Levantine mother-goddess.' },
  { a: 'anhur', b: 'atlas', tier: 'conjecture', systems: ['egyptian', 'greek-myth'],
    source: 'VKFRI. Rests on Anhur-Shu and Shu\'s sky-bearing role.',
    note: 'The Shu-holds-up-the-sky iconography is real Egyptian doctrine; the identification of that figure with Atlas is ours, and no ancient author makes it.' },
  { a: 'anhur', b: 'ares', tier: 'structural', systems: ['egyptian'],
    source: 'Function: Anhur is the hunter-warrior "who brings back the distant one", with a Thinite/Sebennytos cult.' },

  // ── Mesopotamian / Iranian / Arabian: Herodotus I.131 is one sentence doing a lot of work ───
  { a: 'ishtar', b: 'aphrodite', tier: 'attested', systems: ['greek-myth', 'linguistics'],
    source: 'Herodotus, Histories I.105, I.131 (Aphrodite Ourania)' },
  { a: 'mylitta', b: 'aphrodite', tier: 'attested', systems: ['greek-myth'],
    source: 'Herodotus I.131: "the Assyrians call Aphrodite Mylitta"' },
  { a: 'allat', b: 'aphrodite', tier: 'attested', systems: ['greek-myth'],
    source: 'Herodotus I.131: "the Arabians Alilat"; Herodotus III.8 pairs Alilat with Dionysos-Orotalt' },
  { a: 'mithra', b: 'aphrodite', tier: 'attested', systems: ['greek-myth'],
    source: 'Herodotus I.131: "the Persians Mitra"',
    note: 'Kept verbatim BECAUSE it is wrong. Mithra is male and solar; Herodotus has garbled Anahita. It is the clearest proof that an attested equation can still be a mistake, and the reason `attested` is a tier and not a verdict.' },
  { a: 'anahita', b: 'aphrodite', tier: 'structural', systems: ['linguistics', 'archaeology'],
    source: 'The correction to Herodotus I.131 — Anahita is the Iranian goddess of the role he describes.' },
  { a: 'astarte', b: 'ishtar', tier: 'cultic', systems: ['linguistics', 'archaeology'],
    source: 'ʿAṯtart / Ištar — the same West-Semitic and East-Semitic reflexes of one name.' },
  { a: 'marduk', b: 'zeus', tier: 'structural', systems: ['linguistics'],
    source: 'Function: storm-king who defeats the chaos-serpent and takes the kingship.' },

  // ── Indo-European: the comparative-method core, where the evidence is SOUND LAW, not a writer ─
  { a: 'dyaus', b: 'zeus', tier: 'attested', systems: ['linguistics'],
    source: 'Regular reflexes of PIE *Dyēus ph2tēr: Vedic Dyauṣ Pitar, Greek Zeus patēr, Latin Iuppiter.',
    note: 'The strongest equation in the whole file, and no ancient author made it. It is proven by sound correspondence, which is why `systems` is linguistics alone and it still holds.' },
  { a: 'dyaus', b: 'jupiter', tier: 'attested', systems: ['linguistics'],
    source: 'PIE *Dyēus ph2tēr → Diēspiter / Iuppiter' },
  { a: 'zeus', b: 'jupiter', tier: 'attested', systems: ['linguistics', 'greek-myth'],
    source: 'Cognate by sound law AND equated throughout Latin literature.' },
  { a: 'indra', b: 'thor', tier: 'structural', systems: ['linguistics'],
    source: 'The Dumezilian second-function thunderer who slays the serpent (Vritra / Jormungandr). Not cognate by name.' },
  { a: 'varuna', b: 'ouranos', tier: 'conjecture', systems: ['linguistics'],
    source: 'A 19th-century etymology now generally rejected; the sound correspondence does not work.',
    note: 'Retained as a worked example of a chart-equation that dies under the comparative method.' },
  { a: 'athena', b: 'minerva', tier: 'attested', systems: ['linguistics', 'greek-myth'],
    source: 'Standard interpretatio romana; Menrva on Etruscan mirrors is the intermediary.' },
  { a: 'menrva', b: 'minerva', tier: 'epigraphic', systems: ['archaeology', 'linguistics'],
    source: 'Etruscan mirror inscriptions naming Menrva in scenes of the Greek Athena.' },
  { a: 'uni', b: 'juno-caelestis', tier: 'cultic', systems: ['archaeology', 'linguistics'],
    source: 'Uni → Juno; the Capitoline triad is the Etruscan Tinia-Uni-Menrva received at Rome.' },
  { a: 'tinia', b: 'jupiter', tier: 'cultic', systems: ['archaeology'],
    source: 'Capitoline triad continuity' },
  { a: 'sethlans', b: 'vulcan', tier: 'cultic', systems: ['archaeology'],
    source: 'Etruscan mirrors and the Volcanal at Rome; Sethlans appears in the smith scenes Rome receives as Vulcan.' },
  { a: 'hephaistos', b: 'vulcan', tier: 'attested', systems: ['greek-myth', 'linguistics'],
    source: 'Standard interpretatio romana throughout Latin literature.' },
  { a: 'demeter', b: 'ceres', tier: 'attested', systems: ['greek-myth', 'linguistics'],
    source: 'Standard interpretatio romana; the Aventine cult is Greek in origin (Cicero, Pro Balbo 55).' },
  { a: 'dionysos', b: 'liber', tier: 'attested', systems: ['greek-myth'],
    source: 'Standard interpretatio romana; Liber Pater is the Punic-African Dionysos at Leptis Magna.' },
  { a: 'aphrodite', b: 'venus', tier: 'attested', systems: ['greek-myth', 'linguistics'],
    source: 'Standard interpretatio romana; Lucretius, De Rerum Natura I.1-20 opens on Venus in Aphrodite\u2019s role.' },
  { a: 'hermes', b: 'mercury', tier: 'attested', systems: ['greek-myth', 'linguistics'],
    source: 'Standard interpretatio romana; Horace, Odes I.10 addresses Mercury in the Hermes hymn form.' },
  { a: 'ares', b: 'mars', tier: 'attested', systems: ['greek-myth'],
    source: 'Standard interpretatio romana throughout Latin literature; note Mars carries agrarian functions Ares never had.' },
  { a: 'herakles', b: 'hercules', tier: 'attested', systems: ['greek-myth', 'linguistics'],
    source: 'Direct borrowing of the name via Etruscan Hercle; Livy I.7 on the Ara Maxima.' },
  { a: 'kronos', b: 'saturn', tier: 'attested', systems: ['greek-myth'],
    source: 'Macrobius, Saturnalia I.7-8; the Golden Age of Kronos received as the reign of Saturn.' },
  { a: 'hera', b: 'juno-caelestis', tier: 'attested', systems: ['greek-myth'],
    source: 'Standard interpretatio romana (Hera = Juno); the Caelestis title is the African overlay on that Juno.' },

  // ── Hebrew / Canaanite ─────────────────────────────────────────────────────────────────────
  { a: 'azazel', b: 'hephaistos', tier: 'conjecture', systems: ['biblical', 'greek-myth'],
    source: 'VKFRI, on 1 Enoch 8: Azazel teaches metalworking, blades, and ornament — the smith-who-fell.' },
  { a: 'molech', b: 'baal-hammon', tier: 'structural', systems: ['biblical', 'archaeology'],
    source: 'The MLK root and the tophet: the Carthaginian precinct matches the biblical polemic\'s description.',
    note: 'Whether Punic MLK names a god or names the offering RITE is a live scholarly dispute. Held at structural for that reason.' },
  { a: 'el', b: 'yahweh', tier: 'attested', systems: ['biblical', 'linguistics'],
    source: 'Exodus 6:2–3 — El Shaddai and YHWH named as the same god under two names.' },
  { a: 'asherah', b: 'athirat', tier: 'attested', systems: ['linguistics', 'archaeology'],
    source: 'The Ugaritic Athirat is the Hebrew Bible\'s Asherah; Kuntillet Ajrud names "YHWH and his Asherah".' },
  { a: 'baal-hadad', b: 'zeus', tier: 'cultic', systems: ['archaeology'],
    source: 'Zeus Kasios at Mount Kasios/Zaphon — Baal Zaphon\'s own mountain.' },
];

// ── Query surface ──────────────────────────────────────────────────────────────────────────────

/** Every equation touching `id`, strongest tier first. */
export function equationsFor(id) {
  if (!id) return [];
  return EQUATIONS
    .filter((e) => e.a === id || e.b === id)
    .map((e) => ({ ...e, other: e.a === id ? e.b : e.a }))
    .sort((x, y) => tierRank(y.tier) - tierRank(x.tier));
}

/**
 * The transitive cluster of figures reachable from `id` by edges at or above `minTier`.
 * Defaults to 'cultic' so a conjecture cannot silently graft itself onto an attested chain and
 * inherit its authority — which is the failure mode this whole module exists to prevent.
 */
export function cluster(id, { minTier = 'cultic' } = {}) {
  if (!NODE_BY_ID.has(id)) return [];
  const floor = tierRank(minTier);
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of EQUATIONS) {
      if (tierRank(e.tier) < floor) continue;
      const next = e.a === cur ? e.b : e.b === cur ? e.a : null;
      if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  seen.delete(id);
  return [...seen].sort();
}

/**
 * GEO_MYTHO_CALCULUS §7.2 applied literally: union the evidentiary systems along every path
 * between two figures and report whether three or more independent systems converge.
 * It searches for the BEST-EVIDENCED route, not the shortest one — see the note in the body.
 * Returns { connected, systems, tiers, weakest, met, hops, path }. `weakest` is the flimsiest edge
 * on that route: a chain is only as strong as that, and reporting `met: true` without it is a lie.
 */
export function triangulate(a, b, { minTier = 'structural', required = 3 } = {}) {
  if (!NODE_BY_ID.has(a) || !NODE_BY_ID.has(b) || a === b) {
    return { connected: false, systems: [], tiers: [], weakest: null, met: false, hops: 0, path: [] };
  }
  const floor = tierRank(minTier);
  const edges = EQUATIONS.filter((e) => tierRank(e.tier) >= floor);
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push({ to: e.b, edge: e });
    adj.get(e.b).push({ to: e.a, edge: e });
  }

  // Enumerate simple paths and keep the BEST one, not the shortest. A shortest-path search returns
  // the FEWEST evidentiary systems, which is exactly backwards for a convergence test: a two-hop
  // route through an attested intermediary is stronger evidence than a one-hop structural shortcut.
  // Ranking: most systems first, then strongest weakest-link, then fewest hops.
  let best = null;
  const MAX_HOPS = 6;
  const walk = (node, visited, used) => {
    if (node === b) {
      const systems = new Set();
      let weakestRank = Infinity;
      for (const e of used) {
        (e.systems || []).forEach((x) => systems.add(x));
        weakestRank = Math.min(weakestRank, tierRank(e.tier));
      }
      const cand = {
        systems: [...systems].sort(),
        tiers: used.map((e) => e.tier),
        weakest: TIERS[weakestRank],
        hops: used.length,
        path: [...visited],
      };
      if (!best
        || cand.systems.length > best.systems.length
        || (cand.systems.length === best.systems.length && tierRank(cand.weakest) > tierRank(best.weakest))
        || (cand.systems.length === best.systems.length && cand.weakest === best.weakest && cand.hops < best.hops)) {
        best = cand;
      }
      return;
    }
    if (used.length >= MAX_HOPS) return;
    for (const { to, edge } of adj.get(node) || []) {
      if (visited.includes(to)) continue;
      walk(to, [...visited, to], [...used, edge]);
    }
  };
  walk(a, [a], []);

  if (!best) return { connected: false, systems: [], tiers: [], weakest: null, met: false, hops: 0, path: [] };
  return { connected: true, ...best, met: best.systems.length >= required };
}

/** Every edge we are proposing ourselves. Surfaced so it can never hide inside a chain. */
export function weakLinks() {
  return EQUATIONS.filter((e) => e.tier === 'conjecture' || e.tier === 'structural')
    .sort((x, y) => tierRank(x.tier) - tierRank(y.tier));
}

/** Node ids referenced here that hierophant-entities.mjs does not yet carry: the registry backlog. */
export function registryGap() {
  const known = new Set(ENTITY_IDS);
  return NODES.filter((n) => !known.has(n.id)).map((n) => n.id).sort();
}

/** Structural integrity: every edge endpoint is a declared node, every tier and system is legal. */
export function validate() {
  const errors = [];
  const ids = new Set(NODES.map((n) => n.id));
  if (ids.size !== NODES.length) errors.push('duplicate node id');
  for (const e of EQUATIONS) {
    if (!ids.has(e.a)) errors.push(`unknown node in equation: ${e.a}`);
    if (!ids.has(e.b)) errors.push(`unknown node in equation: ${e.b}`);
    if (e.a === e.b) errors.push(`self-equation: ${e.a}`);
    if (!TIERS.includes(e.tier)) errors.push(`bad tier: ${e.tier}`);
    for (const s of e.systems || []) if (!SYSTEMS.includes(s)) errors.push(`bad system: ${s}`);
    if (tierRank(e.tier) >= tierRank('cultic') && !e.source) errors.push(`${e.a}=${e.b} claims ${e.tier} with no source`);
  }
  return { ok: errors.length === 0, errors };
}

// ── ETYMOLOGY AND PLANET ───────────────────────────────────────────────────────────────────────
// Added as side maps rather than inline fields so NODES stays readable and so the GAPS are
// countable: `etymologyGap()` returns every figure we cannot yet gloss, which is the research
// backlog rather than a silence.
//
// `confidence` is the point. A god-name etymology is the single most folk-etymologised category of
// word in any language — Kronos is NOT chronos, Aphrodite is not really "foam-born", and Hesiod
// saying so in the Theogony is a poet punning, not a lexicographer working. Every entry below is
// marked secure / disputed / unknown, and 'unknown' is used freely.

export const ETYMOLOGY = {
  // Egyptian — the transliterations are conventional Egyptological ones
  hathor: { form: 'ḥwt-ḥr', gloss: 'mansion of Horus', confidence: 'secure' },
  anhur: { form: 'jnj-ḥrt', gloss: 'he who brings back the distant one', confidence: 'secure' },
  khepri: { form: 'ḫprr', gloss: 'scarab beetle; from ḫpr "to come into being"', confidence: 'secure' },
  amun: { form: 'jmn', gloss: 'the hidden one', confidence: 'secure' },
  ptah: { form: 'ptḥ', gloss: 'the opener / sculptor', confidence: 'secure' },
  wadjet: { form: 'wꜢḏyt', gloss: 'the green one (also the papyrus-colour, and the uraeus)', confidence: 'secure' },
  bastet: { form: 'bꜢstt', gloss: 'she of Bast — i.e. of the city Bubastis', confidence: 'secure' },
  isis: { form: 'ꜣst', gloss: 'throne — her headdress writes her name', confidence: 'secure' },
  horus: { form: 'ḥr', gloss: 'the distant one / the falcon', confidence: 'secure' },
  thoth: { form: 'ḏḥwty', gloss: 'he of Djehut', confidence: 'disputed' },
  osiris: { form: 'wsjr', gloss: 'unresolved — "place of the eye", "mighty one" and others proposed', confidence: 'unknown' },
  neith: { form: 'nt', gloss: 'unresolved; linked to the red crown and to the weaving shuttle in her emblem', confidence: 'unknown' },
  set: { form: 'swtḫ / stš', gloss: 'unresolved', confidence: 'unknown' },
  shu: { form: 'šw', gloss: 'emptiness / he who rises up', confidence: 'disputed' },

  // Phoenician / Punic / Canaanite
  melqart: { form: 'mlk-qrt', gloss: 'king of the city', confidence: 'secure' },
  astarte: { form: 'ʿṯtrt', gloss: 'the West Semitic reflex of the same name as Akkadian Ištar', confidence: 'secure' },
  asherah: { form: 'ʾṯrt (Ugaritic Athirat)', gloss: 'possibly "she who treads the sea"', confidence: 'disputed' },
  athirat: { form: 'ʾṯrt', gloss: 'Ugaritic form of Asherah', confidence: 'secure' },
  el: { form: 'ʾl', gloss: 'god — the common Semitic noun used as a proper name', confidence: 'secure' },
  'baal-hadad': { form: 'bʿl hd', gloss: 'lord Hadad; hdd probably "thunderer"', confidence: 'secure' },
  'baal-hammon': { form: 'bʿl ḥmn', gloss: 'lord of the ḥmn — "brazier", "Mount Amanus" and "sanctuary" all proposed', confidence: 'disputed' },
  'baal-shamem': { form: 'bʿl šmm', gloss: 'lord of the heavens', confidence: 'secure' },
  eshmun: { form: 'ʾšmn', gloss: 'possibly from šmn "oil", possibly from the numeral eight', confidence: 'disputed' },
  tanit: { form: 'tnt', gloss: 'Egyptian ta-nit "she of Neith" proposed; Semitic and Berber derivations also live', confidence: 'disputed' },

  // Hebrew
  yahweh: { form: 'YHWH', gloss: 'linked at Exodus 3:14 to ʾehyeh "I am"; the linguistic derivation is unresolved', confidence: 'disputed' },
  molech: { form: 'mlk', gloss: 'the king-root, vocalised in the Masoretic text with the vowels of bōšet "shame"', confidence: 'disputed' },
  azazel: { form: 'ʿzʾzl', gloss: '"God strengthens" or "the goat that departs" — both proposed, neither settled', confidence: 'disputed' },

  // Mesopotamian
  marduk: { form: 'amar-utu(k)', gloss: 'calf of the sun god', confidence: 'secure' },
  ishtar: { form: 'Inanna < nin-an-ak', gloss: 'lady of heaven (the Sumerian name; Ištar is the Akkadian)', confidence: 'secure' },
  ea: { form: 'en-ki', gloss: 'lord of the earth (Sumerian); Akkadian Ea is unresolved', confidence: 'disputed' },
  ninkasi: { form: 'nin-ka-si', gloss: 'the lady who fills the mouth', confidence: 'secure' },
  mylitta: { form: 'Mullissu / Ninlil', gloss: 'Herodotus\'s rendering of the Assyrian goddess-name', confidence: 'disputed' },

  // Greek — where the honest answer is usually "pre-Greek"
  zeus: { form: 'PIE *dyēus', gloss: 'the bright sky; vocative Zeu pater = Iuppiter = Dyauṣ Pitar', confidence: 'secure' },
  athena: { form: 'Ἀθήνη', gloss: 'pre-Greek; the goddess is most likely named FROM the city, not the city from her', confidence: 'disputed' },
  apollo: { form: 'Ἀπόλλων', gloss: 'unresolved; Doric Apellon and an Anatolian origin both proposed', confidence: 'unknown' },
  poseidon: { form: 'Ποσειδῶν', gloss: 'possibly posis + dā, "lord of the earth"; the second element is not securely identified', confidence: 'disputed' },
  demeter: { form: 'Δημήτηρ', gloss: '-mētēr is "mother"; the first element is NOT securely "earth"', confidence: 'disputed' },
  hermes: { form: 'Ἑρμῆς', gloss: 'possibly from herma, a heap of stones marking a boundary', confidence: 'disputed' },
  ares: { form: 'Ἄρης', gloss: 'possibly from arē "ruin, bane"; already a common noun for "battle" in Mycenaean', confidence: 'disputed' },
  hephaistos: { form: 'Ἥφαιστος', gloss: 'pre-Greek, no accepted derivation', confidence: 'unknown' },
  aphrodite: { form: 'Ἀφροδίτη', gloss: 'Hesiod\'s "foam-born" (aphros) is a FOLK ETYMOLOGY; a Semitic origin via Astarte is widely proposed', confidence: 'disputed' },
  kronos: { form: 'Κρόνος', gloss: 'unresolved — and NOT from chronos "time". That identification is a late antique pun that became doctrine.', confidence: 'unknown' },
  herakles: { form: 'Ἡρακλῆς', gloss: 'Hera + kleos = "glory of Hera", which is odd given she persecutes him', confidence: 'secure' },
  atlas: { form: 'Ἄτλας', gloss: 'traditionally a- + *telh₂- "to bear"; a Berber derivation (adrar, "mountain") is also proposed', confidence: 'disputed' },
  leto: { form: 'Λητώ', gloss: 'possibly Lycian lada, "wife, woman"', confidence: 'disputed' },
  artemis: { form: 'Ἄρτεμις', gloss: 'unresolved; attested in Linear B as a-te-mi-to', confidence: 'unknown' },
  hera: { form: 'Ἥρα', gloss: 'unresolved; links to hōra "season" and to hērōs proposed', confidence: 'unknown' },

  // Roman / Etruscan
  jupiter: { form: 'Iuppiter < *dyeu-ph₂tēr', gloss: 'sky father', confidence: 'secure' },
  venus: { form: 'PIE *wenh₁-', gloss: 'to desire — cognate with venerate, venom and English "win"', confidence: 'secure' },
  ceres: { form: 'PIE *ḱer-', gloss: 'to grow, to nourish — cognate with create and cereal', confidence: 'secure' },
  mercury: { form: 'merx / mercari', gloss: 'merchandise, trade', confidence: 'secure' },
  mars: { form: 'Mavors; Etruscan Maris', gloss: 'unresolved', confidence: 'unknown' },
  saturn: { form: 'Saturnus', gloss: 'linked by the Romans to satus "sowing"; probably Etruscan and not Latin at all', confidence: 'disputed' },
  minerva: { form: 'Etruscan Menrva; PIE *men-', gloss: 'mind, thought', confidence: 'disputed' },
  vulcan: { form: 'Volcanus; Etruscan Velchans', gloss: 'unresolved, probably Etruscan', confidence: 'unknown' },
  'juno-caelestis': { form: 'Iuno + caelestis', gloss: 'Juno "the heavenly"; the African title of the Carthaginian goddess', confidence: 'secure' },
  liber: { form: 'liber', gloss: 'free — the Italic god of freedom and of wine', confidence: 'secure' },
  pomona: { form: 'pomum', gloss: 'fruit', confidence: 'secure' },
  fornax: { form: 'fornax', gloss: 'oven, kiln', confidence: 'secure' },
  concordia: { form: 'concordia', gloss: 'agreement — literally "hearts together"', confidence: 'secure' },

  // Germanic — where the etymologies are unusually good
  odin: { form: 'Proto-Germanic *Wōðanaz, from *wōðaz', gloss: 'fury, poetic inspiration — cognate with Latin vates, "seer"', confidence: 'secure' },
  thor: { form: '*Þunraz', gloss: 'thunder — the god\'s name IS the common noun', confidence: 'secure' },
  tyr: { form: '*Tīwaz < PIE *deywos', gloss: 'god — the SAME root as Zeus and Jupiter. Tyr\'s name is the generic word for "a god", which is why he is usually read as a displaced sky-father.', confidence: 'secure' },
  frigg: { form: '*Frijjō, from PIE *preyH-', gloss: 'beloved — cognate with English "free" and "friend"', confidence: 'secure' },

  // Indo-Iranian
  dyaus: { form: 'PIE *dyēus ph₂tēr', gloss: 'sky father', confidence: 'secure' },
  mithra: { form: 'Indo-Iranian *mitra-', gloss: 'contract, covenant — the god IS the binding agreement', confidence: 'secure' },
  anahita: { form: 'an-āhita', gloss: 'the unstained, the immaculate', confidence: 'secure' },
  'soma-deva': { form: 'PIE *sew- / *seu-', gloss: 'to press, to extract — exact cognate of Avestan haoma', confidence: 'secure' },
  varuna: { form: 'possibly PIE *wer-', gloss: 'to cover, to bind. NOT cognate with Ouranos — that etymology fails on sound law.', confidence: 'disputed' },
  pashupati: { form: 'paśu-pati', gloss: 'lord of animals', confidence: 'secure' },
  indra: { form: 'Indra', gloss: 'unresolved; a non-Indo-European substrate origin is proposed', confidence: 'unknown' },
  dhanvantari: { form: 'dhanvan-tari', gloss: 'traditionally "moving through a curve/bow"; contested', confidence: 'disputed' },
  vishvakarma: { form: 'viśva-karman', gloss: 'all-maker, doer of everything', confidence: 'secure' },

  // Berber / Libyan / Arabian
  anzar: { form: 'Berber anẓar', gloss: 'rain — the god\'s name is the common noun, as with Thor', confidence: 'secure' },
  ifri: { form: 'Berber ifri', gloss: 'cave — and the most-cited candidate source of the name "Africa"', confidence: 'disputed' },
  'africa-dea': { form: 'Latin Africa, possibly from Berber ifri', gloss: 'the cave-goddess of the Ifri; competing derivations from a tribal name and from Punic exist', confidence: 'disputed' },
  gurzil: { form: 'Gurzil', gloss: 'unresolved Berber theonym; Corippus gives the myth, not the etymology', confidence: 'unknown' },
  allat: { form: 'al-Lāt', gloss: 'literally "the goddess" — the definite article plus the feminine of ʾilāh', confidence: 'secure' },
};

// The Babylonian planet-god assignments are ATTESTED in astronomical texts, and the Greek and Latin
// names for the planets are translations OF THEM. This is a documented transmission, not a scheme.
export const PLANET = {
  marduk: 'Jupiter', ishtar: 'Venus', // Nabu=Mercury, Nergal=Mars, Ninurta=Saturn complete the set
  zeus: 'Jupiter', jupiter: 'Jupiter', dyaus: 'Jupiter', tinia: 'Jupiter', amun: 'Jupiter',
  ares: 'Mars', mars: 'Mars', tyr: 'Mars', anhur: 'Mars', gurzil: 'Mars',
  hermes: 'Mercury', mercury: 'Mercury', odin: 'Mercury', thoth: 'Mercury',
  aphrodite: 'Venus', venus: 'Venus', frigg: 'Venus', hathor: 'Venus', astarte: 'Venus',
  allat: 'Venus', anahita: 'Venus', mylitta: 'Venus', tanit: 'Venus',
  kronos: 'Saturn', saturn: 'Saturn', 'baal-hammon': 'Saturn',
  apollo: 'Sun', horus: 'Sun', khepri: 'Sun', mithra: 'Sun',
  artemis: 'Moon', bastet: 'Moon', wadjet: 'Moon',
  thor: 'Jupiter', // by the WEEKDAY calque, against Tacitus's Hercules — both are recorded
};

/** A node with its etymology and planet folded in. Unknown fields come back null, never invented. */
export function enrich(id) {
  const n = getNode(id);
  if (!n) return null;
  return { ...n, etymology: ETYMOLOGY[id] || null, planet: PLANET[id] || null };
}

/** Figures we cannot yet gloss — the etymology research backlog, countable rather than silent. */
export function etymologyGap() {
  return NODES.filter((n) => !ETYMOLOGY[n.id]).map((n) => n.id).sort();
}

/** Etymologies we hold but do not trust. Publishing these unmarked would be the whole problem. */
export function shakyEtymologies() {
  return Object.entries(ETYMOLOGY)
    .filter(([, e]) => e.confidence !== 'secure')
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => (a.confidence === b.confidence ? a.id.localeCompare(b.id) : a.confidence.localeCompare(b.confidence)));
}

/** Every figure assigned to a planet, grouped — the interpretatio, seen by sphere. */
export function byPlanet() {
  const out = {};
  for (const [id, p] of Object.entries(PLANET)) (out[p] = out[p] || []).push(id);
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}
