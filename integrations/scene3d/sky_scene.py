"""sky_scene.py — archaeoastronomy scenes: a monument, built procedurally, lit by the sun where it really stood for
that site and that epoch (Blender Cycles on CPU, Nishita physical sky). People watch the event it is aligned to.

Sun direction: the solstice sun's declination = the obliquity of the ecliptic FOR THAT EPOCH (Laskar 1986 series,
~23.93° at 2500 BC vs 23.44° today); azimuth at the moment of first gleam from
  cos A = (sin δ − sin φ sin h) / (cos φ cos h),  h = apparent altitude of the sun's upper limb at sunrise.
First scene: STONEHENGE, summer-solstice sunrise, c. 2500 BC (the axis runs through the Heel Stone to the NE).

  blender -b -P sky_scene.py -- <site> <out.mp4> [seconds] [threads]
"""
import math, os, subprocess, sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SITE, OUT = argv[0], argv[1]
SECS = float(argv[2]) if len(argv) > 2 else 8.0
THREADS = int(argv[3]) if len(argv) > 3 else 8
FPS, W, H = 24, 960, 540


def obliquity(year):
    """mean obliquity (deg) for a calendar year (astronomical numbering), Laskar 1986, valid ±10,000 yr"""
    t = (year - 2000) / 10000.0
    c = [84381.448, -4680.93, -1.55, 1999.25, -51.38, -249.67, -39.05, 7.12, 27.87, 5.79, 2.45]
    return sum(k * t ** i for i, k in enumerate(c)) / 3600.0


def sunrise_azimuth(lat, dec, h=0.5):
    p, d, a = map(math.radians, (lat, dec, h))
    return math.degrees(math.acos((math.sin(d) - math.sin(p) * math.sin(a)) / (math.cos(p) * math.cos(a))))


SITES = {
    "stonehenge": {"lat": 51.1789, "year": -2499, "event": "summer solstice sunrise", "sign": +1, "status": "established",
                   "note": "The Heel Stone axis points to the midsummer sunrise (and the opposite way to the midwinter sunset)."},
    "kalasasaya-posnansky": {"lat": -16.5546, "year": -14999, "event": "June solstice sunset", "sign": +1, "status": "debated",
                  "eps": 23.1467, "set": True, "label": "under Posnansky's measured angle (23° 8′ 48″; his date: 15,000 BC)",
                  "note": "Arthur Posnansky read the Kalasasaya's corner pillars as solstice sightlines and, from the angle they imply (23° 8′ 48″), dated the temple to 15,000 BC. Radiocarbon dates the Kalasasaya to roughly 200 BCE–600 CE. The two sunsets differ by only about half a degree — less than the placing error of the pillars — so the alignment cannot carry the 15,000 BC date. Kept alive in Atlantis literature."},
    "kalasasaya-600ad": {"lat": -16.5546, "year": 600, "event": "June solstice sunset", "sign": +1, "status": "established (date); alignment debated",
                  "set": True, "label": "at its archaeological date (c. AD 600)",
                  "note": "The same sunset computed for c. AD 600, within the radiocarbon range for the Kalasasaya (c. 200 BCE–600 CE), for comparison with Posnansky's reading."},
    "newgrange": {"lat": 53.6947, "year": -3199, "event": "winter solstice sunrise", "sign": -1, "status": "established",
                  "horizon": 0.9, "note": "At midwinter sunrise a beam enters the roof-box and runs 19 m up the passage to the chamber floor."},
}
S = SITES[SITE]
EPS = S.get("eps") or obliquity(S["year"])
AZ = sunrise_azimuth(S["lat"], S["sign"] * EPS, S.get("horizon", 0.5))          # degrees east of north
if S.get("set"):
    AZ = 360.0 - AZ                                                                  # sunset mirrors sunrise across the meridian
