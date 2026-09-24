#!/usr/bin/env python3
# identity.py — face mapping + verify for the studio, free/CPU (insightface ArcFace, onnxruntime CPU).
# Used for USER uploads (map their real face → generate new images of the same person, verify matches).
# Hathor is identified by her whole signature (a character model), not eyes — do NOT use this on her.
#   python3 identity.py embed <image>            -> {"ok":true,"embedding":[...512]}
#   python3 identity.py verify <imgA> <imgB>     -> {"ok":true,"score":0.xx,"same":bool}
#   python3 identity.py mapdir <dir>             -> canonical vector + cohesion
import sys, os, json, glob, warnings
warnings.filterwarnings("ignore")
import numpy as np, cv2
from insightface.app import FaceAnalysis
_app=None
def app():
    global _app
    if _app is None:
        _app=FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        _app.prepare(ctx_id=-1, det_size=(640,640))
    return _app
def emb(path):
    img=cv2.imread(path)
    if img is None: return None
    fs=app().get(img)
    if not fs: return None
    fs.sort(key=lambda x:(x.bbox[2]-x.bbox[0])*(x.bbox[3]-x.bbox[1]), reverse=True)
    return fs[0].normed_embedding
def main():
    a=sys.argv[1:]
    if not a: print(json.dumps({"ok":False,"error":"cmd"})); return
    if a[0]=="embed":
        e=emb(a[1]); print(json.dumps({"ok":e is not None, "embedding": e.tolist() if e is not None else None}))
    elif a[0]=="verify":
        e1,e2=emb(a[1]),emb(a[2])
        if e1 is None or e2 is None: print(json.dumps({"ok":False,"error":"no face"})); return
        s=float(np.dot(e1,e2)); print(json.dumps({"ok":True,"score":round(s,4),"same":s>=0.35}))
    elif a[0]=="mapdir":
        embs=[]; 
        for f in sorted(glob.glob(a[1]+"/*.png")+glob.glob(a[1]+"/*.jpg")+glob.glob(a[1]+"/*.webp")+glob.glob(a[1]+"/*.jpeg")):
            e=emb(f); 
            if e is not None: embs.append(e)
        if not embs: print(json.dumps({"ok":False,"error":"no faces"})); return
        arr=np.stack(embs); c=arr.mean(0); c=c/np.linalg.norm(c)
        iu=np.triu_indices(len(embs),1); coh=float((arr@arr.T)[iu].mean()) if len(embs)>1 else 1.0
        print(json.dumps({"ok":True,"detected":len(embs),"dim":int(c.shape[0]),"cohesion":round(coh,3),"canonical":c.tolist()}))
    else: print(json.dumps({"ok":False,"error":"unknown cmd"}))
main()
