"""
W Motors Lykan HyperSport, built from code as an exploded-view model:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/build_lykan.py [-- render [quick]]

Writes public/models/lykan.glb. Every clickable part is a top-level empty named `Part_<id>`
(Part_body, Part_door_left, Part_engine, Part_wheel_fl …) whose children are the meshes for that
part. Each empty carries glTF extras: `part` (its id) and `explode` (the direction it slides
out, in glTF Y-up metres) so the page can pull it out and look up its details.
With `render`, also writes art/renders/lykan_*.png. Blender Z-up, car faces +X, +Y is its left.

Real dimensions: 4.480 m long, 1.944 m wide, 1.170 m tall, 2.625 m wheelbase.
"""

import bisect
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lykan_kit import *  # noqa: E402,F401,F403
from lykan_cabin import interior  # noqa: E402
from lykan_chassis import chassis, suspension, wheel  # noqa: E402
from lykan_engine import cooling, engine, exhaust, frunk, transmission, turbos  # noqa: E402
from lykan_textures import upgrade  # noqa: E402


# ================================================================== the body
# Stations front (+X) to rear; each holds a 10-point half section from the floor centre (P0)
# round the right flank to the roof centre (P9). Bands between points: 0 floor, 1–2 sill,
# 3–4 flank, 5 shoulder top / fender crown, 6 greenhouse side, 7–8 roof / hood / deck.
STATIONS = [2.25, 2.20, 2.10, 1.95, 1.75, 1.55, 1.35, 1.15, 0.95, 0.80, 0.60, 0.40, 0.20, 0.00,
            -0.20, -0.40, -0.58, -0.80, -1.00, -1.20, -1.40, -1.60, -1.80, -1.98, -2.12, -2.22]

W = spline([(2.25, 0.60), (2.20, 0.76), (2.10, 0.85), (1.95, 0.915), (1.75, 0.95), (1.55, 0.965),
            (1.35, 0.972), (1.15, 0.968), (0.95, 0.952), (0.80, 0.938), (0.40, 0.918), (0.0, 0.915),
            (-0.40, 0.928), (-0.80, 0.955), (-1.10, 0.972), (-1.40, 0.972), (-1.70, 0.962),
            (-1.98, 0.935), (-2.12, 0.895), (-2.22, 0.85)])
Z5 = spline([(2.25, 0.36), (2.20, 0.42), (2.10, 0.51), (1.95, 0.59), (1.75, 0.655), (1.5, 0.69),
             (1.25, 0.70), (1.0, 0.685), (0.8, 0.67), (0.4, 0.665), (0.0, 0.675), (-0.4, 0.705),
             (-0.8, 0.765), (-1.1, 0.805), (-1.4, 0.825), (-1.7, 0.835), (-1.98, 0.84), (-2.12, 0.845),
             (-2.22, 0.84)])
Z6 = spline([(2.25, 0.39), (2.20, 0.46), (2.10, 0.555), (1.95, 0.635), (1.75, 0.70), (1.5, 0.74),
             (1.25, 0.758), (1.0, 0.75), (0.8, 0.735), (0.4, 0.725), (0.0, 0.735), (-0.4, 0.765),
             (-0.58, 0.80), (-0.8, 0.86), (-1.1, 0.918), (-1.4, 0.928), (-1.7, 0.918), (-1.98, 0.906),
             (-2.12, 0.90), (-2.22, 0.885)])
INSET6 = spline([(2.25, 0.08), (1.95, 0.13), (1.25, 0.17), (0.8, 0.19), (0.0, 0.22), (-0.58, 0.225),
                 (-1.1, 0.22), (-1.4, 0.24), (-1.98, 0.25), (-2.22, 0.24)])
ZC = spline([(2.25, 0.385), (2.20, 0.44), (2.10, 0.51), (1.95, 0.565), (1.75, 0.61), (1.5, 0.65),
             (1.25, 0.675), (1.0, 0.70), (0.80, 0.735), (0.60, 0.82), (0.40, 0.91), (0.20, 1.0),
             (0.0, 1.08), (-0.20, 1.135), (-0.40, 1.158), (-0.58, 1.15), (-0.80, 1.115),
             (-1.0, 1.065), (-1.2, 1.015), (-1.4, 0.975), (-1.6, 0.94), (-1.8, 0.915), (-1.98, 0.912),
             (-2.12, 0.93), (-2.22, 0.935)])
YG = spline([(2.25, 0.40), (2.10, 0.50), (1.95, 0.53), (1.5, 0.55), (1.0, 0.575), (0.80, 0.62),
             (0.4, 0.605), (0.0, 0.575), (-0.4, 0.545), (-0.58, 0.535), (-1.0, 0.50), (-1.6, 0.46),
             (-1.98, 0.50), (-2.22, 0.52)])