print(f"{SITE}: obliquity {EPS:.2f}°, sunrise azimuth {AZ:.2f}°", flush=True)
import json as _json
_when = S.get("label") or (f"c. {-S['year'] + 1} BC" if S["year"] <= 0 else f"c. AD {S['year']}")
print("META " + _json.dumps({"title": f"{SITE.split('-')[0].title()} — the {S['event']}, {_when} (sun at azimuth {AZ:.1f}°, obliquity {EPS:.2f}°)",
                              "status": S["status"], "note": S["note"]}), flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 24; sc.cycles.use_denoising = True
sc.render.threads_mode = "FIXED"; sc.render.threads = THREADS
sc.render.resolution_x, sc.render.resolution_y, sc.render.fps = W, H, FPS
sc.frame_start, sc.frame_end = 1, int(SECS * FPS)
sc.view_settings.view_transform = "AgX"

# Blender world: +Y = north, +X = east. A direction at azimuth A (from north, toward east) and altitude h:
def dirvec(az, alt):
    a, h = math.radians(az), math.radians(alt)
    return Vector((math.sin(a) * math.cos(h), math.cos(a) * math.cos(h), math.sin(h)))

# physical sky with the sun just rising at AZ
world = bpy.data.worlds.new("sky"); sc.world = world; world.use_nodes = True
nt = world.node_tree; nt.nodes.clear()
sky = nt.nodes.new("ShaderNodeTexSky"); sky.sky_type = "NISHITA"
sky.sun_elevation = math.radians(0.6); sky.sun_rotation = math.radians(90 - AZ + 180)   # Nishita rotation is measured from +X
sky.sun_intensity = 1.0; sky.altitude = 100; sky.air_density = 1.2; sky.dust_density = 2.5
bg = nt.nodes.new("ShaderNodeBackground"); bg.inputs["Strength"].default_value = 0.35
out = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(sky.outputs["Color"], bg.inputs["Color"]); nt.links.new(bg.outputs[0], out.inputs["Surface"])
sun_d = bpy.data.lights.new("sun", "SUN"); sun_d.energy = 2.5; sun_d.angle = math.radians(0.53); sun_d.color = (1.0, 0.72, 0.45)
sun = bpy.data.objects.new("sun", sun_d); sc.collection.objects.link(sun)
sun.rotation_mode = "QUATERNION"; sun.rotation_quaternion = (-dirvec(AZ, 0.6)).to_track_quat("-Z", "Z")

# materials
def mat(name, rgb, rough=0.9):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]; b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough
    return m
STONE, GRASS, CLOTH = mat("stone", (0.38, 0.36, 0.32)), mat("grass", (0.10, 0.16, 0.06)), mat("cloth", (0.22, 0.15, 0.10))

bpy.ops.mesh.primitive_plane_add(size=6000); g = bpy.context.active_object; g.data.materials.append(GRASS)

def block(x, y, z, sx, sy, sz, rot=0.0, m=STONE):
    bpy.ops.mesh.primitive_cube_add(location=(x, y, z)); o = bpy.context.active_object
    o.scale = (sx / 2, sy / 2, sz / 2); o.rotation_euler.z = rot; o.data.materials.append(m)
    bev = o.modifiers.new("b", "BEVEL"); bev.width = 0.12; bev.segments = 2
    return o

AX = math.radians(AZ)
U = Vector((math.sin(AX), math.cos(AX), 0))          # horizontal unit vector toward the event on the horizon
cam_d = bpy.data.cameras.new("cam"); cam_d.lens = 35
cam = bpy.data.objects.new("cam", cam_d); sc.collection.objects.link(cam); sc.camera = cam
cam.rotation_mode = "QUATERNION"
n = sc.frame_end


def watchers(center, count=4, spacing=1.8):
    side = Vector((U.y, -U.x, 0))
    for i in range(count):
        p = center + side * ((i - (count - 1) / 2) * spacing)
        bpy.ops.mesh.primitive_cone_add(radius1=0.35, radius2=0.18, depth=1.5, location=(p.x, p.y, p.z + 0.75)); bpy.context.active_object.data.materials.append(CLOTH)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.14, location=(p.x, p.y, p.z + 1.62)); bpy.context.active_object.data.materials.append(CLOTH)


