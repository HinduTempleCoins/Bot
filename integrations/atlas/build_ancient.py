"""AADR annotation -> compact JSON for the /atlas page: ancient individuals only (date > 0), with coordinates.
Fields: [id, group, locality, country, lat, lon, dateBP, sex, Y (ISOGG or terminal), mt, roh20cM, publication]."""
import csv, json, re, sys
src = "/opt/melek-gen/dna-reader/ref/aadr_HO.anno"; out = "/opt/melek-gen/atlas/out/ancient.json"
rows = []
def num(x):
    try: return float(x)
    except Exception: return None
with open(src, newline="", encoding="utf-8", errors="replace") as f:
    r = csv.reader(f, delimiter="\t"); next(r)
    for c in r:
        if len(c) < 40: continue
        d, lat, lon = num(c[10]), num(c[17]), num(c[18])
        if not d or d <= 0 or lat is None or lon is None: continue
        y = (c[36] if c[36] not in ("", "..", "n/a") else c[35] if c[35] not in ("", "..", "n/a") else c[34]).strip()
        y = "" if y.lower().startswith(("n/a", "..", "na")) or "female" in y.lower() else y
        mt = c[38].strip(); mt = "" if mt in ("..", "n/a", "na") else mt
        roh = num(c[32])
        rows.append([c[2], c[14], c[15], c[16], round(lat, 3), round(lon, 3), int(d), c[30][:1], y, mt, round(roh, 1) if roh else 0, c[6][:40]])
meta = {"source": "Allen Ancient DNA Resource (AADR) v66, Human Origins annotation — Mallick et al. 2024, Scientific Data", "licence": "CC BY 4.0",
        "fields": ["id", "group", "locality", "country", "lat", "lon", "dateBP", "sex", "Y", "mt", "roh20cM", "publication"], "count": len(rows)}
json.dump({"meta": meta, "rows": rows}, open(out, "w"), separators=(",", ":"), ensure_ascii=False)
ys = sum(1 for x in rows if x[8]); mts = sum(1 for x in rows if x[9]); roh = sum(1 for x in rows if x[10] > 50)
print(f"{len(rows)} ancient individuals; with Y {ys}; with mt {mts}; ROH>50cM (close-kin parents likely) {roh}")
