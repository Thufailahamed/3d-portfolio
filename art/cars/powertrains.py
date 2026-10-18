"""
Engines for the downloaded car models that came without one, built from the Lykan kit (art/lykan_*.py):
the Aston Martin Vulcan's 7.0 L V12, the Land Cruiser 300's V35A twin-turbo V6 and an inline-six turbo for
the Supra GT300. split_cars.py calls `build(key)` after splitting a
car and parents what comes back under its Part_<id> empties.

Coordinates are the split script's: metres, x forward (nose at +x), y to the car's left, z up from the floor.
An engine is laid out round its crank: `E` places the crank axis in the car, and each cylinder bank has its
own frame (`bank_m`) whose local z runs up the bores and whose local y points out of the vee.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lykan_engine import (Y2Z, axis_mtx, bolt_heads, clamp_at, convex_hull_2d, fitting_at,  # noqa: E402
                          loft_tube, pleated_cone, ring_at, volute)
from lykan_kit import (MATS, M, catmull, child, cyl, empty, lathe, mat, materials, merge_into,  # noqa: E402
                       new_object, orient, rbox, sweep, text_mesh, tube)
from lykan_textures import upgrade  # noqa: E402


# ------------------------------------------------------------------ small helpers
class Builder:
    """Collects the objects for one part; every mesh is built in a local frame and moved by `mtx`."""

    def __init__(self, name):
        self.root = empty(f"Build_{name}")
        self.objs = []

    def add(self, name, fn, material, mtx=Matrix.Identity(4), sharp=40, smooth=True):
        bm = bmesh.new()
        fn(bm)
        bm.transform(mtx)
        ob = new_object(name, bm, material, sharp=sharp, smooth=smooth)
        child(ob, self.root)
        self.objs.append(ob)
        return ob

    def tube(self, name, pts, r, material, segs=14, smooth=8, ends=None, end_mat="BlueAnodised", uv=None):
        """A pipe along a smoothed world-space path, optionally with AN fittings on both ends."""
        path = catmull(pts, smooth) if smooth else [Vector(p) for p in pts]
        if uv is None:
            uv = 12.0 if material == "Braided" else (1.0 / max(sum((b - a).length for a, b in zip(path, path[1:])), 1e-3)
                                                    if material == "HeatTi" else None)
        bm = bmesh.new()
        tube(bm, path, r, segs, uv=uv)
        ob = new_object(name, bm, material, sharp=70)
        child(ob, self.root)
        self.objs.append(ob)
        if ends:
            bm = bmesh.new()
            fitting_at(bm, path[0], path[0] - path[1], r)
            fitting_at(bm, path[-1], path[-1] - path[-2], r)
            self.objs.append(child(new_object(name + "_Ends", bm, end_mat, sharp=40), self.root))
        return path

    def text(self, name, s, size, origin, xaxis, normal, material="Aluminium", extrude=0.0012):
        t = text_mesh(s, size, (0, 0, 0), (0, 0, 0), material, extrude, name)
        orient(t, origin, xaxis, normal)
        child(t, self.root)
        self.objs.append(t)
        return t


def rb(loc, size, bevel=0.01, segs=3, rot=(0, 0, 0)):
    def f(bm):
        tmp = bmesh.new()
        rbox(tmp, (0, 0, 0), size, bevel=bevel, segs=segs)
        tmp.transform(M(loc, rot))
        merge_into(bm, tmp)
    return f


def multi(*fns):
    def f(bm):
        for fn in fns:
            fn(bm)
    return f


def at(fn, mtx):
    def f(bm):
        tmp = bmesh.new()
        fn(tmp)
        tmp.transform(mtx)
        merge_into(bm, tmp)
    return f


def revolve(prof, segs=40):
    """A lathe profile [(radius, axial)] turned round local z."""
    return lambda bm: (lathe(bm, prof, segs, closed=True), bm.transform(Y2Z))


def pulley(r, w=0.03, ribs=6):
    prof = [(0.0, -w / 2), (r * 0.42, -w / 2), (r * 0.46, -w / 2 - 0.006), (r - 0.004, -w / 2 - 0.006)]
    prof += [(r + (0.003 if k % 2 else 0.0), -w / 2 + w * k / (2 * ribs)) for k in range(2 * ribs + 1)]
    prof += [(r - 0.004, w / 2 + 0.004), (r * 0.46, w / 2 + 0.004), (r * 0.4, w / 2 + 0.012), (0.0, w / 2 + 0.012)]
    return revolve(prof, 48)


# ------------------------------------------------------------------ the parametric engine
def engine(B, s):
    """Build one engine from spec `s` into builder B. Returns the world-space points later steps hang off."""
    E = Matrix.Translation((s["cx"], 0.0, s["zc"]))
    n_bank = s["n"] // (1 if s["layout"] == "I" else 2)
    pitch, br, H, hh, cc = s["pitch"], s["bore"], s["deck"], s["head"], s["cover"]
    L = n_bank * pitch + 0.06                  # bank length
    Wb = 2 * br + 0.05                         # bank width
    banks = [(-1, 0.0)] if s["layout"] == "I" else [(1, -s["stagger"] / 2), (-1, s["stagger"] / 2)]
    half = math.radians(s.get("angle", 0) / 2)

    def bank_m(side, dx=0.0):
        tilt = -side * half if s["layout"] == "V" else math.radians(s.get("tilt", 0))
        return E @ Matrix.Translation((dx, 0, 0)) @ Matrix.Rotation(tilt, 4, "X")

    def cyl_x(k, dx):
        return dx + (k - (n_bank - 1) / 2) * pitch

    ports = {"exhaust": [], "intake": []}
    tops = []
    for side, dx in banks:
        Bm = bank_m(side, dx)
        o = side                               # local +y·o points out of the vee
        tag = "L" if side > 0 else "R"
        # cast block half: barrel bosses for each bore, ribs between them
        def block(bm, dx=dx, o=o):
            rbox(bm, (0, 0, 0), (L, Wb, H - 0.05), bevel=0.02)
            bm.transform(M((dx, 0, 0.025 + H / 2)))
            for k in range(n_bank):
                tmp = bmesh.new()
                lathe(tmp, [(0.0, -0.5), (br + 0.012, -0.5), (br + 0.016, 0.0), (br + 0.012, 0.5), (0.0, 0.5)], 32, closed=True)
                tmp.transform(M((cyl_x(k, dx), o * (Wb / 2 - br * 0.55), 0.06 + (H - 0.06) / 2), (0, 0, 0),
                                (1, 1, (H - 0.08))) @ Y2Z)
                merge_into(bm, tmp)
            for k in range(n_bank + 1):
                tmp = bmesh.new()
                rbox(tmp, (0, 0, 0), (0.012, 0.022, H - 0.07), bevel=0.004)
                tmp.transform(M((dx + (k - n_bank / 2) * pitch, o * (Wb / 2 + 0.008), 0.03 + H / 2)))
                merge_into(bm, tmp)
        B.add(f"Block_{tag}", block, "CastAlu", Bm)
        B.add(f"Gasket_{tag}", rb((dx, 0, H + 0.003), (L + 0.01, Wb + 0.01, 0.006), 0.002), "Gunmetal", Bm)
        B.add(f"Head_{tag}", rb((dx, 0, H + 0.006 + hh / 2), (L + 0.02, Wb + 0.03, hh), 0.018), "CastAlu", Bm)
        # head bolts along both edges of the head
        def hbolts(bm, dx=dx):
            pts = [(cyl_x(k, dx) + e * pitch / 2, y, H + 0.006 + hh * 0.75) for k in range(n_bank) for e in (-1, 1)
                   for y in (Wb / 2 + 0.016, -Wb / 2 - 0.016)]
            bolt_heads(bm, pts, (0, 0, 1), r=0.007, h=0.01)
        B.add(f"HeadBolts_{tag}", bhold(hbolts), "Chrome", Bm, sharp=30)
        # cam cover: crinkle-finish shell, two raised fins, its bolts, a cast badge
        zc0 = H + 0.006 + hh
        B.add(f"CamCover_{tag}", rb((dx, 0, zc0 + cc / 2), (L - 0.01, Wb + 0.01, cc), 0.026, 4), s["cover_mat"], Bm)
        B.add(f"CamFins_{tag}", multi(*[rb((dx, y, zc0 + cc + 0.004), (L - 0.12, 0.008, 0.01), 0.003)
                                        for y in (Wb * 0.3, -Wb * 0.3)]), "Aluminium", Bm)
        def cbolts(bm, dx=dx):
            pts = [(dx + e * (L / 2 - 0.03), y, zc0 + cc - 0.004) for e in (-1, -0.33, 0.33, 1) for y in (Wb / 2 - 0.01, -Wb / 2 + 0.01)]
            bolt_heads(bm, pts, (0, 0, 1), r=0.0055, h=0.006)
        B.add(f"CoverBolts_{tag}", bhold(cbolts), "Chrome", Bm, sharp=30)
        # coil-on-plug packs standing in the cover's spine, a loom along them
        def coils(bm, dx=dx):
            for k in range(n_bank):
                tmp = bmesh.new()
                cyl(tmp, (0, 0, 0.0), 0.017, 0.05, segs=20)
                rbox(tmp, (0, 0, 0.032), (0.04, 0.03, 0.022), bevel=0.005)
                tmp.transform(M((cyl_x(k, dx), 0, zc0 + cc + 0.014)))
                merge_into(bm, tmp)
        B.add(f"Coils_{tag}", coils, "Plastic", Bm)
        loom = [Bm @ Vector((cyl_x(k, dx), -0.03, zc0 + cc + 0.05)) for k in range(n_bank)]
        B.tube(f"CoilLoom_{tag}", [loom[0] + (Bm.to_3x3() @ Vector((pitch * 0.8, 0, 0)))] + loom +
               [loom[-1] - (Bm.to_3x3() @ Vector((pitch * 0.8, 0, -0.02)))], 0.008, "Plastic", segs=10)
        lab = s["labels"][0 if side > 0 or s["layout"] == "I" else 1]
        if lab:
            plate = Bm @ Vector((dx - L * 0.18, Wb * 0.0, zc0 + cc + 0.0015))
            B.add(f"Plate_{tag}", rb((dx - L * 0.18, 0, zc0 + cc - 0.002), (0.22 if len(lab) > 6 else 0.14, Wb * 0.42, 0.008), 0.003),
                  "Aluminium", Bm)
            nrm = Bm.to_3x3() @ Vector((0, 0, 1))
            B.text(f"Badge_{tag}", lab, 0.024 if len(lab) < 8 else 0.017, plate + nrm * 0.0035,
                   Bm.to_3x3() @ Vector((1, 0, 0)), nrm, "CrinkleBlack")
        if side > 0 or s["layout"] == "I":     # oil filler on one cover
            B.add(f"OilCap_{tag}", at(revolve([(0, 0), (0.026, 0), (0.026, 0.02), (0.022, 0.028), (0, 0.028)], 32),
                                       M((dx + L * 0.33, 0, zc0 + cc - 0.004))), "RedAnodised", Bm)
        # port positions on the head's two faces, in the car's frame
        for k in range(n_bank):
            x = cyl_x(k, dx)
            ports["exhaust"].append((Bm @ Vector((x, o * (Wb / 2 + 0.018), H + hh * 0.42)), Bm.to_3x3() @ Vector((0, o, -0.35)), side))
            ports["intake"].append((Bm @ Vector((x, -o * (Wb / 2 + 0.018), H + hh * 0.6)), Bm.to_3x3() @ Vector((0, -o, 0.4)), side))
        tops.append(Bm @ Vector((dx, 0, zc0 + cc)))

    # crankcase and the sump under it (a shallow dry-sump pan with fins on the race engines)
    wc = (2 * (H * math.sin(half) + Wb / 2 * math.cos(half)) if s["layout"] == "V" else Wb + 0.04) * 0.92
    B.add("Crankcase", rb((0, 0, -0.03), (L + 0.03, wc, 0.17), 0.03), "CastAlu", E)
    sump_d = s.get("sump", 0.12)
    B.add("Sump", rb((-0.02, 0, -0.115 - sump_d / 2), (L - 0.04, wc * 0.82, sump_d), 0.02), "CastAlu", E)
    B.add("SumpFins", multi(*[rb((-L / 2 + 0.06 + k * (L - 0.12) / 8, 0, -0.12 - sump_d), (0.008, wc * 0.7, 0.018), 0.003)
                             for k in range(9)]), "CastAlu", E)
    def sbolts(bm):
        pts = [(-L / 2 + 0.03 + k * (L - 0.06) / 7, y, -0.118) for k in range(8) for y in (wc * 0.43, -wc * 0.43)]
        bolt_heads(bm, pts, (0, 0, -1), r=0.0055, h=0.006)
    B.add("SumpBolts", bhold(sbolts), "Chrome", E, sharp=30)

    # timing cover over the front of both banks: a cast plate following their outline
    pts2 = []
    for side, dx in banks:
        Bm = bank_m(side, dx)
        for y in (-Wb / 2 - 0.015, Wb / 2 + 0.015):
            for z in (0.0, H + hh + cc * 0.6):
                p = Bm @ Vector((0, y, z))
                pts2.append((round(p.y, 5), round(p.z - s["zc"], 5)))
    pts2 += [(wc / 2, -0.11), (-wc / 2, -0.11)]
    hull = convex_hull_2d(pts2)
    xf = L / 2 + max(abs(dx) for _, dx in banks)
    def tcover(bm):
        A = [bm.verts.new((xf, y, z)) for y, z in hull]
        C = [bm.verts.new((xf + 0.035, y * 0.97, z * 0.97)) for y, z in hull]
        bm.faces.new(list(reversed(A)))
        bm.faces.new(C)
        for k in range(len(hull)):
            bm.faces.new((A[k], A[(k + 1) % len(A)], C[(k + 1) % len(C)], C[k]))
    B.add("TimingCover", tcover, "CastAlu", E, sharp=35)
    def tbolts(bm):
        pts = [(xf + 0.036, y * 0.9, z * 0.9) for y, z in hull[::2]]
        bolt_heads(bm, pts, (1, 0, 0), r=0.0055, h=0.006)
    B.add("TimingBolts", bhold(tbolts), "Chrome", E, sharp=30)

    # front-end accessory drive: crank damper, alternator, AC, idlers, ribbed belt round the lot
    px = xf + 0.06
    top = max(z for _, z in hull)
    drive = [((0.0, -0.02), 0.085), ((wc * 0.34, top * 0.62), 0.042), ((-wc * 0.34, top * 0.52), 0.052),
             ((0.0, top * 0.75), 0.034), ((wc * 0.22, 0.12), 0.03), ((-wc * 0.2, 0.18), 0.03)]
    B.add("Pulleys", multi(*[at(pulley(r), M((px, y, z), (0, math.pi / 2, 0))) for (y, z), r in drive]), "Aluminium", E)
    B.add("Damper", at(revolve([(0.062, -0.02), (0.09, -0.02), (0.09, 0.02), (0.062, 0.02)], 64),
                       M((px + 0.032, 0, -0.02), (0, math.pi / 2, 0))), "Rubber", E)
    hullp = []
    for (y, z), r in drive:
        for k in range(48):
            a = 2 * math.pi * k / 48
            hullp.append((round(y + (r + 0.004) * math.cos(a), 5), round(z + (r + 0.004) * math.sin(a), 5)))
    hullp = convex_hull_2d(hullp)
    prof = [(-0.012, 0.0)] + [(-0.012 + 0.024 * k / 12, 0.0 if k % 2 else -0.002) for k in range(13)] + [(0.012, 0.005), (-0.012, 0.005)]
    def belt(bm):
        sweep(bm, [(px, y, z) for y, z in hullp], prof, ups=[(1, 0, 0)] * len(hullp), closed=True)
    B.add("Belt", belt, "Rubber", E, sharp=60)
    (ay, az), ar = drive[1]
    def alternator(bm):
        lathe(bm, [(0, -0.07), (0.05, -0.07), (0.058, -0.055), (0.058, 0.05), (0.034, 0.066), (0, 0.066)], 40, closed=True)
        for k in range(16):
            tmp = bmesh.new()
            bmesh.ops.create_cube(tmp, size=1.0, matrix=M((0.061, 0, -0.005), (0, 0, 0), (0.007, 0.004, 0.09)))
            tmp.transform(Matrix.Rotation(2 * math.pi * k / 16, 4, "Y"))
            merge_into(bm, tmp)
        bm.transform(M((px - 0.085, ay, az), (0, 0, -math.pi / 2)))
    B.add("Alternator", alternator, "CastAlu", E)
    (cy_, cz_), _ = drive[2]
    B.add("ACPump", at(revolve([(0, -0.08), (0.058, -0.08), (0.06, -0.065), (0.06, 0.065), (0, 0.065)], 36),
                       M((px - 0.09, cy_, cz_), (0, math.pi / 2, 0))), "BrushedDark", E)
    # oil filter, dipstick, starter, engine mounts
    fy = -wc / 2 - 0.03
    B.add("OilFilter", at(revolve([(0, -0.06), (0.04, -0.06), (0.042, -0.05)] +
                                  [(0.042 + 0.002 * (k % 2), -0.045 + 0.009 * k) for k in range(10)] + [(0.04, 0.05), (0, 0.05)], 40),
                          M((L * 0.25, fy, -0.06), (math.pi / 2, 0, 0))), s.get("filter_mat", "BlueAnodised"), E)
    dip = E @ Vector((L * 0.1, wc / 2 + 0.02, -0.04))
    B.tube("Dipstick", [dip, dip + Vector((0.0, 0.03, 0.12)), dip + Vector((0.02, 0.04, 0.3))], 0.005, "Chrome", segs=8)
    B.add("DipHandle", at(revolve([(0.012, -0.004), (0.022, -0.004), (0.022, 0.004), (0.012, 0.004)], 24),
                          M(tuple(dip + Vector((0.02, 0.04, 0.325))), (math.pi / 2, 0, 0))), "Gold")
    B.add("Starter", at(revolve([(0, -0.09), (0.042, -0.09), (0.042, 0.06), (0.03, 0.085), (0, 0.085)], 32),
                        M((-L / 2 + 0.02, -wc / 2 + 0.01, -0.07), (0, math.pi / 2, 0))), "BrushedDark", E)
    B.add("Mounts", multi(*[rb((0.0, y * (wc / 2 + 0.045), -0.02), (0.08, 0.05, 0.06), 0.012) for y in (1, -1)]), "Rubber", E)
    B.add("MountArms", multi(*[rb((0.0, y * (wc / 2 + 0.015), -0.02), (0.06, 0.03, 0.09), 0.006) for y in (1, -1)]), "CastIron", E)
    # bellhousing at the back
    xb = -L / 2 - max(abs(dx) for _, dx in banks)
    bell_r = s.get("bell", 0.2)
    B.add("Bellhousing", at(revolve([(0.0, 0.0), (bell_r + 0.05, 0.0), (bell_r + 0.06, -0.02), (bell_r + 0.02, -0.1),
                                     (bell_r * 0.75, -0.2), (bell_r * 0.55, -0.22), (0.0, -0.22)], 48),
                            M((xb, 0, -0.01), (0, math.pi / 2, 0))), "CastAlu", E)
    def bbolts(bm):
        pts = [(xb - 0.02, (bell_r + 0.045) * math.cos(a), -0.01 + (bell_r + 0.045) * math.sin(a))
               for a in (2 * math.pi * k / 14 for k in range(14))]
        bolt_heads(bm, pts, (-1, 0, 0), r=0.0065, h=0.008)
    B.add("BellBolts", bhold(bbolts), "Chrome", E, sharp=30)
    return dict(E=E, L=L, Wb=Wb, wc=wc, xf=xf, xb=xb, top=top, ports=ports, tops=tops, half=half, banks=banks,
                bank_m=bank_m)


def bhold(fn):
    """bolt_heads builds straight into the bmesh; wrap so it fits Builder.add."""
    return fn


# ------------------------------------------------------------------ exhaust and induction
def headers(B, g, s, collect):
    """Primaries from each exhaust port, heat-tinted, into a collector per bank at `collect(side)`."""
    welds = bmesh.new()
    flg = bmesh.new()
    for i, (p, d, side) in enumerate(g["ports"]["exhaust"]):
        c = collect(side)
        k = sum(1 for q in g["ports"]["exhaust"][:i] if q[2] == side)
        tmp = bmesh.new()
        rbox(tmp, (0, 0, 0), (0.06, 0.055, 0.01), bevel=0.004)
        tmp.transform(axis_mtx(p, d))
        merge_into(flg, tmp)
        out = p + d.normalized() * 0.07
        mid = Vector((p.x * 0.6 + c.x * 0.4, c.y * 0.92 + p.y * 0.08 + side * 0.012 * k, (p.z + c.z) / 2 - 0.05))
        path = B.tube(f"Primary_{side}_{k}", [p, out, mid, c + Vector((0.08 * (1 if c.x > p.x else -1), 0, 0.02 * k)), c],
                      s.get("primary", 0.019), "HeatTi", segs=14)
        for f in (0.3, 0.65):
            j = max(1, min(len(path) - 2, int(len(path) * f)))
            ring_at(welds, path[j], path[j + 1] - path[j - 1], s.get("primary", 0.019), 0.004, 0.0016)
    B.objs.append(child(new_object("HeaderFlanges", flg, "HeatTi", sharp=40), B.root))
    B.objs.append(child(new_object("HeaderWelds", welds, "HeatTi", sharp=60), B.root))


def turbo(B, name, tc, axis, scale=1.0, filt=True):
    """Turbine (cast iron) and compressor (aluminium) on one shaft along `axis`; returns the compressor outlet."""
    axis = Vector(axis).normalized()
    cc = tc + axis * 0.135 * scale
    am = axis_mtx(tc, axis)
    def turbine(bm):
        volute(bm, tc, am, 0.05 * scale, 0.075 * scale, 0.02 * scale, 0.032 * scale, phase=math.pi * 0.6)
        tmp = bmesh.new()
        lathe(tmp, [(0, -0.035 * scale), (0.062 * scale, -0.035 * scale), (0.066 * scale, 0.0), (0.06 * scale, 0.03 * scale),
                    (0.0, 0.03 * scale)], 40, closed=True)
        tmp.transform(am @ Y2Z)
        merge_into(bm, tmp)
    B.add(f"{name}_Turbine", turbine, "CastIron", sharp=50)
    B.add(f"{name}_Cartridge", at(revolve([(0, -0.035), (0.034, -0.035), (0.04, -0.02), (0.04, 0.02), (0.034, 0.035), (0, 0.035)], 32),
                                   am @ M((0, 0, 0.0675 * scale)) @ Matrix.Scale(scale, 4)), "Gunmetal")
    cm = axis_mtx(cc, axis)
    holder = {}
    def comp(bm):
        holder["out"] = volute(bm, cc, cm, 0.05 * scale, 0.078 * scale, 0.019 * scale, 0.03 * scale, phase=-math.pi * 0.5, mirror=-1)
        tmp = bmesh.new()
        lathe(tmp, [(0, -0.03), (0.07, -0.03), (0.07, 0.02), (0.05, 0.035), (0.047, 0.07), (0.054, 0.075), (0.054, 0.085),
                    (0.044, 0.085), (0, 0.06)], 48, closed=True)
        tmp.transform(cm @ Matrix.Scale(scale, 4) @ Y2Z)
        merge_into(bm, tmp)
    B.add(f"{name}_Compressor", comp, "CastAlu", sharp=50)
    bm = bmesh.new()
    clamp_at(bm, tc - axis * 0.045 * scale, axis, 0.04 * scale)
    clamp_at(bm, (tc + cc) / 2, axis, 0.036 * scale)
    B.objs.append(child(new_object(f"{name}_VBands", bm, "Chrome", sharp=40), B.root))
    up = (Vector((0, 0, 1)) - axis * axis.z).normalized()
    B.add(f"{name}_Wastegate", at(multi(lambda b: cyl(b, (0, 0, 0), 0.024 * scale, 0.04 * scale, segs=32),
                                        lambda b: cyl(b, (0, 0, 0.022 * scale), 0.027 * scale, 0.006 * scale, segs=32)),
                                  axis_mtx(tc + axis * 0.1 * scale + up * 0.085 * scale, up)), "Gunmetal")
    B.tube(f"{name}_WGRod", [tc + axis * 0.1 * scale + up * 0.06 * scale, tc + axis * 0.02 * scale + up * 0.05 * scale], 0.003,
           "Chrome", smooth=0)
    def shield(bm):
        lathe(bm, [(0.1 * scale, -0.06 * scale), (0.1 * scale, 0.06 * scale)], 24, a0=0.15, a1=math.pi - 0.15)
        bm.transform(am @ Y2Z)
    B.add(f"{name}_Shield", shield, "Foil", sharp=60)
    if filt:
        bm = bmesh.new()
        pleated_cone(bm, cc + axis * 0.085 * scale, axis, 0.06 * scale, 0.045 * scale, 0.12 * scale)
        B.objs.append(child(new_object(f"{name}_Filter", bm, "Rubber", sharp=80), B.root))
    out = holder.get("out")
    return (out[-1] if out else cc + Vector((0, 0, 0.08))), cc


def plenum(B, name, x0, x1, sec, material):
    bm = bmesh.new()
    loft_tube(bm, [x0 + (x1 - x0) * i / 28 for i in range(29)], sec)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_object(name, bm, material, sharp=60)
    B.objs.append(child(ob, B.root))
    return ob


def runners(B, name, ports, target, r, material, lift=0.08):
    """One runner per intake port, rising from the head into `target(port)`; flanged at the head."""
    run = bmesh.new()
    fl = bmesh.new()
    for p, d, side in ports:
        t = target(p, side)
        pts = catmull([p, p + d.normalized() * 0.05, (p + t) / 2 + Vector((0, 0, lift)), t], 6)
        tube(run, pts, r, 18)
        tmp = bmesh.new()
        rbox(tmp, (0, 0, 0), (r * 3.0, r * 2.8, 0.012), bevel=0.004)
        tmp.transform(axis_mtx(p, d))
        merge_into(fl, tmp)
    B.objs.append(child(new_object(name, run, material, sharp=60), B.root))
    B.objs.append(child(new_object(name + "Flanges", fl, "CastAlu", sharp=40), B.root))


def fuel_rails(B, g, s):
    """Injectors at every intake port and a rail joining each bank's."""
    inj = bmesh.new()
    for side in sorted({q[2] for q in g["ports"]["intake"]}):
        ps = [(p, d) for p, d, sd in g["ports"]["intake"] if sd == side]
        rail = []
        for p, d in ps:
            c = p + d.normalized() * 0.06 + Vector((0, 0, 0.035))
            tmp = bmesh.new()
            cyl(tmp, (0, 0, 0), 0.0075, 0.05, segs=12)
            cyl(tmp, (0, 0, 0.03), 0.0095, 0.012, segs=12)
            tmp.transform(axis_mtx(c, Vector((0, 0, 1)) - d.normalized() * 0.3))
            merge_into(inj, tmp)
            rail.append(c + Vector((0, 0, 0.04)))
        B.tube(f"FuelRail_{side}", [rail[0] + Vector((0.05, 0, 0))] + rail + [rail[-1] - Vector((0.05, 0, 0))], 0.009, "Chrome", smooth=0)
    B.objs.append(child(new_object("Injectors", inj, "BlueAnodised", sharp=40), B.root))


