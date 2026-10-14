/**
 * Apparent-wind model: a small port of the one in my Unreal Engine 5 sailing prototype.
 *
 *   apparent wind = true wind + wind from the boat's motion
 *
 * - True wind: a slowly drifting vector (strength and direction change over tens of seconds).
 * - Wind from motion: the headwind the boat creates by moving, equal to minus its velocity.
 *   On this page the boat's velocity comes from scroll speed.
 * - The sail trims to the apparent wind: the boom swings to the leeward side, and the sail fills
 *   when the apparent wind is strong enough and not from dead ahead. Otherwise it luffs (flaps).
 *
 * Conventions
 * - Vectors live in the horizontal plane as { x, z } (Three.js world axes, y is up).
 * - A wind vector points the way the air moves ("blowing toward"), in m/s.
 * - The boat's forward direction is a unit vector; starboard (right) is (-forward.z, forward.x).
 * - AWA (apparent wind angle) is where the wind comes FROM, relative to the bow, in radians:
 *   0 = dead ahead, +π/2 = from starboard, -π/2 = from port, ±π = from astern.
 * - Boom angle is relative to the centreline: positive = boom out to starboard.
 *
 * Pure functions only (no Three.js, no DOM), so it runs under `node --test`.
 */

export interface Vec2 {
  x: number;
  z: number;
}

export const vec = (x: number, z: number): Vec2 => ({ x, z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, z: a.z * k });
export const length = (a: Vec2): number => Math.hypot(a.x, a.z);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// True wind
// ---------------------------------------------------------------------------

export interface TrueWindParams {
  /** Mean strength in m/s. */
  baseSpeed: number;
  /** Max deviation from the mean strength, m/s. */
  speedVariation: number;
  /** Mean direction the wind blows toward, radians, measured from +x toward +z. */
  baseDirection: number;
  /** Max deviation from the mean direction, radians. */
  directionVariation: number;
  /** Changes the phase of the drift so different seeds give different weather. */
  seed: number;
}

export const DEFAULT_TRUE_WIND: TrueWindParams = {
  baseSpeed: 2.6,
  speedVariation: 0.9,
  // Blows toward +x: across the route, from the boat's port beam. Motion then adds to it
  // and swings the apparent wind forward, as it does on a real boat reaching across the lake.
  baseDirection: 0.1,
  directionVariation: 0.3,
  seed: 7,
};

/** Fractional part of a hash of the seed: deterministic phases in [0, 2π). */
function phase(seed: number, k: number): number {
  const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * Math.PI * 2;
}

// Periods in seconds; incommensurate so the pattern never visibly repeats.
const SPEED_PERIODS = [41, 17.3];
const DIR_PERIODS = [67, 29.7];

/** Normalised drift in [-1, 1]: a weighted sum of two slow sines. */
function drift(t: number, periods: number[], seed: number, offset: number): number {
  const a = Math.sin((t / periods[0]) * Math.PI * 2 + phase(seed, offset));
  const b = Math.sin((t / periods[1]) * Math.PI * 2 + phase(seed, offset + 1));
  return 0.65 * a + 0.35 * b;
}

/** True wind at time t (seconds). Smooth and deterministic. */
export function trueWindAt(t: number, p: TrueWindParams = DEFAULT_TRUE_WIND): Vec2 {
  const speed = Math.max(0, p.baseSpeed + p.speedVariation * drift(t, SPEED_PERIODS, p.seed, 0));
  const dir = p.baseDirection + p.directionVariation * drift(t, DIR_PERIODS, p.seed, 2);
  return { x: Math.cos(dir) * speed, z: Math.sin(dir) * speed };
}

// ---------------------------------------------------------------------------
// Wind from motion and apparent wind
// ---------------------------------------------------------------------------

/** The headwind created by moving: equal and opposite to the boat's velocity. */
export function windFromMotion(boatVelocity: Vec2): Vec2 {
  return { x: -boatVelocity.x, z: -boatVelocity.z };
}

export function apparentWind(trueWind: Vec2, motionWind: Vec2): Vec2 {
  return add(trueWind, motionWind);
}

