"""
Contact / Shrine scene: "LET'S BUILD SOMETHING THAT GLOWS"
An ancient celestial sanctuary at night:
  - Stepped circular stone dais / altar with weathered flagstones
  - Ring of ancient weathered colonnade pillars (some broken, some standing)
  - Hero centerpiece: A levitating fractured obsidian spire revealing a radiant glowing core
  - Floating concentric orbital runic rings hovering around the spire
  - Creeping ivy, moss, and roots at the base of the columns
  - Cinematic volumetric light shaft (moonlight beam) striking the altar
  - Atmospheric haze, glowing fireflies / motes, and cyan core glow

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/build_contact.py [-- render]
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rnd = random.Random(4242)
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


def look_at(ob, target):
    d = target - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


# ------------------------------------------------------------------ materials
def stone_material():
    m, nt, out = nodes_mat("AncientStone")
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.88

    coord = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 6.0
    noise.inputs["Detail"].default_value = 8.0
    noise.inputs["Roughness"].default_value = 0.65
    L.new(coord.outputs["Object"], noise.inputs["Vector"])

    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.02, 0.022, 0.025, 1)
    ramp.color_ramp.elements[1].color = (0.09, 0.10, 0.11, 1)
    L.new(noise.outputs["Fac"], ramp.inputs["Fac"])

    # moss on top faces
    geo = N.new("ShaderNodeNewGeometry")
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(geo.outputs["Normal"], sep.inputs["Vector"])
    up = N.new("ShaderNodeMapRange")
    up.inputs["From Min"].default_value = 0.2
    up.inputs["From Max"].default_value = 0.8
    L.new(sep.outputs["Z"], up.inputs["Value"])

    mix = N.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    sock(mix.inputs, "B").default_value = (0.03, 0.065, 0.025, 1)
    L.new(up.outputs["Result"], mix.inputs["Factor"])
    L.new(ramp.outputs["Color"], sock(mix.inputs, "A"))
    L.new(sock(mix.outputs, "Result"), bsdf.inputs["Base Color"])

    # subtle surface bump
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.03
    L.new(noise.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def dark_slate_material():
    m, nt, out = nodes_mat("DarkSlate")
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.012, 0.014, 0.016, 1)
    bsdf.inputs["Roughness"].default_value = 0.28
    bsdf.inputs["Metallic"].default_value = 0.85

    coord = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 14.0
    L.new(coord.outputs["Object"], noise.inputs["Vector"])

    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.15
    L.new(noise.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def glow_core_material():
    m, nt, out = nodes_mat("GlowingCore")
    N, L = nt.nodes, nt.links
    emit = N.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (0.15, 0.65, 1.0, 1.0)
    emit.inputs["Strength"].default_value = 35.0
    L.new(emit.outputs["Emission"], out.inputs["Surface"])
    return m


def rune_gold_material():
    m, nt, out = nodes_mat("RuneGold")
    N, L = nt.nodes, nt.links
    emit = N.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (1.0, 0.82, 0.35, 1.0)
    emit.inputs["Strength"].default_value = 18.0
    L.new(emit.outputs["Emission"], out.inputs["Surface"])
    return m


def ivy_material():
    m, nt, out = nodes_mat("Ivy")
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.04, 0.11, 0.035, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.45
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def floor_material():
    m, nt, out = nodes_mat("FloorMirror")
    N, L = nt.nodes, nt.links
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.008, 0.010, 0.013, 1)
    bsdf.inputs["Roughness"].default_value = 0.22
    bsdf.inputs["Metallic"].default_value = 0.4
    L.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


# ------------------------------------------------------------------ geometry builders
def build_dais(col, stone_mat):
    """Tiered circular stone altar dais with bevel and noise."""
    tiers = [
        {"r": 4.8, "h": 0.28, "z": 0.0},
        {"r": 3.6, "h": 0.32, "z": 0.28},
        {"r": 2.4, "h": 0.35, "z": 0.60},
        {"r": 1.4, "h": 0.40, "z": 0.95},
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
        ob.location.z = t["z"] + t["h"] / 2
        # slight bevel
        bev = ob.modifiers.new("Bevel", "BEVEL")
        bev.width = 0.04
        bev.segments = 2


def build_colonnade(col, stone_mat):
    """A sweeping semicircle of ancient pillars framing the background."""
    radius = 5.6
    angles = [-105, -75, -45, -15, 15, 45, 75, 105, 135]
    for i, deg in enumerate(angles):
        rad = math.radians(deg)
        x = math.cos(rad) * radius + R(-0.06, 0.06)
        y = math.sin(rad) * radius + 1.2 + R(-0.06, 0.06)

        # Some pillars are broken, some full height
        is_broken = i in (1, 3, 6)
        height = R(2.2, 3.2) if is_broken else R(4.2, 5.0)

        # Base plinth
        bm_base = bmesh.new()
        bmesh.ops.create_cube(bm_base, size=0.9)
        ob_base = obj_from_bm(f"Pillar_Base_{i}", bm_base, col, stone_mat)
        ob_base.scale = (1.0, 1.0, 0.4)
        ob_base.location = (x, y, 0.2)

        # Fluted or faceted cylinder shaft
        bm_shaft = bmesh.new()
        bmesh.ops.create_cone(
            bm_shaft,
            cap_ends=True,
            cap_tris=False,
            radius1=R(0.38, 0.44),
            radius2=R(0.38, 0.44),
            depth=height,
            segments=16,
        )
        ob_shaft = obj_from_bm(f"Pillar_Shaft_{i}", bm_shaft, col, stone_mat)
        ob_shaft.location = (x, y, 0.4 + height / 2)
        # slight tilt for age
        ob_shaft.rotation_euler = Euler((R(-0.03, 0.03), R(-0.03, 0.03), R(-0.2, 0.2)))

        # Capital on full pillars
        if not is_broken:
            bm_cap = bmesh.new()
            bmesh.ops.create_cube(bm_cap, size=0.95)
            ob_cap = obj_from_bm(f"Pillar_Cap_{i}", bm_cap, col, stone_mat)
            ob_cap.scale = (1.05, 1.05, 0.35)
            ob_cap.location = (x, y, 0.4 + height + 0.15)


def build_hero_monolith(col, slate_mat, glow_mat):
    """The central fractured monolith: dark obsidian exterior with radiant cyan core."""
    z_center = 2.4

    # Outer shell shards (fractured spire)
    for k in range(5):
        angle = (k / 5.0) * math.tau + 0.35
        dist = 0.28 + R(-0.02, 0.03)
        bm = bmesh.new()
        # tall tapered faceted shard
        h = R(2.6, 3.4)
        r_bot = R(0.22, 0.32)
        r_top = R(0.06, 0.14)
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=True,
            segments=5,
            radius1=r_bot,
            radius2=r_top,
            depth=h,
        )
        ob = obj_from_bm(f"Monolith_Shard_{k}", bm, col, slate_mat)
        ob.location = (
            math.cos(angle) * dist,
            math.sin(angle) * dist,
            z_center + R(-0.15, 0.15),
        )
        ob.rotation_euler = Euler((R(-0.08, 0.08), R(-0.08, 0.08), angle + R(-0.1, 0.1)))

    # The radiant inner core
    bm_core = bmesh.new()
    bmesh.ops.create_icosphere(bm_core, subdivisions=3, radius=0.45)
    # stretch vertically like a diamond flame
    for v in bm_core.verts:
        v.co.z *= 2.2
    ob_core = obj_from_bm("Hero_Glowing_Core", bm_core, col, glow_mat)
    ob_core.location = (0, 0, z_center)


def build_orbital_rings(col, rune_mat):
    """Levitating celestial astrolabe / gyro rings around the core."""
    rings_data = [
        {"r": 1.15, "thick": 0.025, "rot": (0.35, 0.25, 0.0), "z": 2.4},
        {"r": 1.65, "thick": 0.028, "rot": (-0.45, 0.65, 0.8), "z": 2.45},
        {"r": 2.20, "thick": 0.032, "rot": (0.75, -0.30, -0.5), "z": 2.35},
    ]
    for idx, rd in enumerate(rings_data):
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=False, radius=rd["r"], segments=48)
        # make it a thin 3D band
        ext = bmesh.ops.extrude_edge_only(bm, edges=list(bm.edges))
        for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
            v.co.z += rd["thick"]
        ob = obj_from_bm(f"Orbital_Rune_Ring_{idx}", bm, col, rune_mat)
        ob.location = (0, 0, rd["z"])
        ob.rotation_euler = Euler(rd["rot"])
        # solidify
        sol = ob.modifiers.new("Solidify", "SOLIDIFY")
        sol.thickness = rd["thick"] * 1.5


def build_ivy_foliage(col, ivy_mat):
    """Tendrils and leaves creeping up the colonnade and dais."""
    for i in range(16):
        deg = (i / 16.0) * 360 + R(-8, 8)
        rad = math.radians(deg)
        dist = R(2.4, 4.6)
        x = math.cos(rad) * dist
        y = math.sin(rad) * dist
        z = R(0.2, 1.2)

        bm = bmesh.new()
        # leaf diamond
        v0 = bm.verts.new((0, -0.08, 0))
        v1 = bm.verts.new((0.08, 0, 0.02))
        v2 = bm.verts.new((0, 0.16, 0.04))
        v3 = bm.verts.new((-0.08, 0, 0.02))
        bm.faces.new((v0, v1, v2, v3))
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))

        ob = obj_from_bm(f"Ivy_Leaf_{i}", bm, col, ivy_mat)
        ob.location = (x, y, z)
        ob.rotation_euler = Euler((R(-0.4, 0.4), R(-0.4, 0.4), R(0, math.tau)))
        ob.scale = (R(1.2, 2.0), R(1.2, 2.0), R(1.2, 2.0))


def build_fireflies(col, glow_mat):
    """Glowing motes floating around the sanctuary."""
    for i in range(40):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=R(0.012, 0.028))
        ob = obj_from_bm(f"Mote_{i}", bm, col, glow_mat)
        ob.location = (
            R(-3.0, 3.0),
            R(-2.0, 3.5),
            R(0.8, 4.2),
        )


def build_ground_mirror(col, floor_mat):
    """Expansive dark reflective ground floor."""
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=16, y_segments=16, size=40.0)
    ob = obj_from_bm("Sanctuary_Ground", bm, col, floor_mat)
    ob.location = (0, 0, -0.02)


# ------------------------------------------------------------------ lighting & camera
def build_lighting(col):
    # 1. Radiant point light from the central core
    core_light = bpy.data.lights.new("CoreLight", "POINT")
    core_light.energy = 850
    core_light.color = (0.2, 0.65, 1.0)
    core_light.shadow_soft_size = 0.25
    co = bpy.data.objects.new("CoreLight", core_light)
    co.location = (0, 0, 2.4)
    link(co, col)

    # Secondary warm gold inner pulse
    gold_light = bpy.data.lights.new("GoldLight", "POINT")
    gold_light.energy = 320
    gold_light.color = (1.0, 0.85, 0.4)
    go = bpy.data.objects.new("GoldLight", gold_light)
    go.location = (0, 0, 2.3)
    link(go, col)

    # 2. Celestial God Ray / Spotlight beaming down from the heavens onto the shrine
    target = Vector((0.0, 0.2, 2.2))
    shaft = bpy.data.lights.new("CelestialBeam", "SPOT")
    shaft.energy = 7500
    shaft.color = (0.75, 0.88, 1.0)
    shaft.spot_size = math.radians(34)
    shaft.spot_blend = 0.75
    shaft.shadow_soft_size = 0.5
    so = bpy.data.objects.new("CelestialBeam", shaft)
    # Beaming from upper-left angle
    beam_origin = target + Vector((-3.5, -4.5, 7.5))
    so.location = beam_origin
    link(so, col)
    look_at(so, target)

    # 3. Soft ambient moonlight fill so colonnade pillars read clearly against the night
    moon_fill = bpy.data.lights.new("MoonFill", "AREA")
    moon_fill.energy = 260
    moon_fill.size = 12.0
    moon_fill.color = (0.45, 0.58, 0.75)
    mo = bpy.data.objects.new("MoonFill", moon_fill)
    mo.location = (4.0, -8.0, 6.0)
    link(mo, col)
    look_at(mo, Vector((0, 1.0, 2.0)))

    # 4. Volumetric haze box
    bpy.ops.mesh.primitive_cube_add(size=1)
    v = bpy.context.active_object
    for c in v.users_collection:
        c.objects.unlink(v)
    col.objects.link(v)
    v.name = "SanctuaryHaze"
    v.location = (0, 1.5, 4.0)
    v.scale = (35, 35, 12)
    m, nt, out = nodes_mat("HazeVol")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = 0.016
    vol.inputs["Anisotropy"].default_value = 0.68
    vol.inputs["Color"].default_value = (0.85, 0.92, 1.0, 1)
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    v.data.materials.append(m)


def build_camera(col):
    cam = bpy.data.cameras.new("ContactCamera")
    cam.lens = 32
    cam.dof.use_dof = True
    cam.dof.focus_distance = 8.5
    cam.dof.aperture_fstop = 3.5
    ob = bpy.data.objects.new("ContactCamera", cam)
    # Positioned at eye level looking up at the majestic glowing shrine
    # Slightly shifted to leave breathing room for the text "LET'S BUILD SOMETHING THAT GLOWS"
    ob.location = (0.6, -8.2, 1.95)
    link(ob, col)
    look_at(ob, Vector((0.0, 0.0, 2.45)))
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
    sc.view_settings.exposure = 0.15


def build():
    reset()
    cols = {n: collection(n) for n in ("Dais", "Colonnade", "Shrine", "Rings", "Foliage", "FX", "Lighting")}

    stone = stone_material()
    slate = dark_slate_material()
    glow = glow_core_material()
    gold = rune_gold_material()
    ivy = ivy_material()
    floor = floor_material()

    build_ground_mirror(cols["Dais"], floor)
    build_dais(cols["Dais"], stone)
    build_colonnade(cols["Colonnade"], stone)
    build_hero_monolith(cols["Shrine"], slate, glow)
    build_orbital_rings(cols["Rings"], gold)
    build_ivy_foliage(cols["Foliage"], ivy)
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
