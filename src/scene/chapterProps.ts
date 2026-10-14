/**
 * Things that belong to each chapter's stop on the lake:
 * - the chapter word, hand-lettered (brush font for now), standing large on the water behind the
 *   boat with the mast cutting through its middle; it is "painted in" with a ragged brush edge on
 *   arrival;
 * - a buoy that marks the stop, carrying a screen on a pole that plays the project's clip, or
 *   shows its still when there is only a screenshot (a placeholder until either exists); the
 *   chart annotations point at the buoy.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Route } from '../sim/route';
import { lettering } from 'virtual:asset-manifest';
import { waveHeight } from './world';

const WORD_DISTANCE = 32; // metres ahead of the stop
const WORD_HEIGHT = 8.5;
/**
 * Word size (× WORD_HEIGHT) and sideways shift (metres to screen-right). On wide screens the word
 * is large and centred on the mast, so the mast cuts through its middle and every letter still
 * shows above the sail; on a phone it is smaller and unshifted so the whole word fits the width.
 * maxSpan (metres) caps how wide the lettering itself may get: a long word is drawn smaller so it
 * stays on screen and, at a stop, clear of the clip screen; pierSpan is the
 * cap at the pier, where nothing stands beside the word. A phrase (with a space, or a joined name
 * like "CheryTheGame") breaks into two rows instead, which keeps it large: the top row clears the
 * sail, and the whole stays clear of the clip screen and fits a phone's width. Two rows at a stop are
 * set smaller (rowsScale): on a wide screen the lower row stays clear of the clip screen, on a phone
 * the upper row stays below the clip under the title. The pier has neither, so it keeps full size.
 */
const WORD_LAYOUT = {
  wide: { scale: 1.45, rowsScale: 1.1, side: 4, maxSpan: 26, pierSpan: 32 },
  portrait: { scale: 1.3, rowsScale: 1, side: 0, maxSpan: 25.5, pierSpan: 25.5 },
};
const CANVAS_W = 2048;
const CANVAS_H = 600;
const WORD_WIDTH = WORD_HEIGHT * (CANVAS_W / CANVAS_H);
const FONT = "'Sedgwick Ave Display', 'Brush Script MT', cursive";
const UI_FONT = "'Cabinet Grotesk', system-ui, sans-serif";
const SCREEN_W = 6.4;
const SCREEN_H = 3.6;
/** Height of the screen's centre above the water. */
const SCREEN_Y = 5.0;

export interface ClipSources {
  mp4?: string;
  webm?: string;
  poster?: string;
}

export interface ChapterPropEntry {
  id: string;
  s: number;
  word?: string;
  wordColor: string;
  buoy: boolean;
  /** Project title, shown on the screen while there is no clip. */
  title?: string;
  clip?: ClipSources | null;
  /** The camera already has the mast in the word's middle here, so the layout does not shift it. */
  wordCentred?: boolean;
}

interface WordItem {
  /** Hand-lettering replaced the font, so the font must not redraw over it. */
  custom: boolean;
  mesh: THREE.Mesh;
  uniforms: { map: { value: THREE.Texture }; uReveal: { value: number }; uOpacity: { value: number } };
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  text: string;
  color: string;
  baseY: number;
  /** Share of the canvas width the lettering covers (0..1). */
  fill: number;
  /** Plane height in metres at scale 1: a phrase gets a canvas twice as tall, room for two rows. */
  height: number;
  rows: number;
  centred: boolean;
  /** Where the word stands before the layout shifts it, and the screen-right direction there. */
  x: number;
  z: number;
  rx: number;
  rz: number;
}

interface ScreenItem {
  /** Pole, frame and screen together; rises out of the water when its stop arrives. */
  rig: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  canvas: HTMLCanvasElement;
  placeholder: THREE.CanvasTexture;
  title: string;
  clip: ClipSources | null;
  video: HTMLVideoElement | null;
  videoTexture: THREE.VideoTexture | null;
  /** The screenshot shown without a clip: undefined until requested, null while it loads. */
  still?: THREE.Texture | null;
}

interface BuoyItem {
  group: THREE.Group;
  anchor: THREE.Object3D;
  screen: ScreenItem | null;
  x: number;
  z: number;
}

