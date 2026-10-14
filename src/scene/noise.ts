/** Small seeded 2D value noise + fBm, enough for low-poly terrain. */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Value noise in [0, 1]. */
export function noise2(x: number, z: number, seed = 1): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Fractal noise in roughly [0, 1]. */
export function fbm(x: number, z: number, octaves = 4, seed = 1): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x, z, seed + i * 17) * amp;
    norm += amp;
    x *= 2.03;
    z *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Ridged fractal noise in [0, 1]: sharp crests, good for mountain ranges. */
export function ridged(x: number, z: number, octaves = 4, seed = 1): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x, z, seed + i * 31) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    x *= 2.1;
    z *= 2.1;
    amp *= 0.5;
  }
  return sum / norm;
}
