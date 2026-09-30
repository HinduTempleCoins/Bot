#!/bin/bash
# render one archaeoastronomy scene and publish it to the animations page (3d-sky-<site>)
set -e; SITE=$1; SECS=${2:-8}; cd /opt/melek-gen/scene3d
/opt/blender/blender -b -P sky_scene.py -- $SITE sky/$SITE.mp4 $SECS 8 > sky/$SITE.log 2>&1
D=/opt/melek-gen/anims/3d-sky-$SITE; mkdir -p $D; cp sky/$SITE.mp4 $D/clip.mp4
ffmpeg -v error -y -ss $(python3 -c "print($SECS*0.7)") -i sky/$SITE.mp4 -frames:v 1 $D/poster.jpg
AZ=$(grep -oE "sunrise azimuth [0-9.]+" sky/$SITE.log | awk "{print \$3}")
python3 - "$SITE" "$AZ" "$SECS" <<PY
import json,sys,time
site,az,secs=sys.argv[1],sys.argv[2],float(sys.argv[3])
json.dump({"id":f"3d-sky-{site}","kind":"3d-scene","motion":"dolly","camera":"dolly","pace":"slow","narrate":"no","scene":site,
 "title":f"{site.title()} — the midsummer sunrise, c. 2500 BC (sun at azimuth {az}°, computed for that epoch)","group":"Sky alignments",
 "look":"3d","people":"","seconds":secs,"made":int(time.time()),
 "note":"Monument built procedurally; sun placed by the obliquity of the ecliptic for the epoch (Laskar 1986). Status: established alignment. Alpha."},
 open(f"/opt/melek-gen/anims/3d-sky-{site}/recipe.json","w"),indent=1)
PY
echo PUBLISHED $D
