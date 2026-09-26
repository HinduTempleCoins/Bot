"""genai_annotate.py — make every image READABLE for generation: skeletons, hands, faces and named anchors.

For each image it writes two sidecars next to it:
  <img>.annot.json  — standard OpenPose/COCO-18 body keypoints, 21 keypoints per hand, 70 face keypoints (pixels and
                      0..1 normalised), plus NAMED ANCHORS from a 478-point face mesh (chin, forehead, brow centre, nose
                      bridge, nose tip, left/right cheek, mouth) and hand anchors (wrist, palm centre) — so objects like
                      tattoos, jewellery or a headcone can be placed where they belong, and so training data (LoRAs)
                      carries its anatomy.
  <img>.pose.png    — the OpenPose skeleton map (body + hands + face), which ControlNet / ComfyUI / any GPU pipeline reads.
Generating FROM the skeleton keeps one hand per wrist and the right number of fingers; editing the keypoints moves limbs.

  python genai_annotate.py <image_or_dir>...        (CPU; OpenPose from lllyasviel/Annotators, MediaPipe Face Landmarker)
"""
import json, os, sys, time, types
_HOME = os.environ.get("MELEK_GEN_HOME", os.path.dirname(os.path.abspath(__file__)))

IMG_EXT = (".png", ".jpg", ".jpeg", ".webp")
FACE_MODEL = os.environ.get("FACE_LANDMARKER", os.path.join(_HOME, "models/face_landmarker.task"))
BODY18 = ["nose", "neck", "r_shoulder", "r_elbow", "r_wrist", "l_shoulder", "l_elbow", "l_wrist", "r_hip", "r_knee",
          "r_ankle", "l_hip", "l_knee", "l_ankle", "r_eye", "l_eye", "r_ear", "l_ear"]
# MediaPipe face-mesh indices for named anchors (canonical 468/478-point topology)
FACE_ANCHORS = {"chin": 152, "forehead": 10, "brow_centre": 9, "nose_bridge": 168, "nose_tip": 1,
                "cheek_left": 425, "cheek_right": 205, "mouth_centre": 13, "chin_left": 377, "chin_right": 148}

_det = None
_face = None


def _openpose():
    global _det
    if _det is None:
        # controlnet_aux's package __init__ imports an old MediaPipe API; we only need OpenPose, so stub that module.
        sys.modules.setdefault("controlnet_aux.mediapipe_face", types.ModuleType("controlnet_aux.mediapipe_face"))
        sys.modules["controlnet_aux.mediapipe_face"].MediapipeFaceDetector = None
        from controlnet_aux.open_pose import OpenposeDetector
        _det = OpenposeDetector.from_pretrained("lllyasviel/Annotators")
    return _det


def _face_landmarker():
    global _face
    if _face is None and os.path.exists(FACE_MODEL):
        from mediapipe.tasks.python import vision, BaseOptions
        _face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=FACE_MODEL), num_faces=12))
    return _face


def _kps(kp_list, W, H):
    out = []
    for k in kp_list or []:
        if k is None:
            out.append(None)
        else:
            x, y = float(k.x), float(k.y)
            # controlnet_aux returns normalised coords; keep both
            out.append({"x": round(x * W, 1), "y": round(y * H, 1), "nx": round(x, 4), "ny": round(y, 4)})
    return out


