"""
Finale (contact): the intro clearing, years later.

Same place, same arch, same trees, now recut and lit from within: clean basalt stones
with blue light in their joints, a fine line of light around the doorway, and a polished
dais with one inlaid ring. The jungle stays, trimmed back. Moonlight instead of sun.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/build_finale.py [-- render]

Reuses the intro's builders (art/build_intro.py) so the place reads as the same one.
Saves art/finale.blend; with `render`, also writes art/renders/finale.png.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_intro as bi  # noqa: E402

ROOT = bi.ROOT
INNER, THICK, DEPTH, PILLAR_H = bi.INNER, bi.THICK, bi.DEPTH, bi.PILLAR_H
rnd = random.Random(2077)
R = rnd.uniform

RUNE = (0.24, 0.55, 1.0)  # #3d8bff, the site's rune blue
GAP = 0.016  # joints wide enough for the light to show through
DAIS_R = 3.1
DAIS_H = 0.14
DAIS_C = (0.0, -0.9)


# ------------------------------------------------------------------ materials
def basalt_material():
    """Dark, finely honed stone: crisp highlights on the bevels, faint grain."""
    m, nt, out = bi.nodes_mat("Basalt")
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    coord = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 14.0
    noise.inputs["Detail"].default_value = 8.0
    L.new(coord.outputs["Object"], noise.inputs["Vector"])
    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.05, 0.052, 0.058, 1)
    ramp.color_ramp.elements[1].color = (0.11, 0.112, 0.12, 1)
    L.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    L.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    rough = N.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value = 0.28
    rough.inputs["To Max"].default_value = 0.45
    L.new(noise.outputs["Fac"], rough.inputs["Value"])
    L.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    L.new(noise.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def polished_material():
    """The dais: near-black, polished enough to mirror the arch and the light."""
    m, nt, out = bi.nodes_mat("Dais")
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.012, 0.013, 0.016, 1)
    coord = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.0
    noise.inputs["Detail"].default_value = 4.0
    L.new(coord.outputs["Object"], noise.inputs["Vector"])
    rough = N.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value = 0.08
    rough.inputs["To Max"].default_value = 0.2
    L.new(noise.outputs["Fac"], rough.inputs["Value"])
    L.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def light_material(name, color, strength):
    m, nt, out = bi.nodes_mat(name)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1)
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def veil_material():
    """The doorway: a faint sheet of light, brightest low and in the middle."""
    m, nt, out = bi.nodes_mat("Veil")
    if hasattr(m, "surface_render_method"):
        m.surface_render_method = "BLENDED"
    N, L = nt.nodes, nt.links
    coord = N.new("ShaderNodeTexCoord")
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(coord.outputs["Generated"], sep.inputs["Vector"])
    # fade toward the sides (x) and up (z)
    fx = N.new("ShaderNodeMath")
    fx.operation = "PINGPONG"
    fx.inputs[1].default_value = 0.5
    L.new(sep.outputs["X"], fx.inputs[0])
    sx = N.new("ShaderNodeMapRange")
    sx.inputs["From Min"].default_value = 0.0
    sx.inputs["From Max"].default_value = 0.5
    L.new(fx.outputs["Value"], sx.inputs["Value"])
    sz = N.new("ShaderNodeMapRange")
    sz.inputs["From Min"].default_value = 1.0
    sz.inputs["From Max"].default_value = 0.0
    L.new(sep.outputs["Z"], sz.inputs["Value"])
    mul = N.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    L.new(sx.outputs["Result"], mul.inputs[0])
    L.new(sz.outputs["Result"], mul.inputs[1])
    em = N.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*RUNE, 1)
    s = N.new("ShaderNodeMath")
    s.operation = "MULTIPLY"
    s.inputs[1].default_value = 0.05
    L.new(mul.outputs["Value"], s.inputs[0])
    L.new(s.outputs["Value"], em.inputs["Strength"])
    tr = N.new("ShaderNodeBsdfTransparent")
    add = N.new("ShaderNodeAddShader")
    L.new(em.outputs["Emission"], add.inputs[0])
    L.new(tr.outputs["BSDF"], add.inputs[1])
    L.new(add.outputs["Shader"], out.inputs["Surface"])
    return m


# ------------------------------------------------------------------ the arch, recut
def crisp(ob, width=0.012):
    b = ob.modifiers.new("Bevel", "BEVEL")
    b.width = width
    b.segments = 3
    b.limit_method = "ANGLE"
    bi.shade_flat(ob, smooth=False)


def build_arch(col, stone, glow):
    """Regular courses and true voussoirs, no weathering; a lit core shows only in the joints."""
    stones = []
    course = PILLAR_H / 7
    for side in (-1, 1):
        for k in range(7):
            z0 = k * course
            z1 = z0 + course - GAP
            xa, xb = sorted((side * INNER, side * (INNER + THICK)))
            c = [
                (xa, -DEPTH / 2, z0), (xb, -DEPTH / 2, z0), (xb, -DEPTH / 2, z1), (xa, -DEPTH / 2, z1),
                (xa, DEPTH / 2, z0), (xb, DEPTH / 2, z0), (xb, DEPTH / 2, z1), (xa, DEPTH / 2, z1),
            ]
            stones.append(bi.obj_from_bm("PillarStone", bi.block_bm(c), col, stone))

    n = 13
    for i in range(n):
        a0 = math.pi - i / n * math.pi - GAP / 2 / INNER
        a1 = math.pi - (i + 1) / n * math.pi + GAP / 2 / INNER
        ri, ro = INNER, INNER + THICK + (0.08 if i == n // 2 else 0.0)
        corners = []
        for y in (-DEPTH / 2, DEPTH / 2):
            corners += [
                (math.cos(a0) * ri, y, PILLAR_H + math.sin(a0) * ri),
                (math.cos(a1) * ri, y, PILLAR_H + math.sin(a1) * ri),
                (math.cos(a1) * ro, y, PILLAR_H + math.sin(a1) * ro),
                (math.cos(a0) * ro, y, PILLAR_H + math.sin(a0) * ro),
            ]
        stones.append(bi.obj_from_bm("ArchStone", bi.block_bm(corners), col, stone))
    for ob in stones:
        crisp(ob)

    # the core: the arch's own outline, inset so it is only ever seen through the joints
    inset = 0.05
    bm = bmesh.new()
    for side in (-1, 1):
        xa, xb = sorted((side * (INNER + inset), side * (INNER + THICK - inset)))
        y0, y1 = -DEPTH / 2 + inset, DEPTH / 2 - inset
        c = [(xa, y0, 0), (xb, y0, 0), (xb, y0, PILLAR_H), (xa, y0, PILLAR_H),
             (xa, y1, 0), (xb, y1, 0), (xb, y1, PILLAR_H), (xa, y1, PILLAR_H)]
        part = bi.block_bm(c)
        tmp = bpy.data.meshes.new("tmp")
        part.to_mesh(tmp)
        part.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    seg = 48
    ri, ro = INNER + inset, INNER + THICK - inset
    for i in range(seg):
        a0 = math.pi - i / seg * math.pi
        a1 = math.pi - (i + 1) / seg * math.pi
        vs = []
        for y in (-DEPTH / 2 + inset, DEPTH / 2 - inset):
            vs += [
                bm.verts.new((math.cos(a0) * ri, y, PILLAR_H + math.sin(a0) * ri)),
                bm.verts.new((math.cos(a1) * ri, y, PILLAR_H + math.sin(a1) * ri)),
                bm.verts.new((math.cos(a1) * ro, y, PILLAR_H + math.sin(a1) * ro)),
                bm.verts.new((math.cos(a0) * ro, y, PILLAR_H + math.sin(a0) * ro)),
            ]
        for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
            bm.faces.new([vs[j] for j in f])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bi.obj_from_bm("ArchCore", bm, col, glow)
    return stones


def build_doorline(col, mat):
    """A fine line of light set into the doorway's inner faces, up one side and over."""
    cu = bpy.data.curves.new("Doorline", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 0.007
    cu.bevel_resolution = 2
    sp = cu.splines.new("POLY")
    pts = [(-INNER + 0.004, 0, 0.0), (-INNER + 0.004, 0, PILLAR_H)]
    for i in range(1, 64):
        a = math.pi - i / 64 * math.pi
        pts.append((math.cos(a) * (INNER - 0.004), 0, PILLAR_H + math.sin(a) * (INNER - 0.004)))
    pts += [(INNER - 0.004, 0, PILLAR_H), (INNER - 0.004, 0, 0.0)]
    sp.points.add(len(pts) - 1)
    for p, co in zip(sp.points, pts):
        p.co = (*co, 1)
    cu.materials.append(mat)
    return bi.link(bpy.data.objects.new("Doorline", cu), col)


def build_veil(col, mat):
    """The portal, settled: a faint standing sheet of light filling the doorway."""
    bm = bmesh.new()
    seg = 40
    w = INNER - 0.02
    outline = [(-w, 0.0), (w, 0.0)]
    for i in range(seg + 1):
        a = i / seg * math.pi
        outline.append((math.cos(a) * w, PILLAR_H + math.sin(a) * w))
    vs = [bm.verts.new((x, 0.0, z)) for x, z in outline]
    bm.faces.new(vs)
    ob = bi.obj_from_bm("Veil", bm, col, mat)
    ob.visible_shadow = False
    return ob


# ------------------------------------------------------------------ the clearing
def build_dais(col, stone, ring_mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=DAIS_R, depth=DAIS_H, location=(DAIS_C[0], DAIS_C[1], DAIS_H / 2 - 0.02))
    d = bpy.context.active_object
    for c in d.users_collection:
        c.objects.unlink(d)
    col.objects.link(d)
    d.name = "Dais"
    d.data.materials.append(stone)
    b = d.modifiers.new("Bevel", "BEVEL")
    b.width = 0.02
    b.segments = 3
    bi.shade_flat(d, smooth=True)

    # one inlaid ring near the rim, and the threshold line under the arch
    bpy.ops.mesh.primitive_torus_add(major_radius=DAIS_R - 0.22, minor_radius=0.006, major_segments=256, minor_segments=8,
                                     location=(DAIS_C[0], DAIS_C[1], DAIS_H - 0.02 + 0.002))
    r = bpy.context.active_object
    for c in r.users_collection:
        c.objects.unlink(r)
    col.objects.link(r)
    r.name = "DaisRing"
    r.data.materials.append(ring_mat)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, DAIS_H - 0.02 + 0.002))
    t = bpy.context.active_object
    for c in t.users_collection:
        c.objects.unlink(t)
    col.objects.link(t)
    t.name = "Threshold"
    t.scale = (2 * INNER, 0.012, 0.004)
    t.data.materials.append(ring_mat)


