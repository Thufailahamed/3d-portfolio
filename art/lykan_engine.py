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
