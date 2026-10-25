// "Continue watching" in the real UI. node tests/e2e/continue.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const PORT = 8126, BASE = `http://localhost:${PORT}`;
const server = spawn('node', ['tools/mock-server.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const step = (m) => console.log('  ✓ ' + m);
const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(60); } };

try {
  await page.goto(BASE);
  await page.evaluate((base) => {
    IPTV.Store.savePlaylist({ id: 'x1', type: 'xtream', name: 'X', server: base, username: 'demo', password: 'demo' });
    IPTV.Store.setActiveId('x1');
    const S = IPTV.Store;
    // a movie 40% watched and an episode (series 9001, S1E3) at 0:40 of 25 min
    S.setProgress('x1', 'x:vod:5003', 2400, 6000, { kind: 'vod', id: '5003', name: 'Demo Movie 3', logo: '', ext: 'mp4', cat: '4' });
    S.setProgress('x1', 'x:ep:900113', 40, 1500, { kind: 'episode', id: '900113', name: 'S1E3 - Pilot of the test', ext: 'webm', logo: '',
      series: { id: '9001', name: 'Demo Series 1', logo: '' } });
  }, BASE);
  await page.reload();
  await page.waitForSelector('.row-live');
  assert.equal(await page.locator('.cats .cat-name').first().innerText(), 'All', 'Live has no Continue watching');

  // Movies tab opens on Continue watching with a progress bar
  await press('ArrowUp'); await press('ArrowRight'); await press('Enter');
  await page.waitForSelector('.poster');
  assert.match(await page.locator('.cats .cat-name').first().innerText(), /Continue watching/);
  assert.match(await page.locator('.count').innerText(), /Continue watching\s+·\s+1 movie$/);
  assert.equal(await page.locator('.po-title').first().innerText(), 'Demo Movie 3');
  const w = await page.locator('.po-prog i').first().evaluate((el) => el.style.width);
  assert.equal(w, '40%');
  step('Movies opens on "Continue watching" with a 40% progress bar');

  // Series tab: episode entry opens its series on that episode
  await press('ArrowUp', 3); await press('ArrowRight'); await press('Enter');
  await page.waitForSelector('.poster');
  assert.match(await page.locator('.po-title').first().innerText(), /^Demo Series 1\s+·\s+S1E3 - Pilot of the test$/);
  await press('ArrowDown'); await press('Enter');                       // header -> content, open
  await page.waitForSelector('.s-episodes .ep-row');
  assert.match(await page.locator('.s-episodes .vcell.sel .ep-name').innerText(), /S1E3/);
  assert.match(await page.locator('.s-episodes .vcell.sel .ep-sub').innerText(), /resume at 0:40/);
  step('an episode opens its series on the right episode, showing the resume point');

  // movie detail page from Continue watching: Resume vs Start over, favorites
  await press('Escape'); await page.waitForSelector('.screen.main:not(.hidden)');
  await press('ArrowUp', 3); await press('ArrowLeft'); await press('Enter');           // Movies tab
  await page.waitForSelector('.poster');
  await press('Enter');                                                                  // Demo Movie 3 (Continue watching)
  await page.waitForSelector('.screen.movie:not(.hidden)');
  await page.waitForFunction(() => /Plot of Demo Movie 3/.test(document.querySelector('.m-plot').textContent));
  assert.match(await page.locator('.m-btns .btn').first().innerText(), /Resume from 40:00/);
  await press('ArrowRight'); await press('ArrowRight'); await press('Enter');            // favorites
  assert.equal(await page.evaluate(() => IPTV.Store.isFav('x1', 'x:vod:5003')), true);
  assert.match(await page.locator('.m-btns .btn').nth(2).innerText(), /In favorites/);
  await press('ArrowLeft'); await press('Enter');                                        // Start over
  await page.waitForSelector('.screen.player');
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && v.currentTime > 0.3 && v.currentTime < 8; });
  assert.equal(await page.evaluate(() => IPTV.Store.getProgress('x1', 'x:vod:5003')), 0, 'Start over clears the old resume point');
  step('detail page: Resume / Start over / favorites');

  // really watching a movie records a resume point with metadata; finishing it removes the entry
  await page.evaluate(() => {
    while (IPTV.Router.stack.length > 2) IPTV.Router.pop();
    const item = { id: '5001', key: 'x:vod:5001', kind: 'vod', name: 'Demo Movie 1', logo: '', ext: 'mp4', cat: '2' };
    const pl = IPTV.Store.playlists()[0];
    IPTV.Router.push(IPTV.Screens.Player(), { list: [item], index: 0, provider: IPTV.createProvider(pl), playlist: pl, kind: 'vod' });
  });
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.evaluate(() => { document.getElementById('video').currentTime = 45; });
  await page.waitForFunction(() => document.getElementById('video').currentTime > 46);
  await press('Escape');
  const entry = await page.evaluate(() => IPTV.Store.progressEntries('x1').find((e) => e.key === 'x:vod:5001'));
  assert.ok(entry && entry.seconds >= 45 && entry.duration === 120 && entry.meta.name === 'Demo Movie 1', JSON.stringify(entry));
  step('watching a movie saves the resume point with its duration and metadata');

  await page.evaluate(() => {
    const item = { id: '5001', key: 'x:vod:5001', kind: 'vod', name: 'Demo Movie 1', logo: '', ext: 'mp4', cat: '2' };
    const pl = IPTV.Store.playlists()[0];
    IPTV.Store.setProgress('x1', 'x:vod:5001', 0);
    IPTV.Router.push(IPTV.Screens.Player(), { list: [item], index: 0, provider: IPTV.createProvider(pl), playlist: pl, kind: 'vod' });
  });
  await page.waitForFunction(() => document.getElementById('video').readyState >= 3);
  await page.evaluate(() => { document.getElementById('video').currentTime = 100; });     // within the last 45 s counts as finished
  await page.waitForFunction(() => document.getElementById('video').currentTime > 101);
  await press('Escape');
  assert.equal(await page.evaluate(() => IPTV.Store.progressEntries('x1').some((e) => e.key === 'x:vod:5001')), false);
  step('finishing a title removes it from the list');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nCONTINUE E2E PASSED');
} catch (e) {
  await page.screenshot({ path: 'tests/e2e/shots/CONTINUE-FAILURE.png' }).catch(() => {});
  console.error('\nCONTINUE E2E FAILED:', e.message, '\nPage errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
