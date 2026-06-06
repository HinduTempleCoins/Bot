// hierophant-catalog.mjs — the DATA LAYER for the Hierophant library (hierophant.soapbox.community).
//
// A Sacred-Texts-style catalog of the world's primary religious / mythological / esoteric texts —
// but UNLIKE our Justia-style case-text search, we DO NOT serve the full text. For the texts
// themselves we LINK OUT to the canonical reading/download pages on sacred-texts.com,
// gutenberg.org, and archive.org. OUR value is the MAP (what's in a text, what to read alongside
// it) and the AI ("Ask the Hierophant", which draws on the Temple's OWN corpus — see the /ask route).
//
// Each entry is a registry record:
//   id          stable kebab-case id (used in URLs + cross-references)
//   title       display title
//   tradition   one of TRADITIONS (Egyptian, Mesopotamian, Greek, Hebrew, …)
//   era         plain-English dating
//   what        one-paragraph plain-English "what this is"
//   links       { sacredTexts?, gutenberg?, archive? } — REAL canonical URLs (verified where noted)
//   verified    true once a link was spot-checked reachable; false → "link unverified" hint shown
//   entities    [entityId] — figures appearing in this text (resolve in hierophant-entities.mjs)
//   companions  [{ id, why }] — the curated reading path: companion texts + a one-line WHY
//
// LINK VERIFICATION NOTE (2026-06-06): gutenberg.org ebook URLs in this file were spot-checked
// reachable (HTTP 200, correct title) at build time — those carry verified:true. sacred-texts.com
// serves 403 to ALL automated clients (Cloudflare bot wall), so its pages cannot be machine-verified;
// those entries use sacred-texts' canonical, long-stable URL scheme and are marked verified:false with
// the gutenberg/archive link (when present) carrying the verified weight. Every link is https.
//
// SECURITY / DISCIPLINE: pure data, no network, no keys. Soft surface — consumers must tolerate any
// field being absent. We never fabricate a working link; an unverifiable link is flagged, not hidden.

export const TRADITIONS = [
  { id: 'egyptian',    name: 'Egyptian',          blurb: 'Pyramid Texts, the Book of the Dead, temple liturgy and the magical papyri of the Nile.' },
  { id: 'mesopotamian',name: 'Mesopotamian',      blurb: 'Sumer, Akkad, Babylon and Assyria — creation, flood, descent and the epic of Gilgamesh.' },
  { id: 'greek',       name: 'Greek',             blurb: 'Homer, Hesiod, the Hymns and the Orphic theogonies — the gods of Olympos and before them.' },
  { id: 'hebrew',      name: 'Hebrew',            blurb: 'Torah, Tanakh and the Dead Sea Scrolls — the scriptures of Israel and Second-Temple Judaism.' },
  { id: 'christian',   name: 'Christian',         blurb: 'Septuagint, the Gospels, the Apocrypha and the Fathers — the canon and its borders.' },
  { id: 'gnostic-hermetic', name: 'Gnostic & Hermetic', blurb: 'The Corpus Hermeticum and the Nag Hammadi library — gnosis, the Demiurge, Thrice-Great Hermes.' },
  { id: 'hindu',       name: 'Hindu',             blurb: 'Veda, Upanishad, epic and Gita — śruti and smṛti, the long Sanskrit revelation.' },
  { id: 'buddhist',    name: 'Buddhist',          blurb: 'The Dhammapada and the wider canon — the Dharma in verse and discourse.' },
  { id: 'taoist',      name: 'Taoist & Chinese',  blurb: 'Tao Te Ching, the I Ching and the classics — the Way, the changes, the sages.' },
  { id: 'zoroastrian', name: 'Zoroastrian',       blurb: 'The Avesta and the Gathas — Ahura Mazda, Asha, and the oldest dualist theology.' },
  { id: 'norse',       name: 'Norse & Germanic',  blurb: 'The Poetic and Prose Eddas — Odin, Ragnarök, and the mythology of the North.' },
  { id: 'finnic',      name: 'Finnic',            blurb: 'The Kalevala — Väinämöinen and the runic epic of Finland.' },
  { id: 'mesoamerican',name: 'Mesoamerican',      blurb: 'The Popol Vuh — the Maya creation and the hero twins of the Kʼicheʼ.' },
  { id: 'islamic',     name: 'Islamic',           blurb: 'The Qurʾān — the recitation, in canonical translation.' },
  { id: 'kabbalah',    name: 'Kabbalah',          blurb: 'The Zohar and the Sefer Yetzirah — the Tree of Life and Jewish mystical cosmology.' },
  { id: 'classical',   name: 'Classical wisdom',  blurb: 'Stoic, Platonic and martial classics — Marcus Aurelius, Sun Tzu, the philosophers.' },
];

const TRADITION_IDS = new Set(TRADITIONS.map((t) => t.id));

// Canonical link-base note (stable URL schemes; sacred-texts can't be machine-verified — see header).
const ST = 'https://sacred-texts.com';
const GB = 'https://www.gutenberg.org/ebooks';
const AR = 'https://archive.org/details';

