"""
Intro scene: a ruined stone arch in a dark forest, ivy, ferns, roots, god rays and fireflies.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/build_intro.py [-- render]

Everything is procedural and seeded. Saves art/intro.blend; with `render`, also writes
art/renders/intro.png. Blender Z-up: the arch faces -Y, the camera looks along +Y.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rnd = random.Random(1337)
R = rnd.uniform

# arch proportions
INNER = 1.0  # inner radius of the arch / half the opening
THICK = 0.55  # stone ring thickness
DEPTH = 0.75  # front-to-back depth
PILLAR_H = 2.3


# ------------------------------------------------------------------ helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def link(ob, col):
    col.objects.link(ob)
    return ob


def obj_from_bm(name, bm, col, mat=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if mat:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    return link(ob, col)


def nodes_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    return m, nt, out


def shade_flat(ob, smooth=False):
    for p in ob.data.polygons:
        p.use_smooth = smooth


def sock(coll, name, kind="RGBA"):
    """Mix nodes have several sockets with the same name; pick the colour one."""
    return next(x for x in coll if x.name == name and x.type == kind)


# ------------------------------------------------------------------ materials
def stone_material():
    m, nt, out = nodes_mat("Stone")
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.92
    coord = N.new("ShaderNodeTexCoord")

    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 7.0
    noise.inputs["Detail"].default_value = 10.0
    noise.inputs["Roughness"].default_value = 0.62
    L.new(coord.outputs["Object"], noise.inputs["Vector"])
    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.035, 0.032, 0.026, 1)
    ramp.color_ramp.elements[1].color = (0.20, 0.18, 0.13, 1)
    L.new(noise.outputs["Fac"], ramp.inputs["Fac"])

    # moss creeps over upward faces and into cavities
    geo = N.new("ShaderNodeNewGeometry")
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(geo.outputs["Normal"], sep.inputs["Vector"])
    mnoise = N.new("ShaderNodeTexNoise")
    mnoise.inputs["Scale"].default_value = 3.2
    mnoise.inputs["Detail"].default_value = 6.0
    L.new(coord.outputs["Generated"], mnoise.inputs["Vector"])
    up = N.new("ShaderNodeMapRange")
    up.inputs["From Min"].default_value = 0.15
    up.inputs["From Max"].default_value = 0.85
    L.new(sep.outputs["Z"], up.inputs["Value"])
    mul = N.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    L.new(up.outputs["Result"], mul.inputs[0])
    mr = N.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.42
    mr.inputs["From Max"].default_value = 0.62
    L.new(mnoise.outputs["Fac"], mr.inputs["Value"])
    L.new(mr.outputs["Result"], mul.inputs[1])
    mix = N.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    sock(mix.inputs, "B").default_value = (0.05, 0.075, 0.015, 1)
    L.new(mul.outputs["Value"], mix.inputs["Factor"])
    L.new(ramp.outputs["Color"], sock(mix.inputs, "A"))
    L.new(sock(mix.outputs, "Result"), bsdf.inputs["Base Color"])

    # pitted surface
    vor = N.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 18.0
    L.new(coord.outputs["Object"], vor.inputs["Vector"])
    add = N.new("ShaderNodeMath")
    add.operation = "ADD"
    L.new(noise.outputs["Fac"], add.inputs[0])
    L.new(vor.outputs["Distance"], add.inputs[1])
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.55
    bump.inputs["Distance"].default_value = 0.02
    L.new(add.outputs["Value"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def leaf_material(name, color, var=0.35):
    m, nt, out = nodes_mat(name)
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Subsurface Weight"].default_value = 0.0
    # per-object / per-island colour variation
    info = N.new("ShaderNodeObjectInfo")
    attr = N.new("ShaderNodeAttribute")
    attr.attribute_name = "leafvar"
    hsv = N.new("ShaderNodeHueSaturation")
    hsv.inputs["Color"].default_value = (*color, 1)
    mapv = N.new("ShaderNodeMapRange")
    mapv.inputs["To Min"].default_value = 1 - var
    mapv.inputs["To Max"].default_value = 1 + var
    L.new(attr.outputs["Fac"], mapv.inputs["Value"])
    L.new(mapv.outputs["Result"], hsv.inputs["Value"])
    huev = N.new("ShaderNodeMapRange")
    huev.inputs["To Min"].default_value = 0.47
    huev.inputs["To Max"].default_value = 0.53
    L.new(info.outputs["Random"], huev.inputs["Value"])
    L.new(huev.outputs["Result"], hsv.inputs["Hue"])
    L.new(hsv.outputs["Color"], bsdf.inputs["Base Color"])
    # leaves glow a little when lit from behind
    trans = N.new("ShaderNodeBsdfTranslucent")
    L.new(hsv.outputs["Color"], trans.inputs["Color"])
    mix = N.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = 0.25
    L.new(bsdf.outputs["BSDF"], mix.inputs[1])
    L.new(trans.outputs["BSDF"], mix.inputs[2])
    L.new(mix.outputs["Shader"], out.inputs["Surface"])
    return m


def simple_material(name, color, rough=0.9, emission=None, strength=0.0):
    m, nt, out = nodes_mat(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def ground_material():
    m, nt, out = nodes_mat("ForestFloor")
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.95
    coord = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.6
    noise.inputs["Detail"].default_value = 8.0
    L.new(coord.outputs["Object"], noise.inputs["Vector"])
    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.012, 0.011, 0.008, 1)
    ramp.color_ramp.elements[1].color = (0.05, 0.055, 0.028, 1)
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[1].position = 0.7
    L.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    L.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    fine = N.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 40.0
    fine.inputs["Detail"].default_value = 6.0
    L.new(coord.outputs["Object"], fine.inputs["Vector"])
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    L.new(fine.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def add_rough_modifiers(ob, strength=0.07, scale=0.12, bevel=0.05, level=3):
    b = ob.modifiers.new("Bevel", "BEVEL")
    b.width = bevel
    b.segments = 2
    s = ob.modifiers.new("Subsurf", "SUBSURF")
    s.levels = level
    s.render_levels = level
    tex = bpy.data.textures.get("StoneClouds") or bpy.data.textures.new("StoneClouds", "CLOUDS")
    tex.noise_scale = scale
    tex.noise_depth = 4
    d = ob.modifiers.new("Displace", "DISPLACE")
    d.texture = tex
    d.texture_coords = "GLOBAL"
    d.strength = strength
    d.mid_level = 0.5


# ------------------------------------------------------------------ arch
def block_bm(corners):
    """8 corners: 4 front (y-) then 4 back, CCW."""
    bm = bmesh.new()
    v = [bm.verts.new(c) for c in corners]
    for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm


def build_arch(col, mat):
    stones = []
    gap = 0.018

    # pillars: irregular courses of blocks
    for side in (-1, 1):
        z = 0.0
        while z < PILLAR_H - 0.12:
            h = min(R(0.24, 0.36), PILLAR_H - z)
            x0 = side * INNER
            x1 = side * (INNER + THICK + R(-0.03, 0.05))
            # sometimes split the course front/back, sometimes wider than the ring
            splits = [(-DEPTH / 2, DEPTH / 2)] if rnd.random() < 0.65 else [(-DEPTH / 2, R(-0.05, 0.08)), (None, DEPTH / 2)]
            if len(splits) == 2:
                splits[1] = (splits[0][1] + gap, DEPTH / 2)
            for (y0, y1) in splits:
                xa, xb = sorted((x0, x1))
                c = [
                    (xa, y0, z), (xb, y0, z), (xb, y0, z + h - gap), (xa, y0, z + h - gap),
                    (xa, y1, z), (xb, y1, z), (xb, y1, z + h - gap), (xa, y1, z + h - gap),
                ]
                ob = obj_from_bm(f"PillarStone", block_bm(c), col, mat)
                ob.rotation_euler = Euler((R(-0.02, 0.02), R(-0.025, 0.025), R(-0.03, 0.03)))
                stones.append(ob)
            z += h

    # voussoirs: wedges around the semicircle, keystone at the top
    n = 15
    for i in range(n):
        a0 = math.pi - i / n * math.pi + gap / 2
        a1 = math.pi - (i + 1) / n * math.pi - gap / 2
        ro = INNER + THICK + R(-0.04, 0.06)
        if i == n // 2:
            ro += 0.1  # keystone stands proud
        ri = INNER
        zc = PILLAR_H
        corners = []
        for y in (-DEPTH / 2 - R(0, 0.03), DEPTH / 2):
            corners += [
                (math.cos(a0) * ri, y, zc + math.sin(a0) * ri),
                (math.cos(a1) * ri, y, zc + math.sin(a1) * ri),
                (math.cos(a1) * ro, y, zc + math.sin(a1) * ro),
                (math.cos(a0) * ro, y, zc + math.sin(a0) * ro),
            ]
        ob = obj_from_bm("ArchStone", block_bm(corners), col, mat)
        stones.append(ob)

    # a couple of fallen stones at the foot
    for x, y, rz in ((-1.9, -0.9, 0.5), (1.55, -1.25, -0.3), (0.6, -1.9, 1.1)):
        s = R(0.22, 0.34)
        c = [(-s, -s * 0.7, 0), (s, -s * 0.7, 0), (s, -s * 0.7, s * 0.9), (-s, -s * 0.7, s * 0.9),
             (-s, s * 0.7, 0), (s, s * 0.7, 0), (s, s * 0.7, s * 0.9), (-s, s * 0.7, s * 0.9)]
        ob = obj_from_bm("FallenStone", block_bm(c), col, mat)
        ob.location = (x, y, -0.06)
        ob.rotation_euler = (R(-0.3, 0.3), R(-0.3, 0.3), rz)
        stones.append(ob)

    for ob in stones:
        add_rough_modifiers(ob)
        shade_flat(ob, smooth=True)
    return stones


# ------------------------------------------------------------------ foliage builders
def leaf_shape(size, aspect=1.0):
    """Ivy-ish leaf outline in its local XY plane (pointing +Y)."""
    s = size
    return [
        (0, -0.1 * s, 0),
        (0.45 * s * aspect, 0.2 * s, 0.02 * s),
        (0.35 * s * aspect, 0.65 * s, 0.03 * s),
        (0, 1.0 * s, 0),
        (-0.35 * s * aspect, 0.65 * s, 0.03 * s),
        (-0.45 * s * aspect, 0.2 * s, 0.02 * s),
    ]






def frame(pos, normal, up_hint, spin):
    """Matrix placing a leaf at pos, facing `normal`, tip roughly along up_hint."""
    n = normal.normalized()
    t = (up_hint - n * up_hint.dot(n)).normalized()
    t.rotate(Matrix.Rotation(spin, 3, n))
    b = t.cross(n)
    rot = Matrix((b, t, n)).transposed()
    return Matrix.Translation(pos) @ rot.to_4x4()


def finish_leaf_object(name, bm, col, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    return link(ob, col)




def build_ivy(col, mat):
    """Vines that climb the pillars and spill over the arch, plus hanging strands."""
    bm = bmesh.new()
    var_faces = []
    leaves = []  # (matrix, size, var)

    def surface_point_pillar(side, z, t):
        # t: 0 = front-inner corner .. 1 = front-outer corner, then wraps the outer side
        x_in, x_out = side * INNER, side * (INNER + THICK)
        if t <= 1:
            return Vector((x_in + (x_out - x_in) * t, -DEPTH / 2 - 0.02, z)), Vector((0, -1, 0))
        u = min(1.0, t - 1)
        return Vector((x_out + side * 0.02, -DEPTH / 2 + u * DEPTH, z)), Vector((side, 0, 0))

    def surface_point_arch(ang, t):
        r = INNER + THICK * min(1, t) + (0.03 if t >= 1 else 0)
        p = Vector((math.cos(ang) * r, -DEPTH / 2 - 0.02, PILLAR_H + math.sin(ang) * r))
        n = Vector((0, -1, 0)) if t < 1 else Vector((math.cos(ang), 0, math.sin(ang)))
        if t >= 1:
            p.y = -DEPTH / 2 + (t - 1) * DEPTH
        return p, n

    def scatter(p, n, count, spread, size_rng, up=Vector((0, 0, 1))):
        for _ in range(count):
            off = Vector((R(-spread, spread), R(-spread, spread), R(-spread, spread)))
            off -= n * off.dot(n)
            pos = p + off + n * R(0.0, 0.05)
            nn = (n + Vector((R(-0.6, 0.6), R(-0.6, 0.6), R(-0.3, 0.6)))).normalized()
            M = frame(pos, nn, up, R(-1.2, 1.2))
            leaves.append((M, R(*size_rng), rnd.random()))

    # left pillar: dense climbing ivy over the front, wrapping the outer face, over the arch
    for z in [i * 0.06 for i in range(int(PILLAR_H / 0.06))]:
        for t in (R(0.2, 0.9), R(0.9, 1.6)):
            p, n = surface_point_pillar(-1, z, t)
            scatter(p, n, 3 if z > 0.6 else 5, 0.09, (0.07, 0.12))
    for k in range(40):
        ang = math.pi - k / 40 * math.pi * 0.42
        for t in (R(0.3, 1.0), R(1.0, 1.4)):
            p, n = surface_point_arch(ang, t)
            scatter(p, n, 3, 0.08, (0.06, 0.11))
    # right pillar: a patch from mid-height and a strand up the outer face
    for z in [0.9 + i * 0.05 for i in range(26)]:
        p, n = surface_point_pillar(1, z, R(0.5, 1.5))
        scatter(p, n, 3, 0.07, (0.06, 0.1))
    for z in [i * 0.08 for i in range(10)]:
        p, n = surface_point_pillar(1, z, R(0.1, 0.6))
        scatter(p, n, 2, 0.06, (0.06, 0.1))
    # hanging strands from the arch crown, left of the keystone
    for ang0 in (math.pi * 0.62, math.pi * 0.55, math.pi * 0.36):
        base, _ = surface_point_arch(ang0, 0.2)
        L = R(0.5, 1.1)
        for j in range(int(L / 0.05)):
            p = base + Vector((R(-0.02, 0.02), -0.04, -j * 0.05 - 0.05))
            scatter(p, Vector((0, -1, 0)), 1, 0.03, (0.05, 0.08), up=Vector((0, 0, -1)))

    layer = bm.faces.layers.float.new("leafvar")
    for M, size, var in leaves:
        pts = [bm.verts.new(M @ Vector(p)) for p in leaf_shape(size, R(0.9, 1.15))]
        c = bm.verts.new(M @ Vector((0, 0.4 * size, -0.04 * size)))
        for i in range(len(pts)):
            f = bm.faces.new((c, pts[i], pts[(i + 1) % len(pts)]))
            f[layer] = var
    ob = finish_leaf_object("Ivy", bm, col, mat)
    return ob




def fern_frond(bm, layer, M, L, var):
    """A drooping frond with paired leaflets (pinnae) in the frond's local frame (+Y forward)."""
    steps = 26
    prev = None
    for k in range(steps):
        s = (k + 1) / steps
        pos = Vector((0, s * L, L * (0.75 * s - 0.95 * s * s)))
        nxt_s = min(1, s + 1 / steps)
        nxt = Vector((0, nxt_s * L, L * (0.75 * nxt_s - 0.95 * nxt_s * nxt_s)))
        tangent = (nxt - pos).normalized() if nxt_s > s else Vector((0, 1, -1)).normalized()
        if s < 0.12:
            continue
        pl = 0.24 * L * math.sin(math.pi * min(1.0, (s - 0.05) / 0.98)) ** 0.8
        w = pl * 0.22
        for side in (-1, 1):
            out = Vector((side, 0, 0))
            base = pos
            tip = base + out * pl + tangent * pl * 0.35 + Vector((0, 0, -pl * 0.25))
            a = base + tangent * w * 0.6
            b = base + out * pl * 0.5 + tangent * w + Vector((0, 0, w * 0.2))
            c = base + out * pl * 0.5 - tangent * w * 0.2
            vs = [bm.verts.new(M @ v) for v in (base, b, tip, c)]
            f = bm.faces.new(vs if side > 0 else list(reversed(vs)))
            f[layer] = var
        # stem segment as a thin strip
        if prev is not None:
            q = [bm.verts.new(M @ v) for v in (prev + Vector((-0.004, 0, 0)), prev + Vector((0.004, 0, 0)), pos + Vector((0.004, 0, 0)), pos + Vector((-0.004, 0, 0)))]
            f = bm.faces.new(q)
            f[layer] = var * 0.5
        prev = pos


