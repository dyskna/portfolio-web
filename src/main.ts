import './styles/main.css';
import { content } from './content';
import { Hud, type RenderInfo } from './debug/hud';
import { initVideos } from './page/videos';
import { VoyageController } from './page/voyage';
import { detectTier, SETTINGS, type Detection } from './scene/quality';
import type { LakeScene } from './scene/scene';
import { BoatSim } from './sim/boatSim';
import { Route } from './sim/route';

const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
initVideos(reducedMotionQuery.matches);

const root = document.documentElement;
const layer = document.getElementById('scene-layer')!;
const debugToggle = document.getElementById('debug-toggle') as HTMLButtonElement;
const listToggle = document.getElementById('list-toggle') as HTMLButtonElement;
const hudRoot = document.getElementById('debug-hud')!;
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------
// Project clips (or just a still): read which files exist from the page, open a clip full size on request.
// ---------------------------------------------------------------------------

const clips: Record<string, { mp4?: string; webm?: string; poster?: string } | null> = {};
for (const el of document.querySelectorAll<HTMLElement>('[data-project]')) {
  const { clipMp4, clipWebm, clipPoster } = el.dataset;
  clips[el.dataset.project!] =
    clipMp4 || clipWebm || clipPoster ? { mp4: clipMp4 || undefined, webm: clipWebm || undefined, poster: clipPoster || undefined } : null;
}

const clipDialog = document.getElementById('clip-dialog') as HTMLDialogElement | null;
document.addEventListener('click', (e) => {
  const trigger = (e.target as HTMLElement).closest<HTMLElement>('[data-watch]');
  const clip = trigger && clips[trigger.dataset.watch!];
  if (!clip || !(clip.mp4 || clip.webm) || !clipDialog) return;
  const frame = clipDialog.querySelector('.clip-dialog-frame')!;
  const project = [...content.projects, content.web].find((p) => p.id === trigger.dataset.watch);
  const video = document.createElement('video');
  video.controls = true;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true; // the clips have no sound; muted also allows autoplay everywhere
  video.loop = true;
  if (clip.poster) video.poster = clip.poster;
  if (project) video.setAttribute('aria-label', project.video.description);
  for (const [src, type] of [[clip.webm, 'video/webm'], [clip.mp4, 'video/mp4']] as const) {
    if (!src) continue;
    const source = document.createElement('source');
    source.src = src;
    source.type = type;
    video.appendChild(source);
  }
  frame.replaceChildren(video);
  clipDialog.showModal();
});
clipDialog?.addEventListener('close', () => clipDialog.querySelector('.clip-dialog-frame')!.replaceChildren());
// Clicking the dimmed backdrop (outside the frame) closes it too.
clipDialog?.addEventListener('click', (e) => {
  if (e.target === clipDialog) clipDialog.close();
});

// ---------------------------------------------------------------------------
// The voyage: scroll position → chapter stage weights and the boat's route target.
// Read-only: nothing here changes scrolling.
// ---------------------------------------------------------------------------

const route = new Route();
const voyage = new VoyageController(route.length);
const sim = new BoatSim(route);
sim.snap(voyage.update(window.scrollY));

new ResizeObserver(() => voyage.measure()).observe(document.body);
// Without the frame loop (static picture, list view), keep the chapter row in step on scroll.
window.addEventListener(
  'scroll',
  () => {
    if (!raf) voyage.update(window.scrollY);
  },
  { passive: true },
);
void document.fonts?.ready.then(() => voyage.measure());

// ---------------------------------------------------------------------------
// List view: the same content as a plain page, for a quick read.
// ---------------------------------------------------------------------------

let listView = false;
const setListView = (on: boolean, keepPlace = true) => {
  const place = keepPlace ? voyage.currentElement() : null;
  listView = on;
  root.classList.toggle('list-view', on);
  root.classList.toggle('scene-live', !on && !!scene);
  listToggle.setAttribute('aria-pressed', String(on));
  try {
    localStorage.setItem('list-view', on ? '1' : '0');
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
  voyage.measure();
  // The visitor asked for a different layout; keep them at the chapter they were reading.
  place?.scrollIntoView({ block: 'start' });
  if (on) voyage.hideOverlays();
  schedule();
};
listToggle.hidden = false;
listToggle.addEventListener('click', () => setListView(!listView));
document.getElementById('rotate-list')?.addEventListener('click', () => setListView(true));

// ---------------------------------------------------------------------------
// Debug view
// ---------------------------------------------------------------------------

const hud = new Hud(hudRoot);
let debugOn = false;
const setDebug = (on: boolean) => {
  debugOn = on;
  debugToggle.setAttribute('aria-checked', String(on));
  hud.setVisible(on);
  scene?.setDebug(on);
  schedule();
};
debugToggle.hidden = false;
debugToggle.addEventListener('click', () => setDebug(!debugOn));

// ---------------------------------------------------------------------------
// Frame loop: runs while the scene is live or the Debug view is open, never while hidden.
// ---------------------------------------------------------------------------

let scene: LakeScene | null = null;
let detection: Detection = { tier: 'static', reason: 'loading' };
let raf = 0;
let last = 0;
let fps = 60;
let frameMs = 16.7;
let frameJitter = 0;

const governor = { enabled: !params.has('quality'), since: 0, slowFor: 0 };

/** A phone held sideways: the page asks to turn it upright (main.css), so the lake rests meanwhile. */
const sideways = matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)');
sideways.addEventListener('change', () => schedule());
const sceneActive = () => !!scene && !listView && !sideways.matches;

