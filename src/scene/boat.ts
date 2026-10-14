/**
 * The sailboat: hull and rig from a design (boatDesigns.ts), and a sail whose shape is driven by
 * the wind model. Works for a triangular sail and for a four-sided gaff sail.
 *
 * Local frame: bow toward -z, starboard +x, up +y, origin on the waterline amidships.
 *   root (position + heading)
 *     └ body (bobbing, pitch, roll and heel)
 *         ├ hull, mast, rigging, flag
 *         └ boomPivot (rotates about the mast by the model's boom angle)
 *             ├ boom, gaff
 *             └ sail (cloth deformed on the CPU each frame: belly from fullness, ripples from flap)
 */
import * as THREE from 'three';
import type { SailState } from '../wind/wind';
import { NORDIC, type BoatDesign, type Rig } from './boatDesigns';
import { waveHeight } from './world';

/** Sail outline in boom-pivot space (z aft along the boom, y up the mast). */
interface SailShape {
  luff: number;
  clewZ: number;
  peakZ: number;
  peakY: number;
  roach: number;
}

function sailShape(rig: Rig): SailShape {
  const peakZ = rig.gaff ? Math.cos(rig.gaff.angle) * rig.gaff.length : 0;
  const peakY = rig.luff + (rig.gaff ? Math.sin(rig.gaff.angle) * rig.gaff.length : 0);
  return { luff: rig.luff, clewZ: rig.boomLength, peakZ, peakY, roach: rig.roach };
}

/** The sail as a grid: rows from foot to head, columns from luff (mast) to leech. */
class SailCloth {
  readonly mesh: THREE.Mesh;
  private readonly cols = 8;
  private readonly rows = 9;
  private readonly chords: number[] = [];

  constructor(material: THREE.Material, shape: SailShape, panels: boolean) {
    const { cols, rows } = this;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let r = 0; r <= rows; r++) {
      const v = r / rows;
      // Luff point on the mast, leech point between clew and peak (bowed out by the roach).
      const ly = v * shape.luff;
      const ez = shape.clewZ + (shape.peakZ - shape.clewZ) * v + Math.sin(Math.PI * v) * shape.roach;
      const ey = shape.peakY * v;
      this.chords.push(Math.hypot(ez, ey - ly));
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        pos.push(0, ly + (ey - ly) * u, ez * u);
        // Sailcloth panels: alternating tone column by column.
        const k = panels ? (c % 2 === 0 ? 1 : 0.9) : 1;
        col.push(k, k, k);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * (cols + 1) + c;
        const b = a + 1;
        const d = a + cols + 1;
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = 'Sail';
    this.mesh.position.y = 0.05;
  }

  /** side: +1 bellies toward local +x. */
  deform(sail: SailState, side: number, time: number): void {
    const attr = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const { cols, rows } = this;
    const flapAmp = 0.28 * sail.flap;
    const belly = 0.16 * sail.fullness;
    for (let r = 0; r <= rows; r++) {
      const v = r / rows;
      const chord = this.chords[r];
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const i = (r * (cols + 1) + c) * 3;
        // Camber: deepest about 40% back from the luff, proportional to the chord.
        const camber = Math.sin(Math.PI * Math.pow(u, 0.8)) * belly * chord;
        // Luffing: ripples run from luff to leech, bigger toward the free leech.
        const ripple =
          Math.sin(u * 7.5 - time * 9.5 + v * 2.2) * flapAmp * u * (0.5 + 0.5 * (1 - v)) +
          Math.sin(u * 3.1 - time * 5.3 + v * 4.0) * flapAmp * 0.35 * u;
        arr[i] = side * camber + ripple;
      }
    }
    attr.needsUpdate = true;
  }
}

export class Boat {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly boomPivot = new THREE.Group();
  readonly sailMaterial: THREE.MeshLambertMaterial;
  private readonly sail: SailCloth;
  private readonly rig: Rig;
  private readonly flag: THREE.Mesh | null = null;
  private yaw = 0;
  private boom = 0.3;
  private heel = 0;
  private flagAngle = 0;
  private hasPose = false;