def build_ferns(col, mat):
    """The jungle, kept to the edges of the dais."""
    bm = bmesh.new()
    layer = bm.faces.layers.float.new("leafvar")
    clumps = [(-3.5, -0.4, 1.15, 14), (-3.9, -2.6, 1.3, 15), (3.6, -0.6, 1.1, 13), (4.1, -2.9, 1.25, 14),
              (-2.6, 1.6, 0.9, 11), (2.8, 1.7, 0.95, 11), (-5.3, 0.6, 1.2, 12), (5.4, 0.3, 1.2, 12)]
    for x, y, sc, n in clumps:
        for i in range(n):
            yaw = i / n * math.tau + R(-0.25, 0.25)
            L = sc * R(0.75, 1.15)
            M = Matrix.Translation((x, y, 0.02)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(R(-0.25, 0.25), 4, "X")
            bi.fern_frond(bm, layer, M, L, rnd.random())
    return bi.finish_leaf_object("Ferns", bm, col, mat)


def trim_ivy(ob):
    """Keep only a tended patch: low on the left pillar's outer face."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    kill = [f for f in bm.faces if not (f.calc_center_median().x < -INNER - 0.1 and f.calc_center_median().z < 1.5)]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def build_motes(col):
    mat = light_material("Mote", (0.55, 0.78, 1.0), 40)
    for _ in range(26):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=R(0.004, 0.009))
        f = bpy.context.active_object
        for c in f.users_collection:
            c.objects.unlink(f)
        col.objects.link(f)
        f.name = "Mote"
        x = R(-4.5, 4.5)
        f.location = (x, R(-3, 3), R(0.3, 3.6))
        f.data.materials.append(mat)


# ------------------------------------------------------------------ light
def build_lighting(col, moon_dir):
    world = bpy.data.worlds.new("Night")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.0015, 0.0025, 0.0045, 1)

    moon = bpy.data.lights.new("Moon", "SUN")
    moon.energy = 4.0
    moon.color = (0.62, 0.74, 1.0)
    moon.angle = math.radians(1.2)
    mo = bpy.data.objects.new("Moon", moon)
    mo.rotation_euler = moon_dir.to_track_quat("-Z", "Y").to_euler()
    bi.link(mo, col)

    # a cool shaft through the same gap in the canopy, landing on the crown
    target = Vector((0.2, 0.0, 3.2))
    beam = bpy.data.lights.new("MoonBeam", "SPOT")
    beam.energy = 3200
    beam.color = (0.7, 0.8, 1.0)
    beam.spot_size = math.radians(24)
    beam.spot_blend = 0.9
    beam.shadow_soft_size = 0.5
    bo = bpy.data.objects.new("MoonBeam", beam)
    bo.location = target - moon_dir * 4.2
    bi.link(bo, col)
    bi.look_at(bo, target + Vector((-0.2, 0.0, -0.6)))

    # the doorway throws its own light onto the dais and the ferns
    door = bpy.data.lights.new("DoorGlow", "AREA")
    door.shape = "RECTANGLE"
    door.size = 1.8
    door.size_y = 2.8
    door.energy = 60
    door.color = RUNE
    do = bpy.data.objects.new("DoorGlow", door)
    do.location = (0, -0.1, 1.6)
    do.rotation_euler = (math.radians(90), 0, 0)
    bi.link(do, col)

    fill = bpy.data.lights.new("Fill", "AREA")
    fill.energy = 260
    fill.size = 6
    fill.color = (0.55, 0.66, 0.85)
    fo = bpy.data.objects.new("Fill", fill)
    fo.location = (-3.5, -7, 5)
    bi.link(fo, col)
    bi.look_at(fo, Vector((0, 0, 1.6)))

    bpy.ops.mesh.primitive_cube_add(size=1)
    v = bpy.context.active_object
    for c in v.users_collection:
        c.objects.unlink(v)
    col.objects.link(v)
    v.name = "Haze"
    v.location = (0, 3, 7)
    v.scale = (30, 30, 14)
    m, nt, out = bi.nodes_mat("Haze")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = 0.012
    vol.inputs["Anisotropy"].default_value = 0.65
    vol.inputs["Color"].default_value = (0.82, 0.9, 1.0, 1)
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    v.data.materials.append(m)


def build():
    bi.reset()
    cols = {n: bi.collection(n) for n in ("Arch", "Foliage", "Ground", "Background", "Light", "FX")}
    basalt = basalt_material()
    seam = light_material("Seam", (0.12, 0.42, 1.0), 1.6)
    line = light_material("Line", (0.35, 0.65, 1.0), 3.2)
    build_arch(cols["Arch"], basalt, seam)
    build_doorline(cols["Arch"], line)
    build_veil(cols["Arch"], veil_material())
    build_dais(cols["Ground"], polished_material(), line)

    # the same jungle, tended
    ivy = bi.build_ivy(cols["Foliage"], bi.leaf_material("Ivy", (0.09, 0.2, 0.06)))
    trim_ivy(ivy)
    build_ferns(cols["Foliage"], bi.leaf_material("Fern", (0.06, 0.14, 0.05)))
    bi.build_ground(cols["Ground"], bi.ground_material())
    bi.build_background(cols["Background"], bi.stone_material(), bi.simple_material("Bark", (0.018, 0.017, 0.016)))
    moon_dir = Vector((-0.5, 0.1, -1.0)).normalized()
    bi.build_canopy(cols["Background"], bi.simple_material("CanopyLeaves", (0.008, 0.014, 0.01)), moon_dir)
    build_motes(cols["FX"])
    build_lighting(cols["Light"], moon_dir)
    bi.build_camera(cols["Light"])
    bi.setup_render()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "art", "finale.blend"))


if __name__ == "__main__":
    build()
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if "render" in args:
        os.makedirs(os.path.join(ROOT, "art", "renders"), exist_ok=True)
        bpy.context.scene.render.filepath = os.path.join(ROOT, "art", "renders", "finale.png")
        bpy.ops.render.render(write_still=True)
        print("rendered")