DROP7 = spline([(2.25, 0.0), (1.95, -0.03), (1.5, -0.04), (1.0, -0.025), (0.8, 0.0), (0.6, 0.03),
                (0.0, 0.05), (-0.58, 0.05), (-1.0, 0.04), (-1.6, 0.02), (-1.98, 0.0), (-2.22, 0.0)])
SCOOP = spline([(0.62, 0.0), (0.2, 0.02), (-0.3, 0.05), (-0.62, 0.06), (-0.9, 0.04), (-1.08, 0.0)])
NOSE = spline([(1.5, 0.0), (1.95, 0.05), (2.25, 0.14)])
FANG = spline([(1.7, 0.0), (2.0, 0.04), (2.25, 0.11)])       # fender tips pushed ahead of the hood
TAILFIN = spline([(-1.9, 0.0), (-2.12, 0.04), (-2.22, 0.09)])  # rear haunch tips past the tail
VALLEY = spline([(0.82, 0.0), (1.0, 0.03), (1.6, 0.045), (2.1, 0.035), (2.25, 0.0)])
SPINE = spline([(0.9, 0.52), (1.5, 0.42), (2.2, 0.30)])       # valley position as a share of yg
ZF = spline([(2.25, 0.115), (1.9, 0.12), (1.5, 0.13), (-1.9, 0.13), (-2.22, 0.15)])


def section(x):
    w = W(x)
    zf = ZF(x)
    z5, z6, zc = Z5(x), Z6(x), ZC(x)
    zsill = zf + 0.15
    yg = YG(x)
    z7 = zc - DROP7(x)
    return [
        (0.0, zf),
        (w - 0.13, zf),
        (w - 0.035, zf + 0.045),
        (w - 0.008, zsill),
        (w - SCOOP(x), (zsill + z5) * 0.5),
        (w - 0.035, z5),
        (w - INSET6(x), z6),
        (yg, z7),
        (yg * SPINE(x), zc - DROP7(x) * 0.25 - VALLEY(x)),
        (0.0, zc),
    ]


def ctrl(x, j, half=None):
    """Control point j (0..9) of station x with the plan-view offsets applied, right side (+Y)."""
    half = half or section(x)
    y, z = half[j]
    dx = NOSE(x) * max(0.0, 1 - (y / W(x)) ** 2)
    if j in (5, 6):
        dx += FANG(x) - TAILFIN(x)
    if j == 4:
        dx += 0.6 * FANG(x) - 0.6 * TAILFIN(x)
    if j == 7:
        dx += 0.4 * FANG(x)
    return (x + dx, y, z)


def body_region(xm, j):
    if j == 0:
        return "floor"
    if j in (1, 2):
        return "carbon"
    door = 0.80 > xm > -0.58
    if door and 3 <= j <= 5:
        return "door"
    if door and j == 6:
        return "door_glass"
    if j == 6 and -0.58 > xm > -0.95:
        return "quarter_glass"
    if j >= 7:
        if 0.80 > xm > 0.0:
            return "windshield"
        if 0.0 > xm > -0.58:
            return "roof"
        if -0.58 > xm > -1.60:
            return "engine_cover"
        if 1.95 > xm > 0.95:
            return "hood"
    if j == 5 and 2.15 > xm > 1.55:
        return "headlight"
    return "paint"


REGIONS = ["paint", "carbon", "floor", "door", "door_glass", "windshield", "roof", "engine_cover",
           "hood", "headlight", "fascia", "tail", "well", "intake", "doorscoop", "quarter_glass"]


def shell():
    bm = bmesh.new()
    rings = []
    for x in STATIONS:
        half = section(x)
        right = [ctrl(x, j, half) for j in range(10)]
        loop = right + [(px, -py, pz) for px, py, pz in reversed(right[1:-1])]
        rings.append([bm.verts.new(p) for p in loop])
    n = len(rings[0])  # 18
    ri = {r: i for i, r in enumerate(REGIONS)}
    crease = bm.edges.layers.float.new("crease_edge")
    for i in range(len(rings) - 1):
        xm = (STATIONS[i] + STATIONS[i + 1]) / 2
        A, B = rings[i], rings[i + 1]
        for k in range(n):
            j = k if k < 9 else 17 - k
            f = bm.faces.new((A[k], B[k], B[(k + 1) % n], A[(k + 1) % n]))
            f.material_index = ri[body_region(xm, j)]
    # nose and tail caps, each pulled in on a short extra ring so the ends come out rounded
    for ring, dx, s, reg in ((rings[0], 0.022, 0.88, "fascia"), (rings[-1], 0.05, 0.86, "tail")):
        cz = sum(v.co.z for v in ring) / n
        inner = [bm.verts.new((v.co.x + dx, v.co.y * s, cz + (v.co.z - cz) * s)) for v in ring]
        for k in range(n):
            f = bm.faces.new((ring[k], ring[(k + 1) % n], inner[(k + 1) % n], inner[k]))
            f.material_index = ri[reg]
        f = bm.faces.new(inner)
        f.material_index = ri[reg]
    bm.edges.ensure_lookup_table()
    # character lines: rocker, shoulder, fender crown, greenhouse edge
    for ring, c in ((rings[0], 0.5), (rings[-1], 0.9)):
        for k in range(n):
            e = bm.edges.get((ring[k], ring[(k + 1) % n]))
            if e:
                e[crease] = c
    sharp = {3: 0.9, 5: 0.9, 6: 0.6, 7: 0.7}
    for i in range(len(rings) - 1):
        xm = (STATIONS[i] + STATIONS[i + 1]) / 2
        for j, c in sharp.items():
            for k in (j, (n - j) % n):
                e = bm.edges.get((rings[i][k], rings[i + 1][k]))
                if e:
                    e[crease] = c
        if 0.95 < xm < 2.2:          # hood spine and valleys
            for k, c in ((9, 0.95), (8, 0.5), (10, 0.5)):
                e = bm.edges.get((rings[i][k], rings[i + 1][k]))
                if e:
                    e[crease] = c
    finish(bm)
    me = bpy.data.meshes.new("Shell")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Shell", me)
    bpy.context.scene.collection.objects.link(ob)
    for r in REGIONS:
        me.materials.append(bpy.data.materials.new("R_" + r))
    return ob


