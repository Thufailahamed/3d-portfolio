"""
Builds and Cycles-bakes a unique Deep Jungle Shrine scene:
  - Stepped ancient stone altar dais
  - Fractured obsidian monolith with inner glowing cyan core
  - Two flanking broken runic pillars / stelae covered in vines
  - Giant jungle banyan trees with sprawling buttress roots
  - Lush broadleaf plants, ferns, hanging lianas, and mossy boulders
  - Bakes direct + indirect lighting, shadows, and ambient occlusion with Cycles into vertex colors
  - Exports public/models/shrine.glb (Draco) for Three.js baked shader

Run:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/build_and_bake_shrine.py
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB = os.path.join(ROOT, "public", "models", "shrine.glb")
OUT_PNG = os.path.join(ROOT, "art", "renders", "shrine_preview.png")
OUT_BLEND = os.path.join(ROOT, "art", "shrine.blend")
BAKE_SCALE = 4.0

rnd = random.Random(90210)
R = rnd.uniform


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


def sock(coll, name, kind="RGBA"):
    return next(x for x in coll if x.name == name and x.type == kind)


def shade_flat(ob, smooth=False):
    for p in ob.data.polygons:
        p.use_smooth = smooth


def look_at(ob, target):
    d = target - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


# ------------------------------------------------------------------ materials
def stone_material():
    m, nt, out = nodes_mat("AncientStone")
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.92

    coord = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 6.0
    noise.inputs["Detail"].default_value = 8.0
    L.new(coord.outputs["Object"], noise.inputs["Vector"])

    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.04, 0.038, 0.032, 1)
    ramp.color_ramp.elements[1].color = (0.18, 0.16, 0.13, 1)
    L.new(noise.outputs["Fac"], ramp.inputs["Fac"])

    geo = N.new("ShaderNodeNewGeometry")
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(geo.outputs["Normal"], sep.inputs["Vector"])
    up = N.new("ShaderNodeMapRange")
    up.inputs["From Min"].default_value = 0.15
    up.inputs["From Max"].default_value = 0.8
    L.new(sep.outputs["Z"], up.inputs["Value"])

    mix = N.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    sock(mix.inputs, "B").default_value = (0.05, 0.11, 0.03, 1)  # rich green moss
    L.new(up.outputs["Result"], mix.inputs["Factor"])
    L.new(ramp.outputs["Color"], sock(mix.inputs, "A"))
    L.new(sock(mix.outputs, "Result"), bsdf.inputs["Base Color"])

    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.4
    bump.inputs["Distance"].default_value = 0.02
    L.new(noise.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def monolith_slate_material():
    m, nt, out = nodes_mat("MonolithSlate")
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.02, 0.024, 0.03, 1)
    bsdf.inputs["Roughness"].default_value = 0.2
    bsdf.inputs["Metallic"].default_value = 0.9
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def glow_core_material(color=(0.05, 0.55, 1.0), strength=20.0):
    m, nt, out = nodes_mat("GlowingCore")
    N, L = nt.nodes, nt.links
    emit = N.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1.0)
    emit.inputs["Strength"].default_value = strength
    L.new(emit.outputs["Emission"], out.inputs["Surface"])
    return m


def leaf_material(name, color):
    m, nt, out = nodes_mat(name)
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = 0.5
    trans = N.new("ShaderNodeBsdfTranslucent")
    trans.inputs["Color"].default_value = (*color, 1)
    mix = N.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = 0.28
    L.new(bsdf.outputs["BSDF"], mix.inputs[1])
    L.new(trans.outputs["BSDF"], mix.inputs[2])
    L.new(mix.outputs["Shader"], out.inputs["Surface"])
    return m


def bark_material():
    m, nt, out = nodes_mat("JungleBark")
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.04, 0.032, 0.022, 1)
    bsdf.inputs["Roughness"].default_value = 0.92
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def ground_material():
    m, nt, out = nodes_mat("ForestFloor")
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.02, 0.018, 0.012, 1)
    bsdf.inputs["Roughness"].default_value = 0.95
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


# ------------------------------------------------------------------ geometry
def build_ground(col, mat):
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=64, y_subdivisions=64, size=30)
    g = bpy.context.active_object
    for c in g.users_collection:
        c.objects.unlink(g)
    col.objects.link(g)
    g.name = "Ground"
    g.location = (0, 1.5, 0)
    tex = bpy.data.textures.new("GNoise", "CLOUDS")
    tex.noise_scale = 1.6
    d = g.modifiers.new("Displace", "DISPLACE")
    d.texture = tex
    d.strength = 0.35
    d.texture_coords = "GLOBAL"
    g.data.materials.append(mat)
    shade_flat(g, smooth=True)
    return g


def build_dais(col, stone_mat):
    """Ancient stepped hexagonal stone altar."""
    tiers = [
        {"r": 2.8, "h": 0.28, "z": 0.0},
        {"r": 1.9, "h": 0.30, "z": 0.28},
        {"r": 1.15, "h": 0.32, "z": 0.58},
    ]
    for idx, t in enumerate(tiers):
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=False,
            radius1=t["r"],
            radius2=t["r"] * 0.97,
            depth=t["h"],
            segments=8,
        )
        ob = obj_from_bm(f"Dais_Tier_{idx}", bm, col, stone_mat)
        ob.location = (0.0, 0.0, t["z"] + t["h"] / 2)
        bev = ob.modifiers.new("Bevel", "BEVEL")
        bev.width = 0.05
        bev.segments = 2


def build_runic_stelae(col, stone_mat):
    """Two broken ancient monolithic pillars flanking the altar (NO arch!)."""
    pillars = [
        {"x": -2.2, "y": 0.8, "h": 3.8, "w": 0.55, "rot": (0.04, -0.05, 0.25)},
        {"x": 2.4, "y": 0.6, "h": 2.9, "w": 0.58, "rot": (-0.03, 0.06, -0.3)},
        {"x": -0.8, "y": 2.4, "h": 2.4, "w": 0.5, "rot": (0.02, 0.02, 0.1)},
        {"x": 1.2, "y": 2.6, "h": 4.1, "w": 0.52, "rot": (-0.04, -0.02, -0.15)},
    ]
    for idx, p in enumerate(pillars):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        ob = obj_from_bm(f"Stele_{idx}", bm, col, stone_mat)
        ob.scale = (p["w"], p["w"] * 0.85, p["h"])
        ob.location = (p["x"], p["y"], p["h"] / 2)
        ob.rotation_euler = Euler(p["rot"])
        bev = ob.modifiers.new("Bevel", "BEVEL")
        bev.width = 0.04
        bev.segments = 2


def build_hero_monolith(col, slate_mat, glow_mat):
    """The central fractured obsidian monolith standing on the altar."""
    center = Vector((0.0, 0.0, 1.95))

    # Inner glowing cyan crystal core
    bm_core = bmesh.new()
    bmesh.ops.create_cone(
        bm_core,
        cap_ends=True,
        cap_tris=True,
        segments=6,
        radius1=0.22,
        radius2=0.03,
        depth=2.3,
    )
    ob_core = obj_from_bm("GlowingCoreBeacon", bm_core, col, glow_mat)
    ob_core.location = center

    # 4 fractured dark slate facets revealing the core
    for i in range(4):
        ang = (i / 4.0) * math.tau + 0.35
        dist = 0.24
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=True,
            segments=4,
            radius1=0.20,
            radius2=0.07,
            depth=2.2,
        )
        ob = obj_from_bm(f"Monolith_Face_{i}", bm, col, slate_mat)
        ob.location = center + Vector((math.cos(ang) * dist, math.sin(ang) * dist, R(-0.03, 0.03)))
        ob.rotation_euler = Euler((R(-0.04, 0.04), R(-0.04, 0.04), ang))

    # 2 orbital rings
    rings = [
        {"r": 0.85, "rot": (0.35, 0.25, 0.0), "z": 0.15, "mat": glow_mat, "thick": 0.012},
        {"r": 1.35, "rot": (-0.40, 0.55, 0.7), "z": 0.35, "mat": glow_mat, "thick": 0.012},
    ]
    for idx, rd in enumerate(rings):
        bm_r = bmesh.new()
        bmesh.ops.create_circle(bm_r, cap_ends=False, radius=rd["r"], segments=48)
        ext = bmesh.ops.extrude_edge_only(bm_r, edges=list(bm_r.edges))
        for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
            v.co.z += rd["thick"]
        ob_r = obj_from_bm(f"Orbital_Ring_{idx}", bm_r, col, rd["mat"])
        ob_r.location = center + Vector((0, 0, rd["z"]))
        ob_r.rotation_euler = Euler(rd["rot"])
        sol = ob_r.modifiers.new("Solidify", "SOLIDIFY")
        sol.thickness = rd["thick"]


def build_banyan_trees(col, bark_mat):
    """Deep jungle tree trunks framing the perimeter."""
    trees = [
        (-4.2, -0.5, 0.85, 14.0),
        (-5.5, 2.5, 1.1, 16.0),
        (4.2, -0.2, 0.8, 14.0),
        (5.5, 2.2, 1.15, 16.0),
        (-2.0, 5.5, 0.75, 15.0),
        (2.0, 6.0, 0.85, 15.0),
    ]
    for idx, (tx, ty, trad, th) in enumerate(trees):
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=False,
            radius1=trad * 1.4,
            radius2=trad * 0.75,
            depth=th,
            segments=20,
        )
        ob = obj_from_bm(f"JungleTree_{idx}", bm, col, bark_mat)
        ob.location = (tx, ty, th / 2 - 0.2)
        ob.rotation_euler = Euler((R(-0.04, 0.04), R(-0.04, 0.04), R(0, math.tau)))
        shade_flat(ob, smooth=True)


def build_buttress_roots(col, bark_mat):
    """Sprawling roots crawling over the ground and wrapping onto the stone dais."""
    root_specs = [
        [Vector((-4.2, -0.5, 0.4)), Vector((-2.6, -0.4, 0.15)), Vector((-1.6, -0.2, 0.22)), Vector((-0.6, -0.1, 0.3))],
        [Vector((-4.2, -0.5, 0.3)), Vector((-2.8, 0.2, 0.12)), Vector((-1.8, 0.5, 0.24)), Vector((-0.8, 0.4, 0.42))],
        [Vector((4.2, -0.2, 0.4)), Vector((2.8, -0.3, 0.15)), Vector((1.7, -0.1, 0.22)), Vector((0.8, -0.05, 0.3))],
        [Vector((4.2, -0.2, 0.3)), Vector((3.0, 0.4, 0.10)), Vector((1.9, 0.6, 0.22)), Vector((0.9, 0.5, 0.4))],
        [Vector((-1.8, -2.8, 0.2)), Vector((-1.0, -2.0, 0.06)), Vector((0.0, -1.6, 0.04)), Vector((1.2, -1.8, 0.06))],
    ]
    for idx, pts in enumerate(root_specs):
        cu = bpy.data.curves.new(f"Root_{idx}", "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = R(0.08, 0.14)
        cu.bevel_resolution = 4
        cu.resolution_u = 12
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(pts) - 1)
        for k, bp in enumerate(sp.bezier_points):
            bp.co = pts[k]
            bp.handle_left_type = bp.handle_right_type = "AUTO"
        ob = bpy.data.objects.new(f"Root_{idx}", cu)
        cu.materials.append(bark_mat)
        link(ob, col)


def build_hanging_lianas(col, bark_mat):
    """Hanging canopy vines."""
    lianas = [
        [Vector((-2.0, 1.0, 7.0)), Vector((-1.8, 0.9, 4.5)), Vector((-2.1, 1.1, 2.5)), Vector((-1.9, 1.0, 1.0))],
        [Vector((2.2, 0.8, 7.0)), Vector((2.0, 0.7, 4.4)), Vector((2.3, 0.9, 2.6)), Vector((2.1, 0.8, 1.1))],
        [Vector((-1.0, 2.5, 7.0)), Vector((-0.8, 2.4, 4.2)), Vector((-1.1, 2.6, 2.4)), Vector((-0.9, 2.5, 1.2))],
        [Vector((1.4, 2.6, 7.0)), Vector((1.2, 2.5, 4.0)), Vector((1.5, 2.7, 2.3)), Vector((1.3, 2.6, 1.0))],
    ]
    for idx, pts in enumerate(lianas):
        cu = bpy.data.curves.new(f"Liana_{idx}", "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = R(0.025, 0.04)
        cu.bevel_resolution = 3
        cu.resolution_u = 12
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(pts) - 1)
        for k, bp in enumerate(sp.bezier_points):
            bp.co = pts[k]
            bp.handle_left_type = bp.handle_right_type = "AUTO"
        ob = bpy.data.objects.new(f"Liana_{idx}", cu)
        cu.materials.append(bark_mat)
        link(ob, col)


def build_broadleaves(col, leaf_mat):
    """Large drooping tropical elephant-ear / banana leaves."""
    clusters = [
        (-2.5, -1.8, 1.3, 6),
        (2.5, -1.6, 1.3, 6),
        (-3.2, 0.2, 1.4, 7),
        (3.2, 0.4, 1.4, 7),
        (-1.5, 1.8, 1.2, 5),
        (1.6, 2.0, 1.2, 5),
    ]
    bm = bmesh.new()
    for cx, cy, sc, n_leaves in clusters:
        for i in range(n_leaves):
            ang = (i / n_leaves) * math.tau + R(-0.2, 0.2)
            L = sc * R(0.8, 1.25)
            W = L * R(0.36, 0.48)
            steps = 7
            prev_row = None
            for s in range(steps + 1):
                t = s / steps
                dist_r = t * L
                z_h = math.sin(t * math.pi * 0.65) * 0.4 * L - (t**2.2) * 0.3 * L + 0.1 * sc
                w = W * math.sin(math.pi * t) ** 0.65
                fold = w * 0.25

                p_c = Vector((cx + math.cos(ang) * dist_r, cy + math.sin(ang) * dist_r, z_h))
                left_dir = Vector((-math.sin(ang), math.cos(ang), 0))
                p_l = p_c + left_dir * w + Vector((0, 0, fold))
                p_r = p_c - left_dir * w + Vector((0, 0, fold))

                v_l = bm.verts.new(p_l)
                v_c = bm.verts.new(p_c)
                v_r = bm.verts.new(p_r)
                curr_row = (v_l, v_c, v_r)

                if prev_row is not None:
                    bm.faces.new((prev_row[0], curr_row[0], curr_row[1], prev_row[1]))
                    bm.faces.new((prev_row[1], curr_row[1], curr_row[2], prev_row[2]))
                prev_row = curr_row

    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    ob = obj_from_bm("BroadLeaves", bm, col, leaf_mat)
    shade_flat(ob, smooth=True)


def build_ferns(col, leaf_mat):
    """Tropical fern fronds."""
    clumps = [
        (-1.4, -1.4, 0.9, 8),
        (1.5, -1.2, 0.9, 8),
        (-2.2, -0.6, 0.85, 8),
        (2.3, -0.4, 0.9, 8),
        (-0.8, 1.6, 0.8, 7),
        (0.9, 1.7, 0.8, 7),
    ]
    bm = bmesh.new()
    for cx, cy, cscale, n_fronds in clumps:
        for f in range(n_fronds):
            ang = (f / n_fronds) * math.tau + R(-0.2, 0.2)
            L = cscale * R(0.65, 0.9)
            steps = 7
            for s in range(steps):
                t0 = s / steps
                t1 = (s + 1) / steps
                r0 = t0 * L
                r1 = t1 * L
                z0 = math.sin(t0 * math.pi * 0.5) * 0.3 * L - (t0**2) * 0.18 * L
                z1 = math.sin(t1 * math.pi * 0.5) * 0.3 * L - (t1**2) * 0.18 * L
                w0 = (1.0 - t0) * 0.07 * cscale
                w1 = (1.0 - t1) * 0.07 * cscale

                p0_l = Vector((cx + math.cos(ang) * r0 - math.sin(ang) * w0, cy + math.sin(ang) * r0 + math.cos(ang) * w0, z0))
                p0_r = Vector((cx + math.cos(ang) * r0 + math.sin(ang) * w0, cy + math.sin(ang) * r0 - math.cos(ang) * w0, z0))
                p1_r = Vector((cx + math.cos(ang) * r1 + math.sin(ang) * w1, cy + math.sin(ang) * r1 - math.cos(ang) * w1, z1))
                p1_l = Vector((cx + math.cos(ang) * r1 - math.sin(ang) * w1, cy + math.sin(ang) * r1 + math.cos(ang) * w1, z1))

                bm.faces.new((bm.verts.new(p0_l), bm.verts.new(p0_r), bm.verts.new(p1_r), bm.verts.new(p1_l)))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    ob = obj_from_bm("Ferns", bm, col, leaf_mat)
    shade_flat(ob, smooth=True)


def build_boulders(col, stone_mat):
    """Mossy boulders framing the clearing."""
    boulders = [
        (-3.8, 1.2, 2.0),
        (-4.5, -0.8, 1.8),
        (3.8, 1.4, 2.1),
        (4.5, -0.6, 1.8),
        (-1.8, 4.5, 1.9),
        (2.0, 4.8, 2.0),
    ]
    for idx, (bx, by, bs) in enumerate(boulders):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1)
        r = bpy.context.active_object
        for c in r.users_collection:
            c.objects.unlink(r)
        col.objects.link(r)
        r.name = f"Boulder_{idx}"
        r.location = (bx, by, bs * 0.35)
        r.scale = (bs * R(0.85, 1.15), bs * R(0.7, 0.95), bs * R(0.8, 1.1))
        r.rotation_euler = (R(0, 1), R(0, 1), R(0, 3))
        tex = bpy.data.textures.new(f"RNoise_{idx}", "CLOUDS")
        tex.noise_scale = 0.5
        d = r.modifiers.new("Displace", "DISPLACE")
        d.texture = tex
        d.strength = 0.45
        r.data.materials.append(stone_mat)
        shade_flat(r, smooth=True)


# ------------------------------------------------------------------ lighting
def setup_lighting(col):
    world = bpy.data.worlds.new("JungleNight")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.003, 0.004, 0.006, 1)
    bg.inputs["Strength"].default_value = 1.0

    # 1. Main Sun / Moon light angled from upper-right
    sun_dir = Vector((-0.5, 0.1, -1.0)).normalized()
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 8.5
    sun.color = (0.9, 0.95, 1.0)
    sun.angle = math.radians(1.2)
    so = bpy.data.objects.new("Sun", sun)
    so.rotation_euler = sun_dir.to_track_quat("-Z", "Y").to_euler()
    link(so, col)

    # 2. Hero spotlight beam focused on the altar
    target = Vector((0.0, 0.0, 1.9))
    beam = bpy.data.lights.new("HeroShaft", "SPOT")
    beam.energy = 6000
    beam.color = (0.85, 0.94, 1.0)
    beam.spot_size = math.radians(28)
    beam.spot_blend = 0.85
    beam.shadow_soft_size = 0.4
    bo = bpy.data.objects.new("HeroShaft", beam)
    bo.location = target - sun_dir * 8.0
    link(bo, col)
    look_at(bo, target)

    # 3. Cyan core light (radiant emission onto the stone altar)
    core_l = bpy.data.lights.new("CoreLight", "POINT")
    core_l.energy = 450
    core_l.color = (0.1, 0.65, 1.0)
    core_l.shadow_soft_size = 0.35
    co = bpy.data.objects.new("CoreLight", core_l)
    co.location = (0.0, 0.0, 2.0)
    link(co, col)

    # 4. Fill light
    fill = bpy.data.lights.new("Fill", "AREA")
    fill.energy = 160
    fill.size = 8.0
    fill.color = (0.45, 0.6, 0.7)
    fo = bpy.data.objects.new("Fill", fill)
    fo.location = (-3.5, -6.0, 4.5)
    link(fo, col)
    look_at(fo, Vector((0, 0, 1.5)))


def setup_camera(col):
    cam = bpy.data.cameras.new("ShrineCamera")
    cam.lens = 32
    cam.dof.use_dof = True
    cam.dof.focus_distance = 7.5
    cam.dof.aperture_fstop = 4.0
    ob = bpy.data.objects.new("ShrineCamera", cam)
    ob.location = (0.2, -7.5, 1.9)
    link(ob, col)
    look_at(ob, Vector((0.0, 0.0, 2.1)))
    bpy.context.scene.camera = ob


# ------------------------------------------------------------------ bake & export
def build():
    reset()
    cols = {n: collection(n) for n in ("Ground", "Trees", "Altar", "Shrine", "Foliage", "Lighting")}

    stone = stone_material()
    slate = monolith_slate_material()
    glow = glow_core_material((0.08, 0.65, 1.0), 25.0)
    ground = ground_material()
    bark = bark_material()
    leaf_broad = leaf_material("BroadLeaf", (0.06, 0.2, 0.05))
    leaf_fern = leaf_material("Fern", (0.05, 0.15, 0.04))

    build_ground(cols["Ground"], ground)
    build_boulders(cols["Ground"], stone)
    build_banyan_trees(cols["Trees"], bark)
    build_buttress_roots(cols["Trees"], bark)
    build_hanging_lianas(cols["Trees"], bark)
    build_dais(cols["Altar"], stone)
    build_runic_stelae(cols["Altar"], stone)
    build_hero_monolith(cols["Shrine"], slate, glow)
    build_broadleaves(cols["Foliage"], leaf_broad)
    build_ferns(cols["Foliage"], leaf_fern)

    setup_lighting(cols["Lighting"])
    setup_camera(cols["Lighting"])

    # Save .blend file
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    print(f"Saved {OUT_BLEND}")

    # Realize evaluated geometry (curves to meshes, modifiers evaluated)
    dg = bpy.context.evaluated_depsgraph_get()
    def delete(ob):
        bpy.data.objects.remove(ob, do_unlink=True)

    def realize(ob):
        ev = ob.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        me.transform(ob.matrix_world)
        name = ob.name
        new = bpy.data.objects.new(name + "_eval", me)
        for m in ob.data.materials:
            new.data.materials.append(m)
        for c in ob.users_collection:
            c.objects.link(new)
        delete(ob)
        new.name = name
        return new

    targets = [o for o in list(bpy.data.objects) if o.type in {"MESH", "CURVE"}]
    for o in targets:
        realize(o)

    # Join groups
    def join_prefix(prefix, name):
        grp = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith(prefix)]
        if not grp:
            return
        bpy.ops.object.select_all(action="DESELECT")
        for o in grp:
            o.select_set(True)
        bpy.context.view_layer.objects.active = grp[0]
        if len(grp) > 1:
            bpy.ops.object.join()
        bpy.context.view_layer.objects.active.name = name

    join_prefix("Boulder", "Boulders")
    join_prefix("JungleTree", "Trees")
    join_prefix("Root", "Roots")
    join_prefix("Liana", "Lianas")
    join_prefix("Dais_Tier", "Dais")
    join_prefix("Stele", "Stelae")
    join_prefix("Monolith_Face", "MonolithShell")

    # ------------------------------------------------------------------ CYCLES COMBINED BAKE
    sc = bpy.context.scene
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = "GPU"
    except Exception as e:
        print("Using CPU for Cycles:", e)

    sc.render.engine = "CYCLES"
    sc.cycles.samples = 64
    sc.cycles.use_denoising = False
    sc.render.bake.target = "VERTEX_COLORS"

    bake_objs = [o for o in bpy.data.objects if o.type == "MESH" and len(o.data.polygons) > 0]
    for o in bake_objs:
        ca = o.data.color_attributes.new("Bake", "FLOAT_COLOR", "POINT")
        o.data.color_attributes.active_color = ca
        o.data.color_attributes.render_color_index = o.data.color_attributes.find("Bake")

    bpy.ops.object.select_all(action="DESELECT")
    for o in bake_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = bake_objs[0]

    print("Baking Cycles combined lighting into vertex colors...")
    bpy.ops.object.bake(type="COMBINED")

    # Scale radiance by 1/BAKE_SCALE (identical to intro export)
    baked_mat = bpy.data.materials.new("Baked")
    for o in bake_objs:
        ca = o.data.color_attributes["Bake"]
        for d in ca.data:
            c = d.color
            d.color = (c[0] / BAKE_SCALE, c[1] / BAKE_SCALE, c[2] / BAKE_SCALE, 1.0)
        for p in o.data.polygons:
            p.material_index = 0
        o.data.materials.clear()
        o.data.materials.append(baked_mat)
        for a in [a for a in o.data.color_attributes if a.name != "Bake"]:
            o.data.color_attributes.remove(a)

    # Export to GLB with Draco compression
    bpy.ops.object.select_all(action="DESELECT")
    for o in bake_objs:
        o.select_set(True)

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="NONE",
        export_vertex_color="ACTIVE",
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_color_quantization=12,
    )
    print(f"Exported baked glb to {OUT_GLB} ({os.path.getsize(OUT_GLB) // 1024} KB)")


if __name__ == "__main__":
    build()
