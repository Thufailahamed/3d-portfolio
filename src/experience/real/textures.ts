import * as THREE from "three";

/**
 * Tileable surface textures for the realistic pavilion, baked offline from procedural shaders
 * (scripts/real-textures) and shipped as WebP. Each kind has two maps covering one tile:
 *   A: albedo (stored as sqrt for precision in the darks) + height
 *   B: tangent-space normal (xy) + roughness + ambient occlusion
 * They are sampled triplanar in world space (the building model carries no UVs).
 */
export type TexKind =
  | "ashlar"
  | "stone"
  | "marble"
  | "nero"
  | "paving"
  | "grass"
  | "bronze"
  | "wood"
  | "foliage"
  | "plaster";

export const KINDS: TexKind[] = ["ashlar", "stone", "marble", "nero", "paving", "grass", "bronze", "wood", "foliage", "plaster"];

/** Metres covered by one tile of each kind (also used by the materials to scale the mapping). */
export const TILE: Record<TexKind, number> = {
  ashlar: 2.4,
  stone: 3.2,
  marble: 3.0,
  nero: 2.2,
  paving: 4.0,
  grass: 3.0,
  bronze: 1.2,
  wood: 1.6,
  foliage: 1.6,
  plaster: 3.0,
};

export type TexSet = { a: THREE.Texture; b: THREE.Texture; tile: number };

/**
 * Start loading every kind's maps. The textures can be handed to materials straight away; `ready`
 * resolves once all of them have arrived (and fails soft: a missing map just stays blank).
 */
export function loadTextures(gl: THREE.WebGLRenderer) {
  // a private manager: these stream in on demand and must not move the page's loading progress
  const loader = new THREE.TextureLoader(new THREE.LoadingManager());
  const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
  const pending: Promise<unknown>[] = [];
  const load = (url: string) => {
    const tex = new THREE.Texture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = anisotropy;
    tex.colorSpace = THREE.NoColorSpace; // data, not colour: the shader decodes it
    pending.push(
      loader
        .loadAsync(url)
        .then((loaded) => {
          tex.image = loaded.image;
          tex.needsUpdate = true;
        })
        .catch(() => undefined),
    );
    return tex;
  };
  const sets = {} as Record<TexKind, TexSet>;
  for (const kind of KINDS) {
    sets[kind] = { a: load(`/textures/real/${kind}-a.webp`), b: load(`/textures/real/${kind}-b.webp`), tile: TILE[kind] };
  }
  return { sets, ready: Promise.all(pending) };
}