# ================================================================== the three engines
def vulcan():
    B = Builder("engine")
    s = dict(layout="V", angle=60, n=12, cx=0.95, zc=0.225, pitch=0.104, stagger=0.026, bore=0.047, deck=0.21,
             head=0.088, cover=0.05, cover_mat="CrinkleBlack", labels=("ASTON MARTIN", "V12"), sump=0.035, bell=0.19,
             primary=0.018, filter_mat="Aluminium")
    g = engine(B, s)
    E = g["E"]
    # long-tube headers sweeping back under the car towards the side exits
    headers(B, g, s, lambda side: Vector((0.42, side * 0.43, 0.13)))
    for side in (1, -1):
        c = Vector((0.42, side * 0.43, 0.13))
        B.tube(f"Tailpipe_{side}", [c, c + Vector((-0.12, side * 0.06, -0.01)), Vector((0.12, side * 0.6, 0.15))], 0.038, "HeatTi", segs=20)
    # carbon intake plenum over the vee, fed by two throttle bodies from a nose airbox
    zt = max(t.z for t in g["tops"]) + 0.035
    x0, x1 = E.translation.x - g["L"] / 2 - 0.02, E.translation.x + g["L"] / 2 + 0.02
    def sec(x):
        f = (x - x0) / (x1 - x0)
        b = math.sin(math.pi * f) ** 0.3
        return 0.0, zt + 0.012 * b, 0.07 + 0.055 * b, 0.03 + 0.022 * b, 3.2
    plenum(B, "Plenum", x0, x1, sec, "Carbon")
    B.add("PlenumSpine", rb((E.translation.x, 0, zt + 0.062), (g["L"] * 0.8, 0.05, 0.008), 0.003), "Aluminium")
    B.text("PlenumBadge", "ASTON MARTIN RACING", 0.022, Vector((E.translation.x, 0, zt + 0.0665)), (1, 0, 0), (0, 0, 1), "CrinkleBlack")
    runners(B, "Runners", g["ports"]["intake"],
            lambda p, side: Vector((p.x, side * 0.05, zt - 0.02)), 0.021, "Carbon", lift=0.04)
    fuel_rails(B, g, s)
    for sy in (1, -1):
        c = Vector((x1 + 0.03, sy * 0.06, zt + 0.01))
        B.add(f"Throttle_{sy}", at(revolve([(0.0, -0.04), (0.036, -0.04), (0.036, 0.04), (0.044, 0.04), (0.044, 0.05), (0.0, 0.05)], 32),
                                   axis_mtx(c, (1, 0, 0))), "BrushedDark")
        # carbon ducts dropping forward to the intakes in the nose
        B.tube(f"Snorkel_{sy}", [c + Vector((0.05, 0, 0)), c + Vector((0.16, sy * 0.05, -0.02)), Vector((x1 + 0.3, sy * 0.2, 0.42)),
                                 Vector((x1 + 0.42, sy * 0.24, 0.36))], 0.04, "Carbon", segs=24)
        B.add(f"DuctMouth_{sy}", at(revolve([(0.04, -0.01), (0.052, -0.01), (0.056, 0.03), (0.044, 0.03)], 32),
                                    axis_mtx(Vector((x1 + 0.43, sy * 0.24, 0.355)), (1, 0, -0.4))), "CarbonMatte")
    # dry-sump tank, cooling hoses, wiring
    B.add("OilTank", at(revolve([(0, -0.14), (0.045, -0.14), (0.06, -0.11), (0.06, 0.11), (0.045, 0.14), (0, 0.14)], 40),
                        M((0.6, -0.36, 0.42))), "Aluminium")
    B.add("OilTankCap", at(revolve([(0, 0), (0.026, 0), (0.026, 0.02), (0, 0.02)], 24), M((0.6, -0.36, 0.565))), "RedAnodised")
    B.tube("OilFeed", [Vector((0.6, -0.36, 0.28)), Vector((0.65, -0.3, 0.15)), E @ Vector((-0.1, -g["wc"] / 2, -0.15))], 0.009, "Braided",
           ends=True)
    B.tube("OilReturn", [Vector((0.55, -0.36, 0.3)), Vector((0.5, -0.25, 0.12)), E @ Vector((-0.25, -g["wc"] / 2 + 0.03, -0.17))],
           0.009, "Braided", ends=True, end_mat="RedAnodised")
    for sy in (1, -1):
        B.tube(f"Coolant_{sy}", [E @ Vector((g["xf"] + 0.01, sy * 0.12, g["top"] * 0.55)), Vector((1.5, sy * 0.25, 0.42)),
                                 Vector((1.66, sy * 0.3, 0.38))], 0.022, "HoseBlue", segs=16)
    return {"engine": B}


