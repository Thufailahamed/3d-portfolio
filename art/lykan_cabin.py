"""The cabin: sculpted quilted buckets and belts, the dashboard and cluster, steering wheel,
centre console with the holographic display, door cards, headliner, mats and pedals.

Left-hand drive (driver on +Y). Seat surfaces are lofted along a side-view seating curve, so the
quilting UVs follow the upholstery rather than a box projection.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from lykan_kit import *  # noqa: F401,F403

DRIVER = 1
SEAT_Y = 0.36
HIP = (-0.17, 0.245)          # x, z of the seat hip point


def lerp_keys(keys, t):
    if t <= keys[0][0]:
        return keys[0][1]
    for (a, va), (b, vb) in zip(keys, keys[1:]):
        if t <= b:
            f = (t - a) / (b - a)
            f = f * f * (3 - 2 * f)
            return va + (vb - va) * f
    return keys[-1][1]


def smoothstep(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


# ================================================================== seats
SEAT_PATH = [(0.31, 0.04), (0.22, 0.025), (0.10, 0.005), (0.0, -0.004), (-0.07, 0.03), (-0.10, 0.14),
             (-0.13, 0.30), (-0.17, 0.47), (-0.205, 0.60), (-0.23, 0.69), (-0.255, 0.78), (-0.27, 0.86),
             (-0.275, 0.905)]
HALF_W = [(-0.01, 0.225), (0.05, 0.245), (0.45, 0.255), (0.6, 0.26), (0.67, 0.19), (0.72, 0.15),
          (0.86, 0.145), (0.92, 0.10)]
BOLSTER = [(-0.01, 0.06), (0.03, 0.105), (0.12, 0.155), (0.40, 0.15), (0.56, 0.085), (0.66, 0.03), (0.92, 0.025)]


def seat_frame():
    """Samples along the seating curve: point, occupant-facing normal, height key, arc length."""
    pts = catmull([Vector((x, 0, z)) for x, z in SEAT_PATH], 5)
    out, run = [], 0.0
    for i, p in enumerate(pts):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        t = (b - a).normalized()
        n = Vector((t.z, 0, -t.x))
        if i:
            run += (p - pts[i - 1]).length
        out.append((p, n, p.z, run))
    return out


def seat(name, y0, pe):
    frame = seat_frame()
    nu = 26
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    rows, pip = [], {-1: [], 1: []}
    for p, n, key, run in frame:
        on_back = p.x < -0.06
        hk = p.z if on_back else (0.0 if p.x < 0.27 else -0.01)
        hw = lerp_keys(HALF_W, hk)
        bol = lerp_keys(BOLSTER, hk if on_back else (0.03 if p.x < 0.25 else -0.01))
        row = []
        for j in range(nu + 1):
            u = j / nu * 2 - 1
            h = bol * smoothstep(0.42, 0.88, abs(u)) - 0.018 * (1 - u * u)
            h -= 0.45 * bol * smoothstep(0.9, 1.0, abs(u))      # roll the bolster crown over
            q = p + n * h + Vector((0, u * hw, 0))
            row.append(bm.verts.new(q))
            if abs(abs(u) - 0.5) < 1e-6 and hk < 0.66:
                pip[1 if u > 0 else -1].append(q + n * 0.003)
        rows.append((row, hw, run, hk))
    quilt_rows = []
    for i in range(len(rows) - 1):
        (A, hwa, ra, ka), (B, hwb, rb_, kb) = rows[i], rows[i + 1]
        for j in range(nu):
            f = bm.faces.new((A[j], A[j + 1], B[j + 1], B[j]))
            um = (j + 0.5) / nu * 2 - 1
            f.material_index = 1 if abs(um) < 0.5 and max(ka, kb) < 0.66 else 0
            for lp, (jj, rr, hw) in zip(f.loops, ((j, ra, hwa), (j + 1, ra, hwa), (j + 1, rb_, hwb), (j, rb_, hwb))):
                uu = jj / nu * 2 - 1
                lp[uvl].uv = (uu * hw * 6.25, rr * 6.25)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    mid = bm.faces[(len(rows) // 2) * nu + nu // 2]
    if mid.normal.x < 0:                     # faces must look at the occupant (+X on the back)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.transform(M((HIP[0], y0, HIP[1])))
    ob = new_object(f"{name}_Upholstery", bm, ["Leather", "QuiltRed", "Carbon"], sharp=70)
    so = ob.modifiers.new("Solid", "SOLIDIFY")
    so.thickness = 0.085
    so.offset = -1
    so.material_offset = 2
    so.material_offset_rim = 0
    sub = ob.modifiers.new("Sub", "SUBSURF")
    sub.levels = sub.render_levels = 1
    bake(ob)
    shade(ob, 70)
    child(ob, pe)
    # piping where the quilted centre meets the bolsters
    bm = bmesh.new()
    T = M((HIP[0], y0, HIP[1]))
    for side, pts in pip.items():
        if len(pts) > 3:
            tube(bm, [T @ q for q in pts], 0.0045, 8)
    child(new_object(f"{name}_Piping", bm, "Leather", sharp=70), pe)
    # embroidered W on the headrest
    p, n, _, _ = min(frame, key=lambda f: abs(f[0].z - 0.80))
    t = text_mesh("W", 0.07, (0, 0, 0), (0, 0, 0), "Gold", 0.0015, f"{name}_Emblem")
    orient(t, T @ (p + n * 0.004), (0, 1, 0), n)
    child(t, pe)
    # carbon pan, aluminium rails, adjuster bar
    piece(f"{name}_Pan", rb((HIP[0] + 0.12, y0, HIP[1] - 0.075), (0.46, 0.44, 0.03), bevel=0.012), "Carbon", pe)
    piece(f"{name}_Rails", multi(rb((HIP[0] + 0.12, y0 + 0.17, 0.195), (0.52, 0.03, 0.025), bevel=0.006),
                                 rb((HIP[0] + 0.12, y0 - 0.17, 0.195), (0.52, 0.03, 0.025), bevel=0.006),
                                 *[rb((HIP[0] + dx, y0 + dy, 0.188), (0.05, 0.05, 0.012), bevel=0.004)
                                   for dx in (-0.12, 0.36) for dy in (0.17, -0.17)]),
          "Aluminium", pe)
    piece(f"{name}_Bar", placed(lambda b: tube(b, catmull([(HIP[0] + 0.40, y0 - 0.12, 0.2), (HIP[0] + 0.44, y0 - 0.05, 0.205),
                                                            (HIP[0] + 0.44, y0 + 0.05, 0.205), (HIP[0] + 0.40, y0 + 0.12, 0.2)], 4),
                                                   0.007, 10), Matrix.Identity(4)), "Aluminium", pe)


def orient_matrix(xaxis, normal):
    z = normal.normalized()
    x = (xaxis - z * xaxis.dot(z)).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed().to_4x4()


def belt(name, y0, pe):
    """Three-point belt hanging from the shoulder anchor down the outboard bolster to the sill."""
    s = 1 if y0 > 0 else -1
    path = catmull([(-0.50, s * 0.66, 0.98), (-0.44, s * 0.62, 0.95), (-0.39, s * 0.585, 0.83),
                    (-0.33, s * 0.60, 0.62), (-0.25, s * 0.62, 0.42), (-0.14, s * 0.635, 0.26)], 6)
    bm = bmesh.new()
    sweep(bm, path, [(-0.024, -0.001), (0.024, -0.001), (0.024, 0.001), (-0.024, 0.001)],
          ups=[(0, s, 0)] * len(path))
    ob = new_object(f"{name}_Belt", finish(bm), "Webbing", sharp=60)
    child(ob, pe)
    piece(f"{name}_Anchor", multi(rb((-0.505, s * 0.665, 0.985), (0.05, 0.02, 0.07), bevel=0.008),
                                  rb((-0.14, s * 0.64, 0.24), (0.05, 0.02, 0.06), bevel=0.008)), "Plastic", pe)
    piece(f"{name}_Tongue", rb((-0.33, s * 0.603, 0.60), (0.035, 0.008, 0.06), (0, -0.3, 0), bevel=0.004),
          "Chrome", pe)
    # buckle stalk on the tunnel side
    piece(f"{name}_Buckle", multi(rb((-0.05, s * 0.135, 0.36), (0.035, 0.03, 0.11), (0, 0.35, 0), bevel=0.01)),
          "Plastic", pe)
    piece(f"{name}_BuckleBtn", rb((-0.035, s * 0.135, 0.415), (0.022, 0.024, 0.008), (0, 0.35, 0), bevel=0.003),
          "LeatherRed", pe)


# ================================================================== dashboard
DASH_PROFILE = [  # (x, z) round the section from the windshield foot, over the top, down the face
    (0.92, 0.70), (0.78, 0.742), (0.62, 0.728), (0.545, 0.695), (0.525, 0.655), (0.535, 0.585),
    (0.555, 0.545), (0.60, 0.47), (0.70, 0.43), (0.85, 0.425), (0.93, 0.5)]
DASH_MATS = ["Leather", "Leather", "Leather", "LeatherRed", "Carbon", "Leather", "Leather", "Alcantara",
             "Plastic", "Plastic", "Plastic"]


def dash_section(y):
    bump = math.exp(-((y - DRIVER * SEAT_Y) / 0.14) ** 4)
    stack = math.exp(-(y / 0.13) ** 4)
    end = smoothstep(0.70, 0.80, abs(y))
    pts = []
    for k, (x, z) in enumerate(DASH_PROFILE):
        if k in (1, 2):
            z += 0.055 * bump
        if k in (2, 3):
            x -= 0.07 * bump
            z += 0.035 * bump
        if k == 3:
            z += 0.01 * bump
        if k in (6, 7):                               # centre stack flows down toward the console
            x -= 0.03 * stack
            z -= 0.06 * stack
        if k == 8:
            x -= 0.10 * stack
            z -= 0.05 * stack
        x += 0.03 * end
        z -= 0.02 * end * (1 if k > 3 else 0)
        pts.append((x, z))
    return pts


def dashboard(pe):
    bm = bmesh.new()
    ys = [-0.79 + 1.58 * i / 72 for i in range(73)]
    rings = []
    for y in ys:
        rings.append([bm.verts.new((x, y, z)) for x, z in dash_section(y)])
    n = len(DASH_PROFILE)
    for end, sgn in ((0, -1), (-1, 1)):
        sec = dash_section(ys[end])
        cx = sum(x for x, _ in sec) / n
        cz = sum(z for _, z in sec) / n
        cap = [bm.verts.new((cx + (x - cx) * 0.75, ys[end] + sgn * 0.012, cz + (z - cz) * 0.75)) for x, z in sec]
        if end == 0:
            rings.insert(0, cap)
        else:
            rings.append(cap)
    crease = bm.edges.layers.float.new("crease_edge")
    for A, B in zip(rings, rings[1:]):
        for k in range(n):
            f = bm.faces.new((A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]))
            f.material_index = k
    for ring in (rings[0], rings[-1]):
        f = bm.faces.new(ring)
        f.material_index = 8
    bm.edges.ensure_lookup_table()
    for A, B in zip(rings, rings[1:]):
        for k in (3, 4, 5, 6):
            e = bm.edges.get((A[k], B[k]))
            if e:
                e[crease] = 0.9
    finish(bm)
    ob = new_object("Dash", bm, DASH_MATS, sharp=60)
    sub = ob.modifiers.new("Sub", "SUBSURF")
    sub.levels = sub.render_levels = 2
    bake(ob)
    while ob.data.uv_layers:
        ob.data.uv_layers.remove(ob.data.uv_layers[0])
    box_uv(ob.data, 6.0)
    shade(ob, 60)
    child(ob, pe)
    # a BVH of the dash so trim can sit on it
    me = ob.data
    bvh = BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [list(p.vertices) for p in me.polygons])

    def on_dash(y, z, back=0.0):
        co, nrm, _, _ = bvh.ray_cast(Vector((0.0, y, z)), Vector((1, 0, 0)), 2.0)
        return co, nrm

    # gold stitching along the top and the red band, and the ambient strip under the brow, all
    # shot onto the subdivided surface from inside the cabin
    def strip(z, off):
        pts = []
        for y in [-0.72 + 1.44 * i / 72 for i in range(73)]:
            co, nrm = on_dash(y, z + 0.06 * math.exp(-((y - DRIVER * SEAT_Y) / 0.14) ** 4))
            if co is not None:
                pts.append(co - Vector((off, 0, 0)))
        return pts

    bm = bmesh.new()
    for z in (0.69,):
        pts = strip(z, 0.0012)
        if len(pts) > 3:
            tube(bm, pts, 0.0011, 5)
    child(new_object("DashStitch", bm, "Gold", sharp=60), pe)
    bm = bmesh.new()
    pts = strip(0.535, 0.002)
    if len(pts) > 3:
        tube(bm, pts, 0.0018, 6)
    child(new_object("Ambient", bm, "TailLED", sharp=60), pe)
    # instrument cluster: a curved screen under the binnacle hood, behind a glass
    cy = DRIVER * SEAT_Y
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    grid_ = []
    for i in range(17):
        u = i / 16
        a = (u - 0.5) * 0.9
        row = []
        for j in range(2):
            v = j
            p = Vector((0.07 * (1 - math.cos(a)) * 2.0, math.sin(a) * 0.17, (v - 0.5) * 0.092))
            row.append(bm.verts.new(p))
        grid_.append(row)
    for i in range(16):
        f = bm.faces.new((grid_[i][0], grid_[i + 1][0], grid_[i + 1][1], grid_[i][1]))
        for lp, uv in zip(f.loops, ((i / 16, 0), ((i + 1) / 16, 0), ((i + 1) / 16, 1), (i / 16, 1))):
            lp[uvl].uv = (1 - uv[0], uv[1])
    co, _ = on_dash(cy, 0.665)
    cx = (co.x if co is not None else 0.53) - 0.012
    bm.transform(M((cx, cy, 0.668), (0, -0.30, 0)))
    child(new_object("Cluster", bm, "Gauges", sharp=80), pe)
    piece("ClusterGlass", rb((cx - 0.012, cy, 0.67), (0.003, 0.33, 0.1), (0, -0.30, 0), bevel=0.0), "GlassClear", pe)
    piece("ClusterHood", rb((cx - 0.03, cy, 0.728), (0.09, 0.36, 0.014), (0, 0.12, 0), bevel=0.006), "Alcantara", pe)
    # turbine vents set into the dash face
    for vy in (0.70, -0.70, 0.17, -0.17):
        co, nrm = on_dash(vy, 0.615)
        if co is None:
            continue
        nrm = -Vector((1, 0, 0)) if nrm.x > 0 else nrm
        vent(f"Vent_{vy:+.2f}", co, nrm, pe)
    # pedals with rubber studs, and the dead pedal
    for yy, w, h, nm in ((DRIVER * 0.27, 0.11, 0.075, "Brake"), (DRIVER * 0.42, 0.065, 0.13, "Throttle")):
        T = M((0.86, yy, 0.30), (0, -0.42, 0))
        piece(f"Pedal{nm}", placed(lambda b, w=w, h=h: rbox(b, (0, 0, 0), (0.012, w, h), bevel=0.004), T),
              "Aluminium", pe)
        studs = bmesh.new()
        for iy in range(-2, 3):
            for iz in range(-3, 4):
                if abs(iy * 0.018) < w / 2 - 0.008 and abs(iz * 0.017) < h / 2 - 0.008:
                    cyl(studs, (-0.007, iy * 0.018, iz * 0.017), 0.004, 0.004, segs=8, rot=(0, math.pi / 2, 0))
        studs.transform(T)
        child(new_object(f"Pedal{nm}Studs", studs, "Rubber", sharp=40), pe)
        piece(f"Pedal{nm}Arm", placed(lambda b: tube(b, [(0.0, 0, 0.02), (0.06, 0, 0.17)], 0.008, 10), T),
              "Aluminium", pe)
    piece("DeadPedal", rb((0.82, DRIVER * 0.58, 0.24), (0.16, 0.08, 0.012), (0, -0.55, 0), bevel=0.004),
          "Aluminium", pe)
    # floor mats with a leather binding and the W
    for ym in (SEAT_Y, -SEAT_Y):
        bm = bmesh.new()
        rr = rounded_rect(0.52, 0.36, 0.05, n=4, cx=0.66, cy=ym)
        prism(bm, rr, "z", 0.181, 0.19)
        child(new_object(f"Mat_{ym:+.2f}", finish(bm), "Carpet", sharp=40), pe)
        bm = bmesh.new()
        tube(bm, [(x, y, 0.19) for x, y in rr] + [(rr[0][0], rr[0][1], 0.19)], 0.005, 6)
        child(new_object(f"MatEdge_{ym:+.2f}", bm, "Leather", sharp=60), pe)
        child(text_mesh("W", 0.05, (0.48, ym, 0.1915), (0, 0, -math.pi / 2), "Chrome", 0.001, "MatBadge"), pe)


def vent(name, co, nrm, pe):
    """Round turbine vent: chrome bezel, twisted vanes round a hub, dark throat."""
    T = Matrix.Translation(co + nrm * 0.004) @ orient_matrix(Vector((0, 0, 1)), nrm)
    bm = bmesh.new()
    lathe(bm, [(0.034, -0.02), (0.044, -0.004), (0.046, 0.004), (0.04, 0.008), (0.034, 0.004)], 40, closed=True)
    bm.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    bm.transform(T)
    child(new_object(f"{name}_Bezel", bm, "Chrome", sharp=40), pe)
    bm = bmesh.new()
    for k in range(9):
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0, matrix=M((0.019, 0, -0.004), (0.6, 0, 0), (0.028, 0.0022, 0.014)))
        tmp.transform(Matrix.Rotation(2 * math.pi * k / 9, 4, "Z"))
        merge_into(bm, tmp)
    cyl(bm, (0, 0, -0.002), 0.008, 0.012, segs=20)
    bm.transform(T)
    child(new_object(f"{name}_Vanes", bm, "BrushedDark", smooth=False), pe)
    bm = bmesh.new()
    cyl(bm, (0, 0, -0.03), 0.035, 0.04, segs=24)
    bm.transform(T)
    child(new_object(f"{name}_Throat", bm, "Underbody", smooth=False), pe)


# ================================================================== steering wheel
def steering(pe):
    c = Vector((0.36, DRIVER * SEAT_Y, 0.60))
    T = M(c, (0, -1.25, 0))
    # D-shaped rim, thicker at the grips; carbon at the top and bottom, suede where the hands go
    segs = 96
    path, prof_scale, mats = [], [], []
    for k in range(segs):
        a = 2 * math.pi * k / segs
        x, y = 0.178 * math.cos(a), 0.178 * math.sin(a)
        if x < -0.138:
            x = -0.138 - (x + 0.138) * 0.12
        path.append(Vector((x, y, 0)))
        grip = math.exp(-((abs(math.sin(a)) - 1.0) / 0.35) ** 2)
        prof_scale.append(1.0 + 0.28 * grip)
        mats.append("Alcantara" if abs(math.cos(a)) < 0.72 else "Carbon")
    ring = 14
    groups = {}
    for k in range(segs):
        groups.setdefault(mats[k], []).append(k)
    for mname in ("Alcantara", "Carbon"):
        bm = bmesh.new()
        idx = groups[mname]
        runs, cur = [], [idx[0]]
        for a, b in zip(idx, idx[1:]):
            if b == a + 1:
                cur.append(b)
            else:
                runs.append(cur)
                cur = [b]
        runs.append(cur)
        if len(runs) > 1 and runs[0][0] == 0 and runs[-1][-1] == segs - 1:
            runs[0] = runs[-1] + runs[0]
            runs.pop()
        for run in runs:
            ks = run + [(run[-1] + 1) % segs]
            pts = [path[k] for k in ks]
            rings = []
            for i, k in enumerate(ks):
                p = path[k]
                t = (path[(k + 1) % segs] - path[(k - 1) % segs]).normalized()
                out = t.cross(Vector((0, 0, 1))).normalized()
                sc = prof_scale[k]
                rings.append([bm.verts.new(p + out * (0.0145 * sc * math.cos(q)) + Vector((0, 0, 0.0185 * sc * math.sin(q))))
                              for q in (2 * math.pi * j / ring for j in range(ring))])
            for A, B in zip(rings, rings[1:]):
                for j in range(ring):
                    bm.faces.new((A[j], A[(j + 1) % ring], B[(j + 1) % ring], B[j]))
            bm.faces.new(list(reversed(rings[0])))
            bm.faces.new(rings[-1])
        bm.transform(T)
        child(new_object(f"WheelRim_{mname}", finish(bm), mname, sharp=70), pe)
    # yellow top marker
    piece("WheelMarker", placed(lambda b: rbox(b, (0, 0, 0), (0.018, 0.034, 0.043), bevel=0.006),
                                T @ M((0.178, 0, 0))), "LeatherRed", pe)
    # hub: leather boss with the W, three brushed spokes, shift lights and buttons
    boss = bmesh.new()
    outline = [(0.045, 0.0), (0.03, 0.065), (-0.035, 0.07), (-0.075, 0.03), (-0.075, -0.03), (-0.035, -0.07),
               (0.03, -0.065)]
    prism(boss, outline, "z", -0.02, 0.035)
    boss.transform(T @ M((-0.01, 0, 0)))
    ob = new_object("WheelBoss", finish(boss), "Leather", sharp=60)
    m = ob.modifiers.new("Bev", "BEVEL")
    m.width = 0.012
    m.segments = 4
    m2 = ob.modifiers.new("Sub", "SUBSURF")
    m2.levels = 1
    bake(ob)
    shade(ob, 60)
    child(ob, pe)
    t = text_mesh("W", 0.045, (0, 0, 0), (0, 0, 0), "Chrome", 0.002, "WheelBadge")
    t.matrix_world = T @ M((-0.015, 0, 0.0475), (0, 0, -math.pi / 2))
    child(t, pe)
    for ang in (0.5 * math.pi, -0.5 * math.pi, math.pi):
        d = Vector((math.cos(ang), math.sin(ang), 0))
        pts = [d * 0.05, d * 0.11, d * 0.168]
        bm = bmesh.new()
        sweep(bm, [Vector((p.x, p.y, 0.006 - 0.008 * i)) for i, p in enumerate(pts)],
              [(-0.026, -0.009), (0.026, -0.009), (0.018, 0.009), (-0.018, 0.009)], ups=[(0, 0, 1)] * 3)
        bm.transform(T)
        child(new_object(f"WheelSpoke_{ang:.1f}", finish(bm), "BrushedDark", sharp=40), pe)
    btn = bmesh.new()
    for sy in (1, -1):
        for k in range(3):
            cyl(btn, (0.012 - k * 0.022, sy * 0.085, 0.004), 0.007, 0.006, segs=16)
    btn.transform(T)
    child(new_object("WheelButtons", btn, "Aluminium", sharp=40), pe)
    piece("Manettino", placed(lambda b: cyl(b, (0, 0, 0), 0.013, 0.012, segs=24), T @ M((-0.06, -0.06, 0.008))),
          "LeatherRed", pe)
    leds = bmesh.new()
    for k in range(9):
        cyl(leds, (0.15, (k - 4) * 0.013, 0.012), 0.0035, 0.003, segs=10)
    leds.transform(T)
    child(new_object("ShiftLights", leds, "LED", smooth=False), pe)
    # big carbon paddles on the column
    for sy in (1, -1):
        bm = bmesh.new()
        prism(bm, [(-0.03, 0.0), (0.07, 0.0), (0.1, 0.05), (0.03, 0.06)], "z", -0.003, 0.003)
        bm.transform(T @ M((0.02, sy * 0.12, -0.045), (0, 0, 0), (1, sy, 1)))
        child(new_object(f"Paddle_{sy}", finish(bm), "Carbon", sharp=40), pe)
    piece("Column", placed(lambda b: cyl(b, (0, 0, 0), 0.042, 0.24, segs=32, r2=0.055), T @ M((0, 0, -0.13))),
          "Leather", pe)


# ================================================================== console
def console(pe):
    """Waterfall from the dash down the tunnel to the armrest between the seats."""
    xs = [0.60 - 1.05 * i / 40 for i in range(41)]
    top = [(0.60, 0.56), (0.52, 0.47), (0.42, 0.42), (0.25, 0.40), (0.0, 0.395), (-0.2, 0.41), (-0.45, 0.43)]
    bm = bmesh.new()
    rings = []
    for x in xs:
        zt = lerp_keys([(-x, z) for x, z in reversed(top)], -x)
        hw = 0.13 if x < 0.45 else 0.13 - (x - 0.45) * 0.25
        sec = [(-hw, 0.30), (hw, 0.30), (hw, zt - 0.03), (hw - 0.025, zt), (-hw + 0.025, zt), (-hw, zt - 0.03)]
        rings.append([bm.verts.new((x, y, z)) for y, z in sec])
    for i, (A, B) in enumerate(zip(rings, rings[1:])):
        for k in range(6):
            f = bm.faces.new((A[k], A[(k + 1) % 6], B[(k + 1) % 6], B[k]))
            f.material_index = 1 if (k == 3 and xs[i] > 0.02) else 0
    for ring in (rings[0], rings[-1]):
        bm.faces.new(ring)
    finish(bm)
    ob = new_object("Console", bm, ["Leather", "Carbon"], sharp=50)
    sub = ob.modifiers.new("Sub", "SUBSURF")
    sub.levels = sub.render_levels = 1
    bake(ob)
    while ob.data.uv_layers:
        ob.data.uv_layers.remove(ob.data.uv_layers[0])
    box_uv(ob.data, 6.0)
    shade(ob, 50)
    child(ob, pe)
    # holographic display: black glass base and the floating image
    piece("HoloBase", rb((0.36, 0, 0.432), (0.16, 0.2, 0.02), (0, 0.12, 0), bevel=0.006), "Glass", pe)
    piece("HoloBezel", rb((0.36, 0, 0.424), (0.175, 0.215, 0.012), (0, 0.12, 0), bevel=0.004), "Chrome", pe)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    vs = [bm.verts.new(p) for p in ((-0.09, -0.09, 0), (0.09, -0.09, 0), (0.09, 0.09, 0), (-0.09, 0.09, 0))]
    f = bm.faces.new(vs)
    for lp, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uvl].uv = uv
    bm.transform(M((0.37, 0, 0.53), (0, -1.15, 0)))
    child(new_object("Hologram", bm, "Holo", smooth=False), pe)
    # toggles, knurled knobs, gear buttons and start
    tog = bmesh.new()
    for k in range(6):
        tmp = bmesh.new()
        rbox(tmp, (0, 0, 0), (0.02, 0.016, 0.008), bevel=0.003)
        tube(tmp, [(0, 0, 0.004), (-0.012, 0, 0.022)], 0.003, 8)
        tmp.transform(M((0.5, -0.075 + 0.03 * k, 0.478), (0, 0.85, 0)))
        merge_into(tog, tmp)
    child(new_object("Toggles", tog, "Chrome", sharp=40), pe)
    for k, y in enumerate((-0.07, 0.07)):
        bm = bmesh.new()
        prof = [(0.0, 0.0), (0.02, 0.0)] + [(0.021 + 0.0012 * (j % 2), 0.0015 + 0.0015 * j) for j in range(10)] + \
               [(0.02, 0.017), (0.0, 0.017)]
        lathe(bm, prof, 40, closed=True)
        bm.transform(M((0.25, y, 0.401), (math.pi / 2, 0, 0)))
        child(new_object(f"Knob_{k}", bm, "Aluminium", sharp=50), pe)
    gb = bmesh.new()
    for k in range(4):
        tmp = bmesh.new()
        rbox(tmp, (0, 0, 0), (0.028, 0.034, 0.01), bevel=0.004)
        tmp.transform(M((0.10 - 0.04 * k, 0.0, 0.40)))
        merge_into(gb, tmp)
    child(new_object("GearButtons", gb, "Aluminium", sharp=40), pe)
    for k, ch in enumerate("PRND"):
        child(text_mesh(ch, 0.016, (0.10 - 0.04 * k, 0.0, 0.4052), (0, 0, -math.pi / 2), "Underbody", 0.0005,
                        f"Gear_{ch}"), pe)
    piece("StartRing", placed(lambda b: lathe(b, [(0.016, 0.0), (0.022, 0.0), (0.022, 0.01), (0.016, 0.01)], 32,
                                              closed=True), M((-0.08, 0.0, 0.398), (math.pi / 2, 0, 0))), "Chrome", pe)
    piece("StartButton", placed(lambda b: cyl(b, (0, 0, 0), 0.0155, 0.012, segs=32), M((-0.08, 0, 0.405))),
          "LeatherRed", pe)
    child(text_mesh("START", 0.006, (-0.08, 0.0, 0.4112), (0, 0, -math.pi / 2), "Chrome", 0.0003, "StartText"), pe)
    # armrest stitching
    bm = bmesh.new()
    for sy in (1, -1):
        tube(bm, [(x, sy * 0.1, lerp_keys([(-x, z) for x, z in reversed(top)], -x) + 0.002)
                  for x in [0.0 - 0.45 * i / 20 for i in range(21)]], 0.001, 5)
    child(new_object("ConsoleStitch", bm, "Gold", sharp=60), pe)


# ================================================================== doors, roof, bulkhead
def door_card(sd, pe):
    """Quilted leather card following the inside of the door, carbon cap, armrest, speaker, handle."""
    rows = []
    zs = [0.28, 0.40, 0.52, 0.62, 0.70]
    xs = [0.66 - 1.15 * i / 24 for i in range(25)]
    bm = bmesh.new()
    for x in xs:
        row = []
        for z in zs:
            co, n = hit((x, 0.25 * sd, z), (0, sd, 0))
            y = (co.y - sd * 0.022) if co is not None else sd * 0.74
            row.append(bm.verts.new((x, y, z)))
        rows.append(row)
    for A, B in zip(rows, rows[1:]):
        for k in range(len(zs) - 1):
            f = bm.faces.new((A[k], B[k], B[k + 1], A[k + 1]))
            f.material_index = 0 if k in (1, 2) else 1
    finish(bm)
    ob = new_object(f"DoorCard_{sd}", bm, ["QuiltBlack", "Leather"], sharp=60)
    so = ob.modifiers.new("Solid", "SOLIDIFY")
    so.thickness = 0.02
    so.offset = 1 if sd > 0 else -1
    bake(ob)
    while ob.data.uv_layers:
        ob.data.uv_layers.remove(ob.data.uv_layers[0])
    box_uv(ob.data, 6.0)
    shade(ob, 60)
    child(ob, pe)
    # armrest, cap, speaker, release handle, ambient strip
    def yin(x, z, off):
        co, n = hit((x, 0.25 * sd, z), (0, sd, 0))
        return (co.y if co is not None else sd * 0.76) - sd * off

    piece(f"DoorArm_{sd}", rb((0.02, yin(0.02, 0.49, 0.07), 0.49), (0.46, 0.07, 0.05), bevel=0.02), "LeatherRed", pe,
          mods=[("SUBSURF", {"levels": 1})])
    pts = [(x, yin(x, 0.70, 0.03), 0.705) for x in [0.62 - 1.1 * i / 20 for i in range(21)]]
    bm = bmesh.new()
    sweep(bm, pts, [(-0.0, -0.012), (sd * 0.03, -0.012), (sd * 0.03, 0.012), (0.0, 0.012)])
    child(new_object(f"DoorCap_{sd}", finish(bm), "Carbon", sharp=40), pe)
    bm = bmesh.new()
    sweep(bm, [(x, y - sd * 0.0, 0.69) for x, y, _ in pts], [(0, -0.0015), (sd * 0.0035, -0.0015),
                                                            (sd * 0.0035, 0.0015), (0, 0.0015)])
    child(new_object(f"DoorAmbient_{sd}", finish(bm), "TailLED", sharp=40), pe)
    ys = yin(0.42, 0.36, 0.022)
    T = M((0.42, ys, 0.36), (sd * math.pi / 2, 0, 0))
    piece(f"Speaker_{sd}", placed(lambda b: cyl(b, (0, 0, 0), 0.06, 0.004, segs=48), T), "Speaker", pe)
    piece(f"SpeakerRing_{sd}", placed(lambda b: lathe(b, [(0.06, -0.003), (0.068, -0.003), (0.068, 0.004),
                                                         (0.06, 0.004)], 48, closed=True), T @ M((0, 0, 0), (math.pi / 2, 0, 0))),
          "Chrome", pe)
    yh = yin(0.30, 0.6, 0.03)
    piece(f"DoorHandle_{sd}", multi(rb((0.30, yh, 0.6), (0.14, 0.02, 0.022), bevel=0.008),
                                    rb((0.30, yh + sd * 0.012, 0.6), (0.17, 0.006, 0.04), bevel=0.003)), "Chrome", pe)


def cabin_shell(pb):
    # alcantara headliner under the roof
    bm = bmesh.new()
    proj_grid(bm, lambda u, v: (-0.56 + 0.56 * u, (v * 2 - 1) * 0.5, 0.6), 16, 12, (0, 0, 1), 0.006)
    ob = new_object("Headliner", bm, "Alcantara", sharp=60)
    for p in ob.data.polygons:
        if p.normal.z > 0:
            p.flip()
    child(ob, pb)
    for sy in (1, -1):
        piece(f"Visor_{sy}", rb((-0.04, sy * 0.30, 1.045), (0.15, 0.30, 0.016), (0, 0.32, 0), bevel=0.007), "Alcantara",
              pb)
        piece(f"VisorClip_{sy}", rb((0.0, sy * 0.05, 1.07), (0.02, 0.03, 0.012), bevel=0.004), "Plastic", pb)
    # quilted bulkhead behind the seats; gold heat foil on the engine side
    piece("BulkheadTrim", rb((-0.495, 0, 0.52), (0.012, 1.3, 0.64), bevel=0.006), "QuiltBlack", pb)
    piece("BulkheadFoil", rb((-0.685, 0, 0.47), (0.004, 1.38, 0.6), bevel=0.0), "Foil", pb)


def interior():
    ps = part("seats", (-0.2, 0, 1.3))
    seat("SeatL", SEAT_Y, ps)
    seat("SeatR", -SEAT_Y, ps)
    belt("SeatL", SEAT_Y, ps)
    belt("SeatR", -SEAT_Y, ps)
    pd = part("dashboard", (0.5, 0, 1.15))
    dashboard(pd)
    pw = part("steering", (-0.55, 0, 0.75))
    steering(pw)
    pc = part("console", (0.0, 0, 1.0))
    console(pc)
    for sd, pid in ((1, "door_left"), (-1, "door_right")):
        door_card(sd, PARTS[pid])
    cabin_shell(PARTS["body"])
