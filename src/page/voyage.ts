/**
 * The page side of the voyage: measures the chapters, turns the scroll position into a route
 * target and a "stage weight" per chapter, and keeps the chapter row, the chart annotations'
 * leader lines, the map tags and the clip screen's click target in step with the scene.
 * It only reads the scroll position.
 */
import { STOP_FRACTIONS } from '../sim/stops';
import { buildKeys, follow, stageWeight, targetS, type Follower, type Stop, type VoyageKey } from '../sim/voyage';

/** Part of each chapter's scroll travel during which its stage holds (start, end). */
const HOLDS: Record<string, [number, number]> = {
  pier: [0, 0.55],
  harbour: [0.32, 1],
};
const DEFAULT_HOLD: [number, number] = [0.3, 0.84];
/** Metres the boat drifts around its stop while a chapter holds, so scrolling still moves it. */
const DRIFT = 3;
/**
 * How quickly the stage weights follow the scroll (1/s). A chapter's ramp is only a few wheel
 * notches long, so the weights glide over about half a second instead of stepping per notch;
 * the sky, camera, words and notes all read them. The scroll itself is untouched.
 */
const WEIGHT_RATE = 6;
/** Each note fades in over this part of the stage weight, one after the other (title, design, code). */
const REVEAL_START = 0.35;
const REVEAL_STEP = 0.12;
const REVEAL_SPAN = 0.3;

export type AnchorKind = 'mast' | 'sail' | 'buoy';

export interface ScreenAnchor {
  x: number;
  y: number;
  visible: boolean;
  distance: number;
}

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}

export interface SceneProbe {
  anchor(id: string, kind: AnchorKind): ScreenAnchor | null;
  screenRect(id: string): ScreenRect | null;
}

interface Note {
  el: HTMLElement;
  kind: AnchorKind | null;
  /** Box relative to its stage, measured once (reading it per frame forces layout). */
  box: { x: number; y: number; w: number; h: number };
  line: HTMLElement | null;
  mark: HTMLElement | null;
  reveal: number;
  shown: number;
}

