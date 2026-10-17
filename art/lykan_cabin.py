"""The cabin: seats, dashboard, steering wheel, console and door cards."""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from lykan_kit import *  # noqa: F401,F403


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
