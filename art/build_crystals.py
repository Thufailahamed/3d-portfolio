"""
Six project crystals, one per project, each with a miniature relic floating at its heart:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/build_crystals.py [-- render]

Writes public/models/crystals.glb with Crystal_0 … Crystal_5 (rough-cut gems: a few large,
irregular facets, like a stone split along its cleavage planes) and Core_0 … Core_5 (the
relic inside, drawn as a hologram seen through the glass), in projects[] order.
Every crystal fits the same envelope (≈2.5 tall), every relic a smaller one at its centre.
With `render`, also writes art/renders/crystals.png. Blender Z-up; glTF turns Z into Y.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "models", "crystals.glb")
HEIGHT = 2.5
MAX_R = 1.0
CORE_H = 1.0
CORE_R = 0.46


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def fit(ob, height, radius):
    """Centre on the bounding box and scale into the envelope."""
    vs = [v.co for v in ob.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    c = (lo + hi) / 2
    ob.data.transform(Matrix.Translation(-c))
    h = hi.z - lo.z
    r = max(math.hypot(v.co.x, v.co.y) for v in ob.data.vertices)
    ob.data.transform(Matrix.Scale(min(height / h, radius / r), 4))


def to_object(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = False
    return ob


# ------------------------------------------------------------------ the gems
def gem(name, seed, rx, ry, rz_top, rz_bot, cuts, chips=4, tilt=0.0):
    """A convex stone bounded by `cuts` planes, each resting on a lopsided ellipsoid (taller above
    than below), set at a slightly random depth so the facets come out large and unequal.
    A few shallow chips then knock off corners."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=8.0)
    spin = Euler((rnd.uniform(0, 0.4), rnd.uniform(0, 0.4), rnd.uniform(0, math.tau))).to_matrix()

    def support(d):
        rz = rz_top if d.z > 0 else rz_bot
        return math.sqrt((rx * d.x) ** 2 + (ry * d.y) ** 2 + (rz * d.z) ** 2)

    def slice_(d, depth):
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=d * depth, plane_no=d, clear_outer=True)
        edges = [e for e in bm.edges if e.is_boundary]
        if edges:
            bmesh.ops.holes_fill(bm, edges=edges, sides=0)

    golden = math.pi * (3 - math.sqrt(5))
    for i in range(cuts):
        z = 1 - 2 * (i + 0.5) / cuts
        r = math.sqrt(1 - z * z)
        d = spin @ Vector((math.cos(golden * i) * r, math.sin(golden * i) * r, z))
        d += Vector((rnd.gauss(0, 0.14), rnd.gauss(0, 0.14), rnd.gauss(0, 0.14)))
        d.normalize()
        slice_(d, support(d) * rnd.uniform(0.9, 1.0))
    for _ in range(chips):
        d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1.3))).normalized()
        reach = max(d.dot(v.co) for v in bm.verts)
        slice_(d, reach * rnd.uniform(0.86, 0.94))
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-4)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=list(bm.verts), edges=list(bm.edges))
    if tilt:
        bmesh.ops.rotate(bm, verts=list(bm.verts), cent=(0, 0, 0), matrix=Matrix.Rotation(tilt, 3, "Y"))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    ob = to_object(bm, name)
    fit(ob, HEIGHT, MAX_R)
    return ob


GEMS = [
    # seed  rx    ry    top   bot   cuts chips tilt
    (101, 0.80, 0.66, 1.45, 1.05, 18, 4, 0.06),   # School System — tall, a broken prism
    (202, 0.86, 0.72, 1.20, 1.15, 16, 5, -0.08),  # Legal Workspace — a squat, heavy block
    (303, 0.74, 0.60, 1.50, 1.30, 22, 3, 0.0),    # LUXE — finer cut, pointed both ends
    (404, 0.90, 0.75, 1.15, 1.00, 14, 5, 0.1),    # GoldOS — few, broad faces
    (505, 0.70, 0.58, 1.55, 1.10, 20, 4, -0.05),  # VYRO — a long shard
    (606, 0.82, 0.70, 1.30, 1.25, 17, 4, 0.04),   # HealthHub — an even egg of a stone
]


