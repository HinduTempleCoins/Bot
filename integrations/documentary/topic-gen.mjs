// topic-gen.mjs — the month-long documentary queue: a taxonomy of civilizations × facets, cross-cutting themes, every
// remakes group and every animated map → queue entries (10 / 30 / 60 minutes); and, just before a film is made, an LLM
// step that turns an entry into a GROUNDED topic definition in the same shape as topics.mjs (facts tagged record /
// tradition / interpretation with named sources, sequences with learning goals), validated before use.
// Pure except defineTopic (which takes an llm function). Hand-written topics in topics.mjs always take precedence.

export const CIVILIZATIONS = [
  { id: 'egypt', name: 'Ancient Egypt', region: 'nile', peoples: 'egyptian' },
  { id: 'kush', name: 'Kush and Nubia', region: 'nile', peoples: 'nubian' },
  { id: 'mesopotamia', name: 'Sumer and Akkad', region: 'mesopotamia', peoples: 'levantine' },
  { id: 'babylon', name: 'Babylon', region: 'mesopotamia', peoples: 'levantine' },
  { id: 'assyria', name: 'Assyria', region: 'mesopotamia', peoples: 'levantine' },
  { id: 'persia', name: 'the Persian Empires', region: 'persia', peoples: 'levantine' },
  { id: 'indus', name: 'the Indus cities', region: 'india', peoples: 'indian' },
  { id: 'india', name: 'Ancient India', region: 'india', peoples: 'indian' },
  { id: 'china', name: 'Ancient China', region: 'china', peoples: '' },
  { id: 'minoans', name: 'the Minoans and Mycenae', region: 'aegean', peoples: 'minoan' },
  { id: 'phoenicians', name: 'the Phoenicians and Carthage', region: 'levant', peoples: 'punic' },
  { id: 'amazigh', name: 'the Amazigh of North Africa', region: 'maghreb', peoples: 'libyan' },
  { id: 'greece', name: 'Ancient Greece', region: 'aegean', peoples: 'greek' },
  { id: 'rome', name: 'Rome', region: 'mediterranean', peoples: '' },
  { id: 'byzantium', name: 'Byzantium', region: 'mediterranean', peoples: '' },
  { id: 'arabia', name: 'Ancient Arabia', region: 'arabia', peoples: 'levantine' },
  { id: 'aksum', name: 'Ethiopia and Aksum', region: 'horn', peoples: 'nubian' },
  { id: 'scythians', name: 'the Scythians', region: 'steppe', peoples: '' },
  { id: 'celts', name: 'the Celts', region: 'europe', peoples: 'pale' },
  { id: 'norse', name: 'the Norse', region: 'europe', peoples: 'pale' },
  { id: 'mesoamerica', name: 'Mesoamerica', region: 'americas', peoples: '' },
  { id: 'andes', name: 'the Andes', region: 'americas', peoples: '' },
];

export const FACETS = [
  { id: 'monuments', name: 'How they built', hint: 'monument building, tools and labour, the questions modern people still ask about how it was done' },
  { id: 'daily', name: 'Daily life', hint: 'homes, food, work, markets, family, clothing and adornment' },
  { id: 'gods', name: 'Gods in real places', hint: 'gods and spirits tied to real mountains, rivers, springs and temples — the spirit world and the physical world overlapping' },
  { id: 'death', name: 'The dead and the afterlife', hint: 'tombs, burial, the journey of the soul, ancestors' },
  { id: 'rulers', name: 'Kings, queens and courts', hint: 'rulers, palaces, regalia, famous reigns' },
  { id: 'trade', name: 'Trade and travel', hint: 'trade routes, ships, caravans, what moved and why' },
  { id: 'festivals', name: 'Festivals and rites', hint: 'festivals, processions, music, perfumes and incense, temple rites' },
  { id: 'crafts', name: 'Crafts and makers', hint: 'artisans, metal, weaving, pottery, writing and scribes' },
];

