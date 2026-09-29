"""genai_concepts.py — learned concept recognizers for the whole Studio (the "retina study" method).

The operator's model: an AI shown thousands of retina photos learned to tell male from female eyes with ~90%
accuracy and nobody could say how — it found features no one could put into words. We do the same for every
Studio concept (a character like Hathor or Anpu, an era people, an object like a wax headcone, an aesthetic
like VR-vaporwave, a template/effect): collect EXAMPLES, and let a model LEARN what makes that concept itself.

Each recognizer = CLIP image fingerprints (ViT-B-32, CPU) + a small classifier trained on positives vs negatives.
Uses:
  - QA GATE: reject an output that drifted off its concept before a customer ever sees it.
  - AUTO-TAGGER: sort uploads / outputs into concepts.
  - KEEPS LEARNING: every image a customer keeps/posts becomes a new positive; `train` again.

CLI (all CPU, on our box):
  python genai_concepts.py train <concept> --pos DIR_OR_FILES... --neg DIR_OR_FILES...
  python genai_concepts.py score <concept> IMAGE...
  python genai_concepts.py list
Models are saved under $CONCEPTS_DIR (default: concepts/ beside this script). Embedder is injectable for tests.
"""
import argparse, json, os, pickle, sys, time
_HOME = os.environ.get("MELEK_GEN_HOME", os.path.dirname(os.path.abspath(__file__)))

CONCEPTS_DIR = os.environ.get("CONCEPTS_DIR", os.path.join(_HOME, "concepts"))
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp")

_embedder = None


def set_embedder(fn):
    """fn(list[PIL.Image]) -> list[list[float]] (unit-normalised). Tests inject a fake."""
    global _embedder
    _embedder = fn


def _clip_embedder():
    import torch, open_clip
    torch.set_num_threads(int(os.environ.get("CONCEPTS_THREADS", "4")))
    model, _, pre = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")
    model.eval()

    def embed(images):
        out = []
        with torch.no_grad():
            for i in range(0, len(images), 16):
                batch = torch.stack([pre(im.convert("RGB")) for im in images[i:i + 16]])
                f = model.encode_image(batch)
                f = f / f.norm(dim=-1, keepdim=True)
                out.extend(f.tolist())
        return out
    return embed


def embed(images):
    global _embedder
    if _embedder is None:
        _embedder = _clip_embedder()
    return _embedder(images)


def expand(paths):
    files = []
    for p in paths:
        if os.path.isdir(p):
            files += sorted(os.path.join(p, f) for f in os.listdir(p) if f.lower().endswith(IMG_EXT))
        elif os.path.isfile(p) and p.lower().endswith(IMG_EXT):
            files.append(p)
    return files


def load_images(files):
    from PIL import Image
    ims, ok = [], []
    for f in files:
        try:
            ims.append(Image.open(f).convert("RGB")); ok.append(f)
        except Exception:
            pass
    return ims, ok


def train(concept, pos_files, neg_files, out_dir=CONCEPTS_DIR):
    """Train a recognizer. Returns a report incl. cross-validated accuracy on the examples we have."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score, StratifiedKFold
    pos_ims, pos_ok = load_images(pos_files)
    neg_ims, neg_ok = load_images(neg_files)
    if len(pos_ims) < 2 or len(neg_ims) < 2:
        return {"ok": False, "error": f"need >=2 positives and negatives (got {len(pos_ims)}/{len(neg_ims)})"}
    X = embed(pos_ims) + embed(neg_ims)
    y = [1] * len(pos_ims) + [0] * len(neg_ims)
    clf = LogisticRegression(max_iter=2000, class_weight="balanced", C=1.0)
    folds = min(5, len(pos_ims), len(neg_ims))
    cv = cross_val_score(clf, X, y, cv=StratifiedKFold(n_splits=folds, shuffle=True, random_state=0)) if folds >= 2 else []
    clf.fit(X, y)
    os.makedirs(out_dir, exist_ok=True)
    rec = {"concept": concept, "clf": clf, "n_pos": len(pos_ims), "n_neg": len(neg_ims),
           "cv_accuracy": float(sum(cv) / len(cv)) if len(cv) else None, "trained": time.time(),
           "pos_files": pos_ok, "neg_files": neg_ok}
    with open(os.path.join(out_dir, f"{concept}.pkl"), "wb") as fh:
        pickle.dump(rec, fh)
    return {"ok": True, "concept": concept, "n_pos": rec["n_pos"], "n_neg": rec["n_neg"], "cv_accuracy": rec["cv_accuracy"]}


def load(concept, out_dir=CONCEPTS_DIR):
    with open(os.path.join(out_dir, f"{concept}.pkl"), "rb") as fh:
        return pickle.load(fh)


def score(concept, files, out_dir=CONCEPTS_DIR):
    """Probability each image IS the concept (0..1)."""
    rec = load(concept, out_dir)
    ims, ok = load_images(files)
    if not ims:
        return []
    probs = rec["clf"].predict_proba(embed(ims))[:, 1]
    return [{"file": f, "p": round(float(p), 4)} for f, p in zip(ok, probs)]


def gate(concept, files, threshold=0.5, out_dir=CONCEPTS_DIR):
    """QA gate: split outputs into pass / reject for a concept."""
    res = score(concept, files, out_dir)
    return {"pass": [r for r in res if r["p"] >= threshold], "reject": [r for r in res if r["p"] < threshold]}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("train"); t.add_argument("concept"); t.add_argument("--pos", nargs="+", required=True); t.add_argument("--neg", nargs="+", required=True)
    s = sub.add_parser("score"); s.add_argument("concept"); s.add_argument("images", nargs="+")
    sub.add_parser("list")
    a = ap.parse_args(argv)
    if a.cmd == "train":
        print(json.dumps(train(a.concept, expand(a.pos), expand(a.neg))))
    elif a.cmd == "score":
        for r in score(a.concept, expand(a.images)):
            print(f"{r['p']:.3f}  {os.path.basename(r['file'])}")
    else:
        for f in sorted(os.listdir(CONCEPTS_DIR)) if os.path.isdir(CONCEPTS_DIR) else []:
            if f.endswith(".pkl"):
                r = load(f[:-4])
                print(f"{r['concept']:24s} pos={r['n_pos']} neg={r['n_neg']} cv={r['cv_accuracy']}")


if __name__ == "__main__":
    main()
