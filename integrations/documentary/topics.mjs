// topics.mjs — grounded fact sheets for Hathor's documentaries. Every fact is tagged by what KIND of claim it is:
//   record          — historical/archaeological record (inscriptions, excavations, classical authors)
//   tradition       — scriptural or traditional account (Genesis, Josephus…), presented as tradition
//   interpretation  — the Van Kush Family Research Institute's own framework (knowledge/history/*.json), presented as
//                     the Institute's reading, never as established fact
// Scripts may only cite sources that appear here; the scorer checks that. Outlines give each chapter its learning goal
// and the facts it draws on.

import { WAVE1 } from './topics-wave1.mjs';

export const TOPICS = {
  'havilah-kush': {
    era: 'ancient', region: 'nile',
    title: 'Havilah and Kush, Before and After Noah',
    summary: 'Two lands named in Genesis before the Flood and again after it — and what archaeology knows about Kush on the Nile, from Kerma to the pharaohs of the 25th Dynasty and the queens of Meroë.',
    peoples: 'nubian',
    facts: [
      { id: 'eden-rivers', tag: 'tradition', source: 'Genesis 2:10–14', text: 'Genesis says a river went out of Eden and parted into four heads: the Pishon, the Gihon, the Tigris (Hiddekel) and the Euphrates.' },
      { id: 'pishon-havilah', tag: 'tradition', source: 'Genesis 2:11–12', text: 'The Pishon encompasses the whole land of Havilah, where there is gold — and the gold of that land is good — with bdellium and the onyx stone.' },
      { id: 'gihon-kush', tag: 'tradition', source: 'Genesis 2:13', text: 'The Gihon encompasses the whole land of Kush.' },
      { id: 'josephus-gihon', tag: 'tradition', source: 'Josephus, Antiquities of the Jews 1.1.3', text: 'Josephus identified the Gihon with the Nile and the Pishon with the Ganges.' },
      { id: 'table-ham', tag: 'tradition', source: 'Genesis 10:6', text: 'After the Flood, the Table of Nations lists the sons of Ham as Kush, Mizraim (Egypt), Put and Canaan.' },
      { id: 'table-kush-sons', tag: 'tradition', source: 'Genesis 10:7', text: 'The sons of Kush are Seba, Havilah, Sabtah, Raamah and Sabteca — so after the Flood, Havilah appears as a son of Kush.' },
      { id: 'table-nimrod', tag: 'tradition', source: 'Genesis 10:8–10', text: 'Kush fathered Nimrod, a mighty hunter, whose kingdom began with Babel, Erech, Akkad and Calneh in the land of Shinar.' },
      { id: 'table-havilah-joktan', tag: 'tradition', source: 'Genesis 10:29', text: 'A second Havilah appears among the sons of Joktan, in the line of Shem.' },
      { id: 'havilah-arabia', tag: 'tradition', source: 'Genesis 25:18; 1 Samuel 15:7', text: 'Later texts place Havilah on the route "from Havilah to Shur", which most scholars locate in Arabia.' },
      { id: 'vk-preflood', tag: 'interpretation', source: 'VKFRI, ancient_global_network.json', text: 'The Institute reads Kush and Put as lands that existed before the Flood, whose traditions continued after it.' },
      { id: 'vk-nimrod', tag: 'interpretation', source: 'VKFRI, ancient_global_network.json', text: 'The Institute reads Nimrod, son of Kush, as the first major figure after the Flood — a sign that Kushite tradition survived it.' },
      { id: 'kush-name', tag: 'record', source: 'Egyptian texts (Middle and New Kingdom)', text: 'Egyptian texts call the land south of the First Cataract Kash — the Kush of the Bible — and also Ta-Seti, the Land of the Bow, for its archers.' },
      { id: 'cataracts', tag: 'record', source: 'Geography of the Nile', text: 'Kush lay along the Nile between the First and the Sixth Cataracts, in what is now southern Egypt and Sudan, where the White and Blue Nile meet at Khartoum.' },
      { id: 'kerma', tag: 'record', source: 'Excavations at Kerma (Reisner; Bonnet)', text: 'At Kerma, a Kushite kingdom flourished from about 2500 to 1500 BCE, with great mud-brick temples called deffufas and vast royal burial mounds.' },
      { id: 'thutmose', tag: 'record', source: 'Tombos inscription of Thutmose I', text: 'Around 1500 BCE, Thutmose I of Egypt campaigned deep into Kush, and the New Kingdom ruled it through a viceroy, the King\'s Son of Kush.' },
      { id: 'barkal', tag: 'record', source: 'Jebel Barkal (UNESCO World Heritage Site)', text: 'At Napata, the sacred mountain of Jebel Barkal held a great temple of Amun that Kushite kings treated as the god\'s southern home.' },
      { id: 'piye', tag: 'record', source: 'Victory Stela of Piye (Cairo JE 48862)', text: 'Around 727 BCE, the Kushite king Piye marched north and conquered Egypt, recording the campaign on his Victory Stela.' },
      { id: 'dyn25', tag: 'record', source: 'Egyptian king lists; Manetho', text: 'Piye\'s successors ruled Egypt and Kush together as the 25th Dynasty, the pharaohs from Kush.' },
      { id: 'taharqa', tag: 'record', source: '2 Kings 19:9; Isaiah 37:9; Taharqa\'s inscriptions', text: 'Taharqa, the greatest builder of the dynasty, appears in the Bible as Tirhakah, king of Kush, marching against the Assyrians.' },
      { id: 'assyria', tag: 'record', source: 'Assyrian royal annals (Esarhaddon, Ashurbanipal)', text: 'Between 671 and 663 BCE the Assyrian kings Esarhaddon and Ashurbanipal drove the Kushite pharaohs out of Egypt.' },
      { id: 'meroe', tag: 'record', source: 'Excavations at Meroë (UNESCO World Heritage Site)', text: 'The kingdom endured in the south; from about 300 BCE its royal centre was Meroë, with more than two hundred steep pyramids.' },
      { id: 'meroitic-iron', tag: 'record', source: 'Meroë archaeology', text: 'Meroë wrote its own Meroitic script and worked iron on a large scale.' },
      { id: 'kandake', tag: 'record', source: 'Strabo, Geography 17.1.54', text: 'Its queens, the Kandakes, held real power: the one-eyed Kandake Amanirenas fought Rome to a treaty around 25–21 BCE.' },
      { id: 'acts', tag: 'tradition', source: 'Acts 8:27', text: 'The Book of Acts meets an official of Kandake, queen of the Ethiopians, reading Isaiah on the road to Gaza.' },
    ],
    outline: [
      { title: 'Four Rivers out of Eden', minutes: 2, goal: 'What Genesis says about Havilah and Kush before the Flood, and how they have been read.', facts: ['eden-rivers', 'pishon-havilah', 'gihon-kush', 'josephus-gihon', 'vk-preflood'] },
      { title: 'After the Flood: the Table of Nations', minutes: 2, goal: 'How Havilah and Kush reappear after Noah, as peoples and sons, and where Havilah was placed.', facts: ['table-ham', 'table-kush-sons', 'table-nimrod', 'table-havilah-joktan', 'havilah-arabia', 'vk-nimrod'] },
      { title: 'Kush on the Nile', minutes: 2, goal: 'The real land of Kush: the river, the cataracts, the archers and the kingdom of Kerma.', facts: ['kush-name', 'cataracts', 'kerma', 'thutmose'] },
      { title: 'The Pharaohs from Kush', minutes: 2, goal: 'How Kush conquered Egypt and ruled it as the 25th Dynasty, and why Taharqa is in the Bible.', facts: ['barkal', 'piye', 'dyn25', 'taharqa', 'assyria'] },
      { title: 'Meroë and the Kandakes', minutes: 2, goal: 'Kush after Egypt: Meroë, its pyramids, iron and script, and the queens who stood against Rome.', facts: ['meroe', 'meroitic-iron', 'kandake', 'acts'] },
    ],
  },
  'kush-nile': {
    era: 'ancient', region: 'nile',
    title: 'Kush and the Nile',
    summary: 'A wordless journey up the Nile into the land of Kush — the river and its flood, the archers of Kerma, the sacred mountain of Jebel Barkal, the pharaohs from Kush, the pyramids of Meroë and the queens who faced Rome.',
    peoples: 'nubian',
    facts: [
      { id: 'cataracts', tag: 'record', source: 'Geography of the Nile', text: 'Kush lay along the Nile between the First and the Sixth Cataracts, where the White and Blue Nile meet at Khartoum.', card: 'Kush — the Nile between the First and Sixth Cataracts', visual: 'the Nile winding through desert cliffs and granite rapids at dawn, a reed boat, Nubian fishermen' },
      { id: 'hapi', tag: 'record', source: 'Egyptian religious texts', text: 'The yearly flood was personified as the god Hapi.', card: 'Egyptians and Kushites saw the yearly flood as the god Hapi', visual: 'the Nile in flood spreading over green fields at sunset, a faint giant figure of the river god Hapi rising in the mist above the water, papyrus and lotus' },
      { id: 'gihon', tag: 'tradition', source: 'Genesis 2:13; Josephus, Antiquities 1.1.3', text: 'Genesis says the Gihon encompasses the land of Kush; Josephus identified the Gihon with the Nile.', card: 'Genesis: the Gihon "encompasses the whole land of Kush"', visual: 'a great river flowing out of a lush mythic garden into desert lands, soft golden light' },
      { id: 'tasety', tag: 'record', source: 'Egyptian texts (Middle and New Kingdom)', text: 'Egyptians called the land Kash, and Ta-Seti, the Land of the Bow, for its archers.', card: 'Ta-Seti — "the Land of the Bow"', visual: 'Nubian archers with long bows and feathered headbands training on a riverbank, dust and sunlight' },
      { id: 'kerma', tag: 'record', source: 'Excavations at Kerma (Reisner; Bonnet)', text: 'At Kerma, a Kushite kingdom flourished from about 2500 to 1500 BCE, with great mud-brick temples called deffufas and vast royal burial mounds.', card: 'Kerma, c. 2500–1500 BC', visual: 'a towering mud-brick deffufa temple at Kerma with workers carrying bricks, cattle, round huts, evening light' },
      { id: 'kerma-mounds', tag: 'record', source: 'Excavations at Kerma (Reisner; Bonnet)', text: 'Kerma kings were buried under vast round mounds.', card: 'How many hands raised these mounds?', visual: 'a vast round royal burial mound under construction at Kerma, hundreds of workers with baskets, a funeral procession' },
      { id: 'barkal', tag: 'record', source: 'Jebel Barkal (UNESCO World Heritage Site)', text: 'At Napata, Kushites and Egyptians believed Amun dwelt inside the sacred mountain of Jebel Barkal.', card: 'Jebel Barkal — they believed the god Amun lived inside this mountain', visual: 'the flat-topped sacred mountain Jebel Barkal with its pinnacle at dusk, a temple of Amun at its foot, a glowing ram-headed spirit of Amun faintly visible inside the rock' },
      { id: 'piye', tag: 'record', source: 'Victory Stela of Piye (Cairo JE 48862)', text: 'Around 727 BCE the Kushite king Piye marched north and conquered Egypt.', card: 'c. 727 BC — Piye of Kush marches on Egypt', visual: 'a Kushite army with archers, horses and chariots marching north along the Nile, banners, a king in a double-uraeus crown' },
      { id: 'dyn25', tag: 'record', source: 'Egyptian king lists; Manetho', text: 'Piye\'s successors ruled Egypt and Kush together as the 25th Dynasty.', card: 'The 25th Dynasty — pharaohs from Kush', visual: 'a Kushite pharaoh enthroned in an Egyptian temple, courtiers of both lands bowing, incense smoke' },
      { id: 'taharqa', tag: 'record', source: '2 Kings 19:9; Taharqa\'s inscriptions', text: 'Taharqa appears in the Bible as Tirhakah, king of Kush.', card: 'Taharqa — "Tirhakah, king of Kush" in the Bible', visual: 'the pharaoh Taharqa with the double cobra crown overseeing the building of a colonnade, stonemasons at work' },
      { id: 'meroe', tag: 'record', source: 'Excavations at Meroë (UNESCO World Heritage Site)', text: 'From about 300 BCE the royal centre was Meroë, with more than two hundred steep pyramids.', card: 'Meroë, Kingdom of Kush, c. 300 BC', visual: 'dozens of steep narrow Nubian pyramids at Meroë in the desert at golden hour, a caravan passing' },
      { id: 'meroe-build', tag: 'record', source: 'Excavations at Meroë (UNESCO World Heritage Site)', text: 'The pyramids of Meroë were raised from sandstone blocks.', card: 'How were these raised?', visual: 'workers raising a steep sandstone pyramid at Meroë with ramps, levers and a shaduf-like lifting beam, dust in the air' },
      { id: 'iron', tag: 'record', source: 'Meroë archaeology', text: 'Meroë worked iron on a large scale and wrote its own Meroitic script.', card: 'Iron and a script of their own', visual: 'iron smelting furnaces glowing at night at Meroë, smiths hammering, a scribe writing Meroitic script by lamplight' },
      { id: 'apedemak', tag: 'record', source: 'Lion Temple at Naqa', text: 'At Naqa, Kushites built a temple to the lion-headed god Apedemak.', card: 'Naqa — the lion-headed god Apedemak, as the temple carvings show him', visual: 'the Lion Temple at Naqa with carved walls, and the lion-headed god Apedemak appearing as a towering spirit beside it at dusk' },
      { id: 'kandake', tag: 'record', source: 'Strabo, Geography 17.1.54', text: 'The Kandake Amanirenas fought Rome to a treaty around 25–21 BCE.', card: 'c. 25 BC — Kandake Amanirenas stands against Rome', visual: 'a Kushite warrior queen in a golden crown on horseback before her army, facing Roman legionaries across the desert' },
      { id: 'acts', tag: 'tradition', source: 'Acts 8:27', text: 'Acts meets an official of Kandake, queen of the Ethiopians.', card: 'Acts 8: an official of the Kandake reads on the road to Gaza', visual: 'a Kushite royal official in a chariot reading a scroll on a desert road, a traveller walking beside it' },
    ],
    outline: [
      { title: 'The River', card: 'The Nile — the road into Kush', minutes: 2, goal: 'The Nile, its flood and the land of Kush.', facts: ['cataracts', 'hapi', 'gihon'] },
      { title: 'Kerma', card: 'Kerma, c. 2500–1500 BC', minutes: 2, goal: 'The archers and the first great Kushite kingdom.', facts: ['tasety', 'kerma', 'kerma-mounds'] },
      { title: 'The Mountain of Amun', card: 'Napata and Jebel Barkal, c. 750 BC', minutes: 2, goal: 'The sacred mountain and the pharaohs from Kush.', facts: ['barkal', 'piye', 'dyn25', 'taharqa'] },
      { title: 'Meroë', card: 'Meroë, Kingdom of Kush, c. 300 BC', minutes: 2, goal: 'The pyramids, iron and gods of Meroë.', facts: ['meroe', 'meroe-build', 'iron', 'apedemak'] },
      { title: 'The Kandakes', card: 'The queens of Kush', minutes: 2, goal: 'The queens who faced Rome.', facts: ['kandake', 'acts'] },
    ],
  },
  'nile-short': {
    era: 'ancient', region: 'nile',
    title: 'The Nile',
    summary: 'A short test topic for prompt comparison.',
    peoples: 'egyptian',
    facts: [
      { id: 'cataracts', tag: 'record', source: 'Geography of the Nile', text: 'The Nile runs north through six cataracts; the White and Blue Nile meet at Khartoum.' },
      { id: 'herodotus', tag: 'record', source: 'Herodotus, Histories 2.5', text: 'Herodotus called Egypt the gift of the river.' },
      { id: 'flood', tag: 'record', source: 'Egyptian calendar; Nilometers', text: 'Every year the Nile flooded, leaving black silt; Egyptians measured the flood with Nilometers and named their land Kemet, the black land.' },
      { id: 'hapi', tag: 'record', source: 'Egyptian religious texts', text: 'The flood was personified as the god Hapi, shown with a heavy belly and papyrus and lotus plants.' },
      { id: 'gihon-nile', tag: 'tradition', source: 'Josephus, Antiquities of the Jews 1.1.3', text: 'Josephus identified the Gihon, one of the rivers of Eden, with the Nile.' },
    ],
    outline: [{ title: 'The Gift of the River', minutes: 2, goal: 'Why the Nile made Egypt, and how Egyptians and later writers understood it.', facts: ['cataracts', 'herodotus', 'flood', 'hapi', 'gihon-nile'] }],
  },
};

