"""gen_arrowheads.py — writes the arrowheads / bow time-map (clips/time-arrowheads.json) and its per-item sources
(../data/arrowheads/SOURCES.md, citations.json). Each point is a dated site or find from the cited literature; routes are
one current model of spread, not tracks; every date is an estimate; debated items are labelled on screen.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "arrowheads"); os.makedirs(OUT, exist_ok=True)
C = {}


def pt(label, lat, lon, year, kind, caption, source):
    C.setdefault(label, source)
    return {"label": label, "lat": lat, "lon": lon, "year": year, "kind": kind, "caption": caption, "source": source, "hold": 4, "zoom": 3.0}


def route(label, colour, pts):
    return {"label": label, "colour": colour, "points": [{"label": p[0], "lat": p[1], "lon": p[2], "year": float(p[3])} for p in pts]}


P = [
    pt("Pinnacle Point microliths (debated)", -34.2, 22.09, -71000, "debated", "Tiny backed blades that may have tipped arrows or darts", "Brown et al. 2012 Nature 491:590"),
    pt("Sibudu points (debated)", -29.52, 31.08, -64000, "debated", "Impact scars and residues suggest bow-and-arrow use ~64 ka", "Lombard 2011 J Hum Evol 61:635; Lombard & Phillipson 2010 Antiquity 84:635"),
    pt("Aterian tanged points", 31.0, -3.0, -60000, "record", "Tanged points of North Africa (~145–30 ka range)", "Scerri 2013 Quat Sci Rev 70:3; Richter et al. 2010"),
    pt("Grotte Mandrin points (debated)", 44.49, 4.78, -54000, "debated", "Tiny points read as the oldest arrows in Europe", "Metz et al. 2023 Sci Adv 9:eadd4675"),
    pt("Solutrean leaf points", 46.3, 4.5, -22000, "record", "Pressure-flaked laurel-leaf points", "Smith 1966 Le Solutréen en France"),
    pt("Magdalenian harpoons", 43.0, 0.5, -15000, "record", "Barbed antler harpoon heads", "Julien 1982 Les harpons magdaléniens"),
    pt("Stellmoor arrows", 53.62, 10.2, -12000, "record", "Pine arrow shafts with tanged flint points", "Rust 1943; Rozoy 1992"),
    pt("Clovis", 34.3, -103.3, -13000, "record", "Fluted spear points", "Waters & Stafford 2007 Science 315:1122"),
    pt("Folsom", 36.8, -104.0, -12700, "record", "Fluted points with extinct bison", "Meltzer 2006 Folsom"),
    pt("Dalton", 36.0, -91.0, -12000, "record", "Dalton points of the Southeast", "Goodyear 1982 Am Antiq 47:382"),
    pt("Holmegaard bows", 55.28, 11.8, -9000, "record", "The oldest complete bows, elm, ~7000 BC", "Troels-Smith; Junkmanns 2013 Pfeil und Bogen"),
    pt("Neolithic tanged & barbed points", 51.0, -1.8, -4500, "record", "Barbed-and-tanged flint arrowheads of Beaker Britain", "Green 1980 BAR 75"),
    pt("Ötzi's quiver", 46.78, 10.84, -5300, "record", "Quiver with 14 arrows and an unfinished yew bow", "Spindler 1994 The Man in the Ice; Wierer et al. 2018 PLOS ONE 13:e0198292"),
    pt("Bronze socketed arrowheads", 36.1, 114.3, -3200, "record", "Cast bronze arrowheads of the Shang", "Keightley 1999 in Cambridge History of Ancient China"),
    pt("Scythian trilobate bronze points", 47.0, 35.0, -2600, "record", "Three-bladed socketed bronze points", "Cernenko 2012 The Scythians 700–300 BC (Osprey); Rolle 1989"),
    pt("Iron arrowheads", 50.0, 10.0, -2500, "record", "Iron points of the Iron Age across Eurasia", "Snodgrass 1980 in The Coming of the Age of Iron"),
    pt("The bow reaches the Plains & Southwest", 38.0, -104.0, -2500, "interpretation", "Bow and arrow replace the atlatl ~2,500–1,500 years ago (one model)", "Blitz 1988 Am Antiq 53:123; Bettinger & Eerkens 1999 Am Antiq 64:231"),
]
P.sort(key=lambda s: s["year"])
R = [
    route("Points out of Africa (one model)", "#c9a86a", [("South Africa", -29.52, 31.08, -64000), ("Maghreb", 31, -3, -60000), ("Rhône", 44.49, 4.78, -54000)]),
    route("The bow in the Americas (one model)", "#80d0e0", [("Arctic", 66, -150, -4500), ("Great Basin", 40, -117, -2000), ("Plains", 38, -104, -1800), ("Southeast", 34, -86, -1300)]),
]
C["routes"] = "Lombard 2011; Metz 2023; Blitz 1988; Bettinger & Eerkens 1999"
job = {"id": "time-arrowheads", "fps": 24, "palette": "night", "timeMode": "ago", "timeScale": "log",
       "note": "Alpha · dates are scholarly estimates with uncertainty · one current model · debated items labelled",
       "endNote": "Dates are scholarly estimates with uncertainty; routes are one current model. Sources: integrations/maps/data/arrowheads/SOURCES.md.",
       "testing": "We are testing these features and looking to develop them.",
       "title": "The Point: Arrowheads and the Bow", "subtitle": "~71,000 years ago to the Iron Age · dates are estimates", "bbox": [-180, -58, 180, 78],
       "years": [-75000, -2000], "duration": 100,
       "cities": [{"name": s["label"], "lat": s["lat"], "lon": s["lon"], "from": s["year"], "to": 0} for s in P],
       "routes": R, "stops": P, "tags": ["time-mapped", "arrowheads", "bow", "stone-tools", "technology"],
       "credit": "Lombard 2011; Brown 2012; Metz 2023; Scerri 2013; Waters 2007; Wierer 2018; Blitz 1988. Base map: Natural Earth (public domain)."}
json.dump(job, open(os.path.join(HERE, "time-arrowheads.json"), "w"), indent=1, ensure_ascii=False)
json.dump({"note": "dates approximate", "items": C}, open(os.path.join(OUT, "citations.json"), "w"), indent=1, ensure_ascii=False)
lines = ["# Arrowheads and the bow — sources (Alpha)\n", "Generated by `integrations/maps/clips/gen_arrowheads.py`. Dated finds are **record**; items marked **debated** or **model** are labelled on screen. Every date is an estimate.\n"]
for s in P:
    lines.append(f"- **{s['label']}**" + {"debated": " — **debated**", "interpretation": " — **model**"}.get(s["kind"], "") + f": {s['source']}")
lines.append(f"\n- Routes: {C['routes']}")
open(os.path.join(OUT, "SOURCES.md"), "w").write("\n".join(lines) + "\n")
print("ok", len(C))
