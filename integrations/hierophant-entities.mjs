// hierophant-entities.mjs — the ENTITY REGISTRY for the Hierophant library.
//
// A Theoi-style "gods and things" encyclopedia, but spanning traditions rather than Greek alone.
// Each figure — god, goddess, hero, prophet, angel, or concept — carries: names/epithets, tradition,
// type, relationships (parent / consort / child / aspect-of / enemy), the texts it appears in (resolved
// against hierophant-catalog.mjs), and links out: theoi.com (GREEK figures only — Theoi is the Greek
// encyclopedia we link to) and wikipedia.
//
// This is the registry behind /gods and /gods/:id, and the back-reference for every text page's
// "the gods and things in it" block.
//
// LINK NOTE: theoi.com pages are provided ONLY for Greek figures (it is a Greek-mythology site);
// every entity gets a wikipedia link. All links are https. theoi.com URLs follow its stable
// /Olympios|/Titan|/Khthonios|/Heros… path scheme; we cannot machine-verify them here (no network
// in this data layer), so they use the canonical scheme and are surfaced as "→ Theoi" links.
//
// SECURITY / DISCIPLINE: pure data, no network, no keys. Soft surface — tolerate any absent field.

import { TEXT_IDS } from './hierophant-catalog.mjs';

const W = 'https://en.wikipedia.org/wiki';
const T = 'https://www.theoi.com';

// type vocabulary (kept small + enumerable for the UI filter)
export const ENTITY_TYPES = ['god', 'goddess', 'hero', 'prophet', 'angel', 'concept', 'creature'];