/** The screen before its clip exists: diagonal hatching and a small caption. */
function drawPlaceholder(canvas: HTMLCanvasElement, title: string): void {
  const g = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  g.fillStyle = '#0f1d33';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(245, 234, 219, 0.07)';
  g.lineWidth = 2;
  for (let x = -h; x < w; x += 26) {
    g.beginPath();
    g.moveTo(x, h);
    g.lineTo(x + h, 0);
    g.stroke();
  }
  g.fillStyle = 'rgba(245, 234, 219, 0.9)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(h * 0.075)}px ${UI_FONT}`;
  g.fillText('CLIP IN PRODUCTION', w / 2, h * 0.47);
  g.fillStyle = 'rgba(245, 234, 219, 0.55)';
  g.font = `500 ${Math.round(h * 0.06)}px ${UI_FONT}`;
  g.fillText(title, w / 2, h * 0.6);
}

/** File name of hand-lettering for a chapter, if one was exported (svg, png or webp). */
export function letteringFile(id: string): string | null {
  return lettering.find((f) => f.replace(/\.[^.]+$/, '') === id) ?? null;
}

/**
 * Draw hand-lettering artwork, fitted into the canvas with its aspect ratio kept and standing on the
 * same line as the font's lettering. Returns its fill.
 */
function drawArtwork(canvas: HTMLCanvasElement, img: HTMLImageElement): number {
  const g = canvas.getContext('2d')!;
  const { width: W, height: H } = canvas;
  g.clearRect(0, 0, W, H);
  const w = img.naturalWidth || W;
  const h = img.naturalHeight || CANVAS_H;
  const k = Math.min((W * 0.94) / w, (H * 0.94) / h);
  g.drawImage(img, (W - w * k) / 2, H - (CANVAS_H + h * k) / 2, w * k, h * k);
  return (w * k) / W;
}

/** Where a phrase may break: at its spaces, or else where a joined name starts a new capital. */
const isPhrase = (text: string) => /\s|[a-z][A-Z]/.test(text);

/** Break a phrase where it gives the most even two rows. */
function twoRows(g: CanvasRenderingContext2D, text: string): string[] {
  const cuts: [number, number][] = [];
  for (let i = 1; i < text.length; i++) if (text[i] === ' ') cuts.push([i, i + 1]);
  if (!cuts.length) for (let i = 1; i < text.length; i++) if (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i])) cuts.push([i, i]);
  let best = [text];
  let bestWidth = Infinity;
  for (const [end, start] of cuts) {
    const rows = [text.slice(0, end), text.slice(start)];
    const width = Math.max(...rows.map((r) => g.measureText(r).width));
    if (width < bestWidth) [best, bestWidth] = [rows, width];
  }
  return best;
}

/**
 * Draw the word in the brush font, as large as fits, in one row or two. The last row stands where a
 * one-row word does (the bottom band of the canvas); an earlier row stacks above it. Returns its fill.
 */
