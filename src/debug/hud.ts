/**
 * Debug view HUD: live wind-model values and a boat-relative compass of the three vectors.
 * Plain DOM + 2D canvas, so it also works when the 3D scene is off (static fallback).
 */
import type { SimFrame } from '../sim/boatSim';
import { bearingFrom, length, type Vec2 } from '../wind/wind';

export const COLORS = { true: '#5fb4ff', motion: '#ffab4a', apparent: '#7dffb2' };

export interface RenderInfo {
  fps: number;
  frameMs: number;
  mode: string;
  pixelRatio?: number;
  drawCalls?: number;
  triangles?: number;
  moments?: string[];
}

type TagKey = 'true' | 'motion' | 'apparent';

const deg = (r: number) => (r * 180) / Math.PI;
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–');

export class Hud {
  private readonly compass: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly values: HTMLElement;
  private readonly tags: Record<TagKey, HTMLElement>;
  private readonly tagLayer: HTMLElement;
  private lastText = 0;
  private visible = false;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <div class="hud-head">
        <span class="hud-title">Debug view</span>
        <span class="hud-sub">apparent wind = true + motion</span>
      </div>
      <div class="hud-body">
        <canvas class="hud-compass" width="120" height="120" role="img"
          aria-label="Wind vectors relative to the boat: true wind, wind from motion and apparent wind"></canvas>
        <ul class="hud-legend">
          <li><i style="background:${COLORS.true}"></i>true wind</li>
          <li><i style="background:${COLORS.motion}"></i>from motion</li>
          <li><i style="background:${COLORS.apparent}"></i>apparent</li>
        </ul>
      </div>
      <dl class="hud-values"></dl>`;
    this.compass = root.querySelector('canvas')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.compass.width = 120 * dpr;
    this.compass.height = 120 * dpr;
    this.ctx = this.compass.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.values = root.querySelector('.hud-values')!;

    this.tagLayer = document.createElement('div');
    this.tagLayer.className = 'debug-tags';
    this.tagLayer.setAttribute('aria-hidden', 'true');
    this.tagLayer.hidden = true;
    const mk = (key: TagKey, label: string) => {
      const el = document.createElement('span');
      el.className = 'debug-tag';
      el.style.setProperty('--c', COLORS[key]);
      el.textContent = label;
      this.tagLayer.appendChild(el);
      return el;
    };
    this.tags = { true: mk('true', 'true'), motion: mk('motion', 'motion'), apparent: mk('apparent', 'apparent') };
    document.body.appendChild(this.tagLayer);
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.root.hidden = !on;
    this.tagLayer.hidden = !on;
  }

  /** 3D label positions from the scene, or null when there is no scene. */
  placeTags(points: Record<TagKey, { x: number; y: number; visible: boolean }> | null): void {
    if (!this.visible) return;
    for (const key of ['true', 'motion', 'apparent'] as TagKey[]) {
      const el = this.tags[key];
      const p = points?.[key];
      el.style.display = p && p.visible ? '' : 'none';
      if (p) el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  update(f: SimFrame, info: RenderInfo, now: number): void {
    if (!this.visible) return;
    this.drawCompass(f);
    if (now - this.lastText < 120) return; // text at ~8 Hz is plenty and avoids layout churn
    this.lastText = now;
    const w = f.wind;
    const s = w.sail;
    const side = s.awa >= 0 ? 'stbd' : 'port';
    const rows: [string, string][] = [
      ['true wind', `${fmt(length(w.trueWind))} m/s from ${fmt(bearingFrom(w.trueWind), 0)}°`],
      ['from motion', `${fmt(length(w.motionWind))} m/s (boat ${fmt(f.modelSpeed)} m/s)`],
      ['apparent', `${fmt(s.aws)} m/s, ${fmt(Math.abs(deg(s.awa)), 0)}° ${side}`],
      ['sail', `boom ${fmt(deg(s.boomAngle), 0)}° · full ${fmt(s.fullness * 100, 0)}% · flap ${fmt(s.flap * 100, 0)}%`],
      ['scroll', `${fmt(f.scrollVelocity, 0)} px/s · ${fmt(f.progress * 100, 0)}%`],
      ['route', `${fmt(f.s, 0)} m · ${fmt(f.routeSpeed, 1)} m/s on screen`],
      ['render', `${info.mode} · ${fmt(info.fps, 0)} fps · ${fmt(info.frameMs, 1)} ms`],
    ];
    if (info.drawCalls !== undefined) {
      rows.push(['gpu', `${info.drawCalls} draws · ${((info.triangles ?? 0) / 1000).toFixed(0)}k tris · dpr ${fmt(info.pixelRatio ?? 1, 2)}`]);
    }
    for (const m of info.moments ?? []) rows.push(['moment', m]);
    this.values.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }

  private drawCompass(f: SimFrame): void {
    const g = this.ctx;
    const size = 120;
    const c = size / 2;
    const k = 6.5; // px per m/s
    g.clearRect(0, 0, size, size);

    // Rings at 2.5 m/s steps.
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    for (let r = 2.5; r * k < c; r += 2.5) {
      g.beginPath();
      g.arc(c, c, r * k, 0, Math.PI * 2);
      g.stroke();
    }

    // Boat frame: bow up, starboard right.
    const fw = f.forward;
    const toScreen = (v: Vec2) => {
      const along = v.x * fw.x + v.z * fw.z;
      const side = v.x * -fw.z + v.z * fw.x;
      return { x: side * k, y: -along * k };
    };

    // Hull outline and boom.
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.moveTo(c, c - 13);
    g.quadraticCurveTo(c + 6, c - 2, c + 4, c + 11);
    g.lineTo(c - 4, c + 11);
    g.quadraticCurveTo(c - 6, c - 2, c, c - 13);
    g.fill();
    const boom = f.wind.sail.boomAngle;
    g.strokeStyle = '#fdf8ee';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(c, c - 3);
    g.lineTo(c + Math.sin(boom) * 14, c - 3 + Math.cos(boom) * 14);
    g.stroke();

    const arrow = (from: { x: number; y: number }, v: { x: number; y: number }, color: string, width: number) => {
      const len = Math.hypot(v.x, v.y);
      if (len < 1) return;
      const tx = c + from.x + v.x;
      const ty = c + from.y + v.y;
      g.strokeStyle = color;
      g.fillStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(c + from.x, c + from.y);
      g.lineTo(tx, ty);
      g.stroke();
      const a = Math.atan2(v.y, v.x);
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(tx - Math.cos(a - 0.45) * 7, ty - Math.sin(a - 0.45) * 7);
      g.lineTo(tx - Math.cos(a + 0.45) * 7, ty - Math.sin(a + 0.45) * 7);
      g.fill();
    };
    const t = toScreen(f.wind.trueWind);
    const m = toScreen(f.wind.motionWind);
    const a = toScreen(f.wind.apparent);
    arrow({ x: 0, y: 0 }, t, COLORS.true, 2);
    arrow(t, m, COLORS.motion, 2);
    arrow({ x: 0, y: 0 }, a, COLORS.apparent, 3);
  }

  dispose(): void {
    this.tagLayer.remove();
  }
}
