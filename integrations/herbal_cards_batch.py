"""herbal_cards_batch.py — render the herbal / gem / god-correspondence card set (knowledge/herbal-cards/cards.json)
on our CPU image pool (:8510) as BACKGROUND work: every job is sent with "priority":"low", so the worker runs customer
(Studio) jobs first, and this script never puts more than --inflight jobs on the pool at once. That cap matters: the
worker forgets a job record 30 min after it was created, so dumping 80 jobs on the queue would lose the later results.
It also waits while customers are queued (pool /health "queued" > 0) and while the production pause flag exists.

  python herbal_cards_batch.py --cards cards.json --out /opt/melek-gen/herbal-cards/out --token-file /etc/melek-bot/sd-pool.env

Each card has two prompts ("ours" = one of our registers, "pinterest" = a common Pinterest/Instagram witchy style).
Outputs: <out>/<card>__<variant>.png + .json sidecar (prompt, seed, job id, backend, ms), and <out>/ledger.jsonl
(one line per submit / finish, with the pool job id). Finished files are skipped, so re-running is safe.
Labels are NOT rendered (SD draws text badly): prompts ask for blank banners; the words are overlaid later.
Tests: python -m unittest integrations/test_herbal_cards_batch.py   (offline; the HTTP call is injected)
"""
import argparse, base64, json, os, time, urllib.request

NEG = ("text, letters, words, writing, captions, watermark, signature, logo, blurry, low quality, deformed, "
       "extra limbs, bad hands, photo frame, nsfw")


def token_from(path):
    for line in open(path):
        k, _, v = line.strip().partition("=")
        if k in ("SD_POOL_TOKEN", "CPU_SD_TOKEN") and v:
            return v.strip()
    raise SystemExit(f"no SD_POOL_TOKEN / CPU_SD_TOKEN in {path}")


def make_call(pool, tok):
    def call(method, path, body=None):
        req = urllib.request.Request(pool.rstrip("/") + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"authorization": f"Bearer {tok}", "content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"{}")
            except Exception:
                return e.code, {}
        except Exception as e:  # soft-fail: caller backs off
            return 0, {"ok": False, "error": type(e).__name__}
    return call


def todo_list(cards, out):
    items = []
    for c in cards:
        for variant in ("ours", "pinterest"):
            p = (c.get("prompts") or {}).get(variant)
            if not p or os.path.exists(os.path.join(out, f"{c['id']}__{variant}.png")):
                continue
            items.append({"key": f"{c['id']}__{variant}", "card": c["id"], "variant": variant, "style": p.get("style", ""),
                          "body": {"prompt": p["prompt"], "negativePrompt": p.get("negative") or NEG, "steps": 6,
                                   "seed": int(c.get("seed", 4242)), "size": c.get("size", "512x768"), "priority": "low",
                                   **({"character": p["character"]} if p.get("character") else {})}})
    return items


def log(out, rec):
    with open(os.path.join(out, "ledger.jsonl"), "a") as f:
        f.write(json.dumps({**rec, "at": int(time.time())}) + "\n")


def customers_waiting(call):
    code, h = call("GET", "/health")
    return code != 200 or not h.get("ok") or int(h.get("queued") or 0) > 0


def run(cards, out, call, inflight=2, poll=10, pause_file="", sleep=time.sleep, max_loops=10 ** 7):
    os.makedirs(out, exist_ok=True)
    queue_, running, done, failed = todo_list(cards, out), {}, 0, 0
    for _ in range(max_loops):
        if not queue_ and not running:
            break
        paused = bool(pause_file) and os.path.exists(pause_file)
        while queue_ and len(running) < inflight and not paused and not customers_waiting(call):
            it = queue_.pop(0)
            code, r = call("POST", "/jobs", it["body"])
            if not r.get("id"):
                queue_.insert(0, it)
                log(out, {"key": it["key"], "event": "submit-failed", "code": code, "error": r.get("error")})
                sleep(60)
                break
            running[r["id"]] = {**it, "tries": it.get("tries", 0)}
            log(out, {"key": it["key"], "event": "submitted", "job": r["id"], "backend": r.get("backend"), "position": r.get("position")})
        sleep(poll)
        for jid in list(running):
            it = running[jid]
            code, st = call("GET", f"/jobs/{jid}")
            status = st.get("status")
            if status in ("queued", "running"):
                continue
            del running[jid]
            res = st.get("result") or {}
            if status == "done" and res.get("ok") and res.get("base64"):
                f = os.path.join(out, f"{it['key']}.png")
                with open(f, "wb") as fh:
                    fh.write(base64.b64decode(res["base64"]))
                with open(f[:-4] + ".json", "w") as fh:
                    json.dump({"card": it["card"], "variant": it["variant"], "style": it["style"], "prompt": it["body"]["prompt"],
                               "seed": res.get("seed"), "job": jid, "ms": res.get("ms"), "made": int(time.time())}, fh)
                log(out, {"key": it["key"], "event": "done", "job": jid, "ms": res.get("ms")})
                done += 1
            else:  # error, or the record expired/unknown: retry once, then give up on it
                log(out, {"key": it["key"], "event": "error", "job": jid, "status": status, "error": res.get("error") or st.get("error")})
                if it["tries"] < 1:
                    queue_.append({**it, "tries": it["tries"] + 1})
                else:
                    failed += 1
    return {"done": done, "failed": failed, "left": len(queue_) + len(running)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cards", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--pool", default=os.environ.get("SD_POOL_URL", "http://127.0.0.1:8510"))
    ap.add_argument("--token-file", default=os.environ.get("CPU_SD_ENV_FILE", "/etc/melek-bot/sd-pool.env"))
    ap.add_argument("--inflight", type=int, default=2, help="max jobs on the pool at once (one per backend)")
    a = ap.parse_args()
    cards = json.load(open(a.cards))["cards"]
    r = run(cards, a.out, make_call(a.pool, token_from(a.token_file)), inflight=a.inflight,
            pause_file=os.environ.get("PRODUCTION_PAUSE_FILE", ""))
    print(f"herbal cards: {r}", flush=True)


if __name__ == "__main__":
    main()
