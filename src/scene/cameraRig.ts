/**
 * Camera: follows the boat while sailing, and settles into a composed shot at each stop.
 * The caller blends between poses (see stages.ts); the rig smooths everything and shifts the
 * projection so the boat sits at `focusX` across the screen, clear of the map label.
 */
import * as THREE from 'three';
import type { StagePose } from './stages';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly fwd = new THREE.Vector2(0, -1);
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private initialised = false;
  private width = 1;
  private height = 1;
  private focusX = 0.5;
  private appliedFocus = -1;
  /** Phones and narrow windows: no sideways framing, camera further back, stage shots lifted. */
  private narrow = false;
  private portrait = false;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 2400);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const aspect = width / height;
    this.portrait = aspect < 0.8;
    this.narrow = width < 900 || aspect < 1.1;
    this.camera.fov = aspect < 0.8 ? 58 : aspect < 1.2 ? 50 : 42;
    this.appliedFocus = -1;
    this.applyFocus();
  }

  private applyFocus(): void {
    const focus = this.narrow ? 0.5 : this.focusX;
    if (Math.abs(focus - this.appliedFocus) < 0.002) return;
    this.appliedFocus = focus;
    const cam = this.camera;
    const { width, height } = this;
    if (Math.abs(focus - 0.5) < 0.002) {
      cam.aspect = width / height;
      cam.clearViewOffset();
    } else {
      // Render part of a wider virtual frustum whose centre lands at `focus` across the screen.
      const fullWidth = 2 * Math.max(focus, 1 - focus) * width;
      cam.aspect = fullWidth / height;
      cam.setViewOffset(fullWidth, height, focus > 0.5 ? 0 : fullWidth - width, 0, width, height);
    }
    cam.updateProjectionMatrix();
  }

  /**
   * pose: blended camera pose; focusX: where the boat should sit across the screen;
   * stageWeight: how much a stop shot is in effect (lifts the shot above the bottom sheet on phones).
   */
  update(boat: THREE.Vector3, forwardX: number, forwardZ: number, pose: StagePose, focusX: number, stageWeight: number, dt: number, time: number): void {
    const kf = this.initialised ? 1 - Math.exp(-dt * 1.4) : 1;
    this.fwd.x += (forwardX - this.fwd.x) * kf;
    this.fwd.y += (forwardZ - this.fwd.y) * kf;
    this.fwd.normalize();
    const fx = this.fwd.x;
    const fz = this.fwd.y;
    const rx = -fz;
    const rz = fx;

    const k = this.portrait ? 1.3 : this.narrow ? 1.12 : 1;
    const back = pose.back * k;
    const up = pose.up * k;
    // On phones the label is a bottom sheet: aim lower so the shot rises into the top half.
    const lookUp = pose.lookUp - (this.portrait ? 3.5 * stageWeight : 0);
    const sway = Math.sin(time * 0.35) * 0.35;
    const side = -pose.side + sway;

    this.desiredPos.set(boat.x - fx * back + rx * side, up + Math.sin(time * 0.5) * 0.12, boat.z - fz * back + rz * side);
    this.desiredLook.set(boat.x + fx * pose.ahead, lookUp, boat.z + fz * pose.ahead);

    const kp = this.initialised ? 1 - Math.exp(-dt * 2.4) : 1;
    this.pos.lerp(this.desiredPos, kp);
    this.look.lerp(this.desiredLook, kp);
    this.initialised = true;

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    this.focusX += (focusX - this.focusX) * (this.appliedFocus < 0 ? 1 : kp);
    this.applyFocus();
  }
}
