"""
Detail world pilot: school-system — realistic night courtyard, 6 classroom pavilions.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/build_detail.py -- --slug school-system [--render]

Seeded + procedural. Saves art/detail-<slug>.blend, exports public/models/detail-<slug>.glb (Draco),
optionally Cycles-renders art/renders/detail-<slug>.png.
"""

import math
import os
import random
import sys

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "models")
RENDER_DIR = os.path.join(ROOT, "art", "renders")
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(RENDER_DIR, exist_ok=True)

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SLUG = "school-system"
for i, a in enumerate(args):
    if a == "--slug" and i + 1 < len(args):
        SLUG = args[i + 1]

rnd = random.Random(2101)
R = rnd.uniform

TINT = (0.784, 1.0, 0.239)
WARM = (1.0, 0.72, 0.42)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def nodes_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    return m, nt, out


def link(nt, a, b):
    nt.links.new(a, b)


def noise_detail(nt, bsdf, scale, detail, color_a, color_b, bump_strength=0.4):
    N = nt.nodes
    coord = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = detail
    noise.inputs["Roughness"].default_value = 0.6
    link(nt, coord.outputs["Object"], noise.inputs["Vector"])
    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*color_a, 1)
    ramp.color_ramp.elements[1].color = (*color_b, 1)
    link(nt, noise.outputs["Fac"], ramp.inputs["Fac"])
    link(nt, ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = bump_strength
    link(nt, noise.outputs["Fac"], bump.inputs["Height"])
    link(nt, bump.outputs["Normal"], bsdf.inputs["Normal"])


def stone_mat_fn(name, ca, cb, scale=6.0):
    m, nt, out = nodes_mat(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.85
    noise_detail(nt, bsdf, scale, 8.0, ca, cb, 0.5)
    link(nt, bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def bevel(ob, width=0.02, segments=2):
    mod = ob.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


reset()

# ---------------- materials
grass_m, nt, out = nodes_mat("Grass")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
bsdf.inputs["Roughness"].default_value = 0.95
noise_detail(nt, bsdf, 4.0, 6.0, (0.004, 0.014, 0.004), (0.014, 0.030, 0.010), 0.3)
link(nt, bsdf.outputs["BSDF"], out.inputs["Surface"])

plaza_mat = stone_mat_fn("Plaza", (0.10, 0.10, 0.105), (0.22, 0.21, 0.19), 3.0)
concrete_mat = stone_mat_fn("Concrete", (0.12, 0.12, 0.125), (0.30, 0.29, 0.27), 8.0)
dark_mat = stone_mat_fn("DarkStone", (0.03, 0.031, 0.033), (0.09, 0.09, 0.095), 10.0)

wood_m, nt, out = nodes_mat("Wood")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
bsdf.inputs["Roughness"].default_value = 0.6
tex = nt.nodes.new("ShaderNodeTexBrick")
tex.inputs["Scale"].default_value = 12.0
tex.offset_frequency = 4
tex.squash_frequency = 1
coord = nt.nodes.new("ShaderNodeTexCoord")
link(nt, coord.outputs["Object"], tex.inputs["Vector"])
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].color = (0.10, 0.06, 0.03, 1)
ramp.color_ramp.elements[1].color = (0.28, 0.16, 0.08, 1)
link(nt, tex.outputs["Color"], ramp.inputs["Fac"])
link(nt, ramp.outputs["Color"], bsdf.inputs["Base Color"])
link(nt, bsdf.outputs["BSDF"], out.inputs["Surface"])

glass_m, nt, out = nodes_mat("Glass")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
bsdf.inputs["Base Color"].default_value = (0.08, 0.10, 0.12, 1)
bsdf.inputs["Roughness"].default_value = 0.08
bsdf.inputs["Metallic"].default_value = 0.0
try:
    bsdf.inputs["Transmission Weight"].default_value = 0.9
    bsdf.inputs["IOR"].default_value = 1.45
except Exception:
    pass
link(nt, bsdf.outputs["BSDF"], out.inputs["Surface"])

lime_m, nt, out = nodes_mat("Lime")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
bsdf.inputs["Base Color"].default_value = (0.1, 0.12, 0.05, 1)
bsdf.inputs["Emission Color"].default_value = (*TINT, 1)
bsdf.inputs["Emission Strength"].default_value = 2.4
link(nt, bsdf.outputs["BSDF"], out.inputs["Surface"])

warm_m, nt, out = nodes_mat("WarmGlow")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
bsdf.inputs["Base Color"].default_value = (0.2, 0.15, 0.1, 1)
bsdf.inputs["Emission Color"].default_value = (*WARM, 1)
bsdf.inputs["Emission Strength"].default_value = 1.6
link(nt, bsdf.outputs["BSDF"], out.inputs["Surface"])

leaf_m, nt, out = nodes_mat("Leaf")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
bsdf.inputs["Roughness"].default_value = 0.8
noise_detail(nt, bsdf, 5.0, 5.0, (0.02, 0.06, 0.015), (0.09, 0.17, 0.05), 0.4)
trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
trans.inputs["Color"].default_value = (0.08, 0.16, 0.04, 1)
mix = nt.nodes.new("ShaderNodeMixShader")
mix.inputs["Fac"].default_value = 0.3
link(nt, bsdf.outputs["BSDF"], mix.inputs[1])
link(nt, trans.outputs["BSDF"], mix.inputs[2])
link(nt, mix.outputs["Shader"], out.inputs["Surface"])

trunk_m, nt, out = nodes_mat("Trunk")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
bsdf.inputs["Roughness"].default_value = 0.95
noise_detail(nt, bsdf, 9.0, 4.0, (0.03, 0.025, 0.02), (0.12, 0.09, 0.06), 0.6)
link(nt, bsdf.outputs["BSDF"], out.inputs["Surface"])

# ---------------- ground: grass + stone plaza
bpy.ops.mesh.primitive_plane_add(size=46)
ground = bpy.context.active_object
ground.name = "Ground"
ground.data.materials.append(grass_m)

bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=4.4, depth=0.14, location=(0, 0, 0.07))
plaza = bpy.context.active_object
plaza.name = "Plaza"
plaza.data.materials.append(plaza_mat)
bevel(plaza, 0.02, 2)

# radial paver joints: thin dark grooves
for k in range(12):
    a = k / 12 * math.tau
    bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * 2.2, math.sin(a) * 2.2, 0.145))
    j = bpy.context.active_object
    j.name = "Joint"
    j.scale = (0.02, 4.4, 0.005)
    j.rotation_euler = (0, 0, a)
    j.data.materials.append(dark_mat)

