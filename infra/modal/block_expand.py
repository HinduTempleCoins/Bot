# block_expand.py — LLaMA-Pro-style block expansion of Qwen3-0.6B-Base on Modal (READY, NOT RUN).
#
# Build notes 2026-09-26 ("Growing" + "Key warning: forgetting" + "Build roadmap"):
#   * Copy existing decoder blocks and insert the copies; zero each copy's output projections
#     (self_attn.o_proj, mlp.down_proj) so the residual stream passes through unchanged — the expanded
#     model starts out computing exactly what the base computed.
#   * Freeze the original layers (and embeddings / lm_head); train ONLY the new blocks on our corpus.
#   * RULE: always mix ~20% general text into the training data. The Aug-2026 test on this exact base
#     (28 -> 35 layers) showed the new layers learning the corpus but general text degrading badly
#     (wikitext-2 ppl 14.11 -> 21.00) unless ~20% general text was mixed in (-> 13.18).
#   * Measure learning vs forgetting with held-out perplexity before/after on (a) our corpus and
#     (b) general text (wikitext-2 test).
#
# Conventions follow infra/modal/finetune.py: env overrides, one @app.function doing the GPU work, results
# persisted to a Modal volume, a local_entrypoint that uploads the dataset text.
#
# Run (only after the operator approves the GPU budget — a 0.6B expansion is ~1-2 A10G hours):
#   modal run infra/modal/block_expand.py --corpus path/to/corpus.jsonl      # {"text": ...} per line, or .txt
#   # expanded model + report.json land in the 'hathor-block-expand' volume; the report carries per-file
#   # sha256 for integrations/model-lineage.mjs (method: block-expansion, parent: hf:Qwen/Qwen3-0.6B-Base).

import os

import modal

BASE_MODEL = os.environ.get("BX_BASE_MODEL", "Qwen/Qwen3-0.6B-Base")
GPU = os.environ.get("BX_GPU", "A10G")
EXPAND_EVERY = int(os.environ.get("BX_EXPAND_EVERY", "4"))  # 28 layers / 4 -> +7 blocks -> 35 layers
GENERAL_RATIO = float(os.environ.get("BX_GENERAL_RATIO", "0.20"))  # the ~20% rule; do not set to 0
SEQ_LEN = int(os.environ.get("BX_SEQ_LEN", "1024"))
MAX_STEPS = int(os.environ.get("BX_MAX_STEPS", "1000"))
LR = float(os.environ.get("BX_LR", "2e-4"))
HELDOUT_FRAC = float(os.environ.get("BX_HELDOUT_FRAC", "0.05"))
EVAL_MAX_TOKENS = int(os.environ.get("BX_EVAL_MAX_TOKENS", "200000"))  # caps perplexity cost
OUT_NAME = os.environ.get("BX_OUT", "hathor-qwen3-0.6b-bx")
SEED = int(os.environ.get("BX_SEED", "1234"))

image = modal.Image.debian_slim().pip_install(
    "torch", "transformers>=4.51", "datasets", "accelerate", "safetensors"
)
app = modal.App("hathor-block-expand")
vol = modal.Volume.from_name("hathor-block-expand", create_if_missing=True)


# ── pure helpers (no GPU) ────────────────────────────────────────────────────────────────────────────
def parse_corpus(text):
    """Accept JSONL ({"text": ...} per line) or plain text (blank-line separated docs)."""
    import json

    lines = [l for l in text.splitlines() if l.strip()]
    if lines and all(l.lstrip().startswith("{") for l in lines[:5]):
        docs = []
        for l in lines:
            try:
                t = json.loads(l).get("text", "")
            except Exception:
                continue
            if t and t.strip():
                docs.append(t)
        return docs
    return [d.strip() for d in text.split("\n\n") if d.strip()]


def split_heldout(docs, frac, seed):
    """Deterministic doc-level split so held-out text is never trained on."""
    import random

    idx = list(range(len(docs)))
    random.Random(seed).shuffle(idx)
    n_held = max(1, int(len(docs) * frac)) if len(docs) > 1 else 0
    held = [docs[i] for i in idx[:n_held]]
    train = [docs[i] for i in idx[n_held:]]
    return train, held


def n_general_blocks(n_corpus_blocks, ratio):
    """Number of general-text blocks so general = ratio of the final mix (0.2 -> 1 general per 4 corpus)."""
    if ratio <= 0:
        return 0
    return int(round(n_corpus_blocks * ratio / (1.0 - ratio)))


def expansion_positions(n_layers, every):
    """Indices (in the ORIGINAL stack) after which a copy is inserted: after layers every-1, 2*every-1, ..."""
    return [i for i in range(n_layers) if (i + 1) % every == 0]