def stonehenge():
    # after Cleal et al. 1995; Parker Pearson 2012: 30 sarsen uprights (r ≈ 16.5 m, ~4.1 m) with a lintel ring,
    # a horseshoe of 5 trilithons opening to the NE axis, and the Heel Stone out on the axis
    for i in range(30):
        a = AX + (i + 0.5) * 2 * math.pi / 30
        block(16.5 * math.sin(a), 16.5 * math.cos(a), 2.05, 2.1, 1.1, 4.1, rot=-a)
        a2 = AX + (i + 1) * 2 * math.pi / 30 - math.pi / 30
        block(16.5 * math.sin(a2), 16.5 * math.cos(a2), 4.45, 3.5, 1.0, 0.8, rot=-a2)
    for ang, r, hgt in [(-100, 8.0, 6.0), (-60, 9.0, 6.5), (180, 9.5, 7.3), (60, 9.0, 6.5), (100, 8.0, 6.0)]:
        a = AX + math.radians(ang); cx, cy = r * math.sin(a), r * math.cos(a); px, py = math.cos(a) * 1.2, -math.sin(a) * 1.2
        block(cx + px, cy + py, hgt / 2, 1.3, 1.3, hgt, rot=-a); block(cx - px, cy - py, hgt / 2, 1.3, 1.3, hgt, rot=-a)
        block(cx, cy, hgt + 0.45, 3.6, 1.2, 0.9, rot=-a)
    heel = block(77 * U.x, 77 * U.y, 2.4, 2.4, 2.0, 4.8, rot=-AX + 0.3); heel.rotation_euler.x = math.radians(-8)
    watchers(-6 * U)
    tgt = Vector((77 * U.x, 77 * U.y, 3.0))
    for f in range(1, n + 1):
        t = (f - 1) / max(1, n - 1); e = 0.5 - 0.5 * math.cos(math.pi * t)
        p = -(5 - 4 * e) * U + Vector((0, 0, 1.7 + 0.8 * e))
        cam.location = p; cam.keyframe_insert("location", frame=f)
        cam.rotation_quaternion = (tgt - p).to_track_quat("-Z", "Y"); cam.keyframe_insert("rotation_quaternion", frame=f)
        sky.sun_elevation = math.radians(0.3 + 1.2 * e); sky.keyframe_insert("sun_elevation", frame=f)
        sun.rotation_quaternion = (-dirvec(AZ, 0.3 + 1.2 * e)).to_track_quat("-Z", "Z"); sun.keyframe_insert("rotation_quaternion", frame=f)


def newgrange():
    # after O'Kelly 1982: a mound ~85 m across and ~12 m high, white quartz facade, a 19 m passage rising ~2 m to a
    # cruciform chamber, and the ROOF-BOX over the entrance through which the midwinter sunrise beam reaches the chamber
    bpy.ops.mesh.primitive_uv_sphere_add(radius=42, segments=96, ring_count=48, location=(0, 0, -2)); mound = bpy.context.active_object
    mound.scale = (1, 1, 0.33); mound.data.materials.append(mat("turf", (0.12, 0.17, 0.07)))
    ent = 40.5 * U
    cutters = []
    def cutter(center, length, width, height, pitch=0.0):
        bpy.ops.mesh.primitive_cube_add(location=center); c = bpy.context.active_object
        c.scale = (width / 2, length / 2, height / 2); c.rotation_euler = (pitch, 0, -AX); c.hide_render = True; c.display_type = "WIRE"
        cutters.append(c); return c
    # passage: 5 stepped segments, floor rising 0.4 m each (≈2 m over 19 m), 1.0 m wide, 1.8 m high
    for i in range(5):
        c = ent - (2.0 + i * 3.9) * U
        cutter(c + Vector((0, 0, 0.9 + i * 0.4 + 0.9)), 4.4, 1.0, 1.8)
    cutter(ent - 22.0 * U + Vector((0, 0, 2.0 + 2.75)), 5.5, 5.5, 5.5)      # chamber, floor at +2.0 m
    cutter(ent - 1.5 * U + Vector((0, 0, 3.05)), 4.0, 1.0, 0.5)              # roof-box slot above the entrance
    for c in cutters:
        m = mound.modifiers.new("cut", "BOOLEAN"); m.operation = "DIFFERENCE"; m.object = c
    quartz = mat("quartz", (0.85, 0.85, 0.82), 0.6)
    side = Vector((U.y, -U.x, 0))
    for k in range(-14, 15):
        if abs(k) <= 1:
            continue
        a = AX + k * math.radians(2.8)
        block(41.5 * math.sin(a), 41.5 * math.cos(a), 1.6, 3.2, 0.6, 3.2, rot=-a, m=quartz)
    block((ent + 3.2 * U).x, (ent + 3.2 * U).y, 0.6, 3.0, 0.9, 1.2, rot=-AX)          # the entrance kerbstone
    CH = ent - 22.0 * U
    side = Vector((U.y, -U.x, 0))
    watchers(CH - 1.0 * U + 1.9 * side + Vector((0, 0, 2.0)), count=2, spacing=0.9)
    sun_d.energy = 6.0
    sc.view_settings.exposure = 1.2
    for f in range(1, n + 1):
        t = (f - 1) / max(1, n - 1); e = 0.5 - 0.5 * math.cos(math.pi * t)
        p = CH - (2.2 - 0.8 * e) * U + 0.5 * side + Vector((0, 0, 3.6))
        tgt = ent + Vector((0, 0, 1.6))
        cam.location = p; cam.keyframe_insert("location", frame=f)
        cam.rotation_quaternion = (tgt - p).to_track_quat("-Z", "Y"); cam.keyframe_insert("rotation_quaternion", frame=f)
        sky.sun_elevation = math.radians(0.6 + 1.0 * e); sky.keyframe_insert("sun_elevation", frame=f)
        sun.rotation_quaternion = (-dirvec(AZ, 0.6 + 1.0 * e)).to_track_quat("-Z", "Z"); sun.keyframe_insert("rotation_quaternion", frame=f)


