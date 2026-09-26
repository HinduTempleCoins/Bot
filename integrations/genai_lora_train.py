"""genai_lora_train.py — train a concept LoRA on OUR CPU (our render server). Reusable for every Studio concept.

Method (the "learn it from examples" flywheel):
  1. DATASET  — known-good images of the concept (for Hathor: the original + her canonical renders).
  2. CAPTIONS — auto-captioned (BLIP, CPU); each caption = "<trigger>, <what VARIES in this image>".
                The trigger word absorbs what never varies (her horns, wings, visor), so the LoRA learns the
                identity and leaves outfit / setting / pose controllable by prompt.
  3. TRAIN    — LoRA on the SD1.5 UNet (Dreamshaper-8 base, the same base our Studio worker renders with).
  4. FLYWHEEL — generate many with the LoRA → genai_concepts.py gate filters drift → survivors become new
                training data → retrain. (Volume of CORRECT examples is what made the retina model good.)

CLI:
  python genai_lora_train.py caption <image_dir> --trigger hathorvr          # writes <img>.txt captions
  python genai_lora_train.py train   <image_dir> --out loras/hathor_v0 [--steps 1500 --rank 16 --lr 1e-4]
Everything runs on CPU (torch threads = $LORA_THREADS, default 8). Checkpoints every --save-every steps,
so a long overnight run can be stopped and still leave a usable LoRA.
"""
import argparse, math, os, random, sys, time

BASE = os.environ.get("LORA_BASE", "Lykon/dreamshaper-8")
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp")


def log(m, t0=[time.time()]):
    print(f"[+{int(time.time() - t0[0])}s] {m}", flush=True)


def images_in(d):
    return sorted(os.path.join(d, f) for f in os.listdir(d) if f.lower().endswith(IMG_EXT))


# ── captions ────────────────────────────────────────────────────────────────────────────────────
def caption(image_dir, trigger, overwrite=False):
    import torch
    from PIL import Image
    from transformers import BlipProcessor, BlipForConditionalGeneration
    torch.set_num_threads(int(os.environ.get("LORA_THREADS", "8")))
    proc = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
    model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base").eval()
    n = 0
    for p in images_in(image_dir):
        txt = os.path.splitext(p)[0] + ".txt"
        if os.path.exists(txt) and not overwrite:
            continue
        im = Image.open(p).convert("RGB")
        with torch.no_grad():
            out = model.generate(**proc(im, return_tensors="pt"), max_new_tokens=40)
        cap = proc.decode(out[0], skip_special_tokens=True).strip()
        with open(txt, "w") as fh:
            fh.write(f"{trigger}, {cap}")
        n += 1
        log(f"captioned {os.path.basename(p)}: {trigger}, {cap}")
    return n


# ── training ────────────────────────────────────────────────────────────────────────────────────
def train(image_dir, out_dir, steps=1500, rank=16, lr=1e-4, res=512, seed=0, save_every=250, threads=None):
    import torch
    import torch.nn.functional as F
    from PIL import Image
    from torchvision import transforms
    from diffusers import StableDiffusionPipeline, DDPMScheduler
    from peft import LoraConfig, get_peft_model_state_dict
    from diffusers.utils import convert_state_dict_to_diffusers

    torch.set_num_threads(threads or int(os.environ.get("LORA_THREADS", "8")))
    torch.manual_seed(seed); random.seed(seed)
    os.makedirs(out_dir, exist_ok=True)

    items = []
    for p in images_in(image_dir):
        txt = os.path.splitext(p)[0] + ".txt"
        if os.path.exists(txt):
            items.append((p, open(txt).read().strip()))
    if len(items) < 5:
        raise SystemExit(f"need >=5 captioned images, found {len(items)} (run `caption` first)")
    log(f"dataset: {len(items)} captioned images")

    pipe = StableDiffusionPipeline.from_pretrained(BASE, torch_dtype=torch.float32, safety_checker=None)
    unet, vae, te, tok = pipe.unet, pipe.vae, pipe.text_encoder, pipe.tokenizer
    noise_sched = DDPMScheduler.from_pretrained(BASE, subfolder="scheduler")
    for m in (vae, te, unet):
        m.requires_grad_(False)
    unet.add_adapter(LoraConfig(r=rank, lora_alpha=rank, init_lora_weights="gaussian",
                                target_modules=["to_k", "to_q", "to_v", "to_out.0"]))
    unet.enable_gradient_checkpointing()
    params = [p for p in unet.parameters() if p.requires_grad]
    log(f"LoRA rank {rank}: {sum(p.numel() for p in params)/1e6:.2f}M trainable params")
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=1e-2)

    tf = transforms.Compose([transforms.Resize(res, interpolation=transforms.InterpolationMode.BILINEAR),
                             transforms.RandomCrop(res), transforms.RandomHorizontalFlip(),
                             transforms.ToTensor(), transforms.Normalize([0.5], [0.5])])

    # pre-encode captions once (text encoder is frozen)
    cache = {}

    def encode_text(s):
        if s not in cache:
            ids = tok(s, padding="max_length", max_length=tok.model_max_length, truncation=True, return_tensors="pt").input_ids
            with torch.no_grad():
                cache[s] = te(ids)[0]
        return cache[s]

    unet.train()
    t_step = time.time()
    for step in range(1, steps + 1):
        path, cap = random.choice(items)
        px = tf(Image.open(path).convert("RGB")).unsqueeze(0)
        with torch.no_grad():
            lat = vae.encode(px).latent_dist.sample() * vae.config.scaling_factor
        noise = torch.randn_like(lat)
        t = torch.randint(0, noise_sched.config.num_train_timesteps, (1,)).long()
        noisy = noise_sched.add_noise(lat, noise, t)
        pred = unet(noisy, t, encode_text(cap)).sample
        loss = F.mse_loss(pred.float(), noise.float())
        loss.backward(); opt.step(); opt.zero_grad()
        if step % 10 == 0 or step == 1:
            dt = (time.time() - t_step) / (1 if step == 1 else 10); t_step = time.time()
            log(f"step {step}/{steps} loss {loss.item():.4f}  ~{dt:.1f}s/step  eta {dt*(steps-step)/3600:.1f}h")
        if step % save_every == 0 or step == steps:
            sd = convert_state_dict_to_diffusers(get_peft_model_state_dict(unet))
            StableDiffusionPipeline.save_lora_weights(save_directory=out_dir, unet_lora_layers=sd, safe_serialization=True)
            log(f"saved LoRA checkpoint at step {step} -> {out_dir}")
    log("DONE training")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("caption"); c.add_argument("dir"); c.add_argument("--trigger", required=True); c.add_argument("--overwrite", action="store_true")
    t = sub.add_parser("train"); t.add_argument("dir"); t.add_argument("--out", required=True)
    t.add_argument("--steps", type=int, default=1500); t.add_argument("--rank", type=int, default=16)
    t.add_argument("--lr", type=float, default=1e-4); t.add_argument("--res", type=int, default=512)
    t.add_argument("--save-every", type=int, default=250)
    a = ap.parse_args(argv)
    if a.cmd == "caption":
        log(f"captioned {caption(a.dir, a.trigger, a.overwrite)} images")
    else:
        train(a.dir, a.out, a.steps, a.rank, a.lr, a.res, save_every=a.save_every)


if __name__ == "__main__":
    main()