# ── model surgery ────────────────────────────────────────────────────────────────────────────────────
def expand_blocks(model, every):
    """Insert a zero-output copy after every `every`-th decoder layer. Returns the new-layer indices.

    Each copy is a deepcopy of the block it follows (LLaMA Pro), with self_attn.o_proj and mlp.down_proj
    zeroed: attention and MLP both add 0 to the residual stream, so the block is an exact identity at init.
    Freezes everything, then unfreezes only the new blocks.
    """
    import copy

    import torch

    layers = model.model.layers
    n = len(layers)
    after = set(expansion_positions(n, every))
    new_layers, new_idx = [], []
    for i, layer in enumerate(layers):
        new_layers.append(layer)
        if i in after:
            blk = copy.deepcopy(layer)
            with torch.no_grad():
                blk.self_attn.o_proj.weight.zero_()
                blk.mlp.down_proj.weight.zero_()
                for lin in (blk.self_attn.o_proj, blk.mlp.down_proj):
                    if getattr(lin, "bias", None) is not None:
                        lin.bias.zero_()
            new_idx.append(len(new_layers))
            new_layers.append(blk)
    model.model.layers = torch.nn.ModuleList(new_layers)

    # keep the KV-cache bookkeeping consistent: each attention module knows its own layer index
    for j, layer in enumerate(model.model.layers):
        if hasattr(layer.self_attn, "layer_idx"):
            layer.self_attn.layer_idx = j
    cfg = model.config
    cfg.num_hidden_layers = len(model.model.layers)
    lt = getattr(cfg, "layer_types", None)
    if lt:  # newer transformers: per-layer attention type list must match the depth
        out = []
        for i, t in enumerate(lt):
            out.append(t)
            if i in after:
                out.append(t)
        cfg.layer_types = out
    if getattr(cfg, "max_window_layers", None) is not None:
        cfg.max_window_layers = cfg.num_hidden_layers

    for p in model.parameters():
        p.requires_grad = False
    for j in new_idx:
        for p in model.model.layers[j].parameters():
            p.requires_grad = True
    return new_idx


def perplexity(model, tokenizer, texts, seq_len, max_tokens, device):
    """Held-out perplexity over non-overlapping seq_len windows of the concatenated texts."""
    import math

    import torch

    ids = tokenizer("\n\n".join(texts), return_tensors="pt").input_ids[0][:max_tokens]
    if ids.numel() < 2:
        return None
    model.eval()
    nll, count = 0.0, 0
    with torch.no_grad():
        for s in range(0, ids.numel() - 1, seq_len):
            chunk = ids[s : s + seq_len + 1].to(device)
            if chunk.numel() < 2:
                break
            out = model(chunk[:-1].unsqueeze(0), labels=chunk[:-1].unsqueeze(0))
            k = chunk.numel() - 2  # HF shifts labels internally: k predicted tokens
            if k <= 0:
                continue
            nll += out.loss.item() * k
            count += k
    return math.exp(nll / count) if count else None


def pack(tokenizer, texts, seq_len):
    """Tokenize + pack into fixed seq_len blocks (EOS between docs)."""
    eos = tokenizer.eos_token_id
    buf, blocks = [], []
    for t in texts:
        buf.extend(tokenizer(t).input_ids + ([eos] if eos is not None else []))
        while len(buf) >= seq_len:
            blocks.append(buf[:seq_len])
            buf = buf[seq_len:]
    return blocks


