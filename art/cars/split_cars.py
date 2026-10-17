"""
Turn a downloaded (Sketchfab-style) car GLB into an exploded-view model like public/models/lykan.glb:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/cars/split_cars.py -- <car> <source.glb> [debug]

<car> is a key in CARS below. The source is normalised to real size (metres, nose along +X, +Y to the
car's left, wheels on the floor), broken into loose pieces, and every piece is sorted into a part by
where it sits and what it is made of: the four tyres are found first, then wheels and brakes, doors
(with their glass, handles and cards), hood, rear lid, lamps, engine, cabin, chassis and body.
Writes public/models/cars/<car>.glb with one `Part_<id>` empty per part carrying `part` and `explode`
(glTF Y-up) extras. With `debug`, also renders art/renders/cars/<car>_parts.png, one colour per part.
"""

import collections
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Boxes are (x0, x1, y0, y1, z0, z1) in metres after normalising; |y| is used where noted.
CARS = {
    "toyota-land-cruiser": dict(
        length=4.985, front="-y",
        paint={"Metallic"}, glass={"Translucent"},
        doors=dict(min_len=0.75, max_len=1.45, min_h=0.45, x0=-1.3, x1=1.0, split_x=-0.15),
        hood=dict(x_min=1.0, z_min=0.95),
        lid=(-2.6, -2.1, 0.0, 0.76, 0.76, 1.9),
        cabin=(-2.25, 1.25, 0.0, 0.82, 0.38, 1.74),
        dash_x=0.62,
        steering=((0.42, 0.43, 1.18), 0.26),
        engine=None,
        lamp_depth=0.42,
        brakes=True,
    ),
    "jaguar-xj13": dict(
        length=4.48, front="+y",
        paint={"Mesh15Mtl"}, glass={"Mesh13Mtl", "Mesh10Mtl"},
        doors=dict(min_len=0.8, max_len=1.15, min_h=0.12, x0=-0.3, x1=0.7, split_x=None),
        hood=dict(x_min=0.55, z_min=0.42),
        lid=(-2.4, -0.25, 0.0, 0.92, 0.55, 1.0),
        cabin=(-0.27, 0.95, 0.0, 0.72, 0.08, 0.98),
        dash_x=0.55,
        steering=((0.64, 0.33, 0.62), 0.2),
        engine=(-1.65, -0.27, 0.0, 0.5, 0.12, 0.9),
        lamp_depth=0.45,
        brakes=False,      # wire wheels: the spokes would read as brake parts
    ),
}

EXPLODE = {   # Blender axes (x fwd, y left, z up); converted to glTF on export
    "body": (0, 0, 1.4), "hood": (0.45, 0, 0.85), "lid": (-0.5, 0, 0.9), "engine": (-0.2, 0, 1.3),
    "headlights": (0.65, 0, 0.15), "taillights": (-0.65, 0, 0.15), "chassis": (0, -2.2, 0),
    "seats": (-0.1, 0, 1.35), "dashboard": (0.45, 0, 1.15), "steering": (-0.45, 0, 0.9),
    "door_fl": (0.1, 1.0, 0.25), "door_fr": (0.1, -1.0, 0.25), "door_rl": (-0.1, 1.0, 0.25),
    "door_rr": (-0.1, -1.0, 0.25), "door_left": (0, 1.0, 0.3), "door_right": (0, -1.0, 0.3),
    "wheel_fl": (0, 1.0, 0), "wheel_fr": (0, -1.0, 0), "wheel_rl": (0, 1.0, 0), "wheel_rr": (0, -1.0, 0),
    "brake_fl": (0, 0.6, 0), "brake_fr": (0, -0.6, 0), "brake_rl": (0, 0.6, 0), "brake_rr": (0, -0.6, 0),
}