def cutters():
    col = bpy.data.collections.new("Cutters")
    bpy.context.scene.collection.children.link(col)
    obs = []

    def add(bm, reg, name):
        finish(bm)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(name, me)
        col.objects.link(o)
        me.materials.append(bpy.data.materials["R_" + reg])
        obs.append(o)

    for ax, tr, R in ((AXLE_F, TRACK_F, 0.365), (AXLE_R, TRACK_R, 0.39)):
        zc = TYRE_F["R"] if ax > 0 else TYRE_R["R"]
        for s in (1, -1):
            bm = bmesh.new()
            y0 = 0.64 if ax > 0 else 0.6
            cyl(bm, (ax, s * (y0 + 0.4), zc + 0.01), R, 0.8, segs=64, rot=(math.pi / 2, 0, 0))
            add(bm, "well", f"Arch_{ax}_{s}")
    # front corners: a tall intake under each lamp, leaving a thin blade of fender outboard
    for sd in (1, -1):
        bm = bmesh.new()
        poly = [(sd * 0.36, 0.15), (sd * 0.83, 0.15), (sd * 0.80, 0.46), (sd * 0.62, 0.50), (sd * 0.36, 0.36)]
        if sd < 0:
            poly.reverse()
        prism(bm, poly, "x", 1.82, 2.6)
        add(bm, "intake", f"IntakeF_{sd}")
    bm = bmesh.new()
    prism(bm, [(-0.29, 0.15), (0.29, 0.15), (0.25, 0.29), (-0.25, 0.29)], "x", 2.08, 2.6)
    add(bm, "intake", "IntakeC")
    # the door scoop: a wedge that bites deeper toward the rear, then the tall rear-wheel intake
    for sd in (1, -1):
        bm = bmesh.new()
        tri = [(0.74, 0.30), (-0.60, 0.30), (-0.60, 0.71)]
        outer = [bm.verts.new((x, sd * 1.4, z)) for x, z in tri]
        depth = [0.0, 0.17, 0.17]
        inner = [bm.verts.new((x, sd * (W(x) - d), z)) for (x, z), d in zip(tri, depth)]
        bm.faces.new(outer)
        bm.faces.new(list(reversed(inner)))
        for k in range(3):
            bm.faces.new((inner[k], inner[(k + 1) % 3], outer[(k + 1) % 3], outer[k]))
        add(bm, "doorscoop", f"DoorScoop_{sd}")
        bm = bmesh.new()
        poly = [(-0.58, 0.24), (-0.95, 0.24), (-0.99, 0.77), (-0.58, 0.73)]
        prism(bm, poly, "y", sd * (W(-0.8) - 0.30), sd * 1.4)
        add(bm, "intake", f"RearIntake_{sd}")
    # rear: diffuser tunnel and the open mesh tail
    bm = bmesh.new()
    prism(bm, [(-0.78, 0.10), (0.78, 0.10), (0.70, 0.30), (-0.70, 0.30)], "x", -2.6, -1.98)
    add(bm, "intake", "Diffuser")
    bm = bmesh.new()
    prism(bm, [(-0.80, 0.34), (0.80, 0.34), (0.84, 0.81), (-0.84, 0.81)], "x", -2.6, -2.05)
    add(bm, "intake", "TailMesh")
    col.hide_render = True
    col.hide_viewport = True
    return col


def roll_edges(bm, inset=0.0035, sink=0.004):
    """Turn a panel's open border down and in so neighbouring panels read with a shut line."""
    bm.normal_update()
    moves = {}
    for v in bm.verts:
        if not v.is_boundary:
            continue
        inner = [e.other_vert(v) for e in v.link_edges if not e.other_vert(v).is_boundary]
        n = v.normal.copy()
        if inner:
            d = sum((u.co - v.co for u in inner), Vector()) / len(inner)
            d = (d - n * d.dot(n))
            if d.length > 1e-6:
                d.normalize()
        else:
            d = Vector()
        moves[v] = d * inset - n * sink
    for v, d in moves.items():
        v.co += d


