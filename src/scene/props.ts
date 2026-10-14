/**
 * Shared types for the shore props. The procedural cabin and harbour are built in village.ts;
 * models.ts can swap either group for a Blender model.
 */
import type * as THREE from 'three';

export interface HarbourParts {
  group: THREE.Group;
  /** Lanterns that the harbour moment switches on at sunset. */
  lamps: THREE.Mesh[];
  /** Where the "Want to be my crewmate?" sign hangs (world position, facing +z). */
  signAnchor: THREE.Object3D;
}