  constructor(readonly design: BoatDesign = NORDIC) {
    const rig = (this.rig = design.rig);
    this.root.name = 'Boat';
    this.root.add(this.body);

    const hullMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    const hull = new THREE.Mesh(design.hull(), hullMat);
    hull.name = 'Hull';
    this.body.add(hull);

    const spar = new THREE.MeshLambertMaterial({ color: rig.sparColor, flatShading: true });
    const mastLength = rig.mastTop - rig.mastFoot;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, mastLength, 6), spar);
    mast.name = 'Mast';
    mast.position.set(0, rig.mastFoot + mastLength / 2, rig.mastZ);
    this.body.add(mast);

    this.boomPivot.position.set(0, rig.boomHeight, rig.mastZ);
    this.body.add(this.boomPivot);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, rig.boomLength + 0.1, 6), spar);
    boom.name = 'Boom';
    boom.rotation.x = Math.PI / 2;
    boom.position.z = rig.boomLength / 2;
    this.boomPivot.add(boom);

    const shape = sailShape(rig);
    if (rig.gaff) {
      const gaff = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, rig.gaff.length, 6), spar);
      gaff.name = 'Gaff';
      // From the throat (top of the luff) up and aft to the peak.
      gaff.position.set(0, (shape.luff + shape.peakY) / 2 + 0.05, shape.peakZ / 2);
      gaff.rotation.x = Math.PI / 2 - rig.gaff.angle;
      this.boomPivot.add(gaff);
    }

    this.sailMaterial = new THREE.MeshLambertMaterial({ color: rig.sailColor, vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    this.sail = new SailCloth(this.sailMaterial, shape, rig.panels);
    this.boomPivot.add(this.sail.mesh);

    // Forestay to the stem head and shrouds to the gunwales: one draw call.
    if (rig.rigging) {
      const top = new THREE.Vector3(0, rig.mastTop - 0.1, rig.mastZ);
      const pts = [
        top, design.stemTop,
        top, new THREE.Vector3(design.chainplateX, design.chainplateY, rig.mastZ + 0.15),
        top, new THREE.Vector3(-design.chainplateX, design.chainplateY, rig.mastZ + 0.15),
      ];
      const lines = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: '#2a211b', transparent: true, opacity: 0.75 }),
      );
      lines.name = 'Rigging';
      this.body.add(lines);
    }

    // A pennant at the masthead: it streams the way the apparent wind blows.
    if (rig.flag) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.16, 0, 0, -0.16, 0, 0, 0, 0.75], 3));
      g.computeVertexNormals();
      const flag = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: rig.flag, side: THREE.DoubleSide }));
      flag.name = 'Flag';
      flag.position.set(0, rig.mastTop - 0.05, rig.mastZ);
      this.body.add(flag);
      this.flag = flag;
    }

    // Small dark wedge under the hull so it reads against bright water.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2).scale(0.95, 1, 2.4),
      new THREE.MeshBasicMaterial({ color: '#1d3542', transparent: true, opacity: 0.22, depthWrite: false }),
    );
    shadow.name = 'ContactShadow';
    shadow.position.y = 0.06;
    shadow.renderOrder = 1;
    this.root.add(shadow);
  }

  /** World position of a point the chart annotations point at: the masthead or the middle of the sail. */
  anchorWorld(kind: 'mast' | 'sail', out: THREE.Vector3): THREE.Vector3 {
    const rig = this.rig;
    if (kind === 'mast') {
      this.body.updateWorldMatrix(true, false);
      return this.body.localToWorld(out.set(0, rig.mastTop - 0.2, rig.mastZ));
    }
    this.boomPivot.updateWorldMatrix(true, false);
    return this.boomPivot.localToWorld(out.set(0, rig.luff * 0.45, rig.boomLength * 0.32));
  }

  /** Replace hull/mast/boom with meshes from a Blender model (see models.ts). */
  replaceParts(parts: { hull?: THREE.Object3D; mast?: THREE.Object3D; boom?: THREE.Object3D }): void {
    const swap = (name: string, parent: THREE.Object3D, obj?: THREE.Object3D) => {
      if (!obj) return;
      const old = parent.getObjectByName(name);
      if (old) parent.remove(old);
      obj.name = name;
      parent.add(obj);
    };
    swap('Hull', this.body, parts.hull);
    swap('Mast', this.body, parts.mast);
    swap('Boom', this.boomPivot, parts.boom);
  }

  /**
   * Place the boat on the water and pose sail and hull from the wind model.
   * x, z: world position; fx, fz: forward unit vector; dt: frame time.
   */
  update(x: number, z: number, fx: number, fz: number, sail: SailState, time: number, dt: number): void {
    const targetYaw = Math.atan2(-fx, -fz);
    if (!this.hasPose) {
      this.yaw = targetYaw;
      this.hasPose = true;
    }
    let dy = targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-dt * 4));
    this.root.position.set(x, 0, z);
    this.root.rotation.y = this.yaw;

    // Boom swings toward the trimmed angle; a slack sail lets it wander a little.
    const wander = Math.sin(time * 1.7) * 0.05 * sail.flap;
    this.boom += (sail.boomAngle + wander - this.boom) * (1 - Math.exp(-dt * 2.5));
    this.boomPivot.rotation.y = this.boom;

    // Heel to leeward when the sail is drawing.
    const leeward = this.boom >= 0 ? 1 : -1;
    const targetHeel = -leeward * sail.fullness * Math.min(1, sail.aws / 7) * 0.2;
    this.heel += (targetHeel - this.heel) * (1 - Math.exp(-dt * 2));

    // Bob on the same waves the water shader draws.
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const fwdX = -sy, fwdZ = -cy; // local -z in world
    const rgtX = cy, rgtZ = -sy; // local +x in world
    const hBow = waveHeight(x + fwdX * 2, z + fwdZ * 2, time);
    const hStern = waveHeight(x - fwdX * 2, z - fwdZ * 2, time);
    const hStar = waveHeight(x + rgtX * 0.8, z + rgtZ * 0.8, time);
    const hPort = waveHeight(x - rgtX * 0.8, z - rgtZ * 0.8, time);
    this.body.position.y = (hBow + hStern + hStar + hPort) / 4 + 0.02;
    this.body.rotation.x = Math.atan2(hBow - hStern, 4) * 0.8;
    this.body.rotation.z = Math.atan2(hStar - hPort, 1.6) * 0.5 + this.heel;

    // The pennant points where the apparent wind blows (awa is where it comes from).
    if (this.flag) {
      let d = -sail.awa - this.flagAngle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.flagAngle += d * (1 - Math.exp(-dt * 3));
      this.flag.rotation.y = this.flagAngle + Math.sin(time * 9) * 0.08 * (0.3 + sail.aws / 8);
    }

    // The cloth bellies to leeward, i.e. the side the boom has swung to.
    this.sail.deform(sail, leeward, time);
  }
}
