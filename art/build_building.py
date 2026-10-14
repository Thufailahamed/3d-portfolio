"""
build_building.py
-----------------
Procedural generator for the monumental 3D building inspired by virtuallyeverafter.xyz.
Features:
  - Grand Classical Octastyle Portico & Pediment with dentil moldings, tympanum, and frieze
  - Extended Colonnade Wings (West & East) with roof balustrades
  - Distant Classical Rotunda / Tholos Pavilion with dome on the east wing
  - Luminous minimalist Entrance Portal ("ENTER") with crisp glowing frame & warm interior spill
  - Dark reflective plaza floor with perspective grid lines
  - Grand Interior Exhibition Hall:
      - 36m long barrel-vaulted ceiling with transverse arch ribs & linear glass skylight
      - Polished Nero Marquina mirror marble floor
      - Arched museum wall niches with warm wall grazing lights
      - 6 Dedicated Project Exhibition Bays / Plinths for portfolio projects:
          01. School System (Modular secure architecture)
          02. Legal Workspace (AI intelligence prism)
          03. LUXE (Faceted luxury diamond)
          04. GoldOS (Bullion ingot sculpture)
          05. VYRO (B2B wholesale lattice)
          06. HealthHub (Multilingual pulse helix)
      - Each plinth has a beveled stone pedestal, brass trim, vitrine, artifact, plaque & spotlight
      - Dramatic museum lighting (spotlights, cove lighting, skylight wash)

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/build_building.py -- render
"""

import math
import os
import sys
import bpy
import bmesh
from mathutils import Vector, Euler, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_BLEND = os.path.join(ROOT, "art", "building.blend")
OUT_EXT_PNG = os.path.join(ROOT, "art", "renders", "building_exterior.png")
OUT_INT_PNG = os.path.join(ROOT, "art", "renders", "building_interior.png")


# ------------------------------------------------------------------ scene helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


def collection(name: str) -> bpy.types.Collection:
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def link(obj, col: bpy.types.Collection):
    col.objects.link(obj)


def obj_from_bm(name: str, bm: bmesh.types.BMesh, col: bpy.types.Collection, mat=None) -> bpy.types.Object:
    me = bpy.data.meshes.new(name + "Mesh")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob, col)
    if mat:
        ob.data.materials.append(mat)
    return ob


def look_at(obj: bpy.types.Object, target: Vector):
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


# ------------------------------------------------------------------ material generators
def nodes_mat(name: str):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    return m, nt, out


def obsidian_stone_mat():
    """Dark architectural basalt/obsidian with subtle Fresnel reflection."""
    m, nt, out = nodes_mat("ObsidianStone")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.018, 0.020, 0.024, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.28
    bsdf.inputs["Metallic"].default_value = 0.15
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def classical_limestone_mat():
    """Refined dark travertine stone with subtle surface sheen."""
    m, nt, out = nodes_mat("ClassicalLimestone")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.035, 0.038, 0.045, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.32
    bsdf.inputs["Metallic"].default_value = 0.05
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def polished_marble_mat():
    """High-gloss Nero Marquina black marble with mirror reflection."""
    m, nt, out = nodes_mat("NeroMarquinaMarble")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.008, 0.009, 0.012, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.06
    bsdf.inputs["Metallic"].default_value = 0.2
    bsdf.inputs["IOR"].default_value = 1.60
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def architectural_brass_mat():
    """Warm brushed architectural brass."""
    m, nt, out = nodes_mat("ArchitecturalBrass")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.92, 0.72, 0.38, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.95
    bsdf.inputs["Roughness"].default_value = 0.22
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def pure_gold_mat():
    """Polished 24K gold bullion."""
    m, nt, out = nodes_mat("PureGold")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (1.0, 0.82, 0.25, 1.0)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.12
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def portal_glow_mat(color=(1.0, 1.0, 1.0), strength=30.0):
    """Crisp high-emission glow for doorway outlines and signage."""
    m, nt, out = nodes_mat(f"PortalGlow_{int(strength)}")
    emi = nt.nodes.new("ShaderNodeEmission")
    emi.inputs["Color"].default_value = (*color[:3], 1.0)
    emi.inputs["Strength"].default_value = strength
    nt.links.new(emi.outputs["Emission"], out.inputs["Surface"])
    return m


def warm_interior_mat():
    """Warm ambient interior spill light material."""
    m, nt, out = nodes_mat("WarmInteriorLight")
    emi = nt.nodes.new("ShaderNodeEmission")
    emi.inputs["Color"].default_value = (1.0, 0.92, 0.80, 1.0)
    emi.inputs["Strength"].default_value = 18.0
    nt.links.new(emi.outputs["Emission"], out.inputs["Surface"])
    return m


