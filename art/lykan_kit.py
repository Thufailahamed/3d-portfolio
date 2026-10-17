"""Shared kit for the Lykan build: constants, materials, mesh primitives, part groups, surface tools."""

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
    mat("CastAlu", (0.6, 0.6, 0.6), metal=1.0, rough=0.48)
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
    import tempfile
    path = os.path.join(tempfile.mkdtemp(prefix="lykan_hc_"), "Honeycomb.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    img = bpy.data.images.load(path)
    img.name = "Honeycomb"
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


UVSCALE = {}     # material name -> box-projection tiles per metre (filled in by lykan_textures)


def auto_uv(me):
    """Box-project UVs for meshes that wear a tiling texture and have none of their own."""
    if me.uv_layers:
        return
    for m in me.materials:
        if m and m.name in UVSCALE:
            box_uv(me, UVSCALE[m.name])
            return


def orient(ob, origin, xaxis, normal):
    """Place an object so its local X runs along xaxis and its local Z faces along normal."""
    z = Vector(normal).normalized()
    x = (Vector(xaxis) - z * Vector(xaxis).dot(z)).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = Vector(origin)
    ob.matrix_world = m
    return ob


def box_uv(me, scale):
    """Per-face box projection; faces whose material has its own UVSCALE use that density."""
    names = [m.name if m else "" for m in me.materials]
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        n = f.normal
        a = max(range(3), key=lambda k: abs(n[k]))
        i, j = [k for k in range(3) if k != a]
        sc = UVSCALE.get(names[f.material_index], scale) if f.material_index < len(names) else scale
        for lp in f.loops:
            co = lp.vert.co
            lp[uv].uv = (co[i] * sc, co[j] * sc)
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
    auto_uv(me)
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


def lathe(bm, prof, segs=48, closed=False, a0=0.0, a1=2 * math.pi, cap=False, mat_index=0, uv=False):
    """Revolve (radius, axial) profile points around the local Y axis.
    Full turns are welded; partial arcs can be capped. With uv, U runs round, V along the profile."""
    layer = bm.loops.layers.uv.verify() if uv else None
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
                if layer is not None:
                    v0, v1 = k / (np_ - 1 if not closed else np_), (k + 1) / (np_ - 1 if not closed else np_)
                    for lp, co in zip(f.loops, ((s / segs, v0), (s / segs, v1), ((s + 1) / segs, v1),
                                                ((s + 1) / segs, v0))):
                        lp[layer].uv = co
            except ValueError:
                pass
    if cap and not full and closed:
        for ring in (rings[0], rings[-1]):
            f = bm.faces.new(ring)
            f.material_index = mat_index
    return rings, faces


def tube(bm, pts, r, segs=12, closed_ends=True, uv=None):
    """Sweep a circle along a polyline (smoothed corners via the given points).
    With uv (tiles per metre along the tube), U runs round once and V along the length."""
    pts = [Vector(p) for p in pts]
    layer = bm.loops.layers.uv.verify() if uv else None
    run = [0.0]
    for a, b in zip(pts, pts[1:]):
        run.append(run[-1] + (b - a).length)
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
    for i, (A, B) in enumerate(zip(rings, rings[1:])):
        for k in range(segs):
            f = bm.faces.new((A[k], A[(k + 1) % segs], B[(k + 1) % segs], B[k]))
            if layer is not None:
                u0, u1, v0, v1 = k / segs, (k + 1) / segs, run[i] * uv, run[i + 1] * uv
                for lp, co in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
                    lp[layer].uv = co
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


def finish_fn(fn):
    bm = bmesh.new()
    fn(bm)
    return finish(bm)


def merge_into(bm, tmp):
    me = bpy.data.meshes.new("t")
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
