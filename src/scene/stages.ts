/**
 * How the camera stages each chapter's stop: pose relative to the boat, where the boat sits
 * horizontally (focusX, so the chart annotations around it stay clear of it), the colour of the
 * brush word, and the chapter's colour world (mood).
 */
import type { MoodName } from './atmosphere';

export interface StagePose {
  /** Metres behind the boat, to port (negative = starboard), above the water. */
  back: number;
  side: number;
  up: number;
  /** Look-at point: metres ahead of the boat and its height. */
  ahead: number;
  lookUp: number;
}

export interface StageConfig {
  focusX: number;
  pose: StagePose;
  wordColor: string;
  mood?: MoodName;
  /** Has a buoy that the map label points at. */
  buoy: boolean;
}

/** Camera while sailing between stops. */
export const FOLLOW_POSE: StagePose = { back: 22, side: 0, up: 8, ahead: 16, lookUp: 2 };
/** A low, close shot: boat in front, brush word standing on the water behind it. */
const STOP_POSE: StagePose = { back: 19, side: 3, up: 4.4, ahead: 18, lookUp: 5.4 };
/** Pulled back and up so the harbour, its sign and the sunset sky fit. */
const HARBOUR_POSE: StagePose = { back: 36, side: 0, up: 13, ahead: 16, lookUp: 8 };

export const STAGES: Record<string, StageConfig> = {
  pier: { focusX: 0.64, pose: FOLLOW_POSE, wordColor: '#f5eadb', buoy: false },
  // Project stops: boat in the middle, notes around it (title top left, design bottom left, code bottom right).
  sailing: { focusX: 0.5, pose: STOP_POSE, wordColor: '#f5eadb', buoy: true },
  chery: { focusX: 0.5, pose: STOP_POSE, wordColor: '#ffe9c9', mood: 'dusk', buoy: true },
  'escape-from-weii': { focusX: 0.5, pose: STOP_POSE, wordColor: '#f5eadb', mood: 'fog', buoy: true },
  'multiplayer-sumo': { focusX: 0.5, pose: STOP_POSE, wordColor: '#f5eadb', mood: 'night', buoy: true },
  thesis: { focusX: 0.5, pose: STOP_POSE, wordColor: '#f5eadb', mood: 'violet', buoy: true },
  web: { focusX: 0.5, pose: STOP_POSE, wordColor: '#f5eadb', buoy: true },
  about: { focusX: 0.5, pose: STOP_POSE, wordColor: '#f5eadb', buoy: false },
  harbour: { focusX: 0.42, pose: HARBOUR_POSE, wordColor: '#f5eadb', buoy: false },
};
