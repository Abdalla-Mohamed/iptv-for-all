// Parental lock. node tests/e2e/parental.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const PORT = 8129, BASE = `http://localhost:${PORT}`;
const server = spawn('node', ['tools/mock-server.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const step = (m) => console.log('  ✓ ' + m);
const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(70); } };
const RED = 'F1';
const cat = (name) => page.locator('.cats .cat-row').filter({ hasText: name });
const count = async () => (await page.locator('.count').innerText()).replace(/\s+/g, ' ');
const typePin = async (pin) => { await page.waitForSelector('.pin-dots'); await page.keyboard.type(pin); await page.waitForTimeout(400); };
const hasLock = async (name) => (await cat(name).locator('.lock').count()) === 1;

try {
  await page.goto(BASE);
  await page.evaluate((base) => {
    IPTV.Store.savePlaylist({ id: 'k1', type: 'm3u', name: 'Kids test', url: base + '/playlist.m3u' });
    IPTV.Store.setActiveId('k1');
  }, BASE);
  await page.reload();
  await page.waitForSelector('.row-live');
  assert.match(await count(), /All · 52 channels/);
  assert.equal(await hasLock('Adult XXX'), false, 'without a PIN nothing is locked');
  step('without a PIN nothing is locked');

  // 1. Red on a category with no PIN yet: choose one (entered twice), the category gets locked
  await press('ArrowLeft'); await press('ArrowDown', 4);
  assert.match(await page.locator('.cats .vcell.sel').innerText(), /Even/);
  assert.match(await page.locator('.screen.main .hintbar').innerText(), /Red Lock/);
  await press(RED);
  await typePin('1234');                                   // choose
  await typePin('9999');                                   // repeat: different
  await page.waitForFunction(() => /different/.test(document.querySelector('.pin-note').textContent));
  await typePin('1234'); await typePin('1234');            // again, matching
  await page.waitForFunction(() => IPTV.parental.hasPin() && IPTV.parental.manuallyLocked('k1', 'live', 'Even'));
  assert.equal(await hasLock('Even'), true);
  assert.equal(await hasLock('Adult XXX'), true, 'adult names lock automatically once a PIN exists');
  assert.equal(await hasLock('Odd, Group'), false);
  step('Red asks to choose a PIN (twice, mismatch is caught), then locks the category; adult categories lock by name');

  // 2. hidden from All, search and counts
  await page.waitForFunction(() => /All 25/.test(document.querySelector('.cats .cat-row').textContent.replace(/\s+/g, ' ')) || true);
  await press('ArrowUp', 4);                                // All
  await press('Enter');
  assert.match(await count(), /All · 25 channels/, '52 - 25 even - 2 adult');
  await press('ArrowUp'); await press('ArrowRight', 3);     // search
  await press('Enter'); await page.keyboard.type('M3U Channel 2'); await press('Enter');
  await page.waitForFunction(() => /Search "M3U Channel 2" · 5 channels/.test(document.querySelector('.count').textContent.replace(/\s+/g, ' ')));
  step('locked categories vanish from All, counts and search results');
  await page.evaluate(() => { const i = document.querySelector('.search input'); i.value = ''; i.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(500);

  // 3. opening a locked category asks the PIN: wrong, then right
  await press('ArrowDown'); await press('ArrowLeft'); await press('ArrowDown', 4);
  await press('Enter');
  await typePin('0000');
  await page.waitForFunction(() => /2 tries left/.test(document.querySelector('.pin-note').textContent));
  await typePin('1234');
  await page.waitForSelector('.pin-dots', { state: 'detached' });
  await page.waitForFunction(() => /Even · 25 channels/.test(document.querySelector('.count').textContent.replace(/\s+/g, ' ')));
  step('wrong PIN is refused with the tries left; the right one opens the category');
  assert.match(await (async () => { await press('ArrowLeft'); await press('ArrowUp', 4); await press('Enter'); return count(); })(), /All · 52 channels/, 'unlocked: everything visible again');
  step('after unlocking, everything is visible again (30 minutes or until you leave the playlist)');

  // 4. automatic adult lock cannot be toggled by hand; manual lock needs the PIN to be removed
  await press('ArrowLeft'); await press('ArrowDown', 5);
  assert.match(await page.locator('.cats .vcell.sel').innerText(), /Adult XXX/);
  await press(RED);
  assert.match(await page.locator('#toast').innerText(), /locked automatically/);
  await press('ArrowUp');
  assert.match(await page.locator('.cats .vcell.sel').innerText(), /Even/);
  await press(RED);
  await typePin('1234');
  await page.waitForFunction(() => !IPTV.parental.manuallyLocked('k1', 'live', 'Even'));
  assert.equal(await hasLock('Even'), false);
  step('unlocking a category by hand needs the PIN; automatic adult locks say so');

  // 5. leaving the playlist locks again
  await press('Escape');                                                    // back to the playlist list
  await page.waitForSelector('.pl-grid');
  await press('Enter');
  await page.waitForSelector('.row-live');
  assert.match(await count(), /All · 50 channels/, 'adult category hidden again');
  assert.equal(await page.evaluate(() => IPTV.parental.isUnlocked()), false);
  step('leaving the playlist locks it again');

  // 6. Back cancels a PIN dialog; Settings > remove PIN needs the PIN and unlocks everything
  await press('ArrowLeft'); await press('ArrowDown', 5); await press('Enter');
  await page.waitForSelector('.pin-dots');
  await press('Escape');
  await page.waitForSelector('.pin-dots', { state: 'detached' });
  step('Back cancels the PIN dialog');

  await press('F3');                                                        // Yellow = Settings
  await page.waitForSelector('.about');
  const labels = await page.locator('.form-list .fi').allInnerTexts();
  const removeIdx = labels.findIndex((t) => /remove/i.test(t));
  await press('ArrowDown', removeIdx); await press('Enter');
  await typePin('1234');
  await page.waitForFunction(() => !IPTV.parental.hasPin());
  step('Settings: removing the PIN asks for it and clears every lock');
  await press('Escape');
  await page.waitForSelector('.row-live');
  assert.match(await count(), /All · 52 channels/);

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nPARENTAL E2E PASSED');
} catch (e) {
  await page.screenshot({ path: 'tests/e2e/shots/PARENTAL-FAILURE.png' }).catch(() => {});
  console.error('\nPARENTAL E2E FAILED:', e.message, '\nPage errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