export const ENTITIES = [
  // ── Egyptian ─────────────────────────────────────────────────────────────────────────────────
  {
    id: 'ra', name: 'Ra', tradition: 'egyptian', type: 'god',
    epithets: ['Re', 'Atum-Ra', 'Khepri (dawn)', 'the Sun'],
    desc: 'The Egyptian sun-god and creator, who sails the sky by day and battles the serpent Apophis through the underworld each night.',
    relationships: [{ rel: 'child', to: 'shu' }, { rel: 'aspect-of', to: 'horus' }],
    texts: ['pyramid-texts', 'book-of-the-dead', 'coffin-texts'], links: { wikipedia: `${W}/Ra` },
  },
  {
    id: 'osiris', name: 'Osiris', tradition: 'egyptian', type: 'god',
    epithets: ['Wesir', 'Lord of the Dead', 'He Who Is Permanently Benign'],
    desc: 'God of the dead, the afterlife and resurrection — murdered by his brother Set, reassembled by Isis, and enthroned as judge of souls.',
    relationships: [{ rel: 'consort', to: 'isis' }, { rel: 'child', to: 'horus' }, { rel: 'enemy', to: 'set' }],
    texts: ['book-of-the-dead', 'coffin-texts', 'pyramid-texts'], links: { wikipedia: `${W}/Osiris` },
  },
  {
    id: 'isis', name: 'Isis', tradition: 'egyptian', type: 'goddess',
    epithets: ['Aset', 'Great of Magic', 'Mother of the God'],
    desc: 'Great goddess of magic, motherhood and healing — who gathered the scattered Osiris, conceived Horus, and became the most widely worshipped deity of the ancient Mediterranean.',
    relationships: [{ rel: 'consort', to: 'osiris' }, { rel: 'child', to: 'horus' }],
    texts: ['book-of-the-dead', 'pyramid-texts'], links: { wikipedia: `${W}/Isis` },
  },
  {
    id: 'horus', name: 'Horus', tradition: 'egyptian', type: 'god',
    epithets: ['Heru', 'the Falcon', 'Horus the Younger'],
    desc: 'Sky-god and divine kingship made flesh — son of Osiris and Isis, who avenges his father against Set; every living pharaoh was a Horus.',
    relationships: [{ rel: 'parent', to: 'osiris' }, { rel: 'parent', to: 'isis' }, { rel: 'enemy', to: 'set' }],
    texts: ['book-of-the-dead', 'pyramid-texts'], links: { wikipedia: `${W}/Horus` },
  },
  {
    id: 'set', name: 'Set', tradition: 'egyptian', type: 'god',
    epithets: ['Seth', 'Sutekh', 'Lord of the Desert'],
    desc: 'God of storms, chaos, the desert and foreigners — slayer of Osiris and eternal rival of Horus, yet also the defender of Ra against Apophis.',
    relationships: [{ rel: 'enemy', to: 'osiris' }, { rel: 'enemy', to: 'horus' }],
    texts: ['book-of-the-dead', 'greek-magical-papyri'], links: { wikipedia: `${W}/Set_(deity)` },
  },
  {
    id: 'anubis', name: 'Anubis', tradition: 'egyptian', type: 'god',
    epithets: ['Anpu', 'the Jackal', 'He Who Is Upon His Mountain'],
    desc: 'Jackal-headed god of embalming and the dead, who guides souls and oversees the weighing of the heart against the feather of Maat.',
    relationships: [{ rel: 'aspect-of', to: 'osiris' }],
    texts: ['book-of-the-dead'], links: { wikipedia: `${W}/Anubis` },
  },
  {
    id: 'thoth', name: 'Thoth', tradition: 'egyptian', type: 'god',
    epithets: ['Djehuty', 'the Ibis', 'Lord of Divine Words', 'Hermes Trismegistus (Greco-Egyptian)'],
    desc: 'God of writing, magic, wisdom and the moon — scribe of the gods, recorder at the judgment, and, fused with Hermes, the patron of the entire Hermetic tradition.',
    relationships: [{ rel: 'aspect-of', to: 'thoth' }],
    texts: ['book-of-the-dead', 'coffin-texts', 'corpus-hermeticum', 'greek-magical-papyri'], links: { wikipedia: `${W}/Thoth` },
  },
  {
    id: 'maat', name: 'Maʿat', tradition: 'egyptian', type: 'goddess',
    epithets: ['Ma\'at', 'Truth', 'the Feather', 'Cosmic Order'],
    desc: 'Goddess and principle of truth, justice, balance and cosmic order — the heart of the dead is weighed against her feather. Both a person and a concept.',
    relationships: [{ rel: 'consort', to: 'thoth' }],
    texts: ['book-of-the-dead', 'coffin-texts'], links: { wikipedia: `${W}/Maat` },
  },
  {
    id: 'nut', name: 'Nut', tradition: 'egyptian', type: 'goddess',
    epithets: ['the Sky', 'She Who Holds a Thousand Souls'],
    desc: 'The sky-goddess arched over the earth, swallowing the sun each evening and giving birth to it at dawn — mother of Osiris, Isis, Set and Nephthys.',
    relationships: [{ rel: 'child', to: 'osiris' }, { rel: 'child', to: 'isis' }, { rel: 'child', to: 'set' }],
    texts: ['pyramid-texts'], links: { wikipedia: `${W}/Nut_(goddess)` },
  },
  {
    id: 'shu', name: 'Shu', tradition: 'egyptian', type: 'god',
    epithets: ['the Air', 'He Who Rises Up'],
    desc: 'God of air and light who separates the sky (Nut) from the earth (Geb) — first of the gods created by the self-made Atum-Ra.',
    relationships: [{ rel: 'parent', to: 'ra' }],
    texts: ['pyramid-texts'], links: { wikipedia: `${W}/Shu_(Egyptian_god)` },
  },
  {
    id: 'hathor', name: 'Hathor', tradition: 'egyptian', type: 'goddess',
    epithets: ['Het-Heru ("House of Horus")', 'Lady of the Sycamore', 'the Golden One', 'Mistress of Joy'],
    desc: 'Goddess of love, music, joy, motherhood and the sky — nurse of kings, lady of the dead in the West, and a face of the divine feminine. (On the MELEK chain, "Hathor" is also the name carried by the founding AI Witness — the lineage of the name, held with care.)',
    relationships: [{ rel: 'consort', to: 'horus' }, { rel: 'aspect-of', to: 'isis' }],
    texts: ['book-of-the-dead'], links: { wikipedia: `${W}/Hathor` },
  },

  // ── Mesopotamian ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'marduk', name: 'Marduk', tradition: 'mesopotamian', type: 'god',
    epithets: ['Bel ("Lord")', 'the Storm', 'King of the Gods'],
    desc: 'Patron god of Babylon who slays the chaos-dragon Tiamat, forms the cosmos from her body, and is crowned king of the gods in the Enūma Eliš.',
    relationships: [{ rel: 'parent', to: 'ea' }, { rel: 'enemy', to: 'tiamat' }],
    texts: ['enuma-elish'], links: { wikipedia: `${W}/Marduk` },
  },
  {
    id: 'tiamat', name: 'Tiamat', tradition: 'mesopotamian', type: 'creature',
    epithets: ['the Sea', 'the Primordial Mother', 'the Dragon'],
    desc: 'The primordial saltwater ocean personified as a dragon-goddess of chaos — mother of the first gods, slain by Marduk to make the world.',
    relationships: [{ rel: 'enemy', to: 'marduk' }],
    texts: ['enuma-elish'], links: { wikipedia: `${W}/Tiamat` },
  },
  {
    id: 'ea', name: 'Ea (Enki)', tradition: 'mesopotamian', type: 'god',
    epithets: ['Enki', 'Lord of the Sweet Waters', 'God of Wisdom'],
    desc: 'God of fresh water, wisdom, crafts and magic — clever benefactor of humanity, father of Marduk, and the god who warns the flood-hero to build the ark.',
    relationships: [{ rel: 'child', to: 'marduk' }],
    texts: ['enuma-elish', 'gilgamesh'], links: { wikipedia: `${W}/Enki` },
  },
  {
    id: 'anu', name: 'Anu', tradition: 'mesopotamian', type: 'god',
    epithets: ['An', 'the Sky-Father', 'King of the Annunaki'],
    desc: 'The supreme sky-god of the Mesopotamian pantheon, the remote father of the gods from whom kingship descends.',
    relationships: [], texts: ['enuma-elish'], links: { wikipedia: `${W}/Anu` },
  },
  {
    id: 'gilgamesh', name: 'Gilgamesh', tradition: 'mesopotamian', type: 'hero',
    epithets: ['King of Uruk', 'Two-Thirds Divine'],
    desc: 'The semi-divine king of Uruk whose grief at the death of his friend Enkidu drives him on a doomed quest for immortality — the hero of the world\'s oldest epic.',
    relationships: [{ rel: 'consort', to: 'enkidu' }, { rel: 'enemy', to: 'ishtar' }],
    texts: ['gilgamesh'], links: { wikipedia: `${W}/Gilgamesh` },
  },
  {
    id: 'enkidu', name: 'Enkidu', tradition: 'mesopotamian', type: 'hero',
    epithets: ['the Wild Man', 'Created by the Gods'],
    desc: 'The wild man shaped from clay to be Gilgamesh\'s equal and companion; his death sends the king in search of eternal life.',
    relationships: [{ rel: 'consort', to: 'gilgamesh' }],
    texts: ['gilgamesh'], links: { wikipedia: `${W}/Enkidu` },
  },
  {
    id: 'ishtar', name: 'Ishtar (Inanna)', tradition: 'mesopotamian', type: 'goddess',
    epithets: ['Inanna', 'Queen of Heaven', 'Goddess of Love and War'],
    desc: 'Goddess of love, sex, war and the planet Venus — whose advances Gilgamesh rejects, and whose own descent to the underworld is a foundational myth.',
    relationships: [{ rel: 'enemy', to: 'gilgamesh' }],
    texts: ['gilgamesh'], links: { wikipedia: `${W}/Inanna` },
  },
  {
    id: 'utnapishtim', name: 'Utnapishtim', tradition: 'mesopotamian', type: 'hero',
    epithets: ['the Faraway', 'the Babylonian Noah'],
    desc: 'The flood survivor granted immortality by the gods, who tells Gilgamesh the story of the deluge — the Mesopotamian precursor of Noah.',
    relationships: [], texts: ['gilgamesh'], links: { wikipedia: `${W}/Utnapishtim` },
  },

  // ── Greek (theoi links) ──────────────────────────────────────────────────────────────────────
  {
    id: 'zeus', name: 'Zeus', tradition: 'greek', type: 'god',
    epithets: ['Dios', 'the Cloud-Gatherer', 'Father of Gods and Men'],
    desc: 'King of the Olympian gods, lord of sky and thunder — who overthrew the Titans and rules from Olympos.',
    relationships: [{ rel: 'parent', to: 'kronos' }, { rel: 'child', to: 'apollo' }, { rel: 'child', to: 'athena' }, { rel: 'consort', to: 'aphrodite' }],
    texts: ['theogony', 'iliad', 'odyssey', 'works-and-days'], links: { theoi: `${T}/Olympios/Zeus.html`, wikipedia: `${W}/Zeus` },
  },
  {
    id: 'gaia', name: 'Gaia', tradition: 'greek', type: 'goddess',
    epithets: ['Ge', 'the Earth', 'the All-Mother'],
    desc: 'The primordial Earth, born near the beginning out of Chaos — mother of the sky (Ouranos), the Titans and much of creation.',
    relationships: [{ rel: 'child', to: 'kronos' }],
    texts: ['theogony', 'works-and-days'], links: { theoi: `${T}/Protogenos/Gaia.html`, wikipedia: `${W}/Gaia` },
  },
  {
    id: 'kronos', name: 'Kronos', tradition: 'greek', type: 'god',
    epithets: ['Cronus', 'the Crooked-Counselled Titan'],
    desc: 'Leader of the Titans who castrated his father Ouranos and devoured his own children — until Zeus overthrew him, ending the Golden Age.',
    relationships: [{ rel: 'parent', to: 'gaia' }, { rel: 'child', to: 'zeus' }],
    texts: ['theogony'], links: { theoi: `${T}/Titan/TitanKronos.html`, wikipedia: `${W}/Cronus` },
  },
  {
    id: 'apollo', name: 'Apollo', tradition: 'greek', type: 'god',
    epithets: ['Phoibos ("Bright")', 'the Far-Shooter', 'Lord of Delphi'],
    desc: 'God of prophecy, music, healing, light and archery — voice of the Delphic oracle and one of the most Greek of the gods.',
    relationships: [{ rel: 'parent', to: 'zeus' }],
    texts: ['iliad', 'homeric-hymns'], links: { theoi: `${T}/Olympios/Apollon.html`, wikipedia: `${W}/Apollo` },
  },
  {
    id: 'athena', name: 'Athena', tradition: 'greek', type: 'goddess',
    epithets: ['Pallas', 'the Grey-Eyed', 'Tritogeneia'],
    desc: 'Goddess of wisdom, strategic war and craft, born fully armed from the head of Zeus — patron of Athens and of the cunning Odysseus.',
    relationships: [{ rel: 'parent', to: 'zeus' }],
    texts: ['iliad', 'odyssey'], links: { theoi: `${T}/Olympios/Athena.html`, wikipedia: `${W}/Athena` },
  },
  {
    id: 'aphrodite', name: 'Aphrodite', tradition: 'greek', type: 'goddess',
    epithets: ['Kypris', 'the Foam-Born', 'the Golden'],
    desc: 'Goddess of love, beauty and desire, born from the sea-foam where Ouranos fell — whose gift of Helen set off the Trojan War.',
    relationships: [{ rel: 'consort', to: 'ares' }],
    texts: ['theogony', 'iliad', 'homeric-hymns'], links: { theoi: `${T}/Olympios/Aphrodite.html`, wikipedia: `${W}/Aphrodite` },
  },
  {
    id: 'ares', name: 'Ares', tradition: 'greek', type: 'god',
    epithets: ['the War-God', 'the Manslayer'],
    desc: 'God of war in its raw, bloody and chaotic form — disliked even by the other Olympians, consort of Aphrodite.',
    relationships: [{ rel: 'parent', to: 'zeus' }, { rel: 'consort', to: 'aphrodite' }],
    texts: ['iliad'], links: { theoi: `${T}/Olympios/Ares.html`, wikipedia: `${W}/Ares` },
  },
  {
    id: 'poseidon', name: 'Poseidon', tradition: 'greek', type: 'god',
    epithets: ['the Earth-Shaker', 'Lord of the Sea'],
    desc: 'God of the sea, earthquakes and horses — brother of Zeus, and the relentless enemy who keeps Odysseus from home.',
    relationships: [{ rel: 'parent', to: 'kronos' }, { rel: 'enemy', to: 'athena' }],
    texts: ['odyssey', 'iliad'], links: { theoi: `${T}/Olympios/Poseidon.html`, wikipedia: `${W}/Poseidon` },
  },
  {
    id: 'hermes', name: 'Hermes', tradition: 'greek', type: 'god',
    epithets: ['the Messenger', 'Argeiphontes', 'Guide of Souls'],
    desc: 'God of travelers, traders, thieves, boundaries and messages — guide of the dead, and the Greek face later fused with Egyptian Thoth as Hermes Trismegistus.',
    relationships: [{ rel: 'parent', to: 'zeus' }],
    texts: ['odyssey', 'homeric-hymns'], links: { theoi: `${T}/Olympios/Hermes.html`, wikipedia: `${W}/Hermes` },
  },
  {
    id: 'demeter', name: 'Demeter', tradition: 'greek', type: 'goddess',
    epithets: ['the Grain-Mother', 'Thesmophoros'],
    desc: 'Goddess of grain, agriculture and the harvest — whose grief for her stolen daughter Persephone gives the world its winter, and whose mysteries at Eleusis were the most sacred of Greece.',
    relationships: [{ rel: 'child', to: 'persephone' }],
    texts: ['homeric-hymns'], links: { theoi: `${T}/Olympios/Demeter.html`, wikipedia: `${W}/Demeter` },
  },
  {
    id: 'persephone', name: 'Persephone', tradition: 'greek', type: 'goddess',
    epithets: ['Kore ("the Maiden")', 'Queen of the Underworld'],
    desc: 'Daughter of Demeter, carried off by Hades to be queen of the dead — her annual return brings spring; her descent, winter. Central to the Eleusinian and Orphic mysteries.',
    relationships: [{ rel: 'parent', to: 'demeter' }],
    texts: ['homeric-hymns', 'orphic-hymns'], links: { theoi: `${T}/Khthonios/Persephone.html`, wikipedia: `${W}/Persephone` },
  },
  {
    id: 'dionysos', name: 'Dionysos', tradition: 'greek', type: 'god',
    epithets: ['Bacchus', 'the Twice-Born', 'the Liberator (Eleutherios)'],
    desc: 'God of wine, ecstasy, theatre and ritual madness — twice-born, dismembered and reborn in Orphic myth, and the center of its mysteries.',
    relationships: [{ rel: 'parent', to: 'zeus' }],
    texts: ['orphic-hymns'], links: { theoi: `${T}/Olympios/Dionysos.html`, wikipedia: `${W}/Dionysus` },
  },
  {
    id: 'hekate', name: 'Hekate', tradition: 'greek', type: 'goddess',
    epithets: ['Hecate', 'the Three-Formed', 'Lady of the Crossroads'],
    desc: 'Goddess of crossroads, the moon, ghosts and magic — torch-bearing guide between worlds, invoked above all others in the Greek magical papyri.',
    relationships: [], texts: ['orphic-hymns', 'greek-magical-papyri'], links: { theoi: `${T}/Khthonios/Hekate.html`, wikipedia: `${W}/Hecate` },
  },
  {
    id: 'helios', name: 'Helios', tradition: 'greek', type: 'god',
    epithets: ['the Sun', 'the All-Seeing'],
    desc: 'The Titan-god who drives the sun-chariot across the sky and sees all — frequently invoked in ritual magic.',
    relationships: [], texts: ['greek-magical-papyri'], links: { theoi: `${T}/Titan/Helios.html`, wikipedia: `${W}/Helios` },
  },
  {
    id: 'prometheus', name: 'Prometheus', tradition: 'greek', type: 'god',
    epithets: ['the Forethinker', 'the Fire-Bringer'],
    desc: 'The Titan who stole fire for humanity and was chained to a rock for it — culture-bringer and rebel against Zeus.',
    relationships: [{ rel: 'enemy', to: 'zeus' }],
    texts: ['theogony', 'works-and-days'], links: { theoi: `${T}/Titan/TitanPrometheus.html`, wikipedia: `${W}/Prometheus` },
  },
  {
    id: 'circe', name: 'Circe', tradition: 'greek', type: 'goddess',
    epithets: ['Kirke', 'the Enchantress of Aiaia'],
    desc: 'The sorceress-goddess who turns Odysseus\'s men to swine and then becomes his ally — daughter of Helios, mistress of transformation.',
    relationships: [{ rel: 'parent', to: 'helios' }],
    texts: ['odyssey'], links: { theoi: `${T}/Heroine/Kirke.html`, wikipedia: `${W}/Circe` },
  },

  // ── Roman ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'venus', name: 'Venus', tradition: 'classical', type: 'goddess',
    epithets: ['the Roman Aphrodite', 'Genetrix'],
    desc: 'Roman goddess of love and the divine mother of Aeneas — and so the ancestress of Rome itself.',
    relationships: [{ rel: 'aspect-of', to: 'aphrodite' }],
    texts: ['aeneid'], links: { wikipedia: `${W}/Venus_(mythology)` },
  },
  {
    id: 'jupiter', name: 'Jupiter', tradition: 'classical', type: 'god',
    epithets: ['Iuppiter', 'Optimus Maximus', 'the Roman Zeus'],
    desc: 'Chief god of the Roman state, lord of sky and law — who decrees the destiny of Rome in the Aeneid.',
    relationships: [{ rel: 'aspect-of', to: 'zeus' }, { rel: 'consort', to: 'juno' }],
    texts: ['aeneid'], links: { wikipedia: `${W}/Jupiter_(god)` },
  },
  {
    id: 'juno', name: 'Juno', tradition: 'classical', type: 'goddess',
    epithets: ['the Roman Hera', 'Queen of the Gods'],
    desc: 'Roman queen of the gods, whose wrath drives the storms and wars against Aeneas throughout the Aeneid.',
    relationships: [{ rel: 'consort', to: 'jupiter' }],
    texts: ['aeneid'], links: { wikipedia: `${W}/Juno_(mythology)` },
  },

  // ── Gnostic / Hermetic ──────────────────────────────────────────────────────────────────────
  {
    id: 'sophia', name: 'Sophia', tradition: 'gnostic-hermetic', type: 'concept',
    epithets: ['Wisdom', 'the Fallen Aeon'],
    desc: 'In Gnostic myth, the divine Wisdom whose fall and error produce the Demiurge and the material world — her redemption is the drama of salvation.',
    relationships: [], texts: ['nag-hammadi'], links: { wikipedia: `${W}/Sophia_(Gnosticism)` },
  },
  {
    id: 'abrasax', name: 'Abrasax', tradition: 'gnostic-hermetic', type: 'concept',
    epithets: ['Abraxas', 'the 365 Heavens'],
    desc: 'A Gnostic cosmic power whose name in Greek numerals totals 365 — invoked on countless magical gems, ruler of the heavens.',
    relationships: [], texts: ['corpus-hermeticum', 'nag-hammadi', 'greek-magical-papyri'], links: { wikipedia: `${W}/Abraxas` },
  },

  // ── Hebrew / Christian / Islamic ─────────────────────────────────────────────────────────────
  {
    id: 'yahweh', name: 'Yahweh', tradition: 'hebrew', type: 'god',
    epithets: ['YHWH', 'Elohim', 'Adonai', 'the LORD', 'I AM'],
    desc: 'The God of Israel — creator, lawgiver and covenant-keeper of the Hebrew Bible, and the one God of Judaism, Christianity and Islam.',
    relationships: [], texts: ['genesis-kjv', 'kjv-bible', 'septuagint', 'dead-sea-scrolls', 'zohar', 'sefer-yetzirah'], links: { wikipedia: `${W}/Yahweh` },
  },
  {
    id: 'adam', name: 'Adam', tradition: 'hebrew', type: 'prophet',
    epithets: ['the First Man', 'Adam Kadmon (Kabbalah)'],
    desc: 'The first human, formed from the dust of the earth in Genesis — and, in Kabbalah, the cosmic prototype Adam Kadmon.',
    relationships: [], texts: ['genesis-kjv'], links: { wikipedia: `${W}/Adam` },
  },
  {
    id: 'noah', name: 'Noah', tradition: 'hebrew', type: 'prophet',
    epithets: ['the Righteous', 'Builder of the Ark'],
    desc: 'The patriarch who, warned by God, builds the ark and survives the Flood — the Hebrew counterpart of Utnapishtim.',
    relationships: [], texts: ['genesis-kjv', 'kjv-bible'], links: { wikipedia: `${W}/Noah` },
  },
  {
    id: 'abraham', name: 'Abraham', tradition: 'hebrew', type: 'prophet',
    epithets: ['Avraham', 'Father of Many Nations', 'the Friend of God'],
    desc: 'The patriarch called by God out of Ur — father of Isaac and Ishmael, and the shared ancestor-figure of Judaism, Christianity and Islam.',
    relationships: [], texts: ['genesis-kjv', 'kjv-bible', 'quran'], links: { wikipedia: `${W}/Abraham` },
  },
  {
    id: 'moses', name: 'Moses', tradition: 'hebrew', type: 'prophet',
    epithets: ['Moshe', 'the Lawgiver', 'Kalim Allah (Islam)'],
    desc: 'The prophet who led Israel out of Egypt and received the Law at Sinai — central to all three Abrahamic scriptures.',
    relationships: [], texts: ['kjv-bible', 'septuagint', 'quran'], links: { wikipedia: `${W}/Moses` },
  },
  {
    id: 'jesus', name: 'Jesus', tradition: 'christian', type: 'prophet',
    epithets: ['Yeshua', 'Christ', 'the Logos', 'ʿĪsā (Islam)'],
    desc: 'The central figure of Christianity — teacher, crucified and (in Christian belief) risen Messiah and incarnate Word; honored in Islam as a great prophet.',
    relationships: [], texts: ['kjv-bible', 'nag-hammadi', 'quran', 'confessions-augustine'], links: { wikipedia: `${W}/Jesus` },
  },
  {
    id: 'allah', name: 'Allah', tradition: 'islamic', type: 'god',
    epithets: ['al-Raḥmān ("the Merciful")', 'the 99 Names'],
    desc: 'The one God of Islam — the same God of Abraham, Moses and Jesus, known through the ninety-nine Beautiful Names and the recitation of the Qurʾān.',
    relationships: [], texts: ['quran'], links: { wikipedia: `${W}/Allah` },
  },

  // ── Kabbalah ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'ein-sof', name: 'Ein Sof', tradition: 'kabbalah', type: 'concept',
    epithets: ['the Infinite', 'the Limitless', 'Ayin ("Nothing")'],
    desc: 'In Kabbalah, the boundless, unknowable Godhead beyond all attributes — from which the ten Sefirot emanate to make a knowable, created world.',
    relationships: [], texts: ['zohar', 'sefer-yetzirah'], links: { wikipedia: `${W}/Ein_Sof` },
  },
  {
    id: 'shekhinah', name: 'Shekhinah', tradition: 'kabbalah', type: 'concept',
    epithets: ['the Indwelling Presence', 'Malkhut', 'the Divine Feminine'],
    desc: 'The dwelling or presence of God in the world — in Kabbalah, the lowest Sefirah and the feminine aspect of the divine, in exile and longing for reunion.',
    relationships: [], texts: ['zohar'], links: { wikipedia: `${W}/Shekhinah` },
  },

  // ── Hindu ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'indra', name: 'Indra', tradition: 'hindu', type: 'god',
    epithets: ['the Thunderer', 'Slayer of Vritra', 'King of the Devas'],
    desc: 'The Vedic warrior-king of the gods, wielder of the thunderbolt who slays the drought-serpent Vritra to release the waters.',
    relationships: [],
    texts: ['rig-veda'], links: { wikipedia: `${W}/Indra` },
  },
  {
    id: 'agni', name: 'Agni', tradition: 'hindu', type: 'god',
    epithets: ['Fire', 'the Messenger', 'Mouth of the Gods'],
    desc: 'The Vedic god of fire and sacrifice — the priest of the gods who carries offerings to heaven; the most-invoked deity of the Rig Veda after Indra.',
    relationships: [], texts: ['rig-veda'], links: { wikipedia: `${W}/Agni` },
  },
  {
    id: 'soma-deva', name: 'Soma', tradition: 'hindu', type: 'god',
    epithets: ['the Sacred Draught', 'the Moon', 'Lord of Plants'],
    desc: 'Both the sacred, possibly entheogenic ritual drink of the Vedas and the god personifying it — later identified with the moon.',
    relationships: [], texts: ['rig-veda'], links: { wikipedia: `${W}/Soma_(drink)` },
  },
  {
    id: 'varuna', name: 'Varuna', tradition: 'hindu', type: 'god',
    epithets: ['Lord of Ṛta (Cosmic Order)', 'Keeper of the Waters'],
    desc: 'The Vedic god of the cosmic order (ṛta), the waters and the moral law — the all-seeing sovereign who binds the wicked.',
    relationships: [], texts: ['rig-veda', 'upanishads'], links: { wikipedia: `${W}/Varuna` },
  },
  {
    id: 'krishna', name: 'Krishna', tradition: 'hindu', type: 'god',
    epithets: ['the Dark One', 'Govinda', 'the Eighth Avatar of Vishnu'],
    desc: 'An avatar of Vishnu and the divine teacher of the Bhagavad Gita, who reveals the paths of devotion, knowledge and action to the warrior Arjuna.',
    relationships: [{ rel: 'aspect-of', to: 'vishnu' }],
    texts: ['bhagavad-gita', 'mahabharata'], links: { wikipedia: `${W}/Krishna` },
  },
  {
    id: 'vishnu', name: 'Vishnu', tradition: 'hindu', type: 'god',
    epithets: ['the Preserver', 'Narayana', 'Lord of the Ten Avatars'],
    desc: 'One of the supreme Hindu deities — the preserver of the cosmos, who descends as avatars (Rama, Krishna and others) to restore dharma.',
    relationships: [{ rel: 'child', to: 'krishna' }],
    texts: ['bhagavad-gita', 'mahabharata', 'ramayana'], links: { wikipedia: `${W}/Vishnu` },
  },
  {
    id: 'arjuna', name: 'Arjuna', tradition: 'hindu', type: 'hero',
    epithets: ['the Archer', 'Partha', 'the Third Pandava'],
    desc: 'The great warrior of the Mahabharata whose crisis of conscience on the battlefield prompts Krishna\'s teaching in the Bhagavad Gita.',
    relationships: [], texts: ['bhagavad-gita', 'mahabharata'], links: { wikipedia: `${W}/Arjuna` },
  },
  {
    id: 'hanuman', name: 'Hanuman', tradition: 'hindu', type: 'god',
    epithets: ['the Monkey-God', 'Son of the Wind', 'Devotee of Rama'],
    desc: 'The mighty monkey-god of the Ramayana — embodiment of devotion, strength and service, who leaps to Lanka to find the captive Sita.',
    relationships: [], texts: ['ramayana'], links: { wikipedia: `${W}/Hanuman` },
  },

  // ── Buddhist ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'buddha', name: 'The Buddha', tradition: 'buddhist', type: 'prophet',
    epithets: ['Siddhārtha Gautama', 'Shakyamuni', 'the Awakened One', 'the Tathāgata'],
    desc: 'The sage whose awakening founded Buddhism — teacher of the Four Noble Truths and the Eightfold Path to the end of suffering.',
    relationships: [], texts: ['dhammapada'], links: { wikipedia: `${W}/Gautama_Buddha` },
  },

  // ── Taoist / Chinese ─────────────────────────────────────────────────────────────────────────
  {
    id: 'laozi', name: 'Laozi', tradition: 'taoist', type: 'prophet',
    epithets: ['Lao-Tzu', 'the Old Master'],
    desc: 'The semi-legendary sage credited with the Tao Te Ching — founder-figure of Taoism, later deified.',
    relationships: [], texts: ['tao-te-ching'], links: { wikipedia: `${W}/Laozi` },
  },
  {
    id: 'tao-concept', name: 'The Tao', tradition: 'taoist', type: 'concept',
    epithets: ['the Way', 'the Nameless', 'the Mother of All Things'],
    desc: 'The ineffable Way that underlies and generates everything — the central principle of Taoism, "that which cannot be named."',
    relationships: [], texts: ['tao-te-ching', 'i-ching', 'art-of-war'], links: { wikipedia: `${W}/Tao` },
  },

  // ── Zoroastrian ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'ahura-mazda', name: 'Ahura Mazda', tradition: 'zoroastrian', type: 'god',
    epithets: ['Ohrmazd', 'the Wise Lord', 'the Creator'],
    desc: 'The supreme good God of Zoroastrianism — creator of all that is true and life-giving, in eternal struggle against Angra Mainyu.',
    relationships: [{ rel: 'enemy', to: 'angra-mainyu' }],
    texts: ['avesta'], links: { wikipedia: `${W}/Ahura_Mazda` },
  },
  {
    id: 'angra-mainyu', name: 'Angra Mainyu', tradition: 'zoroastrian', type: 'god',
    epithets: ['Ahriman', 'the Destructive Spirit', 'the Lie (Druj)'],
    desc: 'The hostile, destructive spirit of Zoroastrianism — the source of evil, death and the Lie, opposed to Ahura Mazda until the final renovation of the world.',
    relationships: [{ rel: 'enemy', to: 'ahura-mazda' }],
    texts: ['avesta'], links: { wikipedia: `${W}/Angra_Mainyu` },
  },
  {
    id: 'zarathustra', name: 'Zarathustra', tradition: 'zoroastrian', type: 'prophet',
    epithets: ['Zoroaster', 'the Prophet of the Gathas'],
    desc: 'The prophet of Zoroastrianism, whose own hymns (the Gathas) form the oldest layer of the Avesta — the first to preach a cosmic struggle of good and evil.',
    relationships: [], texts: ['avesta'], links: { wikipedia: `${W}/Zoroaster` },
  },
  {
    id: 'mithra', name: 'Mithra', tradition: 'zoroastrian', type: 'god',
    epithets: ['Mithras (Roman)', 'Lord of Covenants', 'the Sun'],
    desc: 'The Indo-Iranian god of covenant, light and oaths — worshipped from the Avesta to the Roman mystery-cult of Mithras.',
    relationships: [], texts: ['avesta'], links: { wikipedia: `${W}/Mithra` },
  },

  // ── Norse / Finnic / Mesoamerican ─────────────────────────────────────────────────────────────
  {
    id: 'odin', name: 'Odin', tradition: 'norse', type: 'god',
    epithets: ['Wodan', 'the All-Father', 'the One-Eyed', 'the Gallows-God'],
    desc: 'Chief of the Norse gods — god of war, wisdom, poetry and death, who hung on the world-tree to win the runes and gathers the slain to Valhalla.',
    relationships: [{ rel: 'child', to: 'thor' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Odin` },
  },
  {
    id: 'thor', name: 'Thor', tradition: 'norse', type: 'god',
    epithets: ['the Thunderer', 'Wielder of Mjölnir', 'Defender of Midgard'],
    desc: 'The hammer-wielding thunder-god, defender of gods and humans against the giants — the most popular deity of the Norse world.',
    relationships: [{ rel: 'parent', to: 'odin' }, { rel: 'enemy', to: 'loki' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Thor` },
  },
  {
    id: 'loki', name: 'Loki', tradition: 'norse', type: 'god',
    epithets: ['the Trickster', 'the Sly One', 'Father of Monsters'],
    desc: 'The shape-shifting trickster of Norse myth — sometimes ally, finally enemy of the gods, whose offspring and treachery bring about Ragnarök.',
    relationships: [{ rel: 'enemy', to: 'thor' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Loki` },
  },
  {
    id: 'freyja', name: 'Freyja', tradition: 'norse', type: 'goddess',
    epithets: ['Lady of the Vanir', 'Mistress of Seiðr', 'Owner of Brísingamen'],
    desc: 'Norse goddess of love, beauty, fertility, war and magic (seiðr) — who takes half the battle-slain to her hall.',
    relationships: [], texts: ['eddas'], links: { wikipedia: `${W}/Freyja` },
  },
  {
    id: 'vainamoinen', name: 'Väinämöinen', tradition: 'finnic', type: 'hero',
    epithets: ['the Eternal Sage', 'the Singer', 'the Old and Steadfast'],
    desc: 'The central hero of the Kalevala — an ancient wizard-bard whose songs shape the world, born of the primal air-maiden.',
    relationships: [], texts: ['kalevala'], links: { wikipedia: `${W}/V%C3%A4in%C3%A4m%C3%B6inen` },
  },
  {
    id: 'hero-twins', name: 'The Hero Twins (Hunahpú & Xbalanqué)', tradition: 'mesoamerican', type: 'hero',
    epithets: ['Hunahpú', 'Xbalanqué', 'the Ballplayers'],
    desc: 'The twin heroes of the Popol Vuh who descend into the underworld Xibalba, outwit its lords of death, and rise as the sun and moon.',
    relationships: [],
    texts: ['popol-vuh'], links: { wikipedia: `${W}/Maya_Hero_Twins` },
  },
  {
    id: 'gucumatz', name: 'Gucumatz', tradition: 'mesoamerican', type: 'god',
    epithets: ['Qʼuqʼumatz', 'the Feathered Serpent', 'cognate of Quetzalcoatl'],
    desc: 'The feathered-serpent creator-god of the Popol Vuh, who with Tepeu shapes the earth and attempts again and again to make humanity.',
    relationships: [], texts: ['popol-vuh'], links: { wikipedia: `${W}/Q%CA%BCuq%CA%BBumatz` },
  },

  // ── Concepts (cross-tradition) ────────────────────────────────────────────────────────────────
  {
    id: 'brahman-concept', name: 'Brahman', tradition: 'hindu', type: 'concept',
    epithets: ['the Absolute', 'the Ground of Being', 'Sat-Chit-Ananda'],
    desc: 'The ultimate, unchanging reality of Hindu philosophy — the impersonal Absolute behind all appearances, with which the Self (Atman) is one.',
    relationships: [{ rel: 'aspect-of', to: 'atman-concept' }],
    texts: ['upanishads', 'bhagavad-gita', 'ramayana'], links: { wikipedia: `${W}/Brahman` },
  },
  {
    id: 'atman-concept', name: 'Atman', tradition: 'hindu', type: 'concept',
    epithets: ['the Self', 'the Inner Witness'],
    desc: 'The innermost self or soul in Hindu thought — which the Upanishads declare to be identical with Brahman ("tat tvam asi," thou art that).',
    relationships: [{ rel: 'aspect-of', to: 'brahman-concept' }],
    texts: ['upanishads'], links: { wikipedia: `${W}/%C4%80tman_(Hinduism)` },
  },
];

const ENTITY_IDS = new Set(ENTITIES.map((e) => e.id));

// ── lookups ───────────────────────────────────────────────────────────────────────────────────
export function getEntity(id) {
  return ENTITIES.find((e) => e.id === id) || null;
}
export function entitiesByTradition(traditionId) {
  return ENTITIES.filter((e) => e.tradition === traditionId);
}
export function entitiesByType(type) {
  return ENTITIES.filter((e) => e.type === type);
}

/** Resolve an entity's relationships to {rel, entity} (skips dangling targets defensively). */
export function relationshipsOf(id) {
  const e = getEntity(id);
  if (!e || !Array.isArray(e.relationships)) return [];
  return e.relationships
    .map((r) => ({ rel: r.rel, entity: getEntity(r.to) }))
    .filter((r) => r.entity);
}

/** Entities appearing in a given text id (back-reference for text pages). */
export function entitiesInText(textId) {
  return ENTITIES.filter((e) => Array.isArray(e.texts) && e.texts.includes(textId));
}

// Registry self-check used by tests + /health: types valid, text refs resolve, relationship targets
// resolve, links https + theoi only on Greek. Returns { ok, errors[] }. Never throws. Takes the
// catalog's TEXT_IDS so a text rename can't silently orphan an entity's text list.
export function validateEntities() {
  const errors = [];
  const TYPES = new Set(ENTITY_TYPES);
  for (const e of ENTITIES) {
    if (!e.id) errors.push('entity with no id');
    if (!TYPES.has(e.type)) errors.push(`${e.id}: unknown type "${e.type}"`);
    if (!e.desc || e.desc.length < 30) errors.push(`${e.id}: missing/short desc`);
    const links = e.links || {};
    for (const [k, u] of Object.entries(links)) {
      if (!/^https:\/\//.test(u)) errors.push(`${e.id}: non-https link ${u}`);
      if (k === 'theoi' && e.tradition !== 'greek') errors.push(`${e.id}: theoi link on non-Greek entity`);
    }
    if (!links.wikipedia) errors.push(`${e.id}: missing wikipedia link`);
    for (const tid of (e.texts || [])) {
      if (!TEXT_IDS.has(tid)) errors.push(`${e.id}: text "${tid}" does not resolve`);
    }
    for (const r of (e.relationships || [])) {
      if (!ENTITY_IDS.has(r.to)) errors.push(`${e.id}: relationship target "${r.to}" does not resolve`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export { ENTITY_IDS };
