"""Procedural textures for the Lykan, drawn with numpy, and the materials that wear them.

Every texture tiles. Colour maps are written as sRGB, normal maps as non-colour OpenGL (+Y up),
which is what both Cycles and glTF expect. `upgrade()` swaps them into the materials the kit made.
"""

import math
import os
import tempfile

import bpy
import numpy as np

from lykan_kit import MATS, UVSCALE

RNG = np.random.default_rng(7)


# ------------------------------------------------------------------ numpy helpers
def blur(a, r, axes=(0, 1), passes=2):
    for _ in range(passes):
        for ax in axes:
            acc = np.zeros_like(a)
            for k in range(-r, r + 1):
                acc += np.roll(a, k, ax)
            a = acc / (2 * r + 1)
    return a


def norm01(a):
    a = a - a.min()
    return a / (a.max() + 1e-9)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def grid(w, h=None):
    h = h or w
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    return (x + 0.5) / w, (y + 0.5) / h


def normal_map(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


TMP = tempfile.mkdtemp(prefix="lykan_tex_")


def image(name, rgb, alpha=None, data=False):
    """Write the buffer to a PNG and load it back packed: generated buffers render blank in Cycles."""
    h, w = rgb.shape[:2]
    buf = bpy.data.images.new(name + "_buf", w, h, alpha=alpha is not None)
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = np.clip(rgb, 0, 1)
    if alpha is not None:
        px[..., 3] = np.clip(alpha, 0, 1)
    buf.pixels.foreach_set(px.ravel())
    path = os.path.join(TMP, name + ".png")
    buf.filepath_raw = path
    buf.file_format = "PNG"
    buf.save()
    bpy.data.images.remove(buf)
    img = bpy.data.images.load(path)
    img.name = name
    if data:
        img.colorspace_settings.name = "Non-Color"
    img.pack()
    return img


def tint(gray, rgb):
    return gray[..., None] * np.array(rgb, np.float32)


# ------------------------------------------------------------------ surfaces
def leather_grain(n=512):
    """Pebbled hide: a ridged network of small, uneven cells."""
    noise = RNG.random((n, n)).astype(np.float32)
    h = -np.abs(blur(noise, 1) - blur(noise, 4))
    h += 0.4 * blur(RNG.random((n, n)).astype(np.float32), 10)
    return norm01(h)


def leather(name, rgb, grain):
    var = 0.86 + 0.14 * norm01(blur(RNG.random(grain.shape).astype(np.float32), 18))
    col = tint(var * (0.9 + 0.1 * grain), rgb)
    return image(name, col)


def quilt(name, rgb, stitch=(0.86, 0.64, 0.30), n=512, grain=None):
    """Diamond quilting, two diamonds per tile, a gold lock-stitch running beside every seam."""
    x, y = grid(n)
    a, b = 2 * (x + y), 2 * (x - y)
    da, db = np.abs(a - np.round(a)), np.abs(b - np.round(b))
    d = np.minimum(da, db)
    pillow = smooth(0.0, 0.24, d) ** 0.55
    on_a = (np.abs(da - 0.055) < 0.011) & ((b * 13) % 1.0 < 0.58) & (da < db + 0.06)
    on_b = (np.abs(db - 0.055) < 0.011) & ((a * 13) % 1.0 < 0.58) & (db < da + 0.06)
    st = (on_a | on_b).astype(np.float32)
    st = np.maximum(st, 0.0)
    g = grain if grain is not None else leather_grain(n)
    shade = 0.5 + 0.5 * pillow
    col = tint(shade * (0.9 + 0.1 * g), rgb)
    col = col * (1 - st[..., None]) + np.array(stitch, np.float32) * st[..., None]
    h = pillow + 0.08 * g + 0.10 * st
    return image(name, col), image(name + "_N", normal_map(h, 9.0), data=True)


def carbon(n=512, cells=8):
    """2x2 twill: tows alternate on a diagonal stagger, each with a crown and fine fibres."""
    x, y = grid(n)
    i, j = np.floor(x * cells), np.floor(y * cells)
    u, v = (x * cells) % 1.0, (y * cells) % 1.0
    horiz = ((i + j) // 2) % 2 == 0
    t = np.where(horiz, v, u)
    crown = np.sin(math.pi * t) ** 0.6
    fib = 0.78 + 0.22 * np.sin(t * math.pi * 22) ** 2
    g = 0.02 + 0.085 * crown * fib * np.where(horiz, 1.0, 0.7)
    col = tint(g, (1.0, 1.0, 1.06))
    h = crown * 0.7 + np.where(horiz, 0.15, 0.0)
    return image("CarbonWeave", col), image("CarbonWeave_N", normal_map(h, 5.0), data=True)


def brushed(n=512):
    noise = RNG.random((n, n)).astype(np.float32)
    h = norm01(blur(noise, 40, axes=(1,), passes=1)) * 0.7 + 0.3 * norm01(blur(noise, 1, axes=(0,), passes=1))
    return image("Brushed_N", normal_map(h, 1.6), data=True)


def crinkle(n=256):
    noise = RNG.random((n, n)).astype(np.float32)
    h = norm01(-np.abs(blur(noise, 1) - blur(noise, 3)))
    return image("Crinkle_N", normal_map(h, 4.0), data=True)


def foil(n=512):
    noise = RNG.random((n, n)).astype(np.float32)
    h = norm01(np.abs(blur(noise, 5) - blur(noise, 13))) + 0.3 * norm01(blur(noise, 2))
    return image("Foil_N", normal_map(h, 14.0), data=True)


def braid(n=256, k=8):
    x, y = grid(n)
    p1 = np.sin(2 * math.pi * (k * x + k * y))
    p2 = np.sin(2 * math.pi * (k * x - k * y))
    over = ((np.floor(k * x + k * y) + np.floor(k * x - k * y)) % 2) == 0
    h = 0.5 + 0.5 * np.where(over, np.maximum(p1, p2 * 0.6), np.maximum(p2, p1 * 0.6))
    strands = 0.85 + 0.15 * np.sin(2 * math.pi * (k * 6) * (x + y)) * np.sin(2 * math.pi * (k * 6) * (x - y))
    col = tint(0.25 + 0.55 * h * strands, (0.95, 0.96, 1.0))
    return image("Braid", col), image("Braid_N", normal_map(h, 6.0), data=True)


def webbing(n=256):
    x, y = grid(n)
    rib = 0.5 + 0.5 * np.sin(2 * math.pi * x * 40)
    weave = 0.5 + 0.5 * np.sin(2 * math.pi * y * 120)
    h = rib * 0.8 + weave * 0.2
    col = tint(0.08 + 0.05 * h, (1, 1, 1.05))
    return image("Webbing", col), image("Webbing_N", normal_map(h, 3.0), data=True)


def carpet(n=256):
    noise = RNG.random((n, n)).astype(np.float32)
    h = norm01(blur(noise, 1, passes=1))
    col = tint(0.05 + 0.03 * h, (1, 1, 1))
    return image("Carpet", col), image("Carpet_N", normal_map(h, 2.0), data=True)


def suede(n=256):
    noise = RNG.random((n, n)).astype(np.float32)
    h = norm01(blur(noise, 2) + 0.5 * blur(noise, 9))
    col = tint(0.055 + 0.025 * h, (1, 1, 1.03))
    return image("Suede", col), image("Suede_N", normal_map(h, 1.5), data=True)


def tread(w=1024, h=256):
    """U runs round the tyre, V across the lathe profile (tread between ~0.22 and ~0.78)."""
    u, v = grid(w, h)
    zone = (v > 0.22) & (v < 0.78)
    sweep = 3.2 * np.abs(v - 0.5)
    sipe = ((u * 70 + sweep) % 1.0) < 0.085
    block = ((u * 140 + 2 * sweep) % 1.0) < 0.05
    outer = np.abs(v - 0.5) > 0.12
    groove = zone & (sipe | (block & outer))
    side = ~zone
    rings = 0.5 + 0.5 * np.sin(v * 900)
    hgt = np.where(groove, 0.0, 1.0) * zone + side * (0.92 + 0.08 * rings)
    col = tint(np.where(groove, 0.025, 0.06) * zone + side * (0.055 + 0.01 * rings), (1, 1, 1.03))
    return image("Tread", col), image("Tread_N", normal_map(hgt, 4.0), data=True)


def perforated(n=128, holes=8):
    x, y = grid(n)
    cx, cy = (x * holes) % 1.0 - 0.5, (y * holes) % 1.0 - 0.5
    hole = np.hypot(cx, cy) < 0.3
    col = tint(np.full((n, n), 0.6, np.float32), (1, 1, 1))
    return image("Perforated", col, alpha=np.where(hole, 0.0, 1.0))


def heat_tint(h=256):
    """Titanium after heat: violet-blue at the port, straw gold, bronze, then bare metal. V runs 0..1."""
    keys = [(0.0, (0.16, 0.14, 0.42)), (0.12, (0.30, 0.22, 0.55)), (0.28, (0.80, 0.62, 0.30)),
            (0.45, (0.62, 0.45, 0.30)), (0.62, (0.55, 0.52, 0.50)), (1.0, (0.62, 0.62, 0.64))]
    v = (np.arange(h) + 0.5) / h
    col = np.zeros((h, 8, 3), np.float32)
    for c in range(3):
        col[:, :, c] = np.interp(v, [k for k, _ in keys], [rgb[c] for _, rgb in keys])[:, None]
    return image("HeatTint", col)


# ------------------------------------------------------------------ screens
def polar(x, y, cx, cy):
    dx, dy = x - cx, y - cy
    return np.hypot(dx, dy), np.degrees(np.arctan2(dy, dx))


def dial(img, x, y, cx, cy, R, value, red_from, col, accent):
    """A 270-degree gauge: ring, major/minor ticks, red zone, needle and hub."""
    r, th = polar(x, y, cx, cy)
    sweep = (225 - th) % 360                  # 0 at lower-left, clockwise
    inarc = sweep <= 270
    frac = sweep / 270
    ring = inarc & (np.abs(r - R) < 2.2)
    major = inarc & (np.abs(((frac * 9 + 0.5) % 1.0) - 0.5) * 30 < 0.35) & (r > R - 24) & (r < R)
    minor = inarc & (np.abs(((frac * 36 + 0.5) % 1.0) - 0.5) * 7.5 < 0.18) & (r > R - 12) & (r < R)
    red = inarc & (frac > red_from) & (r > R - 9) & (r < R + 3)
    glow = inarc & (frac < value) & (np.abs(r - (R + 7)) < 3)
    a = math.radians(225 - 270 * value)
    px, py = x - cx, y - cy
    along = px * math.cos(a) + py * math.sin(a)
    perp = np.abs(-px * math.sin(a) + py * math.cos(a))
    needle = (along > 0) & (along < R - 6) & (perp < 2.4 - along / R * 1.2)
    hub = r < 14
    for m, c in ((ring, col), (major, col), (minor, col * 0.7), (red, (1.0, 0.06, 0.04)),
                 (glow, accent), (needle, (1.0, 0.35, 0.08)), (hub, (0.25, 0.25, 0.28))):
        img[m] = c


def seven_seg(img, x, y, ox, oy, s, digit, col):
    segs = {0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc",
            8: "abcdefg", 9: "abcdfg"}[digit]
    t = s * 0.18
    rects = {"a": (0, s * 2 - t, s, s * 2), "g": (0, s - t / 2, s, s + t / 2), "d": (0, 0, s, t),
             "f": (0, s, t, s * 2), "b": (s - t, s, s, s * 2), "e": (0, 0, t, s), "c": (s - t, 0, s, s)}
    for k in segs:
        x0, y0, x1, y1 = rects[k]
        img[(x >= ox + x0) & (x <= ox + x1) & (y >= oy + y0) & (y <= oy + y1)] = col


def cluster(w=1024, h=320):
    x, y = np.mgrid[0:h, 0:w][1].astype(np.float32), np.mgrid[0:h, 0:w][0].astype(np.float32)
    img = np.zeros((h, w, 3), np.float32)
    img[:] = (0.01, 0.015, 0.025)
    white, cyan = np.array((0.92, 0.95, 1.0)), np.array((0.15, 0.75, 1.0))
    dial(img, x, y, 190, 160, 128, 0.42, 0.85, white, cyan)        # speed
    dial(img, x, y, 834, 160, 128, 0.58, 0.78, white, (1.0, 0.25, 0.05))  # revs
    seven_seg(img, x, y, 470, 110, 50, 4, cyan)                   # gear
    for k in range(10):                                            # fuel and oil bar graphs
        img[(x > 600) & (x < 616) & (y > 60 + k * 20) & (y < 74 + k * 20)] = white * (1 if k < 7 else 0.15)
        img[(x > 410) & (x < 426) & (y > 60 + k * 20) & (y < 74 + k * 20)] = cyan * (1 if k < 5 else 0.15)
    return image("Cluster", img)


def holo(n=512):
    x, y = grid(n)
    r, th = polar(x, y, 0.5, 0.5)
    rings = (np.abs(((r * 14) % 1.0) - 0.5) > 0.46) & (r < 0.48)
    spokes = (np.abs(((th / 15) % 1.0) - 0.5) > 0.47) & (r < 0.45) & (r > 0.12)
    gridm = ((np.abs(((x * 24) % 1.0) - 0.5) > 0.47) | (np.abs(((y * 24) % 1.0) - 0.5) > 0.47)) & (r < 0.48)
    car = (np.abs(np.abs(x - 0.5) - 0.13) < 0.006) & (np.abs(y - 0.5) < 0.26) | \
          (np.abs(np.abs(y - 0.5) - 0.26) < 0.006) & (np.abs(x - 0.5) < 0.13)
    a = np.clip(rings * 0.9 + spokes * 0.5 + gridm * 0.25 + car * 1.0, 0, 1)
    col = tint(np.ones_like(x), (0.25, 0.85, 1.0))
    return image("Holo", col, alpha=a)


# ------------------------------------------------------------------ materials
def wire(m, base=None, normal=None, nstrength=1.0, emit=None, estrength=1.0, alpha=None, clip=False):
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    if base is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = base
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
        if alpha is not None:
            if clip:
                gt = nt.nodes.new("ShaderNodeMath")
                gt.operation = "GREATER_THAN"
                gt.inputs[1].default_value = 0.5
                nt.links.new(t.outputs["Alpha"], gt.inputs[0])
                nt.links.new(gt.outputs[0], b.inputs["Alpha"])
                m.surface_render_method = "DITHERED"
            else:
                nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
                m.surface_render_method = "BLENDED"
    if normal is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = normal
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = nstrength
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if emit is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = emit
        nt.links.new(t.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = estrength
        if alpha == "emit":
            nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
            m.surface_render_method = "BLENDED"


def principled(name, metal=0.0, rough=0.5, coat=0.0, coat_rough=0.05, color=(1, 1, 1), sheen=0.0):
    m = MATS.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = coat_rough
    if sheen:
        b.inputs["Sheen Weight"].default_value = sheen
    m.diffuse_color = (*color, 1)
    MATS[name] = m
    return m


def upgrade():
    g = leather_grain()
    grain_n = image("Leather_N", normal_map(g, 3.5), data=True)
    black_leather = (0.085, 0.08, 0.078)
    red_leather = (0.42, 0.035, 0.03)
    wire(principled("Leather", rough=0.5, coat=0.12, coat_rough=0.35), leather("Leather", black_leather, g),
         grain_n, 0.8)
    wire(principled("LeatherRed", rough=0.48, coat=0.12, coat_rough=0.35), leather("LeatherRed", red_leather, g),
         grain_n, 0.8)
    for name, rgb in (("QuiltRed", red_leather), ("QuiltBlack", black_leather)):
        col, nrm = quilt(name, rgb, grain=g)
        wire(principled(name, rough=0.5, coat=0.12, coat_rough=0.35), col, nrm, 1.0)
    col, nrm = carbon()
    wire(principled("Carbon", metal=0.0, rough=0.32, coat=1.0, coat_rough=0.03), col, nrm, 0.6)
    wire(principled("CarbonMatte", rough=0.45, coat=0.3, coat_rough=0.3), col, nrm, 0.6)
    bn = brushed()
    wire(principled("Aluminium", metal=1.0, rough=0.24, color=(0.8, 0.8, 0.82)), normal=bn, nstrength=0.6)
    wire(principled("BrushedDark", metal=1.0, rough=0.28, color=(0.2, 0.2, 0.22)), normal=bn, nstrength=0.6)
    wire(principled("CrinkleBlack", metal=0.1, rough=0.62, color=(0.025, 0.025, 0.027)), normal=crinkle(),
         nstrength=0.8)
    wire(principled("CrinkleRed", metal=0.1, rough=0.5, color=(0.35, 0.02, 0.015)), normal=MATS["CrinkleBlack"]
         .node_tree.nodes["Image Texture"].image, nstrength=0.8)
    wire(principled("CastAlu", metal=1.0, rough=0.5, color=(0.58, 0.58, 0.58)), normal=MATS["CrinkleBlack"]
         .node_tree.nodes["Image Texture"].image, nstrength=0.35)
    wire(principled("Foil", metal=1.0, rough=0.28, color=(1.0, 0.76, 0.38)), normal=foil(), nstrength=1.0)
    col, nrm = braid()
    wire(principled("Braided", metal=1.0, rough=0.35), col, nrm, 1.0)
    col, nrm = webbing()
    wire(principled("Webbing", rough=0.75), col, nrm, 0.6)
    col, nrm = carpet()
    wire(principled("Carpet", rough=1.0, sheen=0.08), col, nrm, 0.5)
    col, nrm = suede()
    wire(principled("Alcantara", rough=0.95, sheen=0.1), col, nrm, 0.5)
    col, nrm = tread()
    wire(principled("Tyre", rough=0.78), col, nrm, 1.0)
    wire(principled("Speaker", metal=1.0, rough=0.3, color=(0.6, 0.6, 0.62)), perforated(), alpha=True, clip=True)
    wire(principled("HeatTi", metal=1.0, rough=0.22), heat_tint())
    gauges = cluster()
    m = principled("Gauges", rough=0.15, color=(0.0, 0.0, 0.0))
    wire(m, emit=gauges, estrength=2.5)
    m = principled("Holo", rough=0.1, color=(0.0, 0.0, 0.0))
    wire(m, emit=holo(), estrength=5.0, alpha="emit")
    # metres per tile for box-projected UVs
    UVSCALE.update({"Carbon": 25.0, "CarbonMatte": 25.0, "Leather": 6.0, "LeatherRed": 6.0, "QuiltRed": 6.0,
                    "QuiltBlack": 6.0, "Alcantara": 8.0, "Aluminium": 5.0, "BrushedDark": 5.0,
                    "CrinkleBlack": 10.0, "CrinkleRed": 10.0, "CastAlu": 14.0, "Foil": 4.0, "Carpet": 6.0, "Speaker": 30.0})