export const THEMES = [
  { id: 'giants', name: 'Giants in the Old Stories', hint: 'Nephilim, the Anakim and Og in the Hebrew Bible; the jötnar of the Norse (the gods interbreed with them); Greek Titans, Gigantes and Cyclopes; carvings of giant figures (usually not meant as literal giants) — all presented as what the traditions say', region: '', peoples: '' },
  { id: 'table-of-nations', name: 'The Table of Nations', hint: 'Genesis 10: the sons of Noah and the peoples descended from them, set beside what archaeology knows of those peoples', region: 'levant', peoples: '' },
  { id: 'havilah-cush', name: 'Havilah and Cush Before and After Noah', hint: 'Genesis 2 and 10, Josephus, and the archaeology of Kush and Arabia', region: 'nile', peoples: 'nubian' },
  { id: 'flood-stories', name: 'Flood Stories', hint: 'Genesis, Atrahasis, Gilgamesh, Deucalion, Manu — traditions side by side', region: 'mesopotamia', peoples: '' },
  { id: 'oracles', name: 'The Oracles', hint: 'Delphi, Dodona, Siwa and other oracle sites', region: 'aegean', peoples: 'greek' },
  { id: 'sacred-mountains', name: 'The Gods\' Mountains', hint: 'Kailash and Meru, Olympus, Sinai, Jebel Barkal, Ararat — sacred mountains on the real map', region: '', peoples: '' },
  { id: 'rivers', name: 'The Great Rivers', hint: 'Nile, Tigris and Euphrates, Indus, Yellow River — the rivers that made civilizations', region: '', peoples: '' },
  { id: 'the-nile', name: 'The Nile from Source to Sea', hint: 'the river, its flood, its gods and its peoples', region: 'nile', peoples: 'egyptian' },
  { id: 'temples', name: 'Temples of the Ancient World', hint: 'how temples were laid out and used across civilizations', region: '', peoples: '' },
  { id: 'trade-routes', name: 'The Incense and Silk Roads', hint: 'incense routes of Arabia, the Silk Road, the monsoon sea routes', region: '', peoples: '' },
  { id: 'queens', name: 'Queens of the Ancient World', hint: 'Hatshepsut, Nefertiti, the Kandakes of Meroë, Cleopatra, Tin Hinan, Zenobia', region: '', peoples: '' },
  { id: 'lost-cities', name: 'Lost Cities', hint: 'cities abandoned and rediscovered: Mohenjo-daro, Meroë, Petra, Ugarit, Troy', region: '', peoples: '' },
  { id: 'writing', name: 'The First Writing', hint: 'cuneiform, hieroglyphs, the alphabet, Meroitic, Linear B — using real inscriptions', region: '', peoples: '' },
  { id: 'perfume', name: 'Perfume, Incense and Kyphi', hint: 'lotus perfume, headcones, frankincense and myrrh', region: 'nile', peoples: 'egyptian' },
];

