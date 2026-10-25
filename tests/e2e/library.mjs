// Saved-playlist scenarios: instant start from the saved copy, background refresh, manual reload, provider down.
//   node tests/e2e/library.mjs      (needs playwright + Chromium)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const PORT = 8125, BASE = `http://localhost:${PORT}`;
const server = spawn('node', ['tools/mock-server.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const step = (m) => console.log('  ✓ ' + m);
const api = (path) => page.request.get(BASE + path);
const stats = async () => (await api('/__stats')).json();
const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(40); } };
const selectedName = () => page.locator('.content .vcell.sel .rl-name').innerText();
const setting = (k, v) => page.evaluate(([k, v]) => IPTV.Store.setSetting(k, v), [k, v]);

try {
  await page.goto(BASE);
  await page.evaluate((base) => {
    IPTV.Store.savePlaylist({ id: 'x1', type: 'xtream', name: 'Saved X', server: base, username: 'demo', password: 'demo' });
    IPTV.Store.savePlaylist({ id: 'm1', type: 'm3u', name: 'Saved M', url: base + '/playlist.m3u' });
    IPTV.Store.setActiveId('x1');
  }, BASE);
  await page.reload();
  await page.waitForSelector('.row-live');
  assert.equal((await stats()).get_live_streams, 1);
  await page.waitForTimeout(300);                                    // let the save finish
  step('first start downloads the catalog once');

  // 1. restart: served from the saved copy, no request, age shown
  await page.reload();
  await page.waitForSelector('.row-live');
  assert.equal((await stats()).get_live_streams, 1, 'no download on the second start');
  assert.match(await page.locator('.topbar .brand-sub').innerText(), /Saved X\s+·\s+(just now|\d+ min ago)/);
  step('restart is served from the saved copy (no request) and shows its age');

  // 2. stale + slow provider: list is usable at once, refresh lands later and keeps the selected channel
  await setting('refreshHours', 0);
  await api('/__rename?suffix=%20v2');
  await api('/__delay?ms=2500');
  await page.reload();
  await page.waitForSelector('.row-live');
  assert.equal(await selectedName(), 'News Channel 1', 'saved copy shown immediately');
  await press('ArrowDown', 3);
  assert.equal(await selectedName(), 'News Channel 4');
  await page.waitForFunction(() => /News Channel 4 v2/.test(document.querySelector('.content .vcell.sel .rl-name').textContent), null, { timeout: 15000 });
  assert.match(await page.locator('#toast').innerText(), /Playlist updated/);
  assert.equal((await stats()).get_live_streams, 2, 'exactly one background download');
  step('a stale copy opens instantly; the refresh swaps in new data and keeps the selected channel');
  await api('/__delay?ms=0');

  // 3. manual reload with the provider down: keeps working from the saved copy and says so
  await setting('refreshHours', 6);
  await api('/__fail?on=1');
  await press('F4');                                                // Blue = reload
  await page.waitForFunction(() => /not reachable/i.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
  await page.waitForSelector('.row-live');
  assert.match(await selectedName(), /News Channel 1 v2/);
  step('provider down: the saved copy is shown with a notice instead of an error');
  await api('/__fail?on=0');

  // 4. M3U playlist: parsed library is saved too
  await page.evaluate(() => IPTV.Store.setActiveId('m1'));
  await page.reload();
  await page.waitForSelector('.row-live');
  await page.waitForTimeout(300);
  const m3uBefore = (await stats()).m3u;
  await page.reload();
  await page.waitForSelector('.row-live');
  assert.equal((await stats()).m3u, m3uBefore, 'M3U not downloaded again');
  assert.match(await page.locator('.count').innerText(), /5\d channels?/);
  step('M3U playlists are saved too (parsed library)');

  // 5. editing a playlist drops its saved copy
  await page.evaluate(() => IPTV.library.removePrefix('pl:m1:'));
  await page.reload();
  await page.waitForSelector('.row-live');
  assert.equal((await stats()).m3u, m3uBefore + 1, 'downloaded again after the saved copy was removed');
  step('removing the saved copy forces a fresh download');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nLIBRARY E2E PASSED');
} catch (e) {
  await page.screenshot({ path: 'tests/e2e/shots/LIBRARY-FAILURE.png' }).catch(() => {});
  console.error('\nLIBRARY E2E FAILED:', e.message, '\nPage errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