def build_ferns(col, mat):
    bm = bmesh.new()
    layer = bm.faces.layers.float.new("leafvar")
    clumps = [
        # x, y, scale, fronds
        (-1.25, -1.55, 1.25, 16),
        (-0.55, -2.4, 0.9, 12),
        (0.2, -1.7, 0.7, 10),
        (1.35, -1.3, 1.0, 13),
        (2.6, -0.4, 1.1, 12),
        (-2.8, -0.2, 1.0, 12),
        (-3.6, -2.6, 1.3, 14),
        (3.8, -2.9, 1.2, 12),
        (-0.4, 0.9, 0.8, 10),
        (1.2, 0.8, 0.8, 10),
    ]
    for x, y, sc, n in clumps:
        for i in range(n):
            yaw = i / n * math.tau + R(-0.25, 0.25)
            pitch = R(-0.25, 0.25)
            L = sc * R(0.75, 1.15)
            M = Matrix.Translation((x, y, 0.02)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(pitch, 4, "X")
            fern_frond(bm, layer, M, L, rnd.random())
    return finish_leaf_object("Ferns", bm, col, mat)


def build_broadleaves(col, mat):
    """Large elongated leaves on short stalks (foreground plants)."""
    bm = bmesh.new()
    layer = bm.faces.layers.float.new("leafvar")
    plants = [(-2.3, -2.9, 1.0), (2.2, -2.2, 0.8), (-4.6, -1.4, 1.2), (4.2, -1.0, 0.9)]
    for x, y, sc in plants:
        for i in range(rnd.randint(4, 7)):
            yaw = R(0, math.tau)
            L = sc * R(0.5, 0.85)
            W = L * R(0.28, 0.4)
            seg = 8
            M = Matrix.Translation((x, y, 0.0)) @ Matrix.Rotation(yaw, 4, "Z")
            rows = []
            for k in range(seg + 1):
                s = k / seg
                yy = s * L + 0.15 * sc
                zz = 0.25 * sc + L * (0.55 * s - 0.75 * s * s)
                w = W * math.sin(math.pi * s) ** 0.7
                fold = w * 0.25
                rows.append([M @ Vector((-w, yy, zz + fold)), M @ Vector((0, yy, zz)), M @ Vector((w, yy, zz + fold))])
            var = rnd.random()
            for k in range(seg):
                for j in range(2):
                    vs = [bm.verts.new(v) for v in (rows[k][j], rows[k][j + 1], rows[k + 1][j + 1], rows[k + 1][j])]
                    f = bm.faces.new(vs)
                    f[layer] = var
            # stalk
            st = [bm.verts.new(M @ v) for v in (Vector((-0.01, 0, 0)), Vector((0.01, 0, 0)), Vector((0.01, 0.15 * sc, 0.25 * sc)), Vector((-0.01, 0.15 * sc, 0.25 * sc)))]
            bm.faces.new(st)[layer] = var
    return finish_leaf_object("BroadLeaves", bm, col, mat)


# ------------------------------------------------------------------ ground, roots, background
def build_ground(col, mat):
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=160, y_subdivisions=160, size=40)
    g = bpy.context.active_object
    for c in g.users_collection:
        c.objects.unlink(g)
    col.objects.link(g)
    g.name = "Ground"
    g.location = (0, 6, 0)
    tex = bpy.data.textures.new("GroundNoise", "CLOUDS")
    tex.noise_scale = 1.6
    d = g.modifiers.new("Displace", "DISPLACE")
    d.texture = tex
    d.strength = 0.35
    d.texture_coords = "GLOBAL"
    g.data.materials.append(mat)
    shade_flat(g, smooth=True)
    return g


