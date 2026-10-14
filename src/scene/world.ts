/**
 * Shared world layout: lake shape, terrain heights, wave function.
 * The lake follows the boat's route, so moving the route points reshapes the lake with it.
 */
import type { Vec2 } from '../wind/wind';
import type { Route } from '../sim/route';
import { fbm, ridged } from './noise';

export const WATER_LEVEL = 0;

/** Where the cabin stands and where the harbour quay is. The boat berths are the route ends. */
export const CABIN_SITE: Vec2 = { x: -19, z: 5 };
export const HARBOUR_SITE: Vec2 = { x: 4, z: -352 };

export const TERRAIN_BOUNDS = { minX: -300, maxX: 300, minZ: -560, maxZ: 160 };

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Waves: the same function runs in JS (boat bobbing) and GLSL (water surface).
// ---------------------------------------------------------------------------

export function waveHeight(x: number, z: number, t: number): number {
  return (
    0.12 * Math.sin(x * 0.21 + z * 0.07 + t * 0.9) +
    0.09 * Math.sin(-x * 0.09 + z * 0.23 + t * 1.15 + 1.3) +
    0.05 * Math.sin(x * 0.31 - z * 0.27 + t * 1.7 + 2.1)
  );
}

export const WAVE_GLSL = /* glsl */ `
float waveHeight(vec2 p, float t) {
  return 0.12 * sin(p.x * 0.21 + p.y * 0.07 + t * 0.9)
       + 0.09 * sin(-p.x * 0.09 + p.y * 0.23 + t * 1.15 + 1.3)
       + 0.05 * sin(p.x * 0.31 - p.y * 0.27 + t * 1.7 + 2.1);
}
`;

// ---------------------------------------------------------------------------
// Lake shape and terrain heights
// ---------------------------------------------------------------------------

/** Half-width of the lake around the route at distance s: narrow at the pier and harbour. */
function makeHalfWidth(length: number): (s: number) => number {
  return (s: number) => {
    const open = smoothstep(0, 90, s);
    const close = smoothstep(length - 80, length, s);
    let w = 18 + (74 - 18) * open;
    w += (30 - w) * close;
    w += (fbm(s * 0.018, 3.7, 3, 5) - 0.5) * 40 * open * (1 - close);
    return w;
  };
}

export class HeightField {
  readonly nx: number;
  readonly nz: number;
  readonly heights: Float32Array;
  readonly dx: number;
  readonly dz: number;
  readonly bounds = TERRAIN_BOUNDS;

  constructor(route: Route, segmentsX: number, segmentsZ: number) {
    this.nx = segmentsX + 1;
    this.nz = segmentsZ + 1;
    const b = this.bounds;
    this.dx = (b.maxX - b.minX) / segmentsX;
    this.dz = (b.maxZ - b.minZ) / segmentsZ;
    this.heights = new Float32Array(this.nx * this.nz);

    const poly = route.polyline(3);
    const cum: number[] = [0];
    for (let i = 1; i < poly.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].z - poly[i - 1].z));
    }
    const halfWidth = makeHalfWidth(route.length);

    for (let j = 0; j < this.nz; j++) {
      const z = b.minZ + j * this.dz;
      for (let i = 0; i < this.nx; i++) {
        const x = b.minX + i * this.dx;
        this.heights[j * this.nx + i] = terrainHeight(x, z, poly, cum, halfWidth);
      }
    }
  }

  /** Bilinear height lookup. */
  height(x: number, z: number): number {
    const b = this.bounds;
    const fx = Math.min(this.nx - 1.001, Math.max(0, (x - b.minX) / this.dx));
    const fz = Math.min(this.nz - 1.001, Math.max(0, (z - b.minZ) / this.dz));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h = this.heights;
    const n = this.nx;
    const a = h[j * n + i];
    const c = h[j * n + i + 1];
    const d = h[(j + 1) * n + i];
    const e = h[(j + 1) * n + i + 1];
    return (a * (1 - tx) + c * tx) * (1 - tz) + (d * (1 - tx) + e * tx) * tz;
  }

  /** Slope magnitude (rise over run) from central differences. */
  slope(x: number, z: number): number {
    const e = 1.5;
    const gx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const gz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return Math.hypot(gx, gz);
  }
}

/** Distance from (x, z) to the route polyline, and the route distance s of the closest point. */
function nearestOnRoute(x: number, z: number, poly: Vec2[], cum: number[]): { d: number; s: number } {
  let best = Infinity;
  let bestS = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1;
    const t = Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / len2));
    const px = a.x + abx * t - x;
    const pz = a.z + abz * t - z;
    const d2 = px * px + pz * pz;
    if (d2 < best) {
      best = d2;
      bestS = cum[i] + (cum[i + 1] - cum[i]) * t;
    }
  }
  return { d: Math.sqrt(best), s: bestS };
}

function siteMask(x: number, z: number, site: Vec2, inner: number, outer: number): number {
  return 1 - smoothstep(inner, outer, Math.hypot(x - site.x, z - site.z));
}

function terrainHeight(
  x: number,
  z: number,
  poly: Vec2[],
  cum: number[],
  halfWidth: (s: number) => number,
): number {
  const { d, s } = nearestOnRoute(x, z, poly, cum);
  const cabin = siteMask(x, z, CABIN_SITE, 9, 22);
  const harbour = siteMask(x, z, HARBOUR_SITE, 20, 40);
  const calm = Math.max(cabin, harbour);

  // Signed distance to the shore: negative in the lake. Noise carves bays and points.
  const shoreNoise = (fbm(x * 0.028, z * 0.028, 3, 11) - 0.5) * 22 * (1 - calm);
  const sd = d - halfWidth(s) + shoreNoise;

  let h: number;
  if (sd < 0) {
    h = Math.max(-8, sd * 0.4);
  } else {
    const beach = Math.min(sd, 6) * 0.12;
    const hills = smoothstep(4, 80, sd) * (0.3 + fbm(x * 0.014, z * 0.014, 4, 3)) * 20;
    const mountains = smoothstep(90, 320, sd) * ridged(x * 0.006, z * 0.006, 3, 9) * 105;
    // A low valley beyond the harbour, so the sunset sky shows behind it.
    const valley = smoothstep(-340, -440, z) * (1 - smoothstep(50, 170, Math.abs(x - HARBOUR_SITE.x)));
    h = beach + (hills * (1 - calm * 0.85) + mountains) * (1 - 0.8 * valley);
  }

  // Flat ground for the cabin and the harbour quay.
  if (cabin > 0) h += (1.3 - h) * cabin * (sd > -2 ? 1 : 0);
  if (harbour > 0 && sd > -1) h += (1.1 - h) * harbour;
  return h;
}
