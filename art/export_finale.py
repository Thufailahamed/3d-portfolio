"""
Bakes art/finale.blend's lighting into vertex colours and exports the contact scene:

    /Applications/Blender.app/Contents/MacOS/Blender -b art/finale.blend -P art/export_finale.py

Output: public/models/finale.glb (Draco). Contains
  baked (colours = linear radiance / BAKE_SCALE, like forest.glb):
    Arch (stones + the tended ivy), Dais, Ground, Ferns, Rocks, Trunks
  unbaked, lit live on the site:
    Seams      the light core seen through the stone joints
    Lines      the doorway line, the dais ring and the threshold
    Veil       the doorway's outline (the site draws its sheet of light)
"""

import os

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "models", "finale.glb")
BAKE_SCALE = 4.0

sc = bpy.context.scene
objs = bpy.data.objects


def delete(ob):
    bpy.data.objects.remove(ob, do_unlink=True)


for ob in list(objs):
    if ob.name.startswith(("Mote", "Haze")):
        delete(ob)

for ob in objs:
    if ob.type != "MESH":
        continue
    if ob.name == "Ground":
        ob.modifiers.new("Decimate", "DECIMATE").ratio = 0.3
    if ob.name.startswith("Rock"):
        ob.modifiers.new("Decimate", "DECIMATE").ratio = 0.35
    if ob.name.startswith("Trunk"):
        ob.modifiers.new("Decimate", "DECIMATE").ratio = 0.4


def realize(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    me.transform(ob.matrix_world)
    name = ob.name
    new = bpy.data.objects.new(name + "_tmp", me)
    for c in ob.users_collection:
        c.objects.link(new)
    delete(ob)
    new.name = name
    return new


for o in [o for o in objs if o.type in {"MESH", "CURVE"} and not o.name.startswith("Canopy")]:
    realize(o)


def join(prefixes, name):
    group = [o for o in objs if o.type == "MESH" and o.name.startswith(prefixes)]
    if not group:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in group:
        o.select_set(True)
    bpy.context.view_layer.objects.active = group[0]
    if len(group) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


join(("PillarStone", "ArchStone", "Ivy"), "Arch")
join(("Rock",), "Rocks")
join(("Trunk",), "Trunks")
join(("ArchCore",), "Seams")
join(("Doorline", "DaisRing", "Threshold"), "Lines")

LIVE = ("Seams", "Lines", "Veil")

# ------------------------------------------------------------------ bake (live parts hidden from it)
for n in LIVE:
    if n in objs:
        objs[n].hide_render = True

prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = "GPU"
except Exception as e:
    print("GPU unavailable:", e)
sc.render.engine = "CYCLES"
sc.cycles.samples = 128
sc.cycles.use_denoising = False
sc.render.bake.target = "VERTEX_COLORS"

# the live lights still need to light the scene: give the hidden glow a stand-in
door = objs.get("DoorGlow")
if door:
    door.data.energy *= 1.6

bake_objs = [o for o in objs if o.type == "MESH" and not o.name.startswith("Canopy") and o.name not in LIVE]
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

baked = bpy.data.materials.new("Baked")
for o in bake_objs:
    ca = o.data.color_attributes["Bake"]
    for d in ca.data:
        c = d.color
        d.color = (c[0] / BAKE_SCALE, c[1] / BAKE_SCALE, c[2] / BAKE_SCALE, 1.0)
    for p in o.data.polygons:
        p.material_index = 0
    o.data.materials.clear()
    o.data.materials.append(baked)
    for a in [a for a in o.data.color_attributes if a.name != "Bake"]:
        o.data.color_attributes.remove(a)

for n in LIVE:
    if n in objs:
        o = objs[n]
        o.data.materials.clear()
        o.data.materials.append(baked)
        for a in list(o.data.color_attributes):
            o.data.color_attributes.remove(a)

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
print("objects:", sorted(o.name for o in export))
print("verts:", sum(len(o.data.vertices) for o in export))
print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
