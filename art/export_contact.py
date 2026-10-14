"""
Exports art/contact.blend as an optimized web-ready glTF scene:
    public/models/shrine.glb (with Draco compression)

Transforms evaluated curves (roots, lianas, branches) into meshes,
decimates dense ground geometry, structures node hierarchy for Three.js,
and embeds PBR materials and emissive properties.
"""

import os
import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "models", "shrine.glb")

sc = bpy.context.scene
objs = bpy.data.objects

def delete(ob):
    bpy.data.objects.remove(ob, do_unlink=True)

# 1. Remove non-mesh/non-curve FX (Three.js will do volumetric rays & fireflies in real-time shaders)
for ob in list(objs):
    if ob.name.startswith(("JungleFirefly", "JungleMist", "Haze", "ContactCamera", "CoreLight", "JungleSun", "HeroCanopyBeam", "ArchRim")):
        delete(ob)

# 2. Decimate high-poly ground
g = objs.get("JungleGround")
if g:
    d = g.modifiers.new("Decimate", "DECIMATE")
    d.ratio = 0.25

# 3. Realize evaluated geometry (converts bezier curves to meshes and bakes transforms)
def realize(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    me.transform(ob.matrix_world)
    name = ob.name
    new = bpy.data.objects.new(name + "_eval", me)
    # copy materials
    for m in ob.data.materials:
        new.data.materials.append(m)
    for c in ob.users_collection:
        c.objects.link(new)
    delete(ob)
    new.name = name
    return new

targets = [o for o in list(objs) if o.type in {"MESH", "CURVE"}]
realized = [realize(o) for o in targets]

# 4. Join similar static environment meshes to minimize draw calls in Three.js
def join(prefix, name):
    group = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith(prefix)]
    if not group:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in group:
        o.select_set(True)
    bpy.context.view_layer.objects.active = group[0]
    if len(group) > 1:
        bpy.ops.object.join()
    act = bpy.context.view_layer.objects.active
    act.name = name
    return act

join("JungleBoulder", "Boulders")
join("ButtressRoot", "Roots")
join("Liana", "Lianas")
join("OverheadBranch", "Branches")
join("JungleTree", "Trees")
join("Dais_Tier", "Dais")
join("Arch_Pillar", "ArchPillars")
join("Monolith_Face", "MonolithShell")

# 5. Fix material emissions for WebGL PBR
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    emit = next((n for n in mat.node_tree.nodes if n.type == "EMISSION"), None)
    if emit and not bsdf:
        # replace pure emission node with Principled BSDF so standard glTF PBR exporter embeds emission correctly
        col = emit.inputs["Color"].default_value
        strength = emit.inputs["Strength"].default_value
        bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Base Color"].default_value = (0.01, 0.01, 0.01, 1.0)
        bsdf.inputs["Emission Color"].default_value = col
        bsdf.inputs["Emission Strength"].default_value = min(strength * 0.1, 4.0)
        out = next(n for n in mat.node_tree.nodes if n.type == "OUTPUT_MATERIAL")
        mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        mat.node_tree.nodes.remove(emit)

# 6. Export to glTF with Draco compression
export_objs = [o for o in bpy.data.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in export_objs:
    o.select_set(True)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_normals=True,
    export_materials="EXPORT",
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
)

print(f"Exported {len(export_objs)} objects to {OUT}")
print(f"File size: {os.path.getsize(OUT) // 1024} KB")
