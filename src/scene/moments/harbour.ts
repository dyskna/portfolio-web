/**
 * Moment: the harbour. The sun sinks into the afterglow, the quay lamps come on, and a sign
 * over the jetty reads the line from content.ts ("Want to be my crewmate?").
 */
import * as THREE from 'three';
import type { Moment, MomentContext } from './types';

const SIGN_W = 14;
const SIGN_H = 2.4;

function drawSign(canvas: HTMLCanvasElement, text: string): void {
  const g = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  g.fillStyle = '#f2eee6';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#121519';
  g.lineWidth = h * 0.035;
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  g.fillStyle = '#121519';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Text width scales with the font size: measure once and fit (a shrinking loop of measureText
  // calls stalled the frame for a quarter of a second).
  const max = h * 0.66;
  g.font = `400 ${max}px 'Sedgwick Ave Display', cursive`;
  const size = Math.max(10, Math.min(max, (max * w * 0.86) / Math.max(1, g.measureText(text).width)));
  g.font = `400 ${size}px 'Sedgwick Ave Display', cursive`;
  g.fillText(text, w / 2, h * 0.53);
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,220,150,1)');
  grad.addColorStop(0.3, 'rgba(255,190,110,0.45)');
  grad.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function create(ctx: MomentContext): Moment {
  const { harbour, atmosphere } = ctx;
  const root = new THREE.Group();
  root.name = 'HarbourMoment';
  ctx.scene.add(root);

  // The sign.
  const canvas = document.createElement('canvas');
  canvas.width = 1400;
  canvas.height = 240;
  const signTex = new THREE.CanvasTexture(canvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 4;
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true, toneMapped: false });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(SIGN_W, SIGN_H), signMat);
  sign.name = 'CrewSign';
  harbour.signAnchor.updateWorldMatrix(true, false);
  const anchor = new THREE.Vector3().setFromMatrixPosition(harbour.signAnchor.matrixWorld);
  sign.position.copy(anchor);
  root.add(sign);
  drawSign(canvas, ctx.text.harbourLine);

  // Lamp glows.
  const glowTex = glowTexture();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true });
  const glows: THREE.Sprite[] = [];
  const lampColor = new THREE.Color('#ffd27a');
  // Remember each lamp's own colour (procedural or from harbour.glb) to restore and blend from.
  const lampBase = harbour.lamps.map((l) => (l.material as THREE.MeshBasicMaterial).color?.clone());
  for (const lamp of harbour.lamps) {
    const s = new THREE.Sprite(glowMat);
    lamp.getWorldPosition(s.position);
    s.scale.setScalar(4);
    root.add(s);
    glows.push(s);
  }
  // Two small glows on the sign, as if lamps hang from it.
  for (const k of [-1, 1]) {
    const s = new THREE.Sprite(glowMat);
    s.position.copy(anchor).add(new THREE.Vector3(k * (SIGN_W / 2 + 0.4), 0.9, 0.3));
    s.scale.setScalar(3);
    root.add(s);
    glows.push(s);
  }

  let sunset = 0;
  return {
    warmup: [root],

    async prepare() {
      // Draw with the real typeface once it is available (falls back to Georgia meanwhile).
      try {
        await document.fonts.load("400 64px 'Sedgwick Ave Display'");
        drawSign(canvas, ctx.text.harbourLine);
        signTex.needsUpdate = true;
      } catch {
        /* keep the fallback drawing */
      }
    },

    update(_frame, weight) {
      sunset = weight * 0.14;
      atmosphere.extraTime = sunset;
      root.visible = weight > 0.01;
      signMat.opacity = Math.min(1, weight * 1.6);
      sign.position.y = anchor.y - (1 - Math.min(1, weight * 1.6)) * 0.6;
      // Lamps switch on in the second half of the approach.
      const on = Math.min(1, Math.max(0, (weight - 0.35) / 0.4));
      glowMat.opacity = on;
      harbour.lamps.forEach((lamp, i) => {
        const m = lamp.material as THREE.MeshStandardMaterial;
        if (m.emissive) m.emissive.copy(lampColor).multiplyScalar(on);
        else if (m.color && lampBase[i]) m.color.copy(lampBase[i]!).lerp(lampColor, on);
      });
    },

    debugInfo: () => `sunset +${sunset.toFixed(2)}`,

    dispose() {
      atmosphere.extraTime = 0;
      harbour.lamps.forEach((lamp, i) => {
        const m = lamp.material as THREE.MeshStandardMaterial;
        if (m.emissive) m.emissive.setRGB(0, 0, 0);
        else if (m.color && lampBase[i]) m.color.copy(lampBase[i]!);
      });
      ctx.scene.remove(root);
      sign.geometry.dispose();
      signMat.dispose();
      signTex.dispose();
      glowMat.dispose();
      glowTex.dispose();
    },
  };
}