def split_shell(src):
    """Evaluate subdivision and booleans, then break the skin into panels by region."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(src.evaluated_get(dg), depsgraph=dg)
    names = [m.name[2:] if m else "paint" for m in me.materials]
    full = bmesh.new()
    full.from_mesh(me)
    bpy.data.meshes.remove(me)
    full.faces.ensure_lookup_table()
    groups = {}
    for f in full.faces:
        reg = names[f.material_index] if f.material_index < len(names) else "paint"
        if reg == "doorscoop":
            reg = "door" if f.calc_center_median().x > -0.58 else "paint"
        key = reg
        if reg in ("door", "door_glass", "headlight", "quarter_glass"):
            key = reg + ("_L" if f.calc_center_median().y > 0 else "_R")
        groups.setdefault(key, []).append(f.index)
    out = {}
    for key, idx in groups.items():
        bm = full.copy()
        bm.faces.ensure_lookup_table()
        keep = set(idx)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
        for f in bm.faces:
            f.material_index = 0
        out[key] = bm
    full.free()
    return out


def body_parts():
    src = shell()
    sub = src.modifiers.new("Sub", "SUBSURF")
    sub.levels = sub.render_levels = 3
    col = cutters()
    boo = src.modifiers.new("Cut", "BOOLEAN")
    boo.operation = "DIFFERENCE"
    boo.operand_type = "COLLECTION"
    boo.collection = col
    boo.solver = "EXACT"
    boo.material_mode = "TRANSFER"
    pieces = split_shell(src)
    bpy.data.objects.remove(src)
    for o in list(col.objects):
        bpy.data.objects.remove(o)
    bpy.data.collections.remove(col)

    look = {
        "paint": "Paint", "roof": "Paint", "fascia": "Paint", "tail": "Paint", "door": "Paint",
        "hood": "Paint", "carbon": "Carbon", "floor": "Underbody", "well": "WellLiner",
        "intake": "Mesh", "door_glass": "Glass", "quarter_glass": "Glass", "windshield": "Glass", "engine_cover": "Glass",
        "headlight": "DarkChrome",
    }
    pb = part("body", (0, 0, 1.3))
    # reverse-dihedral doors: hinged at the rear, they swing up and forward of the cabin
    pdl = part("door_left", (-0.2, 0.4, 0.95))
    pdr = part("door_right", (-0.2, -0.4, 0.95))
    ph = part("hood", (0.5, 0, 0.7))
    pe = part("engine_cover", (-0.3, 0, 0.9))
    owner = {"door_L": pdl, "door_glass_L": pdl, "door_R": pdr, "door_glass_R": pdr, "hood": ph,
             "engine_cover": pe}
    panels = {"door_L", "door_R", "hood", "engine_cover"}
    built = {}
    for key, bm in pieces.items():
        reg = key[:-2] if key.endswith(("_L", "_R")) else key
        if key in panels:
            roll_edges(bm, 0.004, 0.006)
        elif reg in ("door_glass", "windshield", "quarter_glass"):
            roll_edges(bm, 0.002, 0.003)
        ob = new_object("Body_" + key, bm, look[reg], sharp=50)
        thick = {"Glass": 0.006, "Mesh": 0.0, "WellLiner": 0.0, "DarkChrome": 0.0}.get(look[reg], 0.012)
        if thick:
            so = ob.modifiers.new("Solid", "SOLIDIFY")
            so.thickness = thick
            so.offset = -1
            so.use_rim = True
            if look[reg] in ("Paint", "Carbon"):
                ob.data.materials.append(MATS["Underbody"])
                so.material_offset = 1
                so.material_offset_rim = 1
            bake(ob)
            shade(ob, 50)
            if look[reg] == "Carbon":
                box_uv(ob.data, 25.0)
        child(ob, owner.get(key, pb))
        built[key] = ob
    return built


# ================================================================== lights, trim, aero
def lights(body):
    ph = part("headlights", (0.6, 0, 0.25))
    pt = part("taillights", (-0.6, 0, 0.2))
    for s, key in ((1, "headlight_L"), (-1, "headlight_R")):
        hous = body.get(key)
        if hous is None:
            continue
        # sink the housing so the lens can sit flush over it
        me = hous.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.normal_update()
        lens_bm = bm.copy()
        for v in bm.verts:
            v.co -= v.normal * 0.014
        bm.to_mesh(me)
        bm.free()
        child(hous, ph)
        for v in lens_bm.verts:
            v.co += v.normal * 0.0015
        child(new_object(f"HeadLens_{s}", lens_bm, "GlassClear", sharp=60), ph)
        # LED blade, DRL line and the diamond studs, following the lamp channel
        pts, ups = [], []
        for i in range(25):
            x = 1.6 + (2.14 - 1.6) * i / 24
            a, b = Vector(ctrl(x, 5)), Vector(ctrl(x, 6))
            m = (a + b) / 2
            d = Vector((0, s * 0.55, 0.85)).normalized()
            co, n = hit(Vector((m.x, s * m.y, m.z)) + d * 0.5, -d)
            if co is None:
                continue
            pts.append(co - n * 0.008)
            ups.append(n)
        if len(pts) > 3:
            bm = bmesh.new()
            sweep(bm, pts, [(-0.006, -0.002), (0.006, -0.002), (0.006, 0.002), (-0.006, 0.002)], ups)
            child(new_object(f"LED_{s}", bm, "LED", sharp=60), ph)
            bm = bmesh.new()
            sweep(bm, [p + n.cross(Vector((1, 0, 0))).normalized() * 0.014 * s for p, n in zip(pts, ups)],
                  [(-0.002, -0.001), (0.002, -0.001), (0.002, 0.001), (-0.002, 0.001)], ups)
            child(new_object(f"DRL_{s}", bm, "LEDAmber", sharp=60), ph)
            bm = bmesh.new()
            for k in range(3, len(pts) - 2, 2):
                p, n = pts[k], ups[k]
                ball(bm, p + n * 0.004, 0.0055, sub=1)
            child(new_object(f"Diamonds_{s}", bm, "Diamond", smooth=False), ph)
            bm = bmesh.new()
            for k in (6, 12, 18):
                if k < len(pts):
                    p, n = pts[k], ups[k]
                    cyl(bm, p - n * 0.002, 0.016, 0.01, segs=24,
                        rot=n.to_track_quat("Z", "Y").to_euler())
            child(new_object(f"Projector_{s}", bm, "Chrome", sharp=40), ph)

    # tail: angular chrome frames carrying the LED blades, framing the open mesh
    back = [(-1, 0, 0)]
    for sd in (1, -1):
        path = [(-2.16, sd * y, z) for y, z in ((0.26, 0.79), (0.81, 0.79), (0.77, 0.40), (0.50, 0.365), (0.42, 0.50))]
        bm = bmesh.new()
        sweep(bm, path, [(-0.017, 0.0), (0.017, 0.0), (0.017, 0.055), (-0.017, 0.055)], back * len(path))
        child(new_object(f"TailFrame_{sd}", finish(bm), "Chrome", sharp=30), pt)
        bm = bmesh.new()
        sweep(bm, path[:3], [(-0.006, 0.055), (0.006, 0.055), (0.006, 0.058), (-0.006, 0.058)], back * 3)
        child(new_object(f"TailLED_{sd}", finish(bm), "TailLED", sharp=30), pt)
    bm = bmesh.new()
    sweep(bm, [(-2.2, -0.2, 0.825), (-2.2, 0.2, 0.825)], [(-0.006, 0), (0.006, 0), (0.006, 0.01), (-0.006, 0.01)],
          back * 2)
    child(new_object("ThirdLight", finish(bm), "TailLED", sharp=30), pt)


def trim(body):
    pb = PARTS["body"]
    pa = part("aero", (0, 0, 0.6))
    # front splitter following the nose plan
    def splitter(bm):
        front = []
        for i in range(25):
            yy = -0.58 + 1.16 * i / 24
            front.append((2.25 + NOSE(2.25) * max(0.0, 1 - (yy / 0.6) ** 2) + 0.035, yy))
        left = [(x + 0.01, W(x) - 0.02) for x in (2.22, 2.15, 2.05, 1.95, 1.85)]
        right = [(x, -y) for x, y in reversed(left)]
        prism(bm, front + left + [(1.75, W(1.85) - 0.04), (1.75, -(W(1.85) - 0.04))] + right, "z", 0.098, 0.112)
    child(new_object("Splitter", finish_fn(splitter), "Carbon", sharp=30), pa)
    # splitter end plates and canards
    for s in (1, -1):
        bm = bmesh.new()
        for k, (x, z) in enumerate(((2.02, 0.25), (1.96, 0.33))):
            tmp = bmesh.new()
            rbox(tmp, (0, 0, 0), (0.11, 0.07, 0.005), bevel=0.002)
            tmp.transform(M((x, s * 0.86, z), (s * 0.15, -0.12, s * 0.45)))
            me = bpy.data.meshes.new("t")
            tmp.to_mesh(me)
            tmp.free()
            bm.from_mesh(me)
            bpy.data.meshes.remove(me)
        child(new_object(f"Canards_{s}", bm, "Carbon", sharp=30), pa)
    # side blades
    for s in (1, -1):
        bm = bmesh.new()
        pts = [(x, s * (W(x) - 0.06), 0.14) for x in [0.78 - 0.08 * i for i in range(21)]]
        sweep(bm, pts, [(0.0, -0.008), (s * 0.075, -0.008), (s * 0.075, 0.0), (0.0, 0.016)])
        child(new_object(f"SideBlade_{s}", finish(bm), "Carbon", sharp=30), pa)
    # rear diffuser strakes in the tunnel
    bm = bmesh.new()
    for yy in (-0.6, -0.36, -0.12, 0.12, 0.36, 0.6):
        prism(bm, [(-2.16, 0.10), (-1.98, 0.10), (-1.98, 0.12), (-2.14, 0.29)], "y", yy - 0.004, yy + 0.004)
    child(new_object("DiffuserStrakes", finish(bm), "Carbon", sharp=30), pa)
    bm = bmesh.new()
    prism(bm, [(-0.78, 0.09), (0.78, 0.09), (0.78, 0.102), (-0.78, 0.102)], "x", -2.16, -1.6)
    child(new_object("DiffuserFloor", finish(bm), "Carbon", sharp=30), pa)
    # mirrors on the doors
    for s, pid in ((1, "door_left"), (-1, "door_right")):
        pe = PARTS[pid]
        bm = bmesh.new()
        ball(bm, (0, 0, 0), 0.07, sub=3, scale=(1.25, 0.55, 0.55))
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x < -0.075], context="VERTS")
        bm.transform(M((0.47, s * 1.0, 0.845), (0, 0, s * 0.12)))
        child(new_object(f"Mirror_{s}", finish(bm), "Paint", sharp=60), pe)
        bm = bmesh.new()
        cyl(bm, (0, 0, 0), 0.034, 0.004, segs=32, rot=(0, math.pi / 2, 0))
        bm.transform(M((0.385, s * 0.99, 0.845), (0, 0, s * 0.12), (1, 1.7, 1)))
        child(new_object(f"MirrorGlass_{s}", bm, "Chrome", sharp=40), pe)
        bm = bmesh.new()
        sweep(bm, catmull([(0.56, s * 0.80, 0.765), (0.53, s * 0.88, 0.80), (0.49, s * 0.96, 0.835)], 6),
              [(-0.022, -0.006), (0.022, -0.006), (0.018, 0.006), (-0.018, 0.006)])
        child(new_object(f"MirrorArm_{s}", finish(bm), "Carbon", sharp=40), pe)
    # honeycomb screens in every opening
    for sd in (1, -1):
        honey_plane(f"GrilleF_{sd}", [(1.87, sd * 0.37, 0.155), (1.87, sd * 0.82, 0.155), (1.87, sd * 0.79, 0.455),
                                     (1.87, sd * 0.37, 0.355)][:: sd], pa)
        y = sd * (W(-0.8) - 0.28)
        honey_plane(f"GrilleSide_{sd}", [(-0.59, y, 0.25), (-0.94, y, 0.25), (-0.98, y, 0.76), (-0.59, y, 0.72)][:: sd],
                    pa)
        bm = bmesh.new()
        rbox(bm, (0, 0, 0), (0.30, 0.42, 0.012), bevel=0.004)
        bm.transform(M((2.0, sd * 0.59, 0.31), (0, 0, -sd * 0.08)))
        child(new_object(f"IntakeBlade_{sd}", bm, "Chrome", sharp=30), pa)
    honey_plane("GrilleC", [(2.1, 0.28, 0.155), (2.1, -0.28, 0.155), (2.1, -0.24, 0.285), (2.1, 0.24, 0.285)], pa)
    honey_plane("GrilleRear", [(-2.09, 0.80, 0.345), (-2.09, -0.80, 0.345), (-2.09, -0.83, 0.80), (-2.09, 0.83, 0.80)],
                pa)
    piece("TailPanel", rb((-2.15, 0, 0.58), (0.03, 0.46, 0.15), bevel=0.01), "Carbon", pa)
    child(text_mesh("L Y K A N", 0.05, (-2.167, 0.0, 0.60), (math.pi / 2, 0, -math.pi / 2), "Chrome", 0.002,
                    "BadgeRear"), pa)
    child(text_mesh("H Y P E R S P O R T", 0.022, (-2.167, 0.0, 0.545), (math.pi / 2, 0, -math.pi / 2), "Chrome",
                    0.0015, "BadgeRear2"), pa)
    co, n = hit((-3.0, 0.0, 0.86), (1, 0, 0))
    if co is not None:
        child(text_mesh("W", 0.05, co + Vector((-0.003, 0, 0)), (math.pi / 2, 0, -math.pi / 2), "Chrome", 0.003,
                        "BadgeTail"), pb)
    co, n = hit((3.0, 0.0, 0.33), (-1, 0, 0))
    if co is not None:
        t = text_mesh("W", 0.07, co + Vector((0.004, 0, 0)), (math.pi / 2, 0, math.pi / 2), "Chrome", 0.004,
                      "BadgeFront")
        child(t, pb)
    # the bright blade along each lower door
    for sd, pid in ((1, "door_left"), (-1, "door_right")):
        pts, ups = [], []
        for i in range(21):
            x = 0.70 - 1.26 * i / 20
            z = 0.305 + 0.055 * i / 20
            co, n = hit((x, sd * 2.0, z), (0, -sd, 0))
            if co is not None:
                pts.append(co + n * 0.002)
                ups.append(n)
        bm = bmesh.new()
        sweep(bm, pts, [(-0.009, 0.0), (0.009, 0.0), (0.006, 0.008), (-0.006, 0.008)], ups)
        child(new_object(f"DoorBlade_{sd}", finish(bm), "Chrome", sharp=40), PARTS[pid])
    # engine cover: chevron louvers pointing forward, astride a body-colour spine
    bm = bmesh.new()
    for k in range(8):
        x0 = -0.72 - k * 0.11
        pts = []
        for j in range(17):
            yy = (j / 16 * 2 - 1) * 0.38
            x = x0 - 0.16 * abs(yy) / 0.38
            co, n = hit((x, yy, 3.0), (0, 0, -1))
            if co is not None:
                pts.append(co + Vector((0, 0, 0.004)))
        if len(pts) > 2:
            sweep(bm, pts, [(-0.012, -0.006), (0.012, -0.006), (0.014, 0.002), (-0.008, 0.004)])
    child(new_object("CoverLouvers", bm, "Mesh", sharp=40), PARTS["engine_cover"])
    pts = []
    for i in range(21):
        x = -0.62 - 1.0 * i / 20
        co, n = hit((x, 0.0, 3.0), (0, 0, -1))
        if co is not None:
            pts.append(co)
    bm = bmesh.new()
    sweep(bm, pts, [(-0.03, -0.005), (0.03, -0.005), (0.012, 0.025), (-0.012, 0.025)])
    child(new_object("CoverSpine", finish(bm), "Paint", sharp=40), PARTS["engine_cover"])
    # rear-view mirror and wipers
    bm = bmesh.new()
    rbox(bm, (0, 0, 0), (0.03, 0.22, 0.06), bevel=0.01)
    bm.transform(M((0.03, 0, 1.0), (0, 0.2, 0)))
    child(new_object("RearView", bm, "Plastic", sharp=40), pb)
    bm = bmesh.new()
    for s in (1, -1):
        pts = [(0.79, s * 0.05 - 0.0, 0.748), (0.72, s * 0.32 - 0.05, 0.775), (0.66, s * 0.52 - 0.1, 0.795)]
        if s < 0:
            continue
        sweep(bm, catmull(pts, 6), [(-0.006, 0), (0.006, 0), (0.006, 0.01), (-0.006, 0.01)])
    child(new_object("Wiper", finish(bm), "Plastic", sharp=40), pb)


# ================================================================== rendering
def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def studio():
    sc = bpy.context.scene
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    sky = nt.nodes.new("ShaderNodeTexGradient")
    mp = nt.nodes.new("ShaderNodeMapping")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    mp.inputs["Rotation"].default_value = (0, math.pi / 2, 0)
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], sky.inputs["Vector"])
    nt.links.new(sky.outputs["Fac"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].color = (0.004, 0.004, 0.005, 1)
    ramp.color_ramp.elements[1].color = (0.05, 0.055, 0.06, 1)
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    sc.world = w
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    floor = bpy.context.object
    floor.name = "Floor"
    fm = mat("Floor", (0.012, 0.012, 0.013), rough=0.32)
    floor.data.materials.append(fm)
    for name, loc, size, e, col in (
        ("Top", (0, 0, 4.2), (6.0, 2.6), 1500, (1, 1, 1)),
        ("Key", (3.5, -5.0, 2.6), (3.0, 1.5), 700, (1, 0.97, 0.93)),
        ("Rim", (-4.5, 3.5, 2.2), (4.0, 1.0), 900, (0.85, 0.9, 1.0)),
        ("Fill", (-3.0, -5.5, 1.4), (5.0, 0.6), 500, (1, 1, 1)),
        ("Front", (6.5, 0.0, 1.2), (0.6, 4.0), 400, (1, 1, 1)),
    ):
        L = bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA"))
        L.data.shape = "RECTANGLE"
        L.data.size, L.data.size_y = size
        L.data.energy = e
        L.data.color = col
        L.location = loc
        look_at(L, (0, 0, 0.5))
        sc.collection.objects.link(L)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = "GPU"
    except Exception as ex:  # noqa: BLE001
        print("GPU unavailable:", ex)
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 12
    sc.cycles.transmission_bounces = 12
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    return cam


VIEWS = {
    "front34": ((5.4, -4.4, 1.35), (0.15, 0, 0.5), 50),
    "rear34": ((-5.3, -4.0, 1.75), (-0.2, 0, 0.5), 50),
    "side": ((0.0, -8.6, 0.75), (0, 0, 0.55), 50),
    "top": ((0.6, -1.2, 9.5), (0, 0, 0.4), 40),
    "front": ((7.6, 0.0, 0.7), (0, 0, 0.55), 50),
    "cut": ((3.6, -3.4, 3.2), (-0.3, 0, 0.35), 40),
    "cutrear": ((-3.6, -2.6, 2.8), (-0.8, 0, 0.4), 45),
}


SKIN = ("body", "door_left", "door_right", "hood", "engine_cover", "aero", "headlights", "taillights")


def skin(hidden):
    for pid in SKIN:
        for o in PARTS[pid].children_recursive:
            o.hide_render = hidden


CLOSE = {   # name: (camera, target, lens, parts hidden)
    "cabin": ((0.55, 2.3, 1.35), (-0.15, 0.15, 0.55), 30, ("door_left",)),
    "seat": ((0.45, 1.25, 0.95), (-0.28, 0.36, 0.55), 30, ("door_left",)),
    "dash": ((-0.30, -0.30, 0.98), (0.6, 0.25, 0.62), 22, ()),
    "wheel": ((-0.05, 0.36, 0.85), (0.45, 0.36, 0.6), 28, ()),
    "bay": ((-2.55, -1.2, 1.75), (-1.05, 0, 0.55), 32, ("engine_cover",)),
    "bayside": ((-1.0, -1.9, 1.35), (-1.1, 0, 0.5), 30, ("engine_cover", "body", "aero")),
}


def render_close(views, samples=96, res=(1600, 900), tag=""):
    cam = studio() if "Cam" not in bpy.data.objects else bpy.data.objects["Cam"]
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.render.resolution_x, sc.render.resolution_y = res
    if "CabinFill" not in bpy.data.objects:
        for name, kind, loc, e, size in (("CabinFill", "AREA", (0.4, 2.0, 1.25), 140, 1.2),
                                         ("CabinGlow", "POINT", (-0.1, 0.0, 0.95), 10, 0.25),
                                         ("BayFill", "AREA", (-1.0, 0.0, 2.2), 110, 1.4)):
            L = bpy.data.objects.new(name, bpy.data.lights.new(name, kind))
            L.data.energy = e
            if kind == "AREA":
                L.data.size = size
            else:
                L.data.shadow_soft_size = size
            L.location = loc
            look_at(L, (-0.1, 0.0, 0.5) if name != "BayFill" else (-1.0, 0, 0.4))
            sc.collection.objects.link(L)
    for v in views:
        loc, tgt, lens, hidden = CLOSE[v]
        for pid in hidden:
            for o in PARTS[pid].children_recursive:
                o.hide_render = True
        cam.location = loc
        cam.data.lens = lens
        look_at(cam, tgt)
        sc.render.filepath = os.path.join(RENDERS, f"lykan_{v}{tag}.png")
        bpy.ops.render.render(write_still=True)
        for pid in hidden:
            for o in PARTS[pid].children_recursive:
                o.hide_render = False


def render(views, samples=96, res=(1600, 900), tag=""):
    cam = studio() if "Cam" not in bpy.data.objects else bpy.data.objects["Cam"]
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.render.resolution_x, sc.render.resolution_y = res
    os.makedirs(RENDERS, exist_ok=True)
    for v in views:
        loc, tgt, lens = VIEWS[v]
        cam.location = loc
        cam.data.lens = lens
        look_at(cam, tgt)
        sc.render.filepath = os.path.join(RENDERS, f"lykan_{v}{tag}.png")
        bpy.ops.render.render(write_still=True)


# ================================================================== assembly
def build():
    reset()
    materials()
    upgrade()
    body = body_parts()
    surface([o for k, o in body.items() if k not in ("well", "intake", "floor")])
    lights(body)
    trim(body)
    engine()
    turbos()
    exhaust()
    transmission()
    cooling()
    frunk()
    chassis()
    suspension()
    interior()
    for pid, ax, side, front in (("wheel_fl", AXLE_F, 1, True), ("wheel_fr", AXLE_F, -1, True),
                                 ("wheel_rl", AXLE_R, 1, False), ("wheel_rr", AXLE_R, -1, False)):
        wheel(pid, ax, side, front)


def export():
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.context.scene.objects:
        if o.name.startswith(("Part_", "Body_")) or (o.parent and o.parent.name.startswith("Part_")):
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_extras=True,
        export_apply=True,
        export_texcoords=True,
        export_image_format="WEBP",
        export_draco_mesh_compression_enable=True,
        export_draco_position_quantization=16,
        export_draco_normal_quantization=12,
    )
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    build()
    if "noexport" not in args:
        export()
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "art", "lykan.blend"))
    if "close" in args:
        render_close(list(CLOSE), samples=32, res=(1200, 675), tag="_q")
    if "render" in args:
        if "quick" in args:
            render(["front34", "side", "rear34", "front"], samples=24, res=(1200, 675), tag="_q")
            skin(True)
            render(["cut", "cutrear"], samples=24, res=(1200, 675), tag="_q")
            skin(False)
        else:
            render(list(VIEWS), samples=128)
