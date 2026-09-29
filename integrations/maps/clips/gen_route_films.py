"""gen_route_films.py — writes the route-with-stops film jobs (Hannibal; the Phoenician colonies & Carthage).

  python gen_route_films.py remakes-manifest.json    → hannibal-across-the-map.json, phoenician-colonies.json

Dates follow the maps convention: month m of year Y BC = -Y + (m - 1) / 12 (so September 218 BC = -217.33).
Card kinds: record = the ancient historians' account / excavation; tradition = the founding legends and later
stories; debated = the scholars disagree (e.g. Hannibal's Alpine pass). Picture credits travel with each item.
"""
import json, sys

M = {s["key"]: s for s in json.load(open(sys.argv[1]))["scenes"]} if len(sys.argv) > 1 else {}
BC = lambda y, m=1: round(-y + (m - 1) / 12, 3)
TESTING = "We are testing these features and looking to develop them."


def remake(key, look="1_real", people="punic", caption=""):
    s = M.get(key, {})
    looks = s.get("looks") or {}
    ppl = looks.get(look, {})
    if people not in ppl and ppl:
        people = sorted(ppl)[0]
    return {"src": f"remake:{key}/{look}_{people}.png", "credit": f"Remake by Hathor Studio after {s.get('credit', key)}", "caption": caption}


def pd(url, credit, caption=""):
    return {"src": url.split("?")[0], "credit": credit, "caption": caption}


def lib(path, caption=""):
    return {"src": f"library:{path}", "credit": "Hathor Studio render (our own CPU)", "caption": caption}


def para(name, credit):
    return {"src": f"parallax:{name}.mp4", "credit": credit + " · depth-parallax motion by Hathor Studio"}


def stop(label, lat, lon, year, date, kind, source, caption, media, hold=None, chapter="", zoom=3.2):
    return {"label": label, "lat": lat, "lon": lon, "year": year, "date": date, "kind": kind, "source": source, "caption": caption,
            "media": media, "hold": hold if hold else (6 if not media else min(26, 7 + 6.5 * len(media))), "chapter": chapter, "zoom": zoom}


