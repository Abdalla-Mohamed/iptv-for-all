import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { policy, chunkSize, plan, supported, START_AHEAD } = createRequire(import.meta.url)('../../app/js/cache-player.js');

const MB = 1024 * 1024;
const base = { autoPaused: false, paused: false, hasPlayed: true, ahead: 20, remaining: 3000, drained: false, plan: plan(128 * MB, 59 * 1024) };

test('plan: read-ahead and back buffer scale with the byte budget and the stream bitrate', () => {
  const small = plan(64 * MB, 600 * 1024), big = plan(256 * MB, 600 * 1024), lowRate = plan(64 * MB, 60 * 1024);
  assert.ok(big.target > small.target);
  assert.ok(lowRate.target > small.target);
  assert.ok(small.back < small.target);
  assert.ok(small.resume >= 12 && small.resume <= 30);
  assert.equal(plan(1 * MB, 60 * 1024).target >= 10, true);      // never absurdly small
  assert.equal(plan(10 * 1024 * MB, 16 * 1024).target <= 3600, true);
});

test('policy: waits for a short preroll before the first play, then resumes', () => {
  const first = { ...base, autoPaused: true, hasPlayed: false, ahead: 2 };
  assert.equal(policy(first), null);
  assert.equal(policy({ ...first, ahead: START_AHEAD }), 'resume');
});

test('policy: after an underrun it refills to the larger threshold, not just the preroll', () => {
  const refill = { ...base, autoPaused: true, ahead: START_AHEAD + 1 };
  assert.equal(policy(refill), null);
  assert.equal(policy({ ...refill, ahead: base.plan.resume }), 'resume');
});

test('policy: pauses to refill when the cache runs dry while playing', () => {
  assert.equal(policy({ ...base, ahead: 0.1 }), 'pause');
  assert.equal(policy({ ...base, ahead: 5 }), null);
});

test('policy: never fights the user or the end of the file', () => {
  assert.equal(policy({ ...base, ahead: 0, paused: true }), null);              // user paused
  assert.equal(policy({ ...base, ahead: 0, drained: true }), null);             // nothing more can arrive
  assert.equal(policy({ ...base, ahead: 0, remaining: 0.5 }), null);            // credits: let it finish
  assert.equal(policy({ ...base, autoPaused: true, ahead: 0, drained: true }), 'resume');
  assert.equal(policy({ ...base, autoPaused: true, ahead: 3, remaining: 3.2 }), 'resume'); // only 3 s left: play them
  assert.equal(policy({ ...base, hasPlayed: false, ahead: 0 }), null);          // before the first play: not an underrun
});

test('chunkSize: adapts to throughput and respects the remaining budget, always an integer', () => {
  assert.equal(chunkSize(0), 512 * 1024);
  assert.equal(chunkSize(20 * 1024), 128 * 1024);                 // slow link -> small, frequent deliveries
  assert.equal(chunkSize(50 * MB), 2 * MB);                       // fast link -> capped
  assert.equal(chunkSize(50 * MB, 300000.7), 300000);             // budget cap, fractional input
  assert.equal(chunkSize(50 * MB, -1000), 128 * 1024);            // over budget: still make progress
  for (const room of [1.5, 99999.99, 1e9 + 0.5]) assert.ok(Number.isInteger(chunkSize(777777, room)));
});

test('supported: only MP4-family URLs, and only when MSE + mp4box exist', () => {
  assert.equal(supported('http://x/a.mp4'), false);               // no MediaSource in Node
});
