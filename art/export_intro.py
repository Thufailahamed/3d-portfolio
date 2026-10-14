"""
Bakes art/intro.blend's lighting into vertex colours and exports the web scene:

    /Applications/Blender.app/Contents/MacOS/Blender -b art/intro.blend -P art/export_intro.py

Output: public/models/forest.glb (Draco). Contains
  Stone_###   every arch / pillar / fallen stone, origin at its centre, carrying its ivy
  Ground, Ferns, BroadLeaves, Roots, Rocks, Trunks
Colours are linear radiance scaled by 1/BAKE_SCALE (the site multiplies it back).
"""

import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "models", "forest.glb")
BAKE_SCALE = 4.0

sc = bpy.context.scene
objs = bpy.data.objects


def delete(ob):
    bpy.data.objects.remove(ob, do_unlink=True)


# ------------------------------------------------------------------ cleanup
for ob in list(objs):
    if ob.name.startswith(("Firefly", "Haze")):
        delete(ob)

# lighter geometry for the web
for ob in objs:
    if ob.type != "MESH":
        continue
    for m in ob.modifiers:
        if m.type == "SUBSURF" and m.levels > 2:
            m.levels = m.render_levels = 2
    if ob.name == "Ground":
        d = ob.modifiers.new("Decimate", "DECIMATE")
        d.ratio = 0.3
    if ob.name.startswith("Rock"):
        d = ob.modifiers.new("Decimate", "DECIMATE")
        d.ratio = 0.35
    if ob.name.startswith("Trunk"):
        d = ob.modifiers.new("Decimate", "DECIMATE")
        d.ratio = 0.4


def realize(ob):
    """Replace ob's data with its evaluated mesh, transforms baked in, origin at world 0."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    me.transform(ob.matrix_world)
    name = ob.name
    new = bpy.data.objects.new(name + "_tmp", me)
    for c in ob.users_collection:
        c.objects.link(new)
    delete(ob)
    new.name = name
    return new


targets = [o for o in objs if o.type in {"MESH", "CURVE"} and not o.name.startswith("Canopy")]
realized = [realize(o) for o in targets]

stones = [o for o in realized if o.name.startswith(("PillarStone", "ArchStone", "FallenStone"))]
ivy = next(o for o in realized if o.name.startswith("Ivy"))

# ------------------------------------------------------------------ ivy → nearest stone
ivy_mat = ivy.data.materials[0]
for s in stones:
    if ivy_mat.name not in s.data.materials:
        s.data.materials.append(ivy_mat)

bm = bmesh.new()
bm.from_mesh(ivy.data)
bm.verts.ensure_lookup_table()
# leaves are loose parts: flood-fill faces through shared verts
seen = set()
leaves = []
for f in bm.faces:
    if f.index in seen:
        continue
    stack, part = [f], []
    seen.add(f.index)
    while stack:
        g = stack.pop()
        part.append(g)
        for v in g.verts:
            for h in v.link_faces:
                if h.index not in seen:
                    seen.add(h.index)
                    stack.append(h)
    leaves.append(part)

per_stone = {s.name: [] for s in stones}
for part in leaves:
    c = sum((v.co for f in part for v in f.verts), Vector()) / sum(len(f.verts) for f in part)
    best, bd = None, 1e9
    for s in stones:
        ok, loc, _n, _i = s.closest_point_on_mesh(c)
        d = (loc - c).length if ok else 1e9
        if d < bd:
            best, bd = s, d
    per_stone[best.name].append(part)

for s in stones:
    parts = per_stone[s.name]
    if not parts:
        continue
    sb = bmesh.new()
    sb.from_mesh(s.data)
    mi = s.data.materials.find(ivy_mat.name)
    for part in parts:
        vmap = {}
        for f in part:
            vs = []
            for v in f.verts:
                if v not in vmap:
                    vmap[v] = sb.verts.new(v.co)
                vs.append(vmap[v])
            nf = sb.faces.new(vs)
            nf.material_index = mi
            nf.smooth = True
    sb.to_mesh(s.data)
    sb.free()
bm.free()
delete(ivy)

# ------------------------------------------------------------------ bake
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = "GPU"
except Exception as e:  # CPU is fine, just slower
    print("GPU unavailable:", e)
sc.render.engine = "CYCLES"
sc.cycles.samples = 96
sc.cycles.use_denoising = False
sc.render.bake.target = "VERTEX_COLORS"

bake_objs = [o for o in objs if o.type == "MESH" and not o.name.startswith("Canopy")]
for o in bake_objs:
    ca = o.data.color_attributes.new("Bake", "FLOAT_COLOR", "POINT")
    o.data.color_attributes.active_color = ca
    o.data.color_attributes.render_color_index = o.data.color_attributes.find("Bake")

bpy.ops.object.select_all(action="DESELECT")
for o in bake_objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = bake_objs[0]
print("baking", len(bake_objs), "objects,", sum(len(o.data.vertices) for o in bake_objs), "verts")
bpy.ops.object.bake(type="COMBINED")

# ------------------------------------------------------------------ finalize
baked = bpy.data.materials.new("Baked")
for o in bake_objs:
    ca = o.data.color_attributes["Bake"]
    for d in ca.data:
        c = d.color
        d.color = (c[0] / BAKE_SCALE, c[1] / BAKE_SCALE, c[2] / BAKE_SCALE, 1.0)
    # one material, so glTF keeps each object as a single primitive
    for p in o.data.polygons:
        p.material_index = 0
    o.data.materials.clear()
    o.data.materials.append(baked)
    for a in [a for a in o.data.color_attributes if a.name != "Bake"]:
        o.data.color_attributes.remove(a)


def join(prefix, name):
    group = [o for o in objs if o.type == "MESH" and o.name.startswith(prefix)]
    if not group:
        return
    bpy.ops.object.select_all(action="DESELECT")
    for o in group:
        o.select_set(True)
    bpy.context.view_layer.objects.active = group[0]
    if len(group) > 1:
        bpy.ops.object.join()
    bpy.context.view_layer.objects.active.name = name


join("Rock", "Rocks")
join("Trunk", "Trunks")
join("Root", "Roots")

# stones: origin at their centre, numbered bottom → top
stones = sorted(
    [o for o in objs if o.name.startswith(("PillarStone", "ArchStone", "FallenStone"))],
    key=lambda o: sum((v.co for v in o.data.vertices), Vector()).z / len(o.data.vertices),
)
for i, s in enumerate(stones):
    vs = [v.co for v in s.data.vertices if True]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    c = (lo + hi) / 2
    s.data.transform(Matrix.Translation(-c))
    s.location = c
    s.name = f"Stone_{i:03d}"

export = [o for o in objs if o.type == "MESH" and not o.name.startswith("Canopy")]
bpy.ops.object.select_all(action="DESELECT")
for o in export:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_normals=True,
    export_texcoords=False,
    export_materials="NONE",
    export_vertex_color="ACTIVE",
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=8,
    export_draco_color_quantization=12,
)
print("objects:", sorted(o.name for o in export)[:6], "...", len(export))
print("verts:", sum(len(o.data.vertices) for o in export))
print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
