/**
 * Debug view, programmer's side: the three wind vectors drawn as a vector sum above the boat
 * (true wind, then wind from motion added tip-to-tail, and the apparent wind as the result),
 * the route with moment anchors, and a wireframe pass over the whole scene.
 */
import * as THREE from 'three';
import type { SimFrame } from '../sim/boatSim';
import type { Route } from '../sim/route';

export const VECTOR_COLORS = {
  true: '#5fb4ff',
  motion: '#ffab4a',
  apparent: '#7dffb2',
};

/** Metres of arrow per m/s of wind. */
const ARROW_SCALE = 1.5;
const ARROW_HEIGHT = 0.7;

class Arrow {
  readonly group = new THREE.Group();
  private readonly shaft: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private static readonly up = new THREE.Vector3(0, 1, 0);
  private readonly dir = new THREE.Vector3();
  private readonly headBase: number;

  constructor(color: string, radius: number) {
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95, fog: false });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 6).translate(0, 0.5, 0), mat);
    this.headBase = radius * 7;
    this.head = new THREE.Mesh(new THREE.ConeGeometry(radius * 3, radius * 7, 8).translate(0, radius * 3.5, 0), mat);
    this.group.add(this.shaft, this.head);
    this.group.renderOrder = 10;
    this.shaft.renderOrder = 10;
    this.head.renderOrder = 10;
  }

  /** Draw from `from` along vector (x, z) metres. */
  set(from: THREE.Vector3, x: number, z: number): void {
    const len = Math.hypot(x, z);
    this.group.visible = len > 0.05;
    if (!this.group.visible) return;
    const headLen = Math.min(len * 0.4, 1.1);
    this.group.position.copy(from);
    this.dir.set(x / len, 0, z / len);
    this.group.quaternion.setFromUnitVectors(Arrow.up, this.dir);
    this.shaft.scale.set(1, len - headLen, 1);
    this.head.position.y = len - headLen;
    this.head.scale.setScalar(headLen / (this.headBase));
  }
}

export class DebugOverlay {
  readonly group = new THREE.Group();
  readonly wireMaterial = new THREE.MeshBasicMaterial({
    color: '#dff6ff',
    wireframe: true,
    transparent: true,
    opacity: 0.22,
    fog: false,
    depthFunc: THREE.LessEqualDepth,
  });
  private readonly trueArrow = new Arrow(VECTOR_COLORS.true, 0.13);
  private readonly motionArrow = new Arrow(VECTOR_COLORS.motion, 0.13);
  private readonly apparentArrow = new Arrow(VECTOR_COLORS.apparent, 0.18);
  private readonly origin = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  private readonly anchorsGroup = new THREE.Group();
  /** Screen-space label anchors for the HUD, in world space. */
  readonly labelPoints = { true: new THREE.Vector3(), motion: new THREE.Vector3(), apparent: new THREE.Vector3() };

  constructor(private readonly route: Route) {
    this.group.name = 'DebugOverlay';
    this.group.visible = false;
    this.group.add(this.trueArrow.group, this.motionArrow.group, this.apparentArrow.group);

    // Route as a dashed line on the water.
    const pts = route.polyline(1.5).map((p) => new THREE.Vector3(p.x, 0.35, p.z));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 1.6, gapSize: 1.4, transparent: true, opacity: 0.7, fog: false }),
    );
    line.computeLineDistances();
    this.group.add(line, this.anchorsGroup);

    // Mast-top ring marking the boat's origin for the arrows.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    );
    ring.name = 'ArrowOrigin';
    ring.renderOrder = 10;
    this.group.add(ring);
  }

  /** Vertical markers where moments trigger, labelled by the HUD. */
  setAnchors(anchors: { id: string; s: number }[]): void {
    this.anchorsGroup.clear();
    const mat = new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, opacity: 0.8, fog: false });
    const geo = new THREE.CylinderGeometry(0.08, 0.08, 6, 5).translate(0, 3, 0);
    for (const a of anchors) {
      const p = this.route.sample(a.s);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, 0, p.z);
      m.name = `anchor:${a.id}`;
      this.anchorsGroup.add(m);
    }
  }

  update(f: SimFrame): void {
    if (!this.group.visible) return;
    const w = f.wind;
    this.origin.set(f.position.x, ARROW_HEIGHT, f.position.z);
    this.group.getObjectByName('ArrowOrigin')!.position.copy(this.origin);

    // True wind from the origin...
    this.trueArrow.set(this.origin, w.trueWind.x * ARROW_SCALE, w.trueWind.z * ARROW_SCALE);
    // ...wind from motion added at its tip...
    this.tip.set(this.origin.x + w.trueWind.x * ARROW_SCALE, ARROW_HEIGHT, this.origin.z + w.trueWind.z * ARROW_SCALE);
    this.motionArrow.set(this.tip, w.motionWind.x * ARROW_SCALE, w.motionWind.z * ARROW_SCALE);
    // ...and their sum, the apparent wind, from the origin.
    this.apparentArrow.set(this.origin, w.apparent.x * ARROW_SCALE, w.apparent.z * ARROW_SCALE);

    const lp = this.labelPoints;
    lp.true.set(this.origin.x + w.trueWind.x * ARROW_SCALE * 0.5, ARROW_HEIGHT + 0.4, this.origin.z + w.trueWind.z * ARROW_SCALE * 0.5);
    lp.motion.set(this.tip.x + w.motionWind.x * ARROW_SCALE * 0.5, ARROW_HEIGHT + 0.4, this.tip.z + w.motionWind.z * ARROW_SCALE * 0.5);
    lp.apparent.set(this.origin.x + w.apparent.x * ARROW_SCALE, ARROW_HEIGHT + 0.4, this.origin.z + w.apparent.z * ARROW_SCALE);
  }
}
