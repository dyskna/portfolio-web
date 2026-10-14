/**
 * The lake scene. Loaded as a separate chunk after the page content is on screen.
 * It reads the simulation (scroll → boat → wind) and draws it; it never touches scrolling.
 */
import * as THREE from 'three';
import type { SimFrame } from '../sim/boatSim';
import type { Route } from '../sim/route';
import { Atmosphere } from './atmosphere';
import { Boat } from './boat';
import { CameraRig } from './cameraRig';
import { ChapterProps, type ClipSources } from './chapterProps';
import { FOLLOW_POSE, STAGES, type StagePose } from './stages';
import { STOP_FRACTIONS } from '../sim/stops';
import { DebugOverlay } from './debugOverlay';
import { firstMeshGeometry, loadModel, takeObject } from './models';
import { MomentManager } from './moments/manager';
import type { HarbourParts } from './props';
import { buildFishingCabin, buildFishingHarbour } from './village';
import { Life } from './life';
import { mergeStatic } from './mergeStatic';
import { installPaintedLook, sceneUniforms } from './paint';
import { buildForest, buildVegetation } from './vegetation';
import type { QualitySettings } from './quality';
import { buildFarRange, buildTerrain } from './terrain';
import { Wake } from './wake';
import { buildWater, type Water } from './water';
import { HeightField } from './world';

export interface SceneText {
  harbourLine: string;
  /** Brush word per chapter id. */
  words: Record<string, string>;
  /** Project titles per chapter id (shown on the screen until the clip exists). */
  titles: Record<string, string>;
  /** Clip files that exist, per project chapter id. */
  clips: Record<string, ClipSources | null>;
}

export interface SceneStats {
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  tier: string;
  moments: string[];
  /** Compiled shader programs and GPU textures (to spot first-use stalls). */
  programs: number;
  textures: number;
}

export type ScreenPoint = { x: number; y: number; visible: boolean };
export type AnchorKind = 'mast' | 'sail' | 'buoy';

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

