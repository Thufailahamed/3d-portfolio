"""
Builds every GLB the site uses, headless:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/build_models.py [-- monolith prism bloom]

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


# ---------------------------------------------------------------- prism
def build_prism():
    """Faceted glass crystal: a jittered heptagonal column capped by uneven points."""
    reset()
    rnd = random.Random(31)
    sides, R, h = 7, 0.62, 1.55
    bm = bmesh.new()

    def ring(z, r, twist):
        out = []
        for i in range(sides):
            a = i / sides * math.tau + twist + rnd.uniform(-0.12, 0.12)
            rr = r * rnd.uniform(0.86, 1.08)
            out.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, z + rnd.uniform(-0.08, 0.08))))
        return out

    rings = [
        ring(-h * 0.55, R * 0.92, 0.0),
        ring(-h * 0.1, R * 1.0, 0.18),
        ring(h * 0.42, R * 0.88, 0.33),
    ]
    top = bm.verts.new((rnd.uniform(-0.08, 0.08), rnd.uniform(-0.08, 0.08), h * 0.95))
    bot = bm.verts.new((rnd.uniform(-0.06, 0.06), rnd.uniform(-0.06, 0.06), -h * 0.98))

    for a, b in zip(rings, rings[1:]):
        for i in range(sides):
            j = (i + 1) % sides
            # split each quad into two triangles for a cut-gem look
            bm.faces.new((a[i], a[j], b[j]))
            bm.faces.new((a[i], b[j], b[i]))
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((rings[-1][i], rings[-1][j], top))
        bm.faces.new((rings[0][j], rings[0][i], bot))

    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    ob = mesh_object("Prism", bm, ["Glass"])
    for p in ob.data.polygons:
        p.use_smooth = False
    export(os.path.join(OUT, "prism.glb"), [ob])
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "art", "prism.blend"))


# ---------------------------------------------------------------- bloom
def build_bloom():
    """One faceted petal blade + a crystalline core. The site instances the petal
    in rings and unfolds them with scroll, so only one petal is modelled.

    Blender Z-up: the petal grows along +Z and curls toward -Y (glTF: +Y, curling to +Z).
    UV: u across the blade (0..1), v along it (0 base .. 1 tip).
    """
    reset()
    rnd = random.Random(53)
    L, Wd, T, SEG = 1.0, 0.24, 0.035, 10
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    rows = []
    for k in range(SEG + 1):
        s = k / SEG
        # blade outline: narrow stalk, swells, then a long pointed tip
        w = Wd * math.sin(math.pi * min(1.0, s ** 0.75)) * (1.0 - 0.15 * s)
        if k == SEG:
            w = 0.0
        t = T * (1.0 - s) + 0.004
        curl = -0.32 * s * s  # bends outward
        z = L * s
        jitter = rnd.uniform(-0.01, 0.01)
        rows.append(
            [
                bm.verts.new((-w / 2, curl, z)),
                bm.verts.new((0.0, curl - t + jitter, z)),  # back ridge
                bm.verts.new((w / 2, curl, z)),
                bm.verts.new((0.0, curl + t + jitter, z)),  # front ridge
            ]
        )
    U = [0.0, 0.5, 1.0, 0.5]
    for k in range(SEG):
        a, b = rows[k], rows[k + 1]
        for i in range(4):
            j = (i + 1) % 4
            for tri in ((a[i], a[j], b[j]), (a[i], b[j], b[i])):
                try:
                    f = bm.faces.new(tri)
                except ValueError:
                    continue
                for loop in f.loops:
                    v = loop.vert
                    ki = next(n for n, r in enumerate(rows) if v in r)
                    loop[uv].uv = (U[rows[ki].index(v)], ki / SEG)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    petal = mesh_object("Petal", bm, ["Petal"])
    for p in petal.data.polygons:
        p.use_smooth = False

    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.2)
    for v in bm.verts:
        v.co *= rnd.uniform(0.85, 1.15)
        v.co.z *= 1.25
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    core = mesh_object("BloomCore", bm, ["BloomCore"])
    for p in core.data.polygons:
        p.use_smooth = False

    export(os.path.join(OUT, "bloom.glb"), [petal, core])
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "art", "bloom.blend"))


if __name__ == "__main__":
    import sys

    only = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not only or "monolith" in only:
        build_monolith()
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "art", "scene.blend"))
    if not only or "prism" in only:
        build_prism()
    if not only or "bloom" in only:
        build_bloom()