def build_roots(col, mat):
    for i in range(9):
        cu = bpy.data.curves.new(f"Root{i}", "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = R(0.025, 0.06)
        cu.bevel_resolution = 3
        cu.resolution_u = 12
        sp = cu.splines.new("BEZIER")
        n = 5
        sp.bezier_points.add(n - 1)
        side = rnd.choice((-1, 1))
        x0 = side * R(1.6, 5.0)
        y0 = R(-3.5, 1.5)
        ang = R(0, math.tau)
        for k, bp in enumerate(sp.bezier_points):
            x0 += math.cos(ang) * 0.6
            y0 += math.sin(ang) * 0.6
            ang += R(-0.6, 0.6)
            bp.co = (x0, y0, R(-0.02, 0.06) if 0 < k < n - 1 else -0.05)
            bp.handle_left_type = bp.handle_right_type = "AUTO"
        ob = bpy.data.objects.new(f"Root{i}", cu)
        cu.materials.append(mat)
        link(ob, col)


def build_background(col, rock_mat, bark_mat):
    # boulders / rock walls framing the clearing
    for x, y, s in ((-4.5, 3.5, 2.6), (-6.5, 1.0, 2.2), (5.2, 3.0, 2.8), (6.8, 0.2, 2.0), (-2.6, 6.0, 2.0), (3.0, 7.0, 2.4), (0.4, 9.0, 3.0)):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1)
        r = bpy.context.active_object
        for c in r.users_collection:
            c.objects.unlink(r)
        col.objects.link(r)
        r.name = "Rock"
        r.location = (x, y, s * 0.35)
        r.scale = (s * R(0.8, 1.2), s * R(0.6, 0.9), s * R(0.7, 1.1))
        r.rotation_euler = (R(0, 1), R(0, 1), R(0, 3))
        tex = bpy.data.textures.new("RockNoise", "CLOUDS")
        tex.noise_scale = 0.5
        d = r.modifiers.new("Displace", "DISPLACE")
        d.texture = tex
        d.strength = 0.6
        r.data.materials.append(rock_mat)
        shade_flat(r, smooth=True)

    # trunks fading into the dark
    for x, y, rad in ((-3.6, 5.0, 0.45), (3.9, 5.5, 0.55), (-7.0, 4.0, 0.7), (7.5, 4.5, 0.6), (-1.5, 8.5, 0.4), (2.0, 10.5, 0.5), (-5.5, 9.0, 0.5)):
        bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=rad * 1.4, radius2=rad * 0.8, depth=14)
        t = bpy.context.active_object
        for c in t.users_collection:
            c.objects.unlink(t)
        col.objects.link(t)
        t.name = "Trunk"
        t.location = (x, y, 6.5)
        t.rotation_euler = (R(-0.05, 0.05), R(-0.08, 0.08), 0)
        tex = bpy.data.textures.new("BarkNoise", "STUCCI")
        tex.noise_scale = 0.25
        s = t.modifiers.new("Subsurf", "SUBSURF")
        s.levels = s.render_levels = 2
        d = t.modifiers.new("Displace", "DISPLACE")
        d.texture = tex
        d.strength = 0.08
        t.data.materials.append(bark_mat)
        shade_flat(t, smooth=True)