# ------------------------------------------------------------------ relic parts
def M(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(scale))


def box(bm, loc, size, rot=(0, 0, 0)):
    bmesh.ops.create_cube(bm, size=1.0, matrix=M(loc, rot, size))


def cyl(bm, loc, r, h, segs=16, rot=(0, 0, 0), r2=None):
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h, matrix=M(loc, rot)
    )


def ball(bm, loc, r, sub=1):
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r, matrix=M(loc))


def rod(bm, p, q, r, segs=6):
    p, q = Vector(p), Vector(q)
    d = q - p
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r, depth=d.length, matrix=Matrix.Translation((p + q) / 2) @ rot
    )


def torus(bm, loc, R, r, n=32, m=8, rot=(0, 0, 0)):
    T = M(loc, rot)
    rings = []
    for i in range(n):
        a = i / n * math.tau
        ring = []
        for j in range(m):
            b = j / m * math.tau
            ring.append(bm.verts.new(T @ Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))))
        rings.append(ring)
    for i in range(n):
        for j in range(m):
            a, b = rings[i], rings[(i + 1) % n]
            bm.faces.new((a[j], b[j], b[(j + 1) % m], a[(j + 1) % m]))


def prism(bm, pts, depth, y=0.0):
    """Extrude a polygon drawn in XZ (front view) by `depth` along Y."""
    f = [bm.verts.new((x, y - depth / 2, z)) for x, z in pts]
    b = [bm.verts.new((x, y + depth / 2, z)) for x, z in pts]
    bm.faces.new(f)
    bm.faces.new(list(reversed(b)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((f[j], f[i], b[i], b[j]))


def windows(bm, x0, x1, z0, z1, cols, rows, y, depth=0.012):
    """A grid of window frames standing proud of a wall at y."""
    w = (x1 - x0) / cols
    h = (z1 - z0) / rows
    for c in range(cols):
        for r in range(rows):
            cx, cz = x0 + (c + 0.5) * w, z0 + (r + 0.5) * h
            box(bm, (cx, y, cz), (w * 0.62, depth, h * 0.6))
            box(bm, (cx, y, cz - h * 0.32), (w * 0.8, depth * 1.6, h * 0.06))  # sill


# ------------------------------------------------------------------ the six relics
def r_school():
    """A little campus: a colonnaded main hall, two wings, a clock tower and a flag."""
    bm = bmesh.new()
    box(bm, (0, 0, 0.025), (1.25, 0.62, 0.05))
    for k in range(3):
        box(bm, (0, -0.33 - k * 0.025, 0.012 + k * 0.012), (0.32 - k * 0.03, 0.03, 0.024 + k * 0.024))
    box(bm, (0, 0, 0.21), (0.62, 0.36, 0.32))
    box(bm, (0, 0, 0.385), (0.66, 0.4, 0.03))
    box(bm, (0, 0, 0.43), (0.56, 0.3, 0.06))
    windows(bm, -0.29, 0.29, 0.07, 0.36, 7, 2, -0.18)
    windows(bm, -0.29, 0.29, 0.07, 0.36, 7, 2, 0.18)
    for s in (-1, 1):
        box(bm, (s * 0.47, 0.03, 0.16), (0.3, 0.42, 0.22))
        box(bm, (s * 0.47, 0.03, 0.285), (0.33, 0.45, 0.025))
        windows(bm, s * 0.47 - 0.13, s * 0.47 + 0.13, 0.07, 0.26, 4, 2, -0.18)
        windows(bm, s * 0.47 - 0.13, s * 0.47 + 0.13, 0.07, 0.26, 4, 2, 0.24)
    # portico: six columns, an entablature and a pediment
    for i in range(6):
        x = -0.2 + i * 0.08
        cyl(bm, (x, -0.25, 0.2), 0.017, 0.28, 10)
        box(bm, (x, -0.25, 0.065), (0.04, 0.04, 0.02))
        box(bm, (x, -0.25, 0.345), (0.04, 0.04, 0.015))
    box(bm, (0, -0.25, 0.37), (0.5, 0.06, 0.035))
    prism(bm, [(-0.26, 0.39), (0.26, 0.39), (0, 0.48)], 0.07, y=-0.25)
    # clock tower and spire
    box(bm, (0, 0.02, 0.56), (0.13, 0.13, 0.22))
    box(bm, (0, 0.02, 0.68), (0.16, 0.16, 0.025))
    cyl(bm, (0, -0.052, 0.58), 0.042, 0.012, 20, rot=(math.pi / 2, 0, 0))
    rod(bm, (0, -0.06, 0.58), (0, -0.06, 0.61), 0.004)
    rod(bm, (0, -0.06, 0.58), (0.022, -0.06, 0.58), 0.004)
    for a in range(4):
        x, y = math.cos(a * math.pi / 2 + math.pi / 4) * 0.055, math.sin(a * math.pi / 2 + math.pi / 4) * 0.055
        cyl(bm, (x, 0.02 + y, 0.74), 0.008, 0.1, 6)
    box(bm, (0, 0.02, 0.8), (0.15, 0.15, 0.02))
    cyl(bm, (0, 0.02, 0.9), 0.1, 0.18, 4, rot=(0, 0, math.pi / 4), r2=0.0)
    rod(bm, (0, 0.02, 0.99), (0, 0.02, 1.08), 0.004)
    # flagpole
    rod(bm, (0.5, -0.27, 0.05), (0.5, -0.27, 0.55), 0.006)
    box(bm, (0.545, -0.27, 0.52), (0.09, 0.004, 0.055))
    return bm


def r_legal():
    """Scales of justice standing on a stack of law books."""
    bm = bmesh.new()
    for k, (w, d, h, a) in enumerate(((0.7, 0.48, 0.07, 0.05), (0.64, 0.44, 0.06, -0.12), (0.58, 0.4, 0.065, 0.2))):
        z = 0.035 + sum((0.07, 0.06, 0.065)[:k])
        box(bm, (0, 0, z + 0.0), (w, d, h), rot=(0, 0, a))
        box(bm, (0.012, 0, z), (w * 0.97, d * 1.02, h * 0.72), rot=(0, 0, a))  # page block
        for b in (-1, 1):
            box(bm, (0, 0, z + b * h * 0.3), (w * 1.01, d * 0.3, h * 0.08), rot=(0, 0, a))  # spine bands
    base = 0.195
    cyl(bm, (0, 0, base + 0.02), 0.11, 0.04, 24)
    cyl(bm, (0, 0, base + 0.05), 0.07, 0.03, 24)
    cyl(bm, (0, 0, base + 0.36), 0.025, 0.6, 12)
    for z in (0.12, 0.3, 0.5):
        cyl(bm, (0, 0, base + z), 0.035, 0.018, 16)
    ball(bm, (0, 0, base + 0.7), 0.045, 2)
    cyl(bm, (0, 0, base + 0.77), 0.006, 0.08, 6, r2=0.0)
    top = base + 0.63
    box(bm, (0, 0, top), (0.84, 0.028, 0.028))
    box(bm, (0, 0, top), (0.08, 0.05, 0.06))
    for s in (-1, 1):
        end = Vector((s * 0.42, 0, top))
        ball(bm, end, 0.022, 1)
        pan = Vector((s * 0.42, 0, top - 0.36))
        for i in range(3):
            a = i / 3 * math.tau
            rod(bm, end, pan + Vector((math.cos(a) * 0.11, math.sin(a) * 0.11, 0.02)), 0.004, 4)
        cyl(bm, pan, 0.14, 0.035, 28, r2=0.1)
        torus(bm, pan + Vector((0, 0, 0.02)), 0.14, 0.008, 28, 6)
    return bm


def r_luxe():
    """A solitaire ring: a pavé band, a six-claw head and a brilliant-cut stone."""
    bm = bmesh.new()
    R = 0.3
    torus(bm, (0, 0, 0), R, 0.035, 48, 10, rot=(math.pi / 2, 0, 0))
    torus(bm, (0, 0.03, 0), R, 0.01, 48, 6, rot=(math.pi / 2, 0, 0))
    torus(bm, (0, -0.03, 0), R, 0.01, 48, 6, rot=(math.pi / 2, 0, 0))
    for i in range(15):
        a = math.pi / 2 + (i - 7) * 0.13
        ball(bm, (math.cos(a) * (R + 0.032), 0, math.sin(a) * (R + 0.032)), 0.016, 1)
    # head: basket and claws
    hz = R + 0.06
    torus(bm, (0, 0, hz), 0.08, 0.009, 24, 6)
    torus(bm, (0, 0, hz + 0.07), 0.12, 0.009, 24, 6)
    for i in range(6):
        a = i / 6 * math.tau
        rod(bm, (math.cos(a) * 0.05, math.sin(a) * 0.05, hz - 0.04), (math.cos(a) * 0.135, math.sin(a) * 0.135, hz + 0.16), 0.011, 6)
        ball(bm, (math.cos(a) * 0.135, math.sin(a) * 0.135, hz + 0.16), 0.014, 1)
    # the stone: pavilion, girdle, crown, table
    g = hz + 0.12
    n = 16
    culet = bm.verts.new((0, 0, hz - 0.05))
    gl = [bm.verts.new((math.cos(i / n * math.tau) * 0.15, math.sin(i / n * math.tau) * 0.15, g)) for i in range(n)]
    gh = [bm.verts.new((math.cos(i / n * math.tau) * 0.15, math.sin(i / n * math.tau) * 0.15, g + 0.015)) for i in range(n)]
    cr = [bm.verts.new((math.cos((i + 0.5) / 8 * math.tau) * 0.115, math.sin((i + 0.5) / 8 * math.tau) * 0.115, g + 0.06)) for i in range(8)]
    tb = [bm.verts.new((math.cos(i / 8 * math.tau) * 0.08, math.sin(i / 8 * math.tau) * 0.08, g + 0.085)) for i in range(8)]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((gl[j], gl[i], culet))
        bm.faces.new((gl[i], gl[j], gh[j], gh[i]))
    for i in range(8):
        j = (i + 1) % 8
        a, b, c = gh[2 * i], gh[2 * i + 1], gh[(2 * i + 2) % n]
        bm.faces.new((a, b, cr[i]))
        bm.faces.new((b, c, cr[i]))
        bm.faces.new((c, cr[j], cr[i]))
        bm.faces.new((tb[i], cr[i], tb[j]))
        bm.faces.new((cr[i], cr[j], tb[j]))
    bm.faces.new(tb)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm


def r_gold():
    """A vault door with its locking wheel, and gold bars stacked in front."""
    bm = bmesh.new()
    face = (math.pi / 2, 0, 0)
    cz = 0.5
    cyl(bm, (0, 0.05, cz), 0.44, 0.1, 48, rot=face)
    cyl(bm, (0, 0.0, cz), 0.38, 0.03, 48, rot=face)
    torus(bm, (0, -0.005, cz), 0.41, 0.012, 48, 6, rot=face)
    torus(bm, (0, -0.02, cz), 0.3, 0.01, 40, 6, rot=face)
    for i in range(16):
        a = i / 16 * math.tau
        rod(bm, (math.cos(a) * 0.36, 0.05, cz + math.sin(a) * 0.36), (math.cos(a) * 0.48, 0.05, cz + math.sin(a) * 0.48), 0.018, 8)
        ball(bm, (math.cos(a) * 0.34, -0.018, cz + math.sin(a) * 0.34), 0.012, 1)
    # the wheel
    cyl(bm, (0, -0.06, cz), 0.05, 0.06, 20, rot=face)
    torus(bm, (0, -0.1, cz), 0.17, 0.014, 40, 8, rot=face)
    for i in range(6):
        a = i / 6 * math.tau
        rod(bm, (0, -0.08, cz), (math.cos(a) * 0.17, -0.1, cz + math.sin(a) * 0.17), 0.011, 6)
        ball(bm, (math.cos(a) * 0.2, -0.1, cz + math.sin(a) * 0.2), 0.02, 1)
    # dial and hinges
    cyl(bm, (0.22, -0.035, cz + 0.2), 0.04, 0.02, 24, rot=face)
    for z in (-0.25, 0.25):
        cyl(bm, (-0.45, 0.06, cz + z), 0.035, 0.12, 12)
    # bars: a little pyramid of trapezoid ingots
    def bar(x, y, z, a=0.0):
        cyl(bm, (x, y, z), 0.1, 0.05, 4, rot=(0, 0, math.pi / 4 + a), r2=0.075)
    for k, (x, y, z) in enumerate(((-0.15, -0.2, 0.025), (0.0, -0.2, 0.025), (0.15, -0.2, 0.025), (-0.075, -0.2, 0.075), (0.075, -0.2, 0.075), (0, -0.2, 0.125))):
        bar(x, y, z)
    for v in bm.verts:
        if v.co.y < -0.15 and v.co.z < 0.16:
            v.co.y = -0.2 + (v.co.y + 0.2) * 0.55  # ingots are long and narrow
    return bm


def r_vyro():
    """A stack of corrugated shipping containers and a crane hook above them."""
    bm = bmesh.new()

    def container(x, y, z, a=0.0, L=0.5, W=0.2, H=0.2):
        R = Matrix.Rotation(a, 4, "Z")
        T = Matrix.Translation((x, y, z)) @ R

        def part(loc, size):
            bmesh.ops.create_cube(bm, size=1.0, matrix=T @ M(loc, (0, 0, 0), size))

        part((0, 0, 0), (L, W, H))
        n = 14
        for i in range(n):
            px = -L / 2 + (i + 0.5) * L / n
            for s in (-1, 1):
                part((px, s * W / 2, 0), (L / n * 0.45, 0.012, H * 0.86))
        for s in (-1, 1):
            for t in (-1, 1):
                part((s * L / 2, t * W / 2, 0), (0.02, 0.02, H * 1.02))  # corner posts
            part((0, s * W / 2, H / 2), (L, 0.02, 0.018))
            part((0, s * W / 2, -H / 2), (L, 0.02, 0.018))
        for t in (-0.25, 0.25):  # door bars
            part((L / 2 + 0.006, t * W, 0), (0.008, 0.008, H * 0.9))

    container(-0.14, -0.08, 0.1, 0.0)
    container(0.26, 0.1, 0.1, 0.0)
    container(0.05, 0.02, 0.3, 0.12)
    container(-0.26, 0.16, 0.1, 0.0)
    container(-0.08, 0.14, 0.5, -0.2)
    # hook and cables
    rod(bm, (-0.05, 0.12, 0.62), (-0.05, 0.12, 1.0), 0.006)
    rod(bm, (-0.2, 0.12, 0.62), (-0.05, 0.12, 0.72), 0.004)
    rod(bm, (0.1, 0.12, 0.62), (-0.05, 0.12, 0.72), 0.004)
    box(bm, (-0.05, 0.12, 0.74), (0.06, 0.04, 0.05))
    return bm


def r_health():
    """A DNA double helix with its base pairs, wrapped by a heartbeat ring."""
    bm = bmesh.new()
    turns, n, R, H = 2.2, 88, 0.2, 0.95
    pts = [[], []]
    for i in range(n + 1):
        t = i / n
        a = t * turns * math.tau
        for s in (0, 1):
            pts[s].append(Vector((math.cos(a + s * math.pi * 0.8) * R, math.sin(a + s * math.pi * 0.8) * R, t * H)))
    for s in (0, 1):
        for p, q in zip(pts[s], pts[s][1:]):
            rod(bm, p, q, 0.022, 8)
        for i in range(0, n + 1, 4):
            ball(bm, pts[s][i], 0.032, 1)
    for i in range(2, n - 1, 4):
        p, q = pts[0][i], pts[1][i]
        mid = (p + q) / 2
        rod(bm, p, mid, 0.011, 6)
        rod(bm, mid, q, 0.011, 6)
        ball(bm, mid, 0.016, 1)
    # a pulse line around the waist
    m = 120
    ring = []
    for i in range(m):
        a = i / m * math.tau
        beat = 0.0
        u = (i % 40) / 40
        if 0.4 < u < 0.6:
            beat = math.sin((u - 0.4) / 0.2 * math.tau) * 0.07 * (1 if u < 0.5 else 0.6)
        ring.append(Vector((math.cos(a) * 0.36, math.sin(a) * 0.36, H / 2 + beat)))
    for i in range(m):
        rod(bm, ring[i], ring[(i + 1) % m], 0.008, 5)
    return bm


RELICS = [r_school, r_legal, r_luxe, r_gold, r_vyro, r_health]


def build():
    reset()
    obs = []
    for i, (seed, rx, ry, top, bot, cuts, chips, tilt) in enumerate(GEMS):
        obs.append(gem(f"Crystal_{i}", seed, rx, ry, top, bot, cuts, chips, tilt))
    cores = []
    for i, f in enumerate(RELICS):
        ob = to_object(f(), f"Core_{i}")
        fit(ob, CORE_H, CORE_R)
        cores.append(ob)
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs + cores:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_normals=False,
        export_texcoords=False,
        export_materials="NONE",
        export_draco_mesh_compression_enable=True,
        export_draco_position_quantization=16,
    )
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
    for o in obs + cores:
        print(o.name, len(o.data.polygons), "faces")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "art", "crystals.blend"))
    return obs, cores


