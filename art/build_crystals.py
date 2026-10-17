"""
Six project crystals, one per project, as flat-faceted meshes:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/build_crystals.py [-- render]

Writes public/models/crystals.glb (Crystal_0 … Crystal_5, in projects[] order), each
fitted to the same envelope (≈2.5 tall, centred on its bounding box). With `render`,
also writes art/renders/crystals.png. Blender Z-up; glTF turns Z into Y.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "models", "crystals.glb")
HEIGHT = 2.5
MAX_R = 0.95


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def ring(bm, n, r, z, twist=0.0, jitter=0.0, rnd=None, squash=1.0, phase=0.0):
    out = []
    for i in range(n):
        a = phase + (i + twist) / n * math.tau + (rnd.uniform(-jitter, jitter) if rnd else 0)
        rr = r * (rnd.uniform(1 - jitter, 1 + jitter) if rnd and jitter else 1)
        out.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr * squash, z)))
    return out


def band(bm, a, b, quads=True):
    """Join two rings. quads → planar-ish quads split in two; else an antiprism of triangles."""
    n = len(a)
    for i in range(n):
        j = (i + 1) % n
        if quads:
            bm.faces.new((a[i], a[j], b[j], b[i]))
        else:
            bm.faces.new((a[i], a[j], b[i]))
            bm.faces.new((a[j], b[j], b[i]))


def cap(bm, ring_, apex, top=True):
    n = len(ring_)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ring_[i], ring_[j], apex) if top else (ring_[j], ring_[i], apex))


def lid(bm, ring_, top=True):
    bm.faces.new(ring_ if top else list(reversed(ring_)))


def rough(bm, seed):
    """Hand-cut look: chamfer the long edges into thin extra facets, then nudge every vertex so
    no two faces are quite parallel. Reads as a rough gem rather than a CAD prism."""
    rnd = random.Random(seed)
    bm.edges.ensure_lookup_table()
    long_edges = [e for e in bm.edges if e.calc_length() > 0.3 and len(e.link_faces) == 2]
    bmesh.ops.bevel(bm, geom=long_edges, offset=0.07, segments=1, affect="EDGES")
    k = rnd.uniform(0.9, 1.1)
    for v in bm.verts:
        v.co.x = v.co.x * k + rnd.gauss(0, 0.035)
        v.co.y = v.co.y / k + rnd.gauss(0, 0.035)
        v.co.z += rnd.gauss(0, 0.04)
        v.co.x += v.co.z * 0.08 * (seed % 3 - 1)  # a slight lean


def finish(bm, name):
    rough(bm, sum(map(ord, name)))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    fit(ob)
    return ob


def fit(ob):
    """Centre on the bounding box and scale into the shared envelope."""
    vs = [v.co for v in ob.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    c = (lo + hi) / 2
    ob.data.transform(Matrix.Translation(-c))
    h = hi.z - lo.z
    r = max(math.hypot(v.x - c.x, v.y - c.y) for v in vs)
    s = min(HEIGHT / h, MAX_R / r)
    ob.data.transform(Matrix.Scale(s, 4))


def point(bm, rnd, base_z, length, r, sides=6, tip=0.55, lean=(0.0, 0.0), offset=(0.0, 0.0), irregular=0.12):
    """A quartz-style point: prism + pyramidal termination, optionally leaning."""
    ox, oy = offset
    lx, ly = lean
    bot = ring(bm, sides, r, base_z, jitter=0.0, rnd=None)
    top = ring(bm, sides, r, base_z + length, jitter=0.0, rnd=None)
    # alternating large / small faces, like natural quartz
    for k, v in enumerate(bot + top):
        i = k % sides
        f = 1 + (irregular if i % 2 else -irregular * 0.5)
        v.co.x = v.co.x * f
        v.co.y = v.co.y * f
    for v in bot + top:
        h = v.co.z - base_z
        v.co.x += ox + lx * h
        v.co.y += oy + ly * h
    apex_h = base_z + length + r * tip * 2.2
    apex = bm.verts.new((ox + lx * (apex_h - base_z) + rnd.uniform(-0.03, 0.03), oy + ly * (apex_h - base_z), apex_h))
    band(bm, bot, top)
    cap(bm, top, apex)
    lid(bm, bot, top=False)


# ------------------------------------------------------------------ the six cuts
def c_quartz(rnd):
    """Halcyon — a double-terminated quartz point."""
    bm = bmesh.new()
    sides = 6
    lo = ring(bm, sides, 0.6, -0.75)
    hi = ring(bm, sides, 0.6, 0.65)
    for k, v in enumerate(lo + hi):
        f = 1.1 if (k % sides) % 2 else 0.9
        v.co.x *= f
        v.co.y *= f
    top = bm.verts.new((0.05, -0.03, 1.55))
    bot = bm.verts.new((-0.04, 0.02, -1.4))
    band(bm, lo, hi)
    cap(bm, hi, top)
    cap(bm, lo, bot, top=False)
    return finish(bm, "Crystal_0")


def c_spindle(rnd):
    """Atlas of Sound — a slender eight-sided bipyramid with stepped facets."""
    bm = bmesh.new()
    n = 8
    r1 = ring(bm, n, 0.42, -0.95, twist=0.5)
    r2 = ring(bm, n, 0.78, -0.05)
    r3 = ring(bm, n, 0.6, 0.6, twist=0.5)
    r4 = ring(bm, n, 0.28, 1.2)
    top = bm.verts.new((0, 0, 1.6))
    bot = bm.verts.new((0, 0, -1.7))
    band(bm, r1, r2, quads=False)
    band(bm, r2, r3, quads=False)
    band(bm, r3, r4, quads=False)
    cap(bm, r4, top)
    cap(bm, r1, bot, top=False)
    return finish(bm, "Crystal_1")


def c_cluster(rnd):
    """Parallel — three fused quartz points growing from one root."""
    bm = bmesh.new()
    point(bm, rnd, -1.0, 1.55, 0.36, tip=0.6)
    point(bm, rnd, -0.95, 1.0, 0.24, tip=0.62, lean=(-0.42, 0.08), offset=(-0.18, 0.05))
    point(bm, rnd, -0.95, 0.85, 0.2, tip=0.62, lean=(0.45, -0.12), offset=(0.18, -0.04))
    # root: a low faceted boss holding the three together
    base = ring(bm, 7, 0.5, -1.05, jitter=0.08, rnd=rnd)
    lower = bm.verts.new((0, 0, -1.4))
    upper = ring(bm, 7, 0.32, -0.8, twist=0.5, jitter=0.08, rnd=rnd)
    band(bm, base, upper, quads=False)
    cap(bm, base, lower, top=False)
    lid(bm, upper)
    return finish(bm, "Crystal_2")


def c_brilliant(rnd):
    """Kiln — a drop-shaped brilliant: table, star crown, long pavilion."""
    bm = bmesh.new()
    n = 8
    table = ring(bm, n, 0.42, 1.0)
    crown = ring(bm, n, 0.8, 0.62, twist=0.5)
    girdle_a = ring(bm, n * 2, 0.92, 0.42)
    girdle_b = ring(bm, n * 2, 0.92, 0.3)
    mid = ring(bm, n, 0.62, -0.45, twist=0.5)
    culet = bm.verts.new((0, 0, -1.55))
    lid(bm, table)
    band(bm, table, crown, quads=False)
    # crown ring (8) → girdle (16): each crown vertex sits over an odd girdle vertex
    def fan(row, ring8):
        for i in range(n):
            j = (i + 1) % n
            g1, g2, g3 = row[2 * i + 1], row[(2 * i + 2) % (2 * n)], row[(2 * i + 3) % (2 * n)]
            bm.faces.new((ring8[i], g1, g2))
            bm.faces.new((ring8[i], g2, ring8[j]))
            bm.faces.new((g2, g3, ring8[j]))

    fan(girdle_a, crown)
    band(bm, girdle_a, girdle_b)
    # pavilion: girdle (16) → mid (8) → culet
    fan(girdle_b, mid)
    cap(bm, mid, culet, top=False)
    return finish(bm, "Crystal_3")


def c_shard(rnd):
    """Northbound — a tall, flattened six-sided blade with a skewed tip and a broken base."""
    bm = bmesh.new()
    n = 6
    lo = ring(bm, n, 0.5, -1.0, squash=0.55)
    m1 = ring(bm, n, 0.6, -0.2, twist=0.5, squash=0.55)
    m2 = ring(bm, n, 0.58, 0.55, squash=0.55)
    hi = ring(bm, n, 0.42, 1.05, twist=0.5, squash=0.55)
    for v, dz in zip(lo, (0.14, -0.08, 0.2, -0.16, 0.06, 0.1)):
        v.co.z += dz  # broken, uneven base
    band(bm, lo, m1, quads=False)
    band(bm, m1, m2, quads=False)
    band(bm, m2, hi, quads=False)
    cap(bm, hi, bm.verts.new((0.2, 0.02, 1.85)))
    cap(bm, lo, bm.verts.new((-0.08, 0.03, -1.45)), top=False)
    return finish(bm, "Crystal_4")


def c_twist(rnd):
    """Glasshouse — a five-sided column twisting as it grows, pointed both ends."""
    bm = bmesh.new()
    n = 5
    rings = []
    zs = [-1.0, -0.45, 0.1, 0.65, 1.1]
    rs = [0.45, 0.72, 0.8, 0.7, 0.42]
    for k, (z, r) in enumerate(zip(zs, rs)):
        rings.append(ring(bm, n, r, z, twist=k * 0.28))
    for a, b in zip(rings, rings[1:]):
        band(bm, a, b, quads=False)
    cap(bm, rings[-1], bm.verts.new((0.04, 0.02, 1.75)))
    cap(bm, rings[0], bm.verts.new((-0.03, 0.0, -1.6)), top=False)
    return finish(bm, "Crystal_5")


def build():
    reset()
    rnd = random.Random(11)
    obs = [f(rnd) for f in (c_quartz, c_spindle, c_cluster, c_brilliant, c_shard, c_twist)]
    for o in obs:
        for p in o.data.polygons:
            p.use_smooth = False
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_normals=False,
        export_texcoords=False,
        export_materials="NONE",
    )
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
    for o in obs:
        print(o.name, len(o.data.polygons), "tris")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "art", "crystals.blend"))
    return obs


def render(obs):
    """Contact sheet: the six side by side in simple dark glass."""
    for i, o in enumerate(obs):
        o.location = ((i - 2.5) * 2.1, 0, 0)
    m = bpy.data.materials.new("Glass")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.75, 0.95, 0.6, 1)
    b.inputs["Roughness"].default_value = 0.05
    b.inputs["Transmission Weight"].default_value = 1.0
    b.inputs["IOR"].default_value = 1.5
    for o in obs:
        o.data.materials.append(m)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.location = (0, -15, 0.6)
    cam.rotation_euler = (math.radians(88), 0, 0)
    cam.data.lens = 50
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    for loc, e in (((-4, -6, 6), 900), ((5, -4, 3), 500), ((0, 6, 4), 700)):
        L = bpy.data.objects.new("L", bpy.data.lights.new("L", "AREA"))
        L.data.energy = e
        L.data.size = 4
        L.location = loc
        L.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.collection.objects.link(L)
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.01, 0.012, 0.012, 1)
    bpy.context.scene.world = w
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.render.resolution_x, sc.render.resolution_y = 1600, 520
    sc.render.filepath = os.path.join(ROOT, "art", "renders", "crystals.png")
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    obs = build()
    if "render" in (sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []):
        render(obs)
