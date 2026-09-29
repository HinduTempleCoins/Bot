// topics-wave1.mjs — fact sheets for the first wave of wordless films: topics our existing parts (remakes, library,
// animations) actually cover, so they can be built reuse-only. Same rules as topics.mjs: every fact tagged record /
// tradition / interpretation with its source; `card` = short on-screen wording; `visual` = what the scene shows.
// Mythic scenes (gods at real places, spirits, giants) are shown as belief — the card says so.

const T = (id, tag, source, text, card, visual) => ({ id, tag, source, text, card, visual });

export const WAVE1 = {
  'tomb-life': {
    era: 'ancient', region: 'nile',
    title: 'Living with the Dead: Egyptian Tomb Life', peoples: 'egyptian',
    summary: 'Inside the painted tombs of Thebes — banquets, fishing, harvests and the journey of the soul, as the Egyptians painted them for eternity.',
    facts: [
      T('theban', 'record', 'Theban Necropolis (UNESCO World Heritage Site)', 'Officials of the New Kingdom were buried in painted rock-cut tombs on the west bank at Thebes.', 'Thebes, west bank of the Nile, c. 1400 BC', 'sunset over the cliffs of the Theban west bank, tomb doorways cut into the rock, a funeral procession'),
      T('nebamun', 'record', 'Tomb of Nebamun, British Museum', 'The tomb of Nebamun shows banquets, music and a marsh hunt.', 'Nebamun hunts in the marshes — as his tomb painted it', 'a nobleman hunting birds in papyrus marshes with a throw-stick, his wife and daughter beside him, a cat among the reeds'),
      T('headcones', 'record', 'Theban tomb paintings', 'Banquet guests are painted wearing cones on their heads, which scholars read as perfumed wax.', 'Why did the guests wear cones on their heads?', 'banquet guests with perfumed wax cones on their heads, musicians playing harp and lute, lotus flowers'),
      T('dem', 'record', 'Deir el-Medina excavations', 'The artisans who cut and painted the royal tombs lived in the village of Deir el-Medina.', 'Deir el-Medina — the village of the tomb builders', 'a walled village of mud-brick houses in a desert valley, artisans returning at dusk with tools'),
      T('bod', 'record', 'Papyrus of Hunefer, British Museum', 'The Book of the Dead shows the heart weighed against the feather of Maat before Osiris.', 'The weighing of the heart — as the Book of the Dead shows it', 'the heart weighed against a feather on a great scale, jackal-headed Anubis at the balance, ibis-headed Thoth writing'),
      T('opening', 'record', 'Tomb paintings and the Book of the Dead', 'Priests performed the Opening of the Mouth so the dead could eat, speak and breathe again.', 'The Opening of the Mouth', 'priests in leopard skins touching an adze to the mouth of a mummy standing upright before a tomb, mourners wailing'),
    ],
    outline: [
      { title: 'The West Bank', card: 'Thebes, c. 1400 BC', minutes: 2.5, goal: 'Where and why the tombs were painted.', facts: ['theban', 'dem'] },
      { title: 'The Banquet', card: 'A feast for eternity', minutes: 2.5, goal: 'The painted life the dead hoped to keep.', facts: ['nebamun', 'headcones'] },
      { title: 'The Judgement', card: 'Before Osiris', minutes: 2.5, goal: 'What the Egyptians believed happened after death.', facts: ['bod'] },
      { title: 'The Opening of the Mouth', card: 'So the dead could breathe', minutes: 2.5, goal: 'The rites at the tomb door.', facts: ['opening'] },
    ],
  },
  'nile-gods': {
    era: 'ancient', region: 'nile',
    title: 'The Nile\'s Gods in Real Places', peoples: 'egyptian',
    summary: 'For the Egyptians the gods lived at real places on the river — the flood at Elephantine, Isis at Philae, the crocodile god at Kom Ombo. A journey down the Nile through the spirit world as they saw it.',
    facts: [
      T('hapi', 'record', 'Egyptian religious texts', 'The yearly flood was personified as the god Hapi.', 'They saw the flood as the god Hapi', 'the Nile in flood over green fields at sunset, a faint giant figure of the river god Hapi in the mist above the water'),
      T('khnum', 'record', 'Famine Stela, Sehel Island', 'At Elephantine, the ram-headed Khnum was believed to control the flood from caverns beneath the First Cataract.', 'Elephantine — where they believed Khnum released the flood', 'granite rapids of the First Cataract at dawn, a ram-headed god faintly visible in the rock caverns below the water'),
      T('philae', 'record', 'Philae (UNESCO World Heritage Site)', 'The island temple of Philae was a great sanctuary of Isis, among the last places where the old gods were worshipped.', 'Philae — the island of Isis', 'the temple of Isis on the island of Philae reflected in the Nile, pilgrims arriving by boat, a winged goddess in the evening light'),
      T('komombo', 'record', 'Temple of Kom Ombo', 'Kom Ombo was a double temple of the crocodile god Sobek and the falcon god Haroeris; mummified crocodiles were buried there.', 'Kom Ombo — the crocodile god Sobek', 'a temple on a bend of the Nile with crocodiles basking below, a priest feeding a sacred crocodile, the crocodile-headed god Sobek above the water'),
      T('osiris', 'tradition', 'Plutarch, On Isis and Osiris', 'In the Osiris myth, Isis gathered the scattered body of Osiris; later writers tied the flood to her tears.', 'The myth: the flood came from the tears of Isis', 'a grieving goddess on the riverbank at night, her tears falling into the Nile, the water rising under the moon'),
    ],
    outline: [
      { title: 'The Flood', card: 'The Nile — where the gods lived', minutes: 2.5, goal: 'The flood as a god.', facts: ['hapi', 'osiris'] },
      { title: 'Elephantine', card: 'The First Cataract', minutes: 2.5, goal: 'The god of the source.', facts: ['khnum'] },
      { title: 'Philae', card: 'Philae, c. 300 BC–AD 500', minutes: 2.5, goal: 'The island of Isis.', facts: ['philae'] },
      { title: 'Kom Ombo', card: 'Kom Ombo', minutes: 2.5, goal: 'The crocodile god.', facts: ['komombo'] },
    ],
  },
  minoans: {
    era: 'ancient', region: 'aegean',
    title: 'Minoan Crete: The Palace of the Bull', peoples: 'minoan',
    summary: 'Knossos, the bull-leapers, the saffron gatherers of Thera, and the myth of the Minotaur — Bronze Age Crete in slow recreation.',
    facts: [
      T('knossos', 'record', 'Excavations at Knossos (Evans)', 'The palace of Knossos was the largest centre of Minoan Crete in the Bronze Age.', 'Knossos, Crete, c. 1600 BC', 'the many-storeyed red-columned palace of Knossos on a hill at dawn, olive groves, people climbing a grand staircase'),
      T('bull', 'record', 'Bull-leaping fresco, Heraklion Archaeological Museum', 'Frescoes show young men and women leaping over charging bulls.', 'How did they leap the bull?', 'an athlete somersaulting over the back of a charging bull in a palace courtyard, another catching them, crowds on balconies'),
      T('saffron', 'record', 'Akrotiri frescoes, Thera', 'At Akrotiri on Thera, frescoes show women gathering saffron crocus.', 'Akrotiri, Thera — the saffron gatherers', 'young women gathering purple crocus flowers on a rocky hillside above the sea, baskets of saffron'),
      T('keftiu', 'record', 'Tomb of Rekhmire, Thebes', 'Egyptian tombs show envoys from Keftiu — usually identified as Crete — bringing gifts to Egypt.', 'Keftiu — Cretans in the tombs of Egypt', 'Cretan envoys with long dark hair carrying painted vessels and ingots in a procession before an Egyptian official'),
      T('minotaur', 'tradition', 'Apollodorus, Library 3.15; Plutarch, Theseus', 'Greek myth told of the Minotaur, half man and half bull, kept in a labyrinth at Knossos by King Minos.', 'The myth: the Minotaur in the labyrinth', 'a shadowy half-bull half-man figure in the corridors of a vast stone labyrinth lit by torches'),
      T('thera', 'record', 'Thera (Santorini) eruption studies', 'A huge volcanic eruption buried Akrotiri in the second millennium BC.', 'Thera erupts', 'a colossal volcanic ash cloud rising over an island in the Aegean, a town below, ships fleeing'),
    ],
    outline: [
      { title: 'Knossos', card: 'Knossos, c. 1600 BC', minutes: 2.5, goal: 'The palace.', facts: ['knossos', 'minotaur'] },
      { title: 'The Bull', card: 'The bull-leapers', minutes: 2.5, goal: 'Ritual and sport.', facts: ['bull'] },
      { title: 'Thera', card: 'Akrotiri, Thera', minutes: 2.5, goal: 'The island town and its fate.', facts: ['saffron', 'thera'] },
      { title: 'Keftiu', card: 'Crete and Egypt', minutes: 2.5, goal: 'Minoans abroad.', facts: ['keftiu'] },
    ],
  },
  carthage: {
    era: 'ancient', region: 'levant-punic',
    title: 'Carthage and the Phoenicians', peoples: 'punic',
    summary: 'From the purple-dye cities of Phoenicia to Carthage, its round harbour, its goddess Tanit and its war with Rome.',
    facts: [
      T('tyre', 'record', 'Phoenician city archaeology (Tyre, Sidon)', 'Phoenician cities such as Tyre and Sidon were famed for seafaring and purple dye.', 'Tyre and Sidon — the purple cities', 'a Phoenician harbour city on the Levant coast, ships with curved prows, workers dyeing cloth purple in great vats'),
      T('founding', 'tradition', 'Justin, Epitome of Pompeius Trogus 18.4–6', 'Tradition says Carthage was founded by Elissa (Dido), a princess of Tyre.', 'The tradition: Elissa of Tyre founds Carthage', 'a queen arriving by ship on the North African shore, her people unloading, a hill above the bay'),
      T('cothon', 'record', 'Excavations at Carthage (UNESCO World Heritage Site)', 'Carthage had a circular military harbour, the cothon, with ship sheds around an island.', 'Carthage, c. 200 BC — the round harbour', 'a circular harbour ringed with ship sheds and an island command tower, warships drawn up, the city behind'),
      T('tanit', 'record', 'Punic stelae', 'Punic stelae carry the sign of the goddess Tanit.', 'Tanit — the sign on the stones', 'rows of carved Punic stone stelae with the triangle-and-disc sign of Tanit, lamplight, a priestess'),
      T('hannibal', 'record', 'Polybius, Histories 3', 'In 218 BC Hannibal led an army with elephants across the Alps into Italy.', '218 BC — Hannibal crosses the Alps', 'an army with war elephants struggling through snowy Alpine passes, soldiers in cloaks'),
      T('fall', 'record', 'Polybius; Appian, Punic Wars', 'Rome destroyed Carthage in 146 BC.', '146 BC — Carthage falls', 'a burning city by the sea at night, Roman soldiers on the walls, smoke over the harbour'),
    ],
    outline: [
      { title: 'Phoenicia', card: 'The Levant coast, c. 900 BC', minutes: 2.5, goal: 'Where the Phoenicians came from.', facts: ['tyre', 'founding'] },
      { title: 'Carthage', card: 'Carthage, North Africa', minutes: 2.5, goal: 'The city and its harbour.', facts: ['cothon', 'tanit'] },
      { title: 'Hannibal', card: 'The war with Rome', minutes: 2.5, goal: 'The march on Italy.', facts: ['hannibal'] },
      { title: 'The Fall', card: '146 BC', minutes: 2.5, goal: 'The end of Carthage.', facts: ['fall'] },
    ],
  },
  amazigh: {
    era: 'ancient', region: 'maghreb-sahara',
    title: 'The Amazigh and the Queen of the Hoggar', peoples: 'libyan',
    summary: 'The Amazigh of North Africa — the Garamantes of the desert, the Tifinagh script, the rock art of Tassili, and the tomb of Tin Hinan, remembered as the mother of the Tuareg.',
    facts: [
      T('tassili', 'record', "Tassili n'Ajjer (UNESCO World Heritage Site)", "The rock art of Tassili n'Ajjer records herders, cattle and dancers from a greener Sahara.", "Tassili n'Ajjer — when the Sahara was green", 'painted figures and cattle on sandstone rock shelters in the Sahara, herders and dancers, a green valley long ago'),
      T('garamantes', 'record', 'Herodotus, Histories 4.183; excavations at Germa', 'The Garamantes built a desert kingdom in the Fezzan with underground water channels.', 'The Garamantes of the Fezzan', 'desert oasis town with mud-brick walls, chariots, workers digging underground water channels'),
      T('tifinagh', 'record', 'Libyco-Berber inscriptions', 'The Amazigh wrote in the Libyco-Berber script, ancestor of Tifinagh.', 'Tifinagh — an old African alphabet', 'a woman writing geometric Tifinagh letters on a rock face by firelight, desert night'),
      T('tinhinan', 'record', 'Tomb of Tin Hinan, Abalessa (excavated 1925)', 'At Abalessa in the Hoggar, a woman was buried with gold and silver bracelets in a stone tomb.', 'Abalessa, Hoggar — the tomb of Tin Hinan', 'a stone tomb on a hill in the Hoggar mountains, a noblewoman laid to rest with gold bracelets'),
      T('queen', 'tradition', 'Tuareg oral tradition', 'Tuareg tradition remembers Tin Hinan as the queen and ancestral mother of the Tuareg.', 'The tradition: Tin Hinan, mother of the Tuareg', 'a veiled desert queen on a camel leading a caravan across the Hoggar at sunset'),
      T('tattoos', 'record', 'Ethnographic records of Amazigh tattoos (Bates 1914)', 'Amazigh women traditionally wore geometric facial tattoos.', 'The marks on the face', 'an Amazigh woman with geometric chin and forehead tattoos, silver jewellery, soft window light'),
    ],
    outline: [
      { title: 'The Green Sahara', card: 'The Sahara, long ago', minutes: 2.5, goal: 'The rock art.', facts: ['tassili'] },
      { title: 'The Garamantes', card: 'The Fezzan, c. 500 BC', minutes: 2.5, goal: 'A desert kingdom.', facts: ['garamantes', 'tifinagh'] },
      { title: 'Tin Hinan', card: 'The Hoggar mountains', minutes: 2.5, goal: 'The tomb and the queen.', facts: ['tinhinan', 'queen'] },
      { title: 'The Marks', card: 'Amazigh women', minutes: 2.5, goal: 'Tattoos and identity.', facts: ['tattoos'] },
    ],
  },
  delphi: {
    era: 'ancient', region: 'aegean',
    title: 'Delphi and the Oracle', peoples: 'greek',
    summary: 'The navel of the world: the Pythia on her tripod, the Castalian spring, and the pilgrims who climbed the mountain to ask Apollo.',
    facts: [
      T('site', 'record', 'Delphi (UNESCO World Heritage Site)', 'Delphi, on the slopes of Mount Parnassus, held the sanctuary of Apollo.', 'Delphi, Mount Parnassus', 'a temple of Apollo on a steep mountainside above an olive valley, pilgrims climbing a sacred way at dawn'),
      T('omphalos', 'tradition', 'Pindar; Strabo, Geography 9.3.6', 'Greek myth said Zeus released two eagles that met at Delphi, the navel of the world, marked by the omphalos stone.', 'The myth: the navel of the world', 'two eagles meeting in the sky above a carved stone omphalos in a temple, golden light'),
      T('pythia', 'record', 'Plutarch, Moralia (The Oracles at Delphi)', 'The priestess, the Pythia, sat on a tripod and gave the god\'s answers.', 'The Pythia on the tripod', 'a veiled priestess seated on a tall bronze tripod in a dim temple chamber, vapours, laurel, a pilgrim kneeling'),
      T('castalia', 'record', 'Pausanias, Description of Greece 10.8', 'Pilgrims purified themselves at the Castalian spring.', 'The Castalian spring', 'a spring flowing from a cleft in the rock under plane trees, pilgrims washing, moonlight'),
      T('gnothi', 'record', 'Pausanias, Description of Greece 10.24', 'Pausanias records the maxim "Know thyself" inscribed at the temple.', '"Know thyself" — on the temple wall', 'Greek letters carved on a temple wall catching the light, a pilgrim reading them'),
    ],
    outline: [
      { title: 'The Mountain', card: 'Delphi, c. 500 BC', minutes: 2.5, goal: 'The sanctuary.', facts: ['site', 'omphalos'] },
      { title: 'The Spring', card: 'Purification', minutes: 2.5, goal: 'The pilgrims.', facts: ['castalia'] },
      { title: 'The Pythia', card: 'The oracle', minutes: 2.5, goal: 'How the oracle spoke.', facts: ['pythia'] },
      { title: 'Know Thyself', card: 'The maxims', minutes: 2.5, goal: 'What Delphi left us.', facts: ['gnothi'] },
    ],
  },
  fayum: {
    era: 'ancient', region: 'nile',
    title: 'Faces of Roman Egypt: the Fayum Portraits', peoples: 'egyptian',
    summary: 'Painted faces laid over mummies in Roman Egypt — real people, looking back at us across two thousand years.',
    facts: [
      T('fayum', 'record', 'Fayum mummy portraits (British Museum; Metropolitan Museum)', 'In Roman Egypt, portraits painted on wood were laid over the faces of mummies.', 'The Fayum, Roman Egypt, c. AD 100', 'a painted wooden portrait of a young woman with dark eyes laid into mummy wrappings, lamplight'),
      T('encaustic', 'record', 'Fayum mummy portraits (British Museum; Metropolitan Museum)', 'Many were painted in encaustic, pigment mixed with hot wax.', 'Painted in hot wax', 'an artist painting a portrait with hot coloured wax on a wooden panel, brazier glowing'),
      T('people', 'record', 'Fayum mummy portraits (British Museum; Metropolitan Museum)', 'They show the mixed people of Roman Egypt — Egyptian, Greek and others — in the fashions of their day.', 'Who were they?', 'a gallery of lifelike faces of men, women and children of Roman Egypt, jewellery and wreaths, looking at the viewer'),
      T('burial', 'record', 'Hawara excavations (Petrie)', 'At Hawara, Flinders Petrie found many portrait mummies.', 'Hawara', 'an archaeologist uncovering a portrait mummy in desert sand, the painted face emerging'),
    ],
    outline: [
      { title: 'The Faces', card: 'Roman Egypt, c. AD 100', minutes: 3.5, goal: 'What the portraits are.', facts: ['fayum', 'people'] },
      { title: 'The Painters', card: 'Encaustic', minutes: 3, goal: 'How they were made.', facts: ['encaustic'] },
      { title: 'Found Again', card: 'Hawara', minutes: 3.5, goal: 'Their rediscovery.', facts: ['burial'] },
    ],
  },
  perfume: {
    era: 'ancient', region: 'nile',
    title: 'The Perfumed Banquet', peoples: 'egyptian',
    summary: 'Lotus, kyphi and perfumed wax — the scents of Egyptian feasts and temples, as the tomb paintings show them.',
    facts: [
      T('lotus', 'record', 'Theban tomb paintings', 'Banquet guests are painted holding and smelling blue lotus flowers.', 'The blue lotus', 'banquet guests holding blue lotus flowers to their faces, musicians, soft lamplight'),
      T('press', 'record', 'Relief, Louvre E 11162', 'A relief shows women pressing lilies in a cloth to make perfume.', 'How was perfume made?', 'women twisting a cloth sack of white lilies between poles to press out perfume oil, jars below'),
      T('kyphi', 'record', 'Plutarch, On Isis and Osiris 80; temple recipes at Edfu', 'Kyphi was a temple incense of many ingredients, burned at evening.', 'Kyphi — the evening incense', 'a priest burning incense in a temple at dusk, smoke curling past carved columns'),
      T('cones', 'record', 'Theban tomb paintings', 'Guests wear cones on their heads, often read as perfumed wax.', 'The cones of wax', 'banquet guests with perfumed wax cones on their heads, servants pouring wine'),
    ],
    outline: [
      { title: 'The Lotus', card: 'Thebes, c. 1400 BC', minutes: 3.5, goal: 'Scent at the banquet.', facts: ['lotus', 'cones'] },
      { title: 'The Press', card: 'Making perfume', minutes: 3, goal: 'How perfume was made.', facts: ['press'] },
      { title: 'Kyphi', card: 'Temple incense', minutes: 3.5, goal: 'Scent for the gods.', facts: ['kyphi'] },
    ],
  },
  'four-peoples': {
    era: 'ancient', region: 'nile',
    title: 'The Four Peoples of the Egyptian World', peoples: 'depicted',
    summary: 'How the Egyptians painted the peoples of their world — Egyptians, Nubians, Libyans and Asiatics — and the envoys who came bearing gifts.',
    facts: [
      T('gates', 'record', 'Book of Gates, tomb of Seti I', 'The Book of Gates in Seti I\'s tomb shows four groups of people: Egyptians, Asiatics, Nubians and Libyans.', 'The Book of Gates — four peoples', 'four groups of people painted in procession in a royal tomb, each with distinct dress and hair, torchlight'),
      T('tribute', 'record', 'Tomb of Huy, Thebes', 'The tomb of Huy, Viceroy of Kush, shows Nubian princes bringing gold and exotic goods.', 'Nubian envoys bring gold', 'Nubian princes arriving by boat with gold rings, giraffe tails and a chariot, a viceroy receiving them'),
      T('aamu', 'record', 'Tomb of Khnumhotep II, Beni Hasan', 'The tomb of Khnumhotep II shows a caravan of Aamu (Asiatics) arriving in Egypt.', 'The Aamu arrive', 'a caravan of Asiatic travellers in patterned robes with donkeys and children arriving at an Egyptian official'),
      T('libyans', 'record', 'Egyptian temple reliefs', 'Libyans were painted with side-locks, feathers and tattoos.', 'The Libyans, as the Egyptians painted them', 'Libyan chiefs with feathers and side-locks and tattooed arms standing before a pharaoh'),
    ],
    outline: [
      { title: 'The Peoples', card: 'The world as Egypt saw it', minutes: 3, goal: 'The four groups.', facts: ['gates', 'libyans'] },
      { title: 'From the South', card: 'Nubia', minutes: 3.5, goal: 'The envoys of Kush.', facts: ['tribute'] },
      { title: 'From the East', card: 'The Levant', minutes: 3.5, goal: 'The travellers.', facts: ['aamu'] },
    ],
  },
  nefertiti: {
    era: 'ancient', region: 'nile',
    title: 'Nefertiti', peoples: 'egyptian',
    summary: 'The queen of Akhenaten\'s sun-city — her bust, her family under the rays of the Aten, and the mystery of her end.',
    facts: [
      T('bust', 'record', 'Bust of Nefertiti, Neues Museum Berlin', 'The painted bust of Nefertiti was found in the workshop of the sculptor Thutmose at Amarna in 1912.', 'The bust — found at Amarna in 1912', 'a sculptor\'s workshop at Amarna with a painted bust of a queen in a tall blue crown on a table, dust in the light'),
      T('amarna', 'record', 'Tell el-Amarna excavations', 'Akhenaten built a new capital, Akhetaten (Amarna), for the sun disk Aten.', 'Akhetaten (Amarna), c. 1345 BC', 'a new white city on the Nile with open-air temples to the sun, crowds, the sun blazing'),
      T('aten', 'record', 'Amarna reliefs', 'Reliefs show the royal family under the rays of the Aten, each ray ending in a hand.', 'Under the rays of the Aten', 'a royal couple and their daughters under a sun disk whose rays end in small hands, offering lotus'),
      T('end', 'record', 'Egyptological debate', 'What became of Nefertiti after Akhenaten\'s reign is still debated.', 'What became of her?', 'an empty palace at dusk, a queen\'s crown on a table, wind in the curtains'),
    ],
    outline: [
      { title: 'The Sun City', card: 'Amarna, c. 1345 BC', minutes: 3, goal: 'The new capital.', facts: ['amarna', 'aten'] },
      { title: 'The Queen', card: 'Nefertiti', minutes: 3.5, goal: 'Her image.', facts: ['bust'] },
      { title: 'The Mystery', card: 'Her end', minutes: 3.5, goal: 'The open question.', facts: ['end'] },
    ],
  },
  cleopatra: {
    era: 'ancient', region: 'nile',
    title: 'Cleopatra', peoples: 'egyptian',
    summary: 'The last ruler of Ptolemaic Egypt — Alexandria, the Pharos, Caesar and Antony, and the fall of the kingdom to Rome.',
    facts: [
      T('alexandria', 'record', 'Strabo, Geography 17.1', 'Cleopatra ruled from Alexandria, with its great lighthouse, the Pharos.', 'Alexandria, c. 50 BC', 'the harbour of Alexandria with the towering Pharos lighthouse, ships, a palace on the shore at sunset'),
      T('ptolemy', 'record', 'Plutarch, Life of Antony 27', 'Cleopatra VII was the last of the Ptolemies, a Macedonian dynasty, and Plutarch says she spoke many languages.', 'Cleopatra VII — last of the Ptolemies', 'a queen in a royal diadem receiving envoys in a marble hall, scribes and translators'),
      T('caesar', 'record', 'Plutarch, Life of Caesar 49', 'She allied with Julius Caesar, and later with Mark Antony.', 'Caesar, then Antony', 'a Roman general and an Egyptian queen on a royal barge on the Nile, torches'),
      T('actium', 'record', 'Plutarch, Life of Antony', 'After defeat at Actium in 31 BC, Antony and Cleopatra died, and Egypt became a Roman province in 30 BC.', '30 BC — Egypt becomes Roman', 'Roman legionaries entering a palace courtyard in Alexandria, an empty throne'),
    ],
    outline: [
      { title: 'Alexandria', card: 'Alexandria, c. 50 BC', minutes: 3, goal: 'Her city.', facts: ['alexandria', 'ptolemy'] },
      { title: 'Rome', card: 'Caesar and Antony', minutes: 3.5, goal: 'The alliances.', facts: ['caesar'] },
      { title: 'The End', card: '31–30 BC', minutes: 3.5, goal: 'The fall.', facts: ['actium'] },
    ],
  },
  hyperborea: {
    era: 'ancient', region: 'aegean',
    title: 'Hyperborea and Delos', peoples: 'greek',
    summary: 'The Greek tradition of the Hyperboreans beyond the north wind, the gifts they sent to Apollo\'s island of Delos, and the island itself.',
    facts: [
      T('herodotus', 'tradition', 'Herodotus, Histories 4.32–35', 'Herodotus tells of the Hyperboreans, a people beyond the north wind, who sent offerings wrapped in wheat straw to Delos.', 'The tradition: gifts from beyond the north wind', 'a procession carrying offerings wrapped in wheat straw across mountains toward the sea, cold northern light'),
      T('maidens', 'tradition', 'Herodotus, Histories 4.33–35', 'Herodotus says two Hyperborean maidens who came with the gifts were buried on Delos.', 'The maidens\' tomb on Delos', 'two young women laid to rest beneath an olive tree on a sacred island, islanders bringing locks of hair'),
      T('delos', 'record', 'Delos (UNESCO World Heritage Site)', 'Delos was the sanctuary where Apollo and Artemis were said to have been born.', 'Delos — Apollo\'s island', 'a small rocky island with marble temples and a terrace of stone lions by the sea, morning light'),
      T('lions', 'record', 'Terrace of the Lions, Delos', 'A row of marble lions guarded the Sacred Lake on Delos.', 'The Terrace of the Lions', 'a row of weathered marble lions facing a dry lake bed, wind, gulls'),
    ],
    outline: [
      { title: 'Beyond the North Wind', card: 'The Hyperboreans', minutes: 3.5, goal: 'The tradition.', facts: ['herodotus'] },
      { title: 'Delos', card: 'Delos, the Aegean', minutes: 3.5, goal: 'The island.', facts: ['delos', 'lions'] },
      { title: 'The Maidens', card: 'The tomb of the maidens', minutes: 3, goal: 'The story\'s end.', facts: ['maidens'] },
    ],
  },
  dendera: {
    era: 'ancient', region: 'nile',
    title: 'Hathor\'s Temple at Dendera', peoples: 'egyptian',
    summary: 'The great temple of the goddess Hathor at Dendera — its Hathor-headed columns, its star-filled ceilings and zodiac, and the festivals held on its roof.',
    facts: [
      T('temple', 'record', 'Temple of Dendera', 'The main temple of Hathor at Dendera was built in the Ptolemaic period and finished under Roman rule.', 'Dendera, c. 50 BC', 'a great stone temple with a wide façade of columns in the desert near the Nile at dawn, pilgrims approaching'),
      T('columns', 'record', 'Temple of Dendera', 'Its hypostyle hall is held up by columns crowned with the face of Hathor.', 'The columns of Hathor', 'a vast hall of columns topped with the serene face of the goddess Hathor, light falling through the roof'),
      T('zodiac', 'record', 'Dendera zodiac, Louvre', 'A carved zodiac from a roof chapel, now in the Louvre, maps the sky with Egyptian and Babylonian signs.', 'The Dendera zodiac', 'a circular carved stone ceiling of stars and zodiac figures held up by kneeling goddesses, lamplight'),
      T('newyear', 'record', 'Temple of Dendera (roof chapels)', 'At the New Year, the image of Hathor was carried to the roof to be touched by the sun.', 'At the New Year, they carried the goddess to the sun', 'priests carrying a shrine up a stone stair to a temple roof at sunrise, the sun touching the shrine'),
    ],
    outline: [
      { title: 'The Temple', card: 'Dendera', minutes: 3, goal: 'The sanctuary of Hathor.', facts: ['temple', 'columns'] },
      { title: 'The Sky', card: 'The ceilings', minutes: 3.5, goal: 'The zodiac.', facts: ['zodiac'] },
      { title: 'The Roof', card: 'The New Year', minutes: 3.5, goal: 'The festival.', facts: ['newyear'] },
    ],
  },
};