# ------------------------------------------------------------------ load and normalise
def load(path, cfg):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    obs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    neutral = bpy.data.materials.new("Neutral")
    neutral.use_nodes = True
    b = neutral.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.09, 0.09, 0.095, 1)
    b.inputs["Metallic"].default_value = 0.4
    b.inputs["Roughness"].default_value = 0.5
    for o in obs:
        o.data = o.data.copy()
        o.data.transform(o.matrix_world)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
        if not o.data.materials:
            o.data.materials.append(neutral)
        else:
            for i, m in enumerate(o.data.materials):
                if m is None:
                    o.data.materials[i] = neutral
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    car = bpy.context.object
    car.name = "Car"
    me = car.data
    me.transform(Matrix.Rotation(-math.pi / 2 if cfg["front"] == "+y" else math.pi / 2, 4, "Z"))
    lo, hi = bounds(me.vertices)
    s = cfg["length"] / (hi.x - lo.x)
    me.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))))
    return car


def bounds(verts):
    xs = [v.co.x for v in verts]
    ys = [v.co.y for v in verts]
    zs = [v.co.z for v in verts]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


# ------------------------------------------------------------------ islands
class Island:
    __slots__ = ("faces", "mat", "lo", "hi", "c", "d", "part")

    def __init__(self, faces, mat, lo, hi):
        self.faces, self.mat, self.lo, self.hi = faces, mat, lo, hi
        self.c = (lo + hi) / 2
        self.d = hi - lo
        self.part = None


