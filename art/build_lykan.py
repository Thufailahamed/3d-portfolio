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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "models", "lykan.glb")
RENDERS = os.path.join(ROOT, "art", "renders")

AXLE_F, AXLE_R = 1.25, -1.375
TRACK_F, TRACK_R = 0.835, 0.815          # half-track to the tyre centre
TYRE_F = dict(R=0.331, w=0.255, rim=0.2413)   # 255/35 ZR19
TYRE_R = dict(R=0.355, w=0.335, rim=0.254)    # 335/30 ZR20


# ------------------------------------------------------------------ helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def spline(keys):
    """Cubic Hermite through (x, y) keys with Catmull-Rom slopes; clamped outside."""
    keys = sorted(keys)
    xs = [k[0] for k in keys]
    ys = [k[1] for k in keys]
    n = len(xs)
    m = []
    for i in range(n):
        a, b = max(i - 1, 0), min(i + 1, n - 1)
        m.append((ys[b] - ys[a]) / (xs[b] - xs[a]))

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = bisect.bisect_right(xs, x) - 1
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i]
                + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1])

    return f


MATS = {}


def mat(name, color, metal=0.0, rough=0.5, coat=0.0, coat_rough=0.03, trans=0.0, emit=None,
        strength=0.0, alpha=1.0, ior=1.45, aniso=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = coat_rough
    b.inputs["Transmission Weight"].default_value = trans
    b.inputs["IOR"].default_value = ior
    if aniso:
        b.inputs["Anisotropic"].default_value = aniso
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    m.diffuse_color = (*color, 1)
    MATS[name] = m
    return m


def materials():
    mat("Paint", (0.2, 0.002, 0.008), metal=0.6, rough=0.3, coat=1.0, coat_rough=0.02)
    mat("Carbon", (0.018, 0.019, 0.021), metal=0.25, rough=0.28, coat=1.0, coat_rough=0.05)
    mat("CarbonMatte", (0.02, 0.02, 0.022), rough=0.5)
    mat("Underbody", (0.012, 0.012, 0.013), rough=0.8)
    mat("Glass", (0.12, 0.13, 0.14), rough=0.02, trans=1.0, ior=1.5, alpha=0.35)
    mat("GlassClear", (0.95, 0.97, 1.0), rough=0.0, trans=1.0, ior=1.5, alpha=0.12)
    mat("Chrome", (0.92, 0.92, 0.93), metal=1.0, rough=0.04)
    mat("DarkChrome", (0.18, 0.18, 0.2), metal=1.0, rough=0.12)
    mat("Aluminium", (0.8, 0.8, 0.82), metal=1.0, rough=0.28)
    mat("Gunmetal", (0.12, 0.125, 0.135), metal=1.0, rough=0.25)
    mat("WheelBlack", (0.025, 0.025, 0.027), metal=0.6, rough=0.22, coat=0.6, coat_rough=0.1)
    mat("Titanium", (0.42, 0.36, 0.33), metal=1.0, rough=0.22)
    mat("HeatBlue", (0.2, 0.22, 0.42), metal=1.0, rough=0.2)
    mat("CastIron", (0.09, 0.085, 0.08), metal=0.8, rough=0.55)
    mat("Rubber", (0.016, 0.016, 0.017), rough=0.82)
    mat("RubberSide", (0.022, 0.022, 0.024), rough=0.62)
    mat("Plastic", (0.03, 0.03, 0.032), rough=0.45)
    mat("Leather", (0.012, 0.011, 0.011), rough=0.62, coat=0.1, coat_rough=0.45)
    mat("LeatherRed", (0.25, 0.012, 0.012), rough=0.5, coat=0.15, coat_rough=0.4)
    mat("Alcantara", (0.015, 0.015, 0.016), rough=1.0)
    mat("Gold", (1.0, 0.72, 0.32), metal=1.0, rough=0.18)
    mat("Caliper", (0.85, 0.55, 0.08), metal=0.3, rough=0.25, coat=1.0)
    mat("Disc", (0.2, 0.2, 0.21), metal=0.6, rough=0.42)
    mat("CrinkleBlack", (0.03, 0.03, 0.03), metal=0.1, rough=0.7)
    mat("RedAnodised", (0.5, 0.02, 0.02), metal=1.0, rough=0.3)
    mat("BlueAnodised", (0.05, 0.12, 0.5), metal=1.0, rough=0.3)
    mat("Spring", (0.75, 0.12, 0.05), metal=0.5, rough=0.3)
    mat("LED", (1.0, 1.0, 1.0), emit=(0.85, 0.92, 1.0), strength=12.0)
    mat("LEDAmber", (1.0, 0.5, 0.1), emit=(1.0, 0.45, 0.05), strength=6.0)
    mat("TailLED", (0.6, 0.0, 0.0), emit=(1.0, 0.02, 0.01), strength=10.0)
    mat("Holo", (0.1, 0.6, 0.8), emit=(0.15, 0.75, 1.0), strength=4.0, alpha=0.6)
    mat("Screen", (0.01, 0.01, 0.012), rough=0.1, emit=(0.1, 0.35, 0.6), strength=1.2)
    mat("Diamond", (1.0, 1.0, 1.0), rough=0.0, trans=1.0, ior=2.42)
    mat("Mesh", (0.015, 0.015, 0.016), metal=0.6, rough=0.4)
    mat("Radiator", (0.25, 0.25, 0.27), metal=0.9, rough=0.4)
    mat("Hose", (0.03, 0.03, 0.035), rough=0.6)
    mat("HoseBlue", (0.05, 0.12, 0.4), rough=0.5)
    mat("Copper", (0.95, 0.5, 0.3), metal=1.0, rough=0.25)
    mat("Carpet", (0.02, 0.02, 0.02), rough=1.0)
    mat("WellLiner", (0.015, 0.015, 0.016), rough=0.9)
    honeycomb()
    img = weave()
    for name in ("Carbon", "CarbonMatte"):
        textured(MATS[name], img)


def weave(size=256, cells=8):
    """2x2 twill: tows alternate direction on a diagonal stagger, each with a soft crown."""
    img = bpy.data.images.new("CarbonWeave", size, size)
    px = []
    c = size // cells
    for yy in range(size):
        for xx in range(size):
            i, j = xx // c, yy // c
            u, v = (xx % c) / c, (yy % c) / c
            horiz = ((i + j) // 2) % 2 == 0
            t = v if horiz else u
            along = u if horiz else v
            crown = math.sin(math.pi * t) ** 0.6
            fib = 0.85 + 0.15 * math.sin((along * 37 + t * 3) * math.pi)
            g = 0.012 + 0.07 * crown * fib * (1.0 if horiz else 0.8)
            px += (g, g, g * 1.08, 1.0)
    img.pixels = px
    img.pack()
    return img


def honeycomb(s=16, nx=8, ny=4):
    """Hexagon wire mesh as an alpha-masked texture that tiles (very nearly) on both axes."""
    w, h = round(math.sqrt(3) * s * nx), 3 * s * ny
    img = bpy.data.images.new("Honeycomb", w, h, alpha=True)
    px = []
    for yy in range(h):
        for xx in range(w):
            x, y = xx * (math.sqrt(3) * s * nx) / w, yy
            q = (math.sqrt(3) / 3 * x - y / 3) / s
            r = (2 / 3 * y) / s
            cx, cz = q, r
            cy = -cx - cz
            rx, ry, rz = round(cx), round(cy), round(cz)
            dx, dy, dz = abs(rx - cx), abs(ry - cy), abs(rz - cz)
            if dx > dy and dx > dz:
                rx = -ry - rz
            elif dy > dz:
                ry = -rx - rz
            else:
                rz = -rx - ry
            d = max(abs(cx - rx), abs(cy - ry), abs(cz - rz))
            wall = 1.0 if d > 0.36 else 0.0
            g = 0.03 + 0.05 * wall
            px += (g, g, g, wall)
    img.pixels = px
    img.pack()
    m = bpy.data.materials.new("Honeycomb")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.02, 0.02, 0.022, 1)
    b.inputs["Metallic"].default_value = 0.7
    b.inputs["Roughness"].default_value = 0.35
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    gt = nt.nodes.new("ShaderNodeMath")
    gt.operation = "GREATER_THAN"
    gt.inputs[1].default_value = 0.5
    nt.links.new(tex.outputs["Alpha"], gt.inputs[0])
    nt.links.new(gt.outputs[0], b.inputs["Alpha"])
    m.surface_render_method = "DITHERED"
    MATS["Honeycomb"] = m


def textured(m, img):
    nt = m.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])


