/**
 * Decides whether to run the 3D scene and at what detail. No Three.js import here,
 * so this runs before the scene bundle is downloaded.
 *
 * Override for testing with ?quality=high | low | static
 */
export type Tier = 'high' | 'low' | 'static';

export interface QualitySettings {
  tier: Exclude<Tier, 'static'>;
  maxPixelRatio: number;
  antialias: boolean;
  terrainSegments: [number, number];
  waterCell: number;
  trees: number;
  birches: number;
  /** Clumps of reeds along the waterline. */
  reeds: number;
  rocks: number;
  fireflies: number;
  farRangeSegments: number;
  cloudOctaves: number;
  /** Fine water ripples: 1 full, lower fades them sooner. */
  waterDetail: number;
}

export const SETTINGS: Record<Exclude<Tier, 'static'>, QualitySettings> = {
  high: {
    tier: 'high',
    maxPixelRatio: 1.5,
    antialias: true,
    // The terrain is an indexed grid now, so more segments still cost fewer vertices than before.
    terrainSegments: [200, 240],
    waterCell: 2.6,
    trees: 1100,
    birches: 320,
    reeds: 900,
    rocks: 300,
    fireflies: 160,
    farRangeSegments: 96,
    cloudOctaves: 4,
    waterDetail: 1,
  },
  low: {
    tier: 'low',
    maxPixelRatio: 1.5,
    antialias: false,
    terrainSegments: [104, 124],
    waterCell: 4.5,
    trees: 420,
    birches: 110,
    reeds: 300,
    rocks: 110,
    fireflies: 60,
    farRangeSegments: 56,
    cloudOctaves: 3,
    waterDetail: 0.6,
  },
};

export interface Detection {
  tier: Tier;
  reason: string;
}

function forced(): Tier | null {
  const q = new URLSearchParams(location.search).get('quality');
  return q === 'high' || q === 'low' || q === 'static' ? q : null;
}

/** Inspect the GPU without keeping a context around. */
function probeWebGL(): { ok: boolean; software: boolean; renderer: string } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return { ok: false, software: false, renderer: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const software = /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(renderer);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, software, renderer };
  } catch {
    return { ok: false, software: false, renderer: '' };
  }
}

export function detectTier(): Detection {
  const f = forced();
  if (f === 'static') return { tier: 'static', reason: 'forced by ?quality=static' };
  if (!f && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { tier: 'static', reason: 'prefers-reduced-motion' };
  }
  const gl = probeWebGL();
  if (!gl.ok) return { tier: 'static', reason: 'WebGL 2 unavailable' };
  if (f) return { tier: f, reason: `forced by ?quality=${f}` };
  if (gl.software) return { tier: 'static', reason: `software renderer (${gl.renderer})` };

  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return { tier: 'static', reason: 'data saver' };
  const memory = nav.deviceMemory ?? 8;
  const cores = nav.hardwareConcurrency ?? 8;
  if (memory <= 2 || cores <= 2) return { tier: 'static', reason: 'low-end device' };

  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 600;
  if (coarse || small || memory <= 4 || cores <= 4) return { tier: 'low', reason: 'mobile or modest device' };
  return { tier: 'high', reason: gl.renderer };
}