def islands(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    names = [m.name if m else "-" for m in me.materials]
    seen = bytearray(len(bm.faces))
    out = []
    for f0 in bm.faces:
        if seen[f0.index]:
            continue
        stack, fs = [f0], []
        seen[f0.index] = 1
        while stack:
            f = stack.pop()
            fs.append(f.index)
            for e in f.edges:
                for g in e.link_faces:
                    if not seen[g.index]:
                        seen[g.index] = 1
                        stack.append(g)
        vs = {v for i in fs for v in bm.faces[i].verts}
        lo, hi = bounds(vs)
        mat = collections.Counter(names[bm.faces[i].material_index] for i in fs).most_common(1)[0][0]
        out.append(Island(fs, mat, lo, hi))
    bm.free()
    return out


def inside(i, box, absy=True):
    x0, x1, y0, y1, z0, z1 = box
    y = abs(i.c.y) if absy else i.c.y
    return x0 <= i.c.x <= x1 and y0 <= y <= y1 and z0 <= i.c.z <= z1


def contains(outer_lo, outer_hi, i, pad):
    return all(outer_lo[k] - pad[k] <= i.lo[k] and i.hi[k] <= outer_hi[k] + pad[k] for k in range(3))


# ------------------------------------------------------------------ classification
def classify(isl, dims, cfg):
    L, Wd, H = dims
    paint, glass = cfg["paint"], cfg["glass"]
    report = {}

    # 1. tyres: round in side view, sitting on the floor, out at the corners
    tyres = {}
    for i in isl:
        dx, dy, dz = i.d
        if 0.4 < dz < 1.0 and abs(dx - dz) < 0.12 * dz and abs(i.c.z - dz / 2) < 0.1 and abs(i.c.y) > 0.25 * Wd \
                and dy < 0.5 and i.mat not in paint:
            q = ("f" if i.c.x > 0 else "r") + ("l" if i.c.y > 0 else "r")
            if q not in tyres or dz > tyres[q].d.z or (abs(dz - tyres[q].d.z) < 0.01 and abs(i.c.y) > abs(tyres[q].c.y)):
                tyres[q] = i
    wheels = {}
    for q, t in tyres.items():
        R = t.d.z / 2
        wheels[q] = dict(c=Vector((t.c.x, t.c.y, R)), R=R, w=max(t.d.y, 0.18))
    report["wheels"] = {q: (round(w["c"].x, 2), round(w["c"].y, 2), round(w["R"], 3)) for q, w in wheels.items()}
    for q, w in wheels.items():
        c, R = w["c"], w["R"]
        s = 1 if c.y > 0 else -1
        for i in isl:
            if i.part or i.mat in paint:
                continue
            r_xz = math.hypot(i.c.x - c.x, i.c.z - c.z) + max(i.d.x, i.d.z) / 2
            if r_xz > R * 1.08 or max(i.d.x, i.d.z) > 2 * R * 1.05:
                continue
            if not (c.y - 0.4 <= i.c.y <= c.y + 0.25 if s > 0 else c.y - 0.25 <= i.c.y <= c.y + 0.4):
                continue
            inboard = abs(i.c.y) < abs(c.y) - 0.02
            small = max(i.d.x, i.d.z) < 1.25 * R
            i.part = ("brake_" if inboard and small and cfg["brakes"] else "wheel_") + q

    # 2. lamps at the very nose and tail
    for i in isl:
        if i.part or i.mat in paint:
            continue
        if abs(i.c.y) > 0.15 * Wd and 0.2 * H < i.c.z < 0.78 * H and max(i.d) < 0.75:
            if i.c.x > L / 2 - cfg["lamp_depth"]:
                i.part = "headlights"
            elif i.c.x < -L / 2 + cfg["lamp_depth"]:
                i.part = "taillights"

    # 3. doors: big painted side panels; whatever sits in the same space goes with them
    dc = cfg["doors"]
    doors = [i for i in isl if not i.part and i.mat in paint and abs(i.c.y) > 0.3 * Wd
             and dc["min_len"] < i.d.x < dc["max_len"] and i.d.z > dc["min_h"] and 0.2 * H < i.c.z < 0.8 * H
             and dc["x0"] < i.c.x < dc["x1"]]
    for i in doors:
        side = "l" if i.c.y > 0 else "r"
        if dc["split_x"] is None:
            i.part = "door_left" if side == "l" else "door_right"
        else:
            i.part = ("door_f" if i.c.x > dc["split_x"] else "door_r") + side
    report["doors"] = [(i.part, round(i.c.x, 2), round(i.d.x, 2)) for i in doors]
    for dpart in {i.part for i in doors}:
        ds = [i for i in doors if i.part == dpart]
        lo = Vector(map(min, *[i.lo for i in ds])) if len(ds) > 1 else ds[0].lo
        hi = Vector(map(max, *[i.hi for i in ds])) if len(ds) > 1 else ds[0].hi
        s = 1 if lo.y + hi.y > 0 else -1
        for i in isl:
            if i.part or i.mat in paint and i.d.x > 0.4:
                continue
            if contains(lo, hi, i, (0.03, 0.25, 0.45)) and s * i.c.y > abs(lo.y if s > 0 else hi.y) - 0.15:
                i.part = dpart

    # 4. hood (the biggest painted panel up front) and rear lid (everything in its box)
    hc = cfg["hood"]
    hood = [i for i in isl if not i.part and i.mat in paint and i.d.x > 0.5 and i.d.y > 0.55 * Wd
            and i.c.x > hc["x_min"] and i.c.z > hc["z_min"]]
    hood = max(hood, key=lambda i: i.d.x * i.d.y, default=None)
    if hood is not None:
        hood.part = "hood"
        for i in isl:
            # inserts (louvre panels, vents, badges) ride with it; the wings do not fit inside it
            if not i.part and contains(hood.lo, hood.hi, i, (0.02, 0.02, 0.06)) \
                    and i.c.z > hood.lo.z + 0.25 * hood.d.z and i.d.x < 0.9 * hood.d.x:
                i.part = "hood"
    report["hood"] = hood and (round(hood.c.x, 2), round(hood.d.x, 2))
    if cfg["engine"]:      # the engine claims its parts before a rear deck can
        for i in isl:
            if not i.part and i.mat not in paint and i.mat not in glass and inside(i, cfg["engine"]):
                i.part = "engine"
    for i in isl:
        if not i.part and inside(i, cfg["lid"]):
            i.part = "lid"

    # 5. the cabin
    (sx, sy, sz), sr = cfg["steering"]
    for i in isl:
        if i.part or i.mat in paint or i.mat in glass or not inside(i, cfg["cabin"]):
            continue
        if (i.c - Vector((sx, sy, sz))).length < sr and max(i.d) < 2 * sr + 0.1:
            i.part = "steering"
        elif i.c.x > cfg["dash_x"]:
            i.part = "dashboard"
        else:
            i.part = "seats"

    # 6. under the floor; everything else is body
    for i in isl:
        if not i.part and i.c.z < 0.17 * H and i.mat not in paint and i.d.z < 0.3 * H:
            i.part = "chassis"
    for i in isl:
        if not i.part:
            i.part = "body"
    return report


# ------------------------------------------------------------------ build parts and export
def build_parts(car, isl):
    me = car.data
    face_part = [None] * len(me.polygons)
    for i in isl:
        for f in i.faces:
            face_part[f] = i.part
    pids = sorted({p for p in face_part})
    objs = []
    for pid in pids:
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if face_part[f.index] != pid], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        pm = bpy.data.meshes.new(pid)
        for m in me.materials:      # slots first, or to_mesh clamps every face to slot 0
            pm.materials.append(m)
        bm.to_mesh(pm)
        bm.free()
        # drop unused slots so each part only carries its own materials
        ob = bpy.data.objects.new(f"{pid}_mesh", pm)
        bpy.context.scene.collection.objects.link(ob)
        idx = [p.material_index for p in pm.polygons]
        used = sorted(set(idx))
        remap = {old: new for new, old in enumerate(used)}
        keep = [pm.materials[k] for k in used]
        pm.materials.clear()          # clearing resets face indices, so write them after
        for m in keep:
            pm.materials.append(m)
        pm.polygons.foreach_set("material_index", [remap[k] for k in idx])
        pm.update()
        e = bpy.data.objects.new(f"Part_{pid}", None)
        bpy.context.scene.collection.objects.link(e)
        x, y, z = EXPLODE.get(pid, (0, 0, 1.0))
        e["part"] = pid
        e["explode"] = [x, z, -y]
        ob.parent = e
        objs += [e, ob]
    bpy.data.objects.remove(car)
    return objs, pids