def kalasasaya():
    # after Posnansky 1945 and later surveys: a raised rectangular enclosure ~128 m E-W x ~118 m N-S, walls of tall
    # sandstone pillars with ashlar infill, the west "balcony" wall, and the Gateway of the Sun near the NW corner
    tan = mat("andesite", (0.36, 0.30, 0.26))
    hx, hy = 64, 59
    for x in range(-hx, hx + 1, 6):
        for y in (-hy, hy):
            block(x, y, 1.9, 1.0, 0.8, 3.8, m=tan); block(x + 3, y, 0.8, 5.0, 0.7, 1.6, m=tan)
    for y in range(-hy, hy + 1, 6):
        for x in (-hx, hx):
            if x == hx and abs(y) < 6:
                continue                                          # the eastern stairway opening
            block(x, y, 1.9, 0.8, 1.0, 3.8, m=tan); block(x, y + 3, 0.8, 0.7, 5.0, 1.6, m=tan)
    g1 = block(-hx + 8, hy - 8, 1.5, 3.8, 0.6, 3.0, m=tan)      # the Gateway of the Sun (simplified)
    bpy.ops.mesh.primitive_cube_add(location=(-hx + 8, hy - 8, 1.0)); cut = bpy.context.active_object; cut.scale = (0.7, 0.5, 1.0); cut.hide_render = True
    m = g1.modifiers.new("door", "BOOLEAN"); m.operation = "DIFFERENCE"; m.object = cut
    watchers(Vector((hx - 46, 4, 0)), count=4, spacing=2.4)
    D = dirvec(AZ, 0); tgt = Vector((D.x * 200, D.y * 200, 2.0))
    for f in range(1, n + 1):
        t = (f - 1) / max(1, n - 1); e = 0.5 - 0.5 * math.cos(math.pi * t)
        p = Vector((hx - 14 - 10 * e, -6 + 6 * e, 1.8 + 0.6 * e))
        cam.location = p; cam.keyframe_insert("location", frame=f)
        cam.rotation_quaternion = (tgt - p).to_track_quat("-Z", "Y"); cam.keyframe_insert("rotation_quaternion", frame=f)
        el = 1.6 - 1.4 * e                                        # setting: the sun goes DOWN
        sky.sun_elevation = math.radians(el); sky.keyframe_insert("sun_elevation", frame=f)
        sun.rotation_quaternion = (-dirvec(AZ, el)).to_track_quat("-Z", "Z"); sun.keyframe_insert("rotation_quaternion", frame=f)


{"stonehenge": stonehenge, "newgrange": newgrange, "kalasasaya-posnansky": kalasasaya, "kalasasaya-600ad": kalasasaya}[SITE]()

frames = os.path.join(os.path.dirname(OUT) or ".", "frames_" + os.path.basename(OUT).replace(".mp4", ""))
os.makedirs(frames, exist_ok=True)
sc.render.filepath = os.path.join(frames, "f_"); sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = 92
bpy.ops.render.render(animation=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(frames, "f_%04d.jpg"),
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], check=True)
subprocess.run(["rm", "-rf", frames])
print("SKY_OK", OUT, f"az={AZ:.2f}", flush=True)