def glass_vitrine_mat():
    """Ultra-clear museum display glass."""
    m, nt, out = nodes_mat("GlassVitrine")
    try:
        m.blend_method = "BLEND"
    except Exception:
        pass
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.88, 0.94, 1.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.04
    bsdf.inputs["Metallic"].default_value = 0.1
    bsdf.inputs["Alpha"].default_value = 0.15
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def hologram_mat(name: str, color=(0.4, 0.8, 1.0), strength=24.0):
    """Luminous cybernetic hologram shader for project artifacts."""
    m, nt, out = nodes_mat(f"Holo_{name}")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*color[:3], 1.0)
    bsdf.inputs["Emission Color"].default_value = (*color[:3], 1.0)
    bsdf.inputs["Emission Strength"].default_value = strength
    bsdf.inputs["Roughness"].default_value = 0.12
    bsdf.inputs["Metallic"].default_value = 0.4
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def plaza_grid_mat():
    """Dark reflective obsidian plaza floor with subtle fine grid."""
    m, nt, out = nodes_mat("PlazaGrid")
    tex_coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (0.25, 0.25, 0.25)
    nt.links.new(tex_coord.outputs["Object"], mapping.inputs["Vector"])

    # Fine brick grid lines
    brick = nt.nodes.new("ShaderNodeTexBrick")
    brick.inputs["Scale"].default_value = 1.0
    brick.inputs["Mortar Size"].default_value = 0.012
    brick.inputs["Mortar Smooth"].default_value = 0.2
    brick.inputs["Color1"].default_value = (0.012, 0.014, 0.018, 1.0)
    brick.inputs["Color2"].default_value = (0.016, 0.018, 0.022, 1.0)
    brick.inputs["Mortar"].default_value = (0.08, 0.12, 0.18, 1.0)
    nt.links.new(mapping.outputs["Vector"], brick.inputs["Vector"])

    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.08
    bsdf.inputs["Metallic"].default_value = 0.25
    nt.links.new(brick.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


# ------------------------------------------------------------------ column builder
def make_classical_column_bm(height=6.4, base_r=0.40, top_r=0.33, flutes=16) -> bmesh.types.BMesh:
    """
    Classical Doric/Ionic column with:
      1. Square plinth block
      2. Attic base (plinth, lower torus, scotia groove, upper torus)
      3. Fluted shaft with entasis taper
      4. Necking, echinus cushion, and square abacus capital
    """
    bm = bmesh.new()

    # 1. Square Plinth
    plinth_h = 0.22
    plinth_w = base_r * 2.5
    hw = plinth_w * 0.5
    p_verts = [
        bm.verts.new((-hw, -hw, 0.0)),
        bm.verts.new((hw, -hw, 0.0)),
        bm.verts.new((hw, hw, 0.0)),
        bm.verts.new((-hw, hw, 0.0)),
        bm.verts.new((-hw, -hw, plinth_h)),
        bm.verts.new((hw, -hw, plinth_h)),
        bm.verts.new((hw, hw, plinth_h)),
        bm.verts.new((-hw, hw, plinth_h)),
    ]
    bm.faces.new((p_verts[0], p_verts[3], p_verts[2], p_verts[1]))
    bm.faces.new((p_verts[4], p_verts[5], p_verts[6], p_verts[7]))
    bm.faces.new((p_verts[0], p_verts[1], p_verts[5], p_verts[4]))
    bm.faces.new((p_verts[1], p_verts[2], p_verts[6], p_verts[5]))
    bm.faces.new((p_verts[2], p_verts[3], p_verts[7], p_verts[6]))
    bm.faces.new((p_verts[3], p_verts[0], p_verts[4], p_verts[7]))

    # 2. Attic Base Moldings (Lower Torus, Scotia, Upper Torus)
    z = plinth_h
    base_rings = [
        (base_r * 1.35, z + 0.06),
        (base_r * 1.25, z + 0.12),
        (base_r * 1.10, z + 0.18),
        (base_r * 1.18, z + 0.24),
        (base_r * 1.00, z + 0.30),
    ]
    prev_verts = None
    n_ring = flutes * 2  # 32
    for r, rz in base_rings:
        ring = []
        for i in range(n_ring):
            ang = (i / n_ring) * math.tau
            ring.append(bm.verts.new((math.cos(ang) * r, math.sin(ang) * r, rz)))
        if prev_verts is not None:
            for i in range(n_ring):
                i_next = (i + 1) % n_ring
                bm.faces.new((prev_verts[i], prev_verts[i_next], ring[i_next], ring[i]))
        prev_verts = ring
    z = base_rings[-1][1]

    # 3. Fluted Shaft with Entasis Taper
    shaft_h = height - z - 0.45
    shaft_steps = 12
    for s in range(shaft_steps + 1):
        t = s / shaft_steps
        curr_z = z + t * shaft_h
        taper_factor = 1.0 if t < 0.3 else 1.0 - math.sin((t - 0.3) / 0.7 * math.pi * 0.5) * (1.0 - top_r / base_r)
        r = base_r * taper_factor

        ring = []
        for f in range(flutes):
            for step in range(2):
                ang = (f + step * 0.5) / flutes * math.tau
                flute_depth = 0.022 * taper_factor if step == 1 else 0.0
                curr_r = r - flute_depth
                ring.append(bm.verts.new((math.cos(ang) * curr_r, math.sin(ang) * curr_r, curr_z)))

        if prev_verts is not None:
            for i in range(n_ring):
                i_next = (i + 1) % n_ring
                bm.faces.new((prev_verts[i], prev_verts[i_next], ring[i_next], ring[i]))
        prev_verts = ring
    z += shaft_h

    # 4. Capital Moldings (Necking, Echinus cushion)
    cap_rings = [
        (top_r * 1.05, z + 0.06),
        (top_r * 1.22, z + 0.16),
        (top_r * 1.38, z + 0.26),
    ]
    for r, rz in cap_rings:
        ring = []
        for i in range(n_ring):
            ang = (i / n_ring) * math.tau
            ring.append(bm.verts.new((math.cos(ang) * r, math.sin(ang) * r, rz)))
        if prev_verts is not None:
            for i in range(n_ring):
                i_next = (i + 1) % n_ring
                bm.faces.new((prev_verts[i], prev_verts[i_next], ring[i_next], ring[i]))
        prev_verts = ring
    z = cap_rings[-1][1]

    # 5. Square Abacus Block at top
    abacus_w = top_r * 2.8
    abacus_h = 0.18
    z_b = z
    z_t = z + abacus_h
    hw_a = abacus_w * 0.5
    abacus_verts = [
        bm.verts.new((-hw_a, -hw_a, z_b)),
        bm.verts.new((hw_a, -hw_a, z_b)),
        bm.verts.new((hw_a, hw_a, z_b)),
        bm.verts.new((-hw_a, hw_a, z_b)),
        bm.verts.new((-hw_a, -hw_a, z_t)),
        bm.verts.new((hw_a, -hw_a, z_t)),
        bm.verts.new((hw_a, hw_a, z_t)),
        bm.verts.new((-hw_a, hw_a, z_t)),
    ]
    bm.faces.new((abacus_verts[0], abacus_verts[3], abacus_verts[2], abacus_verts[1]))
    bm.faces.new((abacus_verts[4], abacus_verts[5], abacus_verts[6], abacus_verts[7]))
    bm.faces.new((abacus_verts[0], abacus_verts[1], abacus_verts[5], abacus_verts[4]))
    bm.faces.new((abacus_verts[1], abacus_verts[2], abacus_verts[6], abacus_verts[5]))
    bm.faces.new((abacus_verts[2], abacus_verts[3], abacus_verts[7], abacus_verts[6]))
    bm.faces.new((abacus_verts[3], abacus_verts[0], abacus_verts[4], abacus_verts[7]))

    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm


# ------------------------------------------------------------------ exterior architecture
def build_exterior(col, stone_mat, lime_mat, brass_mat, glow_mat, warm_mat, grid_mat):
    # ------------------------------------------------------------------ 1. Grand Ceremonial Stylobate & Steps
    steps_bm = bmesh.new()
    steps_count = 8
    step_depth = 0.55
    step_h = 0.16
    platform_w = 54.0
    platform_d = 28.0

    # Massive ground stylobate base
    bmesh.ops.create_cube(steps_bm, size=1.0)
    for v in steps_bm.verts:
        v.co.x *= platform_w
        v.co.y = (v.co.y + 0.5) * platform_d - 4.5
        v.co.z = (v.co.z + 0.5) * 0.4 - 0.4

    # Flight of 8 ceremonial stone steps
    stair_w = 22.0
    for s in range(steps_count):
        cur_y = -4.2 - s * step_depth
        cur_z = (steps_count - 1 - s) * step_h
        bmesh.ops.create_cube(steps_bm, size=1.0)
        for v in steps_bm.verts[-8:]:
            v.co.x *= stair_w + s * 0.6
            v.co.y = cur_y + v.co.y * step_depth
            v.co.z = cur_z + (v.co.z + 0.5) * step_h

    ob_steps = obj_from_bm("GrandStylobate", steps_bm, col, stone_mat)
    bev = ob_steps.modifiers.new("Bevel", "BEVEL")
    bev.width = 0.03
    bev.segments = 2

    # Reflective Foreground Plaza with Perspective Grid
    plaza_bm = bmesh.new()
    bmesh.ops.create_grid(plaza_bm, x_segments=16, y_segments=16, size=90.0)
    ob_plaza = obj_from_bm("ReflectivePlaza", plaza_bm, col, grid_mat)
    ob_plaza.location = (0, -22.0, -0.42)

    # ------------------------------------------------------------------ 2. Colonnades
    col_h = 6.6
    col_r = 0.40
    portico_w = 13.0
    spacing = portico_w / 7.0

    # A) Central Octastyle Portico (8 Columns in front row + 2 depth return rows)
    for i in range(8):
        x = -portico_w / 2.0 + i * spacing
        # Front row
        bm_col = make_classical_column_bm(height=col_h, base_r=col_r, top_r=col_r * 0.82)
        ob = obj_from_bm(f"PorticoCol_Front_{i}", bm_col, col, stone_mat)
        ob.location = (x, -3.5, 0.88)
        # Portico depth return columns (left and right flanks)
        if i in (0, 7):
            for d in (1, 2):
                bm_ret = make_classical_column_bm(height=col_h, base_r=col_r, top_r=col_r * 0.82)
                ob_ret = obj_from_bm(f"PorticoCol_Return_{i}_{d}", bm_ret, col, stone_mat)
                ob_ret.location = (x, -3.5 + d * 1.6, 0.88)

    # B) Extended Left (West) Wing Colonnade (11 columns)
    wing_count = 11
    wing_spacing = 1.6
    for i in range(wing_count):
        x = -8.2 - i * wing_spacing
        bm_w = make_classical_column_bm(height=col_h * 0.94, base_r=col_r * 0.90, top_r=col_r * 0.76)
        ob_w = obj_from_bm(f"WingCol_Left_{i}", bm_w, col, stone_mat)
        ob_w.location = (x, -1.2, 0.88)

    # C) Extended Right (East) Wing Colonnade (8 columns) leading to Rotunda
    for i in range(8):
        x = 8.2 + i * wing_spacing
        bm_w = make_classical_column_bm(height=col_h * 0.94, base_r=col_r * 0.90, top_r=col_r * 0.76)
        ob_w = obj_from_bm(f"WingCol_Right_{i}", bm_w, col, stone_mat)
        ob_w.location = (x, -1.2, 0.88)

    # D) Classical Rotunda / Tholos Pavilion on East Wing (matching reference image)
    rotunda_center_x = 8.2 + 8 * wing_spacing + 4.2
    rotunda_center_y = -1.2
    rotunda_r = 3.6
    rotunda_cols = 10
    for r_i in range(rotunda_cols):
        r_ang = (r_i / rotunda_cols) * math.tau
        rx = rotunda_center_x + math.cos(r_ang) * rotunda_r
        ry = rotunda_center_y + math.sin(r_ang) * rotunda_r
        bm_rc = make_classical_column_bm(height=col_h * 0.94, base_r=col_r * 0.85, top_r=col_r * 0.72)
        ob_rc = obj_from_bm(f"RotundaCol_{r_i}", bm_rc, col, stone_mat)
        ob_rc.location = (rx, ry, 0.88)

    # Rotunda Drum & Dome
    rotunda_bm = bmesh.new()
    bmesh.ops.create_cone(
        rotunda_bm,
        cap_ends=True,
        cap_tris=False,
        segments=24,
        radius1=rotunda_r * 1.15,
        radius2=rotunda_r * 1.15,
        depth=0.8,
    )
    for v in rotunda_bm.verts:
        v.co.z += 0.88 + col_h * 0.94 + 0.4
    # Hemisphere Dome
    dome_verts_start = len(rotunda_bm.verts)
    bmesh.ops.create_icosphere(rotunda_bm, subdivisions=2, radius=rotunda_r * 1.05)
    for v in rotunda_bm.verts[dome_verts_start:]:
        if v.co.z < 0:
            v.co.z = 0.0
        v.co.z += 0.88 + col_h * 0.94 + 0.8
    ob_rot = obj_from_bm("RotundaDome", rotunda_bm, col, stone_mat)
    ob_rot.location = (rotunda_center_x, rotunda_center_y, 0)

    # ------------------------------------------------------------------ 3. Entablature & Pediment
    entab_bm = bmesh.new()
    entab_h = 1.35
    entab_z = 0.88 + col_h

    # Central Portico Entablature (Architrave + Frieze + Dentil Cornice)
    bmesh.ops.create_cube(entab_bm, size=1.0)
    for v in entab_bm.verts[-8:]:
        v.co.x *= portico_w + 1.4
        v.co.y = (v.co.y + 0.5) * 4.6 - 4.0
        v.co.z = entab_z + (v.co.z + 0.5) * entab_h

    # Classical Dentil Moldings along the horizontal cornice
    dentil_count = 34
    dentil_w = 0.22
    dentil_d = 0.18
    dentil_h = 0.14
    dentil_y = -4.05
    dentil_z = entab_z + entab_h - 0.20
    d_spacing = (portico_w + 1.0) / (dentil_count - 1)
    for d_i in range(dentil_count):
        dx = -(portico_w + 1.0) * 0.5 + d_i * d_spacing
        bmesh.ops.create_cube(entab_bm, size=1.0)
        for v in entab_bm.verts[-8:]:
            v.co.x = dx + v.co.x * dentil_w
            v.co.y = dentil_y + v.co.y * dentil_d
            v.co.z = dentil_z + (v.co.z + 0.5) * dentil_h

    # Wing Entablatures (Left & Right)
    for side in (-1, 1):
        bmesh.ops.create_cube(entab_bm, size=1.0)
        for v in entab_bm.verts[-8:]:
            v.co.x = side * (portico_w / 2.0 + 8.8) + v.co.x * 18.0
            v.co.y = (v.co.y + 0.5) * 3.4 - 2.4
            v.co.z = 0.88 + col_h * 0.94 + (v.co.z + 0.5) * 1.15

    ob_entab = obj_from_bm("Entablature", entab_bm, col, stone_mat)
    bev_e = ob_entab.modifiers.new("Bevel", "BEVEL")
    bev_e.width = 0.04

    # Monumental Classical Triangular Pediment with Recessed Tympanum & Raking Cornice
    ped_bm = bmesh.new()
    ped_w = (portico_w + 1.4) * 0.5
    ped_h = 2.9
    ped_z = entab_z + entab_h
    depth_front = -4.0
    depth_back = 0.6

    # 1. Outer Pediment Frame (rake cornice)
    v_front = [
        ped_bm.verts.new((-ped_w, depth_front, ped_z)),
        ped_bm.verts.new((ped_w, depth_front, ped_z)),
        ped_bm.verts.new((0.0, depth_front, ped_z + ped_h)),
    ]
    v_back = [
        ped_bm.verts.new((-ped_w, depth_back, ped_z)),
        ped_bm.verts.new((ped_w, depth_back, ped_z)),
        ped_bm.verts.new((0.0, depth_back, ped_z + ped_h)),
    ]
    ped_bm.faces.new(v_front)
    ped_bm.faces.new(list(reversed(v_back)))
    ped_bm.faces.new((v_front[0], v_front[1], v_back[1], v_back[0]))
    ped_bm.faces.new((v_front[1], v_front[2], v_back[2], v_back[1]))
    ped_bm.faces.new((v_front[2], v_front[0], v_back[0], v_back[2]))

    # 2. Recessed Inner Tympanum (creates rich classical architectural depth & shadow)
    tym_margin = 0.35
    tym_depth = depth_front + 0.32
    v_tym = [
        ped_bm.verts.new((-ped_w + tym_margin * 1.2, tym_depth, ped_z + tym_margin * 0.6)),
        ped_bm.verts.new((ped_w - tym_margin * 1.2, tym_depth, ped_z + tym_margin * 0.6)),
        ped_bm.verts.new((0.0, tym_depth, ped_z + ped_h - tym_margin * 1.2)),
    ]
    ped_bm.faces.new(v_tym)

    bmesh.ops.recalc_face_normals(ped_bm, faces=list(ped_bm.faces))
    ob_ped = obj_from_bm("PorticoPediment", ped_bm, col, stone_mat)
    bev_p = ob_ped.modifiers.new("Bevel", "BEVEL")
    bev_p.width = 0.05

    # ------------------------------------------------------------------ 4. Facade Back Walls & Open Central Portal
    wall_bm = bmesh.new()
    door_w = 2.2
    door_h = 3.8
    door_z = 0.88
    wall_w = platform_w - 2.0
    wall_y = 1.0
    wall_thick = 0.6
    wall_h = col_h + entab_h

    # Left front facade wall section (from -wall_w/2 to -door_w/2)
    left_w = (wall_w * 0.5) - (door_w * 0.5)
    bmesh.ops.create_cube(wall_bm, size=1.0)
    for v in wall_bm.verts[-8:]:
        v.co.x = -wall_w * 0.5 + (v.co.x + 0.5) * left_w
        v.co.y = wall_y + v.co.y * wall_thick
        v.co.z = door_z + (v.co.z + 0.5) * wall_h

    # Right front facade wall section (from door_w/2 to wall_w/2)
    bmesh.ops.create_cube(wall_bm, size=1.0)
    for v in wall_bm.verts[-8:]:
        v.co.x = door_w * 0.5 + (v.co.x + 0.5) * left_w
        v.co.y = wall_y + v.co.y * wall_thick
        v.co.z = door_z + (v.co.z + 0.5) * wall_h

    # Lintel section directly above the door
    bmesh.ops.create_cube(wall_bm, size=1.0)
    for v in wall_bm.verts[-8:]:
        v.co.x = v.co.x * door_w
        v.co.y = wall_y + v.co.y * wall_thick
        v.co.z = door_z + door_h + (v.co.z + 0.5) * (wall_h - door_h)

    # Arched architectural window recesses along wings
    for side in (-1, 1):
        for w_idx in range(5):
            wx = side * (9.5 + w_idx * 3.4)
            bmesh.ops.create_cube(wall_bm, size=1.0)
            for v in wall_bm.verts[-8:]:
                v.co.x = wx + v.co.x * 1.3
                v.co.y = 0.7 + v.co.y * 0.4
                v.co.z = 2.4 + (v.co.z + 0.5) * 3.8

    obj_from_bm("MainFacadeWalls", wall_bm, col, stone_mat)

    # ------------------------------------------------------------------ 5. Luminous Entrance Portal ("ENTER")
    # Crisp glowing minimalist neon doorway frame from reference image
    frame_bm = bmesh.new()
    jamb_w = 0.14
    jamb_d = 0.35
    # Left jamb
    bmesh.ops.create_cube(frame_bm, size=1.0)
    for v in frame_bm.verts[-8:]:
        v.co.x = -door_w * 0.5 - jamb_w * 0.5 + v.co.x * jamb_w
        v.co.y = 0.72 + v.co.y * jamb_d
        v.co.z = door_z + (v.co.z + 0.5) * (door_h + jamb_w)
    # Right jamb
    bmesh.ops.create_cube(frame_bm, size=1.0)
    for v in frame_bm.verts[-8:]:
        v.co.x = door_w * 0.5 + jamb_w * 0.5 + v.co.x * jamb_w
        v.co.y = 0.72 + v.co.y * jamb_d
        v.co.z = door_z + (v.co.z + 0.5) * (door_h + jamb_w)
    # Top head casing
    bmesh.ops.create_cube(frame_bm, size=1.0)
    for v in frame_bm.verts[-8:]:
        v.co.x *= door_w + jamb_w * 2.0
        v.co.y = 0.72 + v.co.y * jamb_d
        v.co.z = door_z + door_h + (v.co.z + 0.5) * jamb_w
    obj_from_bm("PortalDoorFrame", frame_bm, col, brass_mat)

    # Glowing Crisp Neon Border Frame (Left, Right, Top)
    glow_bm = bmesh.new()
    glow_thick = 0.05
    # Left vertical strip
    bmesh.ops.create_cube(glow_bm, size=1.0)
    for v in glow_bm.verts[-8:]:
        v.co.x = -door_w * 0.5 + v.co.x * glow_thick
        v.co.y = 0.48 + v.co.y * glow_thick
        v.co.z = door_z + (v.co.z + 0.5) * door_h
    # Right vertical strip
    bmesh.ops.create_cube(glow_bm, size=1.0)
    for v in glow_bm.verts[-8:]:
        v.co.x = door_w * 0.5 + v.co.x * glow_thick
        v.co.y = 0.48 + v.co.y * glow_thick
        v.co.z = door_z + (v.co.z + 0.5) * door_h
    # Top horizontal lintel strip
    bmesh.ops.create_cube(glow_bm, size=1.0)
    for v in glow_bm.verts[-8:]:
        v.co.x *= door_w + glow_thick
        v.co.y = 0.48 + v.co.y * glow_thick
        v.co.z = door_z + door_h - (v.co.z + 0.5) * glow_thick

    obj_from_bm("PortalGlowFrame", glow_bm, col, glow_mat)

    # Ground Guideline Strip running down the center steps to camera (like reference)
    center_guide_bm = bmesh.new()
    bmesh.ops.create_cube(center_guide_bm, size=1.0)
    for v in center_guide_bm.verts[-8:]:
        v.co.x *= 0.03
        v.co.y = -11.0 + (v.co.y + 0.5) * 11.5
        v.co.z = 0.0 + (v.co.z + 0.5) * 0.015
    obj_from_bm("PlazaCenterGuideLine", center_guide_bm, col, glow_mat)

    # Classical Frieze Inscription Typography: "VIRTUALLY EVER AFTER"
    try:
        font_curve = bpy.data.curves.new(type="FONT", name="FriezeTextCurve")
        font_curve.body = "VIRTUALLY EVER AFTER"
        font_curve.size = 0.38
        font_curve.extrude = 0.02
        font_curve.align_x = "CENTER"
        font_curve.align_y = "CENTER"
        txt_obj = bpy.data.objects.new("FriezeText", font_curve)
        txt_obj.location = (0.0, -4.02, entab_z + 0.65)
        txt_obj.rotation_euler = Euler((math.radians(90), 0.0, 0.0))
        link(txt_obj, col)
        txt_obj.data.materials.append(brass_mat)
    except Exception as e:
        print("Frieze text note:", e)

    # Floating 3D Architectural Labels (matching virtuallyeverafter.xyz)
    for text_body, loc, scale in [
        ("THE STUDIO", (0.0, -3.8, entab_z + entab_h + ped_h + 1.4), 0.52),
        ("LOBBY", (0.0, -2.8, entab_z + entab_h + 0.8), 0.34),
        ("ROTUNDA", (rotunda_center_x, rotunda_center_y, 0.88 + col_h * 0.94 + 5.2), 0.38),
    ]:
        try:
            fc = bpy.data.curves.new(type="FONT", name=f"Label_{text_body}")
            fc.body = text_body
            fc.size = scale
            fc.extrude = 0.015
            fc.align_x = "CENTER"
            fc.align_y = "CENTER"
            lo = bpy.data.objects.new(f"Label_{text_body}", fc)
            lo.location = loc
            lo.rotation_euler = Euler((math.radians(90), 0.0, 0.0))
            link(lo, col)
            label_glow = portal_glow_mat((0.85, 0.92, 1.0), 5.0)
            lo.data.materials.append(label_glow)
        except Exception as e:
            print(f"Label note {text_body}:", e)

    # Architectural Silhouette Figure & Desk inside the Entrance Portal
    sil_bm = bmesh.new()
    # Minimalist executive desk
    bmesh.ops.create_cube(sil_bm, size=1.0)
    for v in sil_bm.verts[-8:]:
        v.co.x *= 0.85
        v.co.y = 1.4 + v.co.y * 0.35
        v.co.z = door_z + (v.co.z + 0.5) * 0.72
    # Standing silhouette figure behind desk
    bmesh.ops.create_cube(sil_bm, size=1.0)
    for v in sil_bm.verts[-8:]:
        v.co.x *= 0.26
        v.co.y = 1.65 + v.co.y * 0.22
        v.co.z = door_z + (v.co.z + 0.5) * 1.65
    # Head
    head_start = len(sil_bm.verts)
    bmesh.ops.create_icosphere(sil_bm, subdivisions=1, radius=0.14)
    for v in sil_bm.verts[head_start:]:
        v.co.y += 1.65
        v.co.z += door_z + 1.82
    obj_from_bm("PortalSilhouetteFigure", sil_bm, col, stone_mat)

    # Luminous Circular "ENTER" Button on the Plaza Ground
    enter_bm = bmesh.new()
    bmesh.ops.create_circle(enter_bm, cap_ends=True, radius=0.68, segments=32)
    for v in enter_bm.verts:
        v.co = Vector((v.co.x, -11.2 + v.co.y, 0.02))
    enter_glow = portal_glow_mat((0.95, 0.98, 1.0), 18.0)
    obj_from_bm("PlazaEnterButton", enter_bm, col, enter_glow)


def add_torus_to_bm(bm: bmesh.types.BMesh, r_major=0.4, r_minor=0.08, seg_maj=16, seg_min=8):
    rings = []
    for i in range(seg_maj):
        u = i / seg_maj * math.tau
        center = Vector((math.cos(u) * r_major, math.sin(u) * r_major, 0.0))
        radial_dir = Vector((math.cos(u), math.sin(u), 0.0))
        up_dir = Vector((0.0, 0.0, 1.0))
        ring = []
        for j in range(seg_min):
            v = j / seg_min * math.tau
            pt = center + (radial_dir * math.cos(v) + up_dir * math.sin(v)) * r_minor
            ring.append(bm.verts.new(pt))
        rings.append(ring)
    for i in range(seg_maj):
        i_next = (i + 1) % seg_maj
        for j in range(seg_min):
            j_next = (j + 1) % seg_min
            bm.faces.new((rings[i][j], rings[i_next][j], rings[i_next][j_next], rings[i][j_next]))


# ------------------------------------------------------------------ interior exhibition gallery
def build_interior_gallery(col, marble_mat, stone_mat, lime_mat, brass_mat, gold_mat, glass_mat, glow_mat):
    """
    Grand Exhibition Hall behind the glowing portal:
      - 36m long coffered barrel-vaulted ceiling with structural transverse arch ribs & skylight
      - Mirror-finish Nero Marquina black marble floor with continuous brass inlay runners
      - 6 Recessed classical arched museum wall niches framed by fluted pilasters & niche uplights
      - 6 Dedicated Ultra-Detailed Project Exhibition Showcases:
          01. School System (Interlocking portal cubes + cryptographic token ring + cyan circuits)
          02. Legal Workspace (Intelligence prism + concentric brass gimbal rings + vector nodes)
          03. LUXE (58-facet brilliant diamond on 4-prong jewelry mount + gemstone prisms)
          04. GoldOS (Stepped 6-bar pyramid of 24K gold bullion ingots with serial stamps + medallion coins)
          05. VYRO (Hexagonal honeycomb supply chain cluster + emerald pipelines + geodesic nodes)
          06. HealthHub (Double-helix pulse knot + biometric rungs + vital sign pulse ring)
      - Each showcase has an octagonal beveled plinth, warm under-glow kick, brass collar,
        vitrine with brass struts, top canopy with internal micro-spotlights, 3D brass title,
        and a freestanding angled interactive kiosk console.
      - Culminates in a monumental Triumphal Arch, tiered steps, and 12-mullion Rose Window.
    """
    hall_w = 15.0
    hall_d = 36.0
    hall_h = 9.4
    hall_z = 0.88
    hall_start_y = 1.0

    # ------------------------------------------------------------------ 1. Floor & Brass Inlays
    floor_bm = bmesh.new()
    bmesh.ops.create_cube(floor_bm, size=1.0)
    for v in floor_bm.verts[-8:]:
        v.co.x *= hall_w + 2.0
        v.co.y = hall_start_y + (v.co.y + 0.5) * (hall_d + 2.0)
        v.co.z = hall_z - (v.co.z + 0.5) * 0.25
    obj_from_bm("GalleryFloor", floor_bm, col, marble_mat)

    # Continuous Polished Brass Inlay Runner Strips along central aisle
    inlay_bm = bmesh.new()
    inlay_w = 0.04
    inlay_d = hall_d + 1.0
    for runner_x in (-2.4, 2.4):
        bmesh.ops.create_cube(inlay_bm, size=1.0)
        for v in inlay_bm.verts[-8:]:
            v.co.x = runner_x + v.co.x * inlay_w
            v.co.y = hall_start_y + (v.co.y + 0.5) * inlay_d
            v.co.z = hall_z + (v.co.z + 0.5) * 0.008

    # Transverse brass threshold lines crossing at each showcase bay
    for bay_y in (hall_start_y + 2.0, hall_start_y + 11.0, hall_start_y + 21.0, hall_start_y + 31.0):
        bmesh.ops.create_cube(inlay_bm, size=1.0)
        for v in inlay_bm.verts[-8:]:
            v.co.x *= hall_w - 0.5
            v.co.y = bay_y + v.co.y * inlay_w
            v.co.z = hall_z + (v.co.z + 0.5) * 0.008

    obj_from_bm("FloorBrassInlays", inlay_bm, col, brass_mat)

    # ------------------------------------------------------------------ 2. Side Walls & Arched Wall Niches
    # Main outer gallery walls
    walls_bm = bmesh.new()
    wall_thick = 1.2
    for side in (-1, 1):
        bmesh.ops.create_cube(walls_bm, size=1.0)
        for v in walls_bm.verts[-8:]:
            v.co.x = side * (hall_w * 0.5 + wall_thick * 0.5) + v.co.x * wall_thick
            v.co.y = hall_start_y + (v.co.y + 0.5) * hall_d
            v.co.z = hall_z + (v.co.z + 0.5) * (hall_h * 0.75)

    # End Focal Wall (Apse back wall)
    bmesh.ops.create_cube(walls_bm, size=1.0)
    for v in walls_bm.verts[-8:]:
        v.co.x *= hall_w + 2.0
        v.co.y = hall_start_y + hall_d + (v.co.y + 0.5) * 1.5
        v.co.z = hall_z + (v.co.z + 0.5) * hall_h

    obj_from_bm("GalleryOuterWalls", walls_bm, col, stone_mat)

    # Six Classical Recessed Arched Wall Niches framing each showcase
    niche_ys = [hall_start_y + 6.0, hall_start_y + 16.0, hall_start_y + 26.0]
    niche_w = 4.2
    niche_h = 6.2
    niche_depth = 0.55
    niches_bm = bmesh.new()
    pilasters_bm = bmesh.new()

    for side in (-1, 1):
        wx = side * (hall_w * 0.5 - 0.02)
        for ny in niche_ys:
            # Recessed Niche Box Body
            bmesh.ops.create_cube(niches_bm, size=1.0)
            for v in niches_bm.verts[-8:]:
                v.co.x = wx + (side * (v.co.x + 0.5) * niche_depth)
                v.co.y = ny + v.co.y * niche_w
                v.co.z = hall_z + (v.co.z + 0.5) * (niche_h * 0.75)

            # Niche Semicircular Arch Top
            niche_arch_steps = 12
            r_niche = niche_w * 0.5
            for a_i in range(niche_arch_steps):
                ang0 = (a_i / niche_arch_steps) * math.pi
                ang1 = ((a_i + 1) / niche_arch_steps) * math.pi
                y0 = ny - math.cos(ang0) * r_niche
                y1 = ny - math.cos(ang1) * r_niche
                z0 = hall_z + niche_h * 0.75 + math.sin(ang0) * (niche_h * 0.25)
                z1 = hall_z + niche_h * 0.75 + math.sin(ang1) * (niche_h * 0.25)
                x_front = wx
                x_back = wx + side * niche_depth
                v_f0 = niches_bm.verts.new((x_front, y0, z0))
                v_f1 = niches_bm.verts.new((x_front, y1, z1))
                v_b1 = niches_bm.verts.new((x_back, y1, z1))
                v_b0 = niches_bm.verts.new((x_back, y0, z0))
                niches_bm.faces.new((v_f0, v_f1, v_b1, v_b0))

            # Classical Fluted Pilasters flanking the niche on left & right
            p_w = 0.32
            p_proj = 0.18
            for p_offset in (-niche_w * 0.5 - p_w * 0.5, niche_w * 0.5 + p_w * 0.5):
                py_pil = ny + p_offset
                bmesh.ops.create_cube(pilasters_bm, size=1.0)
                for v in pilasters_bm.verts[-8:]:
                    v.co.x = wx - side * (v.co.x + 0.5) * p_proj
                    v.co.y = py_pil + v.co.y * p_w
                    v.co.z = hall_z + (v.co.z + 0.5) * niche_h

            # Soft Warm Recessed Wall Uplight inside niche
            n_l = bpy.data.lights.new(f"NicheUplight_{side}_{int(ny)}", "POINT")
            n_l.energy = 260
            n_l.color = (1.0, 0.92, 0.82)
            n_l.use_shadow = False
            no = bpy.data.objects.new(f"NicheUplight_{side}_{int(ny)}", n_l)
            no.location = (wx + side * 0.2, ny, hall_z + 1.2)
            link(no, col)

    obj_from_bm("ArchedWallNiches", niches_bm, col, lime_mat)
    obj_from_bm("NichePilasters", pilasters_bm, col, stone_mat)

    # ------------------------------------------------------------------ 3. Coffered Barrel Vault & Skylight
    vault_bm = bmesh.new()
    coffers_bm = bmesh.new()
    vault_steps = 20
    r_vault = hall_w * 0.5

    for i in range(vault_steps):
        a0 = math.pi - (i / vault_steps) * math.pi
        a1 = math.pi - ((i + 1) / vault_steps) * math.pi
        # Leave center opening (indices 8 to 11) for central glass skylight
        if 8 <= i <= 11:
            continue
        v0 = vault_bm.verts.new((math.cos(a0) * r_vault, hall_start_y, hall_z + hall_h * 0.65 + math.sin(a0) * (hall_h * 0.35)))
        v1 = vault_bm.verts.new((math.cos(a1) * r_vault, hall_start_y, hall_z + hall_h * 0.65 + math.sin(a1) * (hall_h * 0.35)))
        v2 = vault_bm.verts.new((math.cos(a1) * r_vault, hall_start_y + hall_d, hall_z + hall_h * 0.65 + math.sin(a1) * (hall_h * 0.35)))
        v3 = vault_bm.verts.new((math.cos(a0) * r_vault, hall_start_y + hall_d, hall_z + hall_h * 0.65 + math.sin(a0) * (hall_h * 0.35)))
        vault_bm.faces.new((v0, v1, v2, v3))

    bmesh.ops.recalc_face_normals(vault_bm, faces=list(vault_bm.faces))
    obj_from_bm("GalleryBarrelVault", vault_bm, col, stone_mat)

    # Molded Transverse Classical Arch Ribs (every 5 meters along the hall)
    ribs_bm = bmesh.new()
    rib_positions_y = [hall_start_y + 1.0 + k * 5.0 for k in range(8)]
    for ry in rib_positions_y:
        for i in range(vault_steps):
            a0 = math.pi - (i / vault_steps) * math.pi
            a1 = math.pi - ((i + 1) / vault_steps) * math.pi
            r_in = r_vault - 0.28
            r_out = r_vault + 0.05
            v0 = ribs_bm.verts.new((math.cos(a0) * r_in, ry - 0.22, hall_z + hall_h * 0.65 + math.sin(a0) * (hall_h * 0.35 * 0.95)))
            v1 = ribs_bm.verts.new((math.cos(a1) * r_in, ry - 0.22, hall_z + hall_h * 0.65 + math.sin(a1) * (hall_h * 0.35 * 0.95)))
            v2 = ribs_bm.verts.new((math.cos(a1) * r_in, ry + 0.22, hall_z + hall_h * 0.65 + math.sin(a1) * (hall_h * 0.35 * 0.95)))
            v3 = ribs_bm.verts.new((math.cos(a0) * r_in, ry + 0.22, hall_z + hall_h * 0.65 + math.sin(a0) * (hall_h * 0.35 * 0.95)))
            ribs_bm.faces.new((v0, v1, v2, v3))

    bmesh.ops.recalc_face_normals(ribs_bm, faces=list(ribs_bm.faces))
    obj_from_bm("VaultArchRibs", ribs_bm, col, brass_mat)

    # Central Glass Skylight with Structural Glazing Mullions
    skylight_bm = bmesh.new()
    bmesh.ops.create_cube(skylight_bm, size=1.0)
    for v in skylight_bm.verts[-8:]:
        v.co.x *= 3.6
        v.co.y = hall_start_y + (v.co.y + 0.5) * hall_d
        v.co.z = hall_z + hall_h * 0.98 + v.co.z * 0.08
    obj_from_bm("GallerySkylight", skylight_bm, col, glass_mat)

    # ------------------------------------------------------------------ 4. The 6 Dedicated Project Showcases
    project_defs = [
        # Left Aisle Showcases
        {
            "id": "01",
            "slug": "school-system",
            "title": "SCHOOL SYSTEM",
            "subtitle": "252 RLS POLICIES · 6 ROLE PORTALS",
            "stack": "NEXT.JS · SUPABASE · HMAC QR",
            "side": -1,
            "y": hall_start_y + 6.0,
            "color": (0.28, 0.72, 1.0),
            "art_type": "school_system",
        },
        {
            "id": "03",
            "slug": "luxe",
            "title": "LUXE",
            "subtitle": "LUXURY COMMERCE · SYNAPSTORE.SHOP",
            "stack": "EXPO NATIVE · HONO ON WORKERS",
            "side": -1,
            "y": hall_start_y + 16.0,
            "color": (0.95, 0.92, 1.0),
            "art_type": "luxe_diamond",
        },
        {
            "id": "05",
            "slug": "vyro",
            "title": "VYRO",
            "subtitle": "B2B WHOLESALE MARKETPLACE",
            "stack": "SUPPLY CHAIN · MULTI-SUPPLIER LEDGER",
            "side": -1,
            "y": hall_start_y + 26.0,
            "color": (0.15, 0.95, 0.70),
            "art_type": "vyro_lattice",
        },
        # Right Aisle Showcases
        {
            "id": "02",
            "slug": "legal-workspace",
            "title": "LEGAL WORKSPACE",
            "subtitle": "AI COPILOT & DOCUMENT INTELLIGENCE",
            "stack": "PGVECTOR · OCR BATES · TENANT CI",
            "side": 1,
            "y": hall_start_y + 6.0,
            "color": (1.0, 0.76, 0.32),
            "art_type": "legal_prism",
        },
        {
            "id": "04",
            "slug": "goldos",
            "title": "GOLDOS",
            "subtitle": "BULLION ERP & REAL-TIME LEDGER",
            "stack": "LIVE PHYSICAL GOLD · AUDITABLE LEDGER",
            "side": 1,
            "y": hall_start_y + 16.0,
            "color": (1.0, 0.84, 0.22),
            "art_type": "gold_bullion",
        },
        {
            "id": "06",
            "slug": "healthhub",
            "title": "HEALTHHUB",
            "subtitle": "MULTILINGUAL TELEMEDICINE & EHR",
            "stack": "UNIFIED PATIENT PORTAL · WEBRTC",
            "side": 1,
            "y": hall_start_y + 26.0,
            "color": (0.42, 0.65, 1.0),
            "art_type": "health_helix",
        },
    ]

    for p in project_defs:
        px = p["side"] * 4.4
        py = p["y"]
        pz = hall_z

        # -------------------------------------------------- A) 3-Tier Luxury Plinth Base
        plinth_bm = bmesh.new()
        pw = 1.7
        ph = 1.15

        # Tier 1: Octagonal Beveled Basalt Base
        b_base_bm = bmesh.new()
        bmesh.ops.create_cone(
            plinth_bm,
            cap_ends=True,
            cap_tris=False,
            segments=8,
            radius1=pw * 0.78,
            radius2=pw * 0.74,
            depth=0.20,
        )
        for v in plinth_bm.verts:
            v.co.x += px
            v.co.y += py
            v.co.z += pz + 0.10

        # Recessed LED Under-Glow Kick Channel
        glow_channel_bm = bmesh.new()
        bmesh.ops.create_cube(plinth_bm, size=1.0)
        for v in plinth_bm.verts[-8:]:
            v.co.x = px + v.co.x * (pw * 0.94)
            v.co.y = py + v.co.y * (pw * 0.94)
            v.co.z = pz + 0.20 + (v.co.z + 0.5) * 0.05

        # Tier 2: Nero Marquina Pedestal Body
        body_start = len(plinth_bm.verts)
        bmesh.ops.create_cube(plinth_bm, size=1.0)
        for v in plinth_bm.verts[body_start:]:
            v.co.x = px + v.co.x * pw
            v.co.y = py + v.co.y * pw
            v.co.z = pz + 0.25 + (v.co.z + 0.5) * (ph - 0.25)

        # Tier 3: Brushed Brass Collar & Bed Slab
        collar_start = len(plinth_bm.verts)
        bmesh.ops.create_cube(plinth_bm, size=1.0)
        for v in plinth_bm.verts[collar_start:]:
            v.co.x = px + v.co.x * (pw * 1.05)
            v.co.y = py + v.co.y * (pw * 1.05)
            v.co.z = pz + ph - 0.06 + (v.co.z + 0.5) * 0.08

        ob_plinth = obj_from_bm(f"ShowcasePlinth_{p['id']}_{p['slug']}", plinth_bm, col, stone_mat)
        bev_pl = ob_plinth.modifiers.new("Bevel", "BEVEL")
        bev_pl.width = 0.035

        # Brass Corner Pilasters on the Pedestal Body
        cp_bm = bmesh.new()
        cp_thick = 0.06
        for sx in (-1, 1):
            for sy in (-1, 1):
                bmesh.ops.create_cube(cp_bm, size=1.0)
                for v in cp_bm.verts[-8:]:
                    v.co.x = px + sx * (pw * 0.5) + v.co.x * cp_thick
                    v.co.y = py + sy * (pw * 0.5) + v.co.y * cp_thick
                    v.co.z = pz + 0.25 + (v.co.z + 0.5) * (ph - 0.25)
        obj_from_bm(f"PlinthCornerTrim_{p['id']}", cp_bm, col, brass_mat)

        # -------------------------------------------------- B) Glass Vitrine & Brass Frame
        vw = 1.45
        vh = 1.35
        vit_bm = bmesh.new()
        bmesh.ops.create_cube(vit_bm, size=1.0)
        for v in vit_bm.verts[-8:]:
            v.co.x = px + v.co.x * vw
            v.co.y = py + v.co.y * vw
            v.co.z = pz + ph + (v.co.z + 0.5) * vh
        obj_from_bm(f"Vitrine_{p['id']}", vit_bm, col, glass_mat)

        # Slender Brass Corner Struts & Top Canopy Cap
        frame_bm = bmesh.new()
        f_thick = 0.024
        for sx in (-1, 1):
            for sy in (-1, 1):
                # 4 vertical struts
                bmesh.ops.create_cube(frame_bm, size=1.0)
                for v in frame_bm.verts[-8:]:
                    v.co.x = px + sx * (vw * 0.5) + v.co.x * f_thick
                    v.co.y = py + sy * (vw * 0.5) + v.co.y * f_thick
                    v.co.z = pz + ph + (v.co.z + 0.5) * vh
        # Top Canopy Cap
        bmesh.ops.create_cube(frame_bm, size=1.0)
        for v in frame_bm.verts[-8:]:
            v.co.x = px + v.co.x * (vw + f_thick * 2.0)
            v.co.y = py + v.co.y * (vw + f_thick * 2.0)
            v.co.z = pz + ph + vh + (v.co.z + 0.5) * 0.06
        obj_from_bm(f"VitrineFrame_{p['id']}", frame_bm, col, brass_mat)

        # Internal Vitrine Ceiling Micro-Downlight
        micro_l = bpy.data.lights.new(f"VitrineLight_{p['id']}", "SPOT")
        micro_l.energy = 550
        micro_l.color = (1.0, 0.98, 0.94)
        micro_l.spot_size = math.radians(52)
        micro_l.spot_blend = 0.4
        micro_l.use_shadow = False
        mo = bpy.data.objects.new(f"VitrineLight_{p['id']}", micro_l)
        mo.location = (px, py, pz + ph + vh - 0.05)
        link(mo, col)
        look_at(mo, Vector((px, py, pz + ph + 0.5)))

        # -------------------------------------------------- C) 3D Typography & Plaque
        # Front-facing 3D Inscription on Pedestal Face
        try:
            p_text = bpy.data.curves.new(type="FONT", name=f"Text_{p['id']}")
            p_text.body = f"{p['id']} · {p['title']}"
            p_text.size = 0.13
            p_text.extrude = 0.015
            p_text.align_x = "CENTER"
            p_text.align_y = "CENTER"
            to = bpy.data.objects.new(f"Text_{p['id']}", p_text)
            text_x = px - (p["side"] * (pw * 0.5 + 0.03))
            to.location = (text_x, py, pz + ph * 0.72)
            rot_z = 90 if p["side"] < 0 else -90
            to.rotation_euler = Euler((math.radians(90), 0.0, math.radians(rot_z)))
            link(to, col)
            to.data.materials.append(brass_mat)
        except Exception as e:
            print(f"Project text note {p['id']}:", e)

        # Glowing Edge-lit Information Plaque
        plaque_bm = bmesh.new()
        bmesh.ops.create_cube(plaque_bm, size=1.0)
        plaque_x = px - (p["side"] * (pw * 0.5 + 0.08))
        for v in plaque_bm.verts[-8:]:
            v.co.x = plaque_x + v.co.x * 0.03
            v.co.y = py + v.co.y * 0.78
            v.co.z = pz + ph * 0.75 + (v.co.z + 0.5) * 0.35
        plaque_glow = portal_glow_mat(p["color"], 15.0)
        obj_from_bm(f"Plaque_{p['id']}", plaque_bm, col, plaque_glow)

        # -------------------------------------------------- D) Freestanding Angled Interactive Kiosk
        kiosk_bm = bmesh.new()
        kiosk_x = px - (p["side"] * (pw * 0.5 + 0.38))
        kiosk_y = py - 0.55
        kiosk_z = pz
        # Slanted pedestal pole
        bmesh.ops.create_cube(kiosk_bm, size=1.0)
        for v in kiosk_bm.verts[-8:]:
            v.co.x = kiosk_x + v.co.x * 0.07
            v.co.y = kiosk_y + v.co.y * 0.07
            v.co.z = kiosk_z + (v.co.z + 0.5) * 0.82
        # Angled glass interface tablet
        screen_start = len(kiosk_bm.verts)
        bmesh.ops.create_cube(kiosk_bm, size=1.0)
        for v in kiosk_bm.verts[screen_start:]:
            v.co.x = kiosk_x + v.co.x * 0.38
            v.co.y = kiosk_y + v.co.y * 0.28
            v.co.z = kiosk_z + 0.85 + v.co.z * 0.02
        obj_from_bm(f"InteractiveKiosk_{p['id']}", kiosk_bm, col, brass_mat)

        # Screen Glow surface
        screen_bm = bmesh.new()
        bmesh.ops.create_cube(screen_bm, size=1.0)
        for v in screen_bm.verts[-8:]:
            v.co.x = kiosk_x + v.co.x * 0.35
            v.co.y = kiosk_y + v.co.y * 0.24
            v.co.z = kiosk_z + 0.86 + (v.co.z + 0.5) * 0.01
        screen_glow = portal_glow_mat(p["color"], 6.0)
        obj_from_bm(f"KioskScreen_{p['id']}", screen_bm, col, screen_glow)

        # -------------------------------------------------- E) Unique High-Detail 3D Sculpture
        art_bm = bmesh.new()
        art_center_z = pz + ph + vh * 0.52
        art_mat = hologram_mat(p["slug"], p["color"], strength=6.0)

        if p["art_type"] == "school_system":
            # 01. School System: 6 Interlocking Modular Portal Cubes & Central Cryptographic Token Ring
            for c_i, c_pos in enumerate([
                (-0.24, -0.24, -0.22),
                (0.24, -0.24, -0.22),
                (0.24, 0.24, -0.22),
                (-0.24, 0.24, -0.22),
                (0.0, -0.24, 0.22),
                (0.0, 0.24, 0.22),
            ]):
                bmesh.ops.create_cube(art_bm, size=0.22)
                for v in art_bm.verts[-8:]:
                    v.co += Vector(c_pos)
            # Central Token Ring
            add_torus_to_bm(art_bm, r_major=0.48, r_minor=0.035, seg_maj=24, seg_min=8)

        elif p["art_type"] == "legal_prism":
            # 02. Legal Workspace: Multifaceted Intelligence Crystal + Dual Concentric Gimbal Rings
            bmesh.ops.create_cone(art_bm, cap_ends=True, segments=12, radius1=0.38, radius2=0.0, depth=0.85)
            for v in art_bm.verts:
                v.co.z -= 0.42
            cone2_start = len(art_bm.verts)
            bmesh.ops.create_cone(art_bm, cap_ends=True, segments=12, radius1=0.38, radius2=0.0, depth=0.85)
            for v in art_bm.verts[cone2_start:]:
                v.co.z = -v.co.z + 0.42
            # Dual Concentric Armillary Gimbal Rings
            ring1_start = len(art_bm.verts)
            add_torus_to_bm(art_bm, r_major=0.55, r_minor=0.032, seg_maj=24, seg_min=8)
            for v in art_bm.verts[ring1_start:]:
                v.co = Euler((math.radians(35), math.radians(25), 0.0)).to_matrix() @ v.co

            ring2_start = len(art_bm.verts)
            add_torus_to_bm(art_bm, r_major=0.62, r_minor=0.032, seg_maj=24, seg_min=8)
            for v in art_bm.verts[ring2_start:]:
                v.co = Euler((math.radians(-40), math.radians(50), 0.0)).to_matrix() @ v.co

        elif p["art_type"] == "luxe_diamond":
            # 03. LUXE: 58-Facet Brilliant Cut Diamond on 4-Prong Jewelry Mount
            # Diamond Pavilion (bottom cone)
            bmesh.ops.create_cone(art_bm, cap_ends=True, segments=16, radius1=0.52, radius2=0.05, depth=0.55)
            for v in art_bm.verts:
                v.co.z = -v.co.z
            # Diamond Crown (top facet cone)
            cr_start = len(art_bm.verts)
            bmesh.ops.create_cone(art_bm, cap_ends=True, segments=16, radius1=0.52, radius2=0.35, depth=0.28)
            for v in art_bm.verts[cr_start:]:
                v.co.z += 0.41
            # 4-Prong Jewelry Mount Prongs
            for px_i, py_i in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
                p_start = len(art_bm.verts)
                bmesh.ops.create_cube(art_bm, size=1.0)
                for v in art_bm.verts[p_start:]:
                    v.co.x = px_i * 0.48 + v.co.x * 0.04
                    v.co.y = py_i * 0.48 + v.co.y * 0.04
                    v.co.z = (v.co.z + 0.5) * 0.55 - 0.25

        elif p["art_type"] == "gold_bullion":
            # 04. GoldOS: Stepped Pyramid of 6 Gold Bullion Ingots with Serial Stamps
            art_mat = gold_mat
            # Tier 1 (3 base bars)
            for b_idx, by_off in enumerate((-0.26, 0.0, 0.26)):
                bmesh.ops.create_cube(art_bm, size=1.0)
                for v in art_bm.verts[-8:]:
                    v.co.x *= 0.68
                    v.co.y = by_off + v.co.y * 0.22
                    v.co.z = (v.co.z + 0.5) * 0.12 - 0.22
            # Tier 2 (2 middle bars)
            for b_idx, by_off in enumerate((-0.13, 0.13)):
                bmesh.ops.create_cube(art_bm, size=1.0)
                for v in art_bm.verts[-8:]:
                    v.co.x *= 0.65
                    v.co.y = by_off + v.co.y * 0.22
                    v.co.z = 0.14 + (v.co.z + 0.5) * 0.12 - 0.22
            # Tier 3 (1 cap bullion bar)
            bmesh.ops.create_cube(art_bm, size=1.0)
            for v in art_bm.verts[-8:]:
                v.co.x *= 0.62
                v.co.y *= 0.22
                v.co.z = 0.28 + (v.co.z + 0.5) * 0.12 - 0.22
            # Tiered Gold Medallions at base
            for med_ang in (0.3, 1.2, 2.5, 3.8, 5.0):
                med_start = len(art_bm.verts)
                bmesh.ops.create_cone(art_bm, cap_ends=True, segments=16, radius1=0.14, radius2=0.14, depth=0.03)
                for v in art_bm.verts[med_start:]:
                    v.co.x += math.cos(med_ang) * 0.55
                    v.co.y += math.sin(med_ang) * 0.45
                    v.co.z -= 0.22

        elif p["art_type"] == "vyro_lattice":
            # 05. VYRO: Hexagonal Honeycomb Supply Chain Matrix + Pipeline Cluster
            bmesh.ops.create_cone(art_bm, cap_ends=True, segments=6, radius1=0.48, radius2=0.48, depth=0.62)
            # Surrounding satellite hex prisms
            for h_i in range(6):
                h_ang = (h_i / 6.0) * math.tau
                h_start = len(art_bm.verts)
                bmesh.ops.create_cone(art_bm, cap_ends=True, segments=6, radius1=0.18, radius2=0.18, depth=0.45)
                for v in art_bm.verts[h_start:]:
                    v.co.x += math.cos(h_ang) * 0.52
                    v.co.y += math.sin(h_ang) * 0.52
                    v.co.z += math.sin(h_i) * 0.12
            # Interconnecting Pipeline Rings
            add_torus_to_bm(art_bm, r_major=0.55, r_minor=0.035, seg_maj=16, seg_min=8)

        elif p["art_type"] == "health_helix":
            # 06. HealthHub: Soaring Double-Helix Pulse Knot with Biometric Rungs
            add_torus_to_bm(art_bm, r_major=0.48, r_minor=0.08, seg_maj=24, seg_min=10)
            for v in art_bm.verts:
                v.co.z += math.sin(v.co.x * 5.0) * 0.22
            # Cross-connecting pulse rungs
            for r_i in range(8):
                rx_i = -0.35 + r_i * 0.10
                bmesh.ops.create_cube(art_bm, size=1.0)
                for v in art_bm.verts[-8:]:
                    v.co.x = rx_i + v.co.x * 0.03
                    v.co.y *= 0.45
                    v.co.z = math.sin(rx_i * 5.0) * 0.22 + v.co.z * 0.03
            # Floating Vital Sign Pulse Ring
            pulse_start = len(art_bm.verts)
            add_torus_to_bm(art_bm, r_major=0.58, r_minor=0.02, seg_maj=24, seg_min=8)
            for v in art_bm.verts[pulse_start:]:
                v.co = Euler((math.radians(20), math.radians(45), 0.0)).to_matrix() @ v.co

        ob_art = obj_from_bm(f"Artifact_{p['id']}_{p['slug']}", art_bm, col, art_mat)
        ob_art.location = (px, py, art_center_z)
        ob_art.rotation_euler = Euler((0.15, 0.25, 0.4))

        # -------------------------------------------------- F) Overhead Dual Museum Track Spotlights
        # Key Spot aiming from 45 deg front-aisle
        spot1 = bpy.data.lights.new(f"SpotA_{p['id']}", "SPOT")
        spot1.energy = 1100
        spot1.color = (1.0, 0.96, 0.90)
        spot1.spot_size = math.radians(42)
        spot1.spot_blend = 0.5
        so1 = bpy.data.objects.new(f"SpotA_{p['id']}", spot1)
        so1.location = (px - p["side"] * 1.5, py - 1.2, hall_z + hall_h - 0.5)
        link(so1, col)
        look_at(so1, Vector((px, py, pz + ph + 0.45)))

        # Fill Spot aiming from rear-side
        spot2 = bpy.data.lights.new(f"SpotB_{p['id']}", "SPOT")
        spot2.energy = 700
        spot2.color = (0.92, 0.95, 1.0)
        spot2.spot_size = math.radians(48)
        spot2.spot_blend = 0.5
        spot2.use_shadow = False
        so2 = bpy.data.objects.new(f"SpotB_{p['id']}", spot2)
        so2.location = (px + p["side"] * 1.2, py + 1.2, hall_z + hall_h - 0.5)
        link(so2, col)
        look_at(so2, Vector((px, py, pz + ph + 0.45)))

    # ------------------------------------------------------------------ 5. Monumental End Focal Apse
    apse_bm = bmesh.new()
    apse_r = 3.8
    apse_y = hall_start_y + hall_d - 0.05
    apse_z = hall_z + hall_h * 0.52

    # Tiered Semicircular Marble Steps leading up to the apse
    for st_i in range(3):
        st_r = (hall_w * 0.45) - st_i * 0.6
        st_z = hall_z + st_i * 0.16
        bmesh.ops.create_cone(
            apse_bm,
            cap_ends=True,
            cap_tris=False,
            segments=24,
            radius1=st_r,
            radius2=st_r,
            depth=0.16,
        )
        for v in apse_bm.verts[-48:]:
            if v.co.y < 0:
                v.co.y = 0.0
            v.co.y += apse_y - 1.8 + st_i * 0.4
            v.co.z += st_z

    # Monumental Classical Rose Window Frame with 12 radial mullions
    add_torus_to_bm(apse_bm, r_major=apse_r, r_minor=0.12, seg_maj=32, seg_min=8)
    add_torus_to_bm(apse_bm, r_major=apse_r * 0.62, r_minor=0.08, seg_maj=24, seg_min=8)
    for sp_i in range(12):
        sp_ang = sp_i / 12 * math.pi
        bmesh.ops.create_cube(apse_bm, size=1.0)
        for v in apse_bm.verts[-8:]:
            lx = v.co.x * (apse_r * 1.95)
            lz = v.co.z * 0.08
            v.co.x = lx * math.cos(sp_ang) - lz * math.sin(sp_ang)
            v.co.z = lx * math.sin(sp_ang) + lz * math.cos(sp_ang)
            v.co.y *= 0.08
    for v in apse_bm.verts:
        v.co.y += apse_y
        v.co.z += apse_z
    obj_from_bm("GalleryApseFrame", apse_bm, col, brass_mat)

    # Celestial Backlit Glass Disc inside the Rose Window
    glass_disc_bm = bmesh.new()
    bmesh.ops.create_circle(glass_disc_bm, cap_ends=True, radius=apse_r * 0.98, segments=32)
    for v in glass_disc_bm.verts:
        v.co = Vector((v.co.x, apse_y + 0.02, apse_z + v.co.y))
    cosmic_glow = portal_glow_mat((0.35, 0.70, 1.0), 16.0)
    obj_from_bm("GalleryApseGlass", glass_disc_bm, col, cosmic_glow)


# ------------------------------------------------------------------ lighting & atmosphere
def setup_lighting(col):
    world = bpy.data.worlds.new("MuseumNight")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.002, 0.003, 0.005, 1.0)
    bg.inputs["Strength"].default_value = 1.0

    # 1. Main Key Moonlight (casting long dramatic colonnade shadows across the plaza)
    sun = bpy.data.lights.new("MoonlightKey", "SUN")
    sun.energy = 8.5
    sun.color = (0.84, 0.92, 1.0)
    sun.angle = math.radians(1.0)
    so = bpy.data.objects.new("MoonlightKey", sun)
    sun_dir = Vector((-0.45, 0.35, -1.0)).normalized()
    so.rotation_euler = sun_dir.to_track_quat("-Z", "Y").to_euler()
    link(so, col)

    # 2. Portal Warm Spill Light (warm golden glow flooding outward from the doorway)
    portal_light = bpy.data.lights.new("PortalSpill", "POINT")
    portal_light.energy = 3800
    portal_light.color = (1.0, 0.88, 0.70)
    portal_light.shadow_soft_size = 0.5
    po = bpy.data.objects.new("PortalSpill", portal_light)
    po.location = (0.0, 0.4, 2.6)
    link(po, col)

    # 3. Colonnade Grazing Uplights along the grand peristyle
    for x in (-22.0, -16.0, -10.0, -5.0, 5.0, 10.0, 16.0, 22.0):
        up_l = bpy.data.lights.new(f"ColUplight_{x}", "POINT")
        up_l.energy = 380
        up_l.color = (1.0, 0.94, 0.85)
        up_l.use_shadow = False
        uo = bpy.data.objects.new(f"ColUplight_{x}", up_l)
        uo.location = (x, -2.2, 1.0)
        link(uo, col)

    # 4. Interior Gallery Ambient Lighting (ensuring the grand gallery is luminous & visible)
    # A) Skylight Downwash Lights (soft atmospheric moonlight inside the vault)
    for y_pos in (7.0, 15.0, 23.0, 31.0):
        sky_l = bpy.data.lights.new(f"SkyWash_{y_pos}", "POINT")
        sky_l.energy = 550
        sky_l.color = (0.85, 0.92, 1.0)
        sky_l.use_shadow = False
        so_sky = bpy.data.objects.new(f"SkyWash_{y_pos}", sky_l)
        so_sky.location = (0.0, y_pos, 8.8)
        link(so_sky, col)

    # B) Warm Aisle Center Wash Lights
    for y_pos in (8.0, 18.0, 28.0):
        c_l = bpy.data.lights.new(f"CenterAisle_{y_pos}", "POINT")
        c_l.energy = 650
        c_l.color = (1.0, 0.95, 0.88)
        c_l.use_shadow = False
        co = bpy.data.objects.new(f"CenterAisle_{y_pos}", c_l)
        co.location = (0.0, y_pos, 4.5)
        link(co, col)

    # 5. Exterior Atmospheric Ground Mist / Volumetric Box
    bpy.ops.mesh.primitive_cube_add(size=1)
    v = bpy.context.active_object
    for c in v.users_collection:
        c.objects.unlink(v)
    col.objects.link(v)
    v.name = "PlazaHaze"
    v.location = (0, -12.0, 3.8)
    v.scale = (70, 45, 12)
    m, nt, out = nodes_mat("PlazaHazeMat")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = 0.005
    vol.inputs["Anisotropy"].default_value = 0.70
    vol.inputs["Color"].default_value = (0.88, 0.94, 1.0, 1.0)
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    v.data.materials.append(m)