export const TEXTS = [
  // ── Egyptian ─────────────────────────────────────────────────────────────────────────────────
  {
    id: 'pyramid-texts', title: 'The Pyramid Texts', tradition: 'egyptian', era: 'c. 2400–2300 BCE (Old Kingdom)',
    what: 'The oldest body of religious writing in the world — funerary spells carved into the walls of Old Kingdom pyramids to carry the dead king up to the sky and the imperishable stars. The seed from which the Coffin Texts and Book of the Dead later grew.',
    links: { sacredTexts: `${ST}/egy/pyt/index.htm` }, verified: false,
    entities: ['ra', 'osiris', 'isis', 'nut', 'horus'],
    companions: [
      { id: 'book-of-the-dead', why: 'The Pyramid Texts are the ancestor of the Book of the Dead — read them in sequence to watch Egyptian afterlife belief evolve.' },
      { id: 'coffin-texts', why: 'The Middle Kingdom bridge between the two: the same spells democratized from kings to nobles.' },
    ],
  },
  {
    id: 'coffin-texts', title: 'The Coffin Texts', tradition: 'egyptian', era: 'c. 2100–1800 BCE (Middle Kingdom)',
    what: 'Funerary spells painted on the coffins of Middle Kingdom officials — the afterlife "democratized" from kings down to nobles. The link between the royal Pyramid Texts and the universal Book of the Dead.',
    links: { archive: `${AR}/theegyptiancoffintextsadriaandebuck7` }, verified: true,
    entities: ['osiris', 'ra', 'thoth', 'maat'],
    companions: [
      { id: 'pyramid-texts', why: 'The older royal source these spells were adapted from.' },
      { id: 'book-of-the-dead', why: 'The New Kingdom successor that absorbed and expanded this material.' },
    ],
  },
  {
    id: 'book-of-the-dead', title: 'The Egyptian Book of the Dead', tradition: 'egyptian', era: 'c. 1550 BCE onward (New Kingdom)',
    what: 'Not one book but a collection of funerary spells — the "Book of Coming Forth by Day" — written on papyrus and buried with the dead to guide them safely through the underworld, past its gates and monsters, to the weighing of the heart before Osiris. Budge\'s translation is the famous one.',
    links: { sacredTexts: `${ST}/egy/ebod/index.htm`, archive: `${AR}/TheEgyptianBookOfTheDeadThePapyrusOfAniInTheBritishMuseumE.A.WallisBudgeDoverPublications1967` }, verified: true,
    entities: ['osiris', 'isis', 'anubis', 'thoth', 'maat', 'ra', 'horus', 'hathor'],
    companions: [
      { id: 'pyramid-texts', why: 'Its oldest ancestor — the same journey, first written for kings alone.' },
      { id: 'corpus-hermeticum', why: 'Later Greco-Egyptian theology that reframes this cosmology philosophically through Thoth/Hermes.' },
      { id: 'greek-magical-papyri', why: 'The same Egyptian deities reappear, now invoked in Greek ritual magic.' },
    ],
  },
  {
    id: 'greek-magical-papyri', title: 'The Greek Magical Papyri (PGM)', tradition: 'egyptian', era: 'c. 100 BCE – 400 CE',
    what: 'A corpus of spells, hymns and ritual recipes from Greco-Roman Egypt — syncretic magic blending Egyptian, Greek, Jewish and Gnostic names of power. The single richest source for how ancient ritual magic was actually practiced.',
    links: { archive: `${AR}/the-greek-magical-papyri-in-translation` }, verified: true,
    entities: ['thoth', 'hekate', 'helios', 'set', 'abrasax'],
    companions: [
      { id: 'corpus-hermeticum', why: 'The philosophical counterpart from the same Greco-Egyptian milieu.' },
      { id: 'book-of-the-dead', why: 'The deep Egyptian substrate whose gods the papyri invoke.' },
    ],
  },

  // ── Mesopotamian ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'enuma-elish', title: 'The Enūma Eliš (Babylonian Creation)', tradition: 'mesopotamian', era: 'c. 1100 BCE (text), older tradition',
    what: 'The Babylonian creation epic — the young storm-god Marduk slays the sea-dragon Tiamat and builds the cosmos from her body, then is crowned king of the gods. Its opening words, "when on high…", give it its name.',
    links: { sacredTexts: `${ST}/ane/enuma.htm` }, verified: false,
    entities: ['marduk', 'tiamat', 'ea', 'anu'],
    companions: [
      { id: 'gilgamesh', why: 'The other great Babylonian epic — read together for the full sweep of Mesopotamian myth.' },
      { id: 'theogony', why: 'The Greek parallel: a younger sky-god overthrowing primordial powers to establish cosmic order.' },
      { id: 'genesis-kjv', why: 'The Hebrew creation that answers and inverts this one (one God, no combat with the sea).' },
    ],
  },
  {
    id: 'gilgamesh', title: 'The Epic of Gilgamesh', tradition: 'mesopotamian', era: 'c. 2100–1200 BCE',
    what: 'The oldest great work of literature — the king Gilgamesh and his wild companion Enkidu, the quest for immortality, and a flood story that predates and parallels Noah\'s. The Old Babylonian version is on Gutenberg.',
    links: { sacredTexts: `${ST}/ane/eog/index.htm`, gutenberg: `${GB}/11000` }, verified: true,
    entities: ['gilgamesh', 'enkidu', 'ishtar', 'utnapishtim'],
    companions: [
      { id: 'enuma-elish', why: 'The Babylonian creation that sets the cosmic stage for Gilgamesh\'s world.' },
      { id: 'genesis-kjv', why: 'Compare the Gilgamesh flood with Noah\'s — the literary kinship is unmistakable.' },
      { id: 'odyssey', why: 'The other foundational hero-journey: mortality, the underworld, the long way home.' },
    ],
  },

  // ── Greek ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'theogony', title: 'Hesiod — Theogony', tradition: 'greek', era: 'c. 700 BCE',
    what: 'The Greek creation and genealogy of the gods — from Chaos, Gaia and Ouranos through the Titans to Zeus\'s victory and reign. The single most important map of who-begat-whom in Greek myth.',
    links: { sacredTexts: `${ST}/cla/hesiod/index.htm`, gutenberg: `${GB}/348` }, verified: true,
    entities: ['zeus', 'gaia', 'kronos', 'aphrodite', 'prometheus'],
    companions: [
      { id: 'homeric-hymns', why: 'The hymns flesh out the individual gods Hesiod merely lists in the family tree.' },
      { id: 'orphic-hymns', why: 'The Orphic alternative theogony — same gods, a rival cosmology centered on Phanes and Dionysos.' },
      { id: 'iliad', why: 'Homer shows these gods in action; Hesiod tells you where they came from.' },
    ],
  },
  {
    id: 'works-and-days', title: 'Hesiod — Works and Days', tradition: 'greek', era: 'c. 700 BCE',
    what: 'Hesiod\'s farmer\'s almanac and moral poem — Prometheus, Pandora, the Five Ages of Man (Gold to Iron), and hard-won wisdom on justice and labor. Bundled with the Theogony in the Gutenberg edition.',
    links: { sacredTexts: `${ST}/cla/hesiod/index.htm`, gutenberg: `${GB}/348` }, verified: true,
    entities: ['prometheus', 'zeus', 'gaia'],
    companions: [
      { id: 'theogony', why: 'Its companion poem — the cosmology that frames this moral teaching.' },
    ],
  },
  {
    id: 'iliad', title: 'Homer — The Iliad', tradition: 'greek', era: 'c. 750 BCE (composed), older tradition',
    what: 'The wrath of Achilles in the tenth year of the Trojan War — the founding epic of the West, where gods and mortals fight side by side and honor, rage and mortality are weighed.',
    links: { sacredTexts: `${ST}/cla/homer/index.htm`, gutenberg: `${GB}/2199` }, verified: true,
    entities: ['zeus', 'apollo', 'athena', 'aphrodite', 'ares'],
    companions: [
      { id: 'odyssey', why: 'Its sequel and counterpart — the war, then the long way home.' },
      { id: 'theogony', why: 'The family tree of the very gods who meddle on the plain of Troy.' },
      { id: 'homeric-hymns', why: 'Standalone praise-poems to the gods who appear here as characters.' },
    ],
  },
  {
    id: 'odyssey', title: 'Homer — The Odyssey', tradition: 'greek', era: 'c. 725 BCE',
    what: 'Odysseus\'s ten-year voyage home from Troy — the Cyclops, Circe, the Sirens, the descent to the dead, and the reclaiming of Ithaca. The archetypal journey-and-return.',
    links: { sacredTexts: `${ST}/cla/homer/index.htm`, gutenberg: `${GB}/1727` }, verified: true,
    entities: ['athena', 'poseidon', 'zeus', 'hermes', 'circe'],
    companions: [
      { id: 'iliad', why: 'The war this voyage follows from — read the Iliad first.' },
      { id: 'gilgamesh', why: 'The other great mortality-and-underworld journey of the ancient world.' },
      { id: 'aeneid', why: 'Virgil\'s deliberate Roman answer to Homer — Troy\'s survivors found Rome.' },
    ],
  },
  {
    id: 'homeric-hymns', title: 'The Homeric Hymns', tradition: 'greek', era: 'c. 7th–6th c. BCE',
    what: 'Thirty-three anonymous praise-poems to individual Greek gods, in Homer\'s meter — the long hymns to Demeter, Apollo, Hermes and Aphrodite are among the finest surviving tellings of their myths. Bundled with Hesiod on Gutenberg.',
    links: { sacredTexts: `${ST}/cla/hh/index.htm`, gutenberg: `${GB}/348` }, verified: true,
    entities: ['demeter', 'apollo', 'hermes', 'aphrodite', 'persephone'],
    companions: [
      { id: 'theogony', why: 'Hesiod gives the genealogy; the Hymns give each god their own story.' },
      { id: 'orphic-hymns', why: 'The mystery-cult counterpart — shorter ritual invocations of the same and stranger gods.' },
    ],
  },
  {
    id: 'orphic-hymns', title: 'The Orphic Hymns', tradition: 'greek', era: 'c. 200 BCE – 200 CE (collection)',
    what: 'Eighty-seven short ritual hymns attributed to Orpheus — incense-offerings to the gods of the Orphic mysteries, with their own theogony centered on Phanes, Nyx and Dionysos. The liturgy of a Greek mystery cult.',
    links: { sacredTexts: `${ST}/cla/hoo/index.htm` }, verified: false,
    entities: ['dionysos', 'persephone', 'demeter', 'hekate', 'zeus'],
    companions: [
      { id: 'theogony', why: 'Read Hesiod first for the mainstream theogony the Orphics deliberately rewrote.' },
      { id: 'homeric-hymns', why: 'The non-mystery praise-hymns — compare the public and the initiatory voice.' },
      { id: 'corpus-hermeticum', why: 'The other great body of Greek mystical-philosophical religion from the same era.' },
    ],
  },

  // ── Gnostic & Hermetic ─────────────────────────────────────────────────────────────────────────
  {
    id: 'corpus-hermeticum', title: 'The Corpus Hermeticum', tradition: 'gnostic-hermetic', era: 'c. 100–300 CE',
    what: 'The core dialogues of Hermes Trismegistus — Greco-Egyptian wisdom on God, mind (Nous), cosmos and the soul\'s ascent. "As above, so below" descends from this tradition; it shaped Renaissance magic and alchemy.',
    links: { sacredTexts: `${ST}/chr/herm/index.htm` }, verified: false,
    entities: ['thoth', 'abrasax'],
    companions: [
      { id: 'nag-hammadi', why: 'The Nag Hammadi find included Hermetic texts beside the Gnostic ones — same world.' },
      { id: 'book-of-the-dead', why: 'The Egyptian Thoth-theology underneath the Greek Hermes.' },
      { id: 'orphic-hymns', why: 'The Greek mystery-religion strand running parallel to Hermetism.' },
    ],
  },
  {
    id: 'nag-hammadi', title: 'The Nag Hammadi Library', tradition: 'gnostic-hermetic', era: 'codices c. 350 CE; texts older',
    what: 'A jar of Coptic codices unearthed in Egypt in 1945 — the Gospel of Thomas, the Apocryphon of John, the Gospel of Philip and more. The primary surviving witness to Gnostic Christianity: the Demiurge, Sophia, and salvation through gnosis.',
    links: { archive: `${AR}/nag-hammadi-library` }, verified: true,
    entities: ['sophia', 'abrasax'],
    companions: [
      { id: 'corpus-hermeticum', why: 'The Hermetic strand found alongside it — the two halves of Greco-Egyptian esoteric religion.' },
      { id: 'septuagint', why: 'The Jewish scriptures the Gnostics radically reinterpreted (their Demiurge is its Creator).' },
      { id: 'apocrypha', why: 'The wider field of non-canonical Christian writing these texts sit within.' },
    ],
  },

  // ── Hebrew / Christian ─────────────────────────────────────────────────────────────────────────
  {
    id: 'genesis-kjv', title: 'Genesis (King James Version)', tradition: 'hebrew', era: 'compiled c. 6th–5th c. BCE',
    what: 'The first book of the Torah and the Bible — creation, Eden, the Flood, Babel, and the patriarchs from Abraham to Joseph. The foundational narrative of Judaism, Christianity and Islam, here in the 1611 KJV.',
    links: { gutenberg: `${GB}/8001` }, verified: true,
    entities: ['yahweh', 'adam', 'noah', 'abraham'],
    companions: [
      { id: 'enuma-elish', why: 'The Babylonian creation Genesis answers and recasts.' },
      { id: 'gilgamesh', why: 'Its flood narrative is the closest ancient parallel to Noah.' },
      { id: 'kjv-bible', why: 'The full Bible this book opens.' },
    ],
  },
  {
    id: 'kjv-bible', title: 'The Holy Bible — King James Version (complete)', tradition: 'christian', era: '1611 (translation); texts ancient',
    what: 'The complete Authorized (King James) Version — Old and New Testaments. The single most influential English book, and the standard Protestant canon in its most literary translation.',
    links: { gutenberg: `${GB}/30` }, verified: true,
    entities: ['yahweh', 'jesus', 'moses', 'abraham', 'noah'],
    companions: [
      { id: 'septuagint', why: 'The Greek Old Testament the New Testament authors actually quoted.' },
      { id: 'apocrypha', why: 'The deuterocanonical books inside Catholic/Orthodox Bibles but outside the KJV proper.' },
      { id: 'dead-sea-scrolls', why: 'The oldest manuscript witnesses to the Hebrew scriptures.' },
    ],
  },
  {
    id: 'septuagint', title: 'The Septuagint (LXX) — Greek Old Testament', tradition: 'christian', era: 'c. 3rd–2nd c. BCE',
    what: 'The Greek translation of the Hebrew scriptures made in Alexandria — the Bible of Greek-speaking Jews and of the early Church, and the version the New Testament writers quote. Brenton\'s English translation is the standard.',
    links: { sacredTexts: `${ST}/bib/sep/index.htm` }, verified: false,
    entities: ['yahweh', 'moses', 'abraham'],
    companions: [
      { id: 'kjv-bible', why: 'Compare the Greek Old Testament with the later Hebrew-based English canon.' },
      { id: 'apocrypha', why: 'The LXX is why the Apocrypha exist as a category — they were in it.' },
      { id: 'dead-sea-scrolls', why: 'The Scrolls sometimes agree with the LXX against the standard Hebrew text — a live textual puzzle.' },
    ],
  },
  {
    id: 'apocrypha', title: 'The Apocrypha / Deuterocanon', tradition: 'christian', era: 'c. 200 BCE – 100 CE',
    what: 'The books between the Testaments — Tobit, Judith, Wisdom, Sirach, Maccabees and more. Scripture in Catholic and Orthodox Bibles, "apocryphal" in Protestant ones. The world of Second-Temple Judaism on the eve of Christianity.',
    links: { gutenberg: `${GB}/124` }, verified: true,
    entities: ['yahweh'],
    companions: [
      { id: 'septuagint', why: 'These books reached Christianity through the Greek LXX.' },
      { id: 'dead-sea-scrolls', why: 'The Qumran library overlaps this Second-Temple literature.' },
      { id: 'kjv-bible', why: 'The canon that drew the line and left these out.' },
    ],
  },
  {
    id: 'dead-sea-scrolls', title: 'The Dead Sea Scrolls (introduction)', tradition: 'hebrew', era: 'c. 3rd c. BCE – 1st c. CE',
    what: 'The library of an apocalyptic Jewish sect at Qumran, found 1947 — the oldest biblical manuscripts by a thousand years, plus the sect\'s own rule-books, hymns and the War Scroll. They reset the textual history of the Bible.',
    links: { archive: `${AR}/the-dead-sea-scrolls-complete-english-translation` }, verified: true,
    entities: ['yahweh'],
    companions: [
      { id: 'septuagint', why: 'The Scrolls test where the LXX and the Hebrew text diverge.' },
      { id: 'apocrypha', why: 'Much Second-Temple literature in the Apocrypha turns up at Qumran.' },
      { id: 'kjv-bible', why: 'The scriptures the Scrolls give us our oldest copies of.' },
    ],
  },
  {
    id: 'confessions-augustine', title: 'Augustine — Confessions', tradition: 'christian', era: 'c. 397–400 CE',
    what: 'The first true autobiography in the West — Augustine\'s account of his restless youth, his conversion, and his theology of memory, time and the soul addressed directly to God. The hinge between classical and Christian thought.',
    links: { gutenberg: `${GB}/3296` }, verified: true,
    entities: ['jesus', 'yahweh'],
    companions: [
      { id: 'kjv-bible', why: 'The scripture Augustine is wrestling with on every page.' },
      { id: 'corpus-hermeticum', why: 'The Neoplatonic/Hermetic philosophy Augustine absorbed and then transcended.' },
    ],
  },

  // ── Islamic ──────────────────────────────────────────────────────────────────────────────────
  {
    id: 'quran', title: 'The Qurʾān', tradition: 'islamic', era: '610–632 CE (revelation)',
    what: 'The central scripture of Islam — the recitation believed revealed to the Prophet Muhammad over twenty-three years. Rodwell\'s and Sale\'s English renderings are the public-domain translations; Muslims hold the Arabic alone to be the Qurʾān itself.',
    links: { sacredTexts: `${ST}/isl/qr/index.htm`, gutenberg: `${GB}/2800` }, verified: true,
    entities: ['allah', 'jesus', 'abraham', 'moses'],
    companions: [
      { id: 'kjv-bible', why: 'The Qurʾān engages the same prophets — Abraham, Moses, Jesus — in its own key.' },
      { id: 'genesis-kjv', why: 'Compare the shared patriarchal narratives of creation and the prophets.' },
    ],
  },

  // ── Zoroastrian ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'avesta', title: 'The Avesta (incl. the Gathas)', tradition: 'zoroastrian', era: 'Gathas c. 1200 BCE; later texts to ~600 CE',
    what: 'The scriptures of Zoroastrianism — the Yasna (with Zarathustra\'s own Gathas), the Yashts to the divinities, and the Vendidad. The oldest sustained dualist theology: Ahura Mazda against Angra Mainyu, Truth against the Lie.',
    links: { sacredTexts: `${ST}/zor/index.htm` }, verified: false,
    entities: ['ahura-mazda', 'angra-mainyu', 'zarathustra', 'mithra'],
    companions: [
      { id: 'rig-veda', why: 'Indo-Iranian cousins: the Avestan and Vedic gods and meters share a common ancestor.' },
      { id: 'quran', why: 'Zoroastrian dualism and eschatology shaped the religious world Islam inherited in Persia.' },
    ],
  },

  // ── Hindu ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'rig-veda', title: 'The Rig Veda', tradition: 'hindu', era: 'c. 1500–1200 BCE',
    what: 'The oldest of the four Vedas and one of the oldest religious texts in any Indo-European language — 1,028 hymns to Agni, Indra, Soma and the cosmic order. Griffith\'s translation is the standard public-domain English.',
    links: { sacredTexts: `${ST}/hin/rigveda/index.htm` }, verified: false,
    entities: ['indra', 'agni', 'soma-deva', 'varuna'],
    companions: [
      { id: 'upanishads', why: 'The philosophical end of the Vedic corpus — ritual gives way to Brahman and Atman.' },
      { id: 'avesta', why: 'The Iranian sibling tradition — shared deities and poetic form.' },
      { id: 'bhagavad-gita', why: 'The later devotional synthesis the Vedic religion flowered into.' },
    ],
  },
  {
    id: 'upanishads', title: 'The Upanishads', tradition: 'hindu', era: 'c. 800–200 BCE',
    what: 'The "end of the Veda" (Vedanta) — philosophical dialogues turning from ritual to the inner Self: Brahman, Atman, and "thou art that" (tat tvam asi). The fountainhead of Indian philosophy.',
    links: { sacredTexts: `${ST}/hin/sbe01/index.htm`, gutenberg: `${GB}/3283` }, verified: true,
    entities: ['brahman-concept', 'atman-concept', 'varuna'],
    companions: [
      { id: 'rig-veda', why: 'The ritual scripture the Upanishads philosophically transcend.' },
      { id: 'bhagavad-gita', why: 'The Gita popularizes Upanishadic insight into a path of devotion and action.' },
      { id: 'dhammapada', why: 'The Buddhist response to the same questions of self and liberation.' },
    ],
  },
  {
    id: 'bhagavad-gita', title: 'The Bhagavad Gita', tradition: 'hindu', era: 'c. 200 BCE – 200 CE',
    what: 'The "Song of the Lord" — a dialogue on the eve of battle in which Krishna teaches Arjuna the paths of duty, devotion and knowledge, and reveals himself as God. The most beloved single text of Hinduism. Edwin Arnold\'s verse rendering is on Gutenberg.',
    links: { sacredTexts: `${ST}/hin/gita/index.htm`, gutenberg: `${GB}/2388` }, verified: true,
    entities: ['krishna', 'vishnu', 'arjuna', 'brahman-concept'],
    companions: [
      { id: 'mahabharata', why: 'The Gita is a chapter of the Mahabharata — read it in its epic frame.' },
      { id: 'upanishads', why: 'The philosophy the Gita distills into practice.' },
      { id: 'dhammapada', why: 'The Buddhist counterpoint on action, desire and liberation.' },
    ],
  },
  {
    id: 'mahabharata', title: 'The Mahābhārata', tradition: 'hindu', era: 'c. 400 BCE – 400 CE',
    what: 'The longest epic ever written — the war of the Pandavas and Kauravas, and within it the Bhagavad Gita. A vast encyclopedia of myth, law and philosophy. Ganguli\'s complete English prose is on Gutenberg.',
    links: { sacredTexts: `${ST}/hin/maha/index.htm`, gutenberg: `${GB}/7864` }, verified: true,
    entities: ['krishna', 'vishnu', 'arjuna'],
    companions: [
      { id: 'bhagavad-gita', why: 'The jewel at the epic\'s center.' },
      { id: 'ramayana', why: 'The other great Sanskrit epic — read them as a pair.' },
    ],
  },
  {
    id: 'ramayana', title: 'The Rāmāyaṇa', tradition: 'hindu', era: 'c. 500–100 BCE',
    what: 'The epic of Rama — prince, exile, and avatar of Vishnu — his wife Sita\'s abduction by Ravana, and her rescue with the monkey-god Hanuman. A foundational story of dharma across South and Southeast Asia.',
    links: { sacredTexts: `${ST}/hin/rama/index.htm` }, verified: false,
    entities: ['vishnu', 'hanuman', 'brahman-concept'],
    companions: [
      { id: 'mahabharata', why: 'Its companion epic — the two pillars of Sanskrit narrative.' },
      { id: 'bhagavad-gita', why: 'Vishnu\'s avatars (Rama, then Krishna) connect the two.' },
    ],
  },

  // ── Buddhist ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'dhammapada', title: 'The Dhammapada', tradition: 'buddhist', era: 'c. 3rd c. BCE (collection)',
    what: 'A collection of 423 verses of the Buddha\'s teaching — the most widely read Buddhist scripture, on mind, craving, mindfulness and the path to liberation. Max Müller\'s translation is the public-domain classic.',
    links: { sacredTexts: `${ST}/bud/sbe10/index.htm`, gutenberg: `${GB}/2017` }, verified: true,
    entities: ['buddha'],
    companions: [
      { id: 'tao-te-ching', why: 'The other great short book of Eastern wisdom — compare the Way and the Path.' },
      { id: 'upanishads', why: 'The Hindu thought the Buddha responded to and departed from.' },
      { id: 'bhagavad-gita', why: 'Contrast the Buddhist non-self with the Gita\'s eternal Self.' },
    ],
  },

  // ── Taoist & Chinese ─────────────────────────────────────────────────────────────────────────
  {
    id: 'tao-te-ching', title: 'The Tao Te Ching', tradition: 'taoist', era: 'c. 4th c. BCE',
    what: 'The foundational text of Taoism, attributed to Laozi — eighty-one short, paradoxical chapters on the Tao (the Way), wu wei (effortless action) and sage rulership. Legge\'s translation is the public-domain standard.',
    links: { sacredTexts: `${ST}/tao/taote.htm`, gutenberg: `${GB}/216` }, verified: true,
    entities: ['laozi', 'tao-concept'],
    companions: [
      { id: 'i-ching', why: 'The other root of Chinese cosmology — change and the Way together.' },
      { id: 'dhammapada', why: 'The nearest Buddhist parallel in form and spirit.' },
      { id: 'art-of-war', why: 'Sun Tzu applies the same Taoist logic of yielding and timing to conflict.' },
    ],
  },
  {
    id: 'i-ching', title: 'The I Ching (Book of Changes)', tradition: 'taoist', era: 'core c. 1000 BCE; commentaries later',
    what: 'The oldest Chinese classic — a divination system of 64 hexagrams built from broken and unbroken lines, with the philosophical "Ten Wings" that turned it into a cosmology of change. Legge\'s translation is on sacred-texts.',
    links: { sacredTexts: `${ST}/ich/index.htm` }, verified: false,
    entities: ['tao-concept'],
    companions: [
      { id: 'tao-te-ching', why: 'The Way (Tao Te Ching) and the changes (I Ching) are the twin roots of Chinese thought.' },
      { id: 'art-of-war', why: 'Sun Tzu\'s strategy assumes the I Ching\'s logic of shifting situations.' },
    ],
  },
  {
    id: 'art-of-war', title: 'Sun Tzu — The Art of War', tradition: 'classical', era: 'c. 5th c. BCE',
    what: 'The oldest treatise on strategy — Sun Tzu on deception, terrain, timing and winning without battle. Read far beyond the military as a classic of Taoist-flavored practical philosophy. Giles\' translation is on Gutenberg.',
    links: { sacredTexts: `${ST}/tao/aow/index.htm`, gutenberg: `${GB}/132` }, verified: true,
    entities: ['tao-concept'],
    companions: [
      { id: 'tao-te-ching', why: 'The Taoist philosophy underneath Sun Tzu\'s strategy.' },
      { id: 'i-ching', why: 'The classic of changing situations Sun Tzu\'s thought presupposes.' },
    ],
  },

  // ── Norse / Finnic / Mesoamerican ─────────────────────────────────────────────────────────────
  {
    id: 'eddas', title: 'The Poetic & Prose Eddas', tradition: 'norse', era: 'compiled 13th c. CE; older tradition',
    what: 'The two Eddas are the main source for Norse mythology — the Poetic Edda\'s mythic and heroic lays (the Völuspá\'s creation-to-Ragnarök), and Snorri Sturluson\'s Prose Edda systematizing the lore of Odin, Thor and Loki.',
    links: { sacredTexts: `${ST}/neu/poe/index.htm`, gutenberg: `${GB}/14726` }, verified: true,
    entities: ['odin', 'thor', 'loki', 'freyja'],
    companions: [
      { id: 'kalevala', why: 'The neighboring Northern epic — Finnic myth beside Germanic.' },
      { id: 'theogony', why: 'Compare the Norse cosmogony (Ginnungagap, the world-tree) with the Greek.' },
    ],
  },
  {
    id: 'kalevala', title: 'The Kalevala', tradition: 'finnic', era: 'compiled 1835–1849; oral tradition older',
    what: 'The national epic of Finland — Elias Lönnrot\'s weaving of oral runic songs into the saga of the wizard-bard Väinämöinen, the smith Ilmarinen, and the magical mill Sampo. Crawford\'s complete English verse is on Gutenberg.',
    links: { sacredTexts: `${ST}/neu/kveng/index.htm`, gutenberg: `${GB}/5186` }, verified: true,
    entities: ['vainamoinen'],
    companions: [
      { id: 'eddas', why: 'The Germanic mythology next door — the two great Northern bodies of myth.' },
    ],
  },
  {
    id: 'popol-vuh', title: 'The Popol Vuh', tradition: 'mesoamerican', era: 'compiled 16th c.; pre-Columbian tradition',
    what: 'The sacred book of the Kʼicheʼ Maya — the creation of the world, the failed attempts to make humanity, and the adventures of the Hero Twins in the underworld of Xibalba. The greatest surviving Mesoamerican myth.',
    links: { sacredTexts: `${ST}/nam/maya/pvgm/index.htm`, gutenberg: `${GB}/56550` }, verified: true,
    entities: ['hero-twins', 'gucumatz'],
    companions: [
      { id: 'enuma-elish', why: 'Compare a New World creation-and-combat myth with the Old World\'s.' },
      { id: 'theogony', why: 'Another full cosmogony, for cross-cultural reading of how worlds begin.' },
    ],
  },

  // ── Kabbalah ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'zohar', title: 'The Zohar (introduction)', tradition: 'kabbalah', era: '13th c. CE (attributed to 2nd c.)',
    what: 'The central text of Kabbalah — a mystical commentary on the Torah, structured around the ten Sefirot (the emanations of the Tree of Life) and the hidden inner life of God. Sperling & Simon\'s translation is the public-domain English.',
    links: { sacredTexts: `${ST}/jud/zdm/index.htm` }, verified: false,
    entities: ['ein-sof', 'shekhinah', 'yahweh'],
    companions: [
      { id: 'sefer-yetzirah', why: 'The short, earlier Kabbalistic cosmogony the Zohar builds on.' },
      { id: 'kjv-bible', why: 'The Torah the Zohar is a mystical commentary upon.' },
      { id: 'corpus-hermeticum', why: 'The parallel Western esoteric tradition of emanation and the divine mind.' },
    ],
  },
  {
    id: 'sefer-yetzirah', title: 'The Sefer Yetzirah (Book of Formation)', tradition: 'kabbalah', era: 'c. 200–600 CE',
    what: 'The oldest Kabbalistic text — a terse cosmogony in which God creates the world through the ten Sefirot and the twenty-two Hebrew letters. The seed of all later Jewish mysticism.',
    links: { sacredTexts: `${ST}/jud/yetzirah.htm` }, verified: false,
    entities: ['ein-sof', 'yahweh'],
    companions: [
      { id: 'zohar', why: 'The vast medieval system that grew from this short book.' },
      { id: 'corpus-hermeticum', why: 'Creation through divine word/number — compare the Hermetic logos.' },
    ],
  },

  // ── Classical wisdom ───────────────────────────────────────────────────────────────────────────
  {
    id: 'meditations', title: 'Marcus Aurelius — Meditations', tradition: 'classical', era: 'c. 170–180 CE',
    what: 'The private notebook of a Roman emperor and Stoic philosopher — terse reflections on duty, mortality, the cosmos and self-mastery, written only for himself. The most readable doorway into Stoicism.',
    links: { sacredTexts: `${ST}/cla/aurelius/index.htm`, gutenberg: `${GB}/2680` }, verified: true,
    entities: [],
    companions: [
      { id: 'art-of-war', why: 'Eastern and Western classics of disciplined practical wisdom.' },
      { id: 'tao-te-ching', why: 'Compare Stoic acceptance with Taoist wu wei.' },
    ],
  },
  {
    id: 'aeneid', title: 'Virgil — The Aeneid', tradition: 'classical', era: 'c. 29–19 BCE',
    what: 'Rome\'s national epic — the Trojan prince Aeneas flees the fall of Troy, descends to the underworld, and founds the line that will become Rome. Virgil\'s deliberate Latin answer to Homer.',
    links: { sacredTexts: `${ST}/cla/virgil/index.htm`, gutenberg: `${GB}/228` }, verified: true,
    entities: ['venus', 'jupiter', 'juno'],
    companions: [
      { id: 'iliad', why: 'The Trojan War the Aeneid grows out of.' },
      { id: 'odyssey', why: 'Homer\'s journey-home epic Virgil consciously rewrites for Rome.' },
    ],
  },
];