function frame(now: number): void {
  raf = 0;
  const dt = last ? Math.min(0.25, (now - last) / 1000) : 1 / 60;
  last = now;
  frameJitter += (Math.abs(dt * 1000 - frameMs) - frameJitter) * 0.05;
  frameMs += (dt * 1000 - frameMs) * 0.05;
  fps = 1000 / frameMs;

  const target = voyage.update(window.scrollY, dt);
  sim.update(dt, window.scrollY, target);
  if (sceneActive()) {
    scene!.setStageWeights(voyage.weights);
    scene!.render(sim.frame);
    voyage.placeOverlays(probe);
  }

  if (debugOn) {
    const stats = scene?.stats();
    const info: RenderInfo = {
      fps,
      frameMs,
      mode: sceneActive() ? stats!.tier : listView ? 'list view' : `static (${detection.reason})`,
      pixelRatio: stats?.pixelRatio,
      drawCalls: stats?.drawCalls,
      triangles: stats?.triangles,
      moments: stats?.moments,
    };
    hud.update(sim.frame, info, now);
    hud.placeTags(sceneActive() ? scene!.labelPositions() : null);
  }

  if (sceneActive()) govern(dt);
  schedule();
}

function schedule(): void {
  if (raf || document.hidden) return;
  if (!sceneActive() && !debugOn) {
    last = 0;
    return;
  }
  raf = requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  last = 0;
  schedule();
});

/**
 * Frame-rate governor: if the scene can't hold a decent frame rate, lower the resolution;
 * if that doesn't help, fall back to the static picture.
 */
function govern(dt: number): void {
  if (!governor.enabled || !scene) return;
  governor.since += dt;
  if (governor.since < 3) return; // ignore start-up hitches
  // A steady ~30 fps with little jitter is a browser cap (battery saver), not a slow GPU.
  const capped = Math.abs(frameMs - 33.3) < 2.5 && frameJitter < 2;
  const target = scene.settings.tier === 'high' ? 40 : 26;
  const slow = fps < target && !capped;
  governor.slowFor = slow ? governor.slowFor + dt : Math.max(0, governor.slowFor - dt * 0.5);
  if (governor.slowFor < 2.5) return;
  governor.slowFor = 0;
  governor.since = 0;
  const k = scene.pixelRatioScaleValue;
  if (k > 0.6) scene.setPixelRatioScale(Math.round((k - 0.2) * 10) / 10);
  else if (fps < 20) goStatic('frame rate too low');
}

// ---------------------------------------------------------------------------
// Scene: loaded after the content is on screen, only on capable devices.
// ---------------------------------------------------------------------------

/** What the voyage controller asks of the scene each frame. */
const probe = {
  anchor: (id: string, kind: 'mast' | 'sail' | 'buoy') => scene?.anchorScreen(id, kind) ?? null,
  screenRect: (id: string) => scene?.screenRect(id) ?? null,
};

const chapterWords: Record<string, string> = {
  pier: content.hero.word,
  ...Object.fromEntries(content.projects.map((p) => [p.id, p.word])),
  [content.web.id]: content.web.word,
  about: content.about.word,
  harbour: content.contact.word,
};

async function startScene(): Promise<void> {
  detection = detectTier();
  root.dataset.scene = detection.tier;
  if (detection.tier === 'static') return;
  try {
    const { LakeScene } = await import('./scene/scene');
    const s = await LakeScene.create(layer, route, SETTINGS[detection.tier], {
      harbourLine: content.harbourLine,
      words: chapterWords,
      titles: { ...Object.fromEntries(content.projects.map((p) => [p.id, p.title])), [content.web.id]: content.web.title },
      clips,
    });
    sim.snap(voyage.update(window.scrollY));
    sim.update(1 / 60, window.scrollY, voyage.update(window.scrollY));
    s.setStageWeights(voyage.weights);
    s.setAnchors(voyage.stopDistances());
    await s.warmUp(sim.frame);
    s.setDebug(debugOn);
    scene = s;
    root.classList.toggle('scene-live', !listView);
    last = 0;
    schedule();
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('is-live')));
  } catch (err) {
    console.warn('[scene] falling back to the static picture', err);
    goStatic('error');
  }
}

function goStatic(reason: string): void {
  detection = { tier: 'static', reason };
  root.dataset.scene = 'static';
  root.classList.remove('scene-live');
  layer.classList.remove('is-live');
  voyage.hideOverlays();
  const s = scene;
  scene = null;
  if (s) setTimeout(() => s.dispose(), 900); // let the canvas fade out first
}

reducedMotionQuery.addEventListener('change', (e) => {
  if (e.matches) goStatic('prefers-reduced-motion');
});

const whenIdle = (cb: () => void) =>
  'requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 200);

if (document.readyState === 'complete') whenIdle(startScene);
else window.addEventListener('load', () => whenIdle(startScene), { once: true });

// Restore the reader's view choice from last time.
try {
  if (localStorage.getItem('list-view') === '1') setListView(true, false);
} catch {
  /* storage unavailable */
}

if (params.get('debug') === '1') setDebug(true);

// Frame-rate probe for automated checks: open with ?perf and call window.__perf().
if (params.has('perf')) {
  (window as unknown as { __perf: () => object }).__perf = () => ({ fps, frameMs, tier: detection.tier, ...scene?.stats() });
  (window as unknown as { __draws: () => object }).__draws = () => scene?.drawList() ?? {};
  (window as unknown as { __hide: (n: string) => void }).__hide = (n) => scene?.hide(n);
}
