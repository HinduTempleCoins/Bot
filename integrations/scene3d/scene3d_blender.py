"""scene3d_blender.py — build a real 3D scene from prep3d.py's layers and fly a camera through it (Blender, CPU).

Two meshes: the BACKGROUND (hole-filled picture on a grid pushed back by its depth) and the FOREGROUND (the near
figures on their own grid, cut out by the mask). A real camera then dollies / orbits / cranes, so near things move
against far things and the foreground uncovers the background behind it — parallax and occlusion from geometry,
not a pan-and-zoom. Emission-only materials: the picture's own colours, no lighting pass needed. Cycles on CPU.

  blender -b -P scene3d_blender.py -- <prepdir> <out.mp4> [seconds] [move] [threads]
"""
import math, os, subprocess, sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
PREP, OUT = argv[0], argv[1]
SECS = float(argv[2]) if len(argv) > 2 else 6.0
MOVE = argv[3] if len(argv) > 3 else "orbit"
THREADS = int(argv[4]) if len(argv) > 4 else 6
FPS, W = 24, 960
DEPTH = 1.6          # how far the scene recedes (world units; the picture is 4 units wide)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
img_src = bpy.data.images.load(os.path.join(PREP, "src.png"))
iw, ih = img_src.size
aspect = ih / iw
H = int(round(W * aspect / 2) * 2)
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 6
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 0
sc.render.threads_mode = "FIXED"; sc.render.threads = THREADS
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.render.fps = FPS
sc.frame_start, sc.frame_end = 1, int(SECS * FPS)
sc.view_settings.view_transform = "Standard"
sc.render.film_transparent = False
world = bpy.data.worlds.new("w"); world.color = (0, 0, 0); sc.world = world


def layer(name, color_file, depth_file, mask_file=None, z_off=0.0, res=220):
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=res, y_subdivisions=max(2, int(res * aspect)), size=4.0)
    ob = bpy.context.active_object; ob.name = name
    ob.scale = (1.0, aspect, 1.0); bpy.ops.object.transform_apply(scale=True)
    ob.location.z = z_off
    dimg = bpy.data.images.load(os.path.join(PREP, depth_file)); dimg.colorspace_settings.name = "Non-Color"
    tex = bpy.data.textures.new(name + "_d", "IMAGE"); tex.image = dimg; tex.extension = "EXTEND"
    mod = ob.modifiers.new("disp", "DISPLACE"); mod.texture = tex; mod.texture_coords = "UV"
    mod.direction = "Z"; mod.strength = DEPTH; mod.mid_level = 1.0            # near (1) stays at 0, far goes back
    mat = bpy.data.materials.new(name + "_m"); mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tx = nt.nodes.new("ShaderNodeTexImage"); tx.image = bpy.data.images.load(os.path.join(PREP, color_file)); tx.extension = "EXTEND"
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Strength"].default_value = 1.0
    nt.links.new(tx.outputs["Color"], em.inputs["Color"])
    if mask_file:
        mk = nt.nodes.new("ShaderNodeTexImage"); mk.image = bpy.data.images.load(os.path.join(PREP, mask_file))
        mk.image.colorspace_settings.name = "Non-Color"
        tr = nt.nodes.new("ShaderNodeBsdfTransparent"); mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(mk.outputs["Color"], mix.inputs["Fac"]); nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
    else:
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(mat)
    return ob


has_fg = os.path.exists(os.path.join(PREP, "mask.png"))
layer("bg", "bg.png", "bgdepth.png")
if has_fg:
    layer("fg", "src.png", "depth.png", "mask.png", z_off=0.02)

# camera: a long lens far back, so the first frame matches the picture; then a gentle real move
cam_d = bpy.data.cameras.new("cam"); cam_d.lens = 85; cam_d.sensor_fit = "HORIZONTAL"; cam_d.sensor_width = 36
cam = bpy.data.objects.new("cam", cam_d); sc.collection.objects.link(cam); sc.camera = cam
dist = 4.0 * cam_d.lens / cam_d.sensor_width * 0.80     # frame the centre ~85% of the picture, so a moving camera never shows an edge
TARGET = Vector((0, 0, -DEPTH * 0.45))


def look_at(pos, tgt, up=Vector((0, 1, 0))):
    """camera orientation looking from pos to tgt with world +Y as up (the camera looks down its -Z axis)"""
    from mathutils import Matrix
    z = (pos - tgt).normalized(); x = up.cross(z).normalized(); y = z.cross(x)
    return Matrix((x, y, z)).transposed().to_quaternion()
cam.rotation_mode = "QUATERNION"
n = sc.frame_end
for f in range(1, n + 1):
    t = (f - 1) / max(1, n - 1); e = 0.5 - 0.5 * math.cos(math.pi * t)
    if MOVE == "dolly":
        x, y, z = 0.0, 0.0, dist * (1.0 - 0.22 * e)
    elif MOVE == "crane":
        x, y, z = 0.0, -0.55 + 1.1 * e, dist * (1.0 - 0.05 * e)
    else:  # orbit
        a = math.radians(-4 + 8 * e)
        x, y, z = dist * math.sin(a) * 0.9, 0.05 * math.sin(math.pi * e), dist * math.cos(a)
    cam.location = (x, y, z); cam.keyframe_insert("location", frame=f)
    # aim at the scene centre with world +Y as "up" (a Track-To looking straight down Z flips the picture)
    cam.rotation_quaternion = look_at(Vector((x, y, z)), TARGET); cam.keyframe_insert("rotation_quaternion", frame=f)

frames = os.path.join(os.path.dirname(OUT) or ".", "frames_" + os.path.basename(OUT).replace(".mp4", ""))
os.makedirs(frames, exist_ok=True)
sc.render.filepath = os.path.join(frames, "f_")
sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = 92
bpy.ops.render.render(animation=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(frames, "f_%04d.jpg"),
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], check=True)
subprocess.run(["rm", "-rf", frames])
print("SCENE3D_OK", OUT, flush=True)
