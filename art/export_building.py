"""
Exports art/building.blend to public/models/building.glb with PBR materials,
realized 3D typography, evaluated bevel modifiers, and Draco compression,
ready for Three.js / React Three Fiber.
"""
import os
import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "models", "building.glb")

# 1. Clean up cameras, lights, and Eevee-only volumetric cube (Three.js handles fog & lights)
for ob in list(bpy.data.objects):
    if ob.type in {"CAMERA", "LIGHT"} or ob.name.startswith(("PlazaHaze", "PlazaCenterGuideLine")):
        bpy.data.objects.remove(ob, do_unlink=True)

# 2. Convert 3D FONT / CURVE objects (Frieze inscription, floating labels, plinth titles) to meshes
#    and apply modifiers (Bevel) while preserving object origins (critical for rotating Artifacts)
bpy.ops.object.select_all(action="DESELECT")
for ob in list(bpy.data.objects):
    if ob.type in {"FONT", "CURVE"}:
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.convert(target="MESH")
        ob.select_set(False)
    elif ob.type == "MESH" and ob.modifiers:
        bpy.context.view_layer.objects.active = ob
        for mod in list(ob.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except Exception as e:
                print(f"Modifier apply note on {ob.name}: {e}")

# 3. Tune materials for WebGL / Three.js PBR + PostFX Bloom
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    emit = next((n for n in nt.nodes if n.type == "EMISSION"), None)
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)

    if mat.name == "ObsidianStone" and bsdf:
        # Deep architectural basalt (matching building_exterior.png dark charcoal stone)
        bsdf.inputs["Base Color"].default_value = (0.022, 0.025, 0.030, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.44
        bsdf.inputs["Metallic"].default_value = 0.08
    elif mat.name == "ClassicalLimestone" and bsdf:
        bsdf.inputs["Base Color"].default_value = (0.034, 0.038, 0.046, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.46
        bsdf.inputs["Metallic"].default_value = 0.05
    elif mat.name == "NeroMarquinaMarble" and bsdf:
        bsdf.inputs["Base Color"].default_value = (0.010, 0.012, 0.016, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.10
        bsdf.inputs["Metallic"].default_value = 0.20
    elif mat.name == "PlazaGrid" and bsdf:
        # Disconnect procedural brick (unsupported in glTF) and set obsidian base color
        for link in list(nt.links):
            if link.to_node == bsdf and link.to_socket.name == "Base Color":
                nt.links.remove(link)
        bsdf.inputs["Base Color"].default_value = (0.012, 0.015, 0.020, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.12
        bsdf.inputs["Metallic"].default_value = 0.22
    elif mat.name.startswith("Holo_") and bsdf:
        # Balanced emission so 3D facets and shading remain crisp with post-processing bloom
        bsdf.inputs["Emission Strength"].default_value = 2.0
    elif emit and not bsdf and out:
        # Convert pure Emission nodes to Principled BSDF so glTF exports emissive color & strength
        col = list(emit.inputs["Color"].default_value)
        raw_strength = float(emit.inputs["Strength"].default_value)
        web_strength = min(max(raw_strength * 0.09, 1.2), 3.0)
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Base Color"].default_value = (col[0], col[1], col[2], 1.0)
        bsdf.inputs["Roughness"].default_value = 0.25
        bsdf.inputs["Emission Color"].default_value = (col[0], col[1], col[2], 1.0)
        bsdf.inputs["Emission Strength"].default_value = web_strength
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        nt.nodes.remove(emit)

# 4. Select all mesh objects
bpy.ops.object.select_all(action="DESELECT")
mesh_count = 0
vert_count = 0

for ob in bpy.data.objects:
    if ob.type == "MESH":
        ob.select_set(True)
        mesh_count += 1
        vert_count += len(ob.data.vertices)

print(f"Exporting {mesh_count} meshes with {vert_count} vertices to {OUT}...")

# 5. Export GLB with materials, normals, and Draco compression
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
    export_draco_texcoord_quantization=12,
)

size_kb = os.path.getsize(OUT) // 1024
print(f"Successfully exported {OUT} ({size_kb} KB)")