bpy.ops.mesh.primitive_torus_add(major_radius=3.1, minor_radius=0.025, major_segments=64, minor_segments=12, location=(0, 0, 0.15))
ring = bpy.context.active_object
ring.name = "InlayRing"
ring.data.materials.append(lime_m)

# ---------------- 6 classroom pavilions
for i in range(6):
    a = i / 6 * math.tau + R(-0.04, 0.04)
    r = 3.15
    x, y = math.cos(a) * r, math.sin(a) * r
    rot = a - math.pi / 2  # face the centre
    h = R(1.35, 1.55)

    # stepped platform + step
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, 0.22))
    plat = bpy.context.active_object
    plat.name = f"Platform{i}"
    plat.scale = (1.9, 1.9, 0.16)
    plat.rotation_euler = (0, 0, rot)
    plat.data.materials.append(concrete_mat)
    bevel(plat, 0.02, 2)

    sx, sy = x - math.cos(a) * 0.0, y - math.sin(a) * 0.0
    bpy.ops.mesh.primitive_cube_add(size=1, location=(sx - math.cos(a) * 1.0, sy - math.sin(a) * 1.0, 0.10))
    step = bpy.context.active_object
    step.name = f"Step{i}"
    step.scale = (1.2, 0.4, 0.08)
    step.rotation_euler = (0, 0, rot)
    step.data.materials.append(concrete_mat)
    bevel(step, 0.015, 2)

    # glass room
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, 0.30 + 0.55))
    room = bpy.context.active_object
    room.name = f"GlassRoom{i}"
    room.scale = (1.35, 1.1, 1.1)
    room.rotation_euler = (0, 0, rot)
    room.data.materials.append(glass_m)

    # mullions: 4 dark frames
    for dx in (-0.45, 0.45):
        for dy in (-0.36, 0.36):
            bpy.ops.mesh.primitive_cylinder_add(radius=0.025, depth=1.1, location=(x + dx, y + dy, 0.30 + 0.55))
            mull = bpy.context.active_object
            mull.name = "Mullion"
            mull.rotation_euler = (0, 0, rot)
            # move into rotated frame approx: rotate offset
            ox, oy = dx * math.cos(rot) - dy * math.sin(rot), dx * math.sin(rot) + dy * math.cos(rot)
            mull.location = (x + ox, y + oy, 0.30 + 0.55)
            mull.data.materials.append(dark_mat)

    # furnished interior (desks, shelf, ceiling light) visible through glass
    cr, sr = math.cos(rot), math.sin(rot)

    def local(dx, dy, z, sx, sy, sz, mat, name):
        bpy.ops.mesh.primitive_cube_add(
            size=1, location=(x + dx * cr - dy * sr, y + dx * sr + dy * cr, z)
        )
        o = bpy.context.active_object
        o.name = name
        o.scale = (sx, sy, sz)
        o.rotation_euler = (0, 0, rot)
        o.data.materials.append(mat)
        return o

    local(0, 0, 0.33, 1.2, 0.95, 0.04, wood_m, "FloorInlay")
    for ddx in (-0.3, 0.3):
        local(ddx, 0.05, 0.62, 0.5, 0.35, 0.05, wood_m, "DeskTop")
        for lx in (-0.2, 0.2):
            for ly in (-0.12, 0.12):
                bpy.ops.mesh.primitive_cube_add(
                    size=1,
                    location=(x + (ddx + lx) * cr - (0.05 + ly) * sr, y + (ddx + lx) * sr + (0.05 + ly) * cr, 0.47),
                )
                leg = bpy.context.active_object
                leg.name = "DeskLeg"
                leg.scale = (0.04, 0.04, 0.26)
                leg.rotation_euler = (0, 0, rot)
                leg.data.materials.append(dark_mat)
        local(ddx, -0.35, 0.48, 0.3, 0.08, 0.35, dark_mat, "ChairBack")
        local(ddx, -0.28, 0.40, 0.3, 0.25, 0.05, wood_m, "ChairSeat")
    local(0, 0.48, 0.75, 1.0, 0.12, 0.8, dark_mat, "ShelfFrame")
    for sz in (0.55, 0.75, 0.95):
        local(0, 0.44, sz, 0.9, 0.2, 0.03, wood_m, "ShelfBoard")
        for bi in range(5):
            bx = -0.36 + bi * 0.18 + R(-0.02, 0.02)
            bh = R(0.12, 0.2)
            local(bx, 0.44, sz + 0.03 + bh / 2, 0.1, 0.14, bh, concrete_mat if bi % 2 else wood_m, "Book")
    local(0, 0, 1.28, 0.7, 0.5, 0.03, warm_m, "CeilLight")

    # wood slat screen on outer face
    for s in range(5):
        off = -0.5 + s * 0.25
        ox = off * math.cos(rot)
        oy = off * math.sin(rot)
        bx = x + math.cos(a) * 0.75 + ox
        by = y + math.sin(a) * 0.75 + oy
        bpy.ops.mesh.primitive_cube_add(size=1, location=(bx, by, 0.30 + 0.55))
        slat = bpy.context.active_object
        slat.name = "Slat"
        slat.scale = (0.06, 0.06, 1.15)
        slat.rotation_euler = (0, 0, rot)
        slat.data.materials.append(wood_m)

    # roof slab + fascia + lime LED
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, 0.30 + 1.12))
    roof = bpy.context.active_object
    roof.name = f"Roof{i}"
    roof.scale = (1.85, 1.6, 0.10)
    roof.rotation_euler = (0, 0, rot)
    roof.data.materials.append(concrete_mat)
    bevel(roof, 0.02, 2)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, 0.30 + 1.05))
    led = bpy.context.active_object
    led.name = f"LED{i}"
    led.scale = (1.7, 1.45, 0.03)
    led.rotation_euler = (0, 0, rot)
    led.data.materials.append(lime_m)

    # concrete columns
    for dx, dy in ((-0.7, -0.6), (0.7, -0.6), (-0.7, 0.6), (0.7, 0.6)):
        ox = dx * math.cos(rot) - dy * math.sin(rot)
        oy = dx * math.sin(rot) + dy * math.cos(rot)
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.055, depth=1.15, location=(x + ox, y + oy, 0.30 + 0.57))
        col = bpy.context.active_object
        col.name = "Column"
        col.data.materials.append(concrete_mat)

