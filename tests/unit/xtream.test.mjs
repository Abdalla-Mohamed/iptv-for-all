import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { Provider, normalizeServer } = createRequire(import.meta.url)('../../app/js/xtream.js');

function make(responses, settings = {}) {
  const calls = [];
  const http = {
    getJSON: async (url) => {
      calls.push(url);
      const action = /action=(\w+)/.exec(url);
      const r = responses[action ? action[1] : ''];
      if (r instanceof Error) throw r;
      return r;
    }
  };
  const p = new Provider({ server: 'demo.tv:8080/c/', username: 'u s', password: 'p&1' }, { http, getSettings: () => settings });
  return { p, calls };
}

test('normalizes server addresses', () => {
  assert.equal(normalizeServer('demo.tv:8080/c/'), 'http://demo.tv:8080');
  assert.equal(normalizeServer(' https://x.io/player_api.php?username=a '), 'https://x.io');
  assert.equal(normalizeServer('http://x.io///'), 'http://x.io');
  assert.equal(normalizeServer(''), '');
});

test('builds stream URLs with encoded credentials', () => {
  const { p } = make({});
  assert.equal(p.urlFor({ kind: 'live', id: '7' }), 'http://demo.tv:8080/live/u%20s/p%261/7.m3u8');
  assert.ok(make({}, { liveFormat: 'ts' }).p.urlFor({ kind: 'live', id: '7' }).endsWith('/7.ts'));
  assert.equal(p.urlFor({ kind: 'vod', id: '9', ext: 'mkv' }), 'http://demo.tv:8080/movie/u%20s/p%261/9.mkv');
  assert.equal(p.urlFor({ kind: 'episode', id: '5' }), 'http://demo.tv:8080/series/u%20s/p%261/5.mp4');
  assert.throws(() => p.urlFor({ kind: 'series' }));
});

test('login rejects bad credentials and expired accounts, accepts active ones', async () => {
  await assert.rejects(make({ '': { user_info: { auth: 0 } } }).p.login(), /wrong username/);
  await assert.rejects(make({ '': { user_info: { auth: 1, status: 'Expired' } } }).p.login(), /expired/);
  const ok = await make({ '': { user_info: { auth: 1, status: 'Active', exp_date: '1900000000', max_connections: '2' } } }).p.login();
  assert.equal(ok.maxConnections, 2);
  assert.equal(ok.expires.getTime(), 1900000000000);
});

test('ensure() normalizes live streams, hides empty categories, adds Uncategorized, caches', async () => {
  const { p, calls } = make({
    get_live_categories: [{ category_id: '1', category_name: 'News' }, { category_id: '2', category_name: 'Empty' }],
    get_live_streams: [
      { num: 1, name: 'A', stream_id: 10, category_id: '1', stream_icon: 'x.png', epg_channel_id: 'a.uk' },
      { num: 2, name: 'B', stream_id: 11, category_id: null },
      { name: 'C', stream_id: 12, category_id: '99' }
    ]
  });
  const sec = await p.ensure('live');
  assert.deepEqual(sec.cats.map((c) => c.name), ['News', 'Uncategorized', 'Uncategorized']);
  assert.equal(sec.items[0].key, 'x:live:10');
  assert.equal(sec.byCat['1'].length, 1);
  assert.equal(sec.items[2].num, 3);           // falls back to position when "num" is missing
  await p.ensure('live');
  assert.equal(calls.length, 2);               // categories + streams, fetched once
});

test('tolerates panels that return objects or false instead of arrays', async () => {
  const { p } = make({ get_vod_categories: false, get_vod_streams: { a: { name: 'M', stream_id: 1, category_id: '5', container_extension: 'mkv' } } });
  const sec = await p.ensure('vod');
  assert.equal(sec.items[0].ext, 'mkv');
  assert.equal(sec.cats.length, 1);
});

test('a failed section load can be retried', async () => {
  const { p } = make({ get_series_categories: new Error('boom'), get_series: [] });
  await assert.rejects(p.ensure('series'), /boom/);
  await assert.rejects(p.ensure('series'), /boom/);
});

test('seriesInfo orders seasons numerically and maps episodes', async () => {
  const { p } = make({
    get_series_info: {
      info: { name: 'Show', plot: 'P' },
      episodes: {
        10: [{ id: 1, title: 'x', episode_num: 1, container_extension: 'mkv', info: { duration_secs: 60 } }],
        2: [{ id: 2, episode_num: 3 }]
      }
    }
  });
  const info = await p.seriesInfo({ id: '1', name: 'Show' });
  assert.deepEqual(info.seasons.map((s) => s.num), [2, 10]);
  assert.equal(info.seasons[0].episodes[0].name, 'Episode 3');
  assert.equal(info.seasons[1].episodes[0].duration, 60);
  assert.equal(p.urlFor(info.seasons[1].episodes[0]), 'http://demo.tv:8080/series/u%20s/p%261/1.mkv');
});

test('epg decodes base64 UTF-8 and caches per channel', async () => {
  const title = Buffer.from('Café News').toString('base64');
  const { p, calls } = make({ get_short_epg: { epg_listings: [{ title, description: '', start_timestamp: '100', stop_timestamp: '200' }] } });
  const list = await p.epg({ id: '5' });
  assert.deepEqual(list, [{ title: 'Café News', desc: '', start: 100000, end: 200000 }]);
  await p.epg({ id: '5' });
  assert.equal(calls.length, 1);
});