def land_cruiser():
    B = Builder("engine")
    s = dict(layout="V", angle=60, n=6, cx=1.62, zc=0.75, pitch=0.106, stagger=0.03, bore=0.047, deck=0.235,
             head=0.095, cover=0.05, cover_mat="CrinkleBlack", labels=("DOHC 24V", "DOHC 24V"), sump=0.14, bell=0.23,
             primary=0.02, filter_mat="WhitePlastic")
    g = engine(B, s)
    E = g["E"]
    # log manifolds into a turbo low on each side, downpipes back under the floor
    for side in (1, -1):
        tc = E @ Vector((-g["L"] * 0.32, side * (g["wc"] / 2 + 0.11), 0.02))
        headers(B, dict(ports=dict(exhaust=[q for q in g["ports"]["exhaust"] if q[2] == side])), s,
                lambda sd, tc=tc: tc + Vector((0.0, 0, 0.06)))
        outlet, cc = turbo(B, f"Turbo_{side}", tc, (1, 0, 0), scale=0.85, filt=False)
        B.tube(f"Downpipe_{side}", [tc - Vector((0.05, 0, 0)), tc - Vector((0.12, -side * 0.02, 0.1)),
                                    Vector((tc.x - 0.45, side * 0.32, 0.38)), Vector((0.9, side * 0.3, 0.36))], 0.03, "HeatTi", segs=18)
        # boost: along the bank, forward past the timing cover, into the throttle body
        zt_ = max(t.z for t in g["tops"]) + 0.07
        B.tube(f"BoostPipe_{side}", [outlet, outlet + Vector((0.08, side * 0.03, 0.06)),
                                     E @ Vector((g["xf"] - 0.12, side * (g["wc"] / 2 + 0.06), g["top"] * 0.55)),
                                     E @ Vector((g["xf"] + 0.11, side * 0.16, zt_ - E.translation.z - 0.02)),
                                     E @ Vector((g["xf"] + 0.09, side * 0.03, zt_ - E.translation.z + 0.01))], 0.026, "Aluminium", segs=18)
        # fresh air: both inlets from the filter box on the left (the right one crosses over the front)
        inlet = [cc + Vector((0.07, 0, 0)), cc + Vector((0.16, side * 0.03, 0.14)),
                 E @ Vector((g["xf"] + 0.0, side * (g["wc"] / 2 + 0.05), g["top"] + 0.02))]
        if side < 0:
            inlet += [Vector((1.9, -0.12, 1.06)), Vector((1.9, 0.2, 1.04))]
        B.tube(f"TurboInlet_{side}", inlet + [Vector((1.81, 0.4, 0.98))], 0.034, "Hose", segs=18)
    # cast plenum and the plastic engine cover on top, with the throttle body at the front
    zt = max(t.z for t in g["tops"]) + 0.05
    x0, x1 = E.translation.x - g["L"] / 2, E.translation.x + g["L"] / 2
    runners(B, "Runners", g["ports"]["intake"], lambda p, side: Vector((p.x, side * 0.04, zt - 0.01)), 0.022, "CastAlu", lift=0.03)
    plenum(B, "Plenum", x0, x1, lambda x: (0.0, zt + 0.02, 0.09, 0.045, 3.0), "CastAlu")
    B.add("Throttle", at(revolve([(0.0, -0.04), (0.04, -0.04), (0.04, 0.04), (0.048, 0.04), (0.048, 0.05), (0.0, 0.05)], 32),
                         axis_mtx(Vector((x1 + 0.04, 0, zt + 0.02)), (1, 0, 0))), "CastAlu")
    def cover(x):
        f = (x - (x0 - 0.04)) / (g["L"] + 0.12)
        b = math.sin(math.pi * min(max(f, 0), 1)) ** 0.25
        return 0.0, zt + 0.06, 0.04 + 0.21 * b, 0.012 + 0.04 * b, 4.0
    plenum(B, "EngineCover", x0 - 0.04, x1 + 0.08, cover, "TexturedPlastic")
    B.text("CoverBadge", "TWIN TURBO", 0.04, Vector((E.translation.x + 0.02, 0, zt + 0.1125)), (1, 0, 0), (0, 0, 1), "Aluminium",
           extrude=0.002)
    B.text("CoverBadge2", "V6", 0.06, Vector((E.translation.x - 0.17, 0, zt + 0.1125)), (1, 0, 0), (0, 0, 1), "Aluminium",
           extrude=0.002)
    # air filter box on the left; radiator, fan and shroud behind the grille are a part of their own
    B.add("AirBox", rb((1.66, 0.4, 0.98), (0.3, 0.2, 0.16), 0.03), "TexturedPlastic")
    B.add("AirBoxClips", multi(*[rb((1.66 + dx, 0.51, 0.98), (0.02, 0.01, 0.04), 0.004) for dx in (-0.1, 0.0, 0.1)]), "Plastic")
    fuel_rails(B, g, s)
    gearbox_lc(B, g, s)
    R = Builder("radiator")
    R.add("Radiator", rb((2.1, 0, 0.8), (0.05, 0.86, 0.5), 0.004), "Radiator")
    R.add("RadTanks", multi(rb((2.1, 0.45, 0.8), (0.07, 0.05, 0.52), 0.015), rb((2.1, -0.45, 0.8), (0.07, 0.05, 0.52), 0.015)),
          "TexturedPlastic")
    fins = bmesh.new()
    for k in range(60):
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0, matrix=M((2.074, -0.42 + 0.84 * k / 59, 0.8), (0, 0, 0), (0.002, 0.0015, 0.48)))
        merge_into(fins, tmp)
    R.objs.append(child(new_object("RadFins", fins, "Aluminium", smooth=False), R.root))
    def shroud(bm):
        lathe(bm, [(0.21, -0.06), (0.24, -0.02), (0.25, 0.04), (0.21, 0.04)], 48, closed=True)
        bm.transform(Y2Z)
        tmp = bmesh.new()
        rbox(tmp, (0, 0, 0), (0.48, 0.82, 0.012), bevel=0.01)
        tmp.transform(M((0, 0, 0.04)))
        merge_into(bm, tmp)
        bm.transform(M((2.03, 0, 0.8), (0, -math.pi / 2, 0)))
    R.add("FanShroud", shroud, "Plastic")
    def fan(bm):
        cyl(bm, (0, 0, 0), 0.05, 0.05, segs=24)
        for k in range(7):
            tmp = bmesh.new()
            rbox(tmp, (0, 0, 0), (0.17, 0.05, 0.004), bevel=0.0015, segs=1)
            tmp.transform(Matrix.Rotation(2 * math.pi * k / 7, 4, "Z") @ M((0.12, 0, 0), (0.45, 0, 0)))
            merge_into(bm, tmp)
        bm.transform(M((2.0, 0, 0.8), (0, math.pi / 2, 0)))
    R.add("Fan", fan, "Plastic")
    for sy, z in ((1, 0.95), (-1, 0.62)):
        B.tube(f"RadHose_{sy}", [Vector((2.06, sy * 0.36, z)), Vector((1.97, sy * 0.3, z)), E @ Vector((g["xf"] + 0.02, sy * 0.1, g["top"] * 0.5))],
               0.022, "Hose", segs=16)
    R.add("Coolant", rb((1.98, -0.38, 1.0), (0.12, 0.1, 0.14), 0.03), "GlassClear")
    R.add("CoolantFluid", rb((1.98, -0.38, 0.97), (0.105, 0.085, 0.07), 0.02), "CoolantPink")
    return {"engine": B, "radiator": R}


