import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const TE = createRequire(import.meta.url)('../../app/js/timeentry.js');

const type = (keys) => [...keys].reduce((d, k) => TE.push(d, k), '');

test('digits fill in from the right like a timer', () => {
  assert.equal(TE.format(type('5')), '00:00:05');
  assert.equal(TE.format(type('130')), '00:01:30');
  assert.equal(TE.format(type('12345')), '01:23:45');
  assert.equal(TE.format(type('100000')), '10:00:00');
  assert.equal(TE.format(''), '00:00:00');
});

test('converts to seconds, allowing overflowing fields', () => {
  assert.equal(TE.toSeconds(type('130')), 90);
  assert.equal(TE.toSeconds(type('10000')), 3600);
  assert.equal(TE.toSeconds(type('90')), 90);        // "90" seconds = 1:30
  assert.equal(TE.toSeconds(type('199')), 60 + 99);
  assert.equal(TE.toSeconds(''), 0);
});

test('leading zeros do not consume digits; more than six digits keeps the last six', () => {
  assert.equal(type('0005'), '5');
  assert.equal(type('00'), '');
  assert.equal(type('1234567'), '234567');
});

test('delete removes the last digit', () => {
  assert.equal(TE.pop('130'), '13');
  assert.equal(TE.pop(''), '');
  assert.equal(TE.format(TE.pop(type('130'))), '00:00:13');
});
