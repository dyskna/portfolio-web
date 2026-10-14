import type * as THREE from 'three';
import type { SimFrame } from '../../sim/boatSim';
import { compileInSlices } from '../compile';
import { MOMENTS, type MomentEntry } from './registry';
import type { Moment, MomentContext } from './types';

/** Start downloading a moment when the boat is this far (m) from it. */
const LOAD_DISTANCE = 110;

interface Slot {
  entry: MomentEntry;
  s: number;
  state: 'idle' | 'loading' | 'ready' | 'failed';
  moment?: Moment;
  weight: number;
  /** Settles when loading has finished (or failed). */
  loaded?: Promise<void>;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class MomentManager {
  private slots: Slot[] = [];
  private debug = false;
  private size: [number, number, number] = [1, 1, 1];

  constructor(private readonly baseContext: Omit<MomentContext, 'anchorS'>) {}

  /** anchors: route distance (m) for each anchor name (project ids and 'harbour'). */
  setAnchors(anchors: Map<string, number>): void {
    for (const entry of MOMENTS) {
      const s = anchors.get(entry.anchor);
      if (s === undefined) continue;
      const slot = this.slots.find((x) => x.entry === entry);
      if (slot) slot.s = s;
      else this.slots.push({ entry, s, state: 'idle', weight: 0 });
    }
  }

  get anchors(): { id: string; s: number }[] {
    return this.slots.map((x) => ({ id: x.entry.id, s: x.s }));
  }

  update(frame: SimFrame, dt: number): void {
    for (const slot of this.slots) {
      const d = Math.abs(frame.s - slot.s);
      if (slot.state === 'idle' && d < LOAD_DISTANCE) slot.loaded = this.load(slot);
      slot.weight = 1 - smoothstep(slot.entry.full, slot.entry.full + slot.entry.fade, d);
      if (slot.state === 'ready') slot.moment!.update(frame, slot.weight, dt);
    }
  }

  /** Load every moment now instead of on approach (see LakeScene.warmUp). */
  async preloadAll(): Promise<void> {
    for (const slot of this.slots) if (slot.state === 'idle') slot.loaded = this.load(slot);
    await Promise.all(this.slots.map((x) => x.loaded));
  }

  /** Run each full-frame pass once at full strength, so its shaders are drawn before it shows. */
  prime(): void {
    for (const slot of this.slots) if (slot.state === 'ready') slot.moment!.render?.(1);
  }

  /** Lets a moment take over the frame (post-processing). Returns true if one did. */
  render(): boolean {
    for (const slot of this.slots) {
      if (slot.state === 'ready' && slot.weight > 0.001 && slot.moment!.render?.(slot.weight)) return true;
    }
    return false;
  }

  setDebug(on: boolean): void {
    this.debug = on;
    for (const slot of this.slots) slot.moment?.setDebug?.(on);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.size = [width, height, pixelRatio];
    for (const slot of this.slots) slot.moment?.resize?.(width, height, pixelRatio);
  }

  info(): string[] {
    return this.slots
      .filter((x) => x.state === 'loading' || (x.state === 'ready' && x.weight > 0.01))
      .map((x) => `${x.entry.id} ${x.state === 'ready' ? x.weight.toFixed(2) : 'loading'}${x.moment?.debugInfo ? ' · ' + x.moment.debugInfo() : ''}`);
  }

  private async load(slot: Slot): Promise<void> {
    slot.state = 'loading';
    try {
      const mod = await slot.entry.load();
      const moment = mod.create({ ...this.baseContext, anchorS: slot.s });
      await this.warmUp(moment);
      await moment.prepare?.();
      slot.moment = moment;
      slot.moment.setDebug?.(this.debug);
      slot.moment.resize?.(...this.size);
      slot.state = 'ready';
    } catch (err) {
      // A moment is decoration: if it fails, the page carries on without it.
      console.warn(`[moments] ${slot.entry.id} failed to load`, err);
      slot.state = 'failed';
    }
  }

  /** Compile a new moment's shaders before it shows, a few per frame. */
  private async warmUp(moment: Moment): Promise<void> {
    const objects = moment.warmup ?? [];
    if (!objects.length) return;
    const { renderer, camera, scene } = this.baseContext;
    const compiled = compileInSlices(renderer, objects, camera, scene);
    // Send its textures to the GPU as well; a canvas uploaded on first sight stalls that frame.
    for (const o of objects) {
      o.traverse((obj) => {
        const m = (obj as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
          const uniforms = (mat as THREE.ShaderMaterial).uniforms ?? {};
          for (const v of [...Object.values(mat), ...Object.values(uniforms).map((u) => u?.value)]) {
            if ((v as THREE.Texture | null)?.isTexture && !(v as THREE.Texture).isRenderTargetTexture) renderer.initTexture(v as THREE.Texture);
          }
        }
      });
    }
    await compiled;
  }

  dispose(): void {
    for (const slot of this.slots) slot.moment?.dispose();
    this.slots = [];
  }
}