def box_uv(me, scale):
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        n = f.normal
        a = max(range(3), key=lambda k: abs(n[k]))
        i, j = [k for k in range(3) if k != a]
        for lp in f.loops:
            co = lp.vert.co
            lp[uv].uv = (co[i] * scale, co[j] * scale)
    bm.to_mesh(me)
    bm.free()


def new_object(name, bm, material=None, smooth=True, sharp=40.0, parent=None):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if material is not None:
        mats = material if isinstance(material, (list, tuple)) else [material]
        for m in mats:
            me.materials.append(MATS[m] if isinstance(m, str) else m)
    if smooth:
        shade(ob, sharp)
    if any(m.name.startswith("Carbon") for m in me.materials):
        box_uv(me, 25.0)
    if parent is not None:
        ob.parent = parent
    return ob


def shade(ob, sharp=40.0):
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    bm = bmesh.new()
    bm.from_mesh(me)
    lim = math.radians(sharp)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0) < lim
        else:
            e.smooth = True
    bm.to_mesh(me)
    bm.free()


def bake(ob):
    """Apply the modifier stack in place."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def empty(name, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.1
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    if parent is not None:
        e.parent = parent
    return e


PARTS = {}


def part(pid, explode, loc=(0, 0, 0)):
    """A clickable group. `explode` is in Blender axes; stored converted to glTF Y-up."""
    e = empty(f"Part_{pid}", loc=loc)
    x, y, z = explode
    e["part"] = pid
    e["explode"] = [x, z, -y]
    PARTS[pid] = e
    return e


def child(ob, pe):
    """Parent keeping world position (the part empty may sit away from the origin)."""
    ob.parent = pe
    ob.matrix_parent_inverse = pe.matrix_world.inverted()
    return ob


# ---------------------------------------------------------- bmesh primitives
def M(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    from mathutils import Euler
    return Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(scale))


def box(bm, loc, size, rot=(0, 0, 0)):
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=M(loc, rot, size))
    return r["verts"]


def cyl(bm, loc, r, h, segs=24, rot=(0, 0, 0), r2=None, caps=True):
    res = bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r,
                                radius2=r if r2 is None else r2, depth=h, matrix=M(loc, rot))
    return res["verts"]


def ball(bm, loc, r, sub=2, scale=(1, 1, 1)):
    return bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r, matrix=M(loc, (0, 0, 0), scale))["verts"]


def lathe(bm, prof, segs=48, closed=False, a0=0.0, a1=2 * math.pi, cap=False, mat_index=0):
    """Revolve (radius, axial) profile points around the local Y axis.
    Full turns are welded; partial arcs can be capped."""
    full = abs(a1 - a0 - 2 * math.pi) < 1e-6
    n = segs if full else segs + 1
    rings = []
    for s in range(n):
        a = a0 + (a1 - a0) * s / segs
        ca, sa = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((r * ca, u, r * sa)) for r, u in prof])
    faces = []
    np_ = len(prof)
    for s in range(segs):
        A, B = rings[s], rings[(s + 1) % n]
        for k in range(np_ if closed else np_ - 1):
            k2 = (k + 1) % np_
            try:
                f = bm.faces.new((A[k], A[k2], B[k2], B[k]))
                f.material_index = mat_index
                faces.append(f)
            except ValueError:
                pass
    if cap and not full and closed:
        for ring in (rings[0], rings[-1]):
            f = bm.faces.new(ring)
            f.material_index = mat_index
    return rings, faces


def tube(bm, pts, r, segs=12, closed_ends=True):
    """Sweep a circle along a polyline (smoothed corners via the given points)."""
    pts = [Vector(p) for p in pts]
    rings = []
    prev_n = None
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = ((pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()).normalized()
        if prev_n is None:
            up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            nrm = t.cross(up).normalized()
        else:
            nrm = (prev_n - t * prev_n.dot(t)).normalized()
        prev_n = nrm
        b = t.cross(nrm)
        rings.append([bm.verts.new(p + (nrm * math.cos(a) + b * math.sin(a)) * r)
                      for a in (2 * math.pi * k / segs for k in range(segs))])
    for A, B in zip(rings, rings[1:]):
        for k in range(segs):
            bm.faces.new((A[k], A[(k + 1) % segs], B[(k + 1) % segs], B[k]))
    if closed_ends:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return rings


def bezier(p0, p1, p2, p3, n=16):
    p0, p1, p2, p3 = map(Vector, (p0, p1, p2, p3))
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append(u ** 3 * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t ** 3 * p3)
    return out


def catmull(pts, n=8):
    """Smooth polyline through points."""
    pts = [Vector(p) for p in pts]
    pts = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(n):
            t = s / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-2])
    return out


def prism(bm, poly, axis, a0, a1):
    """Extrude a 2D polygon. axis='x': poly in (y, z); 'y': poly in (x, z); 'z': poly in (x, y)."""
    def P(u, v, w):
        return {"x": (w, u, v), "y": (u, w, v), "z": (u, v, w)}[axis]
    A = [bm.verts.new(P(u, v, a0)) for u, v in poly]
    B = [bm.verts.new(P(u, v, a1)) for u, v in poly]
    n = len(poly)
    bm.faces.new(A)
    bm.faces.new(list(reversed(B)))
    for k in range(n):
        bm.faces.new((A[k], B[k], B[(k + 1) % n], A[(k + 1) % n]))
    return A + B


def rounded_rect(w, h, r, n=4, cx=0.0, cy=0.0):
    pts = []
    for qx, qy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oy = cx + qx * (w / 2 - r), cy + qy * (h / 2 - r)
        for s in range(n + 1):
            a = math.radians(a0 + 90 * s / n)
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts


def finish(bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def text_mesh(s, size, loc, rot, material, extrude=0.002, name="Text", parent=None, align="CENTER"):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = s
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = "CENTER"
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    mo = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(mo)
    mo.matrix_world = ob.matrix_world
    bpy.data.objects.remove(ob)
    me.materials.append(MATS[material])
    if parent is not None:
        child(mo, parent)
    return mo


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
    pb = part("body", (0, 0, 0.0))
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


# ================================================================== wheels
def tyre(bm, R, w, rim, segs=128):
    h = R - rim
    u = w / 2
    prof = [
        (rim + 0.004, -u * 0.86), (rim + 0.25 * h, -u * 0.99), (rim + 0.62 * h, -u * 1.0),
        (R - 0.16 * h, -u * 0.95), (R - 0.04 * h, -u * 0.86),
        (R, -u * 0.78), (R, -0.52 * u), (R - 0.012, -0.5 * u), (R - 0.012, -0.42 * u), (R, -0.40 * u),
        (R, -0.08 * u), (R - 0.012, -0.06 * u), (R - 0.012, 0.06 * u), (R, 0.08 * u),
        (R, 0.40 * u), (R - 0.012, 0.42 * u), (R - 0.012, 0.5 * u), (R, 0.52 * u), (R, u * 0.78),
        (R - 0.04 * h, u * 0.86), (R - 0.16 * h, u * 0.95), (rim + 0.62 * h, u * 1.0),
        (rim + 0.25 * h, u * 0.99), (rim + 0.004, u * 0.86),
    ]
    lathe(bm, prof, segs, closed=True)


def rim(bm, R, w, rim_r, spokes=10):
    u = w / 2
    # barrel with an outer lip; face of the wheel is +Y
    prof = [(rim_r - 0.012, -u * 0.9), (rim_r + 0.01, -u * 0.92), (rim_r + 0.012, -u * 0.84),
            (rim_r - 0.006, -u * 0.8), (rim_r - 0.012, -u * 0.2), (rim_r - 0.006, u * 0.75),
            (rim_r + 0.01, u * 0.84), (rim_r + 0.016, u * 0.93), (rim_r + 0.006, u * 0.98),
            (rim_r - 0.022, u * 0.95), (rim_r - 0.03, u * 0.6), (rim_r - 0.03, -u * 0.86)]
    lathe(bm, prof, 96, closed=True)
    # five twin spokes, dished in toward the hub
    hub_u = u * 0.35
    for s in range(spokes // 2):
        base = 2 * math.pi * s / (spokes // 2)
        for d in (-1, 1):
            a = base + d * math.radians(10.5)
            a_in = base + d * math.radians(1.6)
            pts = []
            for (r, ang, uu, hw) in ((0.075, a_in, hub_u, 0.013), (0.13, base + d * math.radians(3.5), u * 0.55, 0.012),
                                     (0.19, base + d * math.radians(8), u * 0.72, 0.013),
                                     (rim_r - 0.026, a, u * 0.82, 0.015)):
                c, sn = math.cos(ang), math.sin(ang)
                t = Vector((-sn, 0, c))
                p = Vector((r * c, uu, r * sn))
                pts.append((p, t, hw))
            ring = []
            for p, t, hw in pts:
                ring.append([bm.verts.new(p + t * hw + Vector((0, 0.012, 0))),
                             bm.verts.new(p - t * hw + Vector((0, 0.012, 0))),
                             bm.verts.new(p - t * hw * 0.8 - Vector((0, 0.03, 0))),
                             bm.verts.new(p + t * hw * 0.8 - Vector((0, 0.03, 0)))])
            for A, B in zip(ring, ring[1:]):
                for k in range(4):
                    bm.faces.new((A[k], A[(k + 1) % 4], B[(k + 1) % 4], B[k]))
            bm.faces.new(list(reversed(ring[0])))
            bm.faces.new(ring[-1])
    # hub disc, centre-lock nut and cap
    lathe(bm, [(0.0, hub_u + 0.02), (0.085, hub_u + 0.012), (0.09, hub_u - 0.03), (0.0, hub_u - 0.03)], 48,
          closed=True)


def hub_nut(bm, hub_u):
    cyl(bm, (0, hub_u + 0.04, 0), 0.042, 0.04, segs=6, rot=(math.pi / 2, 0, 0))
    cyl(bm, (0, hub_u + 0.065, 0), 0.03, 0.012, segs=32, rot=(math.pi / 2, 0, 0))


def brake(pe, ax, side, R_disc, front):
    """Carbon-ceramic disc with a drilled face, aluminium bell, six-piston caliper."""
    tr = (TRACK_F if front else TRACK_R) - 0.02
    zc = (TYRE_F if front else TYRE_R)["R"]
    base = M((ax, side * tr, zc), (0, 0, 0 if side > 0 else math.pi))
    bm = bmesh.new()
    lathe(bm, [(0.11, -0.017), (R_disc, -0.017), (R_disc, 0.017), (0.11, 0.017)], 96, closed=True)
    bm.transform(base)
    disc = new_object(f"Disc_{ax}_{side}", bm, "Disc", sharp=30)
    child(disc, pe)
    bm = bmesh.new()
    rnd = random.Random(7)
    for ring_r, n, off in ((R_disc - 0.025, 24, 0), (R_disc - 0.05, 24, 0.5), (R_disc - 0.075, 24, 0.25)):
        for k in range(n):
            a = 2 * math.pi * (k + off) / n
            cyl(bm, (ring_r * math.cos(a), 0.0172, ring_r * math.sin(a)), 0.0042, 0.0006, segs=8,
                rot=(math.pi / 2, 0, 0))
    bm.transform(base)
    child(new_object(f"Drill_{ax}_{side}", bm, "Underbody", smooth=False), pe)
    bm = bmesh.new()
    lathe(bm, [(0.0, 0.03), (0.105, 0.03), (0.118, 0.012), (0.118, -0.005), (0.1, -0.005), (0.09, 0.02),
               (0.0, 0.02)], 48, closed=True)
    for k in range(10):
        a = 2 * math.pi * k / 10
        cyl(bm, (0.112 * math.cos(a), 0.0, 0.112 * math.sin(a)), 0.006, 0.04, segs=8, rot=(math.pi / 2, 0, 0))
    bm.transform(base)
    child(new_object(f"Bell_{ax}_{side}", bm, "Aluminium", sharp=40), pe)
    # caliper: an arc block straddling the disc, sitting at the trailing top
    bm = bmesh.new()
    a_mid = math.radians(140 if front else 40)
    span = math.radians(68)
    r0, r1 = R_disc - 0.07, R_disc + 0.022
    prof = [(r0, -0.045), (r1, -0.045), (r1 + 0.006, -0.03), (r1 + 0.006, 0.035), (r1, 0.05), (r0, 0.05),
            (r0 - 0.004, 0.03), (r0 - 0.004, -0.03)]
    lathe(bm, prof, 24, closed=True, a0=a_mid - span / 2, a1=a_mid + span / 2, cap=True)
    bm.transform(base)
    cal = new_object(f"Caliper_{ax}_{side}", bm, "Caliper", sharp=35)
    sub = cal.modifiers.new("Bev", "BEVEL")
    sub.width = 0.006
    sub.segments = 3
    bake(cal)
    shade(cal, 35)
    child(cal, pe)
    # the badge on its outer face
    rr = (r0 + r1) / 2
    loc = base @ Vector((rr * math.cos(a_mid), 0.0505, rr * math.sin(a_mid)))
    face_rot = (math.pi / 2, 0, (0 if side > 0 else math.pi))
    t = text_mesh("LYKAN", 0.022, loc, face_rot, "Underbody", extrude=0.0008, name=f"CalBadge_{ax}_{side}")
    t.rotation_euler = (math.pi / 2, -(a_mid - math.pi / 2) * side, 0 if side > 0 else math.pi)
    child(t, pe)


def wheel(pid, ax, side, front):
    spec = TYRE_F if front else TYRE_R
    tr = TRACK_F if front else TRACK_R
    pe = part(pid, (0, side * 0.9, 0))
    base = M((ax, side * tr, spec["R"]), (0, 0, 0 if side > 0 else math.pi))
    bm = bmesh.new()
    tyre(bm, spec["R"], spec["w"], spec["rim"])
    bm.transform(base)
    t = new_object(f"Tyre_{pid}", bm, "Rubber", sharp=60)
    child(t, pe)
    bm = bmesh.new()
    rim(bm, spec["R"], spec["w"], spec["rim"])
    bm.transform(base)
    child(new_object(f"Rim_{pid}", bm, "WheelBlack", sharp=35), pe)
    bm = bmesh.new()
    hub_nut(bm, spec["w"] / 2 * 0.35)
    bm.transform(base)
    child(new_object(f"Nut_{pid}", bm, "Chrome", sharp=30), pe)
    # sidewall lettering
    u = spec["w"] / 2
    h = spec["R"] - spec["rim"]
    for k, word in enumerate(("PIRELLI", "P ZERO")):
        a = math.radians(90 + 180 * k)
        rr = spec["rim"] + 0.55 * h
        loc = base @ Vector((rr * math.cos(a), u * 1.0 + 0.0005, rr * math.sin(a)))
        tm = text_mesh(word, 0.024, loc, (0, 0, 0), "RubberSide", extrude=0.0006, name=f"TyreText_{pid}_{k}")
        tm.rotation_euler = (math.pi / 2, -(a - math.pi / 2), 0 if side > 0 else math.pi)
        child(tm, pe)
    bp = part(pid.replace("wheel", "brake"), (0, side * 0.55, 0))
    brake(bp, ax, side, 0.19 if front else 0.18, front)
    return pe


# ================================================================== surface tools
SURF = {}


def surface(objs):
    verts, polys = [], []
    for o in objs:
        mw = o.matrix_world
        off = len(verts)
        verts += [mw @ v.co for v in o.data.vertices]
        polys += [[off + i for i in p.vertices] for p in o.data.polygons]
    SURF["bvh"] = BVHTree.FromPolygons(verts, polys)


def hit(origin, direction):
    co, n, _, _ = SURF["bvh"].ray_cast(Vector(origin), Vector(direction).normalized(), 10.0)
    return co, n


def proj_grid(bm, f, nu, nv, d, offset, closed_u=False):
    """Grid of points f(u, v) (far outside the car) shot along d onto the skin, lifted by offset."""
    grid = []
    d = Vector(d).normalized()
    for i in range(nu + 1):
        row = []
        for j in range(nv + 1):
            o = Vector(f(i / nu, j / nv))
            co, n = hit(o, d)
            if co is None:
                co, n = o + d * 2.0, -d
            row.append(bm.verts.new(co - d * offset))
        grid.append(row)
    for i in range(nu if not closed_u else nu + 1):
        A, B = grid[i % (nu + 1)], grid[(i + 1) % (nu + 1)]
        for j in range(nv):
            bm.faces.new((A[j], B[j], B[j + 1], A[j + 1]))
    return grid


def thicken(ob, t, rim_mat=None):
    so = ob.modifiers.new("Solid", "SOLIDIFY")
    so.thickness = t
    so.offset = -1
    if rim_mat:
        ob.data.materials.append(MATS[rim_mat])
        so.material_offset = 1
        so.material_offset_rim = 1
    bake(ob)
    shade(ob, 40)
    return ob


def sweep(bm, pts, prof, ups=None, closed=False, cap=True):
    """Sweep a 2D profile [(side, up)] along a path; ups gives the up vector per point."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        a = pts[(i - 1) % n] if (closed or i > 0) else p
        b = pts[(i + 1) % n] if (closed or i < n - 1) else p
        t = (b - a).normalized()
        up = Vector(ups[i] if ups else (0, 0, 1))
        side = t.cross(up).normalized()
        u2 = side.cross(t).normalized()
        rings.append([bm.verts.new(p + side * sx + u2 * sy) for sx, sy in prof])
    m = len(prof)
    for i in range(n if closed else n - 1):
        A, B = rings[i], rings[(i + 1) % n]
        for k in range(m):
            bm.faces.new((A[k], A[(k + 1) % m], B[(k + 1) % m], B[k]))
    if cap and not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return rings


