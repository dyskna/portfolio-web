/**
 * The boat's route across the lake, from the pier by the cabin to the harbour.
 * A Catmull-Rom curve through hand-placed points, re-parameterised by arc length,
 * so "distance along the route" maps linearly to scroll position.
 *
 * World axes: x to the right, z toward the viewer at the start (the boat sails toward -z).
 */
import type { Vec2 } from '../wind/wind';

/** Control points (x, z). The first is the berth at the pier, the last is the harbour berth. */
export const ROUTE_POINTS: Vec2[] = [
  { x: 3, z: 10 },
  { x: 6, z: -12 },
  { x: 18, z: -45 },
  { x: 14, z: -85 },
  { x: -8, z: -120 },
  { x: -20, z: -158 },
  { x: -6, z: -196 },
  { x: 18, z: -228 },
  { x: 16, z: -264 },
  { x: 5, z: -292 },
  { x: 2, z: -312 },
];

export interface RouteSample {
  x: number;
  z: number;
  /** Unit tangent (direction of travel). */
  tx: number;
  tz: number;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export class Route {
  readonly length: number;
  private readonly lut: { s: number; x: number; z: number }[] = [];

  constructor(points: Vec2[] = ROUTE_POINTS, samplesPerSegment = 80) {
    const n = points.length;
    let s = 0;
    let prev: Vec2 | null = null;
    for (let i = 0; i < n - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(n - 1, i + 2)];
      for (let k = 0; k < samplesPerSegment; k++) {
        if (i > 0 && k === 0) continue;
        const t = k / samplesPerSegment;
        const p = { x: catmullRom(p0.x, p1.x, p2.x, p3.x, t), z: catmullRom(p0.z, p1.z, p2.z, p3.z, t) };
        if (prev) s += Math.hypot(p.x - prev.x, p.z - prev.z);
        this.lut.push({ s, ...p });
        prev = p;
      }
    }
    const last = points[n - 1];
    s += Math.hypot(last.x - prev!.x, last.z - prev!.z);
    this.lut.push({ s, x: last.x, z: last.z });
    this.length = s;
  }

  /** Position and direction at distance s (metres) along the route; clamped to the ends. */
  sample(s: number, out: RouteSample = { x: 0, z: 0, tx: 0, tz: -1 }): RouteSample {
    const lut = this.lut;
    const d = Math.min(this.length, Math.max(0, s));
    // Binary search for the segment containing d.
    let lo = 0;
    let hi = lut.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lut[mid].s <= d) lo = mid;
      else hi = mid;
    }
    const a = lut[lo];
    const b = lut[hi];
    const seg = b.s - a.s || 1;
    const k = (d - a.s) / seg;
    out.x = a.x + (b.x - a.x) * k;
    out.z = a.z + (b.z - a.z) * k;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    out.tx = (b.x - a.x) / len;
    out.tz = (b.z - a.z) / len;
    return out;
  }

  /** Points every `step` metres, for building the lake shoreline and debug lines. */
  polyline(step = 2): Vec2[] {
    const pts: Vec2[] = [];
    for (let s = 0; s <= this.length; s += step) {
      const p = this.sample(s);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  }
}
