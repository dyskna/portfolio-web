/**
 * Where each chapter's stop sits along the route, as a fraction of its length.
 * Keys are the chapter ids used in the page (data-chapter): 'pier', project ids, 'web', 'about', 'harbour'.
 */
export const STOP_FRACTIONS: Record<string, number> = {
  pier: 0,
  sailing: 0.13,
  chery: 0.27,
  'escape-from-weii': 0.41,
  'multiplayer-sumo': 0.55,
  thesis: 0.69,
  web: 0.765,
  about: 0.84,
  harbour: 1,
};
