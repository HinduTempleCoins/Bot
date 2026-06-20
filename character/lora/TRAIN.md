# Hathor character LoRA — training recipe (phone-drivable)

Train a Flux LoRA of Hathor from the reference set, then we build a demo Space for it.
Identity = the signature (VR headset, ram horns, wings, wesekh collar); **skin tone is captioned**
(`natural skin tone` vs `vaporwave lavender skin tone`) so it stays promptable — see
[`../reference/README.md`](../reference/README.md).

- **Trigger word:** `h4thor` (unique token, avoids leaking the real "Hathor" goddess prior).
- **Dataset:** 21 captioned images, resized to ≤1024px. Captions in [`captions/`](captions/). Claude sends
  the ready-to-upload `hathor-lora-dataset.zip` (images + matching `.txt`) directly to the phone.
- **Balance note:** 20 natural-skin + 1 vaporwave. The vaporwave look will be weaker until we add a few
  more vaporwave-skin examples — fine for a first pass; we can retrain after generating more.

## Option A — Replicate (easiest from a phone)
1. Phone browser → **replicate.com** → sign in (needs a card; a training run is ~$1–3).
2. Open **`ostris/flux-dev-lora-trainer`** → "Create training".
3. Settings:
   - `input_images` = upload `hathor-lora-dataset.zip`
   - `trigger_word` = `h4thor`
   - `autocaption` = **false** (our `.txt` captions are in the zip)
   - `steps` = `1200`  · `lora_rank` = `16`  · `learning_rate` = `0.0004`  · `resolution` = `1024`
   - `batch_size` = `1`
   - `hf_repo_id` (optional) = push the finished LoRA to your Hugging Face for the demo Space.
4. Run → ~20–30 min → download the `.safetensors` (or it lands on your HF).
5. Test prompts: `h4thor, natural skin tone, portrait` · `h4thor, vaporwave lavender skin tone`.

## Option B — Civitai (no card; uses Buzz credits)
1. **civitai.com** → Create → **Train a LoRA** → base model **Flux.1 D**.
2. Upload the images (or the zip), set trigger `h4thor`, keep our captions or let it auto-tag.
3. ~Default epochs/steps; train; download the `.safetensors`.

## Option C — Hugging Face AutoTrain (if you have a HF PRO account)
DreamBooth-LoRA flow in an AutoTrain Space; needs a HF write token + ZeroGPU/PRO. Tell me your HF
username and I can scaffold the Space.

## After training
Send me the trained LoRA (HF repo id, or the `.safetensors`) and I'll build a **Gradio demo Space** for
it (the huggingface-lora-space-builder flow) — a phone-usable playground to generate Hathor on demand,
wired with the trigger word + skin-tone control. That's also where we generate the extra vaporwave-skin
renders to balance the set for a v2.
