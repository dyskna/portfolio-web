import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SAIL,
  DEFAULT_TRUE_WIND,
  apparentWind,
  apparentWindAngle,
  bearingFrom,
  length,
  sampleWind,
  trimSail,
  trueWindAt,
  vec,
  windFromMotion,
} from './wind.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const deg = (d: number) => (d * Math.PI) / 180;
const NORTH = vec(0, -1); // boat heading toward -z

test('true wind stays within its configured strength and direction band', () => {
  const p = DEFAULT_TRUE_WIND;
  for (let t = 0; t < 2000; t += 0.7) {
    const w = trueWindAt(t, p);
    const speed = length(w);
    assert.ok(speed >= p.baseSpeed - p.speedVariation - 1e-9 && speed <= p.baseSpeed + p.speedVariation + 1e-9);
    const dir = Math.atan2(w.z, w.x);
    assert.ok(Math.abs(dir - p.baseDirection) <= p.directionVariation + 1e-9);
  }
});

test('true wind drifts slowly: no jumps between frames, real change over a minute', () => {
  let maxStep = 0;
  let prev = trueWindAt(0);
  for (let t = 1 / 60; t < 120; t += 1 / 60) {
    const w = trueWindAt(t);
    maxStep = Math.max(maxStep, length(vec(w.x - prev.x, w.z - prev.z)));
    prev = w;
  }
  assert.ok(maxStep < 0.02, `per-frame change ${maxStep} m/s is too abrupt`);
  const a = trueWindAt(0);
  const b = trueWindAt(30);
  assert.ok(length(vec(a.x - b.x, a.z - b.z)) > 0.2, 'wind should change noticeably over 30 s');
});

test('true wind is deterministic per seed and differs between seeds', () => {
  assert.deepEqual(trueWindAt(12.5), trueWindAt(12.5));
  const other = trueWindAt(12.5, { ...DEFAULT_TRUE_WIND, seed: 99 });
  assert.notDeepEqual(trueWindAt(12.5), other);
});

test('wind from motion is the boat velocity reversed', () => {
  assert.deepEqual(windFromMotion(vec(2, -5)), { x: -2, z: 5 });
  assert.deepEqual(windFromMotion(vec(0, 0)), { x: -0, z: -0 });
});

test('apparent wind is the vector sum of true wind and wind from motion', () => {
  const a = apparentWind(vec(3, 0), windFromMotion(vec(0, -4)));
  assert.deepEqual(a, { x: 3, z: 4 });
  close(length(a), 5);
});

test('when the boat stops, the apparent wind equals the true wind', () => {
  const s = sampleWind(42, vec(0, 0), NORTH);
  close(s.apparent.x, s.trueWind.x);
  close(s.apparent.z, s.trueWind.z);
  close(length(s.motionWind), 0);
});

test('apparent wind angle: ahead, starboard, port, astern', () => {
  // Wind blowing toward +z comes from -z, i.e. from ahead of a boat heading -z.
  close(apparentWindAngle(vec(0, 1), NORTH), 0);
  // Blowing toward -x comes from +x: starboard side when heading -z.
  close(apparentWindAngle(vec(-1, 0), NORTH), Math.PI / 2);
  close(apparentWindAngle(vec(1, 0), NORTH), -Math.PI / 2);
  close(Math.abs(apparentWindAngle(vec(0, -1), NORTH)), Math.PI);
});

test('moving the boat swings the apparent wind forward', () => {
  const trueWind = vec(3, 0); // from port beam
  const still = apparentWindAngle(apparentWind(trueWind, windFromMotion(vec(0, 0))), NORTH);
  const moving = apparentWindAngle(apparentWind(trueWind, windFromMotion(vec(0, -4))), NORTH);
  close(Math.abs(still), Math.PI / 2);
  assert.ok(Math.abs(moving) < Math.abs(still), 'apparent wind should come from further forward');
  close(moving, -Math.atan2(3, 4));
});

test('boom goes to the leeward side and eases out as the wind goes aft', () => {
  const fromPort = trimSail(vec(5, 0), NORTH); // blowing toward +x: from port
  const fromStarboard = trimSail(vec(-5, 0), NORTH);
  assert.ok(fromPort.boomAngle > 0, 'wind from port pushes the boom to starboard');
  assert.ok(fromStarboard.boomAngle < 0);
  close(fromPort.boomAngle, -fromStarboard.boomAngle);

  const closeReach = trimSail(vec(5 * Math.sin(deg(50)), 5 * Math.cos(deg(50))), NORTH);
  const broadReach = trimSail(vec(5 * Math.sin(deg(140)), 5 * Math.cos(deg(140))), NORTH);
  assert.ok(Math.abs(broadReach.boomAngle) > Math.abs(closeReach.boomAngle));
  assert.ok(Math.abs(broadReach.boomAngle) <= DEFAULT_SAIL.maxBoom);
});

test('sail fills with apparent wind strength', () => {
  const beam = (speed: number) => trimSail(vec(speed, 0), NORTH);
  assert.equal(beam(1).fullness, 0);
  assert.ok(beam(4).fullness > beam(3).fullness);
  close(beam(8).fullness, 1);
});

test('head to wind the sail cannot fill, however strong the wind', () => {
  const inIrons = trimSail(vec(0, 9), NORTH);
  assert.equal(inIrons.fullness, 0);
  assert.ok(inIrons.flap > 0.9, 'a slack sail in a strong wind flaps hard');
});

test('scrolling fills the sail; stopping leaves the true wind and a gentle flap', () => {
  const t = 10;
  const forward = vec(0.27, -0.96);
  const norm = length(forward);
  const f = vec(forward.x / norm, forward.z / norm);
  const still = sampleWind(t, vec(0, 0), f);
  const sailing = sampleWind(t, vec(f.x * 6, f.z * 6), f);
  assert.ok(sailing.sail.fullness > 0.6, `fullness while scrolling: ${sailing.sail.fullness}`);
  assert.ok(still.sail.fullness < sailing.sail.fullness);
  assert.ok(still.sail.flap > 0 && still.sail.flap < 0.7, `gentle flap at rest: ${still.sail.flap}`);
});

test('dead calm: no fullness and no flapping', () => {
  const s = trimSail(vec(0, 0), NORTH);
  assert.equal(s.fullness, 0);
  assert.equal(s.flap, 0);
});

test('bearingFrom reports where the wind comes from on a compass', () => {
  close(bearingFrom(vec(0, 1)), 0); // from north (-z)
  close(bearingFrom(vec(-1, 0)), 90); // from east (+x)
  close(bearingFrom(vec(0, -1)), 180);
  close(bearingFrom(vec(1, 0)), 270);
});