def shrink_textures(limit=1024):
    for img in bpy.data.images:
        if img.size[0] > limit or img.size[1] > limit:
            f = limit / max(img.size)
            img.scale(max(1, int(img.size[0] * f)), max(1, int(img.size[1] * f)))


def export(key, objs):
    out = os.path.join(ROOT, "public", "models", "cars", f"{key}.glb")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True, export_yup=True, export_extras=True,
        export_image_format="WEBP", export_draco_mesh_compression_enable=True,
        export_draco_position_quantization=16, export_draco_normal_quantization=12,
    )
    print("wrote", out, os.path.getsize(out) // 1024, "KB")


PALETTE = [(0.9, 0.3, 0.2), (0.2, 0.7, 0.9), (0.95, 0.8, 0.2), (0.4, 0.85, 0.35), (0.75, 0.4, 0.9), (1, 0.55, 0.1),
           (0.3, 0.4, 1.0), (0.9, 0.4, 0.65), (0.5, 0.9, 0.8), (0.65, 0.65, 0.65), (0.85, 0.85, 0.4), (0.3, 0.6, 0.3)]


def debug_render(key, pids):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "OBJECT"
    for k, pid in enumerate(pids):
        ob = bpy.data.objects.get(f"{pid}_mesh")
        if ob:
            ob.color = (*PALETTE[k % len(PALETTE)], 1)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 1400, 800
    os.makedirs(os.path.join(ROOT, "art", "renders", "cars"), exist_ok=True)
    for name, loc in (("parts", (5.5, -4.5, 3.0)), ("parts_top", (0.01, 0, 9))):
        cam.location = loc
        cam.rotation_euler = (Vector((0, 0, 0.5)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        cam.data.lens = 35
        sc.render.filepath = os.path.join(ROOT, "art", "renders", "cars", f"{key}_{name}.png")
        bpy.ops.render.render(write_still=True)
    print("legend", {pid: PALETTE[k % len(PALETTE)] for k, pid in enumerate(pids)})


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    key, src = args[0], args[1]
    cfg = CARS[key]
    car = load(src, cfg)
    lo, hi = bounds(car.data.vertices)
    dims = hi - lo
    isl = islands(car.data)
    report = classify(isl, dims, cfg)
    print("DIMS", tuple(round(v, 3) for v in dims), "ISLANDS", len(isl))
    for k, v in report.items():
        print("REPORT", k, v)
    print("PARTS", dict(collections.Counter(i.part for i in isl)))
    objs, pids = build_parts(car, isl)
    shrink_textures()
    export(key, objs)
    if "debug" in args:
        debug_render(key, pids)