def annotate_image(path, write=True):
    import numpy as np
    from PIL import Image
    img = Image.open(path).convert("RGB")
    W, H = img.size
    arr = np.array(img)
    det = _openpose()
    poses = det.detect_poses(arr, include_hand=True, include_face=True)
    people = []
    for p in poses:
        body = _kps(p.body.keypoints, W, H)
        person = {"body": {BODY18[i]: body[i] for i in range(min(18, len(body)))},
                  "left_hand": _kps(p.left_hand, W, H) if p.left_hand is not None else None,
                  "right_hand": _kps(p.right_hand, W, H) if p.right_hand is not None else None,
                  "face": _kps(p.face, W, H) if p.face is not None else None}
        anchors = {}
        for side, hand in (("left", person["left_hand"]), ("right", person["right_hand"])):
            pts = [q for q in (hand or []) if q]
            if pts:
                anchors[f"{side}_wrist"] = pts[0]
                anchors[f"{side}_palm"] = {"x": round(sum(q["x"] for q in pts[:6]) / len(pts[:6]), 1),
                                           "y": round(sum(q["y"] for q in pts[:6]) / len(pts[:6]), 1)}
        person["hand_anchors"] = anchors
        people.append(person)
    faces = []
    fl = _face_landmarker()
    if fl is not None:
        import mediapipe as mp

        def mesh(sub, ox, oy, sw, sh):
            res = fl.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(sub)))
            out = []
            for lm in res.face_landmarks or []:
                P = lambda i: (ox + lm[i].x * sw, oy + lm[i].y * sh)
                named = {k: {"x": round(P(i)[0], 1), "y": round(P(i)[1], 1), "nx": round(P(i)[0] / W, 4), "ny": round(P(i)[1] / H, 4)}
                         for k, i in FACE_ANCHORS.items() if i < len(lm)}
                xs = [ox + q.x * sw for q in lm]; ys = [oy + q.y * sh for q in lm]
                out.append({"anchors": named, "box": [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)], "mesh_points": len(lm)})
            return out

        # group shots: faces are small, so mesh each person's face region (from the OpenPose face points), upscaled
        for person in people:
            pts = [q for q in (person["face"] or []) if q]
            if len(pts) < 10:
                continue
            x0, x1 = min(q["x"] for q in pts), max(q["x"] for q in pts)
            y0, y1 = min(q["y"] for q in pts), max(q["y"] for q in pts)
            m = 0.6 * max(x1 - x0, y1 - y0)
            bx0, by0 = int(max(0, x0 - m)), int(max(0, y0 - m * 1.4))
            bx1, by1 = int(min(W, x1 + m)), int(min(H, y1 + m))
            crop = Image.fromarray(arr[by0:by1, bx0:bx1])
            k = 512 / max(crop.size)
            big = np.array(crop.resize((max(1, int(crop.width * k)), max(1, int(crop.height * k)))))
            found = mesh(big, bx0, by0, bx1 - bx0, by1 - by0)
            if found:
                person["face_anchors"] = found[0]["anchors"]
                faces.append(found[0])
        if not faces:  # single large faces (portraits) — whole-image pass
            faces = mesh(arr, 0, 0, W, H)
    ann = {"image": os.path.basename(path), "width": W, "height": H, "format": "openpose-coco18+hands21+face70; mediapipe-facemesh anchors",
           "people": people, "faces": faces, "annotated": int(time.time())}
    if write:
        base = os.path.splitext(path)[0]
        json.dump(ann, open(base + ".annot.json", "w"))
        det(img, include_hand=True, include_face=True).resize((W, H)).save(base + ".pose.png")
    return ann


def expand(paths):
    for p in paths:
        if os.path.isdir(p):
            for root, _d, files in os.walk(p):
                for f in sorted(files):
                    if f.lower().endswith(IMG_EXT) and not f.endswith(".pose.png"):
                        yield os.path.join(root, f)
        elif p.lower().endswith(IMG_EXT):
            yield p


if __name__ == "__main__":
    import torch
    torch.set_num_threads(int(os.environ.get("ANNOT_THREADS", "4")))
    for f in expand(sys.argv[1:]):
        if os.path.exists(os.path.splitext(f)[0] + ".annot.json"):
            continue
        t0 = time.time()
        try:
            a = annotate_image(f)
            print(f"{f}: {len(a['people'])} people, {len(a['faces'])} faces, {time.time()-t0:.0f}s", flush=True)
        except Exception as e:
            print(f"{f}: ERROR {type(e).__name__}: {e}", flush=True)