C = "https://upload.wikimedia.org/wikipedia/commons"
HANNIBAL_ROUTE = [
    ("New Carthage", 37.60, -0.98, BC(219, 4)), ("Saguntum", 39.68, -0.27, BC(219, 5)), ("Saguntum falls", 39.68, -0.27, BC(219, 12)),
    ("New Carthage", 37.60, -0.98, BC(218, 5)), ("The Ebro", 40.72, 0.86, BC(218, 6)), ("The Pyrenees", 42.45, 2.90, BC(218, 8)),
    ("The Rhône", 43.95, 4.70, BC(218, 9)), ("The Alps", 45.20, 6.90, BC(218, 10)), ("The Taurini", 45.07, 7.69, BC(218, 11)),
    ("Ticinus", 45.20, 9.00, BC(218, 11) + 0.02), ("Trebia", 45.00, 9.60, BC(218, 12)), ("Lake Trasimene", 43.20, 12.10, BC(217, 6)),
    ("Campania", 41.20, 14.00, BC(217, 8)), ("Cannae", 41.30, 16.10, BC(216, 8)), ("Capua", 41.10, 14.20, BC(216, 10)),
    ("Tarentum", 40.47, 17.24, BC(212, 2)), ("Before Rome", 41.90, 12.50, BC(211, 4)), ("Bruttium", 39.08, 17.12, BC(207, 6)),
    ("Leaves Italy", 39.08, 17.12, BC(203, 9)), ("Leptis Minor", 35.67, 10.86, BC(203, 11)), ("Zama", 36.29, 9.45, BC(202, 10)),
]
hannibal = {
    "id": "hannibal-across-the-map", "title": "Hannibal: Across the Map",
    "subtitle": "219 – 201 BC · from New Carthage over the Alps, and back to Africa",
    "bbox": [-10, 30, 22, 48], "years": [-219, -201], "duration": 150, "fps": 24,
    "territories": {"source": "cliopatria", "names": ["Carthage", "Roman Republic"], "context": True},
    "routes": [{"label": "Hannibal", "colour": "#f0c46a", "points": [{"label": l, "lat": a, "lon": b, "year": y} for l, a, b, y in HANNIBAL_ROUTE]}],
    "cities": [{"name": "Rome", "lat": 41.9, "lon": 12.5}, {"name": "Carthage", "lat": 36.85, "lon": 10.32}, {"name": "Syracuse", "lat": 37.08, "lon": 15.29}, {"name": "Massalia", "lat": 43.3, "lon": 5.37}],
    "testing": TESTING, "tags": ["hannibal", "carthage", "rome", "punic war", "alps", "cannae", "zama", "route"],
    "sources": {"record": ["Polybius, Histories 3, 7–9, 15", "Livy, History of Rome 21–30"], "tradition": ["Livy 21.1: the boy Hannibal's oath"], "interpretation": []},
    "missing": ["war elephants climbing an Alpine pass in snow", "Numidian cavalry", "Carthaginian officers in council", "Balearic slingers", "Celtiberian infantry", "Gallic allies in the Po valley", "the fog ambush at Lake Trasimene", "Cannae: the double envelopment from above", "Hannibal on his last elephant, Surus"],
    "stops": [
        stop("New Carthage", 37.60, -0.98, BC(219, 4), "spring 219 BC", "record", "Polybius 3.13–15", "Hannibal, commander in Spain since 221 BC, readies Carthage's army.",
             [pd(f"{C}/f/f0/Benjamin_West_%281738-1820%29_-_The_Oath_of_Hannibal_-_RCIN_405417_-_Royal_Collection.jpg", "Benjamin West, The Oath of Hannibal (1770), Royal Collection — public domain", "Tradition (Livy 21.1): as a boy he swore enmity to Rome"),
              pd(f"{C}/6/6e/Carthage%2C_quarter_shekel%2C_237-209_BC%2C_SNG_BM_Spain_102.jpg", "Barcid quarter shekel, Spain 237–209 BC (CNG) — public domain", "Silver struck by the Barcids in Spain")], chapter="Spain"),
        stop("Saguntum", 39.68, -0.27, BC(219, 5), "219 BC · an eight-month siege", "record", "Polybius 3.17; Livy 21.7–15", "Rome's ally falls; Rome declares war.",
             [pd(f"{C}/9/91/Siege_of_Saguntum%2C_219_BC_%28M._Teruel%29.png", "Mariano Teruel, Siege of Saguntum — public domain"),
              pd(f"{C}/2/27/Quintus_Fabius_Maximus_Before_the_Senate_of_Carthage_Hermitage.jpg", "G. B. Tiepolo, Quintus Fabius Maximus before the Senate of Carthage — public domain", "An envoy offers the Carthaginian senate peace or war (Livy 21.18)")], chapter="Spain"),
        stop("Across the Ebro", 40.72, 0.86, BC(218, 6), "summer 218 BC", "record", "Polybius 3.35", "The army crosses into northern Spain.", [], chapter="The march"),
        stop("The Rhône", 43.95, 4.70, BC(218, 9), "September 218 BC", "record", "Polybius 3.42–46", "The elephants are floated across on earth-covered rafts.",
             [para("hannibal_rhone_motte", "Remake by Hathor Studio after Henri-Paul Motte, Hannibal crossing the Rhône (1878)"),
              pd(f"{C}/d/da/Carl_Emil_Doepler_-_The_elephants_crossing_the_Rhone%2C_218_BC.jpg", "Carl Emil Doepler, The elephants crossing the Rhône, 218 BC — public domain")], chapter="The march"),
        stop("The Alps", 45.20, 6.90, BC(218, 10), "October 218 BC", "debated", "Polybius 3.50–56; Livy 21.32–37", "Which pass he took is still argued: the Traversette, Mont Cenis, the Little St Bernard…",
             [para("hannibal_alps_poussin", "Remake by Hathor Studio after Nicolas Poussin, Hannibal crossing the Alps"),
              pd(f"{C}/6/60/Joseph_Mallord_William_Turner_-_Snow_Storm%2C_Hannibal_and_his_Army_Crossing_the_Alps_-_WGA23167.jpg", "J. M. W. Turner, Snow Storm: Hannibal and his Army Crossing the Alps (1812), Tate — public domain"),
              pd(f"{C}/c/cb/Hannibal_crossing_the_Alps_into_Italy.jpg", "Hannibal crossing the Alps into Italy, Ward, Lock (New York) — public domain")], chapter="The march", zoom=4),
        stop("The Ticinus", 45.20, 9.00, BC(218, 11) + 0.02, "November 218 BC", "record", "Polybius 3.65", "First clash in Italy: the consul Scipio is wounded.",
             [pd(f"{C}/b/b8/Scipio_Africanus_Major.jpg", "Scipio Africanus the Elder, engraving — public domain", "Tradition (Livy 21.46): his seventeen-year-old son saved him")], chapter="Italy"),
        stop("The Trebia", 45.00, 9.60, BC(218, 12), "December 218 BC", "record", "Polybius 3.72–74", "A winter river, an ambush, a Roman army broken.",
             [pd("https://live.staticflickr.com/1731/40896405400_8abd33bf8c_b.jpg", "War elephant, terracotta, Pompeii (2nd–1st c. BC), Naples MANN; photo Carlo Raso — public domain dedication", "A war elephant as Italians remembered it")], chapter="Italy"),
        stop("Lake Trasimene", 43.20, 12.10, BC(217, 6), "June 217 BC", "record", "Polybius 3.82–84; Livy 22.4–7", "Out of the morning mist on the lakeshore: the largest ambush in history.", [], chapter="Italy"),
        stop("Fabius' delay", 41.20, 14.00, BC(217, 8), "217 BC", "record", "Polybius 3.87–94", "Rome's dictator refuses battle and shadows Hannibal — 'the Delayer'.",
             [pd(f"{C}/a/ab/N26FabiusCunctator.jpg", "Statue of Fabius Maximus 'Cunctator', Vienna; photo schurl50 — public domain")], chapter="Italy"),
        stop("Cannae", 41.30, 16.10, BC(216, 8) + 0.003, "2 August 216 BC", "record", "Polybius 3.107–117; Livy 22.44–50", "A thinner centre, horsemen closing the ring: a Roman army encircled.",
             [pd(f"{C}/d/d8/Battle_of_Cannae_215_BC_-_Initial_Roman_attack-ar.png", "Battle of Cannae, plan (after the US Military Academy maps) — public domain", "The Roman attack into the Carthaginian centre"),
              pd(f"{C}/f/f1/Lodovico_Pogliaghi_-_Roman_women_in_the_temple_of_Mars_after_Cannae%2C_215_BC.png", "Lodovico Pogliaghi, Roman women in the temple of Mars after Cannae — public domain", "Rome in mourning")], chapter="Italy", zoom=4),
        stop("Capua", 41.10, 14.20, BC(216, 10), "216 BC", "record", "Livy 23.2–10", "Italy's second city goes over to Hannibal.",
             [pd(f"{C}/a/a3/Plan_of_the_first_battle_of_Capua.jpg", "T. A. Dodge, plan of the first battle of Capua (1891) — public domain"),
              pd(f"{C}/b/b4/Hannibal_Barca_bust_from_Capua_photo.jpg", "The 'Capuan bust', photo Fratelli Alinari — public domain", "Debated: whether this bust shows Hannibal at all")], chapter="Italy"),
        stop("Tarentum", 40.47, 17.24, BC(212, 2), "212 BC", "record", "Polybius 8.24–34", "The Greek city is taken by night; its citadel holds out.", [], chapter="Italy"),
        stop("Hannibal at the gates", 41.90, 12.50, BC(211, 4), "211 BC", "record", "Livy 26.7–11", "He marches on Rome itself, to draw its armies from Capua — and turns away.", [], chapter="Italy"),
        stop("Bruttium", 39.08, 17.12, BC(207, 6), "207–203 BC", "record", "Livy 28.46; Polybius 3.33", "Pinned in the toe of Italy, he leaves a bronze record of his army at the temple of Hera Lacinia.",
             [lib("landscapes/carthage_harbor.png", "Carthage's harbour, far away")], chapter="Italy"),
        stop("Zama", 36.29, 9.45, BC(202, 10), "October 202 BC", "record", "Polybius 15.5–16; Livy 30.29–35", "The two generals meet before the battle; Scipio and the Numidian horse win the day.",
             [pd(f"{C}/9/93/Hannibal_and_Scipio_Africanus.jpg", "Bernardino Cesari, Hannibal and Scipio Africanus — public domain", "The meeting before the battle (Polybius 15.6–8)"),
              pd(f"{C}/7/7d/Cornelis_Cort_-_The_Battle_of_Zama_-_1990.563_-_Art_Institute_of_Chicago.jpg", "Cornelis Cort after Giulio Romano, The Battle of Zama (1567), Art Institute of Chicago — public domain"),
              remake("masinissa_coin_portrait", caption="Masinissa, the Numidian king who rode with Rome")], chapter="Africa", zoom=4),
        stop("The peace of 201 BC", 36.85, 10.32, -201.0, "201 BC", "record", "Polybius 15.18", "Carthage keeps its city; its fleet is cut to ten ships.",
             [remake("carthage_cothon_military_harbour", caption="The round naval harbour, emptied")], chapter="Africa"),
    ],
}

