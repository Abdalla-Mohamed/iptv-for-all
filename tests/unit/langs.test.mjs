import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const L = createRequire(import.meta.url)('../../app/js/langs.js');

test('key: codes, regional variants and names all resolve to the same language', () => {
  for (const s of ['ar', 'ara', 'ARA', 'ar-SA', 'ar_EG', 'Arabic', 'Arabic (5.1)', ' arabic ']) assert.equal(L.key(s), 'ar', s);
  for (const s of ['fr', 'fra', 'fre', 'fr-CA', 'French', 'Français']) assert.equal(L.key(s), 'fr', s);
  assert.equal(L.key('eng'), 'en');
  assert.equal(L.key('English (commentary)'), 'en');
  assert.equal(L.key('de'), 'de');
});

test('key: unknown or empty input gives an empty key (never a false match)', () => {
  assert.equal(L.key(''), '');
  assert.equal(L.key(null), '');
  assert.equal(L.key('xx'), '');
  assert.equal(L.key('Track 3'), '');
  assert.equal(L.key('und'), '');
});

test('ofTrack prefers the language field, then falls back to the label/name', () => {
  assert.equal(L.ofTrack({ lang: 'ara', label: 'Stereo' }), 'ar');
  assert.equal(L.ofTrack({ label: 'English 5.1' }), 'en');
  assert.equal(L.ofTrack({ name: 'Deutsch' }), 'de');
  assert.equal(L.ofTrack({ label: 'Commentary' }), '');
});

test('pick finds the first track in the preferred language, else -1', () => {
  const tracks = [{ lang: 'eng' }, { lang: 'ara', label: 'Arabic' }, { lang: 'ar' }];
  assert.equal(L.pick(tracks, 'ar'), 1);
  assert.equal(L.pick(tracks, 'en'), 0);
  assert.equal(L.pick(tracks, 'fr'), -1);
  assert.equal(L.pick(tracks, ''), -1);
});

test('label is readable for codes, names and unknowns', () => {
  assert.equal(L.label({ lang: 'ara' }, 0), 'Arabic');
  assert.equal(L.label({ lang: 'eng', label: 'English' }, 0), 'English');
  assert.equal(L.label({ lang: 'eng', label: 'Director commentary' }, 1), 'English (Director commentary)');
  assert.equal(L.label({}, 2), 'Track 3');
  assert.equal(L.label({ label: 'Stereo' }, 0), 'Stereo');
  assert.equal(L.label({ lang: 'ara', label: 'SoundHandler' }, 0), 'Arabic', 'muxer handler names are ignored');
  assert.equal(L.label({ label: 'Core Media Audio' }, 1), 'Track 2');
});

test('OPTIONS starts with "None" and has unique values', () => {
  assert.equal(L.OPTIONS[0].value, '');
  const values = L.OPTIONS.map((o) => o.value);
  assert.equal(new Set(values).size, values.length);
  assert.ok(values.includes('ar') && values.includes('en'));
});
