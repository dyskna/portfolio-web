/**
 * The voyage: maps the native scroll position to where the boat should be on the route.
 *
 * Each chapter of the page is a stop on the lake. While a chapter holds on screen (its sticky
 * stage), the boat drifts a few metres around its stop; between chapters it sails to the next
 * stop. Scroll is still the wind: the boat's speed comes from how fast you move between keys.
 *
 * Pure functions (no DOM), so they run under `node --test`.
 */

export interface Stop {
  /** Scroll position (px) where the chapter's hold begins and ends. */
  holdStart: number;
  holdEnd: number;
  /** Route distance (m) of the stop. */
  s: number;
}

export interface VoyageKey {
  y: number;
  s: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keyframes (scroll px → route m): drift through each hold, sail between holds. */
export function buildKeys(stops: Stop[], drift: number, routeLength: number): VoyageKey[] {
  const sorted = [...stops].sort((a, b) => a.holdStart - b.holdStart);
  const keys: VoyageKey[] = [];
  for (const stop of sorted) {
    const start = { y: stop.holdStart, s: clamp(stop.s - drift, 0, routeLength) };
    const end = { y: Math.max(stop.holdEnd, stop.holdStart + 1), s: clamp(stop.s + drift, 0, routeLength) };
    // Keep keys strictly increasing in both scroll and distance.
    const last = keys[keys.length - 1];
    if (last && start.y <= last.y) start.y = last.y + 1;
    if (last && start.s < last.s) start.s = last.s;
    if (end.y <= start.y) end.y = start.y + 1;
    if (end.s < start.s) end.s = start.s;
    keys.push(start, end);
  }
  return keys;
}

/** Route distance the boat should be at for a scroll position. */
export function targetS(keys: VoyageKey[], y: number): number {
  if (!keys.length) return 0;
  if (y <= keys[0].y) return keys[0].s;
  const last = keys[keys.length - 1];
  if (y >= last.y) return last.s;
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].y <= y) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  return a.s + (b.s - a.s) * ((y - a.y) / (b.y - a.y));
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface Follower {
  value: number;
  velocity: number;
}

/**
 * Ease a value toward its target over time with a critically damped spring (exact solution, so
 * it is stable for any frame time). A jump in the target, such as one mouse-wheel notch through
 * a chapter's ramp, becomes a smooth glide instead of a step. rate (1/s): higher follows tighter.
 */
export function follow(f: Follower, target: number, dt: number, rate: number): void {
  const x = f.value - target;
  const k = f.velocity + rate * x;
  const e = Math.exp(-rate * dt);
  f.value = target + (x + k * dt) * e;
  f.velocity = (f.velocity - rate * k * dt) * e;
}

/** How "on stage" a chapter is: 0 while sailing, 1 during its hold, eased over `ramp` px. */
export function stageWeight(stop: Stop, y: number, ramp: number): number {
  if (y < stop.holdStart) return smoothstep(stop.holdStart - ramp, stop.holdStart, y);
  if (y > stop.holdEnd) return 1 - smoothstep(stop.holdEnd, stop.holdEnd + ramp, y);
  return 1;
}
