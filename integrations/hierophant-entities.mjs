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
// ICONOGRAPHY: Greek, Egyptian, Norse and Hindu figures also carry `look` (a concise, concrete description of
// how the figure is traditionally depicted — attributes, dress, crown, colours, mounts, arms/heads — preferring
// what ancient art/texts attest and flagging later conventions NOT to use) and `lookSources` (the pages the
// look was taken from). Used to prompt the Studio image generator; summarised in
// knowledge/history/deity-iconography.md.
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
    look: 'A man with the head of a falcon (lanner/peregrine) crowned by a sun disk encircled by a cobra (uraeus), often seated in the solar barque; in the night journey ram-headed.',
    lookSources: [`${W}/Ra`, 'https://www.worldhistory.org/Ra/'],
  },
  {
    id: 'osiris', name: 'Osiris', tradition: 'egyptian', type: 'god',
    epithets: ['Wesir', 'Lord of the Dead', 'He Who Is Permanently Benign'],
    desc: 'God of the dead, the afterlife and resurrection — murdered by his brother Set, reassembled by Isis, and enthroned as judge of souls.',
    relationships: [{ rel: 'consort', to: 'isis' }, { rel: 'child', to: 'horus' }, { rel: 'enemy', to: 'set' }],
    texts: ['book-of-the-dead', 'coffin-texts', 'pyramid-texts'], links: { wikipedia: `${W}/Osiris` },
    look: 'A mummiform king wrapped from the chest down, with green (rebirth) or black (fertile Nile soil) skin, a pharaoh\'s curled false beard, the atef crown (white crown flanked by two curling ostrich feathers), holding the crook and flail crossed on his chest.',
    lookSources: [`${W}/Osiris`],
  },
  {
    id: 'isis', name: 'Isis', tradition: 'egyptian', type: 'goddess',
    epithets: ['Aset', 'Great of Magic', 'Mother of the God'],
    desc: 'Great goddess of magic, motherhood and healing — who gathered the scattered Osiris, conceived Horus, and became the most widely worshipped deity of the ancient Mediterranean.',
    relationships: [{ rel: 'consort', to: 'osiris' }, { rel: 'child', to: 'horus' }],
    texts: ['book-of-the-dead', 'pyramid-texts'], links: { wikipedia: `${W}/Isis` },
    look: 'A woman in a close-fitting sheath dress wearing the throne hieroglyph on her head, holding a papyrus staff and an ankh; from the New Kingdom she wears Hathor\'s cow-horn-and-sun-disk headdress, a vulture crown and uraeus, and may carry a sistrum; sometimes as a woman with kite wings (with Nephthys); tyet knot as emblem.',
    lookSources: [`${W}/Isis`],
  },
  {
    id: 'horus', name: 'Horus', tradition: 'egyptian', type: 'god',
    epithets: ['Heru', 'the Falcon', 'Horus the Younger'],
    desc: 'Sky-god and divine kingship made flesh — son of Osiris and Isis, who avenges his father against Set; every living pharaoh was a Horus.',
    relationships: [{ rel: 'parent', to: 'osiris' }, { rel: 'parent', to: 'isis' }, { rel: 'enemy', to: 'set' }],
    texts: ['book-of-the-dead', 'pyramid-texts'], links: { wikipedia: `${W}/Horus` },
    look: 'A falcon, or a man with a falcon\'s head wearing the united double crown (pschent) of Upper and Lower Egypt; the Eye of Horus (wedjat) is his emblem; as the child Harpocrates, a naked boy with a sidelock, finger to his mouth, often on a lotus or on Isis\'s lap.',
    lookSources: [`${W}/Horus`],
  },
  {
    id: 'set', name: 'Set', tradition: 'egyptian', type: 'god',
    epithets: ['Seth', 'Sutekh', 'Lord of the Desert'],
    desc: 'God of storms, chaos, the desert and foreigners — slayer of Osiris and eternal rival of Horus, yet also the defender of Ra against Apophis.',
    relationships: [{ rel: 'enemy', to: 'osiris' }, { rel: 'enemy', to: 'horus' }],
    texts: ['book-of-the-dead', 'greek-magical-papyri'], links: { wikipedia: `${W}/Set_(deity)` },
    look: 'A man with the head of the "Set animal" — a composite beast with a downward-curving snout, long ears with squared-off ends, and (in full animal form) a slender canine body with a thin forked tail; carries a was-sceptre; often shown on the prow of Ra\'s barque spearing the serpent Apep. Late-period images may give him a donkey\'s head.',
    lookSources: [`${W}/Set_(deity)`],
  },
  {
    id: 'anubis', name: 'Anubis', tradition: 'egyptian', type: 'god',
    epithets: ['Anpu', 'the Jackal', 'He Who Is Upon His Mountain'],
    desc: 'Jackal-headed god of embalming and the dead, who guides souls and oversees the weighing of the heart against the feather of Maat.',
    relationships: [{ rel: 'aspect-of', to: 'osiris' }],
    texts: ['book-of-the-dead'], links: { wikipedia: `${W}/Anubis` },
    look: 'A black canine (jackal), or a man with a black jackal head; tends the mummy, guides the dead by the hand (Roman-era tombs) and oversees the weighing of the heart; mummy gauze and flail as attributes. Black = regeneration and Nile soil, not death.',
    lookSources: [`${W}/Anubis`],
  },
  {
    id: 'thoth', name: 'Thoth', tradition: 'egyptian', type: 'god',
    epithets: ['Djehuty', 'the Ibis', 'Lord of Divine Words', 'Hermes Trismegistus (Greco-Egyptian)'],
    desc: 'God of writing, magic, wisdom and the moon — scribe of the gods, recorder at the judgment, and, fused with Hermes, the patron of the entire Hermetic tradition.',
    relationships: [{ rel: 'aspect-of', to: 'thoth' }],
    texts: ['book-of-the-dead', 'coffin-texts', 'corpus-hermeticum', 'greek-magical-papyri'], links: { wikipedia: `${W}/Thoth` },
    look: 'A man with the head of an ibis (long curved beak), sometimes crowned with the lunar disk on a crescent, holding a scribe\'s palette and reed pen or an ankh; alternatively a seated baboon.',
    lookSources: [`${W}/Thoth`],
  },
  {
    id: 'maat', name: 'Maʿat', tradition: 'egyptian', type: 'goddess',
    epithets: ['Ma\'at', 'Truth', 'the Feather', 'Cosmic Order'],
    desc: 'Goddess and principle of truth, justice, balance and cosmic order — the heart of the dead is weighed against her feather. Both a person and a concept.',
    relationships: [{ rel: 'consort', to: 'thoth' }],
    texts: ['book-of-the-dead', 'coffin-texts'], links: { wikipedia: `${W}/Maat` },
    look: 'A young woman wearing a single tall ostrich feather on a headband, sometimes with outstretched wings on her arms; the feather itself stands for her on the scales of judgement.',
    lookSources: [`${W}/Maat`],
  },
  {
    id: 'nut', name: 'Nut', tradition: 'egyptian', type: 'goddess',
    epithets: ['the Sky', 'She Who Holds a Thousand Souls'],
    desc: 'The sky-goddess arched over the earth, swallowing the sun each evening and giving birth to it at dawn — mother of Osiris, Isis, Set and Nephthys.',
    relationships: [{ rel: 'child', to: 'osiris' }, { rel: 'child', to: 'isis' }, { rel: 'child', to: 'set' }],
    texts: ['pyramid-texts'], links: { wikipedia: `${W}/Nut_(goddess)` },
    look: 'A nude woman whose body is covered with stars, arched on fingertips and toes over the earth-god Geb as the vault of the sky; occasionally a celestial cow; her headdress is the water-pot hieroglyph of her name.',
    lookSources: [`${W}/Nut_(goddess)`],
  },
  {
    id: 'shu', name: 'Shu', tradition: 'egyptian', type: 'god',
    epithets: ['the Air', 'He Who Rises Up'],
    desc: 'God of air and light who separates the sky (Nut) from the earth (Geb) — first of the gods created by the self-made Atum-Ra.',
    relationships: [{ rel: 'parent', to: 'ra' }],
    texts: ['pyramid-texts'], links: { wikipedia: `${W}/Shu_(Egyptian_god)` },
    look: 'A man with a false beard and a short wig crowned by a single ostrich feather, kneeling or standing with both arms raised to hold up the sky-goddess Nut above Geb; lion-headed only as defender of the sun.',
    lookSources: [`${W}/Shu_(Egyptian_god)`],
  },
  {
    id: 'hathor', name: 'Hathor', tradition: 'egyptian', type: 'goddess',
    epithets: ['Het-Heru ("House of Horus")', 'Lady of the Sycamore', 'the Golden One', 'Mistress of Joy'],
    desc: 'Goddess of love, music, joy, motherhood and the sky — nurse of kings, lady of the dead in the West, and a face of the divine feminine. (On the MELEK chain, "Hathor" is also the name carried by the founding AI Witness — the lineage of the name, held with care.)',
    relationships: [{ rel: 'consort', to: 'horus' }, { rel: 'aspect-of', to: 'isis' }],
    texts: ['book-of-the-dead'], links: { wikipedia: `${W}/Hathor` },
    look: 'A woman wearing a headdress of cow horns cradling a sun disk (often with uraeus), holding a sistrum, a papyrus staff or (unusually for a goddess) a was-sceptre; also a frontal human face with cow ears and a curling wig; also shown fully as a cow, sometimes emerging from the western mountain or a sycamore.',
    lookSources: [`${W}/Hathor`],
  },

  {
    id: 'bastet', name: 'Bastet', tradition: 'egyptian', type: 'goddess',
    epithets: ['Bast', 'Lady of Bubastis', 'Eye of Ra'],
    desc: 'Goddess of the home, cats, fertility, childbirth and protection against disease and evil spirits — originally a fierce lioness, later the gentle cat-goddess of Bubastis.',
    relationships: [{ rel: 'parent', to: 'ra' }],
    texts: ['pyramid-texts'], links: { wikipedia: `${W}/Bastet` },
    look: 'From the Third Intermediate Period a woman with the head of a domestic cat, slender woman\'s body, holding a sistrum and a lioness-headed aegis (collar), sometimes with kittens at her feet; or simply a seated cat. Earlier (3rd millennium BCE) a lioness or lioness-headed woman.',
    lookSources: [`${W}/Bastet`],
  },
  {
    id: 'sekhmet', name: 'Sekhmet', tradition: 'egyptian', type: 'goddess',
    epithets: ['the Powerful One', 'Lady of Red Linen', 'Eye of Ra'],
    desc: 'Lion-headed goddess of war, plague and healing — the burning Eye of Ra sent to destroy rebellious humanity, pacified with red-dyed beer.',
    relationships: [{ rel: 'parent', to: 'ra' }, { rel: 'consort', to: 'ptah' }, { rel: 'aspect-of', to: 'hathor' }],
    texts: ['book-of-the-dead'], links: { wikipedia: `${W}/Sekhmet` },
    look: 'A woman with the head of a lioness (with mane), crowned with a sun disk and uraeus, in red linen ("Lady of Red Linen"). Colour red.',
    lookSources: [`${W}/Sekhmet`, 'https://www.worldhistory.org/Sekhmet/'],
  },
  {
    id: 'ptah', name: 'Ptah', tradition: 'egyptian', type: 'god',
    epithets: ['Lord of Truth', 'Creator by the Word', 'Patron of Craftsmen'],
    desc: 'Creator-god of Memphis who made the world by thought and speech, patron of craftsmen and builders, husband of Sekhmet.',
    relationships: [{ rel: 'consort', to: 'sekhmet' }],
    texts: ['book-of-the-dead'], links: { wikipedia: `${W}/Ptah` },
    look: 'A man with green skin, wrapped mummy-like in a tight shroud, wearing the straight divine beard, holding a combined sceptre of was, ankh and djed; sometimes as a naked dwarf (Late Period).',
    lookSources: [`${W}/Ptah`, 'https://www.worldhistory.org/Ptah/'],
  },
  {
    id: 'amun', name: 'Amun', tradition: 'egyptian', type: 'god',
    epithets: ['Amun-Ra', 'the Hidden One', 'King of the Gods'],
    desc: 'The hidden creator-god of Thebes who, fused with Ra as Amun-Ra, became king of the gods of the New Kingdom; later identified by the Greeks with Zeus-Ammon.',
    relationships: [{ rel: 'consort', to: 'mut' }, { rel: 'child', to: 'khonsu' }],
    texts: ['pyramid-texts'], links: { wikipedia: `${W}/Amun` },
    look: 'A bearded man in a kilt and corselet wearing a flat-topped crown surmounted by two tall vertical plumes (with a ribbon trailing behind), holding was-sceptre and ankh; skin red-brown earlier, usually blue (lapis) after the Amarna period. Alternatively ram-headed, or a ram / criosphinx.',
    lookSources: [`${W}/Amun`, 'https://www.worldhistory.org/Amun/', 'https://www.memphis.edu/hypostyle/meaning_function/amun-re.php'],
  },
  {
    id: 'khepri', name: 'Khepri', tradition: 'egyptian', type: 'god',
    epithets: ['He Who Comes Into Being', 'the Morning Sun', 'the Scarab'],
    desc: 'God of the rising sun and self-creation, imagined as a scarab beetle rolling the sun disk across the sky as a beetle rolls its ball of dung.',
    relationships: [{ rel: 'aspect-of', to: 'ra' }],
    texts: ['pyramid-texts', 'book-of-the-dead'], links: { wikipedia: `${W}/Khepri` },
    look: 'A scarab beetle pushing or holding aloft the sun disk, or a man whose head is a scarab beetle; scarab amulets often blue (faience/lapis/turquoise).',
    lookSources: [`${W}/Khepri`],
  },
  {
    id: 'sobek', name: 'Sobek', tradition: 'egyptian', type: 'god',
    epithets: ['Suchos', 'Lord of the Faiyum', 'Sobek-Ra'],
    desc: 'Crocodile god of the Nile, fertility, pharaonic power and military strength, protector against the river\'s dangers, worshipped at Crocodilopolis and Kom Ombo.',
    relationships: [{ rel: 'parent', to: 'neith' }],
    texts: ['pyramid-texts'], links: { wikipedia: `${W}/Sobek` },
    look: 'A crocodile, or a man with a crocodile head, often crowned with ram horns, a sun disk and feathered plumes (as Sobek-Ra with a sun disk and uraeus), holding was-sceptre and ankh.',
    lookSources: [`${W}/Sobek`],
  },
  {
    id: 'neith', name: 'Neith', tradition: 'egyptian', type: 'goddess',
    epithets: ['Opener of the Ways', 'Mistress of the Bow', 'Lady of Sais'],
    desc: 'Ancient goddess of Sais, of war, hunting and weaving — a creator who reweaves the world daily on her loom; called mother of Ra and of Sobek.',
    relationships: [{ rel: 'child', to: 'sobek' }, { rel: 'child', to: 'ra' }],
    texts: ['pyramid-texts'], links: { wikipedia: `${W}/Neith` },
    look: 'A woman wearing the Red Crown of Lower Egypt, holding a bow and arrows (or an ankh); her emblem of two crossed bows over a shield may appear on her head.',
    lookSources: [`${W}/Neith`],
  },
  {
    id: 'nephthys', name: 'Nephthys', tradition: 'egyptian', type: 'goddess',
    epithets: ['Nebet-Het ("Lady of the House")', 'Mistress of the Temple Enclosure'],
    desc: 'Funerary goddess, sister of Isis and consort of Set, who mourned and protected Osiris and guards the dead alongside Isis.',
    relationships: [{ rel: 'parent', to: 'nut' }, { rel: 'consort', to: 'set' }, { rel: 'child', to: 'anubis' }],
    texts: ['pyramid-texts', 'book-of-the-dead'], links: { wikipedia: `${W}/Nephthys` },
    look: 'A woman crowned with the hieroglyphs of her name — a basket (nb) on top of a house/temple-enclosure sign (ḥwt); in funerary scenes kneeling with outstretched falcon/kite wings, or as a kite, mourning at the bier of Osiris opposite Isis.',
    lookSources: [`${W}/Nephthys`],
  },
  {
    id: 'hapi', name: 'Hapi', tradition: 'egyptian', type: 'god',
    epithets: ['Hapy', 'the Inundation', 'Father of the Gods'],
    desc: 'God of the annual Nile flood, bringer of fertile silt and abundance, often shown in pairs binding together Upper and Lower Egypt.',
    relationships: [],
    texts: [], links: { wikipedia: `${W}/Hapi_(Nile_god)` },
    look: 'An androgynous figure with blue or green (water) skin, a prominent belly and pendulous breasts, wearing a loincloth/belt and false beard, crowned with papyrus (Lower Egypt) or lotus (Upper Egypt) plants, bearing offering tables of food or pouring water from a jar.',
    lookSources: [`${W}/Hapi_(Nile_god)`],
  },
  {
    id: 'bes', name: 'Bes', tradition: 'egyptian', type: 'god',
    epithets: ['Protector of Households', 'Guardian of Childbirth'],
    desc: 'Popular household protector of mothers, children and childbirth, who frightened away evil spirits with his fierce grin and dancing.',
    relationships: [],
    texts: [], links: { wikipedia: `${W}/Bes` },
    look: 'A bow-legged dwarf with feline features, large ears, long hair and beard, shown full-face (unusual in Egyptian art), wearing a tall ostrich-feather crown, sometimes a soldier\'s tunic; dancing or fierce as a warrior; often blue faience amulets. Late images give him Persian dress.',
    lookSources: [`${W}/Bes`, 'https://www.worldhistory.org/Bes/'],
  },
  {
    id: 'taweret', name: 'Taweret', tradition: 'egyptian', type: 'goddess',
    epithets: ['the Great One', 'Lady of Birth'],
    desc: 'Protective goddess of childbirth and fertility, a fearsome hippopotamus who guards mothers and infants.',
    relationships: [],
    texts: [], links: { wikipedia: `${W}/Taweret` },
    look: 'A bipedal pregnant female hippopotamus with pendulous human breasts, lion limbs and paws, and the back and tail of a Nile crocodile, commonly wearing the Hathoric horns-and-sun-disk, holding the sa (protection) sign and sometimes a small crocodile.',
    lookSources: [`${W}/Taweret`],
  },
  {
    id: 'seshat', name: 'Seshat', tradition: 'egyptian', type: 'goddess',
    epithets: ['Mistress of the House of Books', 'She Who Writes'],
    desc: 'Goddess of writing, measurement, record-keeping and architecture, who "stretches the cord" to lay out temple foundations and records the years of the king.',
    relationships: [{ rel: 'consort', to: 'thoth' }],
    texts: [], links: { wikipedia: `${W}/Seshat` },
    look: 'A woman wearing a leopard-skin over her dress, with a seven-pointed emblem above her head or rising from a headband, holding a notched palm rib (the "year" sign) and a stylus.',
    lookSources: [`${W}/Seshat`],
  },
  {
    id: 'khonsu', name: 'Khonsu', tradition: 'egyptian', type: 'god',
    epithets: ['the Traveller', 'the Moon', 'Khonsu-Neferhotep'],
    desc: 'Youthful moon-god of Thebes, son of Amun and Mut, a healer and protector who crosses the night sky.',
    relationships: [{ rel: 'parent', to: 'amun' }, { rel: 'parent', to: 'mut' }],
    texts: ['pyramid-texts'], links: { wikipedia: `${W}/Khonsu` },
    look: 'A mummiform youth with the sidelock of childhood, wearing the menat necklace and holding crook, flail and was-sceptre, crowned with the full moon disk resting in a crescent; or falcon-headed with the same lunar crown.',
    lookSources: [`${W}/Khonsu`],
  },
  {
    id: 'mut', name: 'Mut', tradition: 'egyptian', type: 'goddess',
    epithets: ['the Mother', 'Lady of Heaven', 'Mistress of All the Gods'],
    desc: 'Great mother-goddess of Thebes, consort of Amun and mother of Khonsu, embodying queenship and the protective vulture.',
    relationships: [{ rel: 'consort', to: 'amun' }, { rel: 'child', to: 'khonsu' }],
    texts: [], links: { wikipedia: `${W}/Mut` },
    look: 'A woman wearing the Double Crown of Upper and Lower Egypt, in a bright red or blue dress, holding an ankh, sometimes with vulture wings and Maat\'s feather at her feet.',
    lookSources: [`${W}/Mut`],
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
    relationships: [{ rel: 'parent', to: 'kronos' }, { rel: 'child', to: 'apollo' }, { rel: 'child', to: 'athena' }, { rel: 'consort', to: 'hera' }],
    texts: ['theogony', 'iliad', 'odyssey', 'works-and-days'], links: { theoi: `${T}/Olympios/Zeus.html`, wikipedia: `${W}/Zeus` },
    look: 'A regal, mature man with a sturdy build and dark full beard, in a long chiton and himation (sometimes nude); wields a stylised thunderbolt like a javelin and holds a royal sceptre, with an eagle beside him — often enthroned, sometimes holding a small winged Nike or wearing the aegis.',
    lookSources: [`${T}/Olympios/Zeus.html`, `${W}/Zeus`],
  },
  {
    id: 'gaia', name: 'Gaia', tradition: 'greek', type: 'goddess',
    epithets: ['Ge', 'the Earth', 'the All-Mother'],
    desc: 'The primordial Earth, born near the beginning out of Chaos — mother of the sky (Ouranos), the Titans and much of creation.',
    relationships: [{ rel: 'child', to: 'kronos' }],
    texts: ['theogony', 'works-and-days'], links: { theoi: `${T}/Protogenos/Gaia.html`, wikipedia: `${W}/Gaia` },
    look: 'A buxom, matronly woman shown rising half out of the ground (vase painting), inseparable from the earth; in cult images seated; fruit as her symbol.',
    lookSources: [`${T}/Protogenos/Gaia.html`, `${W}/Gaia`],
  },
  {
    id: 'kronos', name: 'Kronos', tradition: 'greek', type: 'god',
    epithets: ['Cronus', 'the Crooked-Counselled Titan'],
    desc: 'Leader of the Titans who castrated his father Ouranos and devoured his own children — until Zeus overthrew him, ending the Golden Age.',
    relationships: [{ rel: 'parent', to: 'gaia' }, { rel: 'child', to: 'zeus' }],
    texts: ['theogony'], links: { theoi: `${T}/Titan/TitanKronos.html`, wikipedia: `${W}/Cronus` },
    look: 'A mature, bearded Titan-king holding the harpe (curved sickle/scythe) with which he castrated Ouranos. Do NOT use the later "Father Time" hourglass-and-wings allegory.',
    lookSources: [`${T}/Titan/TitanKronos.html`, `${W}/Cronus`],
  },
  {
    id: 'apollo', name: 'Apollo', tradition: 'greek', type: 'god',
    epithets: ['Phoibos ("Bright")', 'the Far-Shooter', 'Lord of Delphi'],
    desc: 'God of prophecy, music, healing, light and archery — voice of the Delphic oracle and one of the most Greek of the gods.',
    relationships: [{ rel: 'parent', to: 'zeus' }],
    texts: ['iliad', 'homeric-hymns'], links: { theoi: `${T}/Olympios/Apollon.html`, wikipedia: `${W}/Apollo` },
    look: 'A handsome, beardless athletic youth (the kouros ideal) with long, uncut, often golden hair, wreathed in laurel; carries a lyre (kithara) or a silver/golden bow and quiver; raven, swan and laurel branch as companions.',
    lookSources: [`${T}/Olympios/Apollon.html`, `${W}/Apollo`],
  },
  {
    id: 'athena', name: 'Athena', tradition: 'greek', type: 'goddess',
    epithets: ['Pallas', 'the Grey-Eyed', 'Tritogeneia'],
    desc: 'Goddess of wisdom, strategic war and craft, born fully armed from the head of Zeus — patron of Athens and of the cunning Odysseus.',
    relationships: [{ rel: 'parent', to: 'zeus' }],
    texts: ['iliad', 'odyssey'], links: { theoi: `${T}/Olympios/Athena.html`, wikipedia: `${W}/Athena` },
    look: 'A stately armed woman in a long peplos/chiton, crested helmet (Corinthian/Attic type) pushed up on her head, the aegis — a snake-fringed goatskin cape bearing the Gorgon Medusa\'s head — over her shoulders, a spear and a large round shield; an owl, an olive tree and a serpent as companions.',
    lookSources: [`${T}/Olympios/Athena.html`, `${W}/Athena`],
  },
  {
    id: 'aphrodite', name: 'Aphrodite', tradition: 'greek', type: 'goddess',
    epithets: ['Kypris', 'the Foam-Born', 'the Golden'],
    desc: 'Goddess of love, beauty and desire, born from the sea-foam where Ouranos fell — whose gift of Helen set off the Trojan War.',
    relationships: [{ rel: 'consort', to: 'ares' }],
    texts: ['theogony', 'iliad', 'homeric-hymns'], links: { theoi: `${T}/Olympios/Aphrodite.html`, wikipedia: `${W}/Aphrodite` },
    look: 'A beautiful woman, often accompanied by the winged youth Eros; attributes a dove, apple, scallop shell and mirror; in classical sculpture and fresco usually nude or half-draped. Colours red, white and gold. Archaic Spartan/Cytherean cult images showed her armed (helmet, shield, spear).',
    lookSources: [`${T}/Olympios/Aphrodite.html`, `${W}/Aphrodite`],
  },
  {
    id: 'ares', name: 'Ares', tradition: 'greek', type: 'god',
    epithets: ['the War-God', 'the Manslayer'],
    desc: 'God of war in its raw, bloody and chaotic form — disliked even by the other Olympians, consort of Aphrodite.',
    relationships: [{ rel: 'parent', to: 'zeus' }, { rel: 'consort', to: 'aphrodite' }],
    texts: ['iliad'], links: { theoi: `${T}/Olympios/Ares.html`, wikipedia: `${W}/Ares` },
    look: 'Either a mature, bearded warrior armed for battle or a nude, beardless youth; his defining attribute is a peaked/crested warrior\'s helm (worn or held even at feasts), with shield, spear and sometimes a sheathed sword; breastplate often omitted for a simple tunic.',
    lookSources: [`${T}/Olympios/Ares.html`, `${W}/Ares`],
  },
  {
    id: 'poseidon', name: 'Poseidon', tradition: 'greek', type: 'god',
    epithets: ['the Earth-Shaker', 'Lord of the Sea'],
    desc: 'God of the sea, earthquakes and horses — brother of Zeus, and the relentless enemy who keeps Odysseus from home.',
    relationships: [{ rel: 'parent', to: 'kronos' }, { rel: 'enemy', to: 'athena' }],
    texts: ['odyssey', 'iliad'], links: { theoi: `${T}/Olympios/Poseidon.html`, wikipedia: `${W}/Poseidon` },
    look: 'A mature man with a sturdy build and dark beard holding a trident (three-pronged fishing spear), in chiton and himation or nude with a cloak loosely draped; dolphins, tuna, horses and bulls as his animals, sometimes riding a horse or a chariot of two or four horses.',
    lookSources: [`${T}/Olympios/Poseidon.html`, `${W}/Poseidon`],
  },
  {
    id: 'hermes', name: 'Hermes', tradition: 'greek', type: 'god',
    epithets: ['the Messenger', 'Argeiphontes', 'Guide of Souls'],
    desc: 'God of travelers, traders, thieves, boundaries and messages — guide of the dead, and the Greek face later fused with Egyptian Thoth as Hermes Trismegistus.',
    relationships: [{ rel: 'parent', to: 'zeus' }],
    texts: ['odyssey', 'homeric-hymns'], links: { theoi: `${T}/Olympios/Hermes.html`, wikipedia: `${W}/Hermes` },
    look: 'Either a beardless athletic youth or (archaic) an older bearded man, in a knee-length chiton and short chlamys cloak, winged boots (talaria) and a travelling hat (petasos, sometimes winged), carrying the herald\'s wand (kerykeion/caduceus); tortoise-shell lyre and rooster as companions.',
    lookSources: [`${T}/Olympios/Hermes.html`, `${W}/Hermes`],
  },
  {
    id: 'demeter', name: 'Demeter', tradition: 'greek', type: 'goddess',
    epithets: ['the Grain-Mother', 'Thesmophoros'],
    desc: 'Goddess of grain, agriculture and the harvest — whose grief for her stolen daughter Persephone gives the world its winter, and whose mysteries at Eleusis were the most sacred of Greece.',
    relationships: [{ rel: 'child', to: 'persephone' }],
    texts: ['homeric-hymns'], links: { theoi: `${T}/Olympios/Demeter.html`, wikipedia: `${W}/Demeter` },
    look: 'A mature, fully robed woman, often crowned or veiled, bearing sheaves of wheat or a cornucopia and a torch; seated, walking, or riding a chariot drawn by horses or winged serpents (dragons).',
    lookSources: [`${T}/Olympios/Demeter.html`, `${W}/Demeter`],
  },
  {
    id: 'persephone', name: 'Persephone', tradition: 'greek', type: 'goddess',
    epithets: ['Kore ("the Maiden")', 'Queen of the Underworld'],
    desc: 'Daughter of Demeter, carried off by Hades to be queen of the dead — her annual return brings spring; her descent, winter. Central to the Eleusinian and Orphic mysteries.',
    relationships: [{ rel: 'parent', to: 'demeter' }, { rel: 'consort', to: 'hades' }],
    texts: ['homeric-hymns', 'orphic-hymns'], links: { theoi: `${T}/Khthonios/Persephone.html`, wikipedia: `${W}/Persephone` },
    look: 'A young goddess, always robed, holding sheaves of grain and a flaming torch (or twin torches); as Queen of the Underworld enthroned beside Hades with a sceptre; pomegranate as her emblem.',
    lookSources: [`${T}/Khthonios/Persephone.html`, `${W}/Persephone`],
  },
  {
    id: 'dionysos', name: 'Dionysos', tradition: 'greek', type: 'god',
    epithets: ['Bacchus', 'the Twice-Born', 'the Liberator (Eleutherios)'],
    desc: 'God of wine, ecstasy, theatre and ritual madness — twice-born, dismembered and reborn in Orphic myth, and the center of its mysteries.',
    relationships: [{ rel: 'parent', to: 'zeus' }],
    texts: ['orphic-hymns'], links: { theoi: `${T}/Olympios/Dionysos.html`, wikipedia: `${W}/Dionysus` },
    look: 'Either an older, bearded god or an effeminate long-haired youth, in a long chiton and himation (or fox-fur robe), crowned with ivy; holds the thyrsos (fennel staff tipped with a pine cone) and a kantharos wine cup, with fruiting grapevines; rides or is drawn by panthers/leopards.',
    lookSources: [`${T}/Olympios/Dionysos.html`, `${W}/Dionysus`],
  },
  {
    id: 'hekate', name: 'Hekate', tradition: 'greek', type: 'goddess',
    epithets: ['Hecate', 'the Three-Formed', 'Lady of the Crossroads'],
    desc: 'Goddess of crossroads, the moon, ghosts and magic — torch-bearing guide between worlds, invoked above all others in the Greek magical papyri.',
    relationships: [], texts: ['orphic-hymns', 'greek-magical-papyri'], links: { theoi: `${T}/Khthonios/Hekate.html`, wikipedia: `${W}/Hecate` },
    look: 'A woman in a maiden\'s knee-length dress holding twin torches (vase painting); in statuary often triple-formed as goddess of the crossroads; keys, knives, serpents and dogs as attributes.',
    lookSources: [`${T}/Khthonios/Hekate.html`, `${W}/Hecate`],
  },
  {
    id: 'helios', name: 'Helios', tradition: 'greek', type: 'god',
    epithets: ['the Sun', 'the All-Seeing'],
    desc: 'The Titan-god who drives the sun-chariot across the sky and sees all — frequently invoked in ritual magic.',
    relationships: [], texts: ['greek-magical-papyri'], links: { theoi: `${T}/Titan/Helios.html`, wikipedia: `${W}/Helios` },
    look: 'A handsome, usually beardless man in purple robes, crowned with the shining aureole (rayed halo) of the sun, driving a four-horse (often winged) chariot across the sky.',
    lookSources: [`${T}/Titan/Helios.html`, `${W}/Helios`],
  },
  {
    id: 'prometheus', name: 'Prometheus', tradition: 'greek', type: 'god',
    epithets: ['the Forethinker', 'the Fire-Bringer'],
    desc: 'The Titan who stole fire for humanity and was chained to a rock for it — culture-bringer and rebel against Zeus.',
    relationships: [{ rel: 'enemy', to: 'zeus' }],
    texts: ['theogony', 'works-and-days'], links: { theoi: `${T}/Titan/TitanPrometheus.html`, wikipedia: `${W}/Prometheus` },
    look: 'A mature bearded Titan, sometimes wearing the pointed artisan\'s cap (pilos); classically shown bound to a rock or pillar while an eagle eats his liver, with Herakles shooting the eagle, or carrying fire in a hollow fennel stalk.',
    lookSources: [`${T}/Titan/TitanPrometheus.html`, `${W}/Prometheus`],
  },
  {
    id: 'circe', name: 'Circe', tradition: 'greek', type: 'goddess',
    epithets: ['Kirke', 'the Enchantress of Aiaia'],
    desc: 'The sorceress-goddess who turns Odysseus\'s men to swine and then becomes his ally — daughter of Helios, mistress of transformation.',
    relationships: [{ rel: 'parent', to: 'helios' }],
    texts: ['odyssey'], links: { theoi: `${T}/Titan/Kirke.html`, wikipedia: `${W}/Circe` },
    look: 'A lovely-haired enchantress, weaving at a great loom or offering a cup of drugged potion while holding a wand/staff, with men half-transformed into swine around her; as a child of Helios she has flashing golden eyes.',
    lookSources: [`${T}/Titan/Kirke.html`, `${W}/Circe`],
  },

  {
    id: 'hera', name: 'Hera', tradition: 'greek', type: 'goddess',
    epithets: ['Queen of the Gods', 'the Ox-Eyed', 'the White-Armed'],
    desc: 'Queen of the Olympian gods and goddess of marriage, women and the family — wife and sister of Zeus, fierce persecutor of his lovers and of Herakles.',
    relationships: [{ rel: 'parent', to: 'kronos' }, { rel: 'consort', to: 'zeus' }, { rel: 'child', to: 'ares' }, { rel: 'child', to: 'hephaestus' }],
    texts: ['iliad', 'theogony', 'homeric-hymns', 'orphic-hymns'], links: { theoi: `${T}/Olympios/Hera.html`, wikipedia: `${W}/Hera` },
    look: 'A majestic mature woman wearing a crown (polos or diadem) and often a veil hanging down the back of her head, holding a royal lotus-tipped sceptre; pomegranate as emblem; cuckoo, hawk, lion or cow beside her. The peacock is a later (Hellenistic/Roman) attribute.',
    lookSources: [`${T}/Olympios/Hera.html`, `${W}/Hera`],
  },
  {
    id: 'artemis', name: 'Artemis', tradition: 'greek', type: 'goddess',
    epithets: ['the Huntress', 'Mistress of Animals', 'Phoibe'],
    desc: 'Virgin goddess of the hunt, wild animals, the wilderness, childbirth and young girls — twin sister of Apollo and daughter of Zeus and Leto.',
    relationships: [{ rel: 'parent', to: 'zeus' }],
    texts: ['homeric-hymns', 'iliad', 'odyssey', 'orphic-hymns'], links: { theoi: `${T}/Olympios/Artemis.html`, wikipedia: `${W}/Artemis` },
    look: 'A girl or young maiden in a knee-length chiton (or full robe) with cloak, carrying a hunting bow and quiver of arrows (sometimes hunting spears or a torch), a headband or crown, often a deer-skin over her shoulders and a deer beside her or drawing her chariot. The many-breasted Ephesian cult image is a separate local type.',
    lookSources: [`${T}/Olympios/Artemis.html`, `${W}/Artemis`],
  },
  {
    id: 'hades', name: 'Hades', tradition: 'greek', type: 'god',
    epithets: ['Aidoneus', 'Plouton (the Wealth-Giver)', 'the Unseen One'],
    desc: 'King of the underworld and the dead, eldest son of Kronos, who carried off Persephone to be his queen — stern and just rather than evil.',
    relationships: [{ rel: 'parent', to: 'kronos' }, { rel: 'consort', to: 'persephone' }],
    texts: ['theogony', 'iliad', 'homeric-hymns', 'orphic-hymns'], links: { theoi: `${T}/Khthonios/Haides.html`, wikipedia: `${W}/Hades` },
    look: 'A dark-bearded, regal god enthroned in the underworld holding a bird-tipped sceptre or a key, with the three-headed dog Kerberos; as Plouton he pours wealth from a cornucopia. The bident and "helmet of invisibility" are not securely attested in ancient art — avoid them; no flaming hair (modern cartoon).',
    lookSources: [`${T}/Khthonios/Haides.html`, `${W}/Hades`],
  },
  {
    id: 'hephaestus', name: 'Hephaestus', tradition: 'greek', type: 'god',
    epithets: ['Hephaistos', 'the Smith', 'the Lame God'],
    desc: 'God of the forge, fire, metalwork and craftsmanship — the lame smith of Olympus who made the armour of Achilles and the thrones of the gods.',
    relationships: [{ rel: 'parent', to: 'hera' }, { rel: 'consort', to: 'aphrodite' }],
    texts: ['iliad', 'odyssey', 'theogony', 'homeric-hymns', 'orphic-hymns'], links: { theoi: `${T}/Olympios/Hephaistos.html`, wikipedia: `${W}/Hephaestus` },
    look: 'A vigorous bearded man in a short chiton (exomis) leaving the right shoulder and arm bare, wearing an oval craftsman\'s cap (pilos), holding a smith\'s hammer and tongs; sometimes riding a donkey (the Return of Hephaistos).',
    lookSources: [`${T}/Olympios/Hephaistos.html`, `${W}/Hephaestus`],
  },
  {
    id: 'hestia', name: 'Hestia', tradition: 'greek', type: 'goddess',
    epithets: ['Goddess of the Hearth', 'Eldest of the Olympians'],
    desc: 'Virgin goddess of the hearth, home and sacrificial flame, who receives the first and last offering at every sacrifice.',
    relationships: [{ rel: 'parent', to: 'kronos' }],
    texts: ['theogony', 'homeric-hymns', 'orphic-hymns'], links: { theoi: `${T}/Ouranios/Hestia.html`, wikipedia: `${W}/Hestia` },
    look: 'Rarely depicted: a modestly dressed woman wearing a head veil, sometimes holding a flowering branch or a staff, or beside a large hearth fire; in sculpture a veiled matron with a kettle.',
    lookSources: [`${T}/Ouranios/Hestia.html`, `${W}/Hestia`],
  },
  {
    id: 'nike', name: 'Nike', tradition: 'greek', type: 'goddess',
    epithets: ['Victory', 'Victoria (Roman)'],
    desc: 'Winged goddess of victory, companion of Zeus and Athena, who crowns victors in war and in the games.',
    relationships: [],
    texts: ['theogony', 'orphic-hymns'], links: { theoi: `${T}/Daimon/Nike.html`, wikipedia: `${W}/Nike_(mythology)` },
    look: 'A young winged woman in a flowing chiton, in flight or alighting, holding a victor\'s wreath or sash, a libation jug and bowl, or (in coins and mosaics) a palm branch; often a small figure standing in the hand of Zeus or Athena. The Athenian cult image of Athena Nike was wingless, holding a pomegranate and helmet.',
    lookSources: [`${T}/Daimon/Nike.html`, `${W}/Nike_(mythology)`],
  },
  {
    id: 'eros', name: 'Eros', tradition: 'greek', type: 'god',
    epithets: ['Love', 'Amor/Cupid (Roman)'],
    desc: 'God of love and desire — in Hesiod a primordial power born at the dawn of creation, later the son and companion of Aphrodite.',
    relationships: [{ rel: 'parent', to: 'aphrodite' }],
    texts: ['theogony', 'orphic-hymns'], links: { theoi: `${T}/Ouranios/Eros.html`, wikipedia: `${W}/Eros` },
    look: 'In archaic and classical art a handsome winged youth (golden wings), with bow and arrows or lover\'s gifts (hare, sash, flower). The chubby infant "Cupid" is a Hellenistic-and-later convention; the Renaissance putto is NOT the classical form.',
    lookSources: [`${T}/Ouranios/Eros.html`, `${W}/Eros`],
  },
  {
    id: 'pan', name: 'Pan', tradition: 'greek', type: 'god',
    epithets: ['Goat-Foot', 'Lord of the Wild', 'Aigipan'],
    desc: 'Rustic god of shepherds, flocks, wild mountains and panic, player of the syrinx, worshipped in the caves of Arcadia.',
    relationships: [{ rel: 'parent', to: 'hermes' }],
    texts: ['homeric-hymns', 'orphic-hymns'], links: { theoi: `${T}/Georgikos/Pan.html`, wikipedia: `${W}/Pan_(god)` },
    look: 'A man with the horns, legs and tail of a goat, a thick beard, snub nose and pointed ears, playing the syrinx (pan-pipes) or dancing; sometimes holding a wine jug (mosaics).',
    lookSources: [`${T}/Georgikos/Pan.html`, `${W}/Pan_(god)`],
  },
  {
    id: 'selene', name: 'Selene', tradition: 'greek', type: 'goddess',
    epithets: ['the Moon', 'Mene'],
    desc: 'Titan goddess of the moon, sister of Helios and Eos, who drives her chariot across the night sky and loved the sleeping shepherd Endymion.',
    relationships: [],
    texts: ['homeric-hymns', 'theogony', 'orphic-hymns'], links: { theoi: `${T}/Titan/Selene.html`, wikipedia: `${W}/Selene` },
    look: 'A woman riding sidesaddle on a horse (or mule/bull) or driving a chariot drawn by a pair of winged steeds, with a lunar crescent set on her head like a crown or formed by a raised, billowing shining cloak; sometimes carries a torch.',
    lookSources: [`${T}/Titan/Selene.html`, `${W}/Selene`],
  },
  {
    id: 'eos', name: 'Eos', tradition: 'greek', type: 'goddess',
    epithets: ['the Dawn', 'Rosy-Fingered', 'Saffron-Robed'],
    desc: 'Titan goddess of the dawn who opens the gates of heaven for the Sun each morning; lover of mortal youths such as Tithonus and Kephalos.',
    relationships: [],
    texts: ['iliad', 'odyssey', 'theogony', 'homeric-hymns', 'orphic-hymns'], links: { theoi: `${T}/Titan/Eos.html`, wikipedia: `${W}/Eos` },
    look: 'A beautiful woman with large white-feathered bird wings, crowned with a tiara or diadem, in a saffron robe woven with flowers, rosy-fingered and golden-armed; flies on her own wings or drives a chariot of winged horses. Colours saffron, rose, gold, white.',
    lookSources: [`${T}/Titan/Eos.html`, `${W}/Eos`],
  },
  {
    id: 'heracles', name: 'Heracles', tradition: 'greek', type: 'hero',
    epithets: ['Herakles', 'Hercules (Roman)', 'Alcides'],
    desc: 'The greatest of Greek heroes, son of Zeus and Alcmene, who performed the Twelve Labours under Hera\'s persecution and was deified on Olympus.',
    relationships: [{ rel: 'parent', to: 'zeus' }, { rel: 'enemy', to: 'hera' }],
    texts: ['theogony', 'iliad', 'odyssey', 'orphic-hymns'], links: { wikipedia: `${W}/Heracles` },
    look: 'A powerfully muscled man with short curly hair, thick neck and broad shoulders (Farnese type), wearing the skin of the Nemean lion as a cloak and carrying a wooden club; sometimes with a bow (shooting Prometheus\'s eagle).',
    lookSources: [`${W}/Heracles`],
  },
  {
    id: 'perseus', name: 'Perseus', tradition: 'greek', type: 'hero',
    epithets: ['Slayer of Medusa', 'Founder of Mycenae'],
    desc: 'Hero son of Zeus and Danaë who beheaded the Gorgon Medusa with gifts from the gods and rescued Andromeda from the sea-monster.',
    relationships: [{ rel: 'parent', to: 'zeus' }],
    texts: ['theogony', 'iliad'], links: { theoi: `${T}/Heros/Perseus.html`, wikipedia: `${W}/Perseus` },
    look: 'A youth with winged boots and a cap, armed with a sickle-shaped sword (harpe), holding the severed head of the Gorgon Medusa.',
    lookSources: [`${T}/Heros/Perseus.html`, `${W}/Perseus`],
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
    look: 'King of the devas holding the vajra (thunderbolt) and often a bow, riding the white four-tusked elephant Airavata (post-Vedic) or a chariot drawn by two bay horses (Rigveda). The Rigveda calls him golden-haired, unlike later dark-haired temple images.',
    lookSources: [`${W}/Indra`],
  },
  {
    id: 'agni', name: 'Agni', tradition: 'hindu', type: 'god',
    epithets: ['Fire', 'the Messenger', 'Mouth of the Gods'],
    desc: 'The Vedic god of fire and sacrifice — the priest of the gods who carries offerings to heaven; the most-invoked deity of the Rig Veda after Indra.',
    relationships: [], texts: ['rig-veda'], links: { wikipedia: `${W}/Agni` },
    look: 'A red- or smoky-grey-complexioned, sometimes bearded man with one to three heads and two to four arms, a halo of flames rising from his crown, seven tongues/rays of fire; rides a ram; holds a rosary and a ladle, torch, axe or flaming spear.',
    lookSources: [`${W}/Agni`],
  },
  {
    id: 'soma-deva', name: 'Soma', tradition: 'hindu', type: 'god',
    epithets: ['the Sacred Draught', 'the Moon', 'Lord of Plants'],
    desc: 'Both the sacred, possibly entheogenic ritual drink of the Vedas and the god personifying it — later identified with the moon.',
    relationships: [], texts: ['rig-veda'], links: { wikipedia: `${W}/Soma_(drink)` },
    look: 'As the moon-god (Soma/Chandra): a white-complexioned deity holding a mace, riding a three-wheeled chariot drawn by white horses (or an antelope). As the sacred draught Soma he is the pressed plant-juice itself — depict as the ritual drink/plant, not a person, when shown in his Vedic sense.',
    lookSources: [`${W}/Soma_(drink)`, `${W}/Chandra`],
  },
  {
    id: 'varuna', name: 'Varuna', tradition: 'hindu', type: 'god',
    epithets: ['Lord of Ṛta (Cosmic Order)', 'Keeper of the Waters'],
    desc: 'The Vedic god of the cosmic order (ṛta), the waters and the moral law — the all-seeing sovereign who binds the wicked.',
    relationships: [], texts: ['rig-veda', 'upanishads'], links: { wikipedia: `${W}/Varuna` },
    look: 'A youthful man riding the makara (crocodile-like sea creature), holding a noose (pasha) and a water pitcher; lord of the western waters.',
    lookSources: [`${W}/Varuna`],
  },
  {
    id: 'krishna', name: 'Krishna', tradition: 'hindu', type: 'god',
    epithets: ['the Dark One', 'Govinda', 'the Eighth Avatar of Vishnu'],
    desc: 'An avatar of Vishnu and the divine teacher of the Bhagavad Gita, who reveals the paths of devotion, knowledge and action to the warrior Arjuna.',
    relationships: [{ rel: 'aspect-of', to: 'vishnu' }],
    texts: ['bhagavad-gita', 'mahabharata'], links: { wikipedia: `${W}/Krishna` },
    look: 'A youthful god with dark — black or blue — skin, a peacock feather in his crown, yellow garments, playing a bamboo flute (Murlidhara); also shown as a butter-eating infant, lifting Govardhan hill, or as Arjuna\'s charioteer; four-armed Vishnu form with discus in some images.',
    lookSources: [`${W}/Krishna`],
  },
  {
    id: 'vishnu', name: 'Vishnu', tradition: 'hindu', type: 'god',
    epithets: ['the Preserver', 'Narayana', 'Lord of the Ten Avatars'],
    desc: 'One of the supreme Hindu deities — the preserver of the cosmos, who descends as avatars (Rama, Krishna and others) to restore dharma.',
    relationships: [{ rel: 'child', to: 'krishna' }],
    texts: ['bhagavad-gita', 'mahabharata', 'ramayana'], links: { wikipedia: `${W}/Vishnu` },
    look: 'A dark blue / blue-grey / black-skinned, richly jewelled crowned man with four arms holding the conch (Panchajanya), discus (Sudarshana chakra), mace (Kaumodaki) and lotus; yellow garments, the Kaustubha gem, Vaijayanti garland and shrivatsa mark on his chest; reclines on the serpent Shesha on the ocean of milk; Garuda (eagle) is his vahana.',
    lookSources: [`${W}/Vishnu`],
  },
  {
    id: 'arjuna', name: 'Arjuna', tradition: 'hindu', type: 'hero',
    epithets: ['the Archer', 'Partha', 'the Third Pandava'],
    desc: 'The great warrior of the Mahabharata whose crisis of conscience on the battlefield prompts Krishna\'s teaching in the Bhagavad Gita.',
    relationships: [], texts: ['bhagavad-gita', 'mahabharata'], links: { wikipedia: `${W}/Arjuna` },
    look: 'A strong-armed archer-prince of dark complexion wearing the celestial diadem given by Indra (Kiriti), wielding the bow Gandiva with twin inexhaustible quivers, in a white chariot drawn by milk-white horses with Krishna as charioteer.',
    lookSources: [`${W}/Arjuna`],
  },
  {
    id: 'hanuman', name: 'Hanuman', tradition: 'hindu', type: 'god',
    epithets: ['the Monkey-God', 'Son of the Wind', 'Devotee of Rama'],
    desc: 'The mighty monkey-god of the Ramayana — embodiment of devotion, strength and service, who leaps to Lanka to find the captive Sita.',
    relationships: [], texts: ['ramayana'], links: { wikipedia: `${W}/Hanuman` },
    look: 'A muscular divine monkey (vanara) with a simian face and long tail, carrying a gada (mace), often lifting the mountain of healing herbs or kneeling with folded hands before Rama; temple images coated in red/orange sindhur; Tulsidas describes him golden-coloured with earrings and curly hair.',
    lookSources: [`${W}/Hanuman`],
  },

  {
    id: 'shiva', name: 'Shiva', tradition: 'hindu', type: 'god',
    epithets: ['Mahadeva', 'Rudra', 'Nataraja', 'the Destroyer'],
    desc: 'The Supreme Lord of Shaivism — ascetic yogi, cosmic dancer and destroyer-transformer of the Trimurti, husband of Parvati and father of Ganesha and Kartikeya.',
    relationships: [{ rel: 'consort', to: 'parvati' }, { rel: 'child', to: 'ganesha' }, { rel: 'child', to: 'kartikeya' }],
    texts: ['upanishads', 'mahabharata'], links: { wikipedia: `${W}/Shiva` },
    look: 'An ascetic with matted locks (jata) holding a crescent moon and the river Ganga, a third eye on the forehead, the serpent Vasuki around his neck, holding the trishula (trident) and damaru drum, often ash-smeared and blue-throated, seated on a tiger skin or dancing as Nataraja; bull Nandi as vahana. Also worshipped aniconically as the linga.',
    lookSources: [`${W}/Shiva`],
  },
  {
    id: 'parvati', name: 'Parvati', tradition: 'hindu', type: 'goddess',
    epithets: ['Uma', 'Gauri', 'Daughter of the Mountain'],
    desc: 'Goddess of love, devotion, fertility and power — gentle form of the Devi, consort of Shiva and mother of Ganesha and Kartikeya.',
    relationships: [{ rel: 'consort', to: 'shiva' }, { rel: 'child', to: 'ganesha' }, { rel: 'child', to: 'kartikeya' }],
    texts: ['upanishads', 'mahabharata'], links: { wikipedia: `${W}/Parvati` },
    look: 'A fair, beautiful, benevolent woman in a red sari with a headband or crown; two arms beside Shiva, four when alone (holding lotus, mirror, rosary, trident, etc., one hand in abhaya mudra); Ganesha often on her knee; lion or tiger as mount.',
    lookSources: [`${W}/Parvati`],
  },
  {
    id: 'ganesha', name: 'Ganesha', tradition: 'hindu', type: 'god',
    epithets: ['Ganapati', 'Vinayaka', 'Remover of Obstacles'],
    desc: 'Elephant-headed god of beginnings, wisdom and the removal of obstacles, son of Shiva and Parvati, invoked first in every rite.',
    relationships: [{ rel: 'parent', to: 'shiva' }, { rel: 'parent', to: 'parvati' }],
    texts: [], links: { wikipedia: `${W}/Ganesha` },
    look: 'An elephant-headed, pot-bellied god, usually four-armed, holding his broken tusk, a modaka sweet (tasted with his trunk), an axe and an elephant goad (ankusha) or noose; mouse as vahana.',
    lookSources: [`${W}/Ganesha`],
  },
  {
    id: 'kartikeya', name: 'Kartikeya', tradition: 'hindu', type: 'god',
    epithets: ['Murugan', 'Skanda', 'Subrahmanya', 'Commander of the Gods'],
    desc: 'Youthful god of war and victory, commander of the divine army, son of Shiva and Parvati — beloved in Tamil tradition as Murugan.',
    relationships: [{ rel: 'parent', to: 'shiva' }, { rel: 'parent', to: 'parvati' }],
    texts: ['mahabharata', 'ramayana'], links: { wikipedia: `${W}/Kartikeya` },
    look: 'A youthful warrior god with one or six heads (six-faced form post-Gupta), holding the vel (divine spear), riding a peacock, with the rooster as emblem; Kushan-era images show one head, dhoti and armour, spear in the right hand and a rooster in the left.',
    lookSources: [`${W}/Kartikeya`],
  },
  {
    id: 'lakshmi', name: 'Lakshmi', tradition: 'hindu', type: 'goddess',
    epithets: ['Shri', 'Padma', 'Goddess of Fortune'],
    desc: 'Goddess of wealth, fortune, beauty and prosperity, consort of Vishnu, who rose from the churning of the ocean of milk.',
    relationships: [{ rel: 'consort', to: 'vishnu' }],
    texts: ['ramayana', 'mahabharata'], links: { wikipedia: `${W}/Lakshmi` },
    look: 'An elegantly dressed, golden-complexioned woman with four arms, sitting or standing on a lotus throne and holding lotuses, prosperity-showering; flanked by elephants pouring water (Gajalakshmi); owl as vahana in some traditions; lions on Gupta coins.',
    lookSources: [`${W}/Lakshmi`],
  },
  {
    id: 'saraswati', name: 'Saraswati', tradition: 'hindu', type: 'goddess',
    epithets: ['Sarasvati', 'Vani', 'Goddess of Learning'],
    desc: 'Goddess of knowledge, speech, music, arts and learning — once the great Vedic river — consort of Brahma.',
    relationships: [{ rel: 'consort', to: 'brahma' }],
    texts: ['rig-veda', 'mahabharata'], links: { wikipedia: `${W}/Saraswati` },
    look: 'A beautiful woman dressed in pure white, seated on a white lotus, four-armed, holding a book (pustaka), a rosary (mala), a water pot and playing the veena; a white swan/goose (hamsa) or peacock beside her. White throughout.',
    lookSources: [`${W}/Saraswati`],
  },
  {
    id: 'durga', name: 'Durga', tradition: 'hindu', type: 'goddess',
    epithets: ['Mahishasuramardini', 'the Invincible', 'Shakti'],
    desc: 'Warrior form of the Great Goddess, created from the combined power of the gods to slay the buffalo-demon Mahishasura.',
    relationships: [{ rel: 'aspect-of', to: 'parvati' }],
    texts: ['mahabharata'], links: { wikipedia: `${W}/Durga` },
    look: 'A goddess with eight to eighteen arms, each holding a weapon given by the gods (discus, conch, bow and arrow, sword, trident, mace, shield, noose, lotus), riding a lion or tiger and slaying the buffalo-demon Mahishasura — her face calm and serene in the midst of battle.',
    lookSources: [`${W}/Durga`],
  },
  {
    id: 'kali', name: 'Kali', tradition: 'hindu', type: 'goddess',
    epithets: ['Kalika', 'the Black One', 'Mother of Time'],
    desc: 'Fierce goddess of time, death and liberation who sprang from Durga\'s brow in battle — terrifying protector and, in Bengal devotion, the loving Mother.',
    relationships: [{ rel: 'aspect-of', to: 'durga' }],
    texts: [], links: { wikipedia: `${W}/Kali` },
    look: 'A "terrifying emaciated woman" with black skin, long wild dishevelled hair, red eyes and a long lolling red tongue, four arms (sword and severed head in the left hands, abhaya and boon gestures in the right), naked but for a garland of heads and a skirt of severed arms, standing on the supine Shiva in a cremation ground.',
    lookSources: [`${W}/Kali`],
  },
  {
    id: 'brahma', name: 'Brahma', tradition: 'hindu', type: 'god',
    epithets: ['the Creator', 'Prajapati', 'Svayambhu (Self-Born)'],
    desc: 'Creator-god of the Trimurti, born from the lotus of Vishnu\'s navel, from whose four mouths the four Vedas came forth; consort of Saraswati.',
    relationships: [{ rel: 'consort', to: 'saraswati' }],
    texts: ['upanishads', 'mahabharata', 'ramayana'], links: { wikipedia: `${W}/Brahma` },
    look: 'A four-faced, four-armed god (faces to the four directions), golden in colour, with a white beard and matted hair with a crown, holding the Vedas, a rosary, a sacrificial ladle and a water pot (kamandalu); seated on a lotus, dressed in white (or red), with a hamsa (swan/goose) as vahana. No weapons.',
    lookSources: [`${W}/Brahma`],
  },
  {
    id: 'rama', name: 'Rama', tradition: 'hindu', type: 'god',
    epithets: ['Ramachandra', 'Maryada Purushottama', 'Seventh Avatar of Vishnu'],
    desc: 'Prince of Ayodhya and seventh avatar of Vishnu, hero of the Ramayana, who rescued Sita from Ravana — the model of dharma.',
    relationships: [{ rel: 'aspect-of', to: 'vishnu' }, { rel: 'consort', to: 'sita' }],
    texts: ['ramayana', 'mahabharata'], links: { wikipedia: `${W}/Rama` },
    look: 'A two-armed princely archer with black, blue or dark skin, typically in reddish garments, holding an arrow in his right hand and the bow in his left; Sita (golden-yellow) on his right, Lakshmana on his left, Hanuman kneeling with folded hands.',
    lookSources: [`${W}/Rama`],
  },
  {
    id: 'sita', name: 'Sita', tradition: 'hindu', type: 'goddess',
    epithets: ['Janaki', 'Vaidehi', 'Daughter of the Earth'],
    desc: 'Heroine of the Ramayana, earth-born wife of Rama and incarnation of Lakshmi, revered for devotion, courage and purity.',
    relationships: [{ rel: 'consort', to: 'rama' }, { rel: 'aspect-of', to: 'lakshmi' }],
    texts: ['ramayana'], links: { wikipedia: `${W}/Sita` },
    look: 'A golden-yellow-complexioned woman in a sari (or ghagra-choli) with a veil and jewellery of gold, pearls or flowers, always placed on Rama\'s right; pink lotus as emblem.',
    lookSources: [`${W}/Sita`],
  },
  {
    id: 'surya', name: 'Surya', tradition: 'hindu', type: 'god',
    epithets: ['Aditya', 'Savitr', 'the Sun'],
    desc: 'The sun-god, source of light and life, eye of the world and father of Yama, who crosses the sky in a chariot of seven horses.',
    relationships: [{ rel: 'child', to: 'yama' }],
    texts: ['rig-veda', 'mahabharata', 'ramayana'], links: { wikipedia: `${W}/Surya` },
    look: 'A resplendent crowned god holding a lotus in each of his two hands, standing in a chariot drawn by seven horses driven by the seated Aruna; notably wears Northern (Central Asian) dress with high boots; dawn goddesses Usha and Pratyusha shooting arrows at his sides.',
    lookSources: [`${W}/Surya`],
  },
  {
    id: 'yama', name: 'Yama', tradition: 'hindu', type: 'god',
    epithets: ['Dharmaraja', 'Lord of Death', 'Kala'],
    desc: 'God of death and justice, first mortal to die and ruler of the dead, son of Surya — the teacher of Nachiketas in the Katha Upanishad.',
    relationships: [{ rel: 'parent', to: 'surya' }],
    texts: ['rig-veda', 'upanishads', 'mahabharata'], links: { wikipedia: `${W}/Yama` },
    look: 'A four-armed god with the dark complexion of rain/storm clouds, protruding fangs and wrathful expression, ringed by flames, in red, yellow or blue garments, holding a noose (pasha) and a staff/mace (danda), riding a water-buffalo.',
    lookSources: [`${W}/Yama`],
  },
  {
    id: 'kama', name: 'Kama', tradition: 'hindu', type: 'god',
    epithets: ['Kamadeva', 'Manmatha', 'Madana', 'Ananga (the Bodiless)'],
    desc: 'God of love and desire, burned to ashes by Shiva\'s third eye for disturbing his meditation, husband of Rati.',
    relationships: [{ rel: 'enemy', to: 'shiva' }],
    texts: ['ramayana', 'mahabharata'], links: { wikipedia: `${W}/Kamadeva` },
    look: 'A radiant, golden-complexioned handsome youth with blue-black hair, adorned with ornaments and flowers, in a blue garment, wielding a sugarcane bow strung with humming bees and five flower-tipped arrows; rides a parrot (or makara); makara on his banner; often with his consort Rati.',
    lookSources: [`${W}/Kamadeva`],
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
    look: 'An old, tall, long-bearded man with only one eye, in a hooded or broad-brimmed hat and a dark-blue cloak (Grímnismál, Völsunga saga), carrying the spear Gungnir; ravens Huginn and Muninn and wolves Geri and Freki beside him; rides eight-legged Sleipnir. Do NOT use a horned helmet (a 19th-century Wagner-era invention).',
    lookSources: [`${W}/Odin`, `${W}/V%C3%B6lsunga_saga`, `${W}/Gr%C3%ADmnism%C3%A1l`, `${W}/Horned_helmet`],
  },
  {
    id: 'thor', name: 'Thor', tradition: 'norse', type: 'god',
    epithets: ['the Thunderer', 'Wielder of Mjölnir', 'Defender of Midgard'],
    desc: 'The hammer-wielding thunder-god, defender of gods and humans against the giants — the most popular deity of the Norse world.',
    relationships: [{ rel: 'parent', to: 'odin' }, { rel: 'enemy', to: 'loki' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Thor` },
    look: 'A powerfully built man wielding the short-handled hammer Mjölnir, wearing the belt of strength Megingjörð and the iron gloves Járngreipr; rides a chariot drawn by two goats. The red beard ("Old Redbeard") is a later-saga attribute, not Eddic. Do NOT use the Marvel blond/winged-helmet or horned-helmet look.',
    lookSources: [`${W}/Thor`, 'https://www.norsemyth.org/2011/09/blond-thor-stan-lee-wasnt-wrong.html', `${W}/Horned_helmet`],
  },
  {
    id: 'loki', name: 'Loki', tradition: 'norse', type: 'god',
    epithets: ['the Trickster', 'the Sly One', 'Father of Monsters'],
    desc: 'The shape-shifting trickster of Norse myth — sometimes ally, finally enemy of the gods, whose offspring and treachery bring about Ragnarök.',
    relationships: [{ rel: 'enemy', to: 'thor' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Loki` },
    look: 'Described by Snorri as "pleasing and handsome" in appearance; the Snaptun Stone (c. 1000 CE) shows a face with scarred/stitched lips; also shown bound (Gosforth Cross) while Sigyn holds a bowl. A shapeshifter (mare, salmon, fly). Do NOT use the Marvel green-and-gold horned helm.',
    lookSources: [`${W}/Loki`],
  },
  {
    id: 'freyja', name: 'Freyja', tradition: 'norse', type: 'goddess',
    epithets: ['Lady of the Vanir', 'Mistress of Seiðr', 'Owner of Brísingamen'],
    desc: 'Norse goddess of love, beauty, fertility, war and magic (seiðr) — who takes half the battle-slain to her hall.',
    relationships: [], texts: ['eddas'], links: { wikipedia: `${W}/Freyja` },
    look: 'A beautiful goddess wearing the necklace Brísingamen and a cloak of falcon feathers, riding a chariot drawn by two cats, attended by the boar Hildisvíni.',
    lookSources: [`${W}/Freyja`],
  },
  {
    id: 'frigg', name: 'Frigg', tradition: 'norse', type: 'goddess',
    epithets: ['Queen of Asgard', 'Mother of Baldr', 'Frea (Langobard)'],
    desc: 'Wife of Odin and queen of the Æsir, who sits with him on Hliðskjálf, knows all fates but tells none, and bound all things to spare her son Baldr.',
    relationships: [{ rel: 'consort', to: 'odin' }, { rel: 'child', to: 'baldr' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Frigg` },
    look: 'Sources give almost no physical description: a queenly woman seated beside Odin on the high seat Hliðskjálf, attended by her maid Fulla, who carries her eski (ash-wood box). Spinning/distaff and keys are 19th-century romantic conventions, not Eddic — use cautiously.',
    lookSources: [`${W}/Frigg`],
  },
  {
    id: 'baldr', name: 'Baldr', tradition: 'norse', type: 'god',
    epithets: ['the Shining One', 'the Beloved', 'the Good'],
    desc: 'Son of Odin and Frigg, the most beloved and radiant of the gods, slain by a mistletoe dart thrown by his blind brother Höðr at Loki\'s contrivance.',
    relationships: [{ rel: 'parent', to: 'odin' }, { rel: 'parent', to: 'frigg' }, { rel: 'enemy', to: 'loki' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Baldr` },
    look: 'Snorri: "so fair of feature and so bright that light shines from him" — the whitest of flowers is named after his eyelash (Baldrs brá), and his beauty is "both of hair and body"; a radiant young god; shown on his funeral ship Hringhorni or struck by the mistletoe spear.',
    lookSources: [`${W}/Baldr`],
  },
  {
    id: 'tyr', name: 'Týr', tradition: 'norse', type: 'god',
    epithets: ['the One-Handed', 'God of Law and Battle'],
    desc: 'God of war, law and oaths who placed his right hand in the wolf Fenrir\'s mouth as a pledge, and lost it when the gods bound the wolf.',
    relationships: [{ rel: 'parent', to: 'odin' }],
    texts: ['eddas'], links: { wikipedia: `${W}/T%C3%BDr` },
    look: 'A warrior god missing his right hand — bitten off at the wrist by the wolf Fenrir; Migration-Period bracteates (e.g. Trollhättan) show a figure with his hand in a beast\'s jaws.',
    lookSources: [`${W}/T%C3%BDr`],
  },
  {
    id: 'heimdall', name: 'Heimdall', tradition: 'norse', type: 'god',
    epithets: ['Heimdallr', 'the White God', 'Gullintanni ("Golden-Toothed")', 'Rígr'],
    desc: 'Watchman of the gods who guards Bifröst from his hall Himinbjörg and will sound the Gjallarhorn at the onset of Ragnarök; foretold to slay and be slain by Loki.',
    relationships: [{ rel: 'enemy', to: 'loki' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Heimdallr` },
    look: '"The whitest of the gods", with golden teeth, holding the great horn Gjallarhorn, keeping watch at the rainbow bridge Bifröst, with his golden-maned horse Gulltoppr.',
    lookSources: [`${W}/Heimdallr`],
  },
  {
    id: 'hel', name: 'Hel', tradition: 'norse', type: 'goddess',
    epithets: ['Queen of Helheim', 'Daughter of Loki'],
    desc: 'Ruler of the realm of the dead who died of sickness or old age, daughter of Loki and Angrboða, set over Niflheim by Odin.',
    relationships: [{ rel: 'parent', to: 'loki' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Hel_(mythological_being)` },
    look: 'Snorri: half black (or blue) and half flesh-coloured, "rather downcast and fierce-looking"; possibly shown on bracteates as a female figure holding a staff or sceptre who meets a descending rider.',
    lookSources: [`${W}/Hel_(mythological_being)`],
  },
  {
    id: 'njord', name: 'Njörðr', tradition: 'norse', type: 'god',
    epithets: ['Njord', 'Lord of Nóatún', 'God of the Sea and Winds'],
    desc: 'Vanir god of the sea, seafaring, wind, fishing and wealth, father of Freyr and Freyja, whose unhappy marriage to Skaði split between shore and mountains.',
    relationships: [{ rel: 'child', to: 'freyr' }, { rel: 'child', to: 'freyja' }, { rel: 'consort', to: 'skadi' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Nj%C3%B6r%C3%B0r` },
    look: 'No ancient image survives; the sources describe a benign sea-god of the harbour hall Nóatún ("ship-enclosure") ruling winds and waves — Skaði chose him by his beautiful feet. Depict as a mature seaside lord with ships/sea; avoid invented regalia.',
    lookSources: [`${W}/Nj%C3%B6r%C3%B0r`],
  },
  {
    id: 'freyr', name: 'Freyr', tradition: 'norse', type: 'god',
    epithets: ['Yngvi-Freyr', 'Lord', 'God of Harvest and Peace'],
    desc: 'Vanir god of kingship, peace, fertility, sunshine and good harvests, brother of Freyja, who gave away his self-fighting sword for love of Gerðr.',
    relationships: [{ rel: 'parent', to: 'njord' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Freyr` },
    look: 'Rides the shining golden-bristled boar Gullinbursti and owns the foldable ship Skíðblaðnir; fights with an antler after giving away his sword; Adam of Bremen describes his Uppsala image as phallic.',
    lookSources: [`${W}/Freyr`],
  },
  {
    id: 'skadi', name: 'Skaði', tradition: 'norse', type: 'goddess',
    epithets: ['Skadi', 'Öndurdís ("Ski-Lady")', 'Öndurguð ("Ski-God")'],
    desc: 'Jötunn goddess of winter, mountains, skiing and bowhunting, daughter of Þjazi, who wed Njörðr and fastened the serpent above the bound Loki.',
    relationships: [{ rel: 'consort', to: 'njord' }, { rel: 'enemy', to: 'loki' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Ska%C3%B0i` },
    look: 'A huntress travelling on skis through snowy mountains, wielding a bow and shooting wild animals, in her father\'s mountain hall Þrymheimr.',
    lookSources: [`${W}/Ska%C3%B0i`],
  },
  {
    id: 'idun', name: 'Iðunn', tradition: 'norse', type: 'goddess',
    epithets: ['Idun', 'Keeper of the Apples of Youth'],
    desc: 'Goddess who keeps the apples the gods eat to stay young, wife of Bragi, once lured away by Loki to the giant Þjazi.',
    relationships: [{ rel: 'consort', to: 'bragi' }],
    texts: ['eddas'], links: { wikipedia: `${W}/I%C3%B0unn` },
    look: 'A young goddess carrying her eski (ash-wood box) of golden apples of youth; no physical description beyond this in the sources.',
    lookSources: [`${W}/I%C3%B0unn`],
  },
  {
    id: 'bragi', name: 'Bragi', tradition: 'norse', type: 'god',
    epithets: ['God of Poetry', 'First of Poets'],
    desc: 'God of poetry and eloquence, husband of Iðunn, who welcomes the fallen to Valhalla — possibly the deified 9th-century skald Bragi Boddason.',
    relationships: [{ rel: 'consort', to: 'idun' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Bragi` },
    look: 'Snorri calls him "the long-bearded Áss" and inventor of poetry (bragr); linked to runes in Sigrdrífumál. The harp is a later romantic addition, not in the sources.',
    lookSources: [`${W}/Bragi`],
  },
  {
    id: 'sif', name: 'Sif', tradition: 'norse', type: 'goddess',
    epithets: ['the Golden-Haired', 'Wife of Thor'],
    desc: 'Golden-haired goddess, wife of Thor, whose hair Loki shaved off and who received new hair of true gold forged by the dwarves.',
    relationships: [{ rel: 'consort', to: 'thor' }],
    texts: ['eddas'], links: { wikipedia: `${W}/Sif` },
    look: '"The loveliest of women", with long hair of real gold forged by the sons of Ívaldi after Loki cut her own; often read as ripe golden wheat.',
    lookSources: [`${W}/Sif`],
  },
  {
    id: 'vidar', name: 'Víðarr', tradition: 'norse', type: 'god',
    epithets: ['Vidar', 'the Silent God', 'Avenger of Odin'],
    desc: 'Silent son of Odin, nearly as strong as Thor, who will avenge his father at Ragnarök by tearing apart the jaws of the wolf Fenrir.',
    relationships: [{ rel: 'parent', to: 'odin' }],
    texts: ['eddas'], links: { wikipedia: `${W}/V%C3%AD%C3%B0arr` },
    look: 'A strong silent warrior wearing a thick shoe (iron shoe) made of all the leather scraps ever cut from shoes, one foot on the wolf\'s lower jaw and a hand forcing up the upper jaw; spear in hand, as on the Gosforth Cross.',
    lookSources: [`${W}/V%C3%AD%C3%B0arr`],
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
    look: 'Aniconic: nirguna Brahman is formless and without attributes, and is NOT depicted as a person. Represent only symbolically — the syllable Om, or light/space; saguna Brahman is shown through the gods.',
    lookSources: [`${W}/Brahman`],
  },
  {
    id: 'atman-concept', name: 'Atman', tradition: 'hindu', type: 'concept',
    epithets: ['the Self', 'the Inner Witness'],
    desc: 'The innermost self or soul in Hindu thought — which the Upanishads declare to be identical with Brahman ("tat tvam asi," thou art that).',
    relationships: [{ rel: 'aspect-of', to: 'brahman-concept' }],
    texts: ['upanishads'], links: { wikipedia: `${W}/%C4%80tman_(Hinduism)` },
    look: 'Aniconic: the Self is formless and is NOT depicted as a figure; if an image is needed use abstract light within the heart, or the Om syllable — never a personified deity.',
    lookSources: [`${W}/%C4%80tman_(Hinduism)`, `${W}/Brahman`],
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
