"""
A photoreal hero crystal: cut quartz with real glass optics, a luminous heart and a mirror floor.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/build_real_crystal.py -- [lime|blue]

Writes art/real_crystal_<tint>.blend and art/renders/real_crystal_<tint>.png.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TINTS = {"lime": (0.55, 1.0, 0.12), "blue": (0.1, 0.55, 1.0)}
args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
TINT = args[0] if args and args[0] in TINTS else "lime"
rnd = random.Random(5)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def crystal_mesh():
    """A six-sided quartz point, chipped by random cleavage planes into an irregular gem."""
    bm = bmesh.new()
    n = 6
    zs = [-1.15, -0.5, 0.45, 0.95]
    rs = [0.52, 0.74, 0.7, 0.62]
    rings = []
    for k, (z, r) in enumerate(zip(zs, rs)):
        ring = []
        for i in range(n):
            a = (i + 0.18 * k) / n * math.tau
            f = 1.12 if i % 2 else 0.88
            ring.append(bm.verts.new((math.cos(a) * r * f, math.sin(a) * r * f * 0.82, z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    top = bm.verts.new((0.06, 0.0, 1.75))
    bot = bm.verts.new((-0.05, 0.02, -1.55))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((rings[-1][i], rings[-1][j], top))
        bm.faces.new((rings[0][j], rings[0][i], bot))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))

    # cleavage: shave off random corners with planes
    for _ in range(6):
        d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1.25))).normalized()
        reach = max(abs(d.dot(v.co)) for v in bm.verts)
        depth = reach * rnd.uniform(0.90, 0.97)
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=d * depth, plane_no=d, clear_outer=True)
        # fill the cut with a face
        open_edges = [e for e in bm.edges if e.is_boundary]
        if open_edges:
            bmesh.ops.holes_fill(bm, edges=open_edges, sides=0)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new("Crystal")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Crystal", me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = False
    # tiny bevel catches light on every edge, like a real polished edge
    bv = ob.modifiers.new("Bevel", "BEVEL")
    bv.width = 0.006
    bv.segments = 2
    bv.limit_method = "ANGLE"
    return ob


def glass_material(tint):
    m = bpy.data.materials.new("Quartz")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.92, 0.95, 0.96, 1)
    bsdf.inputs["Roughness"].default_value = 0.02
    bsdf.inputs["IOR"].default_value = 1.544
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    for name, val in (("Coat Weight", 0.0), ("Specular IOR Level", 0.6)):
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = val
    # a little frosting on the faces, so reflections aren't CG-perfect
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 90
    noise.inputs["Detail"].default_value = 6
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["To Min"].default_value = 0.01
    ramp.inputs["To Max"].default_value = 0.09
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Value"])
    nt.links.new(ramp.outputs["Result"], bsdf.inputs["Roughness"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    # smoky absorption inside the stone, tinted a touch toward the project colour
    vol = nt.nodes.new("ShaderNodeVolumeAbsorption")
    vol.inputs["Color"].default_value = (0.62 + 0.08 * tint[0], 0.62 + 0.08 * tint[1], 0.64 + 0.08 * tint[2], 1)
    vol.inputs["Density"].default_value = 1.4
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    return m


def core_material(tint):
    """The heart: a cloud of emissive gas shot through with bright filaments."""
    m = bpy.data.materials.new("Core")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    warp = nt.nodes.new("ShaderNodeTexNoise")
    warp.inputs["Scale"].default_value = 2.5
    warp.inputs["Detail"].default_value = 5
    nt.links.new(tc.outputs["Object"], warp.inputs["Vector"])
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.feature = "DISTANCE_TO_EDGE"
    vor.inputs["Scale"].default_value = 11
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "VECTOR"
    mix.inputs["Factor"].default_value = 0.5
    nt.links.new(tc.outputs["Object"], mix.inputs["A"])
    nt.links.new(warp.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], vor.inputs["Vector"])
    lines = nt.nodes.new("ShaderNodeMapRange")
    lines.inputs["From Min"].default_value = 0.0
    lines.inputs["From Max"].default_value = 0.07
    lines.inputs["To Min"].default_value = 1.0
    lines.inputs["To Max"].default_value = 0.0
    nt.links.new(vor.outputs["Distance"], lines.inputs["Value"])
    # radial falloff so it's densest at the centre
    grad = nt.nodes.new("ShaderNodeTexGradient")
    grad.gradient_type = "SPHERICAL"
    nt.links.new(tc.outputs["Object"], grad.inputs["Vector"])
    inv = nt.nodes.new("ShaderNodeMapRange")   # 0 at the shell, 1 at the centre
    inv.inputs["From Min"].default_value = 0.5
    inv.inputs["From Max"].default_value = 1.0
    inv.interpolation_type = "SMOOTHSTEP"
    nt.links.new(grad.outputs["Fac"], inv.inputs["Value"])
    strength = nt.nodes.new("ShaderNodeMath")
    strength.operation = "MULTIPLY"
    nt.links.new(lines.outputs["Result"], strength.inputs[0])
    nt.links.new(inv.outputs["Result"], strength.inputs[1])
    em = nt.nodes.new("ShaderNodeMath")
    em.operation = "MULTIPLY"
    em.inputs[1].default_value = 160.0
    nt.links.new(strength.outputs["Value"], em.inputs[0])
    base = nt.nodes.new("ShaderNodeMath")
    base.operation = "MULTIPLY"
    nt.links.new(inv.outputs["Result"], base.inputs[0])
    base.inputs[1].default_value = 9.0
    tot = nt.nodes.new("ShaderNodeMath")
    tot.operation = "ADD"
    nt.links.new(em.outputs["Value"], tot.inputs[0])
    nt.links.new(base.outputs["Value"], tot.inputs[1])
    vol.inputs["Color"].default_value = (*tint, 1)
    vol.inputs["Density"].default_value = 1.5
    vol.inputs["Emission Color"].default_value = (*tint, 1)
    nt.links.new(tot.outputs["Value"], vol.inputs["Emission Strength"])
    dens = nt.nodes.new("ShaderNodeMath")
    dens.operation = "MULTIPLY"
    nt.links.new(inv.outputs["Result"], dens.inputs[0])
    dens.inputs[1].default_value = 3.0
    nt.links.new(dens.outputs["Value"], vol.inputs["Density"])
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    return m


def heart(tint, glass_ob):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=0.5, location=(0.03, 0, 0.0))
    h = bpy.context.object
    h.name = "Heart"
    h.scale = (0.85, 0.7, 1.1)
    h.data.materials.append(core_material(tint))
    # white-hot nucleus and a scatter of bright inclusions inside the cloud
    hot = bpy.data.materials.new("Hot")
    hot.use_nodes = True
    hn = hot.node_tree
    hn.nodes.clear()
    ho = hn.nodes.new("ShaderNodeOutputMaterial")
    he = hn.nodes.new("ShaderNodeEmission")
    he.inputs["Color"].default_value = (0.9 + 0.1 * tint[0], 1.0, 0.85 + 0.15 * tint[2], 1)
    he.inputs["Strength"].default_value = 60
    hn.links.new(he.outputs["Emission"], ho.inputs["Surface"])
    r2 = random.Random(3)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.07, location=(0.03, 0, 0.0))
    n = bpy.context.object
    n.data.materials.append(hot)
    for _ in range(40):
        d = Vector((r2.gauss(0, 1), r2.gauss(0, 0.8), r2.gauss(0, 1.2))).normalized() * r2.uniform(0.08, 0.34)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r2.uniform(0.004, 0.014), location=(0.03 + d.x, d.y, d.z))
        p = bpy.context.object
        p.scale = (r2.uniform(0.5, 2.5), r2.uniform(0.3, 1.0), r2.uniform(0.5, 2.5))
        p.rotation_euler = (r2.uniform(0, 3), r2.uniform(0, 3), r2.uniform(0, 3))
        p.data.materials.append(hot)
    bpy.ops.object.light_add(type="POINT", location=(0.03, 0, 0.0))
    L = bpy.context.object
    L.data.energy = 0
    L.data.shadow_soft_size = 0.3
    L.data.color = tint
    L.data.use_shadow = False
    return h


def stage(tint):
    # mirror-black floor
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -1.62))
    fl = bpy.context.object
    fm = bpy.data.materials.new("Floor")
    fm.use_nodes = True
    b = fm.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.01, 0.012, 0.015, 1)
    b.inputs["Roughness"].default_value = 0.12
    b.inputs["Metallic"].default_value = 0.0
    fl.data.materials.append(fm)

    def area(loc, energy, size, color, aim=(0, 0, 0)):
        bpy.ops.object.light_add(type="AREA", location=loc)
        L = bpy.context.object
        L.data.energy = energy
        L.data.size = size[0]
        L.data.size_y = size[1]
        L.data.shape = "RECTANGLE"
        L.data.color = color
        L.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()

    area((-4.5, -2.5, 2.5), 450, (1.2, 5), (1.0, 0.45, 0.4))      # warm strip, left
    area((4.5, -2.0, 2.0), 400, (1.2, 5), (0.45, 0.65, 1.0))      # cool strip, right
    area((0.5, 4.5, 4.0), 300, (4, 1.5), (1, 1, 1))               # top-back kicker
    area((0, -5.5, 5.5), 150, (3, 3), (0.9, 0.95, 1.0))           # soft key

    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.005, 0.008, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 1
    bpy.context.scene.world = w

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (0.0, -11.5, 0.5)
    cam.rotation_euler = (math.radians(88.8), 0, 0)
    cam.data.lens = 56
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = 11.5
    cam.data.dof.aperture_fstop = 11
    bpy.context.scene.camera = cam


def render(path):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    cy.samples = 192
    cy.use_denoising = True
    cy.max_bounces = 24
    cy.transmission_bounces = 24
    cy.glossy_bounces = 8
    cy.caustics_reflective = True
    cy.caustics_refractive = True
    cy.sample_clamp_indirect = 20
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        cy.device = "GPU"
    except Exception as e:  # noqa: BLE001
        print("GPU unavailable:", e)
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Punchy" if "AgX - Punchy" in [i.identifier for i in sc.view_settings.bl_rna.properties["look"].enum_items] else "None"
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def build():
    reset()
    tint = TINTS[TINT]
    g = crystal_mesh()
    g.data.materials.append(glass_material(tint))
    heart(tint, g)
    stage(tint)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "art", f"real_crystal_{TINT}.blend"))
    os.makedirs(os.path.join(ROOT, "art", "renders"), exist_ok=True)
    render(os.path.join(ROOT, "art", "renders", f"real_crystal_{TINT}.png"))


build()
