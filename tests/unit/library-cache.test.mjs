import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LC = require('../../app/js/library-cache.js');
const { Provider } = require('../../app/js/xtream.js');

const H = 3600 * 1000;

test('isStale: manual / every start / n hours', () => {
  const now = 1_000_000_000_000;
  assert.equal(LC.isStale(now - 99 * H, -1, now), false);       // manual: never automatic
  assert.equal(LC.isStale(now, 0, now), true);                  // every start
  assert.equal(LC.isStale(now - 5 * H, 6, now), false);
  assert.equal(LC.isStale(now - 7 * H, 6, now), true);
  assert.equal(LC.isStale(0, 6, now), true);                    // unknown age
});

test('age labels', () => {
  const now = 1_000_000_000_000;
  assert.equal(LC.age(now - 30 * 1000, now), 'just now');
  assert.equal(LC.age(now - 20 * 60000, now), '20 min ago');
  assert.equal(LC.age(now - 3 * H, now), '3 h ago');
  assert.equal(LC.age(now - 72 * H, now), '3 days ago');
});

test('MemoryStore: get/set/removePrefix/clear', async () => {
  const s = new LC.MemoryStore();
  await s.set('pl:a:live', 1); await s.set('pl:a:vod', 2); await s.set('pl:b:live', 3);
  assert.equal(await s.get('pl:a:vod'), 2);
  assert.equal(await s.get('nope'), null);
  await s.removePrefix('pl:a:');
  assert.equal(await s.get('pl:a:live'), null);
  assert.equal(await s.get('pl:b:live'), 3);
  await s.clear();
  assert.equal(await s.get('pl:b:live'), null);
});

// ---- Xtream provider with a saved copy -------------------------------------------------------------------

function world({ refreshHours = 6, now = () => Date.now() } = {}) {
  const store = new LC.MemoryStore();
  const state = { names: ['A', 'B'], down: false, calls: 0 };
  const http = {
    getJSON: async (url) => {
      state.calls++;
      if (state.down) throw new Error('boom');
      if (/get_live_categories/.test(url)) return [{ category_id: '1', category_name: 'News' }];
      if (/get_live_streams/.test(url)) return state.names.map((n, i) => ({ num: i + 1, name: n, stream_id: i + 1, category_id: '1' }));
      return [];
    }
  };
  const make = () => {
    const p = new Provider({ id: 'p1', server: 'http://x', username: 'u', password: 'p' },
      { http, getSettings: () => ({ refreshHours }), store, isStale: (at, h) => LC.isStale(at, h, now()), age: LC.age });
    p.notices = []; p.refreshes = [];
    p.onNotice = (m) => p.notices.push(m);
    p.onRefresh = (k, sec) => p.refreshes.push([k, sec]);
    return p;
  };
  return { store, state, make };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test('first start downloads and saves; the next start is served from the saved copy without any request', async () => {
  const w = world();
  const first = await w.make().ensure('live');
  assert.equal(first.items.length, 2);
  assert.equal(w.state.calls, 2);
  await tick();
  const p2 = w.make();
  const again = await p2.ensure('live');
  assert.deepEqual(again.items.map((i) => i.name), ['A', 'B']);
  assert.equal(again.byCat['1'].length, 2, 'byCat is rebuilt from the saved copy');
  assert.equal(w.state.calls, 2, 'no network on the second start');
  assert.ok(p2.age('live') > 0);
});

test('a stale copy is shown instantly and refreshed in the background', async () => {
  let skew = 0;
  const w = world({ refreshHours: 6, now: () => Date.now() + skew });
  await w.make().ensure('live');
  await tick();
  skew += 7 * H;
  w.state.names = ['A', 'B', 'C'];
  const p = w.make();
  const sec = await p.ensure('live');
  assert.equal(sec.items.length, 2, 'instant answer is the saved copy');
  await tick(); await tick();
  assert.equal(p.refreshes.length, 1);
  assert.equal(p.refreshes[0][1].items.length, 3, 'background refresh delivers the new catalog');
  assert.equal((await p.ensure('live')).items.length, 3);
});

test('refresh = manual never goes to the network by itself', async () => {
  let skew = 0;
  const w = world({ refreshHours: -1, now: () => Date.now() + skew });
  await w.make().ensure('live');
  await tick();
  skew += 999 * H;
  const calls = w.state.calls;
  await w.make().ensure('live');
  await tick();
  assert.equal(w.state.calls, calls);
});

test('manual reload goes to the network first; if the provider is down the saved copy is used with a notice', async () => {
  const w = world();
  await w.make().ensure('live');
  await tick();
  const p = w.make();
  w.state.names = ['Z'];
  p.reset();
  assert.deepEqual((await p.ensure('live')).items.map((i) => i.name), ['Z'], 'reload fetched fresh data');
  await tick();

  const q = w.make();
  w.state.down = true;
  q.reset();
  const sec = await q.ensure('live');
  assert.deepEqual(sec.items.map((i) => i.name), ['Z'], 'fell back to the saved copy');
  assert.match(q.notices[0], /not reachable.*saved/i);
});

test('no saved copy and the provider is down: the error is reported, and a later retry works', async () => {
  const w = world();
  w.state.down = true;
  const p = w.make();
  await assert.rejects(p.ensure('live'), /boom/);
  w.state.down = false;
  assert.equal((await p.ensure('live')).items.length, 2);
});

test('removing the prefix drops the saved copy (edited or deleted playlist)', async () => {
  const w = world();
  await w.make().ensure('live');
  await tick();
  await w.store.removePrefix('pl:p1:');
  const calls = w.state.calls;
  await w.make().ensure('live');
  assert.equal(w.state.calls, calls + 2, 'downloaded again');
});