def gearbox_lc(B, g, s):
    """The 10-speed automatic behind the bellhousing."""
    E = g["E"]
    xb = E @ Vector((g["xb"] - 0.22, 0, 0))
    def gearbox(x):
        f = (xb.x - x) / 0.5
        return 0.0, s["zc"] - 0.02 - 0.03 * f, 0.18 - 0.08 * f, 0.17 - 0.07 * f, 3.0
    plenum(B, "Gearbox", xb.x - 0.5, xb.x, gearbox, "CastAlu")
    B.add("GearboxPan", rb((xb.x - 0.2, 0, s["zc"] - 0.2), (0.38, 0.24, 0.05), 0.012), "CastAlu")




def supra():
    B = Builder("engine")
    s = dict(layout="I", tilt=-12, n=6, cx=0.93, zc=0.29, pitch=0.091, bore=0.041, deck=0.24, head=0.1, cover=0.06,
             cover_mat="CrinkleRed", labels=("GR  3.0 TURBO", ""), sump=0.06, bell=0.17, primary=0.02, filter_mat="RedAnodised")
    g = engine(B, s)
    E = g["E"]
    # tubular manifold into one big turbo on the exhaust (right) side, downpipe under the car
    tc = E @ Vector((-0.02, -0.33, 0.16))
    headers(B, g, s, lambda side: tc + Vector((0.0, 0.0, 0.07)))
    outlet, cc = turbo(B, "Turbo", tc, (1, 0, 0), scale=1.15)
    B.tube("Downpipe", [tc - Vector((0.06, 0, 0)), tc - Vector((0.14, 0.02, 0.12)), Vector((0.3, -0.3, 0.14)), Vector((-0.2, -0.3, 0.13))],
           0.04, "HeatTi", segs=20)
    # carbon plenum and runners on the intake (left) side; intercooler pipes to the nose
    zt = E.translation.z + 0.43
    x0, x1 = E.translation.x - g["L"] / 2 + 0.01, E.translation.x + g["L"] / 2
    plenum(B, "Plenum", x0, x1, lambda x: (0.27, zt, 0.07, 0.05 + 0.012 * math.sin(math.pi * (x - x0) / (x1 - x0)), 3.0), "Carbon")
    runners(B, "Runners", g["ports"]["intake"], lambda p, side: Vector((p.x, 0.22, zt - 0.02)), 0.022, "Carbon", lift=0.02)
    B.text("PlenumBadge", "TOYOTA GAZOO RACING", 0.018, Vector((E.translation.x, 0.27, zt + 0.0505)), (1, 0, 0), (0, 0, 1), "Aluminium")
    fuel_rails(B, g, s)
    B.add("Throttle", at(revolve([(0.0, -0.045), (0.042, -0.045), (0.042, 0.045), (0.05, 0.045), (0.05, 0.055), (0.0, 0.055)], 32),
                         axis_mtx(Vector((x1 + 0.045, 0.27, zt)), (1, 0, 0))), "BrushedDark")
    B.tube("BoostHot", [outlet, outlet + Vector((0.1, -0.02, 0.06)), Vector((1.5, -0.3, 0.4)), Vector((1.72, -0.25, 0.32))], 0.03,
           "Aluminium", segs=20)
    B.tube("BoostCold", [Vector((1.72, 0.25, 0.32)), Vector((1.5, 0.3, 0.45)), Vector((x1 + 0.2, 0.28, zt)), Vector((x1 + 0.1, 0.27, zt))],
           0.032, "Aluminium", segs=20)
    bm = bmesh.new()
    for c, d in ((Vector((1.52, -0.3, 0.4)), Vector((1, 0, -0.3))), (Vector((1.5, 0.3, 0.45)), Vector((1, 0, -0.4)))):
        tmp = bmesh.new()
        lathe(tmp, [(0.034, -0.03), (0.038, -0.03), (0.038, 0.03), (0.034, 0.03)], 32, closed=True)
        tmp.transform(axis_mtx(c, d) @ Y2Z)
        merge_into(bm, tmp)
    B.objs.append(child(new_object("Couplers", bm, "HoseRed", sharp=60), B.root))
    B.add("Intercooler", rb((1.74, 0, 0.3), (0.06, 0.62, 0.24), 0.004), "Radiator")
    B.add("ICTanks", multi(rb((1.74, 0.34, 0.3), (0.08, 0.06, 0.26), 0.015), rb((1.74, -0.34, 0.3), (0.08, 0.06, 0.26), 0.015)), "CastAlu")
    # dry-sump tank, braided lines, torque tube to the rear transaxle
    B.add("OilTank", at(revolve([(0, -0.13), (0.045, -0.13), (0.06, -0.1), (0.06, 0.1), (0.045, 0.13), (0, 0.13)], 40),
                        M((0.58, 0.3, 0.4))), "Aluminium")
    B.add("OilTankCap", at(revolve([(0, 0), (0.026, 0), (0.026, 0.02), (0, 0.02)], 24), M((0.58, 0.3, 0.535))), "RedAnodised")
    B.tube("OilFeed", [Vector((0.58, 0.3, 0.27)), Vector((0.62, 0.25, 0.14)), E @ Vector((-0.1, g["wc"] / 2, -0.12))], 0.009, "Braided",
           ends=True)
    B.tube("OilReturn", [Vector((0.53, 0.3, 0.3)), Vector((0.5, 0.2, 0.12)), E @ Vector((-0.2, g["wc"] / 2 - 0.02, -0.12))], 0.009,
           "Braided", ends=True, end_mat="RedAnodised")
    xb = E @ Vector((g["xb"] - 0.22, 0, 0))
    B.add("TorqueTube", at(revolve([(0.0, 0.0), (0.05, 0.0), (0.05, 0.5), (0.0, 0.5)], 32), axis_mtx(xb, (-1, 0, 0))), "Carbon")
    return {"engine": B}


BUILDERS = {
    "aston-martin-vulcan": vulcan,
    "toyota-land-cruiser": land_cruiser,
    "toyota-supra-gt300": supra,
}


def extra_materials():
    mat("WhitePlastic", (0.8, 0.8, 0.78), rough=0.4)
    mat("HoseRed", (0.5, 0.03, 0.02), rough=0.5)
    mat("CoolantPink", (0.7, 0.12, 0.3), rough=0.2)
    mat("TexturedPlastic", (0.03, 0.03, 0.032), rough=0.7)


def build(key):
    """Build the extra parts for `key`. Returns {part id: [objects]}, positioned in the car's frame."""
    if key not in BUILDERS:
        return {}
    materials()
    upgrade()
    extra_materials()
    out = {}
    for pid, B in BUILDERS[key]().items():
        for ob in B.objs:
            mw = ob.matrix_world.copy()
            ob.parent = None
            ob.matrix_world = mw
        bpy.data.objects.remove(B.root)
        out[pid] = B.objs
    return out
