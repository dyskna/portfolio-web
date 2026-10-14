/**
 * Turns scroll position into boat motion and runs the wind model each frame.
 * The scene reads this; nothing here writes to the scroll position.
 */
import { sampleWind, type Vec2, type WindSample } from '../wind/wind';
import type { Route, RouteSample } from './route';

/**
 * The lake is compressed: one page scroll covers the whole route (~330 m).
 * For the wind model the boat's route speed is scaled down so that a calm reading pace
 * is a few metres per second, like a small dinghy, and a fast flick tops out at MAX_MODEL_SPEED.
 */
export const SPEED_SCALE = 0.16;
export const MAX_MODEL_SPEED = 7;
/** Hard cap on how fast the boat may chase the scroll position, in route metres per second. */
const MAX_ROUTE_SPEED = 110;
/** Spring stiffness (1/s) of the boat following the scroll target; higher = tighter. */
const FOLLOW = 3.2;

export interface SimFrame {
  time: number;
  dt: number;
  /** Where the voyage wants the boat, as a fraction of the route (0..1). */
  progress: number;
  /** Smoothed scroll velocity in CSS px/s (positive = scrolling down). */
  scrollVelocity: number;
  /** Boat position along the route in metres, and its fraction of the route. */
  s: number;
  routeProgress: number;
  /** Route speed in m/s (signed; negative when scrolling back up). */
  routeSpeed: number;
  /** Boat speed used by the wind model, m/s (signed). */
  modelSpeed: number;
  position: Vec2;
  /** Unit vector the bow points along (the route tangent). */
  forward: Vec2;
  /** Boat velocity in the wind model, m/s. */
  velocity: Vec2;
  wind: WindSample;
}

export class BoatSim {
  readonly frame: SimFrame;
  private lastScrollY = 0;
  private hasScroll = false;
  private sample: RouteSample = { x: 0, z: 0, tx: 0, tz: -1 };

  readonly route: Route;

  constructor(route: Route, startProgress = 0) {
    this.route = route;
    const s = startProgress * route.length;
    const p = route.sample(s);
    const fwd = { x: p.tx, z: p.tz };
    this.frame = {
      time: 0,
      dt: 0,
      progress: startProgress,
      scrollVelocity: 0,
      s,
      routeProgress: startProgress,
      routeSpeed: 0,
      modelSpeed: 0,
      position: { x: p.x, z: p.z },
      forward: fwd,
      velocity: { x: 0, z: 0 },
      wind: sampleWind(0, { x: 0, z: 0 }, fwd),
    };
  }

  /** Jump straight to a route distance (first frame, or after a big layout change). */
  snap(s: number): void {
    const f = this.frame;
    f.s = Math.min(this.route.length, Math.max(0, s));
    f.progress = f.s / this.route.length;
    f.routeSpeed = 0;
  }

  /** scrollY: native scroll position (for scroll speed); target: route distance (m) from the voyage. */
  update(dt: number, scrollY: number, target: number): SimFrame {
    const f = this.frame;
    dt = Math.min(dt, 0.1); // after a stall, don't integrate a huge step
    f.dt = dt;
    f.time += dt;

    // Scroll velocity (px/s), smoothed so a single uneven frame doesn't spike the wind.
    if (!this.hasScroll) {
      this.lastScrollY = scrollY;
      this.hasScroll = true;
    }
    const rawVel = dt > 0 ? (scrollY - this.lastScrollY) / dt : 0;
    this.lastScrollY = scrollY;
    f.scrollVelocity += (rawVel - f.scrollVelocity) * (1 - Math.exp(-dt * 10));

    target = Math.min(this.route.length, Math.max(0, target));
    f.progress = target / this.route.length;

    // Critically damped spring: the boat chases the scroll target and settles without overshoot.
    const x = f.s - target;
    const accel = -FOLLOW * FOLLOW * x - 2 * FOLLOW * f.routeSpeed;
    f.routeSpeed += accel * dt;
    f.routeSpeed = Math.max(-MAX_ROUTE_SPEED, Math.min(MAX_ROUTE_SPEED, f.routeSpeed));
    f.s += f.routeSpeed * dt;
    if (f.s < 0 || f.s > this.route.length) {
      f.s = Math.min(this.route.length, Math.max(0, f.s));
      f.routeSpeed = 0;
    }
    f.routeProgress = f.s / this.route.length;

    const p = this.route.sample(f.s, this.sample);
    f.position.x = p.x;
    f.position.z = p.z;
    f.forward.x = p.tx;
    f.forward.z = p.tz;

    f.modelSpeed = Math.max(-MAX_MODEL_SPEED, Math.min(MAX_MODEL_SPEED, f.routeSpeed * SPEED_SCALE));
    f.velocity.x = p.tx * f.modelSpeed;
    f.velocity.z = p.tz * f.modelSpeed;

    f.wind = sampleWind(f.time, f.velocity, f.forward);
    return f;
  }
}