/** Apparent wind angle (where the wind comes from, relative to the bow). See conventions above. */
export function apparentWindAngle(apparent: Vec2, forward: Vec2): number {
  const from = { x: -apparent.x, z: -apparent.z };
  const starboard = { x: -forward.z, z: forward.x };
  return Math.atan2(dot(from, starboard), dot(from, forward));
}

// ---------------------------------------------------------------------------
// Sail
// ---------------------------------------------------------------------------

export interface SailParams {
  /** Below this apparent wind speed the sail carries no load (m/s). */
  minLoadSpeed: number;
  /** At or above this apparent wind speed the sail is fully loaded (m/s). */
  fullLoadSpeed: number;
  /** |AWA| below which the boat is head to wind ("in irons") and the sail cannot fill. */
  noGoAngle: number;
  /** |AWA| above which the angle no longer limits the sail. */
  closeHauledAngle: number;
  /** Closest the boom is sheeted to the centreline (radians). */
  minBoom: number;
  /** Furthest the boom can swing out (radians). */
  maxBoom: number;
}

export const DEFAULT_SAIL: SailParams = {
  minLoadSpeed: 3.0,
  fullLoadSpeed: 6.0,
  noGoAngle: 0.17, // ~10°
  closeHauledAngle: 0.38, // ~22°
  minBoom: 0.1,
  maxBoom: 1.35, // ~77°
};

export interface SailState {
  /** Apparent wind angle, radians. */
  awa: number;
  /** Apparent wind speed, m/s. */
  aws: number;
  /** Boom angle from the centreline, radians, positive to starboard (leeward side). */
  boomAngle: number;
  /** 0 = slack, 1 = full and drawing. */
  fullness: number;
  /** How much the sail flaps, 0..1: high when slack in a breeze, zero in a dead calm. */
  flap: number;
}

/**
 * Trim the sail to the apparent wind.
 * The boom eases out to roughly half the apparent wind angle, on the side away from the wind.
 */
export function trimSail(apparent: Vec2, forward: Vec2, p: SailParams = DEFAULT_SAIL): SailState {
  const aws = length(apparent);
  const awa = apparentWindAngle(apparent, forward);
  const absAwa = Math.abs(awa);

  // Wind from starboard (awa > 0) pushes the boom to port (negative), and vice versa.
  const leeward = awa >= 0 ? -1 : 1;
  const boomAngle = leeward * clamp(absAwa / 2, p.minBoom, p.maxBoom);

  const load = smoothstep(p.minLoadSpeed, p.fullLoadSpeed, aws);
  const angleFactor = smoothstep(p.noGoAngle, p.closeHauledAngle, absAwa);
  const fullness = load * angleFactor;

  // A slack sail flaps; how hard depends on how much wind there is to shake it.
  const flap = (1 - fullness) * clamp(aws / p.fullLoadSpeed, 0, 1);

  return { awa, aws, boomAngle, fullness, flap };
}

// ---------------------------------------------------------------------------
// One step of the whole model
// ---------------------------------------------------------------------------

export interface WindSample {
  trueWind: Vec2;
  motionWind: Vec2;
  apparent: Vec2;
  sail: SailState;
}

export function sampleWind(
  t: number,
  boatVelocity: Vec2,
  forward: Vec2,
  trueParams: TrueWindParams = DEFAULT_TRUE_WIND,
  sailParams: SailParams = DEFAULT_SAIL,
): WindSample {
  const trueWind = trueWindAt(t, trueParams);
  const motionWind = windFromMotion(boatVelocity);
  const apparent = apparentWind(trueWind, motionWind);
  return { trueWind, motionWind, apparent, sail: trimSail(apparent, forward, sailParams) };
}

/** Compass bearing the wind comes from, degrees 0..360, with -z as north and +x as east. */
export function bearingFrom(wind: Vec2): number {
  const from = { x: -wind.x, z: -wind.z };
  const deg = (Math.atan2(from.x, -from.z) * 180) / Math.PI;
  return (deg + 360) % 360;
}
