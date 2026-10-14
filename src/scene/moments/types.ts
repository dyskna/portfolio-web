import type * as THREE from 'three';
import type { SimFrame } from '../../sim/boatSim';
import type { Route } from '../../sim/route';
import type { Atmosphere } from '../atmosphere';
import type { Boat } from '../boat';
import type { HarbourParts } from '../props';
import type { QualitySettings } from '../quality';
import type { HeightField } from '../world';

export interface MomentContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  route: Route;
  field: HeightField;
  boat: Boat;
  atmosphere: Atmosphere;
  harbour: HarbourParts;
  quality: QualitySettings;
  /** Route distance (m) where this moment peaks. */
  anchorS: number;
  /** Builds another boat with the same look (ghost, agent). */
  makeBoat: () => Boat;
  /** Text from content.ts that a moment may show. */
  text: { harbourLine: string };
}

export interface Moment {
  /** weight: 0 far away … 1 at the anchor. Called every frame once loaded. */
  update(frame: SimFrame, weight: number, dt: number): void;
  setDebug?(on: boolean): void;
  /**
   * Optional full-frame pass (pixel-art look). Return true if it rendered the frame;
   * the core then skips its own render.
   */
  render?(weight: number): boolean;
  resize?(width: number, height: number, pixelRatio: number): void;
  /** Objects whose shaders should be compiled at load, so they appear without a hitch. */
  warmup?: THREE.Object3D[];
  /** Extra async preparation before the moment goes live (e.g. compiling render-target variants). */
  prepare?(): Promise<void>;
  /** One line for the Debug view HUD. */
  debugInfo?(): string;
  dispose(): void;
}

export interface MomentModule {
  create(ctx: MomentContext): Moment;
}
