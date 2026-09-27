# infra/modal — Hathor GPU jobs (serverless, pay-per-run)

| Script | What it does | Status |
|---|---|---|
| `finetune.py` | LoRA fine-tune (Unsloth) on a `{"text"}` JSONL, adapter saved to the `hathor-lora` volume | in use |
| `block_expand.py` | LLaMA-Pro block expansion of Qwen3-0.6B-Base + learning/forgetting report | **ready, not run** |

## Block expansion (`block_expand.py`)

The first capacity experiment from the 2026-09-26 build notes: grow an Apache-2.0 base by adding layers
instead of only stacking a LoRA, measured on the cheapest real test bed before scaling up.

**What it does**

1. Loads `Qwen/Qwen3-0.6B-Base` (28 layers × 1024 wide).
2. Inserts a copy of the block after every 4th layer (28 → 35 layers, ~+110M params). Each copy has
   `self_attn.o_proj` and `mlp.down_proj` zeroed, so it adds nothing to the residual stream and the
   expanded model starts out identical to the base. The report records perplexity at init as a check.
3. Freezes every original parameter (embeddings, lm_head, the 28 original blocks). Only the 7 new blocks train.
4. Trains on our corpus **mixed with ~20% general text** (wikitext-103 train). This rule is load-bearing:
   the August 2026 test of this exact setup without the mix saw wikitext-2 perplexity go 14.11 → 21.00.
   With 20% general text it held at 13.18 and the corpus was learned just as well. Don't set `BX_GENERAL_RATIO=0`.
5. Reports held-out perplexity **before and after** on (a) a 5% doc-level held-out slice of our corpus
   (learning) and (b) wikitext-2 test (forgetting). It also writes per-file sha256 so the result can be
   registered with `integrations/model-lineage.mjs` (`method: block-expansion`, parent `hf:Qwen/Qwen3-0.6B-Base`).

**Run** (after the GPU budget is approved; about 1–2 A10G hours at the defaults):

```
modal run infra/modal/block_expand.py --corpus datasets/lora/persona-training.jsonl
```

Knobs (env): `BX_BASE_MODEL`, `BX_GPU`, `BX_EXPAND_EVERY` (4), `BX_GENERAL_RATIO` (0.20), `BX_MAX_STEPS`
(1000), `BX_LR` (2e-4), `BX_SEQ_LEN` (1024), `BX_HELDOUT_FRAC` (0.05), `BX_EVAL_MAX_TOKENS` (200000), `BX_OUT`.

**Read the result:** `learning_delta_corpus` should be clearly negative (corpus ppl falls), and
`forgetting_delta_wikitext2` should be close to 0. If forgetting is large, raise the general ratio or lower
the LR before scaling to a bigger base. Per the notes, a bigger base doesn't fix it: forgetting comes from
the data, not the model size.

Don't train the persona LoRA and the added blocks on the same data (build notes, roadmap step 5).
