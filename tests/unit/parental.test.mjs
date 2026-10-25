import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const P = createRequire(import.meta.url)('../../app/js/parental.js');

function make(clock = () => 1000) {
  const mem = {};
  return P.create({ get: (k, d) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : d), set: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); } }, clock);
}

test('adult category names are recognised without catching innocent words', () => {
  for (const n of ['XXX', 'Adult Movies', 'ADULTS 18+', '+18', 'Porn HD', 'Erotica', 'NSFW', 'Hentai', 'VIP | Adult']) assert.ok(P.isAdultName(n), n);
  for (const n of ['Essex News', 'Sussex', 'Documentary', 'Kids', 'Action', 'Sports 2018', 'Madulthood', 'Sexton', '']) assert.ok(!P.isAdultName(n), n);
});

test('PIN: 4 digits only, stored hashed, checked, removable', () => {
  const p = make();
  assert.equal(p.hasPin(), false);
  assert.throws(() => p.setPin('12'), /4 digits/);
  assert.throws(() => p.setPin('abcd'), /4 digits/);
  p.setPin('4821');
  assert.equal(p.hasPin(), true);
  assert.equal(p.checkPin('4821'), true);
  assert.equal(p.checkPin('1234'), false);
  assert.equal(p.checkPin(''), false);
});

test('nothing is locked until a PIN exists', () => {
  const p = make();
  assert.equal(p.isLocked('p1', 'live', { id: '1', name: 'XXX' }), false);
  p.toggleLock('p1', 'live', '2');
  assert.equal(p.isLocked('p1', 'live', { id: '2', name: 'News' }), false);
});

test('manual locks are per playlist and per kind; adult names lock automatically (switchable)', () => {
  const p = make();
  p.setPin('1111');
  assert.equal(p.toggleLock('p1', 'live', '7'), true);
  assert.equal(p.isLocked('p1', 'live', { id: '7', name: 'Sports' }), true);
  assert.equal(p.isLocked('p1', 'vod', { id: '7', name: 'Sports' }), false);
  assert.equal(p.isLocked('p2', 'live', { id: '7', name: 'Sports' }), false);
  assert.equal(p.isLocked('p1', 'live', { id: '9', name: 'Adult XXX' }), true, 'auto');
  assert.equal(p.lockedByName({ id: '9', name: 'Adult XXX' }), true);
  p.setAdultLock(false);
  assert.equal(p.isLocked('p1', 'live', { id: '9', name: 'Adult XXX' }), false);
  assert.equal(p.toggleLock('p1', 'live', '7'), false, 'toggling again unlocks');
});

test('unlock lasts 30 minutes and can be ended early', () => {
  let t = 1000;
  const p = make(() => t);
  p.setPin('1111');
  assert.equal(p.isUnlocked(), false);
  p.unlock();
  assert.equal(p.isUnlocked(), true);
  t += 29 * 60000; assert.equal(p.isUnlocked(), true);
  t += 2 * 60000; assert.equal(p.isUnlocked(), false);
  p.unlock(); p.lock();
  assert.equal(p.isUnlocked(), false);
});

test('visible() hides items of locked categories until unlocked', () => {
  const p = make();
  p.setPin('1111');
  p.toggleLock('p1', 'live', 'b');
  const cats = [{ id: 'a', name: 'News' }, { id: 'b', name: 'Sports' }, { id: 'c', name: 'XXX' }];
  const locked = p.lockedIds('p1', 'live', cats);
  assert.deepEqual(Object.keys(locked).sort(), ['b', 'c']);
  const items = [{ cat: 'a', n: 1 }, { cat: 'b', n: 2 }, { cat: 'c', n: 3 }, { cat: 'a', n: 4 }];
  assert.deepEqual(p.visible(items, locked).map((i) => i.n), [1, 4]);
  p.unlock();
  assert.equal(p.visible(items, locked).length, 4);
  assert.equal(p.visible(items, {}).length, 4);
});

test('removing the PIN removes all locks', () => {
  const p = make();
  p.setPin('1111'); p.toggleLock('p1', 'live', '7');
  p.clearPin();
  assert.equal(p.hasPin(), false);
  assert.equal(p.manuallyLocked('p1', 'live', '7'), false);
  p.setPin('2222');
  assert.equal(p.isLocked('p1', 'live', { id: '7', name: 'Sports' }), false, 'old locks do not come back');
});
