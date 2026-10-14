import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKeys, follow, stageWeight, targetS, type Stop } from './voyage.ts';

const stops: Stop[] = [
  { holdStart: 0, holdEnd: 500, s: 0 },
  { holdStart: 1500, holdEnd: 2200, s: 60 },
  { holdStart: 3200, holdEnd: 3900, s: 120 },
];
const keys = buildKeys(stops, 3, 120);

test('keys increase in scroll and in distance', () => {
  for (let i = 1; i < keys.length; i++) {
    assert.ok(keys[i].y > keys[i - 1].y);
    assert.ok(keys[i].s >= keys[i - 1].s);
  }
});

test('the boat drifts only a few metres around a stop while its chapter holds', () => {
  for (let y = 1500; y <= 2200; y += 50) {
    const s = targetS(keys, y);
    assert.ok(Math.abs(s - 60) <= 3 + 1e-9, `s=${s} at y=${y}`);
  }
});

test('between holds the boat sails from one stop to the next', () => {
  assert.equal(targetS(keys, 500), 3);
  assert.equal(targetS(keys, 1500), 57);
  const mid = targetS(keys, 1000);
  assert.ok(mid > 3 && mid < 57);
});

test('distances clamp to the route at both ends', () => {
  assert.equal(targetS(keys, -100), 0);
  assert.equal(targetS(keys, 99999), 120);
});

test('stage weight is 1 during the hold, 0 far away, eased in between', () => {
  const stop = stops[1];
  assert.equal(stageWeight(stop, 1800, 300), 1);
  assert.equal(stageWeight(stop, 1000, 300), 0);
  assert.equal(stageWeight(stop, 2600, 300), 0);
  const easing = stageWeight(stop, 1350, 300);
  assert.ok(easing > 0 && easing < 1);
});

test('overlapping or inverted holds still give a monotonic voyage', () => {
  const messy = buildKeys(
    [
      { holdStart: 100, holdEnd: 90, s: 10 },
      { holdStart: 95, holdEnd: 300, s: 5 },
    ],
    3,
    50,
  );
  for (let i = 1; i < messy.length; i++) {
    assert.ok(messy[i].y > messy[i - 1].y);
    assert.ok(messy[i].s >= messy[i - 1].s);
  }
});

test('a jump in the stage weight eases in instead of stepping', () => {
  const f = { value: 0, velocity: 0 };
  follow(f, 0.5, 1 / 60, 6);
  assert.ok(f.value > 0 && f.value < 0.05, `first frame moved to ${f.value}`);
  for (let i = 0; i < 120; i++) follow(f, 0.5, 1 / 60, 6);
  assert.ok(Math.abs(f.value - 0.5) < 1e-3, `settled at ${f.value}`);
});

test('the eased weight never overshoots, at any frame rate', () => {
  for (const dt of [1 / 144, 1 / 60, 1 / 20, 0.25]) {
    const f = { value: 0, velocity: 0 };
    let prev = 0;
    for (let t = 0; t < 3; t += dt) {
      follow(f, 1, dt, 6);
      assert.ok(f.value <= 1 + 1e-9 && f.value >= prev - 1e-9, `dt=${dt}: ${prev} → ${f.value}`);
      prev = f.value;
    }
    assert.ok(f.value > 0.99, `dt=${dt}: reached ${f.value}`);
  }
});