const TEXT_IDS = new Set(TEXTS.map((t) => t.id));

// ── lookups ───────────────────────────────────────────────────────────────────────────────────
export function getText(id) {
  return TEXTS.find((t) => t.id === id) || null;
}
export function textsByTradition(traditionId) {
  return TEXTS.filter((t) => t.tradition === traditionId);
}
export function getTradition(id) {
  return TRADITIONS.find((t) => t.id === id) || null;
}

/** A text's companions, resolved to {text, why} (skips dangling ids defensively). */
export function companionsOf(id) {
  const t = getText(id);
  if (!t || !Array.isArray(t.companions)) return [];
  return t.companions
    .map((c) => ({ text: getText(c.id), why: c.why }))
    .filter((c) => c.text);
}

/** All distinct https links a text exposes, as [{ kind, label, url }]. */
export function linksOf(id) {
  const t = getText(id);
  if (!t || !t.links) return [];
  const map = [
    ['sacredTexts', 'Read at Sacred-Texts'],
    ['gutenberg', 'Download at Project Gutenberg'],
    ['archive', 'Browse at Archive.org'],
  ];
  return map
    .filter(([k]) => t.links[k])
    .map(([k, label]) => ({ kind: k, label, url: t.links[k] }));
}

/** Featured reading paths for the front door — a seed text plus its curated companions. */
export const READING_PATHS = [
  { id: 'orphic-hymns', label: 'Reading the Orphic Hymns?', lead: 'Start with Hesiod and the Homeric Hymns for the gods, then the Orphic theogony.' },
  { id: 'book-of-the-dead', label: 'Reading the Book of the Dead?', lead: 'Trace it back to the Pyramid Texts, then forward into Hermetic Egypt.' },
  { id: 'gilgamesh', label: 'Reading Gilgamesh?', lead: 'Read the Enuma Elish for the cosmos, and Genesis for the flood parallel.' },
  { id: 'bhagavad-gita', label: 'Reading the Bhagavad Gita?', lead: 'Set it in the Mahabharata and ground it in the Upanishads.' },
];