# ------------------------------------------------------------------ cameras
def setup_cameras(col):
    # Camera 1: Exterior Establishing Shot (framed identically to virtuallyeverafter.xyz)
    # Wide 21mm lens, low eye-level perspective capturing the full wings, rotunda, and entrance portal
    cam_ext = bpy.data.cameras.new("Cam_Exterior")
    cam_ext.lens = 21
    cam_ext.dof.use_dof = True
    cam_ext.dof.focus_distance = 22.0
    cam_ext.dof.aperture_fstop = 5.6
    ob_ext = bpy.data.objects.new("Cam_Exterior", cam_ext)
    ob_ext.location = (0.0, -25.5, 1.85)
    link(ob_ext, col)
    look_at(ob_ext, Vector((0.0, -1.0, 3.8)))

    # Camera 2: Interior Exhibition Hall (looking down the central gallery aisle toward project plinths)
    cam_int = bpy.data.cameras.new("Cam_Interior")
    cam_int.lens = 19
    cam_int.dof.use_dof = True
    cam_int.dof.focus_distance = 12.0
    cam_int.dof.aperture_fstop = 3.5
    ob_int = bpy.data.objects.new("Cam_Interior", cam_int)
    ob_int.location = (0.0, 1.8, 1.95)
    link(ob_int, col)
    look_at(ob_int, Vector((0.0, 20.0, 2.5)))

    bpy.context.scene.camera = ob_ext


