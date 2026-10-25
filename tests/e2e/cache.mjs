// Smart-cache scenarios against the mock server (bandwidth throttling, tiny cache budgets, seeks, moov-at-end files).
//   node tests/e2e/cache.mjs            (needs `npm run mock:media`, playwright + Chromium)
//   SLOW=1 node tests/e2e/cache.mjs     also runs the ~90 s mid-playback underrun scenario
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const PORT = 8124, BASE = `http://localhost:${PORT}`;
const server = spawn('node', ['tools/mock-server.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const step = (m) => console.log('  ✓ ' + m);
const throttle = (kbps) => page.request.get(`${BASE}/__throttle?kbps=${kbps}`);

await page.goto(BASE);
await page.evaluate((base) => {
  IPTV.Store.savePlaylist({ id: 'p1', type: 'xtream', name: 'x', server: base, username: 'demo', password: 'demo' });
  IPTV.Store.setActiveId('p1');
}, BASE);
await page.reload();
await page.waitForSelector('.row-live');

const open = (id, { mb = 128, ext = 'mp4' } = {}) => page.evaluate(({ id, mb, ext }) => {
  IPTV.Store.setSetting('cacheMb', mb);
  while (IPTV.Router.stack.length > 2) IPTV.Router.pop();
  const item = { id: String(id), kind: 'vod', ext, key: 'x:vod:' + id, name: 'Test ' + id };
  const pl = IPTV.Store.playlists()[0];
  IPTV.Router.push(IPTV.Screens.Player(), { list: [item], index: 0, provider: IPTV.createProvider(pl), playlist: pl, kind: 'vod' });
}, { id, mb, ext });
const snap = () => page.evaluate(() => {
  const v = document.getElementById('video'), c = IPTV.Engine.cache, b = v.buffered, ranges = [];
  for (let i = 0; i < b.length; i++) ranges.push([b.start(i), b.end(i)]);
  return { t: v.currentTime, paused: v.paused, ranges, cache: !!c, auto: c && c.autoPaused, eof: c && c.eof, blob: v.src.startsWith('blob:'),
           text: (document.querySelector('.p-spintext') || { textContent: '' }).textContent, closed: !document.querySelector('.screen.player') };
});
const seek = (t) => page.evaluate((t) => { document.getElementById('video').currentTime = t; }, t);
const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout });
const playing = (min) => until((m) => { const v = document.getElementById('video'); return !v.paused && v.currentTime > m; }, min);
const span = (r) => r.reduce((n, x) => n + x[1] - x[0], 0);