// operator must-haves: early in the queue, with hints for the definer
export const MUST_HAVE = [
  { id: 'paroh', minutes: 10, name: 'Par\'oh: the Great House', region: 'nile', peoples: 'egyptian', priority: 79,
    hint: 'per-aa, "great house", first meant the palace/court and only from the New Kingdom (Thutmose III onward) the king himself; the five-fold royal titulary (Horus, Nebty, Golden Horus, throne and birth names); the king as Horus and son of Ra; how the Hebrew/Greek "Pharaoh" came from per-aa. Record vs later usage on cards.' },
  { id: 'library-alexandria', minutes: 30, name: 'The Library of Alexandria, Through the Centuries', region: 'nile', peoples: 'egyptian', priority: 78,
    hint: 'Show it at different times: founding under Ptolemy I/II with Demetrius of Phalerum and the Mouseion; ships searched for books; Callimachus\' Pinakes (first catalogue); Eratosthenes measuring the earth; Aristarchus, Euclid, Herophilus; the Septuagint tradition (Letter of Aristeas — tradition); the Serapeum\'s daughter library; 48 BC fire during Caesar\'s war; decline under later Ptolemies and Rome; Aurelian 272; the Serapeum destroyed 391 (Theophilus); the Caliph Omar story as a late (13th c.) tradition, not record; Manetho writing for Ptolemy II (links to the Manetho film).',
    assets: ['the Mouseion and library halls with scroll shelves', 'the Serapeum of Alexandria', 'the Pharos lighthouse', 'Callimachus cataloguing', 'Eratosthenes at Syene\'s well'] },
  { id: 'viziers', minutes: 30, name: 'The Viziers of Egypt: Imhotep to Joseph', region: 'nile', peoples: 'egyptian', priority: 77,
    hint: 'The vizier (tjaty) as the king\'s chief minister; Imhotep under Djoser (Step Pyramid at Saqqara; his titles on a statue base; later deified as god of medicine, identified with Asclepius — record vs later cult); Ptahhotep\'s Maxims; Rekhmire\'s tomb (the Duties of the Vizier text, the court scenes, foreign tribute incl. Keftiu — links to our remakes); Joseph: Genesis 39–50 as the text (Potiphar, the dreams, the seven years, the granaries, Goshen, the chariot and signet ring), the identification theories (Middle Kingdom/Hyksos-era proposals, the Bahr Yussef canal attribution) clearly as theory/tradition.',
    assets: ['Imhotep with the Step Pyramid', 'the vizier\'s court (Rekhmire)', 'Joseph before Pharaoh with the signet ring', 'granaries of Egypt'] },
  { id: 'imhotep', minutes: 10, name: 'Imhotep: Architect of the First Pyramid', region: 'nile', peoples: 'egyptian', priority: 76,
    hint: 'Djoser\'s Step Pyramid complex at Saqqara; the statue base naming Imhotep; how he became a god of medicine and wisdom; the Famine Stela (Ptolemaic, tradition).' },
  { id: 'peseshet', minutes: 10, name: 'Peseshet, Lady Overseer of Physicians', region: 'nile', peoples: 'egyptian', priority: 75,
    hint: 'Old Kingdom (4th–5th dynasty) — known from the false door of Akhethotep\'s mastaba at Giza, titled "overseer of female physicians"; Egyptian medicine as record (the Ebers and Edwin Smith papyri — later); Saïs and its medical school (Udjahorresnet restored it under Darius — record) as tradition-linked context; use our Peseshet and Saïs characters (library/characters_sais; knowledge/history/sais-delphi-characters.md briefs).',
    assets: ['Peseshet at work', 'the House of Life at Saïs'] },
  { id: 'carthage', minutes: 30, name: 'Carthage: the City of the Phoenicians in Africa', region: 'maghreb', peoples: 'punic', priority: 84,
    hint: 'Founding legend (Elissa/Dido, the oxhide, 814/813 BC) as tradition vs archaeology (late 9th–8th c. BC); Byrsa hill; the cothon harbours (circular military + rectangular merchant); the tophet (present the scholarly debate honestly); Tanit and Baal Hammon; Magonid rulers; wars with the Greeks in Sicily; Hanno\'s and Himilco\'s voyages; the Punic Wars and Hannibal; 146 BC destruction; Roman Carthage.',
    assets: ['the cothon harbours of Carthage (aerial)', 'Byrsa hill', 'Carthaginian officers', 'Phoenician ships (gauloi)'] },
  { id: 'phoenician-colonies', minutes: 30, name: 'The Phoenician Colonies', region: 'mediterranean', peoples: 'punic', priority: 83,
    hint: 'Tyre (island city), Sidon, Byblos; purple dye and cedar; the alphabet; colonies by current archaeology with founding legends as tradition: Kition (Cyprus), Kommos (Crete), Motya (Sicily), Nora and Tharros (Sardinia), Ebusus (Ibiza), Utica, Carthage, Gades beyond the Pillars (temple of Melqart), Lixus and Mogador on the Atlantic; trade in silver and tin; route-with-stops map film preferred.',
    assets: ['Tyre\'s island city', 'purple-dye workshop', 'Phoenician ships (gauloi)', 'temple of Melqart at Gades'] },
  { id: 'holy-family-egypt', minutes: 30, name: 'The Holy Family in Egypt', region: 'nile', peoples: 'egyptian', priority: 82,
    hint: 'Text: Matthew 2:13–23 (the flight, Herod, the return; "Out of Egypt have I called my son", Hosea 11:1) as the record of the account. Coptic tradition of the itinerary as tradition: Tell Basta (Bubastis), Musturud, Bilbeis, Wadi Natrun, Matariya (the tree), Old Cairo (Abu Serga crypt), Maadi, Gabal al-Tayr, Deir al-Muharraq, Asyut — the Coptic Church\'s Holy Family Trail; apocryphal infancy gospels (Pseudo-Matthew, the Arabic Infancy Gospel: idols falling, the palm bending) clearly labelled as later tradition; Roman-era Egypt as the setting. Route-with-stops map film preferred.',
    assets: ['Joseph, Mary and the child on the road (Roman-era Egypt)', 'Coptic churches and monasteries on the trail', 'the Nile at Maadi'] },
  { id: 'manetho', minutes: 30, name: 'Manetho and the Lost History of Egypt', region: 'nile', peoples: 'egyptian', priority: 81,
    hint: 'Manetho of Sebennytos, priest at Heliopolis, wrote the Aegyptiaca in Greek for Ptolemy II (3rd c. BC); the work is lost and survives only in quotation: Josephus (Against Apion — the Hyksos, the "shepherd kings", Osarseph), Julius Africanus, Eusebius, George Syncellus — show the chain of transmission. His 30 dynasties, still the framework of Egyptology; compare with the Turin Royal Canon, the Abydos King List, the Palermo Stone, the Karnak list; where they agree and differ. Sources: Josephus (Whiston, PD), Cory\'s Ancient Fragments (PD). Tradition vs record on every card.',
    assets: ['Manetho writing at Heliopolis', 'the Turin Royal Canon papyrus', 'the Abydos King List wall', 'the Palermo Stone'] },
  { id: 'manetho-kinglists', minutes: 10, name: 'The King Lists of Egypt', region: 'nile', peoples: 'egyptian', priority: 80,
    hint: 'The Abydos King List (Seti I and Ramesses offering to 76 ancestors), the Turin Canon (fragmentary papyrus, years and days), the Palermo Stone (annals), Saqqara Tablet, Karnak list; Manetho\'s dynasties as the later Greek-language synthesis.' },
  { id: 'scheria', minutes: 30, name: 'Scheria: the Land of the Phaeacians', region: 'aegean', peoples: 'greek', priority: 100,
    hint: 'Odyssey books 6–13: Nausicaa at the river; King Alcinous\' palace with its bronze walls, the gold and silver dogs and the ever-fruiting orchard; the ship-loving Phaeacians and their self-steering ships; Demodocus\' songs; Odysseus\' return to Ithaca; Poseidon turning the ship to stone; the ancient identification of Scheria with Corfu (Kerkyra) and the Corfiot tradition of the ship-rock Pontikonisi; modern theories — Homer as tradition, Corfu\'s archaeology as record.',
    assets: ['Phaeacian ships (self-steering, no pilots)', 'the palace of Alcinous with bronze walls and gold and silver dogs', 'Nausicaa and her companions at the river washing clothes'] },
  { id: 'nausicaa', minutes: 10, name: 'Nausicaa and the Stranger', region: 'aegean', peoples: 'greek', priority: 99,
    hint: 'Odyssey book 6: Nausicaa\'s dream sent by Athena, the washing at the river, the ball game, the shipwrecked stranger, her advice to go to the queen Arete; the Scheria/Corfu tradition.',
    assets: ['Nausicaa and her companions at the river', 'Odysseus shipwrecked on the shore'] },
  { id: 'atlantis', minutes: 30, name: 'Atlantis: What the Priest of Sais Told Solon', region: 'nile', peoples: 'egyptian', priority: 98,
    hint: 'Plato, Timaeus and Critias (Jowett translation) — the text is the record of what Plato wrote; the story itself is tradition. Solon\'s visit to Saïs and the temple of Neith; Sonchis (named by Plutarch, Life of Solon 26) and "you Greeks are always children"; the flood cycles and lost records; the island beyond the Pillars of Heracles; Poseidon and Cleito; the ring-shaped city of alternating rings of land and sea, canals, bridges, harbours; red, white and black stone; the temple with orichalcum; the ten kings and the bull rite; the war with prehistoric Athens; one terrible day and night and the sinking; the unfinished Critias. Every card marks what the text says. Modern theories (Thera/Minoan eruption, Doggerland, the Richat structure) ONLY as clearly labelled interpretation cards at the very end, never as the story.',
    assets: ['the concentric ring city of Atlantis (top-down and aerial)', 'the orichalcum temple of Poseidon', 'the Pillars of Heracles', 'Solon', 'Critias', 'Timaeus', 'the bull ceremony of the ten kings'] },
  { id: 'atlantis-ring-city', minutes: 10, name: 'The Ring City of Atlantis', region: 'aegean', peoples: 'greek', priority: 97,
    hint: 'Critias 113c–121c visualized: the rings of land and sea, the canal from the sea, bridges and tunnels, harbours with triremes, the hot and cold springs, the walls clad in bronze, tin and orichalcum, the temple of Poseidon and Cleito — cards quote what Plato says; the story is tradition.',
    assets: ['the concentric ring city of Atlantis (top-down and aerial)', 'the orichalcum temple of Poseidon'] },
  { id: 'sais-neith', minutes: 10, name: 'Saïs and the Priests of Neith', region: 'nile', peoples: 'egyptian', priority: 96,
    hint: 'Saïs in the western Delta, the temple of Neith and its priests; Herodotus on Saïs; the 26th (Saite) Dynasty; Udjahorresnet; Solon\'s visit as told by Plato and Plutarch (tradition); the sourced character briefs for Sonchis and a priestess of Neith.',
    assets: ['the temple of Neith at Saïs'] },
  { id: 'watchers', minutes: 30, name: 'The Watchers: the Book of Enoch', region: 'levant', peoples: 'levantine', priority: 95,
    hint: '1 Enoch 1–36 (the Book of the Watchers), R. H. Charles 1917 translation — cards cite chapter:verse; the story is tradition, the text\'s preservation is record. The 200 Watchers descending on Mount Hermon in the days of Jared; the oath of Semjaza (Shemihazah); Azazel teaching metalwork, weapons and cosmetics, the others enchantments, roots and astrology; the giants (Nephilim) born to them and their devouring; the cry of the earth; Gabriel, Michael, Raphael and Uriel; Azazel bound in Dudael (the Enochic desert, not the MELEK surface); Enoch as scribe interceding; his journeys to the ends of the earth, the mountains of fire, the prison of the stars, the hollows of Sheol, the tree of life — anchored at Mount Hermon and Dan where the text gives places. Record: preserved whole only in Ge\'ez in the Ethiopian Orthodox canon; Aramaic fragments at Qumran.',
    assets: ['the Watchers — tall luminous beings, not modern haloed angels', 'Enoch the scribe', 'Mount Hermon', 'the four archangels Michael, Gabriel, Raphael and Uriel', 'the giants of Enoch', 'the darkness of Dudael', 'the gates of heaven'] },
  { id: 'hermon-watchers', minutes: 10, name: 'Mount Hermon and the Descent of the Watchers', region: 'levant', peoples: 'levantine', priority: 94,
    hint: '1 Enoch 6–8 (Charles 1917): the descent on Mount Hermon in the days of Jared and the oath; Hermon as a real mountain (its sanctuaries, Qasr Antar); cards cite chapter:verse; tradition vs record.',
    assets: ['Mount Hermon', 'the Watchers — tall luminous beings, not modern haloed angels'] },
  { id: 'giants-of-enoch', minutes: 10, name: 'The Giants of Enoch', region: 'levant', peoples: 'levantine', priority: 93,
    hint: 'Genesis 6:1–4; 1 Enoch 7 and 15–16 (Charles 1917); the Book of Giants fragments from Qumran (label as fragmentary: Ohyah, Hahyah, the dreams); ties to the Giants film. Tradition vs record.',
    assets: ['the giants of Enoch'] },
  { id: 'enoch-journeys', minutes: 10, name: 'Enoch\'s Heavenly Journeys', region: 'levant', peoples: 'levantine', priority: 92,
    hint: '1 Enoch 17–36 and the Astronomical Book 72–82 (Charles 1917): the gates of the sun and moon, the winds, the ends of the earth — visualized exactly as the text describes; cite chapter:verse; the Ethiopian (Ge\'ez) transmission as record, linking to the Kush and Aksum films.',
    assets: ['the gates of heaven', 'the gates of the sun and moon'] },
  { id: 'left-habitation', minutes: 30, name: 'Those Who Left Their Habitation', region: 'levant', peoples: 'levantine', priority: 91,
    hint: 'TEXT-ACCURATE: cite chapter:verse on every card (R. H. Charles 1 Enoch 1917; KJV/ASV). 1 Enoch 6 (the 200 descend on Hermon in the days of Jared; Shemihazah\'s oath) · 7 (the wives, the giants, the devouring) · 8 (Azazel: metals, weapons, ornaments; the others: enchantments, roots, astrology, signs) · 9 (Michael, Uriel, Raphael and Gabriel bring the earth\'s cry before heaven) · 10 (Uriel sent to Noah; Raphael binds Azazel in Dudael under rough stones; Gabriel against the giants; Michael binds Shemihazah and the rest for seventy generations in the valleys of the earth till the day of their judgment; the Flood) — interleaved with Genesis 4 (Cain\'s line, Lamech, Tubal-cain the smith, Jubal, Jabal), Genesis 6:1–4 (sons of God, daughters of men, the Nephilim, mighty men of old) and 6:5–8:22 (the Flood); closing on Jude 6 and 2 Peter 2:4 (Tartarus). All tagged tradition; the manuscripts are the record.',
    assets: ['the four archangels Michael, Gabriel, Raphael and Uriel', 'the Watchers — tall luminous beings', 'chained Watchers in the dark abyss', 'Noah and the ark', 'Tubal-cain\'s forge', 'Mount Hermon'] },
  { id: 'petition-watchers', minutes: 10, name: 'The Petition of the Watchers', region: 'levant', peoples: 'levantine', priority: 90,
    hint: 'TEXT-ACCURATE (Charles 1917, cite chapter:verse): 1 Enoch 12–16 — Enoch sent to the Watchers, writes their petition, reads it by the waters of Dan southwest of Hermon (a real place: Tel Dan and the springs of the Jordan), the vision of the heavenly house, the answer "you will have no peace" (16:4). Tradition vs record.',
    assets: ['Enoch the scribe', 'the waters of Dan', 'the heavenly house of fire and crystal'] },
  { id: 'demons-origin', minutes: 10, name: 'Where the Demons Came From', region: 'levant', peoples: 'levantine', priority: 89,
    hint: 'TEXT-ACCURATE (Charles 1917, cite chapter:verse): 1 Enoch 15:8–12 — the spirits that go out from the bodies of the giants become evil spirits on the earth; they afflict, oppress and destroy, and they shall not eat nor thirst. Visualize as disembodied spirits rising from fallen giants — never horned devils. Tie to 1 Enoch 16:1 and Jubilees 10 (tradition).',
    assets: ['disembodied giant-spirits rising from fallen giants'] },
  { id: 'first-temples', minutes: 30, name: 'Before the Pyramids: The First Temples', region: 'anatolia', peoples: '', priority: 88,
    hint: 'Archaeology is the record — cite the excavation/site on each card, give published date ranges, mark finding vs interpretation. Göbekli Tepe (c. 9600–8200 BC; T-shaped pillars with carved animals, the enclosures, built by hunter-gatherers; the "temple before the city" debate and the newer evidence of dwellings); Karahan Tepe and the Taş Tepeler sites (carved heads, the rock-cut chamber); Nevalı Çori; Çatalhöyük (shrines, bull horns, wall paintings, the "mother goddess" figurines and the debate); the Maltese temples (Ġgantija, Ħaġar Qim, Mnajdra and their solstice alignments; the Hypogeum of Ħal Saflieni; the Sleeping Lady); Newgrange (the winter-solstice roof-box, c. 3200 BC); Stonehenge\'s phases; Carnac\'s alignments; the Ness of Brodgar on Orkney; the Cucuteni–Trypillia temple models. Recreate moving the pillars, carving, gatherings, solstice light entering chambers — era-appropriate Neolithic people only.',
    assets: ['T-shaped pillars with fox, boar, vulture and scorpion reliefs', 'the Vulture Stone (Göbekli Tepe Pillar 43)', 'Neolithic builders and ritual figures', 'a Maltese temple interior', 'the Newgrange roof-box and the solstice light'] },
  { id: 'gobekli-tepe', minutes: 10, name: 'Göbekli Tepe', region: 'anatolia', peoples: '', priority: 87,
    hint: 'Göbekli Tepe (German Archaeological Institute excavations, Schmidt; the enclosures A–D; c. 9600–8200 BC): the T-pillars as stylized beings, the animal reliefs, the Vulture Stone (Pillar 43) and its interpretations, the backfilling, the new dwelling evidence. Finding vs interpretation on every card.',
    assets: ['T-shaped pillars with fox, boar, vulture and scorpion reliefs', 'the Vulture Stone (Göbekli Tepe Pillar 43)', 'Neolithic builders and ritual figures'] },
  { id: 'temples-of-malta', minutes: 10, name: 'The Temples of Malta', region: 'mediterranean', peoples: '', priority: 86,
    hint: 'Ġgantija, Ħaġar Qim, Mnajdra (UNESCO; c. 3600–2500 BC), the Hypogeum of Ħal Saflieni, the Sleeping Lady; the solstice and equinox alignments at Mnajdra (record); Ġgantija = "giants\' tower" in Maltese folklore, where a giantess built it (tradition card — links to Giants in the Old Stories).',
    assets: ['a Maltese temple interior', 'the Sleeping Lady of the Hypogeum'] },
  { id: 'solstice-tombs', minutes: 10, name: 'Solstice Tombs: Newgrange to Maeshowe', region: 'europe', peoples: 'pale', priority: 85,
    hint: 'Newgrange (c. 3200 BC; the roof-box and the winter-solstice sunrise — record), Knowth, Dowth, Maeshowe on Orkney (the solstice sunset), the Ness of Brodgar; Stonehenge\'s solstice axis; later Irish tradition (Brú na Bóinne as the home of the Dagda and Aengus) as tradition cards.',
    assets: ['the Newgrange roof-box and the solstice light', 'Maeshowe passage at the winter solstice'] },
];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

