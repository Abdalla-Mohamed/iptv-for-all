import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const X = createRequire(import.meta.url)('../../app/js/xmltv.js');

const NOW = Date.UTC(2024, 0, 31, 20, 0, 0);
const MIN = 60000, H = 60 * MIN;

test('parseTime handles offsets, missing seconds/offset and garbage', () => {
  assert.equal(X.parseTime('20240131200000 +0000'), NOW);
  assert.equal(X.parseTime('20240131210000 +0100'), NOW);          // 21:00 in UTC+1 = 20:00 UTC
  assert.equal(X.parseTime('20240131150000 -0500'), NOW);
  assert.equal(X.parseTime('20240131200000'), NOW);                // no offset: UTC
  assert.equal(X.parseTime('202401312000'), NOW);                  // no seconds
  assert.equal(X.parseTime('20240131213000 +0130'), NOW);
  assert.ok(Number.isNaN(X.parseTime('tomorrow')));
});

const xml = (body) => `<?xml version="1.0"?><tv generator-info-name="t">${body}</tv>`;
const prog = (ch, startOffsetMin, lenMin, title, desc = '') => {
  const f = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
  return `<programme start="${f(NOW + startOffsetMin * MIN)}" stop="${f(NOW + (startOffsetMin + lenMin) * MIN)}" channel="${ch}"><title lang="en">${title}</title>${desc ? `<desc>${desc}</desc>` : ''}</programme>`;
};

test('parses programmes, decodes entities and CDATA, keeps them sorted', () => {
  const g = X.parse(xml(
    prog('a.uk', 30, 30, 'Later &amp; Better', '5 &lt; 6 &#233;') +
    prog('a.uk', 0, 30, '<![CDATA[Now <Show>]]>') +
    prog('b.uk', -10, 60, 'B now')), NOW);
  assert.deepEqual(g.programmes['a.uk'].map((p) => p[2]), ['Now <Show>', 'Later & Better']);
  assert.equal(g.programmes['a.uk'][1][3], '5 < 6 é');
  assert.equal(g.programmes['b.uk'].length, 1);
});

test('drops programmes outside the window around now (bounded memory)', () => {
  const g = X.parse(xml(prog('a', -5 * 60, 60, 'old') + prog('a', -30, 60, 'airing') + prog('a', 47 * 60, 30, 'edge') + prog('a', 50 * 60, 30, 'far')), NOW);
  assert.deepEqual(g.programmes.a.map((p) => p[2]), ['airing', 'edge']);
});

test('channel display names are indexed and matched by normalized name', () => {
  const g = X.parse(xml(
    '<channel id="bbc1.uk"><display-name>BBC One HD</display-name><display-name lang="en">BBC 1</display-name></channel>' +
    prog('bbc1.uk', 0, 30, 'News')), NOW);
  assert.equal(X.channelFor(g, { name: 'bbc one hd' }), 'bbc1.uk');
  assert.equal(X.channelFor(g, { name: 'BBC-1' }), 'bbc1.uk');
  assert.equal(X.channelFor(g, { name: 'x', epgId: 'bbc1.uk' }), 'bbc1.uk');
  assert.equal(X.channelFor(g, { name: 'ITV' }), '');
});

test('lookup returns the airing programme first, then upcoming ones, never past ones', () => {
  const g = X.parse(xml(prog('c', -90, 60, 'past') + prog('c', -10, 40, 'now') + prog('c', 30, 30, 'next') + prog('c', 60, 30, 'after')), NOW);
  const l = X.lookup(g, { epgId: 'c' }, NOW, 3);
  assert.deepEqual(l.map((p) => p.title), ['now', 'next', 'after']);
  assert.equal(l[0].start, NOW - 10 * MIN);
  assert.deepEqual(X.lookup(g, { name: 'nobody' }, NOW), []);
});

test('tolerates single-quoted attributes, self-closing tags, missing stop and broken trailing data', () => {
  const g = X.parse(xml(
    `<programme start='20240131200000 +0000' channel='q'><title>No stop</title></programme>` +
    `<channel id="z"/>` +
    `<programme start="20240131203000 +0000" stop="20240131210000 +0000" channel="q"><title>ok</title></programme>` +
    `<programme start="2024013121`), NOW);
  assert.deepEqual(g.programmes.q.map((p) => p[2]), ['No stop', 'ok']);
  assert.equal(g.programmes.q[0][1] - g.programmes.q[0][0], 30 * MIN, 'default 30 min when stop is missing');
});

test('parseAsync yields between slices and gives the same result as parse', async () => {
  let body = '';
  for (let i = 0; i < 4000; i++) body += prog('ch' + (i % 50), (i % 40) * 10 - 20, 30, 'Show ' + i, 'desc ' + i);
  const text = xml(body);
  let yields = 0;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => { yields++; return realSetTimeout(fn, ms, ...a); };
  const slow = await X.parseAsync(text, NOW, 1);
  globalThis.setTimeout = realSetTimeout;
  assert.deepEqual(slow, X.parse(text, NOW));
  assert.ok(yields > 0, 'the parser gave the UI a chance to run');
});
