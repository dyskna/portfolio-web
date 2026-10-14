/**
 * Moment: BSc thesis. A tiny boat steered by a simple scripted agent sails alongside.
 * Like an ML-Agents setup it has observations (where its slot beside my boat is, three ray
 * sensors against the shore), a policy, and two continuous actions (steer, throttle).
 * Here the policy is a hand-written controller instead of a trained PPO network.
 * Its sail runs on the same apparent-wind model as my boat.
 */
import * as THREE from 'three';
import { SPEED_SCALE } from '../../sim/boatSim';
import { trimSail, trueWindAt, windFromMotion, apparentWind } from '../../wind/wind';
import type { Moment, MomentContext } from './types';

const SLOT_SIDE = -8; // metres to starboard of my boat (negative: to port, clear of the map label)
const SLOT_AHEAD = 4;
const RAY_ANGLES = [-0.6, 0, 0.6];
const RAY_LENGTH = 16;
const MAX_TURN = 1.4; // rad/s

export function create(ctx: MomentContext): Moment {
  const agent = ctx.makeBoat();
  agent.root.scale.setScalar(0.65);
  // Own materials so it can fade in and out.
  const fading: THREE.Material[] = [];
  agent.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.Material).clone();
    mat.transparent = true;
    m.material = mat;
    fading.push(mat);
  });
  // A yellow sail tells it apart from mine.
  ((agent.root.getObjectByName('Sail') as THREE.Mesh).material as THREE.MeshLambertMaterial).color.set('#ffd36b');
  agent.root.visible = false;
  ctx.scene.add(agent.root);

  // Debug: ray sensors and the goal slot.
  const debug = new THREE.Group();
  debug.visible = false;
  const rayGeo = new THREE.BufferGeometry();
  rayGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(RAY_ANGLES.length * 6), 3));
  rayGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(RAY_ANGLES.length * 6), 3));
  const rays = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
  rays.frustumCulled = false;
  rays.renderOrder = 11;
  const goal = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.7, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffd36b', depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  goal.renderOrder = 11;
  debug.add(rays, goal);
  ctx.scene.add(debug);

  const state = { x: 0, z: 0, heading: 0, speed: 0, alive: false };
  const obs = { goalSide: 0, goalAhead: 0, rays: RAY_ANGLES.map(() => 1) };
  const act = { steer: 0, throttle: 0 };
  let debugOn = false;
  const green = new THREE.Color('#7dffb2');
  const red = new THREE.Color('#ff6b6b');

  /** Fraction (0..1) of the ray that is clear water. */
  const castRay = (angle: number): number => {
    const a = state.heading + angle;
    const dx = Math.sin(a);
    const dz = -Math.cos(a);
    for (let d = 1; d <= RAY_LENGTH; d += 1) {
      if (ctx.field.height(state.x + dx * d, state.z + dz * d) > -0.2) return d / RAY_LENGTH;
    }
    return 1;
  };

  return {
    warmup: [agent.root, debug],

    update(frame, weight, dt) {
      const visible = weight > 0.02;
      if (!visible) {
        agent.root.visible = false;
        debug.visible = false;
        state.alive = false;
        return;
      }
      const fx = frame.forward.x;
      const fz = frame.forward.z;
      // Slot beside my boat, drifting a little so the agent always has something to correct.
      const wobble = Math.sin(frame.time * 0.6) * 1.2;
      const gx = frame.position.x - fz * (SLOT_SIDE + wobble) + fx * SLOT_AHEAD;
      const gz = frame.position.z + fx * (SLOT_SIDE + wobble) + fz * SLOT_AHEAD;

      if (!state.alive || Math.hypot(gx - state.x, gz - state.z) > 45) {
        // Spawn behind the slot, already heading the same way.
        state.x = gx - fx * 12;
        state.z = gz - fz * 12;
        state.heading = Math.atan2(fx, -fz);
        state.speed = Math.abs(frame.routeSpeed);
        state.alive = true;
      }

      // --- Observations (agent's own frame) ---
      const hx = Math.sin(state.heading);
      const hz = -Math.cos(state.heading);
      const rx = -hz;
      const rz = hx;
      const dx = gx - state.x;
      const dz = gz - state.z;
      obs.goalAhead = dx * hx + dz * hz;
      obs.goalSide = dx * rx + dz * rz;
      for (let i = 0; i < RAY_ANGLES.length; i++) obs.rays[i] = castRay(RAY_ANGLES[i]);

      // --- Policy: head for the slot; once there, line up with my boat and match its speed ---
      const dist = Math.hypot(dx, dz);
      const close = 1 - Math.min(1, Math.max(0, (dist - 1.5) / 5));
      const towardGoal = Math.atan2(obs.goalSide, obs.goalAhead);
      let align = Math.atan2(fx, -fz) - state.heading;
      align = Math.atan2(Math.sin(align), Math.cos(align));
      // Turn away from the side whose ray hits first; if blocked ahead, toward the clearer side.
      const avoid = (obs.rays[2] - obs.rays[0]) * 1.6 + (1 - obs.rays[1]) * (obs.rays[0] >= obs.rays[2] ? -1 : 1) * 1.2;
      const steer = (1 - close) * towardGoal * 1.6 + close * (align * 2 + obs.goalSide * 0.2) + avoid;
      act.steer = Math.max(-1, Math.min(1, steer / MAX_TURN));
      const mySpeed = Math.max(0, frame.routeSpeed * (fx * hx + fz * hz));
      const catchUp = Math.min(8, dist * 0.9) * (obs.goalAhead >= 0 ? 1 : 0.35);
      const desired = mySpeed * (0.9 + 0.1 * close) + catchUp * (1 - close * 0.7);
      act.throttle = Math.max(-1, Math.min(1, (desired - state.speed) / 6));

      // --- Simple boat physics ---
      state.speed = Math.max(0, state.speed + act.throttle * 30 * dt);
      state.heading += act.steer * MAX_TURN * dt * Math.min(1, 0.45 + state.speed / 4);
      state.x += Math.sin(state.heading) * state.speed * dt;
      state.z += -Math.cos(state.heading) * state.speed * dt;

      // Same wind model as my boat, with its own motion.
      const fwd = { x: Math.sin(state.heading), z: -Math.cos(state.heading) };
      const v = state.speed * SPEED_SCALE;
      const apparent = apparentWind(trueWindAt(frame.time), windFromMotion({ x: fwd.x * v, z: fwd.z * v }));
      agent.update(state.x, state.z, fwd.x, fwd.z, trimSail(apparent, fwd), frame.time, dt);
      agent.root.visible = true;
      for (const m of fading) m.opacity = weight;

      debug.visible = debugOn;
      if (debugOn) {
        const pos = rayGeo.attributes.position as THREE.BufferAttribute;
        const col = rayGeo.attributes.color as THREE.BufferAttribute;
        RAY_ANGLES.forEach((angle, i) => {
          const a = state.heading + angle;
          const len = obs.rays[i] * RAY_LENGTH;
          pos.setXYZ(i * 2, state.x, 0.8, state.z);
          pos.setXYZ(i * 2 + 1, state.x + Math.sin(a) * len, 0.8, state.z - Math.cos(a) * len);
          const c = obs.rays[i] < 1 ? red : green;
          col.setXYZ(i * 2, c.r, c.g, c.b);
          col.setXYZ(i * 2 + 1, c.r, c.g, c.b);
        });
        pos.needsUpdate = true;
        col.needsUpdate = true;
        goal.position.set(gx, 0.5, gz);
      }
    },

    setDebug(on) {
      debugOn = on;
    },

    debugInfo: () =>
      `agent obs [${obs.goalSide.toFixed(1)}, ${obs.goalAhead.toFixed(1)}, ${obs.rays.map((r) => r.toFixed(1)).join(' ')}] → steer ${act.steer.toFixed(2)}, throttle ${act.throttle.toFixed(2)}`,

    dispose() {
      ctx.scene.remove(agent.root, debug);
      agent.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      fading.forEach((m) => m.dispose());
      rayGeo.dispose();
    },
  };
}
