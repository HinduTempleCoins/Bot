"""annotate_poses.py — body keypoints for every remake picture that has none, so cutout_anim.py can rig ALL the people
(not only the few pictures that came with OpenPose annotations). MediaPipe PoseLandmarker (Apache-2.0), up to 6 people
per picture, on CPU. Writes <image>.annot.json in the same shape the cutout renderer reads; never overwrites one.
  face-venv/bin/python annotate_poses.py [root]
"""
import glob, json, os, sys, time
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/opt/melek-gen/remakes"
MODEL = "/opt/melek-gen/models/pose_landmarker_full.task"
NAMES = {0: "nose", 2: "l_eye", 5: "r_eye", 7: "l_ear", 8: "r_ear", 11: "l_shoulder", 12: "r_shoulder", 13: "l_elbow", 14: "r_elbow",
         15: "l_wrist", 16: "r_wrist", 23: "l_hip", 24: "r_hip", 25: "l_knee", 26: "r_knee", 27: "l_ankle", 28: "r_ankle"}
det = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
    base_options=mpt.BaseOptions(model_asset_path=MODEL), num_poses=6, min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5))
done = skipped = people = 0; t0 = time.time()
for f in sorted(glob.glob(f"{ROOT}/*/*.png")):
    base = os.path.basename(f)
    if any(x in base for x in ("sheet", "face", "src", "outline", "base", "alt")) or "/skull" in f or "/lineup" in f:
        continue
    out = f[:-4] + ".annot.json"
    if os.path.exists(out):
        skipped += 1; continue
    img = mp.Image.create_from_file(f); w, h = img.width, img.height
    res = det.detect(img)
    ppl = []
    for lms in res.pose_landmarks:
        body = {}
        for i, name in NAMES.items():
            lm = lms[i]
            if (lm.visibility or 0) >= 0.5 and 0 <= lm.x <= 1 and 0 <= lm.y <= 1:
                body[name] = {"x": round(lm.x * w, 1), "y": round(lm.y * h, 1)}
        if "l_shoulder" in body and "r_shoulder" in body:
            body["neck"] = {"x": round((body["l_shoulder"]["x"] + body["r_shoulder"]["x"]) / 2, 1),
                            "y": round((body["l_shoulder"]["y"] + body["r_shoulder"]["y"]) / 2, 1)}
        if "neck" in body:
            ppl.append({"body": body})
    json.dump({"source": "mediapipe-pose-landmarker", "width": w, "height": h, "people": ppl}, open(out, "w"))
    done += 1; people += len(ppl)
    if done % 100 == 0:
        print(f"{done} annotated ({people} people) in {time.time() - t0:.0f}s", flush=True)
print(f"DONE {done} annotated, {skipped} already had keypoints, {people} people found, {time.time() - t0:.0f}s", flush=True)
