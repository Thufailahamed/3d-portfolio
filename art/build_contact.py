"""
Contact Scene: The Deep Jungle Shrine ("LET'S BUILD SOMETHING THAT GLOWS")
A mystical ancient runic shrine hidden deep in an overgrown tropical jungle:
  - Ancient jungle trees with sprawling buttress roots crawling onto the stone dais
  - Massive creeping lianas & hanging jungle vines draping from the canopy
  - Dense tropical undergrowth: large banana / monstera leaves, lush ferns, climbing ivy
  - Weathered stone dais with circular tiers nestled in the jungle clearing
  - Ruined ancient stone arch overgrown with ivy and weeping vines
  - Hero centerpiece: fractured dark obsidian monolith with radiant cyan/blue core & glowing rune rings
  - Volumetric god rays breaking through the dense jungle canopy
  - Drifting fireflies and jungle mist

Run:
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/build_contact.py -- render
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rnd = random.Random(777)
R = rnd.uniform


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


def nodes_mat(name, viewport_color=(0.5, 0.5, 0.5, 1.0)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = viewport_color
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    return m, nt, out


def sock(coll, name, kind="RGBA"):
    return next(x for x in coll if x.name == name and x.type == kind)


def look_at(ob, target):
    d = target - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def shade_flat(ob, smooth=False):
    for p in ob.data.polygons:
        p.use_smooth = smooth


def frame(pos, normal, up_hint, spin):
    n = normal.normalized()
    t = (up_hint - n * up_hint.dot(n)).normalized()
    t.rotate(Matrix.Rotation(spin, 3, n))
    b = t.cross(n)
    rot = Matrix((b, t, n)).transposed()
    return Matrix.Translation(pos) @ rot.to_4x4()


# ------------------------------------------------------------------ materials
def stone_material():
    m, nt, out = nodes_mat("AncientStone", (0.32, 0.30, 0.26, 1.0))
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.90
    coord = N.new("ShaderNodeTexCoord")

    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 5.0
    noise.inputs["Detail"].default_value = 8.0
    L.new(coord.outputs["Object"], noise.inputs["Vector"])

    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.045, 0.042, 0.035, 1)
    ramp.color_ramp.elements[1].color = (0.24, 0.22, 0.18, 1)
    L.new(noise.outputs["Fac"], ramp.inputs["Fac"])

    # Moss creeps heavily over upward faces in the humid jungle
    geo = N.new("ShaderNodeNewGeometry")
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(geo.outputs["Normal"], sep.inputs["Vector"])
    up = N.new("ShaderNodeMapRange")
    up.inputs["From Min"].default_value = 0.12
    up.inputs["From Max"].default_value = 0.72
    L.new(sep.outputs["Z"], up.inputs["Value"])

    mix = N.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    sock(mix.inputs, "B").default_value = (0.07, 0.16, 0.04, 1)
    L.new(up.outputs["Result"], mix.inputs["Factor"])
    L.new(ramp.outputs["Color"], sock(mix.inputs, "A"))
    L.new(sock(mix.outputs, "Result"), bsdf.inputs["Base Color"])

    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.55
    bump.inputs["Distance"].default_value = 0.03
    L.new(noise.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def monolith_slate_material():
    m, nt, out = nodes_mat("MonolithSlate", (0.05, 0.07, 0.10, 1.0))
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.018, 0.022, 0.03, 1)
    bsdf.inputs["Roughness"].default_value = 0.26
    bsdf.inputs["Metallic"].default_value = 0.88
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def glow_core_material(color=(0.04, 0.52, 1.0), strength=18.0):
    m, nt, out = nodes_mat("GlowingCore", (0.1, 0.65, 1.0, 1.0))
    N, L = nt.nodes, nt.links
    emit = N.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1.0)
    emit.inputs["Strength"].default_value = strength
    L.new(emit.outputs["Emission"], out.inputs["Surface"])
    return m


def rune_gold_material():
    m, nt, out = nodes_mat("RuneGold", (1.0, 0.75, 0.25, 1.0))
    N, L = nt.nodes, nt.links
    emit = N.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (1.0, 0.75, 0.2, 1.0)
    emit.inputs["Strength"].default_value = 14.0
    L.new(emit.outputs["Emission"], out.inputs["Surface"])
    return m


def jungle_leaf_material(name, color, roughness=0.45, trans_fac=0.35):
    m, nt, out = nodes_mat(name, (*color, 1.0))
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    trans = N.new("ShaderNodeBsdfTranslucent")
    trans.inputs["Color"].default_value = (*color, 1)
    mix = N.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = trans_fac
    L.new(bsdf.outputs["BSDF"], mix.inputs[1])
    L.new(trans.outputs["BSDF"], mix.inputs[2])
    L.new(mix.outputs["Shader"], out.inputs["Surface"])
    return m


def bark_material():
    m, nt, out = nodes_mat("JungleBark", (0.18, 0.13, 0.09, 1.0))
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.05, 0.038, 0.026, 1)
    bsdf.inputs["Roughness"].default_value = 0.90
    coord = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 12.0
    L.new(coord.outputs["Object"], noise.inputs["Vector"])
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.65
    L.new(noise.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def ground_material():
    m, nt, out = nodes_mat("JungleFloor", (0.09, 0.08, 0.05, 1.0))
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.026, 0.022, 0.016, 1)
    bsdf.inputs["Roughness"].default_value = 0.95
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


# ------------------------------------------------------------------ geometry builders
def build_ground(col, mat):
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=120, y_subdivisions=120, size=34)
    g = bpy.context.active_object
    for c in g.users_collection:
        c.objects.unlink(g)
    col.objects.link(g)
    g.name = "JungleGround"
    g.location = (0, 2.5, 0)
    tex = bpy.data.textures.new("GroundMound", "CLOUDS")
    tex.noise_scale = 1.8
    d = g.modifiers.new("Displace", "DISPLACE")
    d.texture = tex
    d.strength = 0.45
    d.texture_coords = "GLOBAL"
    g.data.materials.append(mat)
    shade_flat(g, smooth=True)
    return g


def build_dais(col, stone_mat):
    """Ancient stepped circular stone altar with weathered blocks."""
    center = (0.5, 0.2)
    tiers = [
        {"r": 3.1, "h": 0.28, "z": 0.0},
        {"r": 2.2, "h": 0.30, "z": 0.28},
        {"r": 1.35, "h": 0.34, "z": 0.58},
    ]
    for idx, t in enumerate(tiers):
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=False,
            radius1=t["r"],
            radius2=t["r"],
            depth=t["h"],
            segments=48,
        )
        ob = obj_from_bm(f"Dais_Tier_{idx}", bm, col, stone_mat)
        ob.location = (center[0], center[1], t["z"] + t["h"] / 2)
        bev = ob.modifiers.new("Bevel", "BEVEL")
        bev.width = 0.05
        bev.segments = 2


def build_ruined_arch(col, stone_mat):
    """Ancient ruined stone arch standing in the jungle behind the altar."""
    cx, cy = 0.5, 2.4
    r_inner = 1.65
    thick = 0.48
    depth = 0.58
    pillar_h = 2.6

    for side in (-1, 1):
        x = cx + side * (r_inner + thick / 2)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        ob = obj_from_bm(f"Arch_Pillar_{side}", bm, col, stone_mat)
        h = pillar_h * (0.65 if side < 0 else 1.0)
        ob.scale = (thick, depth, h)
        ob.location = (x, cy, h / 2)
        ob.rotation_euler = Euler((R(-0.02, 0.02), R(-0.03, 0.03), R(-0.05, 0.05)))
        bev = ob.modifiers.new("Bevel", "BEVEL")
        bev.width = 0.05
        bev.segments = 2

    n = 10
    bm_curve = bmesh.new()
    for i in range(n):
        a0 = math.pi * 0.12 + (i / n) * math.pi * 0.5
        a1 = a0 + (math.pi * 0.5 / n) * 0.95
        r0 = r_inner
        r1 = r_inner + thick
        c0 = Vector((cx + math.cos(a0) * r0, cy, pillar_h + math.sin(a0) * r0))
        c1 = Vector((cx + math.cos(a0) * r1, cy, pillar_h + math.sin(a0) * r1))
        c2 = Vector((cx + math.cos(a1) * r1, cy, pillar_h + math.sin(a1) * r1))
        c3 = Vector((cx + math.cos(a1) * r0, cy, pillar_h + math.sin(a1) * r0))

        v0 = bm_curve.verts.new(c0 + Vector((0, -depth / 2, 0)))
        v1 = bm_curve.verts.new(c1 + Vector((0, -depth / 2, 0)))
        v2 = bm_curve.verts.new(c2 + Vector((0, -depth / 2, 0)))
        v3 = bm_curve.verts.new(c3 + Vector((0, -depth / 2, 0)))
        v4 = bm_curve.verts.new(c0 + Vector((0, depth / 2, 0)))
        v5 = bm_curve.verts.new(c1 + Vector((0, depth / 2, 0)))
        v6 = bm_curve.verts.new(c2 + Vector((0, depth / 2, 0)))
        v7 = bm_curve.verts.new(c3 + Vector((0, depth / 2, 0)))

        for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
            bm_curve.faces.new([v0, v1, v2, v3, v4, v5, v6, v7][k] for k in f)
    bmesh.ops.recalc_face_normals(bm_curve, faces=list(bm_curve.faces))
    ob_arch = obj_from_bm("RuinedArch", bm_curve, col, stone_mat)
    bev2 = ob_arch.modifiers.new("Bevel", "BEVEL")
    bev2.width = 0.03
    bev2.segments = 2


def build_glowing_monolith(col, slate_mat, glow_mat, gold_mat):
    """The central fractured obsidian monolith with glowing core and runic halo."""
    center = Vector((0.5, 0.2, 1.95))

    # Inner glowing crystal core
    bm_core = bmesh.new()
    bmesh.ops.create_cone(
        bm_core,
        cap_ends=True,
        cap_tris=True,
        segments=6,
        radius1=0.25,
        radius2=0.04,
        depth=2.4,
    )
    ob_core = obj_from_bm("GlowingCoreBeacon", bm_core, col, glow_mat)
    ob_core.location = center

    # 4 fractured dark slate facets revealing the core
    for i in range(4):
        ang = (i / 4.0) * math.tau + 0.35
        dist = 0.25
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=True,
            segments=4,
            radius1=0.22,
            radius2=0.08,
            depth=2.3,
        )
        ob = obj_from_bm(f"Monolith_Face_{i}", bm, col, slate_mat)
        ob.location = center + Vector((math.cos(ang) * dist, math.sin(ang) * dist, R(-0.04, 0.04)))
        ob.rotation_euler = Euler((R(-0.05, 0.05), R(-0.05, 0.05), ang))

    # 2 orbital energy rings (thin delicate glowing filaments)
    rings = [
        {"r": 0.88, "rot": (0.35, 0.25, 0.0), "z": 0.15, "mat": glow_mat, "thick": 0.012},
        {"r": 1.38, "rot": (-0.40, 0.55, 0.7), "z": 0.35, "mat": gold_mat, "thick": 0.012},
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


# ------------------------------------------------------------------ jungle elements
def build_jungle_trees(col, bark_mat):
    """Massive tropical jungle trees with knobby buttress trunks and leaning branches."""
    trees = [
        # Left framing trees
        (-3.8, -1.8, 0.85, 14.0, (0.08, -0.05)),
        (-5.5, 0.8, 1.10, 16.0, (0.05, -0.04)),
        (-4.2, 4.2, 0.90, 15.0, (-0.04, -0.06)),
        # Right framing trees
        (3.6, -1.5, 0.80, 14.0, (-0.08, 0.05)),
        (5.2, 1.2, 1.15, 16.0, (-0.06, 0.04)),
        (4.4, 4.0, 0.95, 15.0, (0.04, 0.05)),
        # Deep background jungle wall
        (-1.5, 6.5, 0.75, 15.0, (0.02, -0.02)),
        (1.2, 7.5, 0.85, 16.0, (-0.03, 0.03)),
        (-3.2, 8.5, 0.80, 15.0, (0.0, 0.0)),
        (3.0, 8.8, 0.90, 16.0, (0.0, 0.0)),
    ]
    for idx, (tx, ty, trad, th, (tilt_x, tilt_y)) in enumerate(trees):
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=False,
            radius1=trad * 1.5,
            radius2=trad * 0.75,
            depth=th,
            segments=24,
        )
        ob = obj_from_bm(f"JungleTree_{idx}", bm, col, bark_mat)
        ob.location = (tx, ty, th / 2 - 0.2)
        ob.rotation_euler = Euler((tilt_x, tilt_y, R(0, math.tau)))
        shade_flat(ob, smooth=True)

        # Overhead leaning jungle branch reaching into the canopy
        if idx in (0, 3):
            side = -1 if tx < 0 else 1
            cu = bpy.data.curves.new(f"OverheadBranch_{idx}", "CURVE")
            cu.dimensions = "3D"
            cu.bevel_depth = 0.18
            cu.bevel_resolution = 4
            sp = cu.splines.new("BEZIER")
            sp.bezier_points.add(2)
            pts = [
                Vector((tx, ty, 6.0)),
                Vector((tx + side * 1.5, ty + 1.2, 6.8)),
                Vector((0.5 + side * 1.2, 0.2, 7.2)),
            ]
            for k, bp in enumerate(sp.bezier_points):
                bp.co = pts[k]
                bp.handle_left_type = bp.handle_right_type = "AUTO"
            ob_br = bpy.data.objects.new(f"OverheadBranch_{idx}", cu)
            cu.materials.append(bark_mat)
            link(ob_br, col)


def build_buttress_roots(col, bark_mat):
    """Sprawling banyan/ficus buttress roots crawling out across the clearing & dais."""
    root_specs = [
        # Creeping onto the stone dais from the left
        [Vector((-3.8, -1.8, 0.4)), Vector((-2.2, -1.0, 0.15)), Vector((-1.0, -0.4, 0.25)), Vector((0.1, -0.2, 0.32))],
        [Vector((-3.8, -1.8, 0.3)), Vector((-2.6, -0.5, 0.12)), Vector((-1.4, 0.3, 0.28)), Vector((-0.2, 0.4, 0.45))],
        # Creeping from the right tree onto the dais
        [Vector((3.6, -1.5, 0.4)), Vector((2.4, -0.8, 0.15)), Vector((1.5, -0.3, 0.26)), Vector((0.9, -0.1, 0.32))],
        [Vector((3.6, -1.5, 0.3)), Vector((2.8, -0.2, 0.10)), Vector((1.8, 0.5, 0.25)), Vector((1.1, 0.4, 0.42))],
        # Wandering ground roots across the clearing
        [Vector((-4.5, 1.2, 0.3)), Vector((-3.0, 2.0, 0.12)), Vector((-1.5, 2.5, 0.05)), Vector((-0.5, 2.8, 0.0))],
        [Vector((4.5, 1.5, 0.3)), Vector((3.2, 2.2, 0.10)), Vector((2.0, 2.8, 0.06)), Vector((1.2, 3.0, 0.0))],
        [Vector((-2.0, -3.2, 0.2)), Vector((-1.0, -2.5, 0.05)), Vector((0.2, -2.0, 0.04)), Vector((1.5, -2.4, 0.05))],
    ]
    for idx, pts in enumerate(root_specs):
        cu = bpy.data.curves.new(f"ButtressRoot_{idx}", "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = R(0.08, 0.15)
        cu.bevel_resolution = 4
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(pts) - 1)
        for k, bp in enumerate(sp.bezier_points):
            bp.co = pts[k]
            bp.handle_left_type = bp.handle_right_type = "AUTO"
        ob = bpy.data.objects.new(f"ButtressRoot_{idx}", cu)
        cu.materials.append(bark_mat)
        link(ob, col)


def build_hanging_lianas(col, bark_mat):
    """Twisting lianas and vines drooping down from the jungle canopy."""
    lianas = [
        # Near ruined arch
        [Vector((1.8, 2.2, 6.5)), Vector((1.6, 2.1, 4.2)), Vector((1.9, 2.3, 2.8)), Vector((1.7, 2.2, 1.4))],
        [Vector((-0.8, 2.5, 6.5)), Vector((-0.6, 2.4, 4.0)), Vector((-0.9, 2.6, 2.6)), Vector((-0.7, 2.5, 1.1))],
        # Left side jungle
        [Vector((-2.8, 0.0, 7.0)), Vector((-2.5, -0.2, 4.5)), Vector((-2.9, 0.1, 2.5)), Vector((-2.6, -0.1, 0.8))],
        [Vector((-3.4, -1.2, 6.8)), Vector((-3.2, -1.0, 4.0)), Vector((-3.5, -1.3, 2.2)), Vector((-3.1, -1.1, 0.6))],
        # Right side jungle
        [Vector((2.6, 0.2, 7.0)), Vector((2.4, 0.0, 4.6)), Vector((2.7, 0.3, 2.6)), Vector((2.5, 0.1, 0.9))],
        [Vector((3.2, -1.0, 6.8)), Vector((3.0, -0.8, 4.2)), Vector((3.4, -1.1, 2.4)), Vector((3.1, -0.9, 0.7))],
    ]
    for idx, pts in enumerate(lianas):
        cu = bpy.data.curves.new(f"Liana_{idx}", "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = R(0.025, 0.045)
        cu.bevel_resolution = 3
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(pts) - 1)
        for k, bp in enumerate(sp.bezier_points):
            bp.co = pts[k]
            bp.handle_left_type = bp.handle_right_type = "AUTO"
        ob = bpy.data.objects.new(f"Liana_{idx}", cu)
        cu.materials.append(bark_mat)
        link(ob, col)


def build_broadleaf_jungle_plants(col, leaf_mat):
    """Large Elephant-Ear / Monstera / Banana leaves flanking the clearing & dais."""
    clusters = [
        # Left side midground & foreground
        (-2.4, -2.4, 1.4, 7),
        (-3.4, -0.6, 1.5, 8),
        (-2.6, 1.6, 1.3, 6),
        # Right side midground & foreground
        (2.6, -2.0, 1.3, 7),
        (3.4, -0.2, 1.4, 8),
        (2.8, 1.8, 1.4, 6),
        # Around the dais base (not directly blocking monolith)
        (-1.6, -0.2, 1.1, 6),
        (2.2, 0.2, 1.1, 6),
        (-0.2, 2.6, 1.4, 7),
        (1.2, 2.5, 1.3, 6),
    ]

    bm = bmesh.new()
    for cx, cy, sc, n_leaves in clusters:
        for i in range(n_leaves):
            ang = (i / n_leaves) * math.tau + R(-0.2, 0.2)
            L = sc * R(0.85, 1.35)
            W = L * R(0.38, 0.52)
            steps = 8
            prev_row = None
            for s in range(steps + 1):
                t = s / steps
                dist_r = t * L
                z_h = math.sin(t * math.pi * 0.65) * 0.42 * L - (t**2.2) * 0.32 * L + 0.12 * sc
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
    ob = obj_from_bm("JungleBroadleaves", bm, col, leaf_mat)
    shade_flat(ob, smooth=True)


def build_dense_ferns(col, leaf_mat):
    """Dense lush fern carpet around the clearing, boulders, and dais perimeter."""
    clumps = [
        (-1.5, -1.8, 1.0, 10),
        (1.8, -1.6, 1.0, 10),
        (-2.5, -1.0, 0.9, 9),
        (2.6, -0.8, 1.1, 9),
        (-0.5, -2.4, 0.9, 8),
        (0.8, -2.2, 0.9, 8),
        (-3.0, 1.0, 1.0, 9),
        (3.0, 1.2, 1.0, 9),
        (-1.2, 2.6, 1.1, 9),
        (1.4, 2.5, 1.1, 9),
        # Dais perimeter fringes
        (-2.0, 0.2, 0.85, 8),
        (2.2, 0.0, 0.85, 8),
        (0.0, 1.8, 0.9, 8),
        (1.0, 1.9, 0.85, 7),
    ]
    bm = bmesh.new()
    for cx, cy, cscale, n_fronds in clumps:
        for f in range(n_fronds):
            ang = (f / n_fronds) * math.tau + R(-0.2, 0.2)
            L = cscale * R(0.65, 0.95)
            steps = 8
            for s in range(steps):
                t0 = s / steps
                t1 = (s + 1) / steps
                r0 = t0 * L
                r1 = t1 * L
                z0 = math.sin(t0 * math.pi * 0.5) * 0.32 * L - (t0**2) * 0.2 * L
                z1 = math.sin(t1 * math.pi * 0.5) * 0.32 * L - (t1**2) * 0.2 * L
                w0 = (1.0 - t0) * 0.08 * cscale
                w1 = (1.0 - t1) * 0.08 * cscale

                p0_l = Vector((cx + math.cos(ang) * r0 - math.sin(ang) * w0, cy + math.sin(ang) * r0 + math.cos(ang) * w0, z0))
                p0_r = Vector((cx + math.cos(ang) * r0 + math.sin(ang) * w0, cy + math.sin(ang) * r0 - math.cos(ang) * w0, z0))
                p1_r = Vector((cx + math.cos(ang) * r1 + math.sin(ang) * w1, cy + math.sin(ang) * r1 - math.cos(ang) * w1, z1))
                p1_l = Vector((cx + math.cos(ang) * r1 - math.sin(ang) * w1, cy + math.sin(ang) * r1 + math.cos(ang) * w1, z1))

                bm.faces.new((bm.verts.new(p0_l), bm.verts.new(p0_r), bm.verts.new(p1_r), bm.verts.new(p1_l)))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    ob = obj_from_bm("DenseFerns", bm, col, leaf_mat)
    shade_flat(ob, smooth=True)


def build_arch_ivy(col, leaf_mat):
    """Dense climbing ivy covering the ruined arch & pillars."""
    leaves = []
    cx, cy = 0.5, 2.4
    r_inner = 1.65
    thick = 0.48

    def scatter(p, n, count=4):
        for _ in range(count):
            pos = p + Vector((R(-0.08, 0.08), R(-0.06, 0.06), R(-0.08, 0.08)))
            M = frame(pos, n, Vector((0, 0, 1)), R(-1.5, 1.5))
            leaves.append((M, R(0.07, 0.14)))

    for z in [0.2 + i * 0.1 for i in range(24)]:
        scatter(Vector((cx + (r_inner + thick / 2), cy - 0.26, z)), Vector((0, -1, 0)), 4)
        scatter(Vector((cx - (r_inner + thick / 2), cy - 0.26, min(z, 1.7))), Vector((0, -1, 0)), 4)

    for i in range(16):
        ang = math.pi * 0.12 + (i / 16) * math.pi * 0.5
        r = r_inner + thick * 0.55
        p = Vector((cx + math.cos(ang) * r, cy - 0.26, 2.6 + math.sin(ang) * r))
        scatter(p, Vector((0, -1, 0)), 5)
        if i in (3, 6, 10, 13):
            for h in range(5):
                scatter(p + Vector((0, 0, -h * 0.08 - 0.05)), Vector((0, -1, 0)), 2)

    bm = bmesh.new()
    for M, size in leaves:
        s = size
        outline = [
            (0, -0.1 * s, 0),
            (0.45 * s, 0.2 * s, 0.02 * s),
            (0.35 * s, 0.65 * s, 0.03 * s),
            (0, 1.0 * s, 0),
            (-0.35 * s, 0.65 * s, 0.03 * s),
            (-0.45 * s, 0.2 * s, 0.02 * s),
        ]
        pts = [bm.verts.new(M @ Vector(pt)) for pt in outline]
        c = bm.verts.new(M @ Vector((0, 0.4 * s, -0.03 * s)))
        for k in range(len(pts)):
            bm.faces.new((c, pts[k], pts[(k + 1) % len(pts)]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    ob = obj_from_bm("ArchIvy", bm, col, leaf_mat)
    shade_flat(ob, smooth=True)


def build_mossy_boulders(col, stone_mat):
    """Large ancient jungle boulders embedded in the earth and covered in moss."""
    boulders = [
        (-4.8, 1.5, 2.4),
        (-5.8, -1.0, 2.2),
        (5.0, 1.8, 2.6),
        (5.8, -1.2, 2.0),
        (-2.2, 5.5, 2.2),
        (2.8, 6.0, 2.4),
        (0.2, 8.0, 3.0),
    ]
    for idx, (bx, by, bs) in enumerate(boulders):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1)
        r = bpy.context.active_object
        for c in r.users_collection:
            c.objects.unlink(r)
        col.objects.link(r)
        r.name = f"JungleBoulder_{idx}"
        r.location = (bx, by, bs * 0.35)
        r.scale = (bs * R(0.85, 1.2), bs * R(0.7, 0.95), bs * R(0.8, 1.15))
        r.rotation_euler = (R(0, 1), R(0, 1), R(0, 3))
        tex = bpy.data.textures.new(f"RockNoise_{idx}", "CLOUDS")
        tex.noise_scale = 0.5
        d = r.modifiers.new("Displace", "DISPLACE")
        d.texture = tex
        d.strength = 0.5
        r.data.materials.append(stone_mat)
        shade_flat(r, smooth=True)


def build_fireflies(col, glow_mat):
    """Ethereal motes and fireflies dancing in the humid jungle air."""
    for i in range(40):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=R(0.012, 0.026))
        ob = obj_from_bm(f"JungleFirefly_{i}", bm, col, glow_mat)
        ob.location = (
            R(-3.8, 4.2),
            R(-2.8, 3.8),
            R(0.4, 3.8),
        )


# ------------------------------------------------------------------ lighting & camera
def build_lighting(col):
    world = bpy.data.worlds.new("JungleNight")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.002, 0.0035, 0.005, 1)
    bg.inputs["Strength"].default_value = 1.0

    # 1. Moonlight / Canopy Sun (directional beam breaking through trees)
    sun_dir = Vector((-0.45, 0.12, -1.0)).normalized()
    sun = bpy.data.lights.new("JungleSun", "SUN")
    sun.energy = 3.6
    sun.color = (0.85, 0.94, 1.0)
    sun.angle = math.radians(1.4)
    so = bpy.data.objects.new("JungleSun", sun)
    so.rotation_euler = sun_dir.to_track_quat("-Z", "Y").to_euler()
    link(so, col)

    # 2. Hero God Ray Shaft targeting the altar
    target = Vector((0.5, 0.2, 1.95))
    beam = bpy.data.lights.new("HeroCanopyBeam", "SPOT")
    beam.energy = 7200
    beam.color = (0.84, 0.95, 1.0)
    beam.spot_size = math.radians(30)
    beam.spot_blend = 0.88
    beam.shadow_soft_size = 0.45
    bo = bpy.data.objects.new("HeroCanopyBeam", beam)
    bo.location = target - sun_dir * 8.5
    link(bo, col)
    look_at(bo, target)

    # 3. Radiant Core Light (rich cyan glow casting onto the jungle leaves & altar)
    core_l = bpy.data.lights.new("CoreLight", "POINT")
    core_l.energy = 550
    core_l.color = (0.05, 0.55, 1.0)
    core_l.shadow_soft_size = 0.35
    co = bpy.data.objects.new("CoreLight", core_l)
    co.location = (0.5, 0.2, 2.05)
    link(co, col)

    # 4. Soft rim light from behind the ruined arch to separate it from the deep jungle trees
    arch_rim = bpy.data.lights.new("ArchRim", "AREA")
    arch_rim.energy = 220
    arch_rim.size = 6.0
    arch_rim.color = (0.55, 0.72, 0.85)
    ao = bpy.data.objects.new("ArchRim", arch_rim)
    ao.location = (0.5, 5.0, 4.5)
    link(ao, col)
    look_at(ao, Vector((0.5, 2.4, 2.0)))

    # 5. Volumetric Jungle Haze box
    bpy.ops.mesh.primitive_cube_add(size=1)
    v = bpy.context.active_object
    for c in v.users_collection:
        c.objects.unlink(v)
    col.objects.link(v)
    v.name = "JungleMist"
    v.location = (0, 2.5, 4.5)
    v.scale = (32, 32, 12)
    m, nt, out = nodes_mat("JungleMistMat")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = 0.016
    vol.inputs["Anisotropy"].default_value = 0.72
    vol.inputs["Color"].default_value = (0.86, 0.94, 1.0, 1)
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    v.data.materials.append(m)


def build_camera(col):
    cam = bpy.data.cameras.new("ContactCamera")
    cam.lens = 30
    cam.dof.use_dof = True
    cam.dof.focus_distance = 8.6
    cam.dof.aperture_fstop = 3.6
    ob = bpy.data.objects.new("ContactCamera", cam)
    ob.location = (-0.3, -8.4, 1.65)
    link(ob, col)
    look_at(ob, Vector((0.45, 0.2, 1.95)))
    bpy.context.scene.camera = ob


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 1920
    sc.render.resolution_y = 1080
    sc.render.resolution_percentage = 80
    ee = sc.eevee
    if hasattr(ee, "taa_render_samples"):
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
    sc.view_settings.exposure = 0.22


def build():
    reset()
    cols = {n: collection(n) for n in ("Ground", "Trees", "Altar", "Shrine", "Foliage", "FX", "Lighting")}

    stone = stone_material()
    slate = monolith_slate_material()
    glow = glow_core_material((0.04, 0.55, 1.0), 18.0)
    gold = rune_gold_material()
    ground = ground_material()
    bark = bark_material()
    jungle_green = jungle_leaf_material("JungleGreen", (0.05, 0.18, 0.04))
    broad_green = jungle_leaf_material("BroadGreen", (0.06, 0.22, 0.05), roughness=0.4)

    build_ground(cols["Ground"], ground)
    build_mossy_boulders(cols["Ground"], stone)
    build_jungle_trees(cols["Trees"], bark)
    build_buttress_roots(cols["Trees"], bark)
    build_hanging_lianas(cols["Trees"], bark)

    build_dais(cols["Altar"], stone)
    build_ruined_arch(cols["Altar"], stone)
    build_arch_ivy(cols["Foliage"], jungle_green)

    build_glowing_monolith(cols["Shrine"], slate, glow, gold)

    build_broadleaf_jungle_plants(cols["Foliage"], broad_green)
    build_dense_ferns(cols["Foliage"], jungle_green)

    build_fireflies(cols["FX"], glow)
    build_lighting(cols["Lighting"])
    build_camera(cols["Lighting"])
    setup_render()

    out_blend = os.path.join(ROOT, "art", "contact.blend")
    bpy.ops.wm.save_as_mainfile(filepath=out_blend)
    print(f"Saved {out_blend}")


if __name__ == "__main__":
    build()
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if "render" in args:
        os.makedirs(os.path.join(ROOT, "art", "renders"), exist_ok=True)
        out_png = os.path.join(ROOT, "art", "renders", "contact.png")
        bpy.context.scene.render.filepath = out_png
        bpy.ops.render.render(write_still=True)
        print(f"Rendered {out_png}")
