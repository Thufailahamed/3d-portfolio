"""
Investigation board: slims the Sketchfab model (Mkky, CC-BY-4.0) down to what the
site draws itself around — the cork board in its frame and one push pin — and
pulls the map's paper creases out of the atlas as a normal map for the night map.

  Blender -b -P art/build_board.py
    → public/models/board.glb, public/board/paper-normal.webp
"""
import bpy, os, mathutils

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "investigation_board.glb")
OUT = os.path.join(ROOT, "public", "models", "board.glb")
PAPER = os.path.join(ROOT, "public", "board", "paper-normal.png")
KEEP = {"Cube.099__0": "Board", "Cylinder.006__0": "Pin"}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
bpy.context.view_layer.update()

# the map's UV rectangle in the atlas, before it goes
mapobj = bpy.data.objects["Plane.058__0"]
uvs = [l.uv for l in mapobj.data.uv_layers.active.data]
u0, u1 = min(u.x for u in uvs), max(u.x for u in uvs)
v0, v1 = min(u.y for u in uvs), max(u.y for u in uvs)
print("MAP_UV", u0, u1, v0, v1)

board = bpy.data.objects["Cube.099__0"]
board_mw = board.matrix_world.copy()
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.name in KEEP:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
for o in list(bpy.data.objects):
    if o.name not in KEEP:
        bpy.data.objects.remove(o, do_unlink=True)

# the board faces +X in the source; turn it to face -Y (glTF +Z, toward the camera),
# centre it on the origin with its bottom edge at z=0
bpy.context.view_layer.update()
b = bpy.data.objects["Cube.099__0"]
centre = b.matrix_world.translation.copy()
rot = mathutils.Matrix.Rotation(-1.5707963, 4, "Z")
for o in bpy.data.objects:
    o.matrix_world = rot @ mathutils.Matrix.Translation(-centre) @ o.matrix_world
bpy.context.view_layer.update()
for o in bpy.data.objects:
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
for name, new in KEEP.items():
    bpy.data.objects[name].name = new

# the pin sits at the origin, pointing into the board (-Y)
pin = bpy.data.objects["Pin"]
pin.location = (0, 0, 0)
bpy.context.view_layer.update()
for o in bpy.data.objects:
    mn = mathutils.Vector((1e9,) * 3); mx = -mn
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
    print("OBJ", o.name, tuple(round(v, 4) for v in mn), tuple(round(v, 4) for v in mx))

# textures: 4K PNGs → 2K
for img in bpy.data.images:
    print("IMG", img.name, img.size[:])
    if img.size[0] > 2048:
        img.scale(2048, 2048)

# paper creases: crop the map's region out of the normal map
nrm = None
mat = board.active_material if board.name in bpy.data.objects else bpy.data.objects["Board"].active_material
for n in mat.node_tree.nodes:
    if n.type == "NORMAL_MAP":
        nrm = n.inputs["Color"].links[0].from_node.image
print("NORMAL", nrm and nrm.name)
import numpy as np
w, h = nrm.size
px = np.array(nrm.pixels[:], dtype=np.float32).reshape(h, w, 4)
x0, x1 = int(u0 * w), int(u1 * w)
y0, y1 = int(v0 * h), int(v1 * h)
crop = px[y0:y1, x0:x1].copy()
os.makedirs(os.path.dirname(PAPER), exist_ok=True)
out = bpy.data.images.new("paper", crop.shape[1], crop.shape[0], alpha=False)
out.pixels[:] = crop.ravel()
out.filepath_raw = PAPER
out.file_format = "PNG"
out.save()
print("PAPER", crop.shape)

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_image_format="WEBP",
    export_image_quality=82,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_yup=True,
)
print("WROTE", OUT, os.path.getsize(OUT))