def build_canopy(col, mat, sun_dir):
    """A leafy roof with gaps: the sun pours through them as shafts in the haze."""
    from mathutils import noise

    z = 9.0
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=90, y_segments=90, size=16)
    for v in bm.verts:
        v.co.z = z + noise.noise(v.co * 0.4) * 0.6
        v.co.y += 4
    # gaps along the line from the arch toward the sun get carved for sure
    target = Vector((0.4, 0.2, 3.4))
    t = (z - target.z) / -sun_dir.z
    hole_c = target - sun_dir * t
    holes = [hole_c] + [hole_c + Vector((R(-1.4, 1.4), R(-1.0, 1.0), 0)) for _ in range(5)]
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        n = noise.noise(Vector((c.x * 0.55, c.y * 0.55, 3.0)))
        near = min((Vector((c.x, c.y, 0)) - Vector((h.x, h.y, 0))).length for h in holes)
        if n > 0.5 or near < R(0.45, 0.75):
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    ob = obj_from_bm("Canopy", bm, col, mat)
    ob.visible_camera = False
    return ob


def build_fireflies(col):
    mat = simple_material("Firefly", (0, 0, 0), emission=(0.2, 0.5, 1.0), strength=45)
    for i in range(28):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=R(0.005, 0.01))
        f = bpy.context.active_object
        for c in f.users_collection:
            c.objects.unlink(f)
        col.objects.link(f)
        f.name = "Firefly"
        # mostly to the sides, low, some deep in the forest
        x = R(-6, 6)
        if abs(x) < 1.5:
            x *= 2.5
        f.location = (x, R(-2.5, 6), R(0.3, 2.8))
        f.data.materials.append(mat)


