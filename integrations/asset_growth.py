"""asset_growth.py — grow Hathor's parts library from what the films say is missing.

  python asset_growth.py --root /opt/melek-gen --n 10

Reads <root>/asset-growth/queue.jsonl (one {"want": "...", "docId": "...", "at": ...} per line — appended by the worker
when a documentary names assets it wants), renders each missing asset ONCE on the local CPU image worker at LOW
priority (never ahead of customers), in several peoples for characters, annotates characters with pose keypoints
(genai_annotate.py) so they can move, and files them in <root>/library/grown/ with a json description the shot planner
and the character-scene maker search. Hathor herself is never rendered here (her look comes only from character mode).
No LoRA training.
"""
import argparse, base64, json, os, re, subprocess, sys, time, urllib.request

PEOPLES = [("olive", "olive-skinned Mediterranean"), ("brown", "brown-skinned North African"), ("dark", "dark-skinned Nubian")]
CHAR_WORDS = re.compile(r"\b(priest|priestess|queen|king|pharaoh|archangel|angel|watcher|enoch|noah|solon|critias|timaeus|nausicaa|companions|odysseus|giant|immortal|warrior|soldier|scribe|seraph|cherub|figure|men|women|spirits?)\b", re.I)
PLACE_WORDS = re.compile(r"\b(city|mountain|palace|temple|pillars|gates|river|waters|valley|abyss|forge|harbour|harbor|island|sky|prison|house|ark)\b", re.I)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


def kind_of(want):
    if re.search(r"\bhathor\b", want, re.I):
        return None  # Hathor only via character mode, never grown from text
    if CHAR_WORDS.search(want) and not re.search(r"\b(temple|palace|city|gates)\b", want, re.I):
        return "character"
    if PLACE_WORDS.search(want):
        return "landscape"
    return "object"


def prompt_for(want, kind, people=""):
    if kind == "character":
        return (f"{want}, {people} ".strip() + ", full figure standing, ancient clothing and regalia as described in the ancient texts, "
                "plain neutral background, soft studio light, highly detailed, cinematic")
    if kind == "landscape":
        return f"{want}, ancient world, wide establishing view, atmospheric light, eerie and majestic, highly detailed, cinematic"
    return f"{want}, a single ancient object, plain neutral background, museum lighting, highly detailed"


def sd_job(tok, body):
    def call(m, p, b=None):
        req = urllib.request.Request(f"http://127.0.0.1:8510{p}", method=m, data=json.dumps(b).encode() if b else None,
                                     headers={"authorization": f"Bearer {tok}", "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    jid = call("POST", "/jobs", body)["id"]
    while True:
        time.sleep(10)
        st = call("GET", f"/jobs/{jid}")
        if st["status"] in ("done", "error"):
            return st.get("result") or {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/opt/melek-gen")
    ap.add_argument("--n", type=int, default=10, help="assets (not images) per run")
    ap.add_argument("--token-file", default=os.environ.get("CPU_SD_ENV_FILE", ""), help="env file holding CPU_SD_TOKEN")
    a = ap.parse_args()
    tok = [l.split("=", 1)[1].strip() for l in open(a.token_file) if l.startswith("CPU_SD_TOKEN=")][0]
    qf = os.path.join(a.root, "asset-growth", "queue.jsonl")
    out = os.path.join(a.root, "library", "grown")
    os.makedirs(out, exist_ok=True)
    wants, seen = [], set()
    for line in (open(qf) if os.path.exists(qf) else []):
        try:
            w = json.loads(line)
        except Exception:
            continue
        s = slug(w.get("want", ""))
        if s and s not in seen:
            seen.add(s)
            wants.append(w)
    done = 0
    for w in wants:
        if done >= a.n:
            break
        want, s = w["want"], slug(w["want"])
        kind = kind_of(want)
        if kind is None:
            continue
        variants = PEOPLES if kind == "character" else [("", "")]
        todo = [(p, words) for p, words in variants if not os.path.exists(os.path.join(out, f"{s}{'_' + p if p else ''}.png"))]
        if not todo:
            continue
        for p, words in todo:
            size = "512x768" if kind == "character" else ("768x512" if kind == "landscape" else "512x512")
            res = sd_job(tok, {"prompt": prompt_for(want, kind, words), "negativePrompt": "text, watermark, modern clothing, halo, cartoon, blurry, deformed, extra limbs, nudity",
                               "steps": 6, "seed": 17, "size": size, "priority": "low"})
            if not res.get("ok"):
                print(f"{s} {p}: {res.get('error')}", flush=True)
                continue
            f = os.path.join(out, f"{s}{'_' + p if p else ''}.png")
            open(f, "wb").write(base64.b64decode(res["base64"]))
            json.dump({"name": want, "kind": kind, "desc": want, "era": "ancient", "tags": [w.get("docId", "")], "people": p, "made": int(time.time())}, open(f[:-4] + ".json", "w"))
            if kind == "character":
                subprocess.run([sys.executable, os.path.join(a.root, "genai_annotate.py"), f], capture_output=True, text=True)
            print(f"grown {os.path.basename(f)} ({kind})", flush=True)
        done += 1
    print(f"asset growth: {done} assets this run, {len(wants)} wanted in total")


if __name__ == "__main__":
    main()