Object.assign(TOPICS, WAVE1);

// Queued (not rendered) long-form topics for operator approval: seed facts; outlines are drafted by the pipeline.
export const QUEUED = {
  'table-of-nations': {
    title: 'The Table of Nations',
    minutes: 30,
    seed: [
      { tag: 'tradition', source: 'Genesis 10', text: 'Genesis 10 lists the peoples descended from Noah\'s sons Shem, Ham and Japheth — seventy nations in the traditional count.' },
      { tag: 'tradition', source: 'Genesis 11:1–9', text: 'It is followed by the Tower of Babel and the scattering of languages.' },
      { tag: 'tradition', source: 'Josephus, Antiquities 1.6', text: 'Josephus matched the names to the peoples of his own day.' },
      { tag: 'record', source: 'Assyriology', text: 'Many names match known ancient peoples and places: Mizraim (Egypt), Kush, Ashur (Assyria), Elam, Aram, Javan (Ionian Greeks), Madai (Medes).' },
    ],
  },
  'babylon-persia': {
    title: 'Babylon and Persia',
    minutes: 60,
    seed: [
      { tag: 'record', source: 'Babylonian Chronicles', text: 'Nebuchadnezzar II rebuilt Babylon with the Ishtar Gate and took Jerusalem in 597 and 587 BCE.' },
      { tag: 'record', source: 'Cyrus Cylinder (British Museum)', text: 'Cyrus the Great took Babylon in 539 BCE; the Cyrus Cylinder records his restoration of temples and peoples.' },
      { tag: 'tradition', source: 'Ezra 1; Isaiah 45', text: 'The Bible remembers Cyrus as the anointed king who let the exiles return.' },
      { tag: 'record', source: 'Behistun Inscription', text: 'Darius I recorded his rise on the Behistun Inscription in Old Persian, Elamite and Babylonian — the key to reading cuneiform.' },
      { tag: 'record', source: 'Berossus, Babyloniaca (fragments)', text: 'The Babylonian priest Berossus wrote a history of Babylon in Greek, including a flood story and the list of antediluvian kings.' },
    ],
  },
};

export function factsFor(topic, ids) { const by = new Map(topic.facts.map((f) => [f.id, f])); return ids.map((i) => by.get(i)).filter(Boolean); }
export const WORDS_PER_MINUTE = 140;
