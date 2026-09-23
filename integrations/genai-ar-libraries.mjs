// genai-ar-libraries.mjs — curated, real open-source AR / computer-vision libraries and repos the Hathor
// studio draws from, and that visitors can build on themselves. Free/open only. Zero-dep data module;
// each entry is verifiable (name, what it does, repo/site, license). Grouped by capability.
//
//   listArGroups()  -> [{ id, title, blurb, items:[...] }]
//   AR_LIBRARIES    -> flat array
//
// House rule: honest. "runs in the browser" = client-side (the visitor's own device, no GPU on us).
// Items needing a GPU/heavy compute are marked served:'gpu' so surfaces can label them truthfully.

export const AR_LIBRARIES = [
  // ── face / body / hand tracking (client-side, real-time) ─────────────────────────────────────────
  { id: 'mediapipe-tasks-vision', group: 'tracking', name: 'MediaPipe Tasks — Vision', by: 'Google',
    repo: 'https://github.com/google-ai-edge/mediapipe', site: 'https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter',
    license: 'Apache-2.0', served: 'browser',
    what: 'Face landmarks, hand/pose tracking, selfie segmentation, gesture recognition — runs live in-browser via WASM/WebGL. This is what our Webcam Studio uses for background replace.' },
  { id: 'tfjs-models', group: 'tracking', name: 'TensorFlow.js Models', by: 'Google',
    repo: 'https://github.com/tensorflow/tfjs-models', site: 'https://www.tensorflow.org/js/models',
    license: 'Apache-2.0', served: 'browser',
    what: 'BlazeFace, FaceMesh (468 points), BodyPix / body-segmentation, hand-pose, MoveNet pose — pretrained, load-and-run in the browser.' },
  { id: 'jeeliz-facefilter', group: 'tracking', name: 'JEELIZ FaceFilter', by: 'Jeeliz',
    repo: 'https://github.com/jeeliz/jeelizFaceFilter', site: 'https://jeeliz.com/',
    license: 'Apache-2.0', served: 'browser',
    what: 'Lightweight deep-learning face tracking for Snapchat-style filters; ships three.js/BabylonJS glue and many ready demos (glasses, masks, makeup).' },
  { id: 'face-api', group: 'tracking', name: 'face-api.js', by: 'justadudewhohacks',
    repo: 'https://github.com/justadudewhohacks/face-api.js', site: 'https://justadudewhohacks.github.io/face-api.js/docs/index.html',
    license: 'MIT', served: 'browser',
    what: 'Face detection, landmarks, expressions and recognition in the browser on tfjs — good for filters that react to expression.' },
  { id: 'kalidokit', group: 'tracking', name: 'Kalidokit', by: 'yeemachine',
    repo: 'https://github.com/yeemachine/kalidokit', site: 'https://kalidoface.com/',
    license: 'MIT', served: 'browser',
    what: 'Turns MediaPipe/tfjs face+pose+hand data into VRM avatar blendshapes and bone rotations — the math behind VTuber-style live avatars.' },

  // ── background / segmentation ────────────────────────────────────────────────────────────────────
  { id: 'imgly-bg-removal', group: 'segmentation', name: '@imgly/background-removal', by: 'IMG.LY',
    repo: 'https://github.com/imgly/background-removal-js', site: 'https://img.ly/showcases/cesdk/web/background-removal',
    license: 'AGPL-3.0 / commercial', served: 'browser',
    what: 'High-quality background removal fully in the browser (ONNX-WASM) — keeps the subject exact. This powers our Photo Editor cutout.' },
  { id: 'rembg', group: 'segmentation', name: 'rembg', by: 'danielgatis',
    repo: 'https://github.com/danielgatis/rembg', site: 'https://github.com/danielgatis/rembg',
    license: 'MIT', served: 'gpu',
    what: 'Server/desktop background removal (U^2-Net family) — the heavier, batch-friendly option to run yourself on your own machine/GPU.' },

  // ── marker / image / world tracking AR (WebAR) ───────────────────────────────────────────────────
  { id: 'ar-js', group: 'webar', name: 'AR.js', by: 'AR-js-org',
    repo: 'https://github.com/AR-js-org/AR.js', site: 'https://ar-js-org.github.io/AR.js-Docs/',
    license: 'MIT', served: 'browser',
    what: 'Marker-based and location-based WebAR that runs on plain phones — no app. Great for print-marker experiences (tie into business cards / shirts).' },
  { id: 'mind-ar', group: 'webar', name: 'MindAR', by: 'hiukim',
    repo: 'https://github.com/hiukim/mind-ar-js', site: 'https://hiukim.github.io/mind-ar-js-doc/',
    license: 'MIT', served: 'browser',
    what: 'Image-tracking and face-tracking WebAR with three.js/A-Frame — put 3D content on a tracked image or face, in the browser.' },
  { id: 'aframe', group: 'webar', name: 'A-Frame', by: 'Supermedium',
    repo: 'https://github.com/aframevr/aframe', site: 'https://aframe.io/',
    license: 'MIT', served: 'browser',
    what: 'HTML-tag VR/AR framework on three.js + WebXR — the fast way to build a scene, pairs with AR.js/MindAR. Powers the Dudael VR side.' },
  { id: 'webxr', group: 'webar', name: 'WebXR Device API', by: 'W3C / Immersive Web',
    repo: 'https://github.com/immersive-web/webxr', site: 'https://immersiveweb.dev/',
    license: 'W3C standard', served: 'browser',
    what: 'The native browser standard for AR/VR sessions and hit-testing on supported devices — the real floor for phone/headset AR.' },

  // ── 3D / rendering engines (the layer AR content is drawn with) ───────────────────────────────────
  { id: 'threejs', group: 'render', name: 'three.js', by: 'mrdoob',
    repo: 'https://github.com/mrdoob/three.js', site: 'https://threejs.org/',
    license: 'MIT', served: 'browser',
    what: 'The workhorse WebGL 3D engine — render glasses/masks/objects onto tracked faces and scenes; exports/loads glTF for the shirt→3D→game pipeline.' },
  { id: 'babylonjs', group: 'render', name: 'Babylon.js', by: 'Microsoft',
    repo: 'https://github.com/BabylonJS/Babylon.js', site: 'https://www.babylonjs.com/',
    license: 'Apache-2.0', served: 'browser',
    what: 'Full-featured 3D/game engine with first-class WebXR — an alternative to three.js when you want physics, GUI and tooling built in.' },
  { id: 'pixijs', group: 'render', name: 'PixiJS', by: 'pixijs',
    repo: 'https://github.com/pixijs/pixijs', site: 'https://pixijs.com/',
    license: 'MIT', served: 'browser',
    what: 'Fast 2D WebGL renderer — for 2D overlays, stickers, and shader effects on webcam/photos without the 3D overhead.' },

  // ── generative face/style edit (heavier — run it yourself / on GPU) ───────────────────────────────
  { id: 'insightface', group: 'generative', name: 'InsightFace', by: 'deepinsight',
    repo: 'https://github.com/deepinsight/insightface', site: 'https://insightface.ai/',
    license: 'MIT (models: research)', served: 'gpu',
    what: 'Face analysis + the swap/restore models behind identity-preserving edits. The real path to "make the character look like the uploaded person" — needs a GPU.' },
  { id: 'comfyui', group: 'generative', name: 'ComfyUI', by: 'comfyanonymous',
    repo: 'https://github.com/comfyanonymous/ComfyUI', site: 'https://www.comfy.org/',
    license: 'GPL-3.0', served: 'gpu',
    what: 'Node-graph runner for Stable Diffusion — inpainting (change hair/eyes), ControlNet, IP-Adapter/InstantID for likeness, and img2img. Our GenAI School teaches these graphs.' },
  { id: 'ip-adapter', group: 'generative', name: 'IP-Adapter', by: 'tencent-ailab',
    repo: 'https://github.com/tencent-ailab/IP-Adapter', site: 'https://ip-adapter.github.io/',
    license: 'Apache-2.0', served: 'gpu',
    what: 'Image-prompt adapter for diffusion models — the standard way to condition on a reference face/style so a generated character resembles your upload.' },
];

const GROUPS = [
  { id: 'tracking', title: 'Face / body / hand tracking', blurb: 'Live landmark and pose tracking — the eyes of any AR filter. All run in the browser.' },
  { id: 'segmentation', title: 'Background & segmentation', blurb: 'Cut the person out (or the background off) — keep the subject exact.' },
  { id: 'webar', title: 'WebAR — marker, image & world tracking', blurb: 'AR in a plain browser, no app: markers, image targets, WebXR sessions.' },
  { id: 'render', title: '3D / 2D rendering engines', blurb: 'The layer AR content is drawn with — and the bridge to the shirt → 3D → game pipeline.' },
  { id: 'generative', title: 'Generative face/style edit (GPU)', blurb: 'Identity-preserving likeness, inpainting, style transfer. Heavier — run it yourself or on PRANA GPU.' },
];

export function listArGroups() {
  return GROUPS.map((g) => ({ ...g, items: AR_LIBRARIES.filter((l) => l.group === g.id) })).filter((g) => g.items.length);
}
