/**
 * Moment: Multiplayer Sumo. A ghost boat follows mine: it is what a server would see.
 * The player's boat is "predicted" locally; the ghost replays snapshots taken at 10 Hz and
 * shown 350 ms late, interpolated between ticks, like remote state in a networked game.
 * When scrolling stops, the ghost settles where the boat is: prediction confirmed.
 */
import * as THREE from 'three';
import type { SailState } from '../../wind/wind';
import type { Moment, MomentContext } from './types';

const TICK = 0.1; // snapshot interval, s
const DELAY = 0.35; // how far behind the ghost is shown, s
const OFFSET = 3.2; // to starboard, so the two boats don't overlap

interface Snapshot {
  t: number;
  s: number;
  sail: SailState;
}

export function create(ctx: MomentContext): Moment {
  const ghost = ctx.makeBoat();
  const material = new THREE.MeshLambertMaterial({
    color: '#cfeaff',
    emissive: '#3d6f96',
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  ghost.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.name === 'ContactShadow') m.visible = false;
    else m.material = material;
  });
  ghost.root.getObjectByName('Rigging')?.removeFromParent();
  ghost.root.visible = false;
  ghost.root.scale.setScalar(1.02);
  ctx.scene.add(ghost.root);

  // Debug: snapshot markers and the error line between server state and prediction.
  const debug = new THREE.Group();
  debug.visible = false;
  const dotMat = new THREE.MeshBasicMaterial({ color: '#cfeaff', depthTest: false, transparent: true, opacity: 0.9 });
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), dotMat, 12);
  dots.renderOrder = 11;
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#ff6b8a', depthTest: false }));
  line.renderOrder = 11;
  line.frustumCulled = false;
  debug.add(dots, line);
  ctx.scene.add(debug);

  const history: Snapshot[] = [];
  let lastTick = -Infinity;
  let error = 0;
  let debugOn = false;
  const m4 = new THREE.Matrix4();
  const sample = { x: 0, z: 0, tx: 0, tz: -1 };

  const place = (s: number) => {
    const p = ctx.route.sample(s, sample);
    return { x: p.x - p.tz * OFFSET, z: p.z + p.tx * OFFSET, fx: p.tx, fz: p.tz };
  };

  return {
    warmup: [ghost.root, debug],
    update(frame, weight, dt) {
      const t = frame.time;
      if (t - lastTick >= TICK) {
        history.push({ t, s: frame.s, sail: { ...frame.wind.sail } });
        lastTick = t;
        while (history.length > 30) history.shift();
      }
      ghost.root.visible = weight > 0.01 && history.length > 1;
      debug.visible = debugOn && ghost.root.visible;
      if (!ghost.root.visible) return;
      material.opacity = 0.5 * weight;

      // Interpolate between the two snapshots around the render time.
      const rt = t - DELAY;
      let a = history[0];
      let b = history[history.length - 1];
      for (let i = history.length - 1; i > 0; i--) {
        if (history[i - 1].t <= rt) {
          a = history[i - 1];
          b = history[i];
          break;
        }
      }
      const k = b.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t))) : 1;
      const s = a.s + (b.s - a.s) * k;
      const g = place(s);
      ghost.update(g.x, g.z, g.fx, g.fz, k < 0.5 ? a.sail : b.sail, t, dt);
      error = Math.abs(frame.s - s);

      if (debug.visible) {
        const me = place(frame.s);
        const pos = lineGeo.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, g.x, 1.2, g.z);
        pos.setXYZ(1, me.x, 1.2, me.z);
        pos.needsUpdate = true;
        let n = 0;
        for (let i = Math.max(0, history.length - 12); i < history.length; i++) {
          const p = place(history[i].s);
          m4.makeTranslation(p.x, 0.6, p.z);
          dots.setMatrixAt(n++, m4);
        }
        dots.count = n;
        dots.instanceMatrix.needsUpdate = true;
      }
    },
    setDebug(on) {
      debugOn = on;
    },
    debugInfo: () => `server ${Math.round(DELAY * 1000)} ms behind @ ${Math.round(1 / TICK)} Hz · error ${error.toFixed(1)} m`,
    dispose() {
      ctx.scene.remove(ghost.root, debug);
      ghost.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      material.dispose();
      dotMat.dispose();
      dots.dispose();
      lineGeo.dispose();
    },
  };
}