# ------------------------------------------------------------------ light, volume, camera
def build_lighting(col, sun_dir):
    world = bpy.data.worlds.new("Night")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.0025, 0.0035, 0.004, 1)
    bg.inputs["Strength"].default_value = 1.0

    # sun from the upper right, broken into shafts by the canopy
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 9.0
    sun.color = (1.0, 0.8, 0.45)
    sun.angle = math.radians(0.8)
    so = bpy.data.objects.new("Sun", sun)
    so.rotation_euler = sun_dir.to_track_quat("-Z", "Y").to_euler()
    link(so, col)

    # the hero shaft: a warm beam on the same angle, below the canopy, landing on the arch top
    target = Vector((0.2, 0.0, 3.2))
    beam = bpy.data.lights.new("HeroBeam", "SPOT")
    beam.energy = 2600
    beam.color = (1.0, 0.82, 0.5)
    beam.spot_size = math.radians(26)
    beam.spot_blend = 0.85
    beam.shadow_soft_size = 0.4
    bo = bpy.data.objects.new("HeroBeam", beam)
    bo.location = target - sun_dir * 6.0
    link(bo, col)
    look_at(bo, target + Vector((-0.4, -0.3, -1.2)))

    # dim cool moonlight fill so the stones read
    fill = bpy.data.lights.new("Fill", "AREA")
    fill.energy = 170
    fill.size = 6
    fill.color = (0.62, 0.75, 0.62)
    fo = bpy.data.objects.new("Fill", fill)
    fo.location = (-3.5, -7, 5)
    link(fo, col)
    look_at(fo, Vector((0, 0, 1.6)))

    # haze that catches the beam
    bpy.ops.mesh.primitive_cube_add(size=1)
    v = bpy.context.active_object
    for c in v.users_collection:
        c.objects.unlink(v)
    col.objects.link(v)
    v.name = "Haze"
    v.location = (0, 3, 7)
    v.scale = (30, 30, 14)
    m, nt, out = nodes_mat("Haze")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = 0.014
    vol.inputs["Anisotropy"].default_value = 0.7
    vol.inputs["Color"].default_value = (0.9, 0.95, 0.85, 1)
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    v.data.materials.append(m)