# ---------------- central totem + benches + bollards
bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.85, depth=0.18, location=(0, 0, 0.23))
tbase = bpy.context.active_object
tbase.name = "TotemBase"
tbase.data.materials.append(concrete_mat)
bevel(tbase, 0.02, 2)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 1.05))
totem = bpy.context.active_object
totem.name = "Totem"
totem.scale = (0.55, 0.55, 1.5)
totem.data.materials.append(dark_mat)
bevel(totem, 0.03, 3)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 1.85))
cap = bpy.context.active_object
cap.name = "TotemCap"
cap.scale = (0.62, 0.62, 0.09)
cap.data.materials.append(lime_m)
bevel(cap, 0.015, 2)

for k in range(4):
    a = k / 4 * math.tau + math.pi / 4
    bx, by = math.cos(a) * 1.5, math.sin(a) * 1.5
    bpy.ops.mesh.primitive_cube_add(size=1, location=(bx, by, 0.32))
    bench = bpy.context.active_object
    bench.name = "Bench"
    bench.scale = (0.9, 0.35, 0.08)
    bench.rotation_euler = (0, 0, a + math.pi / 2)
    bench.data.materials.append(wood_m)
    bevel(bench, 0.015, 2)
    for e in (-0.3, 0.3):
        ex = bx + math.cos(a + math.pi / 2) * e
        ey = by + math.sin(a + math.pi / 2) * e
        bpy.ops.mesh.primitive_cube_add(size=1, location=(ex, ey, 0.15))
        leg = bpy.context.active_object
        leg.name = "BenchLeg"
        leg.scale = (0.08, 0.3, 0.22)
        leg.rotation_euler = (0, 0, a + math.pi / 2)
        leg.data.materials.append(dark_mat)