try {
  // 1. plain start, whole file cached, MKV falls back to the native pipeline
  await open(5001);
  await playing(1);
  let s = await snap();
  assert.ok(s.cache && s.blob, 'MSE path');
  step('MP4 uses the smart cache');

  await open(5005, { ext: 'mkv' });                              // .mkv URL -> not eligible
  await playing(0.5);
  s = await snap();
  assert.ok(!s.cache && !s.blob, 'native path for MKV');
  step('MKV plays through the native pipeline');

  await open(5001, { mb: 0 });                                   // cache switched off in Settings
  await playing(0.5);
  assert.ok(!(await snap()).cache);
  step('cache can be switched off');

  // 2. moov at the end of the file
  await open(5012);
  await until(() => { const v = document.getElementById('video'); return v.buffered.length && v.buffered.end(0) > 100; });
  s = await snap();
  assert.equal(s.ranges.length, 1, 'no holes: ' + JSON.stringify(s.ranges));
  step('moov-at-the-end MP4 is cached without gaps');

  // 3. tiny budget: memory stays bounded, far seeks and seeks after EOF re-position the download
  await open(5001, { mb: 1 });
  await playing(1);
  await page.waitForTimeout(1500);
  s = await snap();
  assert.ok(span(s.ranges) < 30, 'budget respected: cached ' + span(s.ranges) + ' s');
  step(`1 MB budget keeps only ${span(s.ranges).toFixed(0)} s cached`);

  await seek(90);
  await until(() => { const v = document.getElementById('video'); return !v.paused && v.currentTime > 91; });
  s = await snap();
  assert.ok(s.ranges.every((r) => r[0] > 60), 'old range evicted: ' + JSON.stringify(s.ranges));
  step('far seek downloads from the right offset and evicts the old range');

  await seek(108);
  await until(() => IPTV.Engine.cache && IPTV.Engine.cache.eof);
  await seek(10);
  await until(() => { const v = document.getElementById('video'); return !v.paused && v.currentTime > 11 && v.currentTime < 40; });
  assert.ok(!(await snap()).closed);
  step('seeking back after the end of the file works');

  const t0 = (await snap()).t;
  await seek(t0 - 3);
  await page.waitForTimeout(500);
  s = await snap();
  assert.ok(Math.abs(s.t - (t0 - 3)) < 1.5 && !s.auto, 'rewind inside the back buffer is instant');
  step('rewind inside the cache is instant (no re-download)');

  // a provider that serves something else under a .mp4 URL: detected quickly, plays natively
  await open(5005);                                              // id divisible by 11 -> WebM bytes behind a .mp4 URL
  await until(() => !IPTV.Engine.cache && !document.getElementById('video').paused && document.getElementById('video').currentTime > 0.3);
  assert.ok(!(await snap()).blob);
  step('a file that is not really an MP4 falls back to native playback');

  // 4. slow link: preroll is visible and playback only starts once enough is cached
  await throttle(80);
  await open(5002);
  await until(() => /Caching \d+ \/ 8 s/.test(document.querySelector('.p-spintext').textContent));
  s = await snap();
  assert.ok(s.paused && s.auto);
  await until(() => !document.getElementById('video').paused, null, 30000);
  s = await snap();
  assert.ok(span(s.ranges) >= 7.5, 'started with a cached head start: ' + span(s.ranges));
  step('on a slow link playback waits for an 8 s head start and shows "Caching n / 8 s"');

  // pausing keeps filling the cache
  await page.evaluate(() => IPTV.Engine.togglePause());
  const before = (await snap()).ranges.reduce((m, r) => Math.max(m, r[1]), 0);
  await page.waitForTimeout(5000);
  const after = (await snap()).ranges.reduce((m, r) => Math.max(m, r[1]), 0);
  assert.ok(after > before + 3, `cache grew while paused: ${before} -> ${after}`);
  await page.evaluate(() => IPTV.Engine.togglePause());
  step('while paused the cache keeps filling');

  await seek(100);
  await until(() => document.querySelector('.p-spintext').textContent.includes('Caching'), null, 5000);
  await until(() => { const v = document.getElementById('video'); return !v.paused && v.currentTime > 100.5; }, null, 40000);
  step('seeking on a slow link caches from the new position, then plays');
  await throttle(0);

  // 5. optional: a real underrun (link slower than the video bitrate)
  if (process.env.SLOW) {
    await throttle(40);
    await open(5001);
    await page.evaluate(() => { window.__waits = 0; document.getElementById('video').addEventListener('waiting', () => { if (IPTV.Engine.cache && IPTV.Engine.cache.hasPlayed) window.__waits++; }); });
    await until(() => IPTV.Engine.cache && IPTV.Engine.cache.hasPlayed, null, 60000);
    await until(() => IPTV.Engine.cache.autoPaused && IPTV.Engine.cache.hasPlayed, null, 90000);          // underrun -> refill
    assert.ok(await page.evaluate(() => document.querySelector('.screen.player').classList.contains('is-loading')), 'spinner shown during refill');
    await until(() => !IPTV.Engine.cache.autoPaused, null, 90000);                                        // refilled -> playing again
    assert.equal(await page.evaluate(() => window.__waits), 0, 'the player never stuttered: it paused and refilled instead');
    step('underrun: pauses, shows the spinner, refills, resumes, and the video element never stalled');
    await throttle(0);
  }

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nCACHE E2E PASSED');
} catch (e) {
  console.error('\nCACHE E2E FAILED:', e.message, '\nPage errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