COL_ROUTE = [
    ("Tyre", 33.27, 35.20, -1000.0), ("Kition", 34.92, 33.63, -850.0), ("Kommos", 35.01, 24.76, -820.0), ("Carthage", 36.85, 10.32, -814.0),
    ("Gades", 36.53, -6.29, -800.0), ("Nora", 38.98, 9.02, -790.0), ("Utica", 37.06, 10.06, -780.0), ("Lixus", 35.20, -6.11, -750.0),
    ("Motya", 37.87, 12.47, -720.0), ("Tharros", 39.87, 8.44, -700.0), ("Ebusus", 38.91, 1.44, -654.0), ("Mogador", 31.51, -9.77, -640.0),
]
phoenicians = {
    "id": "phoenician-colonies", "title": "The Phoenician Colonies & Carthage",
    "subtitle": "c. 1000 – 29 BC · the sea road from Tyre to the Atlantic, and the city that ruled it",
    "bbox": [-12, 28, 38, 46], "years": [-1100, -29], "duration": 130, "fps": 24,
    "territories": {"source": "cliopatria", "names": ["(Phoenician Empire)", "Carthage", "Roman Republic"], "context": True},
    "routes": [{"label": "The sea road", "colour": "#c46ae8", "points": [{"label": l, "lat": a, "lon": b, "year": y} for l, a, b, y in COL_ROUTE]}],
    "cities": [{"name": "Sidon", "lat": 33.56, "lon": 35.37}, {"name": "Byblos", "lat": 34.12, "lon": 35.65}, {"name": "Syracuse", "lat": 37.08, "lon": 15.29, "from": -733}, {"name": "Rome", "lat": 41.9, "lon": 12.5, "from": -753}],
    "testing": TESTING, "tags": ["phoenicians", "carthage", "tyre", "gades", "colonies", "tanit", "punic", "route"],
    "sources": {"record": ["Excavations at Tyre, Kition, Kommos, Carthage, Gades (Cádiz), Nora, Motya, Sa Caleta / Ebusus, Mogador", "Herodotus 7.165–167 (Himera)", "Diodorus 14.47–53 (Motya)", "Polybius 1–3; Appian, Punic Wars"],
                "tradition": ["Justin 18.4–6: Elissa (Dido) and the oxhide", "Velleius Paterculus 1.2: Gades founded 1104 BC", "Pliny, Natural History 16.216: Utica's temple of 1178 years"], "interpretation": []},
    "missing": ["Phoenician merchant ships (gauloi) under sail", "the island city of Tyre from the sea", "murex purple-dye workshops", "the temple of Melqart at Gades", "the cothon harbours seen from the sea at their height", "Motya on its lagoon island", "the Nora stone"],
    "stops": [
        stop("Tyre", 33.27, 35.20, -1000.0, "c. 1000 BC", "record", "Excavations at Tyre; 1 Kings 5", "The island city of Hiram, whose ships and purple dye reached the whole sea.",
             [remake("tyre_port", people="levantine"), remake("sidon_citadel", people="levantine", caption="Sidon, Tyre's sister city"),
              pd("https://tile.loc.gov/storage-services/service/pnp/matpc/17000/17020v.jpg", "Byblos, general view, American Colony photographers — Library of Congress, no known restrictions", "Byblos, the oldest of the three")], chapter="The sea road"),
        stop("Kition", 34.92, 33.63, -850.0, "late 9th century BC", "record", "Excavations at Kition (Larnaca)", "Cyprus: a Phoenician temple of Astarte on older foundations.", [], chapter="The sea road"),
        stop("Kommos", 35.01, 24.76, -820.0, "c. 800 BC", "record", "Excavations at Kommos, Crete", "A small shrine with three standing stones, a sailors' stop on the way west.", [], chapter="The sea road"),
        stop("Carthage", 36.85, 10.32, -814.0, "traditionally 814 BC", "tradition", "Justin 18.4–6; Timaeus via Dionysius", "Elissa of Tyre buys as much land as an oxhide covers — and cuts it into strips. The earliest finds date to the late 9th–8th century BC.",
             [remake("carthage_dido_building", people="punic", caption="Tradition: Dido building Carthage"), remake("carthage_aeneas_farewell_dido", caption="The later Roman story of Dido and Aeneas")], chapter="The sea road"),
        stop("Gades", 36.53, -6.29, -800.0, "c. 800 BC (tradition: 1104 BC)", "record", "Excavations in Cádiz; Velleius 1.2 (tradition)", "Beyond the Pillars of Heracles: the temple of Melqart, the westernmost Phoenician city.",
             [remake("cadiz_gades_hoefnagel")], chapter="The sea road"),
        stop("Nora", 38.98, 9.02, -790.0, "9th–8th century BC", "record", "The Nora stone", "Sardinia: an inscription that may be the oldest Phoenician writing in the west.", [], chapter="The sea road"),
        stop("Utica", 37.06, 10.06, -780.0, "8th century BC (tradition: older than Carthage)", "record", "Excavations at Utica; Pliny NH 16.216 (tradition)", "Carthage's older neighbour on the same gulf.",
             [pd(f"{C}/0/00/GRAHAM%281887%29_p085_RUINS_OF_UTICA.jpg", "Ruins of Utica, engraving in Graham (1887) — public domain")], chapter="The sea road"),
        stop("Lixus", 35.20, -6.11, -750.0, "8th century BC", "record", "Excavations at Lixus, Morocco", "On the Atlantic coast of Africa, where later writers placed the garden of the Hesperides.", [], chapter="The sea road"),
        stop("Motya", 37.87, 12.47, -720.0, "late 8th century BC", "record", "Excavations at Motya (Mozia)", "A small island in a Sicilian lagoon, joined to the shore by a causeway.", [], chapter="The sea road"),
        stop("Ebusus", 38.91, 1.44, -654.0, "7th century BC (tradition: 654 BC)", "record", "Sa Caleta excavations; Diodorus 5.16 (tradition)", "Ibiza: a Phoenician and then Carthaginian port.",
             [lib("objects/punic_amphora.png", "A Punic amphora — the trade that tied the colonies together")], chapter="The sea road"),
        stop("Mogador", 31.51, -9.77, -640.0, "7th–6th century BC", "record", "Excavations at Mogador (Essaouira)", "The farthest Phoenician outpost found on the Atlantic.", [], chapter="The sea road"),
        stop("Carthage rises", 36.85, 10.32, -550.0, "6th century BC", "record", "Justin 18.7–19.1", "The Magonid generals turn a colony into a sea power with its own colonies.",
             [remake("carthage_linton"), lib("landscapes/carthage_harbor.png", "Carthage's harbour")], chapter="Carthage"),
        stop("Himera", 37.97, 13.82, -480.0, "480 BC", "record", "Herodotus 7.165–167; Diodorus 11.20–26", "Carthage fights the Greeks for Sicily and loses a great battle.", [], chapter="Carthage"),
        stop("Tanit and Baal Hammon", 36.85, 10.32, -450.0, "5th–2nd century BC", "debated", "The tophet of Carthage (excavations); Diodorus 20.14", "Thousands of urns and stelae to Tanit and Baal Hammon: whether they record child sacrifice or a cemetery for infants is still argued.",
             [lib("objects/punic_tanit_stele.png", "A stele with the sign of Tanit"), remake("carthage_salammbo_temple_steps", caption="A 19th-century imagining (after Flaubert's Salammbô), not the record")], chapter="Carthage"),
        stop("Motya falls", 37.87, 12.47, -397.0, "397 BC", "record", "Diodorus 14.47–53", "Dionysius of Syracuse storms the island city.", [], chapter="Carthage"),
        stop("The cothon", 36.85, 10.32, -220.0, "3rd–2nd century BC", "record", "Excavations at the Punic ports; Appian, Punic Wars 96", "A rectangular merchant harbour leading to a round naval harbour with sheds for some 220 warships and an admiral's island.",
             [remake("carthage_punic_ports_aerial"), remake("carthage_cothon_military_harbour"), remake("carthage_cothon_from_byrsa")], chapter="Carthage"),
        stop("The Punic Wars", 36.85, 10.32, -218.0, "264–146 BC", "record", "Polybius 1–3", "Sicily, then Spain and Italy — see 'Hannibal: Across the Map'.",
             [remake("hannibal_alps_poussin", caption="Hannibal's march, 218 BC")], chapter="Rome"),
        stop("Carthage destroyed", 36.85, 10.32, -146.0, "146 BC", "record", "Appian, Punic Wars 127–135; Polybius 38.21–22", "After a three-year siege the city is taken street by street and burned.",
             [pd(f"{C}/e/e2/Richard_Henry_Brock%CB%90_The_siege_of_Carthage_146_BC_-_Roman_soldiers_entering_Carthage.jpg", "Richard Henry Brock, The siege of Carthage, 146 BC — public domain"),
              pd(f"{C}/c/c1/Catapulta_by_Edward_Poynter.jpg", "Edward Poynter, The Catapult (1868) — public domain"), remake("carthage_decline_of_empire", caption="Turner's Decline of the Carthaginian Empire")], chapter="Rome"),
        stop("Roman Carthage", 36.85, 10.32, -29.0, "44–29 BC", "record", "Appian, Punic Wars 136; Cassius Dio 43.50", "Caesar plans and Augustus founds a Roman colony on the ruins; Byrsa hill is levelled for its forum.",
             [remake("carthage_byrsa_hill")], chapter="Rome"),
    ],
}

for job in (hannibal, phoenicians):
    json.dump(job, open(f"{job['id']}.json", "w"), indent=1, ensure_ascii=False)
    print(job["id"], len(job["stops"]), "stops,", sum(len(s["media"]) for s in job["stops"]), "pictures")
