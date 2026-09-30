#!/bin/bash
# render one archaeoastronomy scene and publish it to the animations page (3d-sky-<site>); title/status from sky_scene META
set -e; SITE=$1; SECS=${2:-8}; cd /opt/melek-gen/scene3d
/opt/blender/blender -b -P sky_scene.py -- $SITE sky/$SITE.mp4 $SECS 8 > sky/$SITE.log 2>&1
D=/opt/melek-gen/anims/3d-sky-$SITE; mkdir -p $D; cp sky/$SITE.mp4 $D/clip.mp4
ffmpeg -v error -y -ss $(python3 -c "print($SECS*0.7)") -i sky/$SITE.mp4 -frames:v 1 $D/poster.jpg
python3 - "$SITE" "$SECS" <<PY
import json,sys,time
site,secs=sys.argv[1],float(sys.argv[2])
meta=json.loads([l[5:] for l in open(f"sky/{site}.log") if l.startswith("META ")][-1])
json.dump({"id":f"3d-sky-{site}","kind":"3d-scene","motion":"dolly","camera":"dolly","pace":"slow","narrate":"no","scene":site,
 "title":meta["title"],"group":"Sky alignments","look":"3d","people":"","seconds":secs,"made":int(time.time()),
 "note":meta["note"]+" Monument built procedurally; sun placed by the obliquity of the ecliptic for the epoch (Laskar 1986). Alignment status: "+meta["status"]+". Alpha."},
 open(f"/opt/melek-gen/anims/3d-sky-{site}/recipe.json","w"),indent=1)
PY
echo PUBLISHED $D