def look_at(ob, target):
    d = target - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def build_camera(col):
    cam = bpy.data.cameras.new("Camera")
    cam.lens = 30
    cam.dof.use_dof = True
    cam.dof.focus_distance = 10.5
    cam.dof.aperture_fstop = 4.0
    ob = bpy.data.objects.new("Camera", cam)
    ob.location = (0, -10.5, 1.55)
    link(ob, col)
    look_at(ob, Vector((0, 0, 2.05)))
    bpy.context.scene.camera = ob


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 1920
    sc.render.resolution_y = 1080
    sc.render.resolution_percentage = 60
    ee = sc.eevee
    ee.taa_render_samples = 64
    for attr, val in (
        ("volumetric_tile_size", "4"),
        ("volumetric_samples", 96),
        ("volumetric_end", 40.0),
        ("use_volumetric_shadows", True),
        ("volumetric_shadow_samples", 32),
        ("use_shadows", True),
        ("use_raytracing", True),
        ("use_gtao", True),
    ):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, val)
            except Exception:
                pass
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    sc.view_settings.exposure = 0.2


def build():
    reset()
    cols = {n: collection(n) for n in ("Arch", "Foliage", "Ground", "Background", "Light", "FX")}
    stone = stone_material()
    build_arch(cols["Arch"], stone)
    build_ivy(cols["Foliage"], leaf_material("Ivy", (0.11, 0.24, 0.06)))
    build_ferns(cols["Foliage"], leaf_material("Fern", (0.07, 0.16, 0.05)))
    build_broadleaves(cols["Foliage"], leaf_material("BroadLeaf", (0.09, 0.2, 0.07), var=0.25))
    build_ground(cols["Ground"], ground_material())
    build_roots(cols["Ground"], simple_material("Root", (0.03, 0.025, 0.018)))
    build_background(cols["Background"], stone, simple_material("Bark", (0.02, 0.018, 0.014)))
    sun_dir = Vector((-0.38, -0.22, -1.0)).normalized()
    build_canopy(cols["Background"], simple_material("CanopyLeaves", (0.01, 0.02, 0.008)), sun_dir)
    build_fireflies(cols["FX"])
    build_lighting(cols["Light"], sun_dir)
    build_camera(cols["Light"])
    setup_render()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "art", "intro.blend"))


if __name__ == "__main__":
    build()
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if "render" in args:
        os.makedirs(os.path.join(ROOT, "art", "renders"), exist_ok=True)
        bpy.context.scene.render.filepath = os.path.join(ROOT, "art", "renders", "intro.png")
        bpy.ops.render.render(write_still=True)
        print("rendered")