/** The whole month: must-haves, civ×facet 10-min films, 30-min civilization overviews and themes, 60-min grand themes,
 *  plus one 10-min film per remakes group and per animated map. Each entry: { docId, key, name, hint, region, peoples,
 *  minutes, priority, arm } — `arm` is what feedback re-prioritises on (civilization or theme id). */
export function buildQueue({ remakeGroups = [], maps = [] } = {}) {
  const q = [];
  const add = (e) => { if (!q.some((x) => x.docId === e.docId)) q.push(e); };
  for (const m of MUST_HAVE) add({ docId: m.minutes === 10 ? m.id : `${m.id}-${m.minutes}`, key: m.id, name: m.name, hint: m.hint, region: m.region, peoples: m.peoples, minutes: m.minutes, priority: m.priority, arm: m.id, assets: m.assets });
  for (const c of CIVILIZATIONS) for (const f of FACETS) add({ docId: `${c.id}-${f.id}`, key: `${c.id}-${f.id}`, name: `${f.name}: ${c.name}`, hint: `${c.name} — ${f.hint}`, region: c.region, peoples: c.peoples, minutes: 10, priority: 50, arm: c.id });
  for (const t of THEMES) add({ docId: t.id, key: t.id, name: t.name, hint: t.hint, region: t.region, peoples: t.peoples, minutes: 10, priority: 60, arm: t.id });
  for (const g of remakeGroups) add({ docId: `scenes-${slug(g)}`, key: `scenes-${slug(g)}`, name: `${g}: Scenes Remade`, hint: `the scenes in the remakes gallery group "${g}" — what they show and where they come from`, region: '', peoples: '', minutes: 10, priority: 45, arm: `group:${slug(g)}` });
  for (const m of maps) add({ docId: `map-${slug(m.id)}`, key: `map-${slug(m.id)}`, name: `${m.title}: the Rise and Fall`, hint: `${m.title} ${m.subtitle || ''} — open on the animated map, then the peoples and places`, region: '', peoples: '', minutes: 10, priority: 45, arm: `map:${slug(m.id)}` });
  for (const c of CIVILIZATIONS) add({ docId: `${c.id}-30`, key: c.id, name: `${c.name}: an Overview`, hint: `${c.name} from beginning to end — places, people, gods, monuments, how it ended`, region: c.region, peoples: c.peoples, minutes: 30, priority: 40, arm: c.id });
  for (const t of THEMES) add({ docId: `${t.id}-30`, key: t.id, name: t.name, hint: t.hint, region: t.region, peoples: t.peoples, minutes: 30, priority: 38, arm: t.id });
  for (const t of THEMES.filter((x) => ['giants', 'table-of-nations', 'flood-stories', 'sacred-mountains', 'rivers', 'lost-cities', 'queens', 'writing', 'temples', 'trade-routes'].includes(x.id))) add({ docId: `${t.id}-60`, key: t.id, name: `${t.name}: the Long Film`, hint: t.hint, region: t.region, peoples: t.peoples, minutes: 60, priority: 30, arm: t.id });
  for (const c of CIVILIZATIONS.slice(0, 8)) add({ docId: `${c.id}-60`, key: c.id, name: `${c.name}: the Long Film`, hint: `${c.name} in depth`, region: c.region, peoples: c.peoples, minutes: 60, priority: 28, arm: c.id });
  return q;
}