interface Chapter {
  id: string;
  el: HTMLElement;
  stage: HTMLElement;
  notes: Note[];
  hasClip: boolean;
  nav: HTMLAnchorElement | null;
  tag: HTMLElement | null;
  stop: Stop;
  top: number;
  height: number;
  stageHeight: number;
  w: number;
  /** The eased stage weight. */
  eased: Follower;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class VoyageController {
  readonly weights = new Map<string, number>();
  private readonly chapters: Chapter[];
  private keys: VoyageKey[] = [];
  private ramp = 300;
  private current = '';
  private active: Chapter | null = null;
  private readonly hotspot: HTMLButtonElement | null;
  private readonly leaders: HTMLElement | null;
  /** One fixed fade layer for the whole page: it never scrolls, so it can never show an edge. */
  private readonly scrim: HTMLElement | null;
  private scrimOpacity = -1;

  constructor(private readonly routeLength: number) {
    const leaders = document.getElementById('leaders');
    this.leaders = leaders;
    this.scrim = document.getElementById('scrim');
    this.hotspot = document.getElementById('screen-hotspot') as HTMLButtonElement | null;
    this.chapters = [...document.querySelectorAll<HTMLElement>('[data-chapter]')].map((el) => {
      const id = el.dataset.chapter!;
      // The page's own clip (shown on a phone) fades in with the notes, last.
      const notes: Note[] = [...el.querySelectorAll<HTMLElement>('.ann, .clip')].map((ann, i) => {
        const kind = (ann.dataset.anchor as AnchorKind | undefined) ?? null;
        let line: HTMLElement | null = null;
        let mark: HTMLElement | null = null;
        if (kind && leaders) {
          line = document.createElement('span');
          line.className = 'leader-line';
          mark = document.createElement('span');
          mark.className = 'leader-mark';
          leaders.append(line, mark);
        }
        return { el: ann, kind, box: { x: 0, y: 0, w: 0, h: 0 }, line, mark, reveal: REVEAL_START + i * REVEAL_STEP, shown: -1 };
      });
      return {
        id,
        el,
        stage: el.querySelector<HTMLElement>('.stage')!,
        notes,
        hasClip: !!el.dataset.clipMp4 || !!el.dataset.clipWebm,
        nav: document.querySelector<HTMLAnchorElement>(`[data-nav="${id}"]`),
        tag: document.querySelector<HTMLElement>(`[data-tag="${id}"]`),
        stop: { holdStart: 0, holdEnd: 0, s: (STOP_FRACTIONS[id] ?? 0) * routeLength },
        top: 0,
        height: 0,
        stageHeight: 0,
        w: -1,
        eased: { value: 0, velocity: 0 },
      };
    });
    this.measure();
  }

  /** Re-read chapter positions (on resize, font load, list view toggle). */
  measure(): void {
    const vh = window.innerHeight;
    for (const c of this.chapters) {
      c.top = c.el.getBoundingClientRect().top + window.scrollY;
      c.height = c.el.offsetHeight;
      c.stageHeight = c.stage.offsetHeight;
      const travel = Math.max(1, c.height - vh);
      const [h0, h1] = HOLDS[c.id] ?? DEFAULT_HOLD;
      c.stop.holdStart = c.top + h0 * travel;
      c.stop.holdEnd = c.top + h1 * travel;
      const sr = c.stage.getBoundingClientRect();
      for (const n of c.notes) {
        const r = n.el.getBoundingClientRect();
        n.box = { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height };
      }
    }
    this.keys = buildKeys(
      this.chapters.map((c) => c.stop),
      DRIFT,
      this.routeLength,
    );
    this.ramp = vh * 0.3;
  }

  /** Route stop distance (m) for each chapter id, for the scene's moments. */
  stopDistances(): Map<string, number> {
    return new Map(this.chapters.map((c) => [c.id, c.stop.s]));
  }

  /**
   * Call every frame with the frame time; without dt (first frame, static picture) the weights
   * jump straight to the scroll position. Returns where the boat should be on the route (m).
   */
  update(scrollY: number, dt?: number): number {
    const vh = window.innerHeight;
    let current = this.chapters[0]?.id ?? '';
    let best: Chapter | null = null;
    for (const c of this.chapters) {
      const raw = stageWeight(c.stop, scrollY, this.ramp);
      if (dt === undefined) {
        c.eased.value = raw;
        c.eased.velocity = 0;
      } else {
        follow(c.eased, raw, dt, WEIGHT_RATE);
        if (Math.abs(c.eased.value - raw) < 1e-4 && Math.abs(c.eased.velocity) < 1e-3) c.eased.value = raw;
      }
      const w = clamp01(c.eased.value);
      this.weights.set(c.id, w);
      if (Math.abs(w - c.w) > 0.004 || (w === 0) !== (c.w === 0)) {
        c.w = w;
        // Notes appear one after another as the stop arrives; --w is registered as
        // non-inheriting (main.css), so only the note itself restyles.
        for (const n of c.notes) {
          const shown = clamp01((w - n.reveal) / REVEAL_SPAN);
          if (Math.abs(shown - n.shown) < 0.01 && shown !== 0 && shown !== 1) continue;
          n.shown = shown;
          n.el.style.setProperty('--w', shown.toFixed(3));
          n.el.classList.toggle('is-off', shown < 0.2);
        }
      }
      if (!best || w > best.w) best = c;
      if (scrollY + vh * 0.5 >= c.top) current = c.id;
    }
    this.active = best && best.w > 0.02 ? best : null;
    if (this.scrim) {
      const o = best ? Math.round(best.w * 100) / 100 : 0;
      if (o !== this.scrimOpacity) {
        this.scrimOpacity = o;
        this.scrim.style.opacity = String(o);
      }
      const ink = best?.el.dataset.ink ?? 'light';
      if (this.scrim.dataset.ink !== ink) this.scrim.dataset.ink = ink;
      const id = best?.id ?? '';
      if (this.scrim.dataset.chapter !== id) this.scrim.dataset.chapter = id;
    }
    if (current !== this.current) {
      this.current = current;
      for (const c of this.chapters) {
        if (c.id === current) c.nav?.setAttribute('aria-current', 'step');
        else c.nav?.removeAttribute('aria-current');
      }
      // Keep the active chapter visible in the scrollable row on phones (the row scrolls, not the page).
      const nav = this.chapters.find((c) => c.id === current)?.nav;
      const strip = nav?.closest('.chapter-nav') as HTMLElement | null;
      if (nav && strip && strip.scrollWidth > strip.clientWidth) {
        strip.scrollLeft = nav.offsetLeft - strip.clientWidth / 2 + nav.offsetWidth / 2;
      }
    }
    return targetS(this.keys, scrollY);
  }

  /** Leader lines from the active chapter's notes, tags over upcoming stops, the screen hotspot. */
  placeOverlays(probe: SceneProbe): void {
    const active = this.active;
    for (const c of this.chapters) {
      if (c !== active) this.hideLeaders(c);
    }
    if (active) {
      // Leader lines take the active chapter's ink (dark on bright scenes, cream on dark ones).
      const ink = active.el.dataset.ink ?? 'light';
      if (this.leaders && this.leaders.dataset.ink !== ink) this.leaders.dataset.ink = ink;
      this.placeLeaders(active, probe);
    }
    this.placeHotspot(active, probe);

    const activeIndex = active ? this.chapters.indexOf(active) : 0;
    // Tags are for sailing: they give way when a chapter is on stage, the opening shot included.
    const onStage = active ? active.w : 0;
    this.chapters.forEach((c, i) => {
      if (!c.tag) return;
      const a = i > activeIndex ? probe.anchor(c.id, 'buoy') : null;
      const fade = a && a.visible ? clamp01((170 - a.distance) / 70) * (1 - onStage) : 0;
      if (fade < 0.02 || !a) {
        if (c.tag.style.display !== 'none') c.tag.style.display = 'none';
        return;
      }
      c.tag.style.display = 'inline-flex';
      c.tag.style.opacity = fade.toFixed(2);
      c.tag.style.transform = `translate(${a.x.toFixed(1)}px, ${(a.y - 28).toFixed(1)}px) translate(-50%, -100%)`;
    });
  }

  private placeLeaders(c: Chapter, probe: SceneProbe): void {
    // The stage is sticky: it sits at the top of the screen while its chapter scrolls past.
    const y = window.scrollY;
    const stageTop = Math.min(Math.max(c.top - y, 0), c.top + c.height - c.stageHeight - y);
    for (const n of c.notes) {
      if (!n.line || !n.mark || !n.kind) continue;
      const a = n.shown > 0.05 ? probe.anchor(c.id, n.kind) : null;
      if (!a || !a.visible) {
        n.line.style.opacity = '0';
        n.mark.style.opacity = '0';
        continue;
      }
      // From the anchor to the nearest point on the note's box, drawn out as the note appears.
      const left = n.box.x - 10;
      const right = n.box.x + n.box.w + 10;
      const top = stageTop + n.box.y - 8;
      const bottom = stageTop + n.box.y + n.box.h + 8;
      const fx = Math.min(right, Math.max(left, a.x));
      const fy = Math.min(bottom, Math.max(top, a.y));
      const dx = fx - a.x;
      const dy = fy - a.y;
      const len = Math.hypot(dx, dy) * n.shown;
      const angle = Math.atan2(dy, dx);
      n.line.style.opacity = '1';
      n.mark.style.opacity = n.shown.toFixed(2);
      n.line.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px) rotate(${angle.toFixed(4)}rad) scaleX(${len.toFixed(1)})`;
      n.mark.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px)`;
    }
  }