# ------------------------------------------------------------------ render engine configuration
def setup_render_engine():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 1920
    sc.render.resolution_y = 1080
    sc.render.resolution_percentage = 100

    ee = sc.eevee
    if hasattr(ee, "taa_render_samples"):
        ee.taa_render_samples = 64
    for attr, val in (
        ("volumetric_tile_size", "2"),
        ("volumetric_samples", 128),
        ("volumetric_end", 75.0),
        ("use_volumetric_shadows", True),
        ("volumetric_shadow_samples", 32),
        ("use_shadows", True),
        ("use_raytracing", True),
        ("use_gtao", True),
        ("use_bloom", True),
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
    sc.view_settings.exposure = 0.35


# ------------------------------------------------------------------ main build
def build():
    reset()
    cols = {n: collection(n) for n in ("Architecture", "InteriorGallery", "Lighting", "Cameras")}

    stone = obsidian_stone_mat()
    lime = classical_limestone_mat()
    brass = architectural_brass_mat()
    gold = pure_gold_mat()
    glow = portal_glow_mat((1.0, 1.0, 1.0), 32.0)
    warm = warm_interior_mat()
    glass = glass_vitrine_mat()
    grid = plaza_grid_mat()
    marble = polished_marble_mat()

    build_exterior(cols["Architecture"], stone, lime, brass, glow, warm, grid)
    build_interior_gallery(cols["InteriorGallery"], marble, stone, lime, brass, gold, glass, glow)
    setup_lighting(cols["Lighting"])
    setup_cameras(cols["Cameras"])
    setup_render_engine()

    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    print(f"Saved {OUT_BLEND}")


if __name__ == "__main__":
    build()
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if "render" in args:
        os.makedirs(os.path.join(ROOT, "art", "renders"), exist_ok=True)

        # 1. Render Exterior Hero View
        cam_ext = bpy.data.objects.get("Cam_Exterior")
        if cam_ext:
            bpy.context.scene.camera = cam_ext
            bpy.context.scene.render.filepath = OUT_EXT_PNG
            bpy.ops.render.render(write_still=True)
            print(f"Rendered Exterior to {OUT_EXT_PNG}")

        # 2. Render Interior Gallery View
        cam_int = bpy.data.objects.get("Cam_Interior")
        if cam_int:
            bpy.context.scene.camera = cam_int
            bpy.context.scene.render.filepath = OUT_INT_PNG
            bpy.ops.render.render(write_still=True)
            print(f"Rendered Interior to {OUT_INT_PNG}")
