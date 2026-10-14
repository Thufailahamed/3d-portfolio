"""
Builds every GLB the site uses, headless:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/build_models.py

Output goes to public/models/. Everything is generated from code (seeded), so the
models are reproducible and the .blend is only saved for inspection (art/scene.blend).
"""

import math
import os
import random

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "models")
os.makedirs(OUT, exist_ok=True)


# ---------------------------------------------------------------- helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    return m


def mesh_object(name, bm, mats=()):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(material(m))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def recenter(ob):
    """Move origin to the geometry's centroid (so shards rotate around themselves)."""
    me = ob.data
    if not me.vertices:
        return
    c = sum((v.co for v in me.vertices), Vector()) / len(me.vertices)
    for v in me.vertices:
        v.co -= c
    ob.location = ob.location + c


def export(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
    )
    print("wrote", path, os.path.getsize(path) // 1024, "KB")


# Monolith proportions (Blender Z-up; glTF export turns Z into Y)
W, D, H = 1.15, 0.32, 4.4


def box_bm(w, d, h, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z = v.co.z * h + h / 2  # sits on the ground
    if bevel > 0:
        bmesh.ops.bevel(
            bm,
            geom=list(bm.edges),
            offset=bevel,
            segments=2,
            profile=0.5,
            affect="EDGES",
        )
    return bm


# ---------------------------------------------------------------- monolith
def build_monolith():
    """Intact monolith + glyph strip + Voronoi-fractured shards in one file."""
    reset()
    rnd = random.Random(7)

    body = mesh_object("Monolith", box_bm(W, D, H, bevel=0.025), ["Obsidian"])
    for p in body.data.polygons:
        p.use_smooth = False

    # Glyph: a column of short engraved bars running up the front face (-Y in Blender).
    bm = bmesh.new()
    z = 0.55
    while z < H - 0.5:
        length = rnd.choice([0.05, 0.08, 0.12, 0.2, 0.32])
        if rnd.random() > 0.18:
            x = rnd.choice([-0.06, 0.0, 0.0, 0.06])
            w = rnd.choice([0.018, 0.018, 0.05, 0.09])
            r = bmesh.ops.create_cube(bm, size=1.0)
            for v in r["verts"]:
                v.co.x = v.co.x * w + x
                v.co.y = v.co.y * 0.01 - D / 2 - 0.002
                v.co.z = v.co.z * length + z + length / 2
        z += length + rnd.choice([0.025, 0.04, 0.07])
    glyph = mesh_object("Glyph", bm, ["Glyph"])

    # Voronoi cell fracture by repeated bisection (no add-on needed).
    seeds = []
    while len(seeds) < 46:
        p = Vector(
            (
                rnd.uniform(-W / 2, W / 2) * 0.95,
                rnd.uniform(-D / 2, D / 2) * 0.8,
                # bias toward the middle/top where the camera looks
                H * (rnd.random() ** 0.85),
            )
        )
        if all((p - s).length > 0.16 for s in seeds):
            seeds.append(p)

    shards = []
    for i, si in enumerate(seeds):
        bm = box_bm(W, D, H)
        for f in bm.faces:
            f.material_index = 0
        for j, sj in enumerate(seeds):
            if i == j:
                continue
            n = (sj - si).normalized()
            mid = (si + sj) / 2
            res = bmesh.ops.bisect_plane(
                bm,
                geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                plane_co=mid,
                plane_no=n,
                clear_outer=True,
            )
            cut = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
            if cut:
                filled = bmesh.ops.holes_fill(bm, edges=cut, sides=0)
                for f in filled["faces"]:
                    f.material_index = 1
            if not bm.verts:
                break
        if len(bm.verts) < 4:
            bm.free()
            continue
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        ob = mesh_object(f"Shard_{len(shards):03d}", bm, ["Obsidian", "Core"])
        for p in ob.data.polygons:
            p.use_smooth = False
        recenter(ob)
        shards.append(ob)

    export(os.path.join(OUT, "monolith.glb"), [body, glyph] + shards)
    print("shards:", len(shards))
    return body, glyph, shards


if __name__ == "__main__":
    build_monolith()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "art", "scene.blend"))
