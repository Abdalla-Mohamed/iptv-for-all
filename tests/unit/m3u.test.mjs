import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { parse, buildLibrary, kindOf } = createRequire(import.meta.url)('../../app/js/m3u.js');

test('parses attributes, names with commas, and EPG url', () => {
  const { items, epgUrl } = parse([
    '﻿#EXTM3U x-tvg-url="http://epg.example/guide.xml"',
    '#EXTINF:-1 tvg-id="bbc1" tvg-logo="http://l/x.png" group-title="UK, News",BBC One, HD',
    'http://s.example/live/1.m3u8',
    ''
  ].join('\r\n'));
  assert.equal(epgUrl, 'http://epg.example/guide.xml');
  assert.equal(items.length, 1);
  assert.deepEqual(
    { name: items[0].name, group: items[0].group, logo: items[0].logo, tvgId: items[0].tvgId },
    { name: 'BBC One, HD', group: 'UK, News', logo: 'http://l/x.png', tvgId: 'bbc1' }
  );
});

test('handles EXTGRP, VLC option lines, header suffixes and bare URLs', () => {
  const { items } = parse([
    '#EXTM3U',
    '#EXTINF:-1,Chan A', '#EXTGRP:Sports', '#EXTVLCOPT:http-user-agent=x', 'http://s/a.ts|User-Agent=Foo',
    'http://s/path/plain-stream.m3u8?token=1'
  ].join('\n'));
  assert.equal(items[0].group, 'Sports');
  assert.equal(items[0].url, 'http://s/a.ts');
  assert.equal(items[1].name, 'plain-stream.m3u8');
});

test('keeps a URL containing | that is not a header suffix', () => {
  const { items } = parse('#EXTINF:-1,x\nhttp://s/a|b/c.m3u8\n');
  assert.equal(items[0].url, 'http://s/a|b/c.m3u8');
});

test('classifies live / vod / series by URL', () => {
  assert.equal(kindOf('http://s/live/u/p/1.m3u8'), 'live');
  assert.equal(kindOf('http://s/movie/u/p/1.mkv'), 'vod');
  assert.equal(kindOf('http://s/files/film.mp4?x=1'), 'vod');
  assert.equal(kindOf('http://s/series/u/p/1.mp4'), 'series');
});

test('buildLibrary groups by category in first-seen order with counts and stable keys', () => {
  const { items } = parse([
    '#EXTM3U',
    '#EXTINF:-1 group-title="B",One', 'http://s/1',
    '#EXTINF:-1 group-title="A",Two', 'http://s/2',
    '#EXTINF:-1 group-title="B",Three', 'http://s/3',
    '#EXTINF:-1,NoGroup', 'http://s/4',
    '#EXTINF:-1 group-title="Films",Movie', 'http://s/movie/u/p/9.mp4'
  ].join('\n'));
  const lib = buildLibrary(items);
  assert.deepEqual(lib.live.cats.map((c) => [c.id, c.count]), [['B', 2], ['A', 1], ['Uncategorized', 1]]);
  assert.equal(lib.live.byCat.B.length, 2);
  assert.equal(lib.vod.items.length, 1);
  assert.equal(lib.series.items.length, 0);
  assert.deepEqual(lib.live.items.map((i) => i.num), [1, 2, 3, 4]);
  assert.equal(buildLibrary(items).live.items[0].key, lib.live.items[0].key);
});

test('honours tvg-chno for channel numbers', () => {
  const lib = buildLibrary(parse('#EXTINF:-1 tvg-chno="101",A\nhttp://s/a\n').items);
  assert.equal(lib.live.items[0].num, 101);
});
