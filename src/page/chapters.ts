/**
 * Text colour per chapter, chosen against that stop's colour world:
 * 'dark' = ink text on bright scenes, 'light' = cream text on dark ones.
 * Without the live scene (static picture, list view) the page picks its own.
 */
export type Ink = 'dark' | 'light';

export const CHAPTER_INK: Record<string, Ink> = {
  pier: 'light',
  sailing: 'dark',
  chery: 'light',
  'escape-from-weii': 'dark',
  'multiplayer-sumo': 'light',
  thesis: 'light',
  web: 'light',
  about: 'light',
  harbour: 'light',
};
