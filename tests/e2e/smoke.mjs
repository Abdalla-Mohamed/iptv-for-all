// End-to-end smoke test: drives the UI with remote-control keys only, against the mock server.
//   npm run mock:media && node tests/e2e/smoke.mjs          (needs `playwright` + its Chromium)
// Screenshots go to $SHOTS (default ./tests/e2e/shots, git-ignored).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const PORT = 8123, BASE = `http://localhost:${PORT}`;
const shots = process.env.SHOTS || path.resolve('tests/e2e/shots');
fs.mkdirSync(shots, { recursive: true });

const server = spawn('node', ['tools/mock-server.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(40); } };
const RED = 'F1', GREEN = 'F2', YELLOW = 'F3', BLUE = 'F4', BACK = 'Escape';
const shot = (name) => page.screenshot({ path: path.join(shots, name + '.png') });
const text = (sel) => page.locator(sel).first().innerText();
/** Enter edits the focused input; type; Enter closes it. */
const fill = async (value) => { await press('Enter'); await page.keyboard.type(value); await press('Enter'); };
const step = (msg) => console.log('  ✓ ' + msg);

try {
  await page.goto(BASE);

  // ---- first run: form -------------------------------------------------------
  await page.waitForSelector('.form-wrap');
  assert.equal(await text('.form-wrap h1'), 'Add playlist');
  await shot('01-add-playlist');
  step('first launch shows the add-playlist form');

  // wrong credentials first -> error + "Save anyway"
  await fill('Mock Xtream');
  await press('ArrowDown'); await press('ArrowRight');           // Type -> Xtream
  await press('ArrowDown'); await fill(BASE);
  await press('ArrowDown'); await fill('demo');
  await press('ArrowDown'); await fill('wrong');
  await press('ArrowDown'); await press('Enter');                // Save
  await page.waitForFunction(() => /wrong username/i.test(document.querySelector('.form-status').textContent));
  assert.equal(await text('.form-list .btn'), 'Save anyway');
  await shot('02-login-error');
  step('bad password is rejected with a readable message');

  await press('ArrowUp'); await press('Enter');                  // edit password
  await page.keyboard.press('Control+A'); await page.keyboard.type('demo'); await press('Enter');
  await press('ArrowDown'); await press('Enter');                // Save
  await page.waitForSelector('.screen.main:not(.hidden)');
  step('valid Xtream login saves and opens the playlist');

  // ---- live TV ------------------------------------------------------------------
  await page.waitForSelector('.row-live');
  await page.waitForFunction(() => document.querySelector('.count').textContent.includes('1,') || /\d{4}/.test(document.querySelector('.count').textContent));
  assert.ok((await text('.count')).includes('1620'), 'shows total channel count: ' + await text('.count'));
  const domRows = await page.locator('.vcell').count();
  assert.ok(domRows < 120, `virtualized: ${domRows} cells in DOM for 1620 channels + categories`);
  await page.waitForFunction(() => /Mock Show/.test(document.querySelector('.in-now').textContent));
  await shot('03-live');
  step(`live list renders (${domRows} DOM cells for 1620 channels) with EPG panel`);

  await press('ArrowDown', 25);
  await page.waitForTimeout(500);
  assert.match(await text('.in-name'), /News Channel 26/);
  await press('PageDown');
  step('D-pad scrolling and page jumps work');

  // favorites
  await press(RED);
  assert.ok(await page.locator('.vcell.sel .star').count());
  await press('ArrowLeft');                                     // categories
  await press('ArrowDown');                                     // -> Favorites
  await press('Enter');
  assert.match(await text('.count'), /Favorites\s+·\s+1 channel$/);
  await shot('04-favorites');
  step('favorites toggle and appear in the Favorites category');
  await press('ArrowUp'); await press('Enter');                 // back to All
  await press('ArrowUp');                                       // content -> header? (we're in content after Enter)

  // ---- playback (HLS through hls.js) -------------------------------------------------
  // Recent desktop Chromium plays HLS natively, so "auto" would skip hls.js; force it to cover that path.
  await page.evaluate(() => IPTV.Store.setSetting('hlsEngine', 'hlsjs'));
  await press('ArrowDown', 1);
  await press('Enter');
  await page.waitForSelector('.screen.player');
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && v.currentTime > 0.5; }, null, { timeout: 15000 });
  assert.ok(await page.evaluate(() => /m3u8/.test(IPTV.Engine.url) && !!IPTV.Engine.hls), 'HLS goes through hls.js when selected');
  await shot('05-player-live');
  step('live HLS stream plays via hls.js');

  const before = await text('.p-title');
  await press('ArrowUp');                                       // CH+
  await page.waitForTimeout(900);
  assert.notEqual(await text('.p-title'), before);
  await page.waitForFunction(() => document.getElementById('video').currentTime > 0.3, null, { timeout: 15000 });
  step('channel zapping with CH+ / CH-');

  await press('Enter');                                         // channel drawer
  await page.waitForSelector('.drawer-open');
  await shot('06-drawer');
  await press('ArrowDown', 2); await press('Enter');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.drawer-open').count(), 0);
  step('channel drawer opens and switches channels');

  await press('Digit5'); await press('Digit0'); await page.waitForTimeout(2200);
  assert.match(await text('.p-title'), /^50\b/);
  step('number entry jumps to channel 50');

  await press(YELLOW);
  assert.equal(await page.evaluate(() => document.getElementById('video').style.objectFit), 'cover');
  await press(BACK);
  await page.waitForSelector('.screen.main:not(.hidden)');
  assert.equal(await page.evaluate(() => document.getElementById('video').getAttribute('src')), null);
  step('aspect cycling; Back returns to the list and stops playback');

  // ---- movies (direct file) + resume -----------------------------------------------------
  await press('ArrowUp', 40);                                   // up to header
  await press('ArrowRight');                                    // Movies tab
  await press('Enter');
  await page.waitForSelector('.poster');
  await shot('07-movies');
  await press('ArrowDown'); await press('Enter');                // Demo Movie 1 is an MP4 -> smart cache
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.readyState >= 3 && v.currentTime > 0.8; }, null, { timeout: 15000 });
  assert.ok(await page.evaluate(() => !!IPTV.Engine.cache && document.getElementById('video').src.startsWith('blob:')), 'MP4 movie plays through the smart cache');
  const at = () => page.evaluate(() => document.getElementById('video').currentTime);
  step('MP4 movie plays through the smart cache (MediaSource)');

  // pointer: click anywhere on the progress bar to jump there (Magic Remote)
  await page.mouse.move(960, 700);
  await page.waitForSelector('.show-ui .p-barhit');
  const bar = await page.locator('.p-barhit').boundingBox();
  await page.mouse.move(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
  assert.match(await text('.p-tip'), /^1:00$/);
  await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
  await page.waitForFunction(() => { const t = document.getElementById('video').currentTime; return t > 59 && t < 75; }, null, { timeout: 8000 });
  assert.ok(await page.evaluate(() => parseFloat(document.querySelector('.p-buf').style.width) > 0), 'cached range is drawn on the bar');
  await shot('08-player-vod');
  step('clicking the bar at 50% jumps to 1:00 and the cached range is shown');

  // remote: type a time with the number keys (1 3 0 -> 1:30)
  await press('Digit1'); await press('Digit3'); await press('Digit0');
  assert.equal(await text('.p-jv'), '00:01:30');
  await shot('08b-jump-to-time');
  await press('Enter');
  await page.waitForFunction(() => { const t = document.getElementById('video').currentTime; return t > 89 && t < 100; }, null, { timeout: 8000 });
  step('typing 1-3-0 + OK jumps to 1:30');

  await press('ArrowDown');                                     // -1 min
  await page.waitForFunction(() => { const t = document.getElementById('video').currentTime; return t > 29 && t < 42; }, null, { timeout: 8000 });
  await press(BLUE); assert.ok(await page.locator('.p-jump.show').count()); await press(BACK);
  assert.equal(await page.locator('.p-jump.show').count(), 0);
  assert.equal(await page.locator('.screen.player').count(), 1, 'Back closes the jump box, not the player');
  step('Down = -1 min; Blue opens the jump box and Back only closes it');
  await press(BACK);
  await page.waitForSelector('.screen.main:not(.hidden)');
  step('Back leaves the player');

  // ---- series ------------------------------------------------------------------------------
  await press('ArrowUp', 5);
  await press('ArrowRight');                                    // Series tab
  await press('Enter');
  await page.waitForSelector('.poster');
  await press('ArrowDown'); await press('Enter');
  await page.waitForSelector('.s-episodes .ep-row');
  assert.equal(await page.locator('.s-seasons .cat-row').count(), 2);
  await shot('09-series');
  await press('Enter');                                         // play episode 1
  await page.waitForFunction(() => document.getElementById('video').currentTime > 0.3, null, { timeout: 15000 });
  step('series detail lists seasons/episodes and plays an episode');
  await press(BACK); await press(BACK);

  // ---- search ----------------------------------------------------------------------------
  await press('ArrowUp', 5);
  await press('ArrowLeft', 2);                                  // Live TV tab
  await press('Enter');
  await page.waitForSelector('.row-live');
  await press('ArrowUp', 40); await press('ArrowRight', 3);     // search box
  await fill('sports channel 7');
  await page.waitForTimeout(500);
  assert.match(await text('.count'), /Search "sports channel 7"\s+·\s+\d+ channels?$/);
  await shot('10-search');
  step('search filters across the whole section');

  // ---- M3U playlist + settings ------------------------------------------------------------------
  await press(GREEN);                                           // playlists
  await page.waitForSelector('.pl-grid');
  await shot('11-playlists');
  await press('ArrowDown'); await press('Enter');               // Add playlist
  await page.waitForSelector('.form-wrap');
  await fill('Mock M3U');
  await press('ArrowDown', 2); await fill(BASE + '/playlist.m3u');
  await press('ArrowDown'); await press('Enter');               // Save -> opens the new playlist
  await page.waitForSelector('.screen.main:not(.hidden)');
  await page.waitForSelector('.row-live');
  await page.waitForFunction(() => /52 channels|50 channels/.test(document.querySelector('.count').textContent));
  const cats = await page.locator('.cats .cat-name').allInnerTexts();
  assert.ok(cats.includes('Odd, Group'), 'category names with commas survive: ' + cats);
  assert.equal(await page.locator('.tab').count(), 2, 'M3U shows only Live + Movies (no series)');
  await shot('12-m3u');
  step('M3U playlist loads, groups by category, hides empty sections');

  await press(YELLOW);
  await page.waitForSelector('.about');
  await shot('13-settings');
  await press(BACK);

  // ---- persistence ---------------------------------------------------------------------------------
  await page.reload();
  await page.waitForSelector('.screen.main:not(.hidden)');
  await page.waitForSelector('.row-live');
  step('reload reopens the last playlist');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nE2E PASSED');
} catch (e) {
  await shot('FAILURE').catch(() => {});
  console.error('\nE2E FAILED:', e.message, '\nPage errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
