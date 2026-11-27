import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AURA_SIZE, AuraFrames } from '../src/aura.js';

function rgb(frame: Uint8Array, x: number, y: number) {
  const i = (y * AURA_SIZE + x) * 4;
  return [frame[i], frame[i + 1], frame[i + 2]] as const;
}

const lum = (c: readonly [number, number, number]) => c[0] + c[1] + c[2];

test('the aura is a bright orb on a dark field, and speaking expands it', () => {
  const frames = new AuraFrames();
  const mid = AURA_SIZE / 2;
  const idle = Uint8Array.from(frames.render('idle', 8));
  assert.equal(idle.length, AURA_SIZE * AURA_SIZE * 4);

  const center = rgb(idle, mid, mid);
  const corner = rgb(idle, 8, 8);
  const halo = rgb(idle, mid, mid - 150);
  assert.ok(lum(center) > 650, `center should glow, got ${center}`);
  assert.ok(lum(corner) < 80, `corner should be dark, got ${corner}`);
  assert.ok(lum(center) > lum(halo), 'the core is brighter than the outer glow');

  const speaking = frames.render('speaking', 3);
  const speakHalo = rgb(speaking, mid, mid - 150);
  assert.ok(lum(speakHalo) > lum(halo) + 40, `speaking should lift the aura, idle ${halo} speaking ${speakHalo}`);
});