def rbox(bm, loc, size, rot=(0, 0, 0), bevel=0.01, segs=3):
    vs = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((*size, 1)))["verts"]
    if bevel > 0:
        es = list({e for v in vs for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=es + list(vs), offset=bevel, segments=segs, affect="EDGES", profile=0.5)


def piece(name, build_fn, material, pe, sharp=40, mods=None):
    bm = bmesh.new()
    build_fn(bm)
    ob = new_object(name, bm, material, sharp=sharp)
    for kind, kw in (mods or []):
        m = ob.modifiers.new(kind, kind)
        for k, v in kw.items():
            setattr(m, k, v)
    if mods:
        bake(ob)
        shade(ob, sharp)
        if material.startswith("Carbon"):
            box_uv(ob.data, 25.0)
    child(ob, pe)
    return ob


def placed(bm_fn, mtx):
    """Run a primitive builder into a temporary bmesh and transform its geometry."""
    def f(bm):
        tmp = bmesh.new()
        bm_fn(tmp)
        tmp.transform(mtx)
        me = bpy.data.meshes.new("tmp")
        tmp.to_mesh(me)
        tmp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    return f


def multi(*fns):
    def f(bm):
        for fn in fns:
            fn(bm)
    return f


def rb(loc, size, rot=(0, 0, 0), bevel=0.01, segs=3):
    return placed(lambda bm: rbox(bm, (0, 0, 0), size, bevel=bevel, segs=segs), M(loc, rot))


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


def honey_plane(name, corners, parent, scale=40.0):
    """A flat honeycomb grille on the quad `corners`, UVs in metres times scale."""
    bm = bmesh.new()
    vs = [bm.verts.new(c) for c in corners]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.new("UVMap")
    o = Vector(corners[0])
    e1 = (Vector(corners[1]) - o).normalized()
    e2 = f.normal.cross(e1)
    for lp in f.loops:
        d = lp.vert.co - o
        lp[uv].uv = (d.dot(e1) * scale, d.dot(e2) * scale)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(MATS["Honeycomb"])
    child(ob, parent)
    return ob


def trim(body):
    pb = PARTS["body"]
    pa = part("aero", (0, 0, -0.45))
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


def finish_fn(fn):
    bm = bmesh.new()
    fn(bm)
    return finish(bm)


# ================================================================== engine bay
EX = -1.03          # engine block centre (x)
EZ = 0.37           # crank height


def convex_hull_2d(pts):
    pts = sorted(set(pts))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def engine():
    pe = part("engine", (-0.3, 0, 1.25))
    cyl_x = [EX + 0.17, EX + 0.02, EX - 0.13]
    # crankcase and sump
    piece("Crankcase", multi(rb((EX, 0, EZ), (0.56, 0.30, 0.26), bevel=0.03),
                             rb((EX - 0.02, 0, EZ - 0.15), (0.50, 0.26, 0.06), bevel=0.015)),
          "Aluminium", pe)
    piece("SumpRibs", multi(*[rb((EX - 0.22 + 0.055 * k, 0, EZ - 0.185), (0.012, 0.24, 0.02), bevel=0.003)
                              for k in range(9)]), "Aluminium", pe)
    for s in (1, -1):
        # cylinder bank, head, cam cover
        piece(f"Block_{s}", rb((EX + 0.02, s * 0.25, EZ + 0.01), (0.50, 0.20, 0.22), bevel=0.025),
              "Aluminium", pe)
        piece(f"BlockRibs_{s}", multi(*[rb((x - 0.075, s * 0.25, EZ + 0.01), (0.012, 0.19, 0.235), bevel=0.004)
                                        for x in cyl_x[:-1]] +
                                      [rb((x, s * 0.25, EZ + 0.125), (0.10, 0.17, 0.012), bevel=0.004)
                                       for x in cyl_x]), "Aluminium", pe)
        piece(f"Head_{s}", rb((EX + 0.02, s * 0.395, EZ + 0.02), (0.52, 0.09, 0.25), bevel=0.02), "Gunmetal", pe)
        piece(f"CamCover_{s}", rb((EX + 0.02, s * 0.46, EZ + 0.03), (0.50, 0.05, 0.22), bevel=0.02),
              "CrinkleBlack", pe)
        t = text_mesh("LYKAN  3.7  BITURBO", 0.022, (EX + 0.02, s * 0.4865, EZ + 0.05),
                      (math.pi / 2, 0, 0 if s > 0 else math.pi), "Aluminium", 0.0015, f"CoverText_{s}")
        child(t, pe)
        bolts = bmesh.new()
        for x in (EX - 0.21, EX - 0.07, EX + 0.11, EX + 0.25):
            for z in (EZ - 0.07, EZ + 0.13):
                cyl(bolts, (x, s * 0.487, z), 0.007, 0.008, segs=6, rot=(math.pi / 2, 0, 0))
        child(new_object(f"CoverBolts_{s}", bolts, "Chrome", sharp=30), pe)
        # coil packs on top of each head
        coils = bmesh.new()
        for x in cyl_x:
            cyl(coils, (x, s * 0.40, EZ + 0.17), 0.018, 0.07, segs=16)
            cyl(coils, (x, s * 0.40, EZ + 0.21), 0.024, 0.018, segs=16)
        child(new_object(f"Coils_{s}", coils, "RedAnodised", sharp=40), pe)
        # intake runners from the plenum to each port
        run = bmesh.new()
        for x in cyl_x:
            tube(run, catmull([(x, s * 0.36, EZ + 0.13), (x, s * 0.30, EZ + 0.24), (x, s * 0.14, EZ + 0.33),
                               (x, s * 0.05, EZ + 0.37)], 6), 0.022, 14)
        child(new_object(f"Runners_{s}", run, "Aluminium", sharp=50), pe)
        # exhaust manifold: three primaries per bank merging into the turbo
        man = bmesh.new()
        for k, x in enumerate(cyl_x):
            tube(man, catmull([(x, s * 0.42, EZ - 0.08), (x, s * 0.47, EZ - 0.15), (x - 0.06, s * 0.50, EZ - 0.14),
                               (EX - 0.32, s * 0.47, EZ - 0.04), (EX - 0.43, s * 0.44, EZ + 0.08)], 6),
                 0.019, 12)
        child(new_object(f"Manifold_{s}", man, "HeatBlue", sharp=50), pe)
    # carbon plenum with throttle body
    piece("Plenum", multi(rb((EX + 0.01, 0, EZ + 0.38), (0.48, 0.15, 0.10), bevel=0.045),
                          rb((EX + 0.01, 0, EZ + 0.44), (0.34, 0.08, 0.03), bevel=0.012)), "Carbon", pe)
    t = text_mesh("W MOTORS", 0.028, (EX + 0.01, 0, EZ + 0.4555), (0, 0, -math.pi / 2), "Aluminium", 0.0015,
                  "PlenumBadge")
    child(t, pe)
    piece("Throttle", multi(placed(lambda bm: cyl(bm, (0, 0, 0), 0.045, 0.08, segs=32), M((EX + 0.29, 0, EZ + 0.38), (0, math.pi / 2, 0))),
                            placed(lambda bm: cyl(bm, (0, 0, 0), 0.05, 0.012, segs=32), M((EX + 0.335, 0, EZ + 0.38), (0, math.pi / 2, 0)))),
          "Aluminium", pe)
    # accessory drive at the cabin end of the crank
    pulleys = [((0.0, EZ - 0.02), 0.075), ((0.17, EZ + 0.17), 0.045), ((-0.17, EZ + 0.15), 0.05),
               ((0.0, EZ + 0.25), 0.03), ((0.19, EZ - 0.06), 0.03)]
    px = EX + 0.305
    child_pul = bmesh.new()
    for (y, z), r in pulleys:
        tmp = bmesh.new()
        lathe(tmp, [(0.0, -0.012), (r, -0.012), (r, -0.016), (r + 0.006, -0.016), (r + 0.006, 0.016), (r, 0.016),
                    (r, 0.012), (0.0, 0.012)], 40, closed=True)
        tmp.transform(M((px, y, z), (0, 0, -math.pi / 2)))
        me = bpy.data.meshes.new("t")
        tmp.to_mesh(me)
        tmp.free()
        child_pul.from_mesh(me)
        bpy.data.meshes.remove(me)
    child(new_object("Pulleys", child_pul, "Aluminium", sharp=40), pe)
    hull = []
    for (y, z), r in pulleys:
        for k in range(48):
            a = 2 * math.pi * k / 48
            hull.append((round(y + (r + 0.006) * math.cos(a), 5), round(z + (r + 0.006) * math.sin(a), 5)))
    hull = convex_hull_2d(hull)
    bm = bmesh.new()
    sweep(bm, [(px, y, z) for y, z in hull], [(-0.011, 0), (0.011, 0), (0.011, 0.004), (-0.011, 0.004)],
          ups=None, closed=True)
    child(new_object("Belt", bm, "Rubber", sharp=60), pe)
    piece("Alternator", placed(lambda bm: lathe(bm, [(0, -0.07), (0.05, -0.07), (0.058, -0.05), (0.058, 0.06),
                                                    (0.03, 0.07), (0, 0.07)], 32, closed=True),
                               M((EX + 0.23, 0.17, EZ + 0.17), (0, 0, -math.pi / 2))), "Aluminium", pe)
    piece("ACPump", placed(lambda bm: lathe(bm, [(0, -0.07), (0.055, -0.07), (0.055, 0.06), (0, 0.06)], 32, closed=True),
                           M((EX + 0.23, -0.17, EZ + 0.15), (0, 0, -math.pi / 2))), "Gunmetal", pe)
    # oil tank and coolant expansion bottle
    piece("OilTank", placed(lambda bm: cyl(bm, (0, 0, 0), 0.06, 0.24, segs=32), M((EX - 0.05, 0.62, EZ + 0.18))),
          "Aluminium", pe)
    piece("OilCap", placed(lambda bm: cyl(bm, (0, 0, 0), 0.03, 0.02, segs=24), M((EX - 0.05, 0.62, EZ + 0.31))),
          "RedAnodised", pe)
    piece("Coolant", placed(lambda bm: rbox(bm, (0, 0, 0), (0.12, 0.10, 0.12), bevel=0.03),
                            M((EX - 0.05, -0.62, EZ + 0.2))), "GlassClear", pe)
    piece("CoolantCap", placed(lambda bm: cyl(bm, (0, 0, 0), 0.025, 0.02, segs=24), M((EX - 0.05, -0.62, EZ + 0.27))),
          "BlueAnodised", pe)
    bm = bmesh.new()
    tube(bm, catmull([(EX - 0.05, 0.62, EZ + 0.06), (EX + 0.05, 0.55, EZ - 0.05), (EX + 0.12, 0.30, EZ - 0.10)], 8),
         0.011, 10)
    tube(bm, catmull([(EX - 0.05, -0.62, EZ + 0.14), (EX + 0.08, -0.52, EZ + 0.1), (EX + 0.2, -0.42, EZ + 0.14)], 8),
         0.011, 10)
    child(new_object("EngineHoses", bm, "Hose", sharp=60), pe)
    # wiring loom along the heads
    bm = bmesh.new()
    for s in (1, -1):
        tube(bm, catmull([(EX + 0.28, s * 0.33, EZ + 0.18), (EX + 0.1, s * 0.34, EZ + 0.2),
                          (EX - 0.1, s * 0.34, EZ + 0.2), (EX - 0.26, s * 0.3, EZ + 0.17)], 8), 0.008, 8)
    child(new_object("Loom", bm, "Plastic", sharp=60), pe)
    # engine mounts to the subframe
    piece("Mounts", multi(*[rb((EX + dx, s * 0.2, EZ - 0.17), (0.06, 0.06, 0.05), bevel=0.01)
                            for dx in (0.18, -0.18) for s in (1, -1)]), "Rubber", pe)
    return pe


def turbos():
    pe = part("turbo", (-0.5, 0, 1.6))
    for s in (1, -1):
        tx, ty, tz = EX - 0.45, s * 0.43, EZ + 0.13
        # turbine (hot) housing: a volute that spirals around the wheel
        bm = bmesh.new()
        pts = []
        for k in range(33):
            a = 2 * math.pi * k / 32 * 0.92
            r = 0.055 + 0.03 * k / 32
            pts.append((tx + 0.02, ty + s * r * math.cos(a), tz + r * math.sin(a)))
        tube(bm, pts, 0.026, 16)
        tmp = bmesh.new()
        lathe(tmp, [(0, -0.035), (0.06, -0.035), (0.064, 0.035), (0, 0.035)], 32, closed=True)
        tmp.transform(M((tx + 0.02, ty, tz), (0, 0, -math.pi / 2)))
        merge_into(bm, tmp)
        child(new_object(f"Turbine_{s}", bm, "CastIron", sharp=50), pe)
        # compressor (cold) housing, centre cartridge and inlet
        bm = bmesh.new()
        pts = []
        for k in range(33):
            a = 2 * math.pi * k / 32 * 0.92 + math.pi
            r = 0.055 + 0.028 * k / 32
            pts.append((tx - 0.12, ty + s * r * math.cos(a), tz + r * math.sin(a)))
        tube(bm, pts, 0.024, 16)
        tmp = bmesh.new()
        lathe(tmp, [(0, -0.03), (0.07, -0.03), (0.07, 0.025), (0.045, 0.04), (0.045, 0.07), (0.05, 0.075),
                    (0.04, 0.075), (0, 0.075)], 40, closed=True)
        tmp.transform(M((tx - 0.12, ty, tz), (0, 0, math.pi / 2)))
        merge_into(bm, tmp)
        child(new_object(f"Compressor_{s}", bm, "Aluminium", sharp=50), pe)
        piece(f"Cartridge_{s}", placed(lambda bm: cyl(bm, (0, 0, 0), 0.035, 0.09, segs=24),
                                       M((tx - 0.05, ty, tz), (0, math.pi / 2, 0))), "Gunmetal", pe)
        piece(f"Wastegate_{s}", multi(
            placed(lambda bm: cyl(bm, (0, 0, 0), 0.028, 0.05, segs=24), M((tx + 0.06, ty, tz + 0.1))),
            placed(lambda bm: cyl(bm, (0, 0, 0), 0.034, 0.012, segs=24), M((tx + 0.06, ty, tz + 0.13)))),
              "BlueAnodised", pe)
        # boost piping to the intercooler and back to the plenum
        bm = bmesh.new()
        tube(bm, catmull([(tx - 0.12, ty - s * 0.0, tz + 0.09), (tx - 0.2, ty + s * 0.02, tz + 0.2),
                          (EX - 0.68, s * 0.62, EZ + 0.25), (EX - 0.72, s * 0.62, EZ + 0.18)], 8), 0.028, 16)
        tube(bm, catmull([(EX - 0.72, s * 0.50, EZ + 0.30), (EX - 0.5, s * 0.30, EZ + 0.48),
                          (EX - 0.25, s * 0.10, EZ + 0.44), (EX - 0.22, s * 0.04, EZ + 0.40)], 8), 0.03, 16)
        child(new_object(f"BoostPipes_{s}", bm, "Aluminium", sharp=60), pe)
        # intercooler cores with fins at the rear corners, fed by the side scoops
        cx, cy, cz = EX - 0.72, s * 0.64, EZ + 0.24
        piece(f"Intercooler_{s}", multi(rb((cx, cy, cz), (0.30, 0.07, 0.24), (s * 0.0, 0, 0), bevel=0.006),
                                        rb((cx, cy, cz + 0.135), (0.32, 0.09, 0.03), bevel=0.008),
                                        rb((cx, cy, cz - 0.135), (0.32, 0.09, 0.03), bevel=0.008)),
              "Radiator", pe)
        fins = bmesh.new()
        for k in range(26):
            tmp = bmesh.new()
            bmesh.ops.create_cube(tmp, size=1.0, matrix=M((cx - 0.14 + 0.28 * k / 25, cy, cz), (0, 0, 0),
                                                           (0.002, 0.074, 0.235)))
            merge_into(fins, tmp)
        child(new_object(f"ICFins_{s}", fins, "Aluminium", smooth=False), pe)
    return pe


def merge_into(bm, tmp):
    me = bpy.data.meshes.new("t")
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def exhaust():
    pe = part("exhaust", (-0.9, 0, 0.1))
    bm = bmesh.new()
    for s in (1, -1):
        tx, ty, tz = EX - 0.43, s * 0.43, EZ + 0.13
        tube(bm, catmull([(tx + 0.02, ty + s * 0.0, tz - 0.06), (tx + 0.0, ty, tz - 0.16),
                          (tx - 0.2, s * 0.36, EZ - 0.12), (-1.88, s * 0.24, 0.30)], 10), 0.035, 18)
    child(new_object("Downpipes", bm, "Titanium", sharp=60), pe)
    # catalysts
    piece("Cats", multi(*[placed(lambda bm: lathe(bm, [(0.0, -0.13), (0.035, -0.13), (0.06, -0.09), (0.06, 0.09),
                                                       (0.035, 0.13), (0, 0.13)], 32, closed=True),
                                 M((-1.70, s * 0.33, 0.27), (0, 0, math.pi / 2 + s * 0.4))) for s in (1, -1)]),
          "Titanium", pe)
    # transverse muffler with heat-shield and the four tips
    piece("Muffler", rb((-2.0, 0, 0.38), (0.22, 0.86, 0.17), bevel=0.06), "Titanium", pe)
    piece("HeatShield", rb((-1.99, 0, 0.475), (0.24, 0.9, 0.006), bevel=0.003), "Aluminium", pe)
    tips = bmesh.new()
    for yy in (-0.22, -0.075, 0.075, 0.22):
        tmp = bmesh.new()
        lathe(tmp, [(0.036, -0.22), (0.042, -0.22), (0.042, 0.0), (0.046, 0.005), (0.046, 0.012), (0.04, 0.012),
                    (0.036, 0.0)], 40, closed=True)
        tmp.transform(M((-2.10 - 0.012, yy, 0.40), (0, 0, math.pi / 2)))
        merge_into(tips, tmp)
    child(new_object("Tips", tips, "Titanium", sharp=40), pe)
    bm = bmesh.new()
    for yy in (-0.22, -0.075, 0.075, 0.22):
        cyl(bm, (-2.12, yy, 0.40), 0.035, 0.002, segs=32, rot=(0, math.pi / 2, 0))
    child(new_object("TipsInner", bm, "Underbody", smooth=False), pe)
    return pe


def transmission():
    pe = part("transmission", (-0.8, 0, 0.35))
    gx = -1.55
    piece("BellHousing", placed(lambda bm: lathe(bm, [(0.0, -0.05), (0.17, -0.05), (0.19, 0.0), (0.16, 0.08),
                                                     (0.0, 0.08)], 48, closed=True),
                                M((EX - 0.33, 0, EZ), (0, 0, -math.pi / 2))), "Aluminium", pe)
    piece("Gearbox", multi(rb((gx, 0, EZ - 0.01), (0.5, 0.34, 0.28), bevel=0.05),
                           rb((gx - 0.32, 0, EZ + 0.02), (0.2, 0.24, 0.2), bevel=0.04)), "Aluminium", pe)
    piece("GearboxRibs", multi(*[rb((gx - 0.2 + 0.05 * k, 0, EZ + 0.13), (0.01, 0.3, 0.012), bevel=0.003)
                                 for k in range(9)]), "Aluminium", pe)
    piece("Actuator", rb((gx + 0.05, 0.10, EZ + 0.17), (0.18, 0.08, 0.06), bevel=0.012), "Gunmetal", pe)
    piece("Diff", placed(lambda bm: cyl(bm, (0, 0, 0), 0.12, 0.42, segs=40), M((AXLE_R, 0, TYRE_R["R"]),
                                                                            (math.pi / 2, 0, 0))),
          "Gunmetal", pe)
    t = text_mesh("7-SPEED DCT", 0.026, (gx, 0.171, EZ), (math.pi / 2, 0, 0), "Chrome", 0.0015, "GearboxText")
    child(t, pe)
    # drive shafts with CV boots
    for s in (1, -1):
        bm = bmesh.new()
        z = TYRE_R["R"]
        tube(bm, [(AXLE_R, s * 0.2, z), (AXLE_R, s * 0.68, z)], 0.022, 16)
        child(new_object(f"Driveshaft_{s}", bm, "Gunmetal", sharp=60), pe)
        bm = bmesh.new()
        for y0 in (0.25, 0.63):
            tmp = bmesh.new()
            prof = [(0.0, -0.05)] + [(0.035 + 0.01 * (k % 2), -0.05 + 0.1 * k / 8) for k in range(9)] + [(0.0, 0.05)]
            lathe(tmp, prof, 24, closed=True)
            tmp.transform(M((AXLE_R, s * y0, z)))
            merge_into(bm, tmp)
        child(new_object(f"CVBoots_{s}", bm, "Rubber", sharp=60), pe)
    return pe


def cooling():
    pe = part("cooling", (0.7, 0, 0.6))
    for s in (1, -1):
        cx, cy, cz = 1.86, s * 0.58, 0.27
        piece(f"Radiator_{s}", multi(rb((cx, cy, cz), (0.05, 0.40, 0.22), (0, 0.45, s * 0.35), bevel=0.005),
                                     rb((cx, cy + s * 0.215, cz), (0.07, 0.03, 0.26), (0, 0.45, s * 0.35), bevel=0.008),
                                     rb((cx, cy - s * 0.215, cz), (0.07, 0.03, 0.26), (0, 0.45, s * 0.35), bevel=0.008)),
              "Radiator", pe)
        fins = bmesh.new()
        for k in range(30):
            tmp = bmesh.new()
            bmesh.ops.create_cube(tmp, size=1.0, matrix=M((0, -0.19 + 0.38 * k / 29, 0), (0, 0, 0),
                                                           (0.052, 0.002, 0.215)))
            tmp.transform(M((cx, cy, cz), (0, 0.45, s * 0.35)))
            merge_into(fins, tmp)
        child(new_object(f"RadFins_{s}", fins, "Aluminium", smooth=False), pe)
        piece(f"Fan_{s}", placed(lambda bm: lathe(bm, [(0.0, -0.03), (0.13, -0.03), (0.13, 0.03), (0.0, 0.03)],
                                                  40, closed=True), M((cx - 0.07, cy, cz), (0, 0, math.pi / 2 + s * 0.35))),
              "Plastic", pe)
        # coolant lines running back to the engine along the sills
        bm = bmesh.new()
        tube(bm, catmull([(cx - 0.05, cy - s * 0.1, cz - 0.05), (1.5, s * 0.55, 0.2), (0.9, s * 0.62, 0.19),
                          (-0.6, s * 0.62, 0.19), (EX + 0.1, s * 0.52, EZ - 0.05)], 6), 0.017, 12)
        child(new_object(f"CoolantLine_{s}", bm, "HoseBlue", sharp=60), pe)
    return pe


def frunk():
    pe = part("frunk", (0.6, 0, 1.0))
    piece("FrunkTub", rb((1.48, 0, 0.37), (0.62, 0.86, 0.2), bevel=0.05), "Carpet", pe)
    piece("Battery", rb((1.62, 0.25, 0.505), (0.18, 0.24, 0.07), bevel=0.01), "Plastic", pe)
    piece("BatteryTerm", multi(rb((1.66, 0.17, 0.545), (0.025, 0.025, 0.02), bevel=0.003),
                               rb((1.66, 0.33, 0.545), (0.025, 0.025, 0.02), bevel=0.003)), "RedAnodised", pe)
    piece("ECU", rb((1.62, -0.24, 0.495), (0.16, 0.2, 0.05), bevel=0.008), "Aluminium", pe)
    piece("BrakeFluid", placed(lambda bm: cyl(bm, (0, 0, 0), 0.04, 0.08, segs=24), M((1.18, 0.33, 0.53))),
          "GlassClear", pe)
    piece("FluidCaps", placed(lambda bm: cyl(bm, (0, 0, 0), 0.025, 0.02, segs=24), M((1.18, 0.33, 0.58))),
          "Gold", pe)
    return pe


# ================================================================== chassis and suspension
def chassis():
    pe = part("chassis", (0, 0, -0.65))
    # carbon monocoque tub
    piece("TubFloor", rb((0.2, 0, 0.155), (1.65, 1.5, 0.03), bevel=0.01), "CarbonMatte", pe)
    for s in (1, -1):
        piece(f"Sill_{s}", rb((0.15, s * 0.80, 0.27), (1.55, 0.14, 0.24), bevel=0.04), "CarbonMatte", pe)
    piece("Tunnel", rb((0.25, 0, 0.25), (1.4, 0.22, 0.18), bevel=0.04), "CarbonMatte", pe)
    piece("Firewall", rb((-0.66, 0, 0.47), (0.04, 1.4, 0.62), bevel=0.015), "CarbonMatte", pe)
    piece("FrontBulkhead", rb((1.02, 0, 0.42), (0.04, 1.3, 0.5), bevel=0.015), "CarbonMatte", pe)
    piece("Carpet", rb((0.2, 0, 0.175), (1.5, 1.4, 0.012), bevel=0.004), "Carpet", pe)
    # aluminium rear subframe cradling the engine, front crash structure
    bm = bmesh.new()
    for s in (1, -1):
        tube(bm, [(-0.66, s * 0.55, 0.2), (-1.4, s * 0.55, 0.2), (-2.05, s * 0.45, 0.25)], 0.025, 12)
        tube(bm, [(-0.66, s * 0.62, 0.62), (-1.2, s * 0.62, 0.6), (-1.95, s * 0.5, 0.55)], 0.022, 12)
        tube(bm, [(-1.2, s * 0.62, 0.6), (-1.4, s * 0.55, 0.2)], 0.018, 10)
        tube(bm, [(-0.66, s * 0.62, 0.62), (-1.0, s * 0.55, 0.2)], 0.018, 10)
        tube(bm, [(1.04, s * 0.42, 0.25), (1.75, s * 0.42, 0.22), (2.05, s * 0.38, 0.22)], 0.028, 12)
        tube(bm, [(1.04, s * 0.42, 0.55), (1.55, s * 0.40, 0.55)], 0.022, 10)
    for x in (-1.95, -1.4):
        tube(bm, [(x, -0.55, 0.22), (x, 0.55, 0.22)], 0.022, 10)
    tube(bm, [(2.05, -0.38, 0.22), (2.05, 0.38, 0.22)], 0.03, 12)
    child(new_object("Subframes", bm, "Aluminium", sharp=60), pe)
    piece("CrashBox", rb((2.12, 0, 0.22), (0.1, 0.9, 0.08), bevel=0.02), "Gunmetal", pe)
    # fuel cell behind the seats
    piece("FuelCell", rb((-0.57, 0, 0.32), (0.13, 1.1, 0.28), bevel=0.03), "Plastic", pe)
    piece("FuelCap", placed(lambda bm: cyl(bm, (0, 0, 0), 0.03, 0.02, segs=24), M((-0.57, 0.4, 0.47))),
          "Aluminium", pe)
    return pe


def suspension():
    pe = part("suspension", (0, 0, -0.35))
    for ax, tr, front in ((AXLE_F, TRACK_F, True), (AXLE_R, TRACK_R, False)):
        zc = (TYRE_F if front else TYRE_R)["R"]
        for s in (1, -1):
            yo = s * (tr - 0.13)
            arms = bmesh.new()
            for z, yi, spread in ((zc - 0.15, 0.36, 0.17), (zc + 0.13, 0.42, 0.13)):
                for dx in (-spread, spread):
                    tube(arms, [(ax + dx, s * yi, z + 0.01), (ax, yo, z)], 0.014, 10)
            # tie-rod and anti-roll bar link
            tube(arms, [(ax + (0.12 if front else -0.12), s * 0.30, zc - 0.03), (ax + 0.09, yo, zc - 0.02)], 0.009, 8)
            child(new_object(f"Wishbones_{ax}_{s}", arms, "Gunmetal", sharp=60), pe)
            piece(f"Upright_{ax}_{s}", multi(rb((ax, yo + s * 0.01, zc), (0.08, 0.05, 0.30), bevel=0.012),
                                            placed(lambda bm: cyl(bm, (0, 0, 0), 0.06, 0.07, segs=32),
                                                   M((ax, yo + s * 0.045, zc), (math.pi / 2, 0, 0)))),
                  "Aluminium", pe)
            # coil-over: damper body, shaft, spring helix and top hat
            p0 = Vector((ax + 0.0, s * (tr - 0.22), zc - 0.12))
            p1 = Vector((ax + 0.0, s * 0.44, zc + 0.36))
            d = (p1 - p0)
            rot = d.to_track_quat("Z", "Y").to_euler()
            L = d.length
            piece(f"Damper_{ax}_{s}", multi(
                placed(lambda bm: cyl(bm, (0, 0, 0), 0.024, L * 0.55, segs=20), M(p0 + d * 0.3, rot)),
                placed(lambda bm: cyl(bm, (0, 0, 0), 0.009, L * 0.5, segs=12), M(p0 + d * 0.7, rot)),
                placed(lambda bm: cyl(bm, (0, 0, 0), 0.04, 0.012, segs=24), M(p0 + d * 0.92, rot)),
                placed(lambda bm: cyl(bm, (0, 0, 0), 0.036, 0.016, segs=24), M(p0 + d * 0.35, rot))),
                "Gold", pe)
            spring = []
            for k in range(161):
                t = k / 160
                a = t * 2 * math.pi * 7
                spring.append((0.042 * math.cos(a), 0.042 * math.sin(a), L * (0.36 + 0.54 * t) - L / 2))
            bm = bmesh.new()
            tube(bm, spring, 0.0065, 8)
            bm.transform(M(p0 + d * 0.5, rot))
            child(new_object(f"Spring_{ax}_{s}", bm, "Spring", sharp=60), pe)
        bm = bmesh.new()
        tube(bm, catmull([(ax + 0.12 * (1 if front else -1), -0.5, zc + 0.02), (ax + 0.16 * (1 if front else -1), -0.2, zc + 0.05),
                          (ax + 0.16 * (1 if front else -1), 0.2, zc + 0.05), (ax + 0.12 * (1 if front else -1), 0.5, zc + 0.02)], 6),
             0.012, 10)
        child(new_object(f"AntiRoll_{ax}", bm, "Spring", sharp=60), pe)
    return pe


# ================================================================== interior
DRIVER = 1          # left-hand drive: driver on +Y


def seat(name, y, pe):
    hip = Vector((-0.2, y, 0.25))
    rec = -0.38

    def back(loc, size, bevel):
        return rb(hip + Vector(Matrix.Rotation(rec, 3, "Y") @ Vector(loc)), size, (0, rec, 0), bevel=bevel)

    piece(f"{name}_Leather", multi(
        rb(hip + Vector((0.20, 0, -0.03)), (0.46, 0.34, 0.08), bevel=0.03),
        rb(hip + Vector((0.20, 0.205, 0.0)), (0.46, 0.08, 0.13), (0.1, 0, 0), bevel=0.035),
        rb(hip + Vector((0.20, -0.205, 0.0)), (0.46, 0.08, 0.13), (-0.1, 0, 0), bevel=0.035),
        back((-0.02, 0, 0.33), (0.08, 0.34, 0.58), 0.03),
        back((0.02, 0.215, 0.27), (0.13, 0.08, 0.48), 0.035),
        back((0.02, -0.215, 0.27), (0.13, 0.08, 0.48), 0.035),
        back((-0.02, 0, 0.71), (0.09, 0.26, 0.16), 0.04)),
        "Leather", pe, mods=[("SUBSURF", {"levels": 1})])
    piece(f"{name}_Inserts", multi(
        rb(hip + Vector((0.21, 0, 0.012)), (0.40, 0.2, 0.01), bevel=0.004),
        back((0.022, 0, 0.32), (0.01, 0.2, 0.46), 0.004)), "LeatherRed", pe)
    # carbon shell and the harness slots
    piece(f"{name}_Shell", multi(back((-0.085, 0, 0.36), (0.035, 0.5, 0.86), 0.015),
                                 rb(hip + Vector((0.18, 0, -0.085)), (0.52, 0.5, 0.035), bevel=0.012)),
          "Carbon", pe)
    piece(f"{name}_Stitch", multi(
        back((0.03, 0.105, 0.32), (0.004, 0.004, 0.46), 0.0),
        back((0.03, -0.105, 0.32), (0.004, 0.004, 0.46), 0.0)), "Gold", pe)
    piece(f"{name}_Rail", multi(rb(hip + Vector((0.15, 0.18, -0.12)), (0.5, 0.025, 0.02), bevel=0.005),
                                rb(hip + Vector((0.15, -0.18, -0.12)), (0.5, 0.025, 0.02), bevel=0.005)),
          "Aluminium", pe)


def interior():
    ps = part("seats", (-0.2, 0, 1.3))
    seat("SeatL", 0.32, ps)
    seat("SeatR", -0.32, ps)
    # dashboard: one sweep across the cabin, a hooded binnacle for the driver
    pd = part("dashboard", (0.5, 0, 1.15))
    def dash(bm):
        prof = [(0.93, 0.50), (0.88, 0.69), (0.72, 0.735), (0.56, 0.69), (0.50, 0.60), (0.53, 0.50), (0.72, 0.44)]
        prism(bm, prof, "y", -0.80, 0.80)
    piece("Dash", dash, "Leather", pd, mods=[("BEVEL", {"width": 0.02, "segments": 3})])
    piece("DashStitch", placed(lambda bm: box(bm, (0, 0, 0), (0.004, 1.58, 0.004)), M((0.62, 0, 0.72))), "Gold", pd)
    piece("Binnacle", multi(rb((0.6, DRIVER * 0.32, 0.745), (0.2, 0.34, 0.05), (0, -0.25, 0), bevel=0.02),
                            rb((0.55, DRIVER * 0.32, 0.70), (0.06, 0.34, 0.06), (0, 0.4, 0), bevel=0.012)),
          "Alcantara", pd)
    piece("Cluster", rb((0.535, DRIVER * 0.32, 0.665), (0.006, 0.28, 0.085), (0, 0.38, 0), bevel=0.0), "Screen", pd)
    piece("CarbonTrim", rb((0.505, 0, 0.585), (0.02, 1.5, 0.035), (0, 0.4, 0), bevel=0.006), "Carbon", pd)
    vents = bmesh.new()
    for yy in (0.70, -0.70, 0.12, -0.12):
        tmp = bmesh.new()
        lathe(tmp, [(0.035, -0.012), (0.045, -0.012), (0.045, 0.012), (0.035, 0.012)], 32, closed=True)
        tmp.transform(M((0.52, yy, 0.62), (0, 0, math.pi / 2)))
        merge_into(vents, tmp)
    child(new_object("Vents", vents, "Chrome", sharp=40), pd)
    bm = bmesh.new()
    for yy in (0.70, -0.70, 0.12, -0.12):
        for k in range(5):
            tmp = bmesh.new()
            bmesh.ops.create_cube(tmp, size=1.0, matrix=M((0.53, yy, 0.62 - 0.028 + 0.014 * k), (0, 0, 0),
                                                           (0.01, 0.07, 0.003)))
            merge_into(bm, tmp)
    child(new_object("VentVanes", bm, "Gunmetal", smooth=False), pd)
    # pedals
    pedals = bmesh.new()
    for yy, w in ((DRIVER * 0.24, 0.09), (DRIVER * 0.38, 0.06)):
        tmp = bmesh.new()
        rbox(tmp, (0, 0, 0), (0.012, w, 0.11), bevel=0.003)
        tmp.transform(M((0.88, yy, 0.28), (0, -0.35, 0)))
        merge_into(pedals, tmp)
        tmp = bmesh.new()
        tube(tmp, [(0.885, yy, 0.33), (0.95, yy, 0.48)], 0.008, 8)
        merge_into(pedals, tmp)
    child(new_object("Pedals", pedals, "Aluminium", sharp=40), pd)

    # steering wheel: flat-bottomed rim, three spokes, paddles
    pw = part("steering", (-0.55, 0, 0.75))
    c = Vector((0.36, DRIVER * 0.32, 0.6))
    tilt = (0, -1.25, 0)
    T = M(c, tilt)
    bm = bmesh.new()
    rim_pts = []
    for k in range(64):
        a = 2 * math.pi * k / 64
        x, y = 0.175 * math.cos(a), 0.175 * math.sin(a)
        if x < -0.135:
            x = -0.135 - (x + 0.135) * 0.15
        rim_pts.append(Vector((x, y, 0)))
    sweep(bm, rim_pts, [(0.016 * math.cos(a), 0.019 * math.sin(a)) for a in
                        (2 * math.pi * k / 12 for k in range(12))], ups=[(0, 0, 1)] * 64, closed=True)
    bm.transform(T)
    child(new_object("WheelRim", bm, "Alcantara", sharp=60), pw)
    piece("WheelHub", placed(lambda bm: multi(
        lambda b: rbox(b, (0, 0, 0), (0.11, 0.13, 0.05), bevel=0.02),
        lambda b: [bmesh.ops.create_cube(b, size=1.0, matrix=M((0.0, sy * 0.105, 0.0), (0, 0, 0), (0.035, 0.13, 0.02)))
                   for sy in (1, -1)],
        lambda b: bmesh.ops.create_cube(b, size=1.0, matrix=M((-0.095, 0, 0.0), (0, 0, 0), (0.09, 0.03, 0.02))))(bm), T),
          "Carbon", pw, mods=[("BEVEL", {"width": 0.004, "segments": 2})])
    piece("WheelBadge", placed(lambda bm: cyl(bm, (0, 0, 0), 0.026, 0.006, segs=32), T @ M((0, 0, 0.028))),
          "Chrome", pw)
    piece("Paddles", multi(*[placed(lambda bm, sy=sy: rbox(bm, (0, 0, 0), (0.09, 0.05, 0.005), bevel=0.003),
                                    T @ M((0.06, sy * 0.13, -0.035))) for sy in (1, -1)]), "Aluminium", pw)
    piece("Column", placed(lambda bm: cyl(bm, (0, 0, 0), 0.04, 0.22, segs=24, r2=0.05), T @ M((0, 0, -0.12))),
          "Plastic", pw)
    piece("RedMarker", placed(lambda bm: box(bm, (0, 0, 0), (0.02, 0.01, 0.036)), T @ M((0.175, 0, 0))),
          "LeatherRed", pw)

    # centre console with the holographic display
    pc = part("console", (0.0, 0, 1.0))
    piece("Console", multi(rb((0.05, 0, 0.36), (0.75, 0.24, 0.10), bevel=0.03),
                           rb((0.47, 0, 0.47), (0.22, 0.24, 0.24), (0, 0.6, 0), bevel=0.03)), "Leather", pc)
    piece("ConsoleCarbon", multi(rb((0.08, 0, 0.415), (0.6, 0.2, 0.01), bevel=0.004),
                                 rb((0.48, 0, 0.535), (0.2, 0.2, 0.01), (0, 0.65, 0), bevel=0.004)), "Carbon", pc)
    btn = bmesh.new()
    for i in range(3):
        for j in range(4):
            cyl(btn, (0.27 - 0.045 * i, -0.06 + 0.04 * j, 0.425), 0.012, 0.012, segs=16)
    child(new_object("Buttons", btn, "Aluminium", sharp=40), pc)
    piece("StartButton", placed(lambda bm: cyl(bm, (0, 0, 0), 0.018, 0.014, segs=24), M((0.13, 0, 0.428))),
          "LeatherRed", pc)
    piece("Selector", multi(placed(lambda bm: cyl(bm, (0, 0, 0), 0.012, 0.07, segs=16), M((-0.05, 0, 0.45))),
                            placed(lambda bm: ball(bm, (0, 0, 0), 0.028, sub=2, scale=(1.3, 1, 0.8)), M((-0.05, 0, 0.49)))),
          "Aluminium", pc)
    piece("Holo", placed(lambda bm: box(bm, (0, 0, 0), (0.002, 0.2, 0.12)), M((0.47, 0, 0.66), (0, -0.55, 0))),
          "Holo", pc)
    piece("HoloFrame", placed(lambda bm: rbox(bm, (0, 0, 0), (0.04, 0.22, 0.02), bevel=0.006), M((0.5, 0, 0.6))),
          "Chrome", pc)
    # door cards on the doors themselves
    for s, pid in ((1, "door_left"), (-1, "door_right")):
        pe = PARTS[pid]
        piece(f"DoorCard_{s}", multi(rb((0.08, s * 0.80, 0.50), (0.95, 0.03, 0.36), bevel=0.012),
                                     rb((0.0, s * 0.775, 0.52), (0.4, 0.05, 0.05), bevel=0.02)),
              "Leather", pe)
        piece(f"DoorPull_{s}", rb((0.15, s * 0.772, 0.6), (0.12, 0.02, 0.02), bevel=0.006), "Aluminium", pe)
        piece(f"DoorTrim_{s}", rb((0.08, s * 0.784, 0.66), (0.9, 0.004, 0.012), bevel=0.0), "Carbon", pe)


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
    if "render" in args:
        if "quick" in args:
            render(["front34", "side", "rear34", "front"], samples=24, res=(1200, 675), tag="_q")
            skin(True)
            render(["cut", "cutrear"], samples=24, res=(1200, 675), tag="_q")
            skin(False)
        else:
            render(list(VIEWS), samples=128)