def render(obs, cores):
    """Contact sheet: the six in dark smoked glass, each relic glowing inside, on a black mirror."""
    tints = [(0.78, 1.0, 0.24), (0.91, 0.76, 0.48), (0.82, 0.55, 1.0), (1.0, 0.7, 0.28), (0.48, 0.66, 1.0), (0.44, 0.94, 0.78)]
    glass = bpy.data.materials.new("Smoke")
    glass.use_nodes = True
    b = glass.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.85, 0.88, 0.92, 1)
    b.inputs["Roughness"].default_value = 0.03
    b.inputs["Transmission Weight"].default_value = 1.0
    b.inputs["IOR"].default_value = 1.54
    vol = glass.node_tree.nodes.new("ShaderNodeVolumeAbsorption")
    vol.inputs["Color"].default_value = (0.5, 0.52, 0.56, 1)
    vol.inputs["Density"].default_value = 1.6
    glass.node_tree.links.new(vol.outputs["Volume"], glass.node_tree.nodes["Material Output"].inputs["Volume"])
    for i, (o, c) in enumerate(zip(obs, cores)):
        x = (i - 2.5) * 2.3
        o.location = (x, 0, 1.4)
        c.location = (x, 0, 1.4)
        o.data.materials.append(glass)
        e = bpy.data.materials.new(f"Holo{i}")
        e.use_nodes = True
        nt = e.node_tree
        nt.nodes.clear()
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (*tints[i], 1)
        em.inputs["Strength"].default_value = 6
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(em.outputs[0], out.inputs[0])
        c.data.materials.append(e)
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    floor = bpy.context.object
    fm = bpy.data.materials.new("Floor")
    fm.use_nodes = True
    fb = fm.node_tree.nodes["Principled BSDF"]
    fb.inputs["Base Color"].default_value = (0.005, 0.005, 0.006, 1)
    fb.inputs["Roughness"].default_value = 0.15
    floor.data.materials.append(fm)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.location = (0, -15, 1.9)
    cam.rotation_euler = (math.radians(88), 0, 0)
    cam.data.lens = 36
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    for loc, e in (((-6, -5, 6), 500), ((7, -3, 3), 250), ((0, 6, 5), 600)):
        L = bpy.data.objects.new("L", bpy.data.lights.new("L", "AREA"))
        L.data.energy = e
        L.data.size = 5
        L.location = loc
        L.rotation_euler = (Vector((0, 0, 1)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.collection.objects.link(L)
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.005, 0.006, 1)
    bpy.context.scene.world = w
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 96
    sc.cycles.max_bounces = 16
    sc.cycles.transmission_bounces = 16
    sc.view_settings.view_transform = "AgX"
    sc.render.resolution_x, sc.render.resolution_y = 1800, 560
    sc.render.filepath = os.path.join(ROOT, "art", "renders", "crystals.png")
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    obs, cores = build()
    if "render" in (sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []):
        render(obs, cores)