for k in range(6):
    a = k / 6 * math.tau + math.pi / 6
    bx, by = math.cos(a) * 4.9, math.sin(a) * 4.9
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.07, depth=0.65, location=(bx, by, 0.32))
    bol = bpy.context.active_object
    bol.name = "Bollard"
    bol.data.materials.append(dark_mat)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.075, depth=0.08, location=(bx, by, 0.68))
    head = bpy.context.active_object
    head.name = "BollardHead"
    head.data.materials.append(lime_m)

# ---------------- trees around (kept clear of the camera lane)
cam_az = math.atan2(-6.8, 6.2)
for k in range(9):
    a = k / 9 * math.tau + R(-0.15, 0.15)
    da = (a - cam_az + math.pi) % math.tau - math.pi
    if abs(da) < 0.45:
        continue
    tr = R(7.5, 11.0)
    tx, ty = math.cos(a) * tr, math.sin(a) * tr
    th = R(2.2, 3.4)
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=R(0.12, 0.2), depth=th, location=(tx, ty, th / 2))
    trunk = bpy.context.active_object
    trunk.name = "Trunk"
    trunk.rotation_euler = (R(-0.06, 0.06), R(-0.06, 0.06), 0)
    trunk.data.materials.append(trunk_m)
    for b in range(3):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=R(0.9, 1.4), location=(tx + R(-0.5, 0.5), ty + R(-0.5, 0.5), th + R(-0.1, 0.9)))
        can = bpy.context.active_object
        can.name = "Canopy"
        can.scale = (1.0, 1.0, R(0.75, 0.95))
        for p in can.data.polygons:
            p.use_smooth = True
        can.data.materials.append(leaf_m)

# ---------------- sky + lights + camera
world = bpy.data.worlds.new("NightSky")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.008, 0.012, 0.025, 1)
bg.inputs["Strength"].default_value = 1.2
bpy.context.scene.world = world

sun = bpy.data.lights.new("Sun", "SUN")
sun.energy = 2.2
sun.color = (1.0, 0.82, 0.6)
sun.angle = math.radians(1.2)
so = bpy.data.objects.new("Sun", sun)
so.rotation_euler = Vector((-0.55, 0.25, -0.8)).normalized().to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.collection.objects.link(so)

area = bpy.data.lights.new("Fill", "AREA")
area.energy = 120
area.size = 6
area.color = (0.55, 0.68, 1.0)
ao = bpy.data.objects.new("Fill", area)
ao.location = (-5, -6, 5.5)
bpy.context.scene.collection.objects.link(ao)
look_at(ao, (0, 0, 1.0))

for lx, ly in ((3.2, 2.0), (-3.0, 2.4)):
    pt = bpy.data.lights.new("WarmPt", "POINT")
    pt.energy = 30
    pt.color = WARM
    po = bpy.data.objects.new("WarmPt", pt)
    po.location = (lx, ly, 1.6)
    bpy.context.scene.collection.objects.link(po)

lime_pt = bpy.data.lights.new("LimePt", "POINT")
lime_pt.energy = 20
lime_pt.color = TINT
lo = bpy.data.objects.new("LimePt", lime_pt)
lo.location = (0, 0, 2.2)
bpy.context.scene.collection.objects.link(lo)

cam = bpy.data.cameras.new("DetailCam")
cam.lens = 34
co = bpy.data.objects.new("DetailCam", cam)
co.location = (6.2, -6.8, 3.6)
bpy.context.scene.collection.objects.link(co)
look_at(co, (0, 0, 0.8))
bpy.context.scene.camera = co

# ---------------- render: Cycles realistic
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.render.resolution_x = 1600
sc.render.resolution_y = 900
sc.cycles.samples = 150
sc.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = "GPU"
except Exception as e:
    print("GPU unavailable:", e)
try:
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.view_settings.exposure = 0.0
except Exception:
    pass

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "art", f"detail-{SLUG}.blend"))

bpy.ops.object.select_all(action="DESELECT")
for o in bpy.data.objects:
    if o.type == "MESH":
        o.select_set(True)
out = os.path.join(OUT_DIR, f"detail-{SLUG}.glb")
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_normals=True,
    export_texcoords=False,
    export_materials="EXPORT",
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
)
print("wrote", out, os.path.getsize(out) // 1024, "KB")

if "render" in args or "--render" in args:
    sc.render.filepath = os.path.join(RENDER_DIR, f"detail-{SLUG}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", sc.render.filepath)