function drawWord(canvas: HTMLCanvasElement, text: string, color: string, rows = 1): number {
  const g = canvas.getContext('2d')!;
  const { width: W, height: H } = canvas;
  g.clearRect(0, 0, W, H);
  // Text width scales with the font size: measure once and fit.
  g.font = `470px ${FONT}`;
  const lines = rows === 2 ? twoRows(g, text) : [text];
  const measured = Math.max(1, ...lines.map((l) => g.measureText(l).width));
  const size = Math.max(80, Math.min(470, (470 * W * 0.9) / measured));
  g.font = `${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((line, i) => {
    g.save();
    g.translate(W / 2, H - CANVAS_H * 0.45 - (lines.length - 1 - i) * size * 0.9);
    g.rotate(-0.06);
    // A soft ink shadow keeps the light lettering readable against bright sky.
    g.fillStyle = 'rgba(10, 14, 22, 0.28)';
    g.fillText(line, 10, 14);
    g.fillStyle = color;
    g.fillText(line, 0, 0);
    g.restore();
  });
  return (measured * size) / 470 / W;
}

function tinted(geo: THREE.BufferGeometry, hex: string, y: number): THREE.BufferGeometry {
  const g = (geo.index ? geo.toNonIndexed() : geo).translate(0, y, 0);
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export class ChapterProps {
  private static geometry: THREE.BufferGeometry | null = null;
  static readonly buoyMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  static buoyGeometry(): THREE.BufferGeometry {
    ChapterProps.geometry ??= mergeGeometries([
      tinted(new THREE.CylinderGeometry(0.42, 0.62, 1.1, 8), '#c43a26', 0.35),
      tinted(new THREE.CylinderGeometry(0.45, 0.5, 0.28, 8), '#f2ece2', 0.5),
      tinted(new THREE.ConeGeometry(0.42, 0.9, 8), '#c43a26', 1.35),
      // The lamp: emissive-looking pale yellow (Lambert, lit by the hemisphere light).
      tinted(new THREE.IcosahedronGeometry(0.16, 0), '#ffe9b0', 1.9),
    ])!;
    return ChapterProps.geometry;
  }

  readonly group = new THREE.Group();
  private readonly words = new Map<string, WordItem>();
  private readonly buoys = new Map<string, BuoyItem>();
  private wordLayout = WORD_LAYOUT.wide;
  /** Textures redrawn since they were last sent to the GPU (see takeUpload). */
  private readonly redrawn = new Set<THREE.Texture>();

  constructor(route: Route, entries: ChapterPropEntry[]) {
    this.group.name = 'ChapterProps';
    for (const e of entries) {
      const p = route.sample(e.s);
      const fx = p.tx;
      const fz = p.tz;
      const rx = -fz;
      const rz = fx;
      if (e.word) this.addWord(e, p.x + fx * WORD_DISTANCE, p.z + fz * WORD_DISTANCE, fx, fz);
      if (e.buoy) {
        const bx = p.x + rx * 14 + fx * 12;
        const bz = p.z + rz * 14 + fz * 12;
        // The screen turns toward where the camera stands for this stop (behind the boat).
        const facing = Math.atan2(p.x - fx * 20 - bx, p.z - fz * 20 - bz);
        this.addBuoy(e, bx, bz, facing);
      }
    }
  }

  private addWord(e: ChapterPropEntry, x: number, z: number, fx: number, fz: number): void {
    const phrase = isPhrase(e.word!);
    const rows = phrase ? 2 : 1;
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = phrase ? CANVAS_H * 2 : CANVAS_H;
    const height = WORD_HEIGHT * (canvas.height / CANVAS_H);
    const fill = drawWord(canvas, e.word!, e.wordColor, rows);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const uniforms = { map: { value: texture as THREE.Texture }, uReveal: { value: 0 }, uOpacity: { value: 0 } };
    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform float uReveal;
        uniform float uOpacity;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          vec4 c = texture2D(map, vUv);
          // Painted in from left to right with a ragged, bristly edge.
          float edge = vUv.x + (noise(vUv * vec2(5.0, 22.0)) - 0.5) * 0.14;
          float shown = 1.0 - smoothstep(uReveal - 0.05, uReveal, edge);
          gl_FragColor = vec4(c.rgb, c.a * shown * uOpacity);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WORD_WIDTH, height), material);
    mesh.name = `word:${e.id}`;
    // Face back toward the boat and the camera behind it.
    mesh.rotation.y = Math.atan2(-fx, -fz);
    mesh.renderOrder = 1;
    mesh.visible = false;
    this.group.add(mesh);
    const item: WordItem = { custom: false, mesh, uniforms, canvas, texture, text: e.word!, color: e.wordColor, baseY: 0, fill, height, rows, centred: !!e.wordCentred, x, z, rx: -fz, rz: fx };
    this.words.set(e.id, item);
    this.placeWord(item);
    // Your own lettering, exported to public/lettering/<chapter id>.svg (or .png/.webp), replaces the font.
    const file = letteringFile(e.id);
    if (file) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        item.custom = true;
        item.fill = drawArtwork(canvas, img);
        this.placeWord(item);
        texture.needsUpdate = true;
        this.redrawn.add(texture);
      };
      img.src = `/lettering/${file}`;
    }
  }

  /** Pick the word layout for the viewport (called on resize). */
  setViewport(width: number, height: number): void {
    const layout = width / height < 0.8 ? WORD_LAYOUT.portrait : WORD_LAYOUT.wide;
    if (layout === this.wordLayout) return;
    this.wordLayout = layout;
    for (const w of this.words.values()) this.placeWord(w);
  }

  private placeWord(w: WordItem): void {
    const maxSpan = w.centred ? this.wordLayout.pierSpan : this.wordLayout.maxSpan;
    const size = w.rows === 2 && !w.centred ? this.wordLayout.rowsScale : this.wordLayout.scale;
    const scale = Math.min(size, maxSpan / (w.fill * WORD_WIDTH));
    const side = w.centred ? 0 : this.wordLayout.side;
    w.mesh.scale.setScalar(scale);
    // Standing on the water: grow upward from the surface.
    w.baseY = 0.2 + (w.height * scale) / 2;
    w.mesh.position.set(w.x + w.rx * side, w.baseY, w.z + w.rz * side);
  }

  private addBuoy(e: ChapterPropEntry, x: number, z: number, facing: number): void {
    const group = new THREE.Group();
    group.name = `buoy:${e.id}`;
    // One merged, vertex-coloured mesh per buoy: a single draw call.
    const mesh = new THREE.Mesh(ChapterProps.buoyGeometry(), ChapterProps.buoyMaterial);
    const anchor = new THREE.Object3D();
    anchor.position.y = 2.1;
    group.add(mesh, anchor);
    group.position.set(x, 0, z);
    group.rotation.y = facing;
    this.group.add(group);

    let screen: ScreenItem | null = null;
    if (e.title !== undefined) {
      const poleLength = SCREEN_Y - SCREEN_H / 2 - 1.9;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, poleLength, 5), ChapterProps.poleMaterial);
      pole.position.y = 1.9 + poleLength / 2;
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W + 0.16, SCREEN_H + 0.16), ChapterProps.frameMaterial);
      frame.position.y = SCREEN_Y;
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 576;
      drawPlaceholder(canvas, e.title);
      const placeholder = new THREE.CanvasTexture(canvas);
      placeholder.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: placeholder, toneMapped: false, fog: false });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), material);
      face.name = `screen:${e.id}`;
      face.position.set(0, SCREEN_Y, 0.02);
      const rig = new THREE.Group();
      rig.add(pole, frame, face);
      rig.visible = false;
      group.add(rig);
      screen = { rig, mesh: face, material, canvas, placeholder, title: e.title, clip: e.clip ?? null, video: null, videoTexture: null };
    }
    this.buoys.set(e.id, { group, anchor, screen, x, z });
  }

  static readonly poleMaterial = new THREE.MeshLambertMaterial({ color: '#2a2622', flatShading: true });
  static readonly frameMaterial = new THREE.MeshBasicMaterial({ color: '#f5eadb', fog: false, side: THREE.DoubleSide });

  /** Load, play or pause a screen's clip with how much its chapter is on stage. */
  private driveScreen(sc: ScreenItem, weight: number): void {
    if (!sc.clip) return;
    if (!sc.clip.mp4 && !sc.clip.webm) {
      this.loadStill(sc, weight);
      return;
    }
    // In a portrait shot the screen is out of frame and the page plays the clip under the notes.
    if (this.wordLayout === WORD_LAYOUT.portrait) {
      if (sc.video && !sc.video.paused) sc.video.pause();
      return;
    }
    if (!sc.video && weight > 0.02) {
      const v = document.createElement('video');
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'auto';
      const sources: [string | undefined, string][] = [
        [sc.clip.webm, 'video/webm'],
        [sc.clip.mp4, 'video/mp4'],
      ];
      for (const [src, type] of sources) {
        if (!src) continue;
        const el = document.createElement('source');
        el.src = src;
        el.type = type;
        v.appendChild(el);
      }
      sc.video = v;
      const texture = new THREE.VideoTexture(v);
      texture.colorSpace = THREE.SRGBColorSpace;
      sc.videoTexture = texture;
      v.addEventListener('playing', () => {
        sc.material.map = texture;
        sc.material.needsUpdate = true;
      });
    }
    const v = sc.video;
    if (!v) return;
    if (weight > 0.3 && v.paused) void v.play().catch(() => {});
    else if (weight < 0.15 && !v.paused) v.pause();
  }

  /** Show the chapter's screenshot when its stop draws near (decoded off the main thread). */
  private loadStill(sc: ScreenItem, weight: number): void {
    const src = sc.clip?.poster;
    if (!src || sc.still !== undefined || weight <= 0.02) return;
    sc.still = null;
    fetch(src)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.statusText))))
      .then((blob) => createImageBitmap(blob, { imageOrientation: 'flipY' }))
      .then((bitmap) => {
        const t = new THREE.Texture(bitmap);
        t.flipY = false; // already flipped while decoding
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        t.needsUpdate = true;
        sc.still = t;
        sc.material.map = t;
        this.redrawn.add(t);
      })
      .catch(() => {
        // Keep the placeholder; the still is decoration on the lake (the page has it too).
      });
  }

  /** Redraw the words once the brush font has loaded. */
  async loadFont(): Promise<void> {
    try {
      await document.fonts.load(`400 200px ${FONT}`);
    } catch {
      return;
    }
    for (const w of this.words.values()) {
      if (w.custom) continue;
      w.fill = drawWord(w.canvas, w.text, w.color, w.rows);
      this.placeWord(w);
      w.texture.needsUpdate = true;
      this.redrawn.add(w.texture);
    }
    try {
      await document.fonts.load(`700 40px ${UI_FONT}`);
    } catch {
      return;
    }
    for (const b of this.buoys.values()) {
      if (!b.screen) continue;
      drawPlaceholder(b.screen.canvas, b.screen.title);
      b.screen.placeholder.needsUpdate = true;
      this.redrawn.add(b.screen.placeholder);
    }
  }

  /** Every word and screen texture, to send to the GPU before the first stop (clears the queue). */
  takeAllUploads(): THREE.Texture[] {
    const out: THREE.Texture[] = [...this.words.values()].map((w) => w.texture);
    for (const b of this.buoys.values()) if (b.screen) out.push(b.screen.placeholder);
    this.redrawn.clear();
    return out;
  }

  /**
   * One texture redrawn later (font or lettering arrived after the warm-up), to upload ahead of
   * its stop: a large canvas upload stalls the frame, so they go one per frame while sailing.
   */
  takeUpload(): THREE.Texture | undefined {
    for (const t of this.redrawn) {
      this.redrawn.delete(t);
      return t;
    }
    return undefined;
  }

  /** weights: stage weight per chapter id (0..1). */
  update(weights: Map<string, number>, time: number): void {
    for (const [id, w] of this.words) {
      const weight = weights.get(id) ?? 0;
      w.mesh.visible = weight > 0.005;
      if (!w.mesh.visible) continue;
      const eased = 1 - Math.pow(1 - weight, 2.2);
      w.uniforms.uReveal.value = -0.08 + eased * 1.2;
      w.uniforms.uOpacity.value = Math.min(1, weight * 2.5);
      w.mesh.position.y = w.baseY + Math.sin(time * 0.6) * 0.06;
    }
    for (const [id, b] of this.buoys) {
      if (b.screen) {
        const weight = weights.get(id) ?? 0;
        // Only this stop's screen is up; it rises out of the water as the stop arrives. In a portrait
        // shot it stays down: the page shows the clip under the title instead.
        b.screen.rig.visible = weight > 0.01 && this.wordLayout !== WORD_LAYOUT.portrait;
        const e = 1 - Math.pow(1 - Math.min(1, weight * 1.4), 3);
        b.screen.rig.position.y = -(1 - e) * (SCREEN_Y + SCREEN_H / 2);
        this.driveScreen(b.screen, weight);
      }
      const h = waveHeight(b.x, b.z, time);
      b.group.position.y = h - 0.15;
      b.group.rotation.z = Math.sin(time * 1.3 + b.x) * 0.06;
      b.group.rotation.x = Math.cos(time * 1.1 + b.z) * 0.05;
    }
  }

  /** World position an annotation points at: the top of a chapter's buoy. */
  anchor(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const b = this.buoys.get(id);
    if (!b) return null;
    b.anchor.getWorldPosition(out);
    return out;
  }

  /** The four world-space corners of a chapter's screen (for the click target over it). */
  screenCorners(id: string, out: THREE.Vector3[]): boolean {
    const sc = this.buoys.get(id)?.screen;
    if (!sc || !sc.rig.visible) return false;
    sc.mesh.updateWorldMatrix(true, false);
    const hw = SCREEN_W / 2;
    const hh = SCREEN_H / 2;
    const corners = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];
    corners.forEach(([x, y], i) => sc.mesh.localToWorld(out[i].set(x, y, 0)));
    return true;
  }

  /** All chapter objects, for compiling their shaders before they first appear. */
  get warmupObjects(): THREE.Object3D[] {
    return [this.group];
  }

  get anchorIds(): string[] {
    return [...this.buoys.keys()];
  }

  dispose(): void {
    for (const b of this.buoys.values()) {
      b.screen?.video?.pause();
      b.screen?.videoTexture?.dispose();
      b.screen?.still?.dispose();
      b.screen?.placeholder.dispose();
      b.screen?.material.dispose();
    }
    for (const w of this.words.values()) {
      w.texture.dispose();
      w.mesh.geometry.dispose();
      (w.mesh.material as THREE.Material).dispose();
    }
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}