  private hideLeaders(c: Chapter): void {
    for (const n of c.notes) {
      if (n.line && n.line.style.opacity !== '0') n.line.style.opacity = '0';
      if (n.mark && n.mark.style.opacity !== '0') n.mark.style.opacity = '0';
    }
  }

  /** A click target over the clip screen on the lake (the notes also have a real button). */
  private placeHotspot(c: Chapter | null, probe: SceneProbe): void {
    const h = this.hotspot;
    if (!h) return;
    const r = c && c.hasClip && c.w > 0.5 ? probe.screenRect(c.id) : null;
    if (!c || !r || !r.visible) {
      if (!h.hidden) h.hidden = true;
      return;
    }
    h.hidden = false;
    h.dataset.watch = c.id;
    h.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`;
    h.style.width = `${r.w.toFixed(0)}px`;
    h.style.height = `${r.h.toFixed(0)}px`;
  }

  /** Hide overlays (scene off or list view). */
  hideOverlays(): void {
    for (const c of this.chapters) {
      this.hideLeaders(c);
      if (c.tag) c.tag.style.display = 'none';
    }
    if (this.hotspot) this.hotspot.hidden = true;
  }

  /** The chapter whose section is in view, e.g. to keep the reader's place when switching views. */
  currentElement(): HTMLElement | null {
    return this.chapters.find((c) => c.id === this.current)?.el ?? null;
  }
}