export class LakeScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private readonly rig = new CameraRig();
  private readonly boat = new Boat();
  private readonly wake: Wake;
  private readonly debugOverlay: DebugOverlay;
  private water!: Water;
  private atmosphere!: Atmosphere;
  private field!: HeightField;
  private harbour!: HarbourParts;
  private moments!: MomentManager;
  private debug = false;
  private pixelRatio = 1;
  private pixelRatioScale = 1;
  private readonly boatPos = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
  private readonly resizeObserver: ResizeObserver;
  private width = 1;
  private height = 1;
  private disposed = false;
  private life!: Life;
  private chapterProps!: ChapterProps;
  /** Stage weight per chapter id, set by the page every frame. */
  private stageWeights = new Map<string, number>();
  private readonly pose: StagePose = { ...FOLLOW_POSE };
  private readonly anchorPoint = new THREE.Vector3();
  private readonly corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  /** Parts from boat.glb, cloned for the ghost and agent boats. */
  private boatParts: { hull: THREE.Object3D; mast?: THREE.Object3D; boom?: THREE.Object3D } | null = null;

  private constructor(
    private readonly container: HTMLElement,
    private readonly route: Route,
    readonly settings: QualitySettings,
    private readonly text: SceneText,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: settings.antialias,
      powerPreference: 'default',
      stencil: false,
    });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.info.autoReset = false;
    // Reading each shader's error log on first use blocks until the GPU has linked it, which
    // stalled the frame whenever something new came into view. Keep the check in development.
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.wake = new Wake(route);
    this.debugOverlay = new DebugOverlay(route);
    this.resizeObserver = new ResizeObserver(() => this.resize());
  }

  /** Builds the world in a few slices so no single task blocks the page for long. */
  static async create(container: HTMLElement, route: Route, settings: QualitySettings, text: SceneText): Promise<LakeScene> {
    const s = new LakeScene(container, route, settings, text);
    await s.build();
    return s;
  }

  private async build(): Promise<void> {
    const { settings, scene, route } = this;
    installPaintedLook();
    this.field = new HeightField(route, settings.terrainSegments[0], settings.terrainSegments[1]);
    await nextTask();

    scene.add(buildTerrain(this.field));
    scene.add(buildFarRange(new THREE.Vector2(0, -170), 520, settings.farRangeSegments));
    await nextTask();

    this.water = buildWater(this.field, { minX: -130, maxX: 130, minZ: -380, maxZ: 60 }, settings.waterCell, settings.waterDetail);
    // Water first: the lake bed under it then fails the depth test instead of being shaded.
    this.water.mesh.renderOrder = -2;
    scene.add(this.water.mesh, this.water.wire);
    this.atmosphere = new Atmosphere(this.water.uniforms, settings.cloudOctaves);
    scene.fog = this.atmosphere.fog;
    scene.add(this.atmosphere.sky, this.atmosphere.sun, this.atmosphere.sun.target, this.atmosphere.hemi);

    const vegetation = buildVegetation(this.field, route, settings);
    const forest = vegetation.forest;
    scene.add(forest, vegetation.group);
    const cabin = buildFishingCabin(this.field);
    scene.add(cabin);
    // Many small static meshes → one draw call each (the window glows, the chimney marks the smoke).
    mergeStatic(cabin, { keep: ['CabinWindow', 'CabinLights'], markers: ['Chimney'] });
    cabin.updateMatrixWorld(true);
    this.life = new Life(this.field, route, cabin, settings);
    scene.add(this.life.group);
    this.harbour = buildFishingHarbour(this.field);
    scene.add(this.harbour.group);
    mergeStatic(this.harbour.group, { keep: ['HarbourLamp', 'HarbourWindows'] });
    scene.add(this.boat.root, this.wake.mesh, this.debugOverlay.group);
    this.chapterProps = new ChapterProps(
      route,
      Object.entries(STAGES).map(([id, st]) => ({
        id,
        s: (STOP_FRACTIONS[id] ?? 0) * route.length,
        // No painted word at the harbour: the crew sign is its lettering.
        word: id === 'harbour' ? undefined : this.text.words[id],
        wordColor: st.wordColor,
        wordCentred: st.pose === FOLLOW_POSE,
        buoy: st.buoy,
        title: this.text.titles[id],
        clip: this.text.clips[id] ?? null,
      })),
    );
    scene.add(this.chapterProps.group);
    // Draw the words in the brush font before the warm-up sends them to the GPU (it is usually
    // loaded by now; if it is slow, they are redrawn and re-sent when it arrives).
    await Promise.race([this.chapterProps.loadFont(), new Promise((r) => setTimeout(r, 1500))]);
    await nextTask();

    this.moments = new MomentManager({
      scene,
      camera: this.rig.camera,
      renderer: this.renderer,
      route,
      field: this.field,
      boat: this.boat,
      atmosphere: this.atmosphere,
      harbour: this.harbour,
      quality: settings,
      makeBoat: () => this.makeBoat(),
      text: this.text,
    });

    this.container.appendChild(this.renderer.domElement);
    this.resizeObserver.observe(this.container);
    this.resize();

    // Swap in Blender models if any were exported (no requests otherwise).
    void this.loadModels(cabin, forest);
  }

  private async loadModels(cabin: THREE.Group, forest: THREE.InstancedMesh): Promise<void> {
    const [boat, cabinModel, harbourModel, tree] = await Promise.all([
      loadModel('boat.glb'),
      loadModel('cabin.glb'),
      loadModel('harbour.glb'),
      loadModel('tree.glb'),
    ]);
    if (this.disposed) return;
    if (boat) {
      const hull = takeObject(boat, 'Hull');
      if (hull) {
        const boom = takeObject(boat, 'Boom');
        boom?.position.set(0, 0, 0); // origin is the gooseneck, which is the pivot
        this.boatParts = { hull, mast: takeObject(boat, 'Mast'), boom };
        const p = this.boatParts;
        this.boat.replaceParts({ hull: p.hull.clone(), mast: p.mast?.clone(), boom: p.boom?.clone() });
      } else console.warn('[models] boat.glb has no object named "Hull"');
    }
    if (cabinModel) {
      cabin.clear();
      cabin.add(cabinModel);
    }
    if (harbourModel) {
      this.harbour.group.clear();
      this.harbour.group.add(harbourModel, this.harbour.signAnchor);
      const lamps: THREE.Mesh[] = [];
      harbourModel.traverse((o) => {
        if (o.name.startsWith('Lamp') && (o as THREE.Mesh).isMesh) lamps.push(o as THREE.Mesh);
      });
      this.harbour.lamps.splice(0, this.harbour.lamps.length, ...lamps);
      const sign = harbourModel.getObjectByName('Sign');
      if (sign) sign.getWorldPosition(this.harbour.signAnchor.position);
    }
    if (tree) {
      const t = firstMeshGeometry(tree);
      if (t) {
        const replacement = buildForest(this.field, this.settings.trees, t.geometry, t.material);
        this.scene.remove(forest);
        forest.dispose();
        this.scene.add(replacement);
      }
    }
  }

  /** Another boat with the same look (for moments). */
  private makeBoat(): Boat {
    const b = new Boat();
    const p = this.boatParts;
    if (p) b.replaceParts({ hull: p.hull.clone(), mast: p.mast?.clone(), boom: p.boom?.clone() });
    return b;
  }

  /**
   * Get every shader and texture ready before the scene fades in (the page shows the poster
   * meanwhile), so nothing compiles or uploads mid-voyage. Call after setAnchors.
   */
  async warmUp(frame: SimFrame): Promise<void> {
    this.update(frame, 0);
    // The stop moments too: loaded on approach, each one hitched the frame it first appeared.
    await this.moments.preloadAll();
    const ready = this.renderer.compileAsync(this.scene, this.rig.camera);
    // Upload the large word and screen canvases now too: sent on first sight, each one stalled
    // the frame as its stop came on stage.
    for (const t of this.chapterProps.takeAllUploads()) this.renderer.initTexture(t);
    await ready;
    this.prime();
  }

  /**
   * Draw everything once into a single pixel. A shader's first real draw waits for the GPU to
   * finish preparing it (100+ ms on some drivers, even after compiling); doing that for all of
   * them now means the first sight of a word, a ghost boat or the pixel-art lake is smooth.
   */
  private prime(): void {
    const r = this.renderer;
    const saved: [THREE.Object3D, boolean, boolean][] = [];
    this.scene.traverse((o) => {
      saved.push([o, o.visible, o.frustumCulled]);
      o.visible = true;
      o.frustumCulled = false;
    });
    r.setScissorTest(true);
    r.setScissor(0, 0, 1, 1);
    r.render(this.scene, this.rig.camera);
    this.moments.prime();
    r.setScissorTest(false);
    for (const [o, visible, culled] of saved) {
      o.visible = visible;
      o.frustumCulled = culled;
    }
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio) * this.pixelRatioScale;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
    this.chapterProps?.setViewport(w, h);
    this.life?.setPointScale(h * this.pixelRatio, this.rig.camera.fov);
    this.moments?.resize(w, h, this.pixelRatio);
  }

  /** Called by the frame-rate governor to trade sharpness for speed. */
  setPixelRatioScale(k: number): void {
    if (k === this.pixelRatioScale) return;
    this.pixelRatioScale = k;
    this.resize();
  }

  get pixelRatioScaleValue(): number {
    return this.pixelRatioScale;
  }

  /** Route distances where moments peak, keyed by project id (and 'harbour'). */
  setAnchors(anchors: Map<string, number>): void {
    this.moments.setAnchors(anchors);
    this.debugOverlay.setAnchors(this.moments.anchors);
  }

  setDebug(on: boolean): void {
    this.debug = on;
    this.debugOverlay.group.visible = on;
    this.moments.setDebug(on);
  }

  /** How much each chapter is on stage (0..1), from the page's scroll position. */
  setStageWeights(weights: Map<string, number>): void {
    this.stageWeights = weights;
  }

  /** Screen position (CSS px) of a chapter's buoy, for the map label's leader line and tags. */
  /**
   * Screen position (CSS px) of something on the lake that an annotation points at:
   * the masthead or sail of my boat, or a chapter's buoy.
   */
  anchorScreen(id: string, kind: AnchorKind = 'buoy'): (ScreenPoint & { distance: number }) | null {
    const p = kind === 'buoy' ? this.chapterProps?.anchor(id, this.anchorPoint) : this.boat.anchorWorld(kind, this.anchorPoint);
    if (!p) return null;
    const distance = p.distanceTo(this.rig.camera.position);
    this.projected.copy(p).project(this.rig.camera);
    return {
      x: (this.projected.x * 0.5 + 0.5) * this.width,
      y: (-this.projected.y * 0.5 + 0.5) * this.height,
      visible: this.projected.z < 1 && Math.abs(this.projected.x) < 1.05 && Math.abs(this.projected.y) < 1.05,
      distance,
    };
  }

  private update(f: SimFrame, dt: number): void {
    const time = f.time;
    sceneUniforms.uTime.value = time;
    this.water.uniforms.uTime.value = time;
    this.water.uniforms.uBoat.value.set(f.position.x, f.position.z, Math.min(1, Math.abs(f.modelSpeed) / 5), Math.abs(f.routeSpeed));
    this.boat.update(f.position.x, f.position.z, f.forward.x, f.forward.z, f.wind.sail, time, dt);
    this.boatPos.set(f.position.x, 0, f.position.z);
    this.wake.update(f.s, f.modelSpeed, time, dt);
    // Blend the camera from sailing into the active chapter's staged shot.
    let activeId = '';
    let w = 0;
    for (const [id, weight] of this.stageWeights) {
      if (weight > w) {
        w = weight;
        activeId = id;
      }
    }
    const stage = STAGES[activeId];
    const target = stage?.pose ?? FOLLOW_POSE;
    for (const k of Object.keys(FOLLOW_POSE) as (keyof StagePose)[]) {
      this.pose[k] = FOLLOW_POSE[k] + (target[k] - FOLLOW_POSE[k]) * w;
    }
    const focusX = 0.5 + ((stage?.focusX ?? 0.5) - 0.5) * w;
    this.rig.update(this.boatPos, f.forward.x, f.forward.z, this.pose, focusX, activeId === 'pier' ? 0 : w, dt, time);
    // Every chapter with a colour world applies it by its own weight, so a quick jump between
    // two of them blends the colours instead of switching at the crossover.
    const moods = this.atmosphere.moods;
    moods.clear();
    for (const [id, weight] of this.stageWeights) {
      const mood = STAGES[id]?.mood;
      if (mood && weight > 0) moods.set(mood, Math.max(moods.get(mood) ?? 0, weight));
    }
    this.chapterProps.update(this.stageWeights, time);
    const redrawn = this.chapterProps.takeUpload();
    if (redrawn) this.renderer.initTexture(redrawn);
    this.life.update(time, this.atmosphere.t);
    this.atmosphere.update(f.routeProgress, this.boatPos);
    this.atmosphere.sky.position.copy(this.rig.camera.position);
    // Sailcloth is translucent: it glows warm when the sun is behind it.
    this.boat.sailMaterial.emissive.copy(this.atmosphere.sun.color).multiplyScalar(0.3);
    this.debugOverlay.update(f);
    this.moments.update(f, dt);
  }

  render(f: SimFrame): void {
    if (this.disposed) return;
    this.update(f, f.dt);
    const r = this.renderer;
    r.info.reset();
    r.setClearColor(this.atmosphere.clearColor);
    if (!this.moments.render()) r.render(this.scene, this.rig.camera);
    if (this.debug) this.renderWireframe();
  }

  /** Second pass: every mesh as a faint wireframe on top of the shaded frame. */
  private renderWireframe(): void {
    const r = this.renderer;
    const { scene } = this;
    const hidden = [this.atmosphere.sky, this.water.mesh, this.wake.mesh, this.debugOverlay.group];
    const was = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    this.water.wire.visible = true;
    scene.overrideMaterial = this.debugOverlay.wireMaterial;
    r.autoClear = false;
    r.render(scene, this.rig.camera);
    scene.overrideMaterial = null;
    this.water.wire.visible = false;
    hidden.forEach((o, i) => (o.visible = was[i]));
    // Arrows again on top of the wireframe.
    const vis = scene.children.map((c) => c.visible);
    scene.children.forEach((c) => (c.visible = c === this.debugOverlay.group));
    r.render(scene, this.rig.camera);
    scene.children.forEach((c, i) => (c.visible = vis[i]));
    r.autoClear = true;
  }

  /** Screen positions (CSS px) of the wind-vector label points, for the HUD tags. */
  labelPositions(): Record<'true' | 'motion' | 'apparent', ScreenPoint> {
    const out = {} as Record<'true' | 'motion' | 'apparent', ScreenPoint>;
    const cam = this.rig.camera;
    for (const key of ['true', 'motion', 'apparent'] as const) {
      this.projected.copy(this.debugOverlay.labelPoints[key]).project(cam);
      out[key] = {
        x: (this.projected.x * 0.5 + 0.5) * this.width,
        y: (-this.projected.y * 0.5 + 0.5) * this.height,
        visible: this.projected.z < 1 && Math.abs(this.projected.x) < 1.1 && Math.abs(this.projected.y) < 1.1,
      };
    }
    return out;
  }

  /** Bounding box (CSS px) of a chapter's clip screen, for the click target over it. */
  screenRect(id: string): { x: number; y: number; w: number; h: number; visible: boolean } | null {
    if (!this.chapterProps?.screenCorners(id, this.corners)) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let behind = false;
    for (const c of this.corners) {
      c.project(this.rig.camera);
      if (c.z > 1) behind = true;
      const x = (c.x * 0.5 + 0.5) * this.width;
      const y = (-c.y * 0.5 + 0.5) * this.height;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const visible = !behind && x1 > 0 && x0 < this.width && y1 > 0 && y0 < this.height;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, visible };
  }

  /** Hide a top-level object by name (for performance checks with ?perf). */
  hide(name: string): void {
    const o = this.scene.getObjectByName(name);
    if (o) o.visible = false;
  }

  /** Visible meshes by name and their count (for performance checks with ?perf). */
  drawList(): Record<string, number> {
    const out: Record<string, number> = {};
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(this.rig.camera.projectionMatrix, this.rig.camera.matrixWorldInverse),
    );
    this.scene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!(m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite)) return;
      if (o.frustumCulled && !(o as THREE.Sprite).isSprite && m.geometry) {
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        const sphere = m.geometry.boundingSphere!.clone().applyMatrix4(o.matrixWorld);
        if (!frustum.intersectsSphere(sphere)) return;
      }
      let top: THREE.Object3D = o;
      while (top.parent && top.parent !== this.scene) top = top.parent;
      const key = top.name || o.name || "?";
      out[key] = (out[key] ?? 0) + 1;
    });
    return out;
  }

  stats(): SceneStats {
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      pixelRatio: this.pixelRatio,
      tier: this.settings.tier,
      moments: this.moments.info(),
      programs: this.renderer.info.programs?.length ?? 0,
      textures: this.renderer.info.memory.textures,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.moments?.dispose();
    this.life?.dispose();
    this.chapterProps?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