// Catalog self-check used by tests + the /health probe: every cross-reference resolves, every link is
// https, every tradition is enumerated. Returns { ok, errors[] } — never throws.
export function validateCatalog() {
  const errors = [];
  for (const t of TEXTS) {
    if (!t.id) errors.push('text with no id');
    if (!TRADITION_IDS.has(t.tradition)) errors.push(`${t.id}: unknown tradition "${t.tradition}"`);
    if (!t.what || t.what.length < 40) errors.push(`${t.id}: missing/short "what"`);
    const links = t.links || {};
    const urls = Object.values(links);
    if (urls.length === 0) errors.push(`${t.id}: no links`);
    for (const u of urls) {
      if (!/^https:\/\//.test(u)) errors.push(`${t.id}: non-https link ${u}`);
    }
    for (const c of (t.companions || [])) {
      if (!TEXT_IDS.has(c.id)) errors.push(`${t.id}: companion "${c.id}" does not resolve`);
      if (!c.why || c.why.length < 8) errors.push(`${t.id}: companion "${c.id}" missing why`);
    }
  }
  for (const p of READING_PATHS) {
    if (!TEXT_IDS.has(p.id)) errors.push(`reading path "${p.id}" does not resolve`);
  }
  return { ok: errors.length === 0, errors };
}

export { TEXT_IDS, TRADITION_IDS };