/** Thompson-sampled order over arms from /documentaries/feedback.json (films → up/down), skipping arms with a clear
 *  thumbs-down pattern; 60-min films wait until a 30-min film has been published. */
export function prioritise(queue, { feedback = {}, published = new Set(), docArms = {}, rng = Math.random } = {}) {
  const arms = {};
  for (const [docId, f] of Object.entries((feedback && feedback.films) || {})) { const a = docArms[docId]; if (!a) continue; (arms[a] ||= { up: 0, down: 0 }); arms[a].up += f.up || 0; arms[a].down += f.down || 0; }
  const beta = (a, b) => { const g = (k) => { let x = 0; for (let i = 0; i < k; i++) x -= Math.log(rng()); return x; }; const x = g(a); return x / (x + g(b)); };
  const has30 = [...published].some((id) => /-30$/.test(id));
  const disliked = (a) => a && a.down >= 3 && a.down > 2 * a.up;
  return queue
    .filter((e) => !published.has(e.docId) && !disliked(arms[e.arm]) && (e.minutes !== 60 || has30))
    .map((e) => { const a = arms[e.arm] || { up: 0, down: 0 }; return { e, s: e.priority + 20 * beta(1 + Math.min(50, a.up), 1 + Math.min(50, a.down)) }; })
    .sort((x, y) => y.s - x.s).map((x) => x.e);
}

