"""gen_time_topics.py — writes six "time-mapped" topic clips (dogs, cannabis, the wheel, the spoked wheel, the chariot,
the horse) and their per-item sources (../data/time-topics/citations.json). Re-run after editing a table.

Dogs and cannabis use timeMode "ago" (years before present, log scale); the wheel, spoke, chariot and horse use calendar
years. Points and routes are schematic: each point is a dated site or text from the cited literature; route lines are
one current model of spread, not tracks. Debated and model-based items are labelled on screen.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "time-topics")
os.makedirs(OUT, exist_ok=True)
NOTE = "Alpha · dates are scholarly estimates with uncertainty · one current model · debated items labelled"
END = ("Dates are scholarly estimates with uncertainty; routes are one current model of spread, not tracks. "
       "Debated and model-based items are labelled. Sources: integrations/maps/data/time-topics/SOURCES.md.")
TESTING = "We are testing these features and looking to develop them."
CITES = {}


def pt(label, lat, lon, year, kind, caption, source, zoom=3.0, hold=4):
    CITES.setdefault(label, source)
    return {"label": label, "lat": lat, "lon": lon, "year": year, "kind": kind, "caption": caption, "source": source, "hold": hold, "zoom": zoom}


def city(s, to):
    return {"name": s["label"], "lat": s["lat"], "lon": s["lon"], "from": s["year"], "to": to}


def route(label, colour, pts):
    return {"label": label, "colour": colour, "points": [{"label": p[0], "lat": p[1], "lon": p[2], "year": float(p[3])} for p in pts]}


# ── DOGS (years ago) ────────────────────────────────────────────────────────────────────────────────
DOGS = [
    pt("Předmostí (debated)", 49.45, 17.44, -31000, "debated", "Proposed 'Palaeolithic dogs' among mammoth-hunter wolves — contested", "Germonpré et al. 2012 J Anthropol Archaeol 31:184; contested by Boudadi-Maligne & Escarguel 2014"),
    pt("Siberia: a domestication model", 55.0, 105.0, -23000, "interpretation", "Dogs and wolves diverged ~23,000 years ago, perhaps in Siberia (one model)", "Perri et al. 2021 PNAS 118:e2010083118; Frantz et al. 2016 Science 352:1228"),
    pt("Bonn-Oberkassel", 50.72, 7.17, -14200, "record", "A sick puppy nursed for weeks, buried with two people", "Janssens et al. 2018 J Archaeol Sci 92:126"),
    pt("Ain Mallaha (Natufian)", 33.1, 35.6, -12000, "record", "An old woman buried with her hand on a puppy", "Davis & Valla 1978 Nature 276:608"),
    pt("Five lineages by 11,000 years ago", 45.0, 60.0, -11000, "record", "Ancient genomes: dogs already split into five lineages", "Bergström et al. 2020 Science 370:557"),
    pt("Koster & Stilwell II (Illinois)", 39.3, -90.6, -10000, "record", "The oldest dated dog burials in the Americas", "Perri et al. 2019 PNAS 116:15373"),
    pt("Zhokhov sled dogs", 76.1, 152.6, -9500, "record", "Arctic sled dogs bred for the harness", "Pitulko & Kasparov 2017 J Anthropol Archaeol 45:1; Sinding et al. 2020 Science 368:1495"),
    pt("Jiahu", 33.6, 113.7, -8500, "record", "Neolithic China: dogs buried in the village", "Henan Institute (Jiahu reports); Zhang et al. — Jiahu dog burials"),
    pt("Hierakonpolis", 25.1, 32.8, -5500, "record", "Predynastic Egypt: dogs in the elite cemetery", "Friedman et al., Hierakonpolis Expedition reports"),
    pt("Madura Cave: the dingo", -31.9, 127.0, -3300, "record", "Oldest dingo in Australia, ~3,350–3,100 years ago", "Balme, O'Connor & Fallon 2018 Sci Rep 8:9933"),
    pt("Colima dogs (Xolo ancestry)", 19.2, -103.7, -2100, "record", "Shaft-tomb effigies of hairless dogs, ancestors of the Xoloitzcuintli", "Colima shaft-tomb ceramics c. 300 BC–AD 300; Leathlobhair et al. 2018 Science 361:81"),
    pt("Aotearoa: the kurī", -41.3, 174.0, -750, "record", "Polynesian dogs arrive with the first settlers", "Greig et al. 2018 (kurī); Wilmshurst et al. 2011 PNAS 108:1815"),
]
DOG_ROUTES = [
    route("To Beringia (model)", "#80d0e0", [("Siberia", 55, 105, -23000), ("Chukotka", 66, 175, -17000)]),
    route("With people into the Americas (model)", "#80d0e0", [("Alaska", 64, -160, -16000), ("Pacific coast", 50, -127, -15000), ("Illinois", 39.3, -90.6, -10000), ("Mesoamerica", 19.2, -103.7, -2100)]),
    route("Across Eurasia", "#f0c46a", [("Siberia", 55, 105, -23000), ("Central Asia", 45, 60, -15000), ("Rhine", 50.72, 7.17, -14200), ("Levant", 33.1, 35.6, -12000)]),
    route("To Sunda and Australia", "#e8a060", [("South China", 25, 110, -8000), ("Sunda", 0, 110, -5000), ("Timor", -9, 125, -4000), ("Madura Cave", -31.9, 127.0, -3300)]),
    route("Across the Pacific", "#ffb0c0", [("Bismarck Arch.", -4, 152, -3300), ("Fiji", -18, 178.4, -2900), ("Aotearoa", -41.3, 174.0, -750)]),
]
CITES["routes (dogs)"] = "Bergström et al. 2020 Science 370:557; Perri et al. 2021 PNAS; Leathlobhair et al. 2018 Science; Balme et al. 2018"

# ── CANNABIS (years ago) ────────────────────────────────────────────────────────────────────────────
CAN = [
    pt("East Asia: domestication (genomic model)", 36.0, 105.0, -12000, "interpretation", "Genomes point to early domestication in East Asia (one model)", "Ren et al. 2021 Sci Adv 7:eabg2286"),
    pt("Okinoshima, Japan (Jōmon)", 35.0, 139.9, -10000, "record", "Hemp seeds in an early Jōmon site", "Kobayashi et al. 2008; Long et al. 2017 Veg Hist Archaeobot 26:245"),
    pt("Neolithic China: hemp cord & cloth", 34.5, 109.0, -6000, "record", "Cord-marked pottery and hemp textiles", "Li 1974 Econ Bot 28:293; Long et al. 2017"),
    pt("Steppe spread (debated)", 47.0, 40.0, -5000, "debated", "Use rises across Eurasia with Bronze Age mobility", "Long et al. 2017 Veg Hist Archaeobot 26:245"),
    pt("India: bhaṅga in the Atharvaveda", 26.0, 80.0, -3100, "tradition", "Bhaṅga named among five sacred plants (AV 11.6.15)", "Atharvaveda 11.6.15; Touw 1981 J Psychoactive Drugs 13:23"),
    pt("Tel Arad shrine", 31.28, 35.13, -2750, "record", "Cannabis resin burned on a Judahite altar", "Arie, Rosen & Namdar 2020 Tel Aviv 47:5"),
    pt("Yanghai tombs, Turfan", 42.9, 89.7, -2700, "record", "A shaman's grave with ~800 g of cannabis", "Russo et al. 2008 J Exp Bot 59:4171"),
    pt("Jirzankal, Pamirs", 37.8, 75.2, -2500, "record", "High-THC cannabis burned in wooden braziers at burials", "Ren et al. 2019 Sci Adv 5:eaaw1391"),
    pt("Scythians (Herodotus)", 47.0, 35.0, -2460, "record", "Hemp seeds thrown on hot stones in felt tents (the text)", "Herodotus, Histories 4.73–75"),
    pt("Pazyryk kurgans", 50.7, 88.2, -2400, "record", "Braziers with hemp seeds in frozen tombs", "Rudenko 1970 Frozen Tombs of Siberia"),
    pt("Egypt & Syria: hashish", 30.0, 31.2, -850, "record", "Medieval Arabic writers on hashish", "Rosenthal 1971 The Herb: Hashish versus Medieval Muslim Society"),
    pt("Lalibela pipes, Ethiopia", 12.0, 39.0, -650, "debated", "Cannabis residue in ceramic pipes (dating debated)", "van der Merwe 1975 in Rubin (ed.) Cannabis and Culture"),
    pt("Southern Africa: dagga", -26.0, 28.0, -450, "interpretation", "Smoking spreads south via East African trade", "du Toit 1980 Cannabis in Africa; Duvall 2019 The African Roots of Marijuana"),
    pt("Chile: Spanish hemp", -33.4, -70.6, -475, "record", "Hemp for rope and sail planted in 1545", "Duvall 2019; colonial Chilean records"),
    pt("Virginia: colonial hemp", 37.2, -76.8, -410, "record", "Hemp ordered grown at Jamestown", "Virginia Company records 1619"),
    pt("Mexico: marihuana", 19.4, -99.1, -170, "record", "The word and the smoked plant spread in 19th-century Mexico", "Campos 2012 Home Grown: Marijuana and the Origins of Mexico's War on Drugs"),
]
CAN_ROUTES = [
    route("Out of East Asia (model)", "#8fd07a", [("East Asia", 36, 105, -12000), ("Japan", 35, 139.9, -10000), ("Yellow River", 34.5, 109, -6000)]),
    route("Across the steppe", "#c0e080", [("Mongolia", 47, 100, -6000), ("Altai", 50.7, 88.2, -5500), ("Pontic steppe", 47, 40, -5000), ("Central Europe", 50, 15, -4500)]),
    route("South and west", "#f0c46a", [("Tarim", 42.9, 89.7, -3500), ("Pamirs", 37.8, 75.2, -3200), ("Ganges", 26, 80, -3100), ("Levant", 31.28, 35.13, -2750)]),
    route("Through Islam into Africa", "#e8a060", [("Egypt", 30, 31.2, -850), ("Ethiopia", 12, 39, -650), ("East African coast", -6, 39, -550), ("Southern Africa", -26, 28, -450)]),
    route("The Atlantic crossing", "#ff9070", [("Iberia", 40, -4, -500), ("Chile", -33.4, -70.6, -475), ("Virginia", 37.2, -76.8, -410), ("Brazil (with enslaved Africans)", -12.9, -38.5, -350), ("Mexico", 19.4, -99.1, -170)]),
]
CITES["routes (cannabis)"] = "Ren et al. 2021 Sci Adv; Long et al. 2017 Veg Hist Archaeobot; Duvall 2019 The African Roots of Marijuana"

# ── WHEEL (calendar) ────────────────────────────────────────────────────────────────────────────────
AW = "Anthony 2007 The Horse, the Wheel, and Language; Bakker et al. 1999 Antiquity 73:778"
WHEEL = [
    pt("Bronocice pot", 50.4, 20.6, -3500, "record", "The oldest picture of a wagon, on a clay pot", "Milisauskas & Kruk 1982; " + AW),
    pt("Flintbek wheel ruts", 54.25, 10.08, -3400, "record", "Cart tracks preserved under a barrow", "Mischka 2011 Antiquity 85:742"),
    pt("Uruk wagon signs", 31.3, 45.6, -3300, "record", "Wagon pictographs on proto-cuneiform tablets", AW),
    pt("Ljubljana Marshes wheel", 45.95, 14.55, -3150, "record", "The oldest surviving wooden wheel and axle", "Velušček (ed.) 2009 Koliščarska naselbina Stare gmajne"),
    pt("Steppe wagon burials", 47.5, 38.9, -3000, "record", "Yamnaya and Novotitorovka graves with whole wagons", AW),
    pt("Standard of Ur", 30.96, 46.1, -2600, "record", "Solid-wheeled battle wagons drawn by onagers", "British Museum 121201; " + AW),
    pt("Harappa toy carts", 30.63, 72.87, -2500, "record", "Clay carts and wheels of the Indus cities", "Kenoyer 1998 Ancient Cities of the Indus Valley"),
    pt("Erlitou wheel ruts", 34.7, 112.7, -1700, "record", "The oldest wheel tracks in China", "Institute of Archaeology CASS Erlitou reports 2004"),
]
WHEEL_ROUTES = [route("The wheel spreads (one model)", "#f0c46a", [("Mesopotamia", 31.3, 45.6, -3400), ("Pontic steppe", 47.5, 38.9, -3200), ("Central Europe", 50.4, 20.6, -3100), ("Indus", 30.63, 72.87, -2600), ("Yellow River", 34.7, 112.7, -1700)])]
CITES["route (wheel)"] = AW + " — whether the wheel was invented once or several times is debated"

# ── SPOKE (calendar) ────────────────────────────────────────────────────────────────────────────────
SPOKE = [
    pt("Sintashta & Krivoye Ozero", 52.6, 60.3, -2000, "record", "Spoked wheels in chariot graves (impressions in the soil)", AW + "; Lindner 2020 Antiquity 94:361"),
    pt("Kültepe (Kanesh) seals", 38.85, 35.63, -1900, "record", "Spoked-wheel vehicles on Old Assyrian-colony seals", "Littauer & Crouwel 1979 Wheeled Vehicles and Ridden Animals"),
    pt("Old Syrian seals", 36.2, 37.1, -1800, "record", "Light chariots with spoked wheels", "Littauer & Crouwel 1979"),
    pt("Mycenae shaft graves", 37.73, 22.76, -1600, "record", "Stelae carved with chariots", "Crouwel 1981 Chariots and Other Means of Land Transport in Bronze Age Greece"),
    pt("Egypt via the Hyksos", 30.79, 31.82, -1600, "interpretation", "The chariot reaches Egypt in the Second Intermediate Period", "Shaw 2001; Littauer & Crouwel 1979"),
    pt("Anyang (Shang)", 36.1, 114.3, -1200, "record", "Chariot pits with 18–26 spoked wheels", "Shaughnessy 1988 HJAS 48:189"),
]
SPOKE_ROUTES = [route("The spoked wheel (one model)", "#e8a060", [("Sintashta", 52.6, 60.3, -2000), ("Anatolia", 38.85, 35.63, -1900), ("Syria", 36.2, 37.1, -1800), ("Egypt", 30.79, 31.82, -1600), ("Greece", 37.73, 22.76, -1600)]),
                route("East to China", "#d0b0ff", [("Sintashta", 52.6, 60.3, -2000), ("Altai", 50, 88, -1700), ("Gansu", 38, 102, -1400), ("Anyang", 36.1, 114.3, -1200)])]
CITES["routes (spoke)"] = AW + "; Shaughnessy 1988; Littauer & Crouwel 1979"

# ── CHARIOT (calendar) ──────────────────────────────────────────────────────────────────────────────
CHAR = [
    pt("Sintashta", 52.6, 60.3, -2000, "record", "The oldest chariots", AW),
    pt("Mycenae", 37.73, 22.76, -1600, "record", "Greek chariot stelae", "Crouwel 1981"),
    pt("Vedic ratha", 30.5, 75.0, -1400, "tradition", "The Rigveda's war-chariots (date of the text approximate)", "Rigveda (e.g. 6.47.26–31); Witzel 1995"),
    pt("Kikkuli's horse-training text", 40.02, 34.62, -1350, "record", "A Mitanni trainer's chariot-horse manual, found at Hattusa", "Kammenhuber 1961 Hippologia Hethitica"),
    pt("Tutankhamun's chariots", 25.7, 32.6, -1323, "record", "Six chariots in the king's tomb", "Littauer & Crouwel 1985 Chariots and Related Equipment from the Tomb of Tut'ankhamūn"),
    pt("Kadesh", 34.56, 36.52, -1274, "record", "Perhaps the largest chariot battle, Ramesses II vs Muwatalli", "Egyptian Kadesh inscriptions; Hittite correspondence"),
    pt("Anyang chariot pits", 36.1, 114.3, -1200, "record", "Shang kings buried with chariots, horses and drivers", "Shaughnessy 1988"),
    pt("Champagne chariot burials", 49.0, 4.0, -450, "record", "La Tène Celts buried with two-wheeled chariots", "Anthony 2007; Megaw & Megaw 2001 Celtic Art"),
    pt("Gaugamela", 36.5, 43.4, -331, "record", "Darius's scythed chariots fail against Alexander", "Arrian, Anabasis 3.11–15"),
    pt("Zhao's cavalry reform", 37.9, 114.5, -307, "record", "King Wuling adopts horseback archers; chariots fade in China", "Shiji 43; Sima Qian"),
    pt("Wetwang Slack", 54.0, -0.6, -300, "record", "A woman buried with her chariot in Yorkshire", "Hill 2002 Antiquity 76:410"),
    pt("Mons Graupius", 57.3, -2.6, 83, "record", "Britons' chariots at one of the last chariot battles", "Tacitus, Agricola 35–36"),
]
CHAR_ROUTES = [route("The chariot spreads (one model)", "#ff7070", [("Sintashta", 52.6, 60.3, -2000), ("Anatolia", 38.85, 35.63, -1800), ("Mitanni", 36.8, 40.1, -1500), ("Egypt", 25.7, 32.6, -1550), ("Greece", 37.73, 22.76, -1600)]),
               route("East", "#d0b0ff", [("Sintashta", 52.6, 60.3, -2000), ("Altai", 50, 88, -1700), ("Anyang", 36.1, 114.3, -1200)]),
               route("South", "#f0c46a", [("Sintashta", 52.6, 60.3, -2000), ("Bactria", 37, 67, -1800), ("Punjab", 30.5, 75, -1400)])]
CITES["routes (chariot)"] = AW

# ── HORSE (calendar) ────────────────────────────────────────────────────────────────────────────────
HORSE = [
    pt("Botai (debated)", 53.3, 67.9, -3500, "debated", "Horse milking and bridling claimed; genomes show these were the ancestors of Przewalski's horse, not of domestic horses", "Outram et al. 2009 Science 323:1332; Gaunitz et al. 2018 Science 360:111"),
    pt("Lower Volga–Don: DOM2", 49.0, 44.0, -2200, "record", "Ancient genomes: the modern domestic horse lineage expands from here", "Librado et al. 2021 Nature 598:634"),
    pt("Sintashta", 52.6, 60.3, -2000, "record", "DOM2 horses pull the first chariots", "Librado et al. 2021"),
    pt("Anatolia", 39.0, 35.0, -2000, "record", "DOM2 horses replace local lineages", "Librado et al. 2021"),
    pt("Bohemia", 50.0, 14.5, -2000, "record", "DOM2 horses in central Europe", "Librado et al. 2021"),
    pt("Egypt", 30.79, 31.82, -1600, "record", "Horses arrive with the chariot", "Littauer & Crouwel 1979"),
    pt("Anyang", 36.1, 114.3, -1200, "record", "Horses buried with Shang chariots", "Librado et al. 2021; Shaughnessy 1988"),
    pt("Przewalski's horse", 46.3, 93.0, 1881, "record", "Described for science in 1881; saved from extinction and returned to Mongolia from 1992", "Gaunitz et al. 2018; Przewalski 1881"),
    pt("Hispaniola", 19.0, -70.7, 1493, "record", "Columbus's second voyage brings horses back to the Americas", "Columbus's second voyage records"),
    pt("Veracruz", 19.2, -96.1, 1519, "record", "Cortés lands sixteen horses", "Bernal Díaz del Castillo, Historia verdadera"),
    pt("The Plains horse nations", 40.0, -103.0, 1630, "record", "Horses among Plains peoples by the early 1600s", "Taylor et al. 2023 Science 379:1316"),
]
HORSE_ROUTES = [route("DOM2 across Eurasia", "#c98a4a", [("Volga–Don", 49, 44, -2200), ("Urals", 52.6, 60.3, -2000), ("Anatolia", 39, 35, -2000), ("Central Europe", 50, 14.5, -2000), ("Egypt", 30.79, 31.82, -1600), ("Yellow River", 36.1, 114.3, -1200)]),
                route("Back to the Americas", "#f0c46a", [("Iberia", 37.4, -6.0, 1492), ("Hispaniola", 19, -70.7, 1493), ("Veracruz", 19.2, -96.1, 1519), ("Rio Grande", 32, -106, 1598), ("Great Plains", 40, -103, 1630)])]
CITES["routes (horse)"] = "Librado et al. 2021 Nature 598:634; Taylor et al. 2023 Science 379:1316"


# ── DOLMENS & MEGALITHIC TOMBS (years ago, linear) ──────────────────────────────────────────────────
SP = "Schulz Paulsson 2019 PNAS 116:3460"
DOLMENS = [
    pt("Barnenez, Brittany", 48.67, -3.86, -6800, "record", "One of the oldest megalithic tombs, ~4800 BC", SP + "; Giot 1987"),
    pt("NW France origin (one model)", 47.6, -3.0, -6700, "interpretation", "Megaliths spread from NW France by sea (one model)", SP),
    pt("Poulnabrone, Ireland", 53.05, -9.14, -5800, "record", "Portal tomb, burials ~3800–3200 BC", "Lynch 2014 Poulnabrone: An Early Neolithic Portal Tomb in Ireland"),
    pt("Antequera (Menga), Iberia", 37.02, -4.54, -5750, "record", "A giant dolmen, ~3750 BC", "García Sanjuán et al. 2018 J World Prehist 31:1"),
    pt("Wayland's Smithy, Britain", 51.57, -1.60, -5600, "record", "Long barrow, ~3590 BC", "Whittle et al. 2007 Cambridge Archaeol J 17:103"),
    pt("Funnel Beaker dolmens, Denmark", 56.24, 10.60, -5550, "record", "Dysser of the first farmers, ~3700–3400 BC", "Schulz Paulsson 2017 Time and Stone (Archaeopress)"),
    pt("Hunebedden, Drenthe", 52.90, 6.70, -5400, "record", "Funnel Beaker passage graves", "Bakker 1992 The Dutch Hunebedden"),
    pt("Golan & Jordan dolmen fields (debated)", 32.95, 35.72, -5000, "debated", "Thousands of dolmens, ~4000–2500 BC (dating debated)", "Fraser 2018 Dolmens in the Levant (Routledge)"),
    pt("W Caucasus dolmens", 44.40, 38.20, -5000, "record", "Stone boxes with round portholes, ~3000–1300 BC", "Trifonov 2001; Rezepkin 2000"),
    pt("Sardinia: Sa Coveccada", 40.55, 9.03, -4600, "record", "Sardinian dolmen, ~2700–2500 BC", "Tanda 2015; Moravetti"),
    pt("Corsica: Fontanaccia", 41.56, 8.97, -4500, "record", "Corsica's best-known dolmen, 3rd millennium BC", "Grosjean 1966"),
    pt("Apulia: Bisceglie", 41.22, 16.48, -4000, "record", "Gallery dolmen, ~2000 BC", "Whitehouse 1981"),
    pt("Korea: Gochang, Hwasun, Ganghwa", 35.44, 126.70, -3000, "record", "The world's densest dolmen fields, from ~1000 BC", "UNESCO World Heritage nomination 2000 (Gochang, Hwasun and Ganghwa)"),
    pt("Deccan & Kerala megaliths", 10.28, 77.16, -2900, "record", "Iron Age dolmens and stone circles, ~1200 BC–AD 300", "Moorti 1994 Megalithic Traditions in South India; Wheeler 1947 (Brahmagiri)"),
    pt("Ethiopia: Harar dolmens (undated)", 9.30, 42.10, -2800, "debated", "Dolmens near Harar; dating uncertain", "Joussaume 1974 Le mégalithisme en Éthiopie"),
    pt("Algeria: Roknia", 36.55, 7.22, -2600, "debated", "Thousands of small dolmens; dates debated", "Camps 1961 Aux origines de la Berbérie"),
    pt("Kyushu dolmens", 33.30, 130.30, -2500, "record", "Yayoi-period dolmens from Korea", "Mizoguchi 2013 The Archaeology of Japan"),
]
DOL_ROUTES = [route("Atlantic spread by sea (one model)", "#c9a86a", [("Brittany", 47.6, -3.0, -6700), ("Iberia", 37.02, -4.54, -5750), ("Ireland", 53.05, -9.14, -5800), ("Britain", 51.57, -1.6, -5600), ("Denmark", 56.24, 10.6, -5550)]),
              route("Into the Mediterranean (one model)", "#e8a060", [("Iberia", 37.02, -4.54, -5700), ("Sardinia", 40.55, 9.03, -4600), ("Corsica", 41.56, 8.97, -4500), ("Apulia", 41.22, 16.48, -4000)])]
CITES["routes (dolmens)"] = SP + " — the single-origin sea-spread model is debated"
TEMPLES = [
    pt("Göbekli Tepe", 37.22, 38.92, -11500, "record", "Carved T-pillars, ~9500 BC", "Dietrich et al. 2012 Antiquity 86:674"),
    pt("Karahan Tepe", 37.10, 39.30, -11400, "record", "Pillared chambers cut from bedrock", "Karul 2021 Türk Arkeoloji ve Etnografya Dergisi 83:21"),
    pt("Nevalı Çori", 37.60, 38.60, -10200, "record", "A temple building inside a village", "Hauptmann 1993"),
    pt("Çatalhöyük", 37.67, 32.83, -9400, "record", "Shrine rooms, bulls' horns and wall paintings", "Hodder 2006 The Leopard's Tale"),
    pt("Ġgantija, Malta", 36.05, 14.27, -5600, "record", "Malta's megalithic temples, ~3600 BC", "Malone et al. 2019 PNAS 116:19089 (Malta chronology)"),
    pt("Ħal Saflieni Hypogeum", 35.87, 14.51, -5500, "record", "A temple cut underground", "Pace 2000"),
    pt("Newgrange", 53.69, -6.48, -5200, "record", "Passage tomb lit by the winter-solstice sunrise", "O'Kelly 1982 Newgrange"),
    pt("Stonehenge", 51.18, -1.83, -5000, "record", "First stage ~3000 BC", "Parker Pearson et al. 2007 Antiquity 81:617"),
]

BASE = {"fps": 24, "palette": "night", "note": NOTE, "endNote": END, "testing": TESTING}
AGO = {"timeMode": "ago", "timeScale": "log"}


def job(cid, title, subtitle, bbox, years, duration, stops, routes, tags, credit, to, mode):
    stops = sorted(stops, key=lambda s: s["year"])
    return {"id": cid, **BASE, **mode, "title": title, "subtitle": subtitle, "bbox": bbox, "years": years, "duration": duration,
            "cities": [city(s, to) for s in stops], "routes": routes, "stops": stops, "tags": ["time-mapped"] + tags,
            "credit": credit + " Base map: Natural Earth (public domain)."}


WORLD = [-180, -58, 180, 78]
DOL_CREDIT = "Schulz Paulsson 2019; Lynch 2014; García Sanjuán 2018; Whittle 2007; Fraser 2018; Trifonov 2001; UNESCO 2000; Moorti 1994; Joussaume 1974; Camps 1961."
JOBS = [
    job("time-dolmens", "Dolmens: Time-Mapped", "megalithic tombs lighting up, ~4800 BC onward · one origin model", [-15, -5, 145, 62], [-7200, -2300], 120, DOLMENS, DOL_ROUTES,
        ["dolmens", "megaliths", "neolithic"], DOL_CREDIT, 0, {"timeMode": "ago"}),
    job("time-dolmens-temples", "From Göbekli Tepe to the Dolmens", "Neolithic temples and megalithic tombs together", [-15, -5, 145, 62], [-12000, -2300], 130, TEMPLES + DOLMENS, DOL_ROUTES,
        ["dolmens", "megaliths", "neolithic", "temples"], "Dietrich 2012; Karul 2021; Hodder 2006; Malone 2019; O'Kelly 1982; Parker Pearson 2007; " + DOL_CREDIT, 0, {"timeMode": "ago"}),
    job("time-dogs", "Dogs: Time-Mapped", "from wolf to every continent · dates are estimates", WORLD, [-32000, -600], 110, DOGS, DOG_ROUTES,
        ["dogs", "domestication"], "Bergström 2020; Frantz 2016; Perri 2019/2021; Janssens 2018; Balme 2018; Leathlobhair 2018.", 0, AGO),
    job("time-cannabis", "Cannabis: Time-Mapped", "from East Asia across the world · dates are estimates", WORLD, [-13000, -150], 110, CAN, CAN_ROUTES,
        ["cannabis", "hemp", "plants"], "Ren 2021; Long 2017; Ren 2019; Russo 2008; Arie 2020; Herodotus 4.73–75; Duvall 2019.", 0, AGO),
    job("time-wheel", "The Wheel: Time-Mapped", "c. 3500 – 1700 BC · invented once or many times? (debated)", [-15, 20, 125, 60], [-3700, -1600], 80, WHEEL, WHEEL_ROUTES,
        ["wheel", "technology"], "Anthony 2007; Bakker et al. 1999; Velušček 2009; Mischka 2011.", 2100, {}),
    job("time-spoke", "The Spoked Wheel: Time-Mapped", "c. 2000 – 1200 BC", [-5, 20, 125, 60], [-2200, -1100], 70, SPOKE, SPOKE_ROUTES,
        ["wheel", "chariot", "technology"], "Anthony 2007; Lindner 2020; Littauer & Crouwel 1979; Shaughnessy 1988.", 2100, {}),
    job("time-chariot", "The Chariot: Time-Mapped", "c. 2000 BC – AD 83 · rise and end of chariot warfare", [-12, 20, 125, 62], [-2200, 100], 110, CHAR, CHAR_ROUTES,
        ["chariot", "warfare"], "Anthony 2007; Crouwel 1981; Kammenhuber 1961; Littauer & Crouwel 1985; Arrian; Tacitus; Shiji.", 2100, {}),
    job("time-horse", "The Horse: Time-Mapped", "c. 3500 BC – AD 1900 · DOM2 and the return to the Americas", WORLD, [-3700, 1900], 110, HORSE, HORSE_ROUTES,
        ["horse", "domestication"], "Librado 2021; Gaunitz 2018; Outram 2009; Taylor 2023.", 2100, {}),
]
for j in JOBS:
    json.dump(j, open(os.path.join(HERE, f"{j['id']}.json"), "w"), indent=1, ensure_ascii=False)
json.dump({"note": "one current model; dates approximate; see SOURCES.md", "items": CITES}, open(os.path.join(OUT, "citations.json"), "w"), indent=1, ensure_ascii=False)
print(len(JOBS), "jobs;", len(CITES), "cited items")
