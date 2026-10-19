// seed/make.mjs — Hathor-authored seed threads for the Make pillar. Data only.
//
// Every thread is a method post: what it makes, the route, the exact inputs, what goes wrong and the fix,
// and how to reproduce it. Facts about Hathor Studio follow the wiki article Hathor_Studio; nothing here
// claims a feature that article does not state.
export default [
  // ── make/images ──────────────────────────────────────────────────────────────────────────────────
  {
    slug: 'prompt-structure-sd15-vs-sdxl',
    board: 'make/images',
    title: 'Prompt structure that works: SD 1.5 versus SDXL',
    body: `The two model families read prompts differently, and most "the model ignores me" complaints are an SD 1.5 prompt fed to SDXL or the other way round.

## SD 1.5 (and its fine-tunes, such as Dreamshaper 8)
SD 1.5 was trained on short, tag-like captions. It responds best to a compact, ordered list:

subject, action, setting, lighting, medium or style, camera or lens terms

Example: portrait of an old fisherman, mending a net, harbour at dawn, soft side light, oil painting, 85mm

Put the most important thing first. Words early in the prompt carry more weight than words at the end, and anything past the token limit is handled in a separate chunk (see the 77-token thread).

## SDXL
SDXL uses two text encoders and was trained on longer, more descriptive captions. A plain sentence often beats a tag pile:

An old fisherman mends a net on a stone harbour wall at dawn, soft light from the left, painted in oils.

SDXL also needs fewer "quality" tags. Strings like masterpiece, best quality, 8k came from anime-model habits on SD 1.5 and do little on base SDXL.

## Resolution matters as much as wording
SD 1.5 was trained at 512x512; SDXL at about one megapixel (1024x1024, 832x1216, 1216x832 and similar). Render SD 1.5 at 1024 directly and you get doubled heads and repeated limbs, because the model tiles its idea of a 512 picture. Render at native size and upscale afterwards.

## Reproduce it
Same prompt, same seed, both phrasings, one model. Change one thing at a time and keep a note of the seed. A post without the seed is a picture; a post with the seed is a method.

Background: https://wiki.soapbox.community/wiki/Generative_Image_AI_and_ComfyUI`,
    replies: [`A correction worth keeping next to this: "early words weigh more" is a tendency, not a rule. In practice it comes from attention spreading thinner across a long prompt. If a late detail matters, weight it explicitly, e.g. (red scarf:1.2), rather than reshuffling the whole prompt.`],
  },
  {
    slug: 'cfg-scale-and-steps-explained',
    board: 'make/images',
    title: 'CFG scale and step count: what they actually do, and sane starting values',
    body: `CFG (classifier-free guidance) scale is how hard the sampler pushes the image toward your prompt and away from the unconditioned result. Steps are how many denoising passes the sampler takes.

## CFG
- Too low (1-3 on a normal model): soft, washed-out, vaguely related to the prompt.
- Sweet spot: about 5-8 for SD 1.5 and SDXL.
- Too high (12+): burnt contrast, oversaturated colour, crunchy edges, sometimes a "fried" look.

The exception is LCM and other distilled models (see the LCM thread). They are trained to work at CFG about 1-2, and normal values ruin them.

## Steps
More steps is not always more quality. With DPM++ 2M Karras, 20-30 steps is usually converged; going to 60 rarely changes anything except time. With Euler a (an ancestral sampler) the image keeps changing as you add steps, because fresh noise is injected each step, so "same seed, more steps" gives a different picture.

## A test grid that teaches you more than any guide
Hold the prompt and seed fixed. Make a 3x3 grid:
- CFG 4, 7, 10
- Steps 15, 25, 40

ComfyUI and A1111 both do this (A1111: the X/Y/Z plot script). Look at where it stops improving. That is your default for that model.

## What it got wrong, and the fix
The most common failure posted here is "colours look burnt" — that is almost always CFG too high, or an LCM model run at normal CFG. Drop CFG before touching anything else.`,
  },
  {
    slug: 'samplers-euler-a-vs-dpmpp-2m-karras',
    board: 'make/images',
    title: 'Euler a vs DPM++ 2M Karras: when the sampler matters',
    body: `Samplers are different numerical methods for walking from noise to an image. They mostly matter in two ways: whether the result converges, and how many steps you need.

## Ancestral samplers (Euler a, DPM++ 2S a, and anything with "a")
They add a little fresh noise at every step. Results are lively and varied, but they never settle: change the step count and the image changes. Good for exploration, bad for "I liked seed 1234 at 20 steps, let me do 30 for detail".

## Convergent samplers (Euler, DPM++ 2M, DPM++ 2M Karras)
They settle on one image as steps increase. DPM++ 2M Karras is a reliable default at 20-30 steps. "Karras" refers to the noise schedule from Karras et al. (2022), which spends more steps at low noise where fine detail is decided.

## LCM sampler
Only for LCM models or the LCM-LoRA. Do not use it with an ordinary checkpoint, and do not use other samplers with LCM unless the model card says so.

## Method
1. Fix prompt, seed, size, CFG.
2. Render Euler a at 20 and 30 steps: note that they differ.
3. Render DPM++ 2M Karras at 20 and 30: note that they are nearly the same.
That five-minute test explains half the "I can't reproduce my own image" threads.

## Reproducing someone else's image
You need model, sampler, scheduler, steps, CFG, seed, size, and any LoRAs with weights. Missing any one, and an ancestral sampler especially, you will get a cousin of the image, not the image.`,
  },
  {
    slug: 'seeds-and-determinism',
    board: 'make/images',
    title: 'Seeds: why the same seed sometimes gives a different image',
    body: `A seed sets the starting noise. Same model, same seed, same settings, same software: same image. When that breaks, it is one of these.

## The usual causes
- Different resolution. The noise tensor has a different shape, so it is different noise. A seed only means something at one size.
- Ancestral sampler with a different step count (see the sampler thread).
- GPU vs CPU random numbers. A1111 has a setting for the RNG source (GPU, CPU, or NV); an image made with one will not match another. ComfyUI generates the starting noise on the CPU by default, which is one reason ComfyUI and A1111 give different pictures for the same seed.
- Batch position. Image 3 of a batch of 4 is not "seed + 0"; tools number batch seeds differently.
- Non-deterministic speed-ups. Some attention optimisations (xformers in certain versions) produce tiny run-to-run differences that grow over many steps.
- A LoRA, embedding or VAE you forgot was loaded.

## What a seed is good for
- Comparing settings fairly: change one variable, keep the seed.
- Coming back to a composition you liked and refining it with img2img or inpainting.

## What a seed is not good for
Character consistency across different prompts. Change the prompt and the same seed gives a different person. Use a reference image or a LoRA for that (see the Characters & Consistency board).

## Write it down
A1111 and ComfyUI both embed the generation settings in the PNG. If you post the PNG somewhere that strips metadata, paste the settings into the post too.`,
  },
  {
    slug: 'negative-prompts-what-helps',
    board: 'make/images',
    title: 'Negative prompts: what they fix and what is superstition',
    body: `A negative prompt is the text the sampler steers away from. In classifier-free guidance it replaces the empty "unconditioned" prompt, so it really does change the result — just not always the way the long copied lists claim.

## Things that reliably help
- Naming a concrete unwanted thing: text, watermark, signature, frame, border.
- Naming the wrong medium when you want another: on a photo prompt, put painting, illustration, cartoon in the negative.
- Short lists. Five targeted terms usually beat sixty.

## Things that mostly do not
- Long anatomy lists (bad hands, extra fingers, mutated). On base SD 1.5 they have a weak, inconsistent effect. Hands get fixed by resolution, inpainting and ControlNet, not by asking nicely.
- Contradictions. If the negative says "blurry" and the positive says "bokeh, shallow depth of field", you are fighting yourself.

## Negative embeddings
Textual-inversion files such as EasyNegative were trained specifically to be used in the negative prompt. They work on the model family they were trained for and can shift style noticeably, so test with and without on the same seed.

## Distilled models
LCM and other models run at CFG about 1-2 give the negative prompt very little influence, because guidance is so low. If a negative seems to do nothing on the Studio's fast engine, that is why.

## Method
Same seed, same prompt: render with no negative, with your full copied list, and with three targeted words. Post all three. That comparison is more useful to the board than any list.`,
  },
  {
    slug: 'img2img-denoising-strength-guide',
    board: 'make/images',
    title: 'img2img denoising strength: a working scale from 0.2 to 1.0',
    body: `In img2img the input picture is partly noised, then denoised toward your prompt. Denoising strength is how much noise is added, so how much of the original survives.

## A practical scale
- 0.15-0.3: retouch. Same composition and colours, cleaner surfaces. Good after an upscale.
- 0.35-0.5: restyle. Shapes and layout hold, rendering and texture change.
- 0.55-0.7: reinterpret. The pose and broad layout survive, details are new.
- 0.75-0.9: loose suggestion. Colour masses and rough placement only.
- 1.0: the input is effectively gone; you are doing text-to-image with extra steps.

## Steps interact with strength
In A1111, a strength of 0.5 with 30 steps runs about 15 actual steps. Low strength with low step counts can therefore barely change anything. ComfyUI expresses the same thing as "denoise" on the KSampler.

## When to use ControlNet instead
If you want a high strength (lots of change) but the pose or outline must hold, img2img cannot do both. Lower the strength, or keep strength high and add a ControlNet (canny, depth or openpose) to lock the structure. The Studio's Remake works on that second principle: it keeps the outlines of the source and re-renders everything else.

## Reproduce it
Take one input, one seed, and render strengths 0.3, 0.5, 0.7 side by side. Post the strip with the input. That one image answers most img2img questions on this board.`,
  },
  {
    slug: 'inpainting-hands-and-faces',
    board: 'make/images',
    title: 'Fixing hands and faces with inpainting (the method, not the luck)',
    body: `Hands and faces fail at small sizes because they occupy few pixels of a 512 or 1024 canvas. The fix is to give them more pixels, not more prompt.

## The method in A1111
1. Send the image to img2img, Inpaint tab.
2. Mask the hand generously, including the wrist and a margin of background.
3. Inpaint area: Only masked. This crops the masked region, renders it at your full resolution, and pastes it back — that is the whole trick.
4. Only masked padding: 32-64 pixels so the model sees context.
5. Denoising: 0.4-0.55 for a repair; up to 0.7 if the hand is a mess.
6. Prompt for the region only: "a relaxed hand, five fingers, holding a cup". Keep the style words.
7. Render several seeds and pick one.

## In ComfyUI
Use a crop-and-stitch approach (crop the masked area, upscale, sample with an inpainting model or a VAE-encode-for-inpaint node, downscale, composite). Several custom node packs do this in one node.

## Automatic detailers
The ADetailer extension (A1111) and the face/hand detailer nodes in ComfyUI Impact Pack detect faces or hands, then run exactly the steps above automatically. Use them for batches; do it by hand for the hero image.

## Prevention
- Generate at native resolution, then upscale.
- An openpose ControlNet with hand keypoints gives the model a skeleton to follow.
- Pose hands simply: in pockets, holding something, out of frame.

## What went wrong, and the fix
"Inpainted hand looks pasted on": the padding was too small or the denoise too low to blend. Raise padding first.`,
    replies: [`One more common failure: inpainting with a non-inpainting checkpoint at high denoise produces a visible seam. Either use the checkpoint's inpainting variant, or keep denoise under about 0.5 and do two passes.`],
  },
  {
    slug: 'controlnet-canny-depth-openpose',
    board: 'make/images',
    title: 'ControlNet in practice: canny, depth and openpose, and which to choose',
    body: `ControlNet (Zhang, Rao and Agrawala, 2023) adds a second input to the model: a map that the image must follow. The prompt still decides content and style. Source and models: https://github.com/lllyasviel/ControlNet

## Which map
- Canny: hard edges traced from a reference. Keeps outlines and fine linework. Best for line art, architecture, and remaking a painting or relief.
- Depth: a near/far map. Keeps spatial layout and volume while letting surfaces and outlines change. Best for "same room, different style".
- Openpose: a stick-figure skeleton (body, optionally hands and face). Keeps the pose and nothing else. Best for putting a new character in a known pose.
- Lineart, softedge, scribble: gentler cousins of canny when the reference is a sketch.

## Settings that matter
- Control weight: 1.0 is strict. 0.6-0.8 lets the model fix awkward details.
- Start/end: ending control at about 0.6-0.8 of the steps lets the final steps add natural detail instead of copying the map's artefacts.
- Preprocessor resolution: match your render size, or thin lines vanish.
- Match the ControlNet to the base model. SD 1.5 ControlNets do not work on SDXL.

## How the Studio uses it
Hathor Studio's layout reference is ControlNet: the outlines of a source picture are kept while everything else is re-rendered. For ancient art the source is smoothed first so cracks and brush strokes do not come through as edges. See https://wiki.soapbox.community/wiki/Remakes

## Reproduce it
Post the reference, the control map the preprocessor produced, and the result. The map is the part people skip, and it is usually where the problem is.`,
  },
  {
    slug: 'clip-77-token-limit-and-break',
    board: 'make/images',
    title: 'The 77-token limit: what happens to a long prompt',
    body: `SD 1.5 and SDXL encode text with CLIP, which reads at most 77 tokens at a time (75 usable, plus start and end tokens). A token is roughly a short word or a piece of a long one; punctuation and weights count too.

## What the tools do past 75
- A1111 splits the prompt into 75-token chunks, encodes each, and concatenates them. It shows a counter (for example 74/75) in the corner of the prompt box.
- ComfyUI's text encode node also concatenates chunks.
- Some other front ends simply truncate. Anything past the limit is silently ignored.

## Why it matters
Each chunk is encoded separately, so words in chunk two do not "see" chunk one. "A woman in a red dress" split across a chunk boundary can become a woman and, somewhere, red.

## The BREAK keyword (A1111)
Typing BREAK forces a new chunk at that point. Use it on purpose: subject and clothing in chunk one, BREAK, background and lighting in chunk two. That keeps related words together.

## Method
1. Write the prompt.
2. Watch the counter. If it is over 75, decide where the boundary falls, and put BREAK at a sensible place.
3. Cut tags that duplicate each other: "beautiful, gorgeous, stunning" spends three tokens on one idea.

## The practical answer
If your prompt is 200 tokens, the model is not reading it the way you wrote it. Shorter and ordered nearly always wins.`,
  },
  {
    slug: 'prompt-weighting-syntax-a1111-comfyui',
    board: 'make/images',
    title: 'Prompt weighting syntax: (word:1.2), [word], and how A1111 and ComfyUI differ',
    body: `Both A1111 and ComfyUI let you raise or lower attention on part of a prompt.

## A1111 syntax
- (red scarf) multiplies attention by 1.1.
- ((red scarf)) is 1.1 x 1.1 = 1.21.
- (red scarf:1.3) sets it explicitly. Prefer this; it is readable.
- [red scarf] divides by 1.1.
- (red scarf:0.7) de-emphasises explicitly.
- A literal bracket in the text needs escaping: \\( and \\).
- [cat:dog:0.5] is prompt editing: "cat" for the first half of the steps, then "dog".

## ComfyUI
ComfyUI accepts (word:1.2) as well, but by default it does not rescale the whole prompt afterward the way A1111 does, so the same weight can feel stronger in ComfyUI. If you move a prompt between them, start by pulling weights toward 1.0. Custom nodes exist that emulate A1111's weighting if you need parity.

## Sane ranges
- 0.8-1.3 for nudges.
- Above about 1.5 the concept starts to dominate and distort: textures repeat, colours bleed into everything.
- If you need 1.6 to get something to appear, the model probably does not know the concept well. Use a reference image, a LoRA, or inpaint it in.

## Method
Same seed, same prompt, the target term at 1.0, 1.2, 1.4. Post the strip. The point where it starts to break is what other people need to know.`,
  },
  {
    slug: 'upscaling-esrgan-hires-fix-tiled',
    board: 'make/images',
    title: 'Upscaling without mush: hires fix, ESRGAN and tiled diffusion',
    body: `Rendering big directly breaks composition (see the resolution note in the prompt-structure thread). The working route is: render at native size, then upscale in one of three ways.

## 1. Hires fix (a second img2img pass)
Render 512x768 (SD 1.5), upscale 1.5-2x, then re-sample at denoise 0.35-0.55. The second pass adds real detail at the new size. In ComfyUI it is simply Upscale Latent or Upscale Image, then a second KSampler with denoise below 1.

## 2. A pure upscaler model (ESRGAN family)
Real-ESRGAN and community models such as 4x-UltraSharp enlarge 4x with learned sharpening, no diffusion. Fast, faithful, no new detail. Good for a final print size, or as the upscale step inside hires fix (use "Upscale Image (using Model)" in ComfyUI). Real-ESRGAN: https://github.com/xinntao/Real-ESRGAN

## 3. Tiled diffusion (Ultimate SD Upscale and similar)
Upscale with ESRGAN, then cut the image into tiles (512 or 768 square with overlap) and re-sample each tile at low denoise, 0.2-0.35. This reaches 4K and beyond on modest hardware because only one tile is in memory at a time.

## What goes wrong
- Tiles each grow a face: denoise too high, or the prompt describes a subject. Use a texture-only prompt for tiled passes ("detailed, sharp focus") and keep denoise low.
- Visible tile seams: increase overlap or enable seam fixing.
- Plastic skin: the ESRGAN model is over-sharpening; try a gentler one or blend 50% with a plain Lanczos resize.

## On a CPU
Tiled passes multiply time by the number of tiles. On a CPU engine, ESRGAN alone is the practical choice.`,
  },
  {
    slug: 'text-in-ai-images-composite-real-type',
    board: 'make/images',
    title: 'Readable text in AI images: stop asking the model, composite it',
    body: `SD 1.5 cannot spell. SDXL sometimes manages a short word. Newer models do better, but for a sign, a poster headline or a label you need to be exact, the reliable method is to leave space and set real type afterwards.

## Why models garble text
The model learned what text looks like as texture, not as letters. CLIP tokens split words into pieces, and nothing in the training forces each glyph to be correct. So you get letter-shaped marks.

## The method
1. Prompt for the object with a blank surface: "a wooden shop sign, blank, no text", and put text, letters, words, watermark in the negative.
2. Render, pick the image.
3. Open it in an editor (GIMP, Krita, Photopea, Inkscape for vector).
4. Set the text in a real font. Match perspective with a perspective or distort tool.
5. Sell it: lower opacity slightly, add a matching shadow, and use a blend mode (Multiply on paper or wood, Overlay on painted walls) so the grain shows through.
6. Optional: run a very light img2img pass (denoise 0.15-0.25) over the whole image to unify lighting. Check the letters survived; if not, mask them out of the pass.

## When the text should be part of the art
For hand-lettered or carved looks, set the word in a font, render it as a white-on-black image, and use it as a canny or depth ControlNet input. The model then paints the letters you supplied.

## Ancient scripts
Never trust a model with hieroglyphs or cuneiform. See the Type, Scripts & Symbols board for real Unicode fonts and the Studio Scripts tool.`,
  },
  {
    slug: 'composition-value-and-rule-of-thirds',
    board: 'make/images',
    title: 'Composition for generated images: value first, then thirds',
    body: `The model will happily render a technically perfect image with no focal point. Composition is still your job.

## Value before colour
Value is lightness and darkness. A picture that reads in greyscale reads in colour. Desaturate your output (in any editor) or squint at it: if the subject does not separate from the background, no prompt about colour will fix it.

How to steer value:
- Lighting words with a direction: rim light, light from the left, single window light, low key.
- Contrast between subject and ground: "dark figure against a bright sky".
- img2img from a rough value sketch: paint three or four grey shapes where you want them, use denoise 0.6-0.75, and the model keeps your light pattern.

## Placement
- The rule of thirds is a starting point, not a law: put the eye line or horizon on a third rather than dead centre.
- The model centres subjects by default, because training images were often centre-cropped. To move the subject, use a pose or depth ControlNet, or render wider and crop.
- Aspect ratio is composition. Portrait 2:3 for figures, landscape 3:2 or 16:9 for scenes; on SD 1.5 that means about 512x768 or 768x512.

## Method
1. Make a 3-value thumbnail in any paint tool.
2. img2img it with your prompt at denoise 0.65.
3. Desaturate the result. Does it still read? If not, adjust the thumbnail, not the prompt.

Further reading on making a picture for a post: https://wiki.soapbox.community/wiki/Making_an_Image_for_Your_Post`,
  },
  {
    slug: 'colour-palettes-controlling-colour',
    board: 'make/images',
    title: 'Controlling colour: limited palettes, reference images and grading',
    body: `Colour words in a prompt bleed. Ask for "red dress, blue sky" and you often get a purple wash or a red sky. Here are the methods that actually hold a palette.

## 1. Fewer colour words, placed with their object
"woman in a crimson dress" works better than "crimson, woman, dress". If two colours bleed, weight one, or inpaint the second region separately.

## 2. Name a palette, not colours
Terms like monochrome, muted earth tones, duotone, teal and orange, pastel, sepia set the overall mood more reliably than a list of hues.

## 3. img2img from a palette block
Paint the image as flat colour areas in the palette you want, then img2img at denoise 0.6-0.7. The model keeps your colour masses.

## 4. Grade afterwards
This is what painters and photographers do anyway. In GIMP: Colors > Curves per channel, or Colors > Map for gradient maps. In Krita or Photopea: a gradient map adjustment layer. A gradient map with five colours turns any output into exactly your palette, then lower its opacity to taste.

## 5. Reference images
A character or style reference (IP-Adapter) carries the colours of the reference into the result. Useful when you want "this exact costume colour" across a series.

## What goes wrong
- Oversaturated, glowing colour: CFG too high. Lower it before blaming the palette.
- Grey, flat colour: often the VAE. Some checkpoints need a separate VAE file; without it colours wash out.

## Reproduce it
Post the palette (hex values) alongside the image, and which of the methods above you used.`,
  },

  // ── make/character ───────────────────────────────────────────────────────────────────────────────
  {
    slug: 'consistent-character-method-overview',
    board: 'make/character',
    title: 'Consistent characters: the four methods, ranked by effort',
    body: `"How do I get the same character in every image" is the most-asked question in AI art. There are four real methods, and they stack.

## 1. A fixed character record (zero effort)
Write the character once, in a fixed order, and paste it verbatim every time: age, build, skin, face shape, hair colour and style, eye colour, one signature item. Change only the scene words. This alone gets you a family resemblance, not the same person.

## 2. Reference image (low effort)
A reference image steers the new one. IP-Adapter is the standard tool: https://github.com/tencent-ailab/IP-Adapter

Hathor Studio's Character Effects and Appear with Hathor use this: upload the character's picture and describe a new scene. Best balance of effort and result.

## 3. Reference image plus pose or layout control (medium)
IP-Adapter for who, an openpose or depth ControlNet for where and how. This is how you get the same character in a specific pose.

## 4. A trained LoRA (high effort, best result)
Train a small add-on model on 15-30 images of the character. Then a trigger word summons them reliably in any scene. See the LoRA training thread on this board and https://wiki.soapbox.community/wiki/LoRA_and_Fine_Tuning

## What does not work
Reusing the seed. A seed gives the same starting noise; change the prompt and you get a different face.

## The Studio's own method
The Studio's Make it yourself page teaches: make the character first, then the things (objects and places, each on its own), then compose the scene — rather than hoping one prompt gets everything right. The Reference Studio at https://hathor.soapbox.community/compose lets you upload several references at once, each tagged as character, object or scene.`,
  },
  {
    slug: 'character-record-template',
    board: 'make/character',
    title: 'A character record template you can paste',
    body: `Drift comes from wording drift. If you describe the character slightly differently each time, the model draws a slightly different person each time. Fix the words.

## Template
NAME (for you, not the model)
Core line (paste verbatim, always first):
[age] [gender presentation], [build], [skin tone], [face shape], [hair: colour, length, style], [eye colour], [one signature item]

Example core line:
woman in her thirties, tall and lean, deep brown skin, long oval face, short silver locs, amber eyes, gold hoop in left ear

Outfit lines (pick one per image, verbatim):
- Outfit A: indigo linen tunic, leather belt with brass buckle
- Outfit B: black wool coat, high collar

Never in the core line: mood, lighting, setting, camera. Those go after it.

## Why one signature item
Models drop small details first. A single, large, distinctive item (a scar, a coloured streak, an earring on a named side) is something you can check in every image. If the item drifts, the character has drifted.

## A drift checklist
Before keeping an image, check: hair colour and parting, eye colour, the signature item and its side, skin tone under different lighting, apparent age. Lighting changes skin tone in the render; that is lighting, but note it.

## Pair it with a reference
The record keeps words stable; a reference image (IP-Adapter) keeps the face stable. Use both. In Hathor Studio, upload the reference to Character Effects and use the core line as the start of your description.`,
  },
  {
    slug: 'ip-adapter-weight-and-settings',
    board: 'make/character',
    title: 'IP-Adapter settings: weight, which model, and why your character becomes a copy',
    body: `IP-Adapter encodes a reference image and injects it alongside the text prompt. Too little and it is ignored; too much and you get the reference back, pose and background included.

## Weight
- 0.4-0.6: style and general likeness, the prompt still controls the scene.
- 0.6-0.8: strong likeness, workable for characters.
- 0.9-1.0: near-copy. The reference's pose, framing and background leak in.

If your new scene keeps coming back as the old scene, lower the weight before anything else.

## Which IP-Adapter
The project ships several variants, listed at https://github.com/tencent-ailab/IP-Adapter

- The base and "plus" models for general image prompting.
- "plus-face" variants that focus on the face crop.
- FaceID variants that use a face-recognition embedding; stronger identity, but they need an extra face-analysis dependency.
Use the variant that matches your base model (SD 1.5 or SDXL); they are not interchangeable.

## Crop the reference
Use a clean, well-lit, front or three-quarter view, cropped to the face (for face variants) or the full figure (for costume). Busy backgrounds in the reference become busy backgrounds in the output.

## Combine with ControlNet
IP-Adapter decides who; an openpose ControlNet decides the pose. That pairing is the most reliable non-training method for "same character, new pose".

## In the Studio
Hathor Studio's character reference is IP-Adapter. Upload the clearest picture of the character you have; one good reference beats three mediocre ones.`,
    replies: [`Failure seen often: the reference is a stylised drawing and the prompt asks for a photo. IP-Adapter carries style too, so the result lands halfway. Either make a photo-style reference first, or lower the weight and add the medium you want to the prompt.`],
  },
  {
    slug: 'training-a-character-lora-kohya',
    board: 'make/character',
    title: 'Training a character LoRA with kohya sd-scripts: dataset, captions, rank',
    body: `A LoRA is a small set of low-rank weight changes added to a base model. For a character it is the most reliable way to get the same person in any scene. Tool: https://github.com/kohya-ss/sd-scripts (the kohya_ss GUI wraps it).

## Dataset
- 15-30 images for a character is a common working range. Quality and variety beat quantity.
- Variety: different angles, expressions, lighting and backgrounds. If every image has the same background, the LoRA learns the background.
- Crop to the base model's resolution family (512-ish for SD 1.5, about 1024 for SDXL). kohya supports aspect-ratio bucketing, so you do not need to make everything square.
- No watermarks, no other people.

## Captions
- One .txt file per image, same file name.
- Start with a unique trigger word (a made-up token such as "zxchar") and a class word: "zxchar woman, ...".
- Caption what is NOT the character (background, clothing you want to change, lighting). What you leave out of the captions gets absorbed into the trigger word.

## Folder convention
kohya reads repeats from the folder name: a folder named 10_zxchar woman means each image is repeated 10 times per epoch.

## Settings that are reasonable starting points
- Network rank (dim) 16-32, alpha half of rank or equal to it.
- UNet learning rate around 1e-4 with AdamW8bit; text encoder lower or off.
- Total about 1,500-3,000 steps for SD 1.5 characters; save every epoch and compare.

## Spotting overfitting
Test each saved epoch on the same prompt and seed. Overfit LoRAs reproduce training poses, ignore the prompt, and burn colours. Pick the last epoch before that happens, and use the LoRA at weight 0.7-0.9.

Background: https://wiki.soapbox.community/wiki/LoRA_and_Fine_Tuning`,
  },
  {
    slug: 'character-turnaround-reference-sheet',
    board: 'make/character',
    title: 'Making a turnaround sheet as your character reference',
    body: `A turnaround (front, three-quarter, side, back) is the reference animators use. For AI work it serves two jobs: a clean reference for IP-Adapter, and training images for a LoRA.

## Route
1. Generate one strong front view at native resolution. Plain light-grey background, even lighting, neutral pose, full figure. Pick carefully: every later image inherits from this one.
2. For the other angles, use the front view as an IP-Adapter reference (weight about 0.7) and an openpose ControlNet with a three-quarter, side or back skeleton. Keep the character record line identical.
3. Render several seeds per angle; keep the one where the signature item and hair match.
4. Fix small mismatches by inpainting (hair parting, earring side).
5. Lay the views out side by side in any editor.

## Why a plain background
Anything in the reference is carried into new images. A grey seamless background carries nothing.

## Why even lighting
Dramatic light bakes shadows into the character's "look". Flat light gives the model the true colours.

## Checking the sheet
Desaturate it. Silhouette and values should match across views. Then check colour: skin, hair and the signature item, view by view.

## Using it
- As a reference: crop the view closest to the angle you want.
- As LoRA training data: crop each view, then add more images of the character in varied settings so the LoRA does not learn "grey background" as part of the character.`,
  },
  {
    slug: 'objects-and-props-consistency',
    board: 'make/character',
    title: 'Keeping objects and props the same: the "things on their own" step',
    body: `Characters get the attention, but the prop that changes shape between panels (the sword, the crown, the cup) gives a series away just as fast.

## The method: make the thing on its own
1. Generate the object alone, on a plain background, well lit: "an ornate bronze mirror with a lotus handle, product photo, grey background".
2. Pick one. This is now the reference for that object.
3. When composing a scene, give the object its own reference.

Hathor Studio's Reference Studio at https://hathor.soapbox.community/compose is built for this: upload several references, tag each as a character, an object (jewellery, hair, clothing, a prop) or the scene, and generate them together in one image. The Studio's Make it yourself page teaches the same order: character, then things, then the scene.

## Why it works
A model asked for "a woman holding an ornate mirror in a temple" spends its attention on the woman and the temple; the mirror is invented fresh each time. A separate reference gives the mirror its own steering signal.

## When the object must be exact
For a real artefact or a logo, render the scene with a placeholder, then composite the real object photo in an editor and blend with a light img2img pass (denoise 0.2-0.3), masking the object if the pass alters it.

## Check
Lay the panels side by side and compare the object only: silhouette, count of details, colour. If it drifts, lower the scene complexity or raise that reference's weight.`,
  },
  {
    slug: 'same-character-different-art-styles',
    board: 'make/character',
    title: 'Same character, different art style: what transfers and what breaks',
    body: `Moving a character from photo-real to watercolour to pixel art is a stress test: identity has to survive a change in every surface detail.

## What transfers well
- Hair colour and silhouette.
- A large signature item.
- Skin tone, if the style allows realistic colour.

## What breaks first
- Face structure, because stylised faces simplify proportions.
- Eye colour in styles with small eyes.
- Small accessories.

## Method
1. Start from your best reference image.
2. Keep the character record line identical; change only the style words at the end: watercolour illustration, flat vector, 16-bit pixel art.
3. Use IP-Adapter at a lower weight (0.5-0.6) than you would for a same-style image; at high weight it drags the reference's photo style along.
4. If the base model is good at one style and bad at another, change the model or add a style LoRA, not more prompt words.
5. Exaggerate the signature item for strongly stylised styles; a small earring will vanish, a big one survives.

## Remakes as a worked example
The Studio's Remakes keep the layout of an ancient artwork and render it in three looks (realistic, half vaporwave, full MELEK look), and in several peoples side by side. Same composition, different surfaces. See https://wiki.soapbox.community/wiki/Remakes and the gallery at https://hathor.soapbox.community/remakes

## Post it as a strip
One reference, three styles, same seed, same record line. Mark where identity broke. That is more useful than the prettiest single image.`,
  },
  {
    slug: 'putting-yourself-in-an-image-consent',
    board: 'make/character',
    title: 'Putting yourself (or a client) into an image: the method and the limits',
    body: `Putting a real face into a generated scene is the most common character request after original characters, and it has its own rules.

## The method
1. Use a clear, front-facing photo in even light, no sunglasses, hair off the face. One good photo beats several poor ones.
2. Use a face-focused reference adapter, or the Studio's Character Effects. Hathor Studio's Generate tool can also take a photo to put yourself in the picture.
3. Describe the scene and clothing; let the reference carry the face.
4. Check identity at a small size: if it reads as the person at thumbnail size, it works.

## Common failures
- Looks like a sibling, not you: the reference is low-resolution or at an angle. Retake the photo.
- Same expression in every image: the reference's expression is carried over. Ask for the expression explicitly, or use a reference with a neutral face.
- Skin tone shifts: scene lighting words ("golden hour", "neon") recolour skin. That is lighting; add "natural skin tone" if it matters.

## Limits
- Only use photos of yourself, or of people who have agreed.
- Hathor Studio's content rules: it never generates nude imagery from an uploaded photo of a real person, never generates sexual imagery of minors, and does not generate hardcore pornography. Figure and nude art is allowed as art behind an 18+ self-confirmation.
- Images of real people can mislead. Label edited and generated images as such when you post them.

Studio overview: https://wiki.soapbox.community/wiki/Hathor_Studio`,
  },
  {
    slug: 'reading-drift-faces-across-a-series',
    board: 'make/character',
    title: 'Measuring drift across a series: a quick, honest check',
    body: `"Consistent" is easy to claim and hard to see on a phone screen. Here is a quick way to check a series before you post it.

## 1. The contact sheet
Put every image of the character in a grid at the same size. Look at the grid, not single images. Drift that is invisible one at a time is obvious in a grid.

## 2. Crop to the face
Crop each face to the same framing (eyes on the same line) and place them in a row. Compare eye spacing, nose length, jaw shape, hairline. These are what identity rests on.

## 3. The feature checklist
For each image, tick: hair colour, hair parting side, eye colour, signature item present and on the correct side, apparent age. Count the ticks. A series where every image scores full marks on the list but the faces differ still has drift; the list catches the easy cases only.

## 4. Flip test
Mirror one image horizontally and compare it with another. Asymmetries (a parting, a mole, an earring) that swap sides show the model is not tracking the feature.

## What to do with drift
- Face drifts: raise reference weight or switch to a face-specific adapter; or train a LoRA.
- Small features drift: make them bigger, or fix them by inpainting.
- Age drifts: put an explicit age in the record line and remove words that imply age ("elegant", "cute").

## Post the grid
On this board, post the grid and the checklist with your method. "It drifted at image 6 when I changed the lighting" is the kind of finding that helps the next person.`,
  },

  // ── make/engines ─────────────────────────────────────────────────────────────────────────────────
  {
    slug: 'lcm-steps-and-cfg-on-cpu',
    board: 'make/engines',
    title: 'LCM on CPU: why Hathor Studio takes one to three minutes, and the settings behind it',
    body: `Hathor Studio's own engine is Dreamshaper 8 (a Stable Diffusion 1.5 model) running on the CPUs of a MELEK server. On CPU a normal 25-step render takes many minutes. LCM brings it down to about one to three minutes an image.

## What LCM is
A latent consistency model is a distilled model that predicts the finished image in a few steps instead of many. The LCM-LoRA (Luo et al., 2023) applies that distillation to an existing SD 1.5 or SDXL checkpoint as a small add-on, so a fine-tune such as Dreamshaper can use it.

## Settings for LCM
- Sampler: LCM.
- Steps: 4-8. Four is usable; six to eight adds detail. More does little.
- CFG: about 1-2. Normal values (7) produce harsh, burnt images.
- Negative prompt: has little effect at CFG near 1.
- LCM-LoRA weight: 1.0 is typical.

## What CPU-only genuinely cannot do
- Many images in parallel: the Studio's server renders one image at a time, and people using the site go before the Studio's own background work.
- Practical SDXL at speed, video, or LoRA training. Those want a GPU.

## If you want it faster
Use your own capacity at https://hathor.soapbox.community/engines — the exact engine the studio runs as one Python file on your computer or a free Colab, or your own Modal GPU (about two seconds an image), or a fal.ai or Gemini key.

## Reproduce it locally
Same checkpoint (Dreamshaper 8), the LCM-LoRA, LCM sampler, 6 steps, CFG 1.5, 512x512. Post your machine and your time per image; that number is useful to everyone on this board.`,
  },
  {
    slug: 'vram-requirements-sd15-sdxl-flux',
    board: 'make/engines',
    title: 'How much VRAM do you need? SD 1.5, SDXL and Flux, honestly',
    body: `These are working ranges, not guarantees; driver, front end and settings move them. Post your card and your numbers to correct them.

## SD 1.5
- Model file: about 2 GB in fp16 (pruned).
- Runs on 4 GB cards with A1111's --medvram or --lowvram flags, or ComfyUI's automatic low-VRAM mode. 6-8 GB is comfortable for 512x768 with a ControlNet.
- Runs on CPU, slowly; LCM makes CPU practical (see the LCM thread).

## SDXL
- Base model file: about 6.9 GB in fp16.
- 8 GB works with offloading flags; 12 GB is comfortable; refiner plus base together want more.
- CPU is possible but painfully slow.

## Flux.1 (Black Forest Labs)
- A 12-billion-parameter model; the full-precision weights are much larger than SDXL.
- Quantised versions (fp8, and GGUF via the ComfyUI-GGUF custom nodes) bring it within reach of 8-12 GB cards at some quality and speed cost.
- Licences differ: Flux.1 [schnell] is Apache 2.0; Flux.1 [dev] has a non-commercial licence. Read the model card before selling output.

## Training
LoRA training on SD 1.5 is commonly done on 8 GB with memory-saving options (gradient checkpointing, 8-bit optimisers); SDXL LoRA training wants roughly 12-24 GB depending on settings.

## Free and cheap GPU options
- Google Colab's free tier has offered NVIDIA T4 GPUs (16 GB) subject to availability and time limits.
- Your own Modal account runs a GPU per request. Hathor Studio's engines page has the setup for both: https://hathor.soapbox.community/engines`,
    replies: [`Correction-style note to keep this honest: "fits in VRAM" and "pleasant to use" are different numbers. If you post a result, include resolution, batch size and time per image, not just whether it ran.`],
  },
  {
    slug: 'comfyui-first-workflow',
    board: 'make/engines',
    title: 'ComfyUI from zero: the seven nodes of a basic workflow',
    body: `ComfyUI is a node-based interface for diffusion models, at https://github.com/comfyanonymous/ComfyUI

It looks intimidating, but the default workflow is seven nodes, and every advanced workflow is those seven plus additions.

## The seven nodes
1. Load Checkpoint: loads the model, and outputs MODEL, CLIP and VAE.
2. CLIP Text Encode (positive): your prompt.
3. CLIP Text Encode (negative): your negative prompt.
4. Empty Latent Image: sets width, height and batch size.
5. KSampler: seed, steps, CFG, sampler, scheduler, denoise. This is where the image is made.
6. VAE Decode: turns the latent into pixels.
7. Save Image: writes the PNG, with the whole workflow embedded in it.

## Install
The project README covers Windows (a portable build), Linux and macOS. Models go in ComfyUI/models/checkpoints, LoRAs in models/loras, ControlNets in models/controlnet.

## Two habits that save hours
- Drag any ComfyUI-made PNG onto the canvas and the workflow that made it loads. Share PNGs, not screenshots.
- Install ComfyUI-Manager to install missing custom nodes when you load someone else's workflow.

## Extending the seven
- img2img: replace Empty Latent with Load Image, then VAE Encode, and set KSampler denoise below 1.
- LoRA: put a Load LoRA node between Load Checkpoint and everything that uses MODEL and CLIP.
- ControlNet: Apply ControlNet between your positive CLIP Text Encode and the KSampler.

The wiki's overview: https://wiki.soapbox.community/wiki/Generative_Image_AI_and_ComfyUI`,
  },
  {
    slug: 'run-studio-engine-on-colab',
    board: 'make/engines',
    title: 'Running the Studio\'s engine on your own machine or a free Colab',
    body: `Hathor Studio publishes the exact engine it runs, as one Python file, so anyone can run the same pipeline on their own capacity. The instructions are on the Studio's engines and Make it yourself pages: https://hathor.soapbox.community/engines

## Why bother
- The Studio's free server renders one image at a time, and when several people are waiting it tells you and offers your own engine instead.
- On a GPU the same pipeline is far faster than the server's CPU.

## The three routes
1. Your own computer. Works on CPU (slow, like the server) or an NVIDIA GPU (fast).
2. A free Google Colab notebook. Colab's free tier gives a GPU when available, with session time limits; you lose the session when the tab sits idle.
3. Your own Modal GPU, about two seconds an image according to the Studio's page.

## Connecting it
After you start your worker, connect it from the engines page ("My own worker"). The Studio then sends your requests to your engine.

## Keys
- Keys typed into the page stay in that browser and go only to the chosen provider.
- Keys kept in your Pentecaust account (Pentecaust Connect) are encrypted at rest, and the Studio receives only a short-lived pass that can make images; it never sees the keys. See https://wiki.soapbox.community/wiki/Pentecaust

## Report back here
Post your hardware and your seconds per image. A table of real numbers from real machines is exactly what this board is for.`,
  },
  {
    slug: 'bring-your-own-key-fal-gemini',
    board: 'make/engines',
    title: 'Bring your own key: fal.ai or Gemini in the Studio, and what happens to the key',
    body: `If you already pay for an image API, Hathor Studio can use it instead of the free CPU engine. The option is on https://hathor.soapbox.community/engines

## Which providers
The engines page accepts a fal.ai key or a Google Gemini key, called straight from your browser.

## Where the key goes
- Typed into the page: it stays in that browser and goes only to the provider you chose. The Studio's server is not in the path.
- Kept in Pentecaust: keys stored in your Pentecaust account are encrypted at rest. When you press Link, the Studio receives a short-lived pass that can only make images; it never sees the key itself.

## When it is worth it
- You want SDXL-class or newer models, or speed.
- You want video. The Studio has no free video capacity; text-to-video and image-to-video use your own key (for example fal.ai) or your own GPU.

## Practical cautions
- Image APIs bill per request. Set a spending limit in the provider's dashboard before experimenting.
- Revoke and rotate any key you have pasted somewhere you no longer trust.
- Never paste a key into a forum post, a chat or a screenshot. If you do, revoke it immediately at the provider.

## Report it
Which provider, which model, time per image, and anything that did not work. Bugs in the Studio's handling of keys belong on the Hathor Studio board with the exact steps.`,
  },
  {
    slug: 'quantisation-fp16-fp8-gguf',
    board: 'make/engines',
    title: 'Quantisation for image models: fp16, fp8 and GGUF, in plain terms',
    body: `Quantisation stores model weights with fewer bits. Fewer bits means a smaller file, less memory, and sometimes faster inference, at some cost in quality.

## The common formats
- fp32: full precision. Rarely needed for inference.
- fp16 / bf16: half precision. The normal way to run SD 1.5 and SDXL on GPU; visually indistinguishable from fp32 for almost all use.
- fp8: eight-bit floating point. Used to fit larger models such as Flux into consumer VRAM. Small quality loss, usually acceptable.
- GGUF (Q8, Q5, Q4 and similar): a format from the llama.cpp world, brought to image models by the ComfyUI-GGUF custom nodes. Lower Q numbers mean smaller files and more quality loss.

## What quantisation does not fix
- Speed on CPU: a smaller model is not automatically a faster model on a CPU without suitable kernels.
- Quality problems in the base model.
- Text encoders: large text encoders (such as the T5 encoder used by Flux) are often the real memory hog. They can be quantised separately, or run on CPU.

## A sane order of attempts on a small GPU
1. fp16 with the front end's low-VRAM mode.
2. fp8 weights.
3. GGUF Q8, then Q5 or Q4.
At each step render the same prompt and seed and compare. Post the strip; the point where quality visibly drops is model-specific and worth recording.`,
  },
  {
    slug: 'comfyui-as-an-api',
    board: 'make/engines',
    title: 'Driving ComfyUI from a script: the HTTP API in five calls',
    body: `ComfyUI's server has an HTTP and WebSocket API, which is how most "AI image" web apps and bots drive it. The project includes example scripts in the script_examples folder of its repository: https://github.com/comfyanonymous/ComfyUI

## Get the workflow in API format
In the ComfyUI interface, enable the developer option, then use Save (API format). That JSON is a flat map of node ids to inputs, which is what the API expects; the normal saved workflow JSON is a different, UI-oriented format.

## The calls
1. POST /prompt with a body of {"prompt": <api-format workflow>, "client_id": "<your uuid>"}. The response gives a prompt_id.
2. Connect to ws://host:8188/ws?clientId=<your uuid> to receive progress and "executing" messages.
3. When execution finishes, GET /history/<prompt_id> to see the outputs.
4. GET /view?filename=...&subfolder=...&type=output to download each image.
5. POST /upload/image to send an input image for img2img or a ControlNet.

## Changing inputs
Edit the JSON before you post it: the KSampler node's seed, the CLIP Text Encode node's text. Node ids are stable within one exported workflow.

## Safety
ComfyUI's server has no authentication. Bind it to 127.0.0.1 (the default) or put it behind a reverse proxy with auth. Never expose port 8188 to the internet, and only install custom nodes you trust: they run arbitrary Python.`,
  },
  {
    slug: 'what-cpu-only-cannot-do',
    board: 'make/engines',
    title: 'What CPU-only image generation genuinely cannot do (and what it can)',
    body: `Hathor Studio runs on CPUs on purpose: it means free, no account, and no GPU bill. It also means real limits, and it is better to state them than to have people discover them.

## What works on CPU
- SD 1.5-class models with LCM at 4-8 steps: about one to three minutes an image on the Studio's server.
- Character reference (IP-Adapter) and layout reference (ControlNet) on top of that.
- Non-diffusion tools: background removal, ImageMagick, G'MIC and GIMP filters, conversion, vectorising. The Studio runs these on its server.

## What does not work well on CPU
- Many images at once. The Studio renders one image at a time; people using the site go first, background work waits.
- SDXL and larger models at a usable speed.
- Video. The Studio offers text-to-video and image-to-video, but only through your own key (such as fal.ai) or your own GPU.
- Training LoRAs.
- Large tiled upscales with diffusion (each tile is another full render).

## The design answer
Free CPU for everyone, and your own engine for speed: the exact engine as one Python file, a free Colab, your own Modal GPU, or your own key. All on https://hathor.soapbox.community/engines

## Your numbers
If you run SD 1.5 with LCM on your own CPU, post: CPU model, cores, RAM, resolution, steps, seconds per image. Real numbers will help the next person decide whether their laptop is enough.`,
  },

  // ── make/type ────────────────────────────────────────────────────────────────────────────────────
  {
    slug: 'unicode-blocks-for-ancient-scripts',
    board: 'make/type',
    title: 'Real ancient scripts in your designs: the Unicode blocks and the Noto fonts',
    body: `If you want hieroglyphs, cuneiform or Linear B in a design, do not generate them. The signs are encoded in Unicode and free fonts exist. Typeset them, then composite.

## The blocks
Code charts: https://www.unicode.org/charts/
- Egyptian Hieroglyphs: U+13000-U+1342F, ordered by the Gardiner sign list. Format controls for arranging signs in quadrats start at U+13430.
- Cuneiform: U+12000-U+123FF, with Cuneiform Numbers and Punctuation at U+12400.
- Linear B Syllabary: U+10000-U+1007F; Linear B Ideograms: U+10080-U+100FF.
- Phoenician: U+10900-U+1091F. Written right to left.
- Ugaritic: U+10380-U+1039F. A cuneiform alphabet of 30 letters, written left to right.

## Fonts
Google's Noto family covers all of these: Noto Sans Egyptian Hieroglyphs, Noto Sans Cuneiform, Noto Sans Linear B, Noto Sans Phoenician, Noto Sans Ugaritic. https://fonts.google.com/noto

## The method
1. Write the text as Unicode: copy from the code charts, or use Hathor Studio's Scripts tool at https://hathor.soapbox.community/scripts
2. Set it in the Noto font in a vector editor (Inkscape, Illustrator) and convert to paths.
3. Composite onto the render: perspective-distort to the surface, blend mode Multiply or Overlay, add a carved or painted effect.
4. For a carved look, render the glyphs as a white-on-black image and use it as a depth or canny ControlNet input.

## Post the source
Give the transliteration and where the sign values come from. A design with correct signs and a cited source is the thing this board exists for.`,
  },
  {
    slug: 'gardiner-sign-list-uniliteral-signs',
    board: 'make/type',
    title: 'The Egyptian uniliteral signs: Gardiner numbers and transliteration',
    body: `Most "write my name in hieroglyphs" requests are built from the uniliteral (one-consonant) signs. Here they are with their Gardiner numbers and conventional transliteration. Egyptian writing does not record vowels, so a modern name is spelt by its consonants.

- G1 Egyptian vulture: ꜣ (glottal sound, often written "a" in names)
- M17 flowering reed: i
- D36 forearm: ꜥ (a guttural, written ' or a)
- G43 quail chick: w (also written as the coil Z7)
- D58 foot and leg: b
- Q3 stool: p
- I9 horned viper: f
- G17 owl: m
- N35 water ripple: n
- D21 mouth: r
- O4 reed shelter: h
- V28 twisted wick: ḥ
- Aa1 placenta (or sieve): ḫ
- F32 animal belly: ẖ
- O34 door bolt: z (also s)
- S29 folded cloth: s
- N37 pool: š (sh)
- N29 hill slope: q
- V31 basket with handle: k
- W11 jar stand: g
- X1 bread loaf: t
- V13 tethering rope: ṯ (tj)
- D46 hand: d
- I10 cobra: ḏ (dj)

## Transliteration conventions
Egyptologists use the special letters above. For typing, the Manuel de Codage (MdC) uses ASCII: A for ꜣ, a for ꜥ, H for ḥ, x for ḫ, X for ẖ, S for š, T for ṯ, D for ḏ.

## Arranging the signs
Egyptian is written in square groups (quadrats), not a single line, and can run left or right; signs face the start of the line. Unicode supports quadrats with format controls, but font and software support varies. For a design, arrange signs by hand in a vector editor.

## Sources
Gardiner, Egyptian Grammar (3rd ed., 1957), the sign list. Background on Egyptian ritual writing: https://wiki.soapbox.community/wiki/Egyptian_Magic`,
    replies: [`A common mistake in name cartouches: using the ankh or other word-signs as letters. The ankh (S34) stands for the consonants ꜥnḫ, not a single sound. Stick to uniliterals for spelling, and place the cartouche ring (V10) around a royal name only if that is the claim you mean to make.`],
  },
  {
    slug: 'why-models-garble-glyphs',
    board: 'make/type',
    title: 'Why image models invent fake hieroglyphs and runes, and how to check a render',
    body: `Ask any image model for "a wall of hieroglyphs" and you get convincing nonsense: signs that look Egyptian but are not in any sign list, mirrored mid-line, repeated in patterns no scribe would use. The same happens with runes, cuneiform and Chinese characters.

## Why
The model learned what these scripts look like as texture. Nothing in training tied a mark to a sign value, so it reproduces the statistics of the surface: density, line weight, a few frequent shapes such as the owl or the eye. Tokenisers also break rare words into pieces, so prompting the name of a sign does not help.

## How to check a render
1. Pick five signs at random in the image.
2. Look each one up in a sign list or the Unicode code chart for the script: https://www.unicode.org/charts/
3. If you cannot find them, the inscription is decorative noise.
4. Check direction: Egyptian signs face the start of the line; mixed directions in one column are a giveaway.

## What to do instead
- Leave the surface blank in the render ("smooth stone, no inscriptions") and set real signs from a Noto font, then composite. See the Unicode blocks thread on this board.
- For carved or painted results, use the typeset signs as a canny or depth ControlNet map, so the model paints your signs.
- Hathor Studio's Scripts tool is at https://hathor.soapbox.community/scripts

## When decorative is fine
For a fantasy world, invented glyphs are a design choice. Say so in the post. The problem is only fake script presented as a real one.`,
  },
  {
    slug: 'linear-b-for-designers',
    board: 'make/type',
    title: 'Linear B for designers: syllabograms, ideograms and getting a word right',
    body: `Linear B is the script of Mycenaean Greek, on clay tablets from Knossos, Pylos and other sites, deciphered by Michael Ventris in 1952 with John Chadwick's collaboration. It is a syllabary (signs for syllables such as da, ko, ri) plus ideograms (signs for commodities such as wheat, wine and horses) and a decimal number system.

## In Unicode
- Linear B Syllabary: U+10000-U+1007F.
- Linear B Ideograms: U+10080-U+100FF.
- Aegean Numbers (shared with Linear A): U+10100.
Font: Noto Sans Linear B, from https://fonts.google.com/noto

## Spelling rules that trip people up
Linear B spelling is approximate. Final consonants and many clusters are not written, and r and l share signs. The Greek word for tripod, ti-ri-po, is a classic example in the tablets. So a modern name has to be broken into open syllables, and the result is a convention, not a perfect spelling.

## The method for a name or word
1. Break it into consonant-vowel syllables, dropping consonants Linear B would not write.
2. Find each syllable's sign in the code chart.
3. Typeset in Noto Sans Linear B, left to right, with a short vertical word divider between words as the tablets do.
4. For a tablet look, set the text in a vector editor, export white-on-black, and use it as a depth ControlNet map on a clay-tablet prompt.

## Post the breakdown
Give the syllable breakdown and the code points with the render, so someone can check it. That is the standard for this board.`,
  },
  {
    slug: 'phoenician-and-ugaritic-alphabets',
    board: 'make/type',
    title: 'Phoenician and Ugaritic: two alphabets, two directions, one design pitfall',
    body: `Both scripts are early alphabets from the Levant, and both are encoded in Unicode with Noto fonts. They are often confused in designs, and they run in opposite directions.

## Phoenician
- 22 letters, consonants only.
- Written right to left.
- Unicode block U+10900-U+1091F; font Noto Sans Phoenician.
- The ancestor of the Greek, and through it the Latin, alphabet; also of Aramaic and so of the Hebrew square script.

## Ugaritic
- 30 letters, written as wedge-shaped signs pressed into clay with a stylus: a cuneiform alphabet, from the city of Ugarit on the Syrian coast (Late Bronze Age).
- Written left to right.
- Unicode block U+10380-U+1039F; font Noto Sans Ugaritic.
- Abecedary tablets found at Ugarit preserve its letter order.

## The design pitfall: direction
Most design tools will display right-to-left scripts correctly only if the text is marked as right-to-left. When you convert Phoenician to paths, check the letter order did not flip. Read the first letter against your source before exporting.

## Method
1. Write the text in transliteration first.
2. Map each consonant to its code point from the chart: https://www.unicode.org/charts/
3. Set in the Noto font with the right direction.
4. Convert to paths; composite onto the render with a stone, bronze or clay treatment.

## Source the text
If you are quoting an actual inscription, name it and the edition you took it from. The scripture shelves give a cite-as line for each passage: https://hierophant.soapbox.community/shelves`,
  },
  {
    slug: 'vectorising-ai-art-for-print',
    board: 'make/type',
    title: 'Vectorising a generated image for logos, cutting and print',
    body: `A logo, a vinyl cut or a laser engraving needs vectors, not pixels. Generated images can become clean vectors if you prepare them for it.

## Tools
- Potrace: traces black-and-white bitmaps into smooth curves. Inkscape's Path > Trace Bitmap uses it.
- VTracer: traces colour images into layered shapes.
- Hathor Studio includes a vectorizer among its editing tools.

## Prepare the image first
1. Generate for tracing: flat colour, bold shapes, no gradients, no texture. Prompt words such as flat vector illustration, solid colours, thick outlines, white background help.
2. Upscale before tracing (an ESRGAN upscale is fine); tracers work better on more pixels.
3. Reduce colours: posterise to 2-8 colours in an editor. Every extra colour becomes another layer of shapes.
4. Clean stray specks with an eraser or a despeckle filter.

## Trace settings
- Potrace: raise the speckle suppression and corner smoothing for logos; lower them for detailed line art.
- VTracer: set the colour precision and filter speckle values; fewer colour layers means a cleaner file.

## After tracing
- Simplify paths (Inkscape: Path > Simplify) and delete tiny shapes.
- Check node count. Thousands of nodes on a simple shape means the input was noisy.
- Replace any text with real type.

## Post it
The input, the posterised version, the trace settings, and the result. The settings are what make it reproducible.`,
  },

  // ── studio ───────────────────────────────────────────────────────────────────────────────────────
  {
    slug: 'reporting-a-studio-bug',
    board: 'studio',
    title: 'Reporting a Studio bug: what to include so it can be fixed',
    body: `This board is for the Hathor Studio tool itself: what a setting does, what broke, what you wish it did. A bug report that can be reproduced gets fixed; "it did not work" usually cannot be.

## Include
- The route: which page (for example https://hathor.soapbox.community/remake or /compose or /engines) and which tool.
- The exact inputs: prompt, any options chosen (look, people, references), and whether you uploaded an image (describe it if you cannot share it).
- What you expected and what happened instead, including any message on screen word for word.
- Time and date (with time zone). The server renders one image at a time, so timing helps tell a queue delay from a failure.
- Browser and device.
- Whether you were using the free engine or your own engine or key.

## Do not include
- API keys, passwords or seed phrases. Never paste them into a post. If you did, revoke the key at the provider straight away.
- Photos of other people without their agreement.

## Before you post
- Try once more after a few minutes: if several people were waiting, the Studio says so and offers your own engine instead.
- Try a different image or a shorter prompt to narrow it down.

## Feature requests
Same shape: what you were trying to make, what got in the way, what would have helped. A request tied to a real attempt is much easier to act on.

Craft questions (prompts, seeds, characters) are better on the Make boards, where the answer helps more people.`,
  },
  {
    slug: 'reference-studio-tagging-guide',
    board: 'studio',
    title: 'Reference Studio: tagging references as character, object or scene',
    body: `The Reference Studio at https://hathor.soapbox.community/compose lets you upload several references at once and generate them together in one image. Each reference is tagged as a character, an object (jewellery, hair, clothing, a prop) or the scene. The tag tells the Studio what role that picture plays.

## How to choose references
- Character: a clear, evenly lit picture of the person or figure. Plain background is best.
- Object: the item on its own, on a plain background. Make one first in Generate if you need to.
- Scene: a picture of the place or setting whose look you want.

## Order of work (the Studio's own method)
The Make it yourself page teaches the same sequence: make the character, then the things (objects and places, each on its own), then compose the scene. Each piece is easier to get right on its own than all at once in one prompt.

## Writing the description
Describe the action and arrangement: who is holding what, where they stand, the light. Do not re-describe everything the references already show; let them carry appearance.

## Common problems
- The character copies the reference's pose: use a reference with a neutral pose, and describe the pose you want.
- An object is ignored: the object reference is cluttered or tiny. Crop it tightly.
- Everything looks like the scene reference: the scene picture is dominating. Use a simpler one.

Post your references and description with the result on the Characters & Consistency board if you want feedback on the method.`,
  },
  {
    slug: 'studio-queue-and-busy-message',
    board: 'studio',
    title: 'Why the Studio sometimes says it is busy, and what to do',
    body: `Hathor Studio's free engine runs on the CPUs of a MELEK server. It renders one image at a time, about one to three minutes each. That is what makes it free with no account and no card, and it is also why it can be busy.

## The order of work
People using the site always go first. The Studio's own background work (the Remakes gallery, object libraries) waits behind them.

## When several people are waiting
Rather than leaving you waiting for many minutes, the Studio tells you and offers your own engine instead.

## Your options
- Wait: keep the tab open. A remake or image needs the tab open for a few minutes.
- Your own engine, at https://hathor.soapbox.community/engines
  - My own worker: the exact engine the Studio runs, as one Python file, on your computer, a free Colab notebook, or your own Modal GPU (about two seconds an image).
  - A fal.ai or Google Gemini key, called straight from your browser.
  - Keys kept in your Pentecaust account, linked so the Studio only receives a short-lived pass that can make images.

## Video is different
There is no free video capacity at all. Text-to-video and image-to-video at https://hathor.soapbox.community/video use your own key or GPU.

If the Studio fails rather than queues (an error, or no image after a long wait with nobody else waiting), report it on this board with the details in the bug-report thread.`,
  },
  {
    slug: 'studio-editing-tools-overview',
    board: 'studio',
    title: 'The Studio\'s editing tools: background removal, filters, converter, vectorizer',
    body: `Beyond generating images, Hathor Studio has a set of editing and file tools that run on its server. Per the Studio's documentation at https://wiki.soapbox.community/wiki/Hathor_Studio they are:

- A photo editor with background removal and replacement.
- Art filters: ImageMagick, G'MIC and GIMP effects, run on the server.
- An image converter.
- A vectorizer.
- A business-card designer.
- A reel maker for short social videos.

## Where they fit in a workflow
- Background removal before using a picture as a character or object reference: a clean subject on a plain background is a better reference.
- Vectorizer for logos and cut files (see the vectorising thread on Type, Scripts & Symbols for how to prepare the image).
- Converter when a site wants a different format or a smaller file for a post. For images in MELEK posts see https://wiki.soapbox.community/wiki/Images_and_Video_in_Posts

## Reporting problems
If a filter or tool produces something unexpected, post on this board with: the tool, the settings, the input file type and size, and what came out. File size and format matter for converters and filters.

## Requests
If a tool you need is missing, post what you were trying to do and which tool you used elsewhere to do it. Requests tied to a concrete task are easier to judge.`,
  },

  // ── demoscene ────────────────────────────────────────────────────────────────────────────────────
  {
    slug: 'raymarching-signed-distance-functions-shadertoy',
    board: 'demoscene',
    title: 'Raymarching with signed distance functions: the demoscene technique behind Shadertoy',
    body: `Much of the modern size-coded demoscene (4k and 64k intros) and most of Shadertoy rests on one technique: raymarching signed distance functions (SDFs).

## The idea
An SDF is a function that, for any point in space, returns the distance to the nearest surface. A sphere of radius r at the origin is simply length(p) - r. Combine shapes with min() for union and max() for intersection; smooth versions blend shapes together.

## Raymarching (sphere tracing)
For each pixel:
1. Start a ray at the camera.
2. Evaluate the SDF at the ray's current point. That distance is safe to step: nothing is closer.
3. Step forward by that distance. Repeat until the distance is tiny (a hit) or the ray has gone too far (a miss).
4. Shade the hit: estimate the normal from the SDF's gradient (sample it at small offsets), then light it.

The whole scene is a few lines of maths in one fragment shader, which is why it fits in a 4-kilobyte executable.

## Where to learn and see it
- Shadertoy, created by Inigo Quilez and Pol Jeremias, where shaders run live in the browser: https://www.shadertoy.com
- Inigo Quilez's articles on distance functions: https://iquilezles.org/articles/
- Demoscene archives: https://www.pouet.net and https://demozoo.org

## Try it
Write a sphere and a ground plane as SDFs, march them, and shade with one directional light. Post the shader and a screenshot. Then add soft shadows by marching from the hit point toward the light.`,
  },
  {
    slug: 'demoscene-parties-and-size-categories',
    board: 'demoscene',
    title: 'Demoscene categories explained: 4k, 64k, demos, and where they are shown',
    body: `The demoscene is the computer-art subculture that grew out of 1980s cracktros: real-time audiovisual works computed live, not played back as video. Competitions ("compos") at parties are where new work is released.

## The main categories
- Demo: no size limit. Judged on art, code and music together.
- 64k intro: the whole executable, graphics and music included, in 64 kilobytes. Textures, meshes and music are generated procedurally at run time.
- 4k intro: 4 kilobytes. Usually a single shader plus a tiny synthesiser and a compressor.
- Smaller categories exist (1k, 256 bytes) on some platforms.
- Oldskool / platform compos for C64, Amiga, ZX Spectrum and others.
- Non-real-time compos: pixel graphics, tracked music, photos, animation.

## A landmark of procedural size-coding
.kkrieger by .theprodukkt (2004) is a playable first-person shooter in 96 kilobytes, with all textures and models generated from code at start-up.

## Parties
- Assembly, held in Finland since 1992.
- Revision, held in Saarbrücken, Germany, every Easter since 2011, the successor to Breakpoint.
Many parties stream compos online.

## Archives
- https://www.pouet.net for releases and comments.
- https://demozoo.org for credits, parties and groups.
- Finland added the demoscene to its national inventory of intangible cultural heritage in 2020, and several other countries have since done the same.

## Why it belongs on the Make pillar
Size-coding is the opposite of a giant model: everything from a few kilobytes of maths. The raymarching thread on this board is a place to start.`,
  },

  // ── development ──────────────────────────────────────────────────────────────────────────────────
  {
    slug: 'png-generation-metadata-a1111-comfyui',
    board: 'development',
    title: 'Reading generation settings from a PNG: A1111 and ComfyUI metadata',
    body: `Generated PNGs usually carry their settings inside the file. Reading them is how you reproduce someone's image, and how a forum or gallery can show "the method" automatically.

## Where the data is
PNG files can hold text chunks (tEXt or iTXt) with a keyword and a value.
- A1111 writes one chunk with the keyword "parameters": the prompt, then "Negative prompt:", then a line such as "Steps: 25, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 1234, Size: 512x768, Model: ...".
- ComfyUI writes two JSON chunks: "prompt" (the API-format graph that ran) and "workflow" (the full UI graph). Dragging the PNG onto ComfyUI loads the workflow from these.

## Reading it
- Python with Pillow: Image.open(path).info returns the text chunks as a dict.
- Command line: exiftool shows PNG text chunks.
- In the browser: parse the chunk list from the file bytes (each chunk is length, type, data, CRC), or use a small PNG library.

## Where it gets lost
- Many social sites and chat apps re-encode images and strip metadata.
- JPEG and WebP conversion drops PNG text chunks.
- Some image hosts keep the file byte-for-byte; test yours.

## For anyone building on MELEK
If you build a gallery or post tool, keep the original PNG, read these chunks, and show the settings next to the image. That is "the method is in the post", done by software. Building notes: https://wiki.soapbox.community/wiki/Building_a_MELEK_Front_End

## Privacy
Metadata can include file paths and model names from your machine. Strip it deliberately (save a copy without text chunks) when you do not want to share it.`,
  },
  {
    slug: 'image-posts-on-melek-hosting-and-formats',
    board: 'development',
    title: 'Putting generated images into MELEK posts: formats, sizes and keeping the method',
    body: `Posts on MELEK are Markdown, and images are referenced by URL. A few habits keep image posts fast to load and reproducible.

## Format and size
- PNG for anything with sharp edges, text or flat colour; it also keeps generation metadata.
- JPEG or WebP for photos and painterly images, at a sensible width (1200-2000 px is plenty for a post).
- Keep the original PNG somewhere if you want the settings preserved; the posted copy may be compressed.

## Writing the post
Markdown image syntax is an exclamation mark, alt text in square brackets, then the URL in parentheses. The wiki covers images and video in posts here: https://wiki.soapbox.community/wiki/Images_and_Video_in_Posts and Markdown formatting here: https://wiki.soapbox.community/wiki/Formatting_Posts_with_Markdown

## Alt text
Write what the image shows, not the prompt. Screen readers and search engines both use it.

## Put the method under the image
For a Make post, add a short block under each image:
- Engine and model.
- Prompt and negative prompt.
- Seed, steps, CFG, sampler, size.
- References or ControlNet maps used.

## Making the picture in the first place
The wiki's guide to making an image for a post: https://wiki.soapbox.community/wiki/Making_an_Image_for_Your_Post

Hathor Studio makes images free, with no account: https://hathor.soapbox.community`,
  },
];
