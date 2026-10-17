"""The engine bay: flat-six, twin turbos, exhaust, gearbox, cooling and the frunk."""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from lykan_kit import *  # noqa: F401,F403


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


# ------------------------------------------------------------------ hardware helpers
def axis_mtx(c, axis):
    """Matrix taking local +Z onto `axis`, centred at c."""
    q = Vector(axis).normalized().to_track_quat("Z", "Y")
    return Matrix.Translation(Vector(c)) @ q.to_matrix().to_4x4()


Y2Z = Matrix.Rotation(math.pi / 2, 4, "X")      # lathe (around Y) -> around Z


def bolt_heads(bm, pts, axis, r=0.0062, h=0.007):
    for p in pts:
        tmp = bmesh.new()
        cyl(tmp, (0, 0, h / 2), r, h, segs=6)
        cyl(tmp, (0, 0, 0.0008), r * 1.35, 0.0016, segs=16)
        tmp.transform(axis_mtx(p, axis))
        merge_into(bm, tmp)


def ring_at(bm, c, axis, r, w=0.012, t=0.004):
    tmp = bmesh.new()
    lathe(tmp, [(r, -w / 2), (r + t, -w / 2), (r + t, w / 2), (r, w / 2)], 32, closed=True)
    tmp.transform(axis_mtx(c, axis) @ Y2Z)
    merge_into(bm, tmp)


def clamp_at(bm, c, axis, r):
    """Band clamp with its T-bolt lug."""
    ring_at(bm, c, axis, r, 0.014, 0.003)
    tmp = bmesh.new()
    rbox(tmp, (0, 0, 0), (0.012, 0.016, 0.02), bevel=0.002)
    tmp.transform(axis_mtx(c, axis) @ M((r + 0.008, 0, 0)))
    merge_into(bm, tmp)


def fitting_at(bm, c, axis, r=0.011):
    """AN hose end: hex nut and a collar."""
    tmp = bmesh.new()
    cyl(tmp, (0, 0, 0), r * 1.25, 0.014, segs=6)
    cyl(tmp, (0, 0, 0.014), r, 0.016, segs=20)
    tmp.transform(axis_mtx(c, axis))
    merge_into(bm, tmp)


def path_frames(pts):
    pts = [Vector(p) for p in pts]
    L = sum((b - a).length for a, b in zip(pts, pts[1:]))
    return pts, L


def hose(name, pts, r, material, pe, segs=14, smooth=8, ends=None, end_mat="BlueAnodised"):
    """A tube along a smoothed path; optional AN fittings at both ends; braided UVs if needed."""
    path = catmull(pts, smooth) if smooth else [Vector(p) for p in pts]
    _, L = path_frames(path)
    bm = bmesh.new()
    tube(bm, path, r, segs, uv=(1.0 / max(L, 1e-3)) if material == "HeatTi" else (12.0 if material == "Braided" else None))
    ob = new_object(name, bm, material, sharp=70)
    child(ob, pe)
    if ends:
        bm = bmesh.new()
        fitting_at(bm, path[0], path[0] - path[1], r)
        fitting_at(bm, path[-1], path[-1] - path[-2], r)
        child(new_object(name + "_Ends", bm, end_mat, sharp=40), pe)
    return path


def volute(bm, c, axis_m, r0, r1, t0, t1, turns=0.88, segs=40, phase=0.0, mirror=1):
    """Snail housing: a tube spiralling round the turbo axis while it swells."""
    pts = []
    for k in range(segs + 1):
        f = k / segs
        a = phase + mirror * 2 * math.pi * turns * f
        r = r0 + (r1 - r0) * f
        pts.append(Vector((r * math.cos(a), r * math.sin(a), 0.0)))
    tmp = bmesh.new()
    rings = []
    for k, p in enumerate(pts):
        f = k / segs
        t = (pts[min(k + 1, segs)] - pts[max(k - 1, 0)]).normalized()
        out = Vector((p.x, p.y, 0)).normalized()
        up = Vector((0, 0, 1))
        rr = t0 + (t1 - t0) * f
        rings.append([tmp.verts.new(p + out * rr * math.cos(q) + up * rr * math.sin(q))
                      for q in (2 * math.pi * j / 16 for j in range(16))])
    for A, B in zip(rings, rings[1:]):
        for j in range(16):
            tmp.faces.new((A[j], A[(j + 1) % 16], B[(j + 1) % 16], B[j]))
    tmp.faces.new(list(reversed(rings[0])))
    tmp.faces.new(rings[-1])
    tmp.transform(axis_m)
    merge_into(bm, tmp)
    return [axis_m @ p for p in pts]