# ── the GPU job ──────────────────────────────────────────────────────────────────────────────────────
@app.function(gpu=GPU, image=image, volumes={"/out": vol}, timeout=60 * 60 * 4)
def expand_and_train(corpus_text: str):
    import hashlib
    import json
    import random

    import torch
    from datasets import load_dataset
    from transformers import AutoModelForCausalLM, AutoTokenizer

    torch.manual_seed(SEED)
    rng = random.Random(SEED)
    device = "cuda"

    docs = parse_corpus(corpus_text)
    if len(docs) < 2:
        return {"ok": False, "error": "corpus needs at least 2 documents"}
    train_docs, held_docs = split_heldout(docs, HELDOUT_FRAC, SEED)

    wt2_test = [t for t in load_dataset("wikitext", "wikitext-2-raw-v1", split="test")["text"] if t.strip()]
    general_train = [t for t in load_dataset("wikitext", "wikitext-103-raw-v1", split="train")["text"] if t.strip()]

    tok = AutoTokenizer.from_pretrained(BASE_MODEL)
    model = AutoModelForCausalLM.from_pretrained(BASE_MODEL, torch_dtype=torch.bfloat16).to(device)
    n_before = len(model.model.layers)

    def ppl(m):
        return {
            "corpus_heldout": perplexity(m, tok, held_docs, SEQ_LEN, EVAL_MAX_TOKENS, device),
            "wikitext2_test": perplexity(m, tok, wt2_test, SEQ_LEN, EVAL_MAX_TOKENS, device),
        }

    ppl_base = ppl(model)

    new_idx = expand_blocks(model, EXPAND_EVERY)
    ppl_expanded_init = ppl(model)  # sanity: must match ppl_base (zeroed copies = identity)

    # the ~20% general-text rule
    corpus_blocks = pack(tok, train_docs, SEQ_LEN)
    need = n_general_blocks(len(corpus_blocks), GENERAL_RATIO)
    rng.shuffle(general_train)
    general_blocks = []
    for t in general_train:
        if len(general_blocks) >= need:
            break
        general_blocks.extend(pack(tok, [t], SEQ_LEN))
    general_blocks = general_blocks[:need]
    mix = corpus_blocks + general_blocks
    rng.shuffle(mix)
    if not mix:
        return {"ok": False, "error": "corpus too small to pack a single block"}

    params = [p for p in model.parameters() if p.requires_grad]
    trainable = sum(p.numel() for p in params)
    opt = torch.optim.AdamW(params, lr=LR, weight_decay=0.0)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / 50) * max(0.0, 1 - s / MAX_STEPS))
    model.train()
    # frozen embeddings -> inputs carry no grad; without this, checkpointed new blocks get no gradient
    model.enable_input_require_grads()
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.config.use_cache = False
    batch, accum = 4, 4
    losses = []
    step = 0
    i = 0
    while step < MAX_STEPS:
        opt.zero_grad(set_to_none=True)
        for _ in range(accum):
            rows = [mix[(i + k) % len(mix)] for k in range(batch)]
            i += batch
            x = torch.tensor(rows, device=device)
            loss = model(x, labels=x).loss / accum
            loss.backward()
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        opt.step()
        sched.step()
        step += 1
        if step % 25 == 0:
            losses.append({"step": step, "loss": round(loss.item() * accum, 4)})
    model.config.use_cache = True

    ppl_after = ppl(model)

    out_dir = f"/out/{OUT_NAME}"
    model.save_pretrained(out_dir, safe_serialization=True)
    tok.save_pretrained(out_dir)

    files = []
    for name in sorted(os.listdir(out_dir)):
        if name.endswith(".safetensors"):
            h = hashlib.sha256()
            with open(os.path.join(out_dir, name), "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            files.append({"name": name, "sha256": h.hexdigest(), "bytes": os.path.getsize(os.path.join(out_dir, name))})

    def delta(k):
        a, b = ppl_base[k], ppl_after[k]
        return None if a is None or b is None else round(b - a, 4)

    report = {
        "ok": True,
        "base": BASE_MODEL,
        "layers": {"before": n_before, "after": len(model.model.layers), "new_indices": new_idx},
        "trainable_params": trainable,
        "data": {
            "corpus_docs_train": len(train_docs), "corpus_docs_heldout": len(held_docs),
            "corpus_blocks": len(corpus_blocks), "general_blocks": len(general_blocks),
            "general_ratio_actual": round(len(general_blocks) / len(mix), 4),
            "general_source": "wikitext-103-raw-v1 train (CC BY-SA 3.0)",
        },
        "perplexity": {
            "base": ppl_base, "expanded_at_init": ppl_expanded_init, "after_training": ppl_after,
            # learning = corpus ppl falls; forgetting = wikitext-2 ppl rises
            "learning_delta_corpus": delta("corpus_heldout"),
            "forgetting_delta_wikitext2": delta("wikitext2_test"),
        },
        "train": {"steps": MAX_STEPS, "lr": LR, "seq_len": SEQ_LEN, "batch": batch * accum, "loss_curve": losses},
        "files": files,
        "path": out_dir,
    }
    with open(os.path.join(out_dir, "report.json"), "w") as f:
        json.dump(report, f, indent=2)
    vol.commit()
    return report


@app.local_entrypoint()
def main(corpus: str):
    with open(corpus, "r", encoding="utf-8") as f:
        text = f.read()
    docs = parse_corpus(text)
    print(
        f"block-expanding {BASE_MODEL} (+1 block every {EXPAND_EVERY}) on {len(docs)} docs, "
        f"{int(GENERAL_RATIO * 100)}% general text, {MAX_STEPS} steps on {GPU}"
    )
    res = expand_and_train.remote(text)
    print("result:", res)
