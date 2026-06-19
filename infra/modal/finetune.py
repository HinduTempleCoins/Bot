# finetune.py — Hathor's LoRA fine-tune on Modal (operator greenlit Modal for LoRA, 2026-06-19).
#
# Modal = serverless GPU: this trains a LoRA adapter on the language corpus (datasets/lora/training.jsonl,
# built by integrations/lora-dataset.mjs) so Hathor KNOWS the languages in weights, not just RAG.
#
# Cost discipline (the budget conversation): TRAINING fits the ~$30/mo Modal credit easily — a 7-8B LoRA
# on an A10G (~$1.10/hr) is a few dollars per run. We do NOT serve 24/7 GPU here (that's the budget
# killer); we train → save the adapter → merge + run on a box via Ollama, or serve on-demand. The
# embeddings lane (brain.py, T4) stays separate.
#
# Run:
#   pip install modal && modal token set ...   (tokens already in the box env: MODAL_TOKEN_ID/SECRET)
#   modal run infra/modal/finetune.py --dataset datasets/lora/training.jsonl
#   # adapter lands in the 'hathor-lora' volume; download or merge for serving.
#
# Defaults to a small open base (Qwen2.5-7B) + Unsloth (fast, low-VRAM LoRA). Override via env.

import os
import modal

BASE_MODEL = os.environ.get("LORA_BASE_MODEL", "unsloth/Qwen2.5-7B-bnb-4bit")
GPU = os.environ.get("LORA_GPU", "A10G")          # A10G ~ $1.10/hr; bump to A100 for speed
MAX_STEPS = int(os.environ.get("LORA_MAX_STEPS", "400"))
ADAPTER_NAME = os.environ.get("LORA_ADAPTER", "hathor-languages")

image = (
    modal.Image.debian_slim()
    .pip_install("unsloth", "torch", "transformers", "datasets", "trl", "peft", "accelerate", "bitsandbytes")
)
app = modal.App("hathor-lora")
vol = modal.Volume.from_name("hathor-lora", create_if_missing=True)  # adapters persist here


@app.function(gpu=GPU, image=image, volumes={"/out": vol}, timeout=60 * 60 * 3)
def train(jsonl_text: str):
    """Train a LoRA adapter on the provided JSONL (one {"text": ...} per line). Returns a summary."""
    import json
    from unsloth import FastLanguageModel
    from datasets import Dataset
    from trl import SFTTrainer
    from transformers import TrainingArguments

    rows = [json.loads(l) for l in jsonl_text.splitlines() if l.strip()]
    texts = [r.get("text", "") for r in rows if r.get("text")]
    if not texts:
        return {"ok": False, "error": "empty dataset"}
    ds = Dataset.from_dict({"text": texts})

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=BASE_MODEL, max_seq_length=2048, load_in_4bit=True,
    )
    model = FastLanguageModel.get_peft_model(
        model, r=16, lora_alpha=16, lora_dropout=0,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        use_gradient_checkpointing="unsloth",
    )
    trainer = SFTTrainer(
        model=model, tokenizer=tokenizer, train_dataset=ds, dataset_text_field="text",
        max_seq_length=2048,
        args=TrainingArguments(
            per_device_train_batch_size=2, gradient_accumulation_steps=4,
            warmup_steps=10, max_steps=MAX_STEPS, learning_rate=2e-4,
            fp16=True, logging_steps=10, optim="adamw_8bit", output_dir="/tmp/out",
        ),
    )
    trainer.train()
    out = f"/out/{ADAPTER_NAME}"
    model.save_pretrained(out)
    tokenizer.save_pretrained(out)
    vol.commit()
    return {"ok": True, "adapter": ADAPTER_NAME, "examples": len(texts), "base": BASE_MODEL, "steps": MAX_STEPS, "path": out}


@app.local_entrypoint()
def main(dataset: str = "datasets/lora/training.jsonl"):
    with open(dataset, "r", encoding="utf-8") as f:
        jsonl_text = f.read()
    n = sum(1 for l in jsonl_text.splitlines() if l.strip())
    print(f"submitting {n} examples → {GPU} LoRA train of {BASE_MODEL} (adapter: {ADAPTER_NAME})")
    res = train.remote(jsonl_text)
    print("result:", res)