const TAGS = new Set(['record', 'tradition', 'interpretation']);
/** Validate + normalise an LLM topic definition into topics.mjs shape. Returns the topic or null. */
export function validateTopic(t, entry) {
  if (!t || typeof t !== 'object' || !Array.isArray(t.facts) || !Array.isArray(t.outline)) return null;
  const facts = t.facts.filter((f) => f && f.id && TAGS.has(f.tag) && f.source && f.text).slice(0, 60)
    .map((f, i) => ({ id: slug(f.id) || `f${i}`, tag: f.tag, source: String(f.source).slice(0, 160), text: String(f.text).slice(0, 400), card: f.card ? String(f.card).slice(0, 90) : undefined, visual: f.visual ? String(f.visual).slice(0, 300) : undefined }));
  if (facts.length < 6) return null;
  const ids = new Set(facts.map((f) => f.id));
  let outline = t.outline.filter((o) => o && o.title).slice(0, 14).map((o) => ({ title: String(o.title).slice(0, 80), goal: String(o.goal || '').slice(0, 200), minutes: +o.minutes || 0, facts: (o.facts || []).map(slug).filter((x) => ids.has(x)) }))
    .filter((o) => o.facts.length);
  if (outline.length < 2) return null;
  const total = outline.reduce((n, o) => n + (o.minutes > 0 ? o.minutes : 0), 0) || outline.length;
  outline = outline.map((o) => ({ ...o, minutes: +(((o.minutes > 0 ? o.minutes : 1) / total) * entry.minutes).toFixed(2) }));
  return { id: entry.docId, era: 'ancient', region: entry.region || '', peoples: entry.peoples || '', title: String(t.title || entry.name).slice(0, 120), summary: String(t.summary || '').slice(0, 400), facts, outline, generated: true, arm: entry.arm };
}

