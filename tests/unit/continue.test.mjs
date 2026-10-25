import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const C = createRequire(import.meta.url)('../../app/js/continue.js');

const movie = (id, extra = {}) => ({ key: 'x:vod:' + id, seconds: 600, at: 1000 - id, duration: 6000, meta: { kind: 'vod', id: String(id), name: 'Movie ' + id, logo: 'l.png', ext: 'mp4', cat: '1' }, ...extra });
const ep = (series, id, extra = {}) => ({ key: 'x:ep:' + id, seconds: 300, at: 2000 - id, duration: 1500,
  meta: { kind: 'episode', id: String(id), name: 'S1E' + id, ext: 'mkv', series: { id: String(series), name: 'Show ' + series, logo: 's.png' }, ...extra } });

test('movies: newest first, with progress, prefers the live catalog item', () => {
  const catalog = { id: '2', key: 'x:vod:2', kind: 'vod', name: 'Movie 2 (renamed)', logo: 'new.png', cat: '9', ext: 'mkv' };
  const list = C.items([movie(1), movie(2)], 'vod', { 'x:vod:2': catalog });
  assert.deepEqual(list.map((i) => i.name), ['Movie 1', 'Movie 2 (renamed)']);
  assert.equal(list[0].progress, 0.1);
  assert.equal(list[0].resumeAt, 600);
  assert.equal(catalog.progress, undefined, 'the catalog object is not mutated');
});

test('movies: still listed if the catalog no longer has it (built from the saved metadata)', () => {
  const [it] = C.items([movie(7)], 'vod', {});
  assert.deepEqual({ id: it.id, kind: it.kind, name: it.name, ext: it.ext }, { id: '7', kind: 'vod', name: 'Movie 7', ext: 'mp4' });
});

test('series: only the latest unfinished episode per series, shown as an episode that points at its series', () => {
  const list = C.items([ep(1, 13), ep(2, 21), ep(1, 12)], 'series', {});
  assert.equal(list.length, 2);
  assert.equal(list[0].kind, 'episode');
  assert.equal(list[0].key, 'x:ep:13');
  assert.equal(list[0].name, 'Show 1  ·  S1E13');
  assert.deepEqual(list[0].series, { id: '1', name: 'Show 1', logo: 's.png' });
});

test('kinds do not leak into each other; entries without metadata (old data) are skipped', () => {
  const entries = [movie(1), ep(1, 5), { key: 'old', seconds: 50, at: 1, duration: 0, meta: null }];
  assert.equal(C.items(entries, 'vod', {}).length, 1);
  assert.equal(C.items(entries, 'series', {}).length, 1);
});

test('progress fraction is clamped and zero when the duration is unknown', () => {
  assert.equal(C.fraction({ seconds: 50, duration: 0 }), 0);
  assert.equal(C.fraction({ seconds: 5000, duration: 100 }), 1);
});

test('metaFor keeps just what is needed to show the title again', () => {
  const m = C.metaFor({ kind: 'episode', id: '5', name: 'E', logo: 'x', ext: 'mp4', junk: 1 }, { id: '1', name: 'S' });
  assert.deepEqual(Object.keys(m).sort(), ['cat', 'ext', 'id', 'kind', 'logo', 'name', 'series']);
});
