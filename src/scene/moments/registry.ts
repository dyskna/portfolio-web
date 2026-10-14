/**
 * Which moment belongs to which stop (by project id from content.ts).
 * Each moment is its own chunk, loaded and warmed up before the scene fades in.
 * Remove a line here and the page simply runs without that moment.
 */
import type { MomentModule } from './types';

export interface MomentEntry {
  id: string;
  /** Project id from content.ts, 'web', or 'harbour' for the end of the route. */
  anchor: string;
  load: () => Promise<MomentModule>;
  /** Distance (m) from the anchor at which the effect is at full strength / fades to nothing. */
  full: number;
  fade: number;
}

export const MOMENTS: MomentEntry[] = [
  { id: 'pixel-art', anchor: 'chery', load: () => import('./pixelArt'), full: 8, fade: 14 },
  { id: 'fog-door', anchor: 'escape-from-weii', load: () => import('./fogDoor'), full: 8, fade: 14 },
  { id: 'ghost-boat', anchor: 'multiplayer-sumo', load: () => import('./ghostBoat'), full: 8, fade: 14 },
  { id: 'agent-boat', anchor: 'thesis', load: () => import('./agentBoat'), full: 8, fade: 14 },
  { id: 'web-net', anchor: 'web', load: () => import('./fishingNet'), full: 8, fade: 14 },
  { id: 'harbour', anchor: 'harbour', load: () => import('./harbour'), full: 16, fade: 45 },
];