def pleated_cone(bm, c, axis, r0, r1, L, pleats=28, rings_=10):
    tmp = bmesh.new()
    grid_ = []
    n = pleats * 4
    for i in range(rings_ + 1):
        f = i / rings_
        z = L * f
        r = r0 + (r1 - r0) * f
        row = []
        for k in range(n):
            a = 2 * math.pi * k / n
            rr = r * (1.0 + 0.07 * (1 if (k // 2) % 2 == 0 else -1))
            row.append(tmp.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        grid_.append(row)
    for A, B in zip(grid_, grid_[1:]):
        for k in range(n):
            tmp.faces.new((A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]))
    tmp.faces.new(list(reversed(grid_[0])))
    tmp.faces.new(grid_[-1])
    tmp.transform(axis_mtx(c, axis))
    merge_into(bm, tmp)


def loft_tube(bm, xs, sec_fn, segs=28):
    """Loft superellipse sections along X; sec_fn(x) -> (cy, cz, half_w, half_h, power)."""
    rings = []
    for x in xs:
        cy, cz, hw, hh, pw = sec_fn(x)
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            ca, sa = math.cos(a), math.sin(a)
            y = hw * math.copysign(abs(ca) ** (2 / pw), ca)
            z = hh * math.copysign(abs(sa) ** (2 / pw), sa)
            ring.append(bm.verts.new((x, cy + y, cz + z)))
        rings.append(ring)
    for A, B in zip(rings, rings[1:]):
        for k in range(segs):
            bm.faces.new((A[k], B[k], B[(k + 1) % segs], A[(k + 1) % segs]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    return rings


# ================================================================== the flat-six
CYL_X = [EX + 0.16, EX + 0.01, EX - 0.14]
TX, TZ = EX - 0.47, EZ + 0.12          # turbo centres (x, z); y = ±0.40 turbine, ±0.53 compressor


def engine():
    pe = part("engine", (-0.3, 0, 1.25))
    # split crankcase, flange and its bolts, a ribbed dry sump
    piece("Crankcase", multi(*[rb((EX, s * 0.078, EZ), (0.58, 0.15, 0.27), bevel=0.035) for s in (1, -1)]),
          "CastAlu", pe)
    piece("CaseFlange", rb((EX, 0, EZ), (0.60, 0.014, 0.29), bevel=0.004), "CastAlu", pe)
    bm = bmesh.new()
    bolt_heads(bm, [(EX - 0.27 + 0.054 * k, 0, EZ + 0.145) for k in range(11)], (0, 0, 1))
    bolt_heads(bm, [(EX - 0.27 + 0.054 * k, s * 0.12, EZ + 0.137) for k in range(1, 11, 3) for s in (1, -1)], (0, 0, 1))
    child(new_object("CaseBolts", bm, "Chrome", sharp=30), pe)
    piece("CaseRibs", multi(*[rb((EX - 0.22 + 0.11 * k, s * 0.09, EZ + 0.135), (0.012, 0.11, 0.02), bevel=0.004)
                              for k in range(5) for s in (1, -1)]), "CastAlu", pe)
    piece("Sump", rb((EX - 0.02, 0, EZ - 0.17), (0.5, 0.27, 0.07), bevel=0.02), "CastAlu", pe)
    piece("SumpFins", multi(*[rb((EX - 0.22 + 0.05 * k, 0, EZ - 0.21), (0.01, 0.25, 0.02), bevel=0.003)
                              for k in range(9)]), "CastAlu", pe)
    for s in (1, -1):
        # cylinder bank: block, the three bores standing proud, gasket line, head
        bm = bmesh.new()
        rbox(bm, (0, 0, 0), (0.50, 0.19, 0.215), bevel=0.03)
        bm.transform(M((EX + 0.01, s * 0.245, EZ + 0.005)))
        for cx in CYL_X:
            tmp = bmesh.new()
            lathe(tmp, [(0.0, -0.08), (0.076, -0.08), (0.08, -0.07), (0.08, 0.07), (0.076, 0.08), (0.0, 0.08)], 40,
                  closed=True)
            tmp.transform(M((cx, s * 0.25, EZ + 0.005)))
            merge_into(bm, tmp)
        child(new_object(f"Block_{s}", bm, "CastAlu", sharp=40), pe)
        piece(f"Gasket_{s}", rb((EX + 0.01, s * 0.336, EZ + 0.012), (0.53, 0.006, 0.245), bevel=0.002), "Gunmetal", pe)
        piece(f"Head_{s}", rb((EX + 0.01, s * 0.385, EZ + 0.015), (0.53, 0.09, 0.25), bevel=0.02), "CastAlu", pe)
        # twin cam covers in red crinkle with polished fins, logo plates, perimeter bolts
        for z, h, label in ((EZ + 0.085, 0.105, "LYKAN"), (EZ - 0.052, 0.1, "3.7  BITURBO")):
            piece(f"CamCover_{s}_{z:.2f}", rb((EX + 0.01, s * 0.455, z), (0.50, 0.06, h), bevel=0.028, segs=4),
                  "CrinkleRed", pe)
            piece(f"CamFins_{s}_{z:.2f}", multi(*[rb((EX + 0.01, s * 0.487, z + dz), (0.40, 0.006, 0.007), bevel=0.002)
                                                 for dz in (-0.032, 0.032)]), "Aluminium", pe)
            piece(f"CamPlate_{s}_{z:.2f}", rb((EX + 0.01, s * 0.487, z), (0.19, 0.005, 0.042), bevel=0.003),
                  "Aluminium", pe)
            t = text_mesh(label, 0.021 if len(label) < 8 else 0.016, (0, 0, 0), (0, 0, 0), "Underbody", 0.0008,
                          f"CamText_{s}_{z:.2f}")
            orient(t, (EX + 0.01, s * 0.4898, z), (-s, 0, 0), (0, s, 0))
            child(t, pe)
            bm = bmesh.new()
            pts = [(EX + 0.01 + dx, s * 0.486, z + dz) for dx in (-0.22, -0.11, 0.0, 0.11, 0.22) for dz in (-h / 2 + 0.014, h / 2 - 0.014)]
            bolt_heads(bm, pts, (0, s, 0), r=0.0055, h=0.006)
            child(new_object(f"CamBolts_{s}_{z:.2f}", bm, "Chrome", sharp=30), pe)
        # coil-on-plug packs between the covers, a loom with connectors
        coils, caps = bmesh.new(), bmesh.new()
        for cx in CYL_X:
            tmp = bmesh.new()
            cyl(tmp, (0, 0, 0.03), 0.016, 0.06, segs=20)
            tmp.transform(axis_mtx((cx, s * 0.47, EZ + 0.017), (0, s, 0)))
            merge_into(coils, tmp)
            tmp = bmesh.new()
            rbox(tmp, (0, 0, 0), (0.03, 0.024, 0.03), bevel=0.005)
            tmp.transform(M((cx, s * 0.53, EZ + 0.022)))
            merge_into(caps, tmp)
        child(new_object(f"Coils_{s}", coils, "Plastic", sharp=40), pe)
        child(new_object(f"CoilHeads_{s}", caps, "RedAnodised", sharp=40), pe)
        hose(f"CoilLoom_{s}", [(EX + 0.27, s * 0.545, EZ + 0.045)] + [(cx, s * 0.548, EZ + 0.045) for cx in CYL_X] +
             [(EX - 0.25, s * 0.53, EZ + 0.05), (EX - 0.3, s * 0.3, EZ + 0.25)], 0.007, "Plastic", pe, segs=8)
        # cast runners from the plenum to each port, flanges, fuel rail and injectors
        run = bmesh.new()
        fl = bmesh.new()
        inj = bmesh.new()
        for cx in CYL_X:
            pts = catmull([(cx, s * 0.07, EZ + 0.33), (cx, s * 0.19, EZ + 0.33), (cx, s * 0.29, EZ + 0.27),
                           (cx, s * 0.34, EZ + 0.17)], 6)
            tube(run, pts, 0.023, 18)
            tmp = bmesh.new()
            rbox(tmp, (0, 0, 0), (0.07, 0.06, 0.012), bevel=0.004)
            tmp.transform(axis_mtx(pts[-1], pts[-1] - pts[-2]))
            merge_into(fl, tmp)
            tmp = bmesh.new()
            cyl(tmp, (0, 0, 0), 0.0075, 0.05, segs=12)
            cyl(tmp, (0, 0, 0.03), 0.0095, 0.012, segs=12)
            tmp.transform(axis_mtx((cx + 0.03, s * 0.30, EZ + 0.245), (0.0, -s * 0.2, 1)))
            merge_into(inj, tmp)
        child(new_object(f"Runners_{s}", run, "CastAlu", sharp=60), pe)
        child(new_object(f"RunnerFlanges_{s}", fl, "CastAlu", sharp=40), pe)
        child(new_object(f"Injectors_{s}", inj, "BlueAnodised", sharp=40), pe)
        hose(f"FuelRail_{s}", [(EX + 0.27, s * 0.30, EZ + 0.275), (EX - 0.26, s * 0.30, EZ + 0.275)], 0.009, "Chrome",
             pe, smooth=0)
        # exhaust headers: three primaries per bank into a collector at the turbine, heat-tinted
        flg = bmesh.new()
        welds = bmesh.new()
        for k, cx in enumerate(CYL_X):
            port = Vector((cx, s * 0.43, EZ - 0.10))
            tmp = bmesh.new()
            rbox(tmp, (0, 0, 0), (0.07, 0.07, 0.01), bevel=0.004)
            tmp.transform(axis_mtx(port, (0, s, -0.6)))
            merge_into(flg, tmp)
            bolt_heads(flg, [port + Vector((dx, s * 0.006, dz)) for dx, dz in ((0.028, 0.0), (-0.028, 0.0))], (0, s, -0.6),
                       r=0.0055, h=0.006)
            path = hose(f"Primary_{s}_{k}", [port, port + Vector((0, s * 0.04, -0.06)),
                                             Vector((cx - 0.04, s * (0.47 - 0.012 * k), EZ - 0.17)),
                                             Vector((EX - 0.33, s * (0.45 - 0.01 * k), EZ - 0.165 + 0.012 * k)),
                                             Vector((EX - 0.42, s * 0.42, EZ - 0.09)),
                                             Vector((TX + 0.005, s * 0.40, TZ - 0.07))], 0.0185, "HeatTi", pe, segs=14)
            for f in (0.33, 0.62):
                i = int(len(path) * f)
                ring_at(welds, path[i], path[i + 1] - path[i - 1], 0.0185, 0.004, 0.0018)
        child(new_object(f"HeaderFlanges_{s}", flg, "HeatTi", sharp=40), pe)
        child(new_object(f"Welds_{s}", welds, "HeatTi", sharp=60), pe)
    # carbon plenum, its badge, twin throttle bodies
    bm = bmesh.new()
    xs = [EX - 0.26 + 0.53 * i / 24 for i in range(25)]

    def sec(x):
        f = (x - (EX - 0.26)) / 0.53
        bulge = math.sin(math.pi * f) ** 0.35
        return 0.0, EZ + 0.37 + 0.01 * bulge, 0.035 + 0.075 * bulge, 0.02 + 0.045 * bulge, 3.0

    loft_tube(bm, xs, sec)
    ob = new_object("Plenum", finish(bm), "Carbon", sharp=60)
    child(ob, pe)
    piece("PlenumSpine", rb((EX + 0.0, 0, EZ + 0.427), (0.36, 0.05, 0.01), bevel=0.004), "Aluminium", pe)
    t = text_mesh("LYKAN", 0.026, (0, 0, 0), (0, 0, 0), "Underbody", 0.0008, "PlenumBadge")
    orient(t, (EX, 0, EZ + 0.4325), (0, -1, 0), (0, 0, 1))
    child(t, pe)
    for sy in (1, -1):
        c = (EX + 0.305, sy * 0.055, EZ + 0.37)
        piece(f"Throttle_{sy}", multi(
            placed(lambda b: lathe(b, [(0.0, -0.035), (0.036, -0.035), (0.036, 0.035), (0.044, 0.035), (0.044, 0.045),
                                       (0.0, 0.045)], 32, closed=True), M(c, (0, 0, -math.pi / 2))),
            rb((c[0], c[1] + sy * 0.05, c[2] + 0.02), (0.05, 0.045, 0.05), bevel=0.008)), "BrushedDark", pe)
    # fuel crossover in braided line, pressure regulator
    hose("FuelCross", [(EX - 0.26, 0.30, EZ + 0.275), (EX - 0.32, 0.22, EZ + 0.33), (EX - 0.33, 0.0, EZ + 0.35),
                       (EX - 0.32, -0.22, EZ + 0.33), (EX - 0.26, -0.30, EZ + 0.275)], 0.0065, "Braided", pe, ends=True)
    piece("FuelReg", multi(placed(lambda b: cyl(b, (0, 0, 0), 0.02, 0.05, segs=24), M((EX + 0.29, 0.2, EZ + 0.29))),
                           placed(lambda b: cyl(b, (0, 0, 0), 0.012, 0.03, segs=6), M((EX + 0.29, 0.2, EZ + 0.33)))),
          "Gold", pe)
    accessories(pe)
    fluids(pe)
    piece("Mounts", multi(*[rb((EX + dx, s * 0.2, EZ - 0.17), (0.06, 0.06, 0.05), bevel=0.01)
                            for dx in (0.18, -0.18) for s in (1, -1)]), "Rubber", pe)
    piece("Starter", placed(lambda b: lathe(b, [(0, -0.09), (0.045, -0.09), (0.045, 0.07), (0.03, 0.09), (0, 0.09)], 32,
                                            closed=True), M((EX - 0.28, -0.16, EZ - 0.12), (0, 0, math.pi / 2))),
          "BrushedDark", pe)
    return pe


def accessories(pe):
    """Front-end drive: damper, alternator, AC pump, idlers and a ribbed belt round them all."""
    px = EX + 0.315
    pulleys = [((0.0, EZ - 0.02), 0.078), ((0.17, EZ + 0.17), 0.045), ((-0.17, EZ + 0.15), 0.05),
               ((0.0, EZ + 0.25), 0.03), ((0.19, EZ - 0.06), 0.03)]
    bm = bmesh.new()
    for (y, z), r in pulleys:
        tmp = bmesh.new()
        prof = [(0.0, -0.014), (r - 0.006, -0.014), (r, -0.016), (r + 0.006, -0.016), (r + 0.006, 0.016),
                (r, 0.016), (r - 0.006, 0.012), (r * 0.45, 0.012), (r * 0.4, 0.02), (0.0, 0.02)]
        lathe(tmp, prof, 48, closed=True)
        tmp.transform(M((px, y, z), (0, 0, -math.pi / 2)))
        merge_into(bm, tmp)
    child(new_object("Pulleys", bm, "Aluminium", sharp=40), pe)
    bm = bmesh.new()
    lathe(bm, [(0.06, -0.02), (0.084, -0.02), (0.084, 0.02), (0.06, 0.02)], 64, closed=True)
    bm.transform(M((px + 0.03, 0.0, EZ - 0.02), (0, 0, -math.pi / 2)))
    child(new_object("Damper", bm, "Rubber", sharp=40), pe)
    hull = []
    for (y, z), r in pulleys:
        for k in range(64):
            a = 2 * math.pi * k / 64
            hull.append((round(y + (r + 0.006) * math.cos(a), 5), round(z + (r + 0.006) * math.sin(a), 5)))
    hull = convex_hull_2d(hull)
    prof = [(-0.012, 0.0)] + [(-0.012 + 0.024 * k / 12, 0.0 if k % 2 else -0.002) for k in range(13)] + \
           [(0.012, 0.005), (-0.012, 0.005)]
    bm = bmesh.new()
    sweep(bm, [(px, y, z) for y, z in hull], prof, ups=None, closed=True)
    child(new_object("Belt", bm, "Rubber", sharp=60), pe)
    # alternator: finned body with vent slots; AC compressor
    bm = bmesh.new()
    lathe(bm, [(0, -0.075), (0.052, -0.075), (0.06, -0.06), (0.06, 0.055), (0.035, 0.07), (0, 0.07)], 40, closed=True)
    for k in range(14):
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0, matrix=M((0.064, 0, -0.01), (0, 0, 0), (0.008, 0.004, 0.1)))
        tmp.transform(Matrix.Rotation(2 * math.pi * k / 14, 4, "Y"))
        merge_into(bm, tmp)
    bm.transform(M((EX + 0.23, 0.17, EZ + 0.17), (0, 0, -math.pi / 2)))
    child(new_object("Alternator", bm, "CastAlu", sharp=40), pe)
    piece("ACPump", placed(lambda b: lathe(b, [(0, -0.075), (0.056, -0.075), (0.058, -0.06), (0.058, 0.06), (0, 0.06)],
                                           36, closed=True), M((EX + 0.23, -0.17, EZ + 0.15), (0, 0, -math.pi / 2))),
          "BrushedDark", pe)


def fluids(pe):
    """Dry-sump oil tank, filter, coolant bottle, their lines; the main wiring loom."""
    piece("OilTank", multi(placed(lambda b: lathe(b, [(0, -0.13), (0.045, -0.13), (0.062, -0.1), (0.062, 0.1),
                                                      (0.045, 0.13), (0, 0.13)], 40, closed=True), M((EX - 0.05, 0.6, EZ + 0.2), (math.pi / 2, 0, 0)))),
          "Aluminium", pe)
    piece("OilCap", placed(lambda b: cyl(b, (0, 0, 0), 0.028, 0.022, segs=24), M((EX - 0.05, 0.6, EZ + 0.34))),
          "RedAnodised", pe)
    hose("OilFeed", [(EX - 0.05, 0.6, EZ + 0.07), (EX + 0.02, 0.55, EZ - 0.06), (EX + 0.1, 0.38, EZ - 0.12),
                     (EX + 0.12, 0.2, EZ - 0.15)], 0.009, "Braided", pe, ends=True)
    hose("OilReturn", [(EX - 0.12, 0.6, EZ + 0.1), (EX - 0.2, 0.5, EZ - 0.05), (EX - 0.2, 0.25, EZ - 0.17),
                       (EX - 0.15, 0.1, EZ - 0.19)], 0.009, "Braided", pe, ends=True, end_mat="RedAnodised")
    for s in (1, -1):
        hose(f"TurboOil_{s}", [(TX, s * 0.465, TZ + 0.035), (TX + 0.05, s * 0.46, TZ + 0.12), (EX - 0.2, s * 0.42, EZ + 0.2),
                                (EX - 0.18, s * 0.36, EZ + 0.14)], 0.0055, "Braided", pe, ends=True)
        hose(f"TurboDrain_{s}", [(TX, s * 0.465, TZ - 0.035), (TX + 0.02, s * 0.45, TZ - 0.12), (EX - 0.2, s * 0.2, EZ - 0.2)],
             0.01, "Hose", pe)
    bm = bmesh.new()
    lathe(bm, [(0, -0.06), (0.04, -0.06), (0.042, -0.05)] + [(0.042 + 0.002 * (k % 2), -0.045 + 0.009 * k) for k in range(10)]
          + [(0.04, 0.05), (0, 0.05)], 40, closed=True)
    bm.transform(M((EX + 0.18, -0.24, EZ - 0.17), (0, 0, 0)))
    child(new_object("OilFilter", bm, "BlueAnodised", sharp=40), pe)
    piece("Coolant", rb((EX - 0.05, -0.6, EZ + 0.2), (0.13, 0.11, 0.13), bevel=0.03), "GlassClear", pe)
    piece("CoolantFluid", rb((EX - 0.05, -0.6, EZ + 0.17), (0.115, 0.095, 0.07), bevel=0.02), "HoseBlue", pe)
    piece("CoolantCap", placed(lambda b: cyl(b, (0, 0, 0), 0.025, 0.02, segs=24), M((EX - 0.05, -0.6, EZ + 0.275))),
          "BlueAnodised", pe)
    hose("CoolantHose", [(EX - 0.05, -0.6, EZ + 0.14), (EX + 0.08, -0.52, EZ + 0.1), (EX + 0.2, -0.42, EZ + 0.14)],
         0.012, "Hose", pe)
    hose("Loom", [(EX + 0.3, 0.33, EZ + 0.3), (EX + 0.1, 0.36, EZ + 0.32), (EX - 0.1, 0.36, EZ + 0.32),
                  (EX - 0.25, 0.3, EZ + 0.3), (EX - 0.3, 0.0, EZ + 0.31), (EX - 0.25, -0.3, EZ + 0.3),
                  (EX + 0.1, -0.36, EZ + 0.32), (EX + 0.3, -0.33, EZ + 0.3)], 0.011, "Plastic", pe)


def turbos():
    pe = part("turbo", (-0.5, 0, 1.6))
    for s in (1, -1):
        axis = Vector((0, s, 0))
        tc, cc = Vector((TX, s * 0.40, TZ)), Vector((TX, s * 0.535, TZ))
        # turbine: cast-iron volute fed from the collector, axial outlet, V-band
        bm = bmesh.new()
        am = axis_mtx(tc, axis)
        volute(bm, tc, am, 0.05, 0.075, 0.02, 0.032, phase=math.pi * 0.6)
        tmp = bmesh.new()
        lathe(tmp, [(0, -0.035), (0.062, -0.035), (0.066, 0.0), (0.06, 0.03), (0.0, 0.03)], 40, closed=True)
        tmp.transform(am @ Y2Z)
        merge_into(bm, tmp)
        child(new_object(f"Turbine_{s}", bm, "CastIron", sharp=50), pe)
        bm = bmesh.new()
        clamp_at(bm, tc - axis * 0.045, axis, 0.04)
        clamp_at(bm, (tc + cc) / 2 + axis * 0.0, axis, 0.036)
        child(new_object(f"VBands_{s}", bm, "Chrome", sharp=40), pe)
        # centre cartridge
        piece(f"Cartridge_{s}", placed(lambda b: lathe(b, [(0, -0.035), (0.034, -0.035), (0.04, -0.02), (0.04, 0.02),
                                                         (0.034, 0.035), (0, 0.035)], 32, closed=True), am @ M((0, 0, 0.0675)) @ Y2Z),
              "Gunmetal", pe)
        # compressor: aluminium volute, inlet bell, pleated cone filter
        bm = bmesh.new()
        cm = axis_mtx(cc, axis)
        out_pts = volute(bm, cc, cm, 0.05, 0.078, 0.019, 0.03, phase=-math.pi * 0.5, mirror=-1)
        tmp = bmesh.new()
        lathe(tmp, [(0, -0.03), (0.07, -0.03), (0.07, 0.02), (0.05, 0.035), (0.047, 0.07), (0.054, 0.075), (0.054, 0.085),
                    (0.044, 0.085), (0, 0.06)], 48, closed=True)
        tmp.transform(cm @ Y2Z)
        merge_into(bm, tmp)
        child(new_object(f"Compressor_{s}", bm, "CastAlu", sharp=50), pe)
        bm = bmesh.new()
        pleated_cone(bm, cc + axis * 0.085, axis, 0.06, 0.045, 0.12)
        child(new_object(f"Filter_{s}", bm, "LeatherRed", sharp=80), pe)
        piece(f"FilterCap_{s}", multi(
            placed(lambda b: cyl(b, (0, 0, 0), 0.05, 0.012, segs=40), axis_mtx(cc + axis * 0.21, axis)),
            placed(lambda b: lathe(b, [(0.056, -0.008), (0.066, -0.008), (0.066, 0.008), (0.056, 0.008)], 40,
                                   closed=True), axis_mtx(cc + axis * 0.09, axis) @ Y2Z)),
              "Rubber", pe)
        # wastegate actuator and its rod
        piece(f"Wastegate_{s}", multi(
            placed(lambda b: cyl(b, (0, 0, 0), 0.03, 0.045, segs=32), M((TX + 0.09, s * 0.47, TZ + 0.06), (0, math.pi / 2, 0))),
            placed(lambda b: cyl(b, (0, 0, 0), 0.034, 0.008, segs=32), M((TX + 0.115, s * 0.47, TZ + 0.06), (0, math.pi / 2, 0)))),
              "BlueAnodised", pe)
        hose(f"WGRod_{s}", [(TX + 0.065, s * 0.47, TZ + 0.06), (TX + 0.02, s * 0.43, TZ + 0.04)], 0.004, "Chrome", pe,
             smooth=0)
        # heat shield over the hot side
        bm = bmesh.new()
        lathe(bm, [(0.1, -0.06), (0.1, 0.06)], 24, a0=0.15, a1=math.pi - 0.15)
        bm.transform(axis_mtx(tc, axis) @ Y2Z)
        child(new_object(f"TurboShield_{s}", bm, "Foil", sharp=60), pe)
        # boost: compressor -> intercooler -> throttle, silicone couplers and clamps
        start = out_pts[-1] if out_pts else cc + Vector((0, 0, 0.08))
        p1 = hose(f"BoostIn_{s}", [start, start + Vector((-0.02, 0, 0.06)), (EX - 0.62, s * 0.6, EZ + 0.33),
                                    (EX - 0.71, s * 0.63, EZ + 0.375)], 0.026, "Aluminium", pe)
        p2 = hose(f"BoostOut_{s}", [(EX - 0.72, s * 0.56, EZ + 0.35), (EX - 0.6, s * 0.44, EZ + 0.5),
                                     (EX - 0.15, s * 0.25, EZ + 0.53), (EX + 0.28, s * 0.13, EZ + 0.46),
                                     (EX + 0.34, s * 0.075, EZ + 0.4)], 0.028, "Aluminium", pe)
        bm = bmesh.new()
        for path in (p1, p2):
            for f in (0.12, 0.88):
                i = max(1, min(len(path) - 2, int(len(path) * f)))
                c, d = path[i], path[i + 1] - path[i - 1]
                tmp = bmesh.new()
                lathe(tmp, [(0.03, -0.03), (0.034, -0.03), (0.034, 0.03), (0.03, 0.03)], 32, closed=True)
                tmp.transform(axis_mtx(c, d) @ Y2Z)
                merge_into(bm, tmp)
        child(new_object(f"Couplers_{s}", bm, "HoseBlue", sharp=60), pe)
        bm = bmesh.new()
        for path in (p1, p2):
            for f in (0.08, 0.16, 0.84, 0.92):
                i = max(1, min(len(path) - 2, int(len(path) * f)))
                clamp_at(bm, path[i], path[i + 1] - path[i - 1], 0.034)
        child(new_object(f"Clamps_{s}", bm, "Chrome", sharp=40), pe)
        # intercooler: core, cast end tanks, fins
        cx, cy, cz = EX - 0.72, s * 0.64, EZ + 0.24
        piece(f"Intercooler_{s}", rb((cx, cy, cz), (0.30, 0.07, 0.22), bevel=0.004), "Radiator", pe)
        piece(f"ICTanks_{s}", multi(rb((cx, cy, cz + 0.13), (0.32, 0.085, 0.045), bevel=0.018),
                                    rb((cx, cy, cz - 0.13), (0.32, 0.085, 0.045), bevel=0.018)), "CastAlu", pe)
        fins = bmesh.new()
        for k in range(40):
            tmp = bmesh.new()
            bmesh.ops.create_cube(tmp, size=1.0, matrix=M((cx - 0.145 + 0.29 * k / 39, cy, cz), (0, 0, 0),
                                                           (0.0015, 0.072, 0.215)))
            merge_into(fins, tmp)
        child(new_object(f"ICFins_{s}", fins, "Aluminium", smooth=False), pe)
    return pe


def exhaust():
    pe = part("exhaust", (-0.9, 0, 0.1))
    for s in (1, -1):
        tc = Vector((TX, s * 0.40, TZ))
        path = hose(f"Downpipe_{s}", [tc - Vector((0, s * 0.05, 0)), tc - Vector((0, s * 0.1, 0.04)),
                                       (TX - 0.08, s * 0.30, EZ - 0.08), (-1.66, s * 0.30, 0.27),
                                       (-1.88, s * 0.24, 0.32)], 0.034, "HeatTi", pe, segs=18)
        bm = bmesh.new()
        clamp_at(bm, path[2], path[3] - path[1], 0.036)
        child(new_object(f"DownpipeClamp_{s}", bm, "Chrome", sharp=40), pe)
        bm = bmesh.new()
        lathe(bm, [(0.0, -0.13), (0.035, -0.13), (0.062, -0.09), (0.062, 0.09), (0.035, 0.13), (0.0, 0.13)], 40,
              closed=True, uv=True)
        bm.transform(axis_mtx((-1.70, s * 0.30, 0.28), (-1, -s * 0.15, 0.1)) @ Y2Z)
        child(new_object(f"Cat_{s}", bm, "Titanium", sharp=40), pe)
    piece("Muffler", rb((-2.0, 0, 0.38), (0.22, 0.86, 0.17), bevel=0.06, segs=5), "Titanium", pe)
    piece("MufflerSeams", multi(*[rb((-2.0, y, 0.38), (0.226, 0.006, 0.176), bevel=0.06, segs=5) for y in (-0.3, 0.3)]),
          "HeatTi", pe)
    piece("HeatShield", rb((-1.99, 0, 0.475), (0.24, 0.9, 0.006), bevel=0.003), "Foil", pe)
    piece("Hangers", multi(*[rb((-2.0, y, 0.5), (0.03, 0.02, 0.05), bevel=0.006) for y in (-0.35, 0.35)]), "Rubber", pe)
    tips = bmesh.new()
    inner = bmesh.new()
    for yy in (-0.22, -0.075, 0.075, 0.22):
        tmp = bmesh.new()
        lathe(tmp, [(0.036, -0.22), (0.042, -0.22), (0.042, 0.0), (0.047, 0.006), (0.047, 0.013), (0.039, 0.013),
                    (0.036, 0.0)], 48, closed=True, uv=True)
        tmp.transform(M((-2.10 - 0.012, yy, 0.40), (0, 0, math.pi / 2)))
        merge_into(tips, tmp)
        tmp = bmesh.new()
        lathe(tmp, [(0.033, -0.06), (0.033, 0.0)], 32)
        tmp.transform(M((-2.10 - 0.012, yy, 0.40), (0, 0, math.pi / 2)))
        merge_into(inner, tmp)
        cyl(inner, (-2.06, yy, 0.40), 0.034, 0.002, segs=32, rot=(0, math.pi / 2, 0))
    child(new_object("Tips", tips, "HeatTi", sharp=40), pe)
    child(new_object("TipsInner", inner, "Underbody", sharp=60), pe)
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
        tube(bm, catmull([(cx - 0.05, cy - s * 0.1, cz - 0.05), (1.5, s * 0.5, 0.15), (1.0, s * 0.52, 0.125),
                          (-0.6, s * 0.52, 0.125), (EX + 0.1, s * 0.52, EZ - 0.05)], 6), 0.017, 12)
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
