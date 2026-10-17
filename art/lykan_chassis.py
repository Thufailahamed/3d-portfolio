"""Wheels, tyres, brakes, the carbon tub, subframes and suspension."""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from lykan_kit import *  # noqa: F401,F403


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
