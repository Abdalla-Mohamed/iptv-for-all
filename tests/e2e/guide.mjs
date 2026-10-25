// XMLTV program guide for M3U playlists. node tests/e2e/guide.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const PORT = 8127, BASE = `http://localhost:${PORT}`;
const server = spawn('node', ['tools/mock-server.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const step = (m) => console.log('  \u2713 ' + m);
const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(60); } };
const stats = async () => (await page.request.get(BASE + '/__stats')).json();
const fill = async (v) => { await press('Enter'); await page.keyboard.type(v); await press('Enter'); };

try {
  await page.goto(BASE);
  await page.evaluate((base) => {
    IPTV.Store.savePlaylist({ id: 'g1', type: 'm3u', name: 'Header guide', url: base + '/playlist.m3u' });             // guide URL comes from #EXTM3U x-tvg-url (gzip)
    IPTV.Store.savePlaylist({ id: 'g2', type: 'm3u', name: 'Override guide', url: base + '/playlist.m3u', epgUrl: base + '/epg.xml' });
    IPTV.Store.savePlaylist({ id: 'g3', type: 'm3u', name: 'Broken guide', url: base + '/playlist.m3u', epgUrl: base + '/nope.xml' });
    IPTV.Store.setActiveId('g1');
  }, BASE);
  await page.reload();
  await page.waitForSelector('.row-live');

  // 1. list rows show what is on now; the gzip guide from the playlist header was used
  await page.waitForSelector('.rl-now', { timeout: 15000 });
  assert.equal(await page.locator('.content .vcell').first().locator('.rl-now').innerText(), 'Now & Live on 1', 'entity decoded, UTC+2 times parsed');
  assert.equal((await stats()).epg, 1);
  await page.screenshot({ path: 'tests/e2e/shots/guide-list.png' });
  step('gzipped guide from the #EXTM3U header: channel rows show the programme airing now');

  // 2. info panel: now / next with times
  await page.waitForFunction(() => /Now & Live on 1/.test(document.querySelector('.in-now').textContent), null, { timeout: 8000 });
  assert.match(await page.locator('.in-next').innerText(), /^Next: \d\d:\d\d\s+Next on 1$/);
  assert.match(await page.locator('.in-desc').innerText(), /About Now 1/);
  step('info panel shows now / next / description');

  // 3. a channel without tvg-id is matched through the guide's display name
  await press('ArrowUp'); await press('ArrowRight', 3);                                  // search box
  await press('Enter'); await page.keyboard.type('channel 50'); await press('Enter');
  await page.waitForFunction(() => /Now & Live on 50/.test(document.querySelector('.content .rl-now').textContent), null, { timeout: 8000 });
  step('channel without tvg-id is matched by display name');

  // 4. player overlay
  await press('ArrowDown');
  await press('Enter');
  await page.waitForSelector('.screen.player');
  await page.waitForFunction(() => /Now.*Now & Live on 50/.test(document.querySelector('.p-now').textContent), null, { timeout: 8000 });
  assert.match(await page.locator('.p-next').innerText(), /Next on 50/);
  step('player overlay shows now / next from the guide');
  await press('Escape');

  // 5. restart: the saved guide (< 12 h) is used, no new download
  await page.reload();
  await page.waitForSelector('.rl-now', { timeout: 15000 });
  assert.equal((await stats()).epg, 1, 'guide not downloaded again');
  step('restart uses the saved guide (no download)');

  // 6. plain XML override URL on another playlist
  await page.evaluate(() => IPTV.Store.setActiveId('g2'));
  await page.reload();
  await page.waitForSelector('.rl-now', { timeout: 15000 });
  assert.equal((await stats()).epg, 2);
  step('a per-playlist guide URL overrides the header (plain XML works)');

  // 7. broken guide URL: list still works, simply no guide
  await page.evaluate(() => IPTV.Store.setActiveId('g3'));
  await page.reload();
  await page.waitForSelector('.row-live');
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.rl-now').count(), 0);
  assert.match(await page.locator('.count').innerText(), /5\d channels?/);
  step('an unreachable guide does not break the channel list');

  // 8. the form has the field and keeps its value when editing
  await press('Escape'); await page.waitForSelector('.pl-grid');
  await press('ArrowDown');                                                            // second playlist (Override guide)
  await press('F3');                                                                   // Yellow = edit
  await page.waitForSelector('.form-wrap');
  const vals = await page.locator('.form-list input').evaluateAll((els) => els.map((e) => e.value));
  assert.ok(vals.includes(BASE + '/epg.xml'), 'guide URL is shown when editing: ' + vals);
  step('the form shows and keeps the program guide URL');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nGUIDE E2E PASSED');
} catch (e) {
  await page.screenshot({ path: 'tests/e2e/shots/GUIDE-FAILURE.png' }).catch(() => {});
  console.error('\nGUIDE E2E FAILED:', e.message, '\nPage errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