export function topicPrompt(entry) {
  const seqs = Math.max(3, Math.min(12, Math.round(entry.minutes / 2.5)));
  return {
    system: 'You are a careful historian preparing the fact sheet for a wordless educational documentary. Never invent sources. Every fact names a real primary text, inscription, excavation, museum object or classical author. Scripture and myth are tagged "tradition" and never stated as historical fact.',
    prompt: `Documentary: "${entry.name}" (${entry.minutes} minutes).
Focus: ${entry.hint}
Return ONLY JSON: {"title":"…","summary":"one or two sentences","facts":[{"id":"short-kebab-id","tag":"record|tradition|interpretation","source":"named source","text":"one factual sentence","card":"on-screen card, max 70 chars","visual":"what the viewer sees: a concrete scene with people, place, era"}],"outline":[{"title":"…","goal":"what the viewer learns","minutes":N,"facts":["fact ids"]}]}
Give ${Math.max(10, seqs * 3)}–${Math.max(16, seqs * 5)} facts and ${seqs} outline sequences whose minutes sum to ${entry.minutes}. Visuals must fit the era — nothing modern.`,
  };
}

/** entry → validated topic definition (or null). llm(prompt, opts) → { text }. Two attempts. */
export async function defineTopic(entry, llm) {
  const { system, prompt } = topicPrompt(entry);
  for (let i = 0; i < 2; i++) {
    const r = await llm(prompt, { system, maxTokens: 8000, temperature: 0.3 });
    const m = /\{[\s\S]*\}/.exec((r && r.text) || '');
    let parsed = null; try { parsed = JSON.parse(m ? m[0] : ''); } catch {}
    const t = validateTopic(parsed, entry);
    if (t) return t;
  }
  return null;
}
