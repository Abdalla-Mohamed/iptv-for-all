// Audio / subtitle picker: hls.js renditions, smart-cache audio switch, native text tracks, preferred languages.
//   node tests/e2e/tracks.mjs   (needs `npm run mock:media`)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const PORT = 8128, BASE = `http://localhost:${PORT}`;
const server = spawn('node', ['tools/mock-server.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const step = (m) => console.log('  ✓ ' + m);
const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(80); } };
const GREEN = 'F2';

await page.goto(BASE);
await page.evaluate((base) => {
  IPTV.Store.savePlaylist({ id: 'x1', type: 'xtream', name: 'X', server: base, username: 'demo', password: 'demo' });
  IPTV.Store.setActiveId('x1');
}, BASE);
await page.reload();
await page.waitForSelector('.row-live');

const open = (id, ext, settings = {}) => page.evaluate(({ id, ext, settings }) => {
  for (const k in settings) IPTV.Store.setSetting(k, settings[k]);
  while (IPTV.Router.stack.length > 2) IPTV.Router.pop();
  const item = { id: String(id), kind: 'vod', ext, key: 'x:vod:' + id, name: 'Test ' + id };
  const pl = IPTV.Store.playlists()[0];
  IPTV.Router.push(IPTV.Screens.Player(), { list: [item], index: 0, provider: IPTV.createProvider(pl), playlist: pl, kind: 'vod' });
}, { id, ext, settings });
const playing = (min = 0.8) => page.waitForFunction((m) => { const v = document.getElementById('video'); return !v.paused && v.currentTime > m; }, min, { timeout: 20000 });
const tracks = () => page.evaluate(() => IPTV.Engine.tracks());
const names = (list) => list.map((t) => (t.active ? '*' : '') + t.label);
const rows = () => page.locator('.p-tracks .btn, .p-tracks .field').allInnerTexts();
const shownCue = () => page.evaluate(() => {
  const v = document.getElementById('video');
  for (const t of v.textTracks) if (t.mode === 'showing' && t.activeCues && t.activeCues.length) return t.activeCues[0].text;
  return '';
});

try {
  // ---- 1. hls.js: renditions for audio and WebVTT subtitles -----------------------------------------------------------
  await open(5001, 'm3u8', { hlsEngine: 'hlsjs', audioLang: '', subLang: '', cacheMb: 128, subSize: 'medium' });
  await playing();
  let t = await tracks();
  assert.deepEqual(names(t.audio), ['*English', 'Arabic']);
  assert.deepEqual(names(t.text), ['English', 'Arabic'], 'no preference: subtitles stay off');
  assert.equal(await shownCue(), '');
  step('hls.js exposes 2 audio renditions and 2 subtitle tracks; subtitles are off by default');

  await press(GREEN);
  await page.waitForSelector('.tracks-open');
  const r = await rows();
  assert.ok(/English/.test(r[0]) && r[0].includes('✓') && /Arabic/.test(r[1]), 'audio rows with the active one ticked: ' + r);
  await page.screenshot({ path: 'tests/e2e/shots/tracks-panel.png' });
  await press('ArrowDown'); await press('Enter');                                   // Audio: Arabic
  await page.waitForFunction(() => IPTV.Engine.hls.audioTrack === 1);
  assert.equal(await page.locator('.tracks-open').count(), 0, 'panel closes after a choice');
  await playing(1.5);
  step('picker switches the audio rendition');

  await press(GREEN); await page.waitForSelector('.tracks-open');
  await press('ArrowDown', 3);                                                       // cursor starts on the active audio (Arabic): Off, English, Arabic
  await press('Enter');
  await page.waitForFunction(() => IPTV.Engine.hls.subtitleTrack === 1);
  await page.waitForFunction(() => { const v = document.getElementById('video'); for (const t of v.textTracks) if (t.mode === 'showing' && t.activeCues && t.activeCues.length) return /Subtitle ar/.test(t.activeCues[0].text); return false; }, null, { timeout: 15000 });
  step('picker turns on Arabic subtitles and the cue text is delivered');

  await press(GREEN); await page.waitForSelector('.tracks-open');
  await press('ArrowDown'); await press('Enter');                                    // Off is the row right after the audio rows
  await page.waitForFunction(() => IPTV.Engine.hls.subtitleTrack === -1);
  step('picker turns subtitles off again');

  // preferred languages from Settings apply automatically
  await open(5001, 'm3u8', { hlsEngine: 'hlsjs', audioLang: 'ar', subLang: 'en' });
  await playing();
  await page.waitForFunction(() => IPTV.Engine.hls.audioTrack === 1 && IPTV.Engine.hls.subtitleTrack === 0, null, { timeout: 10000 });
  step('preferred audio (Arabic) and subtitles (English) are selected automatically');

  // subtitle size comes from Settings and can be changed in the picker
  assert.match(await page.locator('#cue-style').evaluate((e) => e.textContent), /44px/);
  await press(GREEN); await page.waitForSelector('.tracks-open');
  await press('ArrowDown', 100);                                                     // last item: Subtitle size
  await press('ArrowRight');
  assert.match(await page.locator('#cue-style').evaluate((e) => e.textContent), /58px/);
  assert.equal(await page.evaluate(() => IPTV.Store.settings().subSize), 'large');
  await press('Escape');
  step('subtitle size follows Settings and the picker');

  // ---- 2. smart cache: MP4 with two audio tracks restarts on the other track at the same position ---------------------------------
  await open(5018, 'mp4', { audioLang: '', subLang: '', hlsEngine: 'auto' });
  await playing();
  t = await tracks();
  assert.ok(await page.evaluate(() => !!IPTV.Engine.cache), 'smart cache path');
  assert.deepEqual(names(t.audio), ['*English', 'Arabic']);
  assert.equal(t.text.length, 0);
  await page.evaluate(() => { document.getElementById('video').currentTime = 40; });
  await page.waitForFunction(() => document.getElementById('video').currentTime > 41);
  await press(GREEN); await page.waitForSelector('.tracks-open');
  await press('ArrowDown'); await press('Enter');                                    // Arabic
  await page.waitForFunction(() => IPTV.Engine.cache && IPTV.Engine.cache.audioIndex === 1 && !IPTV.Engine.cache.autoPaused && document.getElementById('video').currentTime > 41, null, { timeout: 20000 });
  const at = await page.evaluate(() => document.getElementById('video').currentTime);
  assert.ok(at > 41 && at < 50, 'continued near the same position: ' + at);
  assert.deepEqual(names((await tracks()).audio), ['English', '*Arabic']);
  step('smart cache: choosing the other audio track restarts it there, at the same position');

  await open(5018, 'mp4', { audioLang: 'ar' });
  await playing();
  assert.equal(await page.evaluate(() => IPTV.Engine.cache.audioIndex), 1);
  step('smart cache starts directly on the preferred audio language');

  // ---- 3. native text tracks (embedded subtitles exposed by the TV's own player) -----------------------------------------------------
  await open(5005, 'mkv', { audioLang: '', subLang: '' });                            // .mkv URL -> native pipeline
  await playing();
  await page.evaluate(() => {
    const v = document.getElementById('video');
    const tt = v.addTextTrack('subtitles', 'English', 'en');
    for (let i = 0; i < 60; i += 4) tt.addCue(new VTTCue(i, i + 3, 'Native cue ' + i));
    tt.mode = 'disabled';
  });
  t = await tracks();
  assert.deepEqual(names(t.text), ['English']);
  await press(GREEN); await page.waitForSelector('.tracks-open');
  await press('ArrowDown'); await press('Enter');                                    // headers are not selectable: Off (start), then English
  await page.waitForFunction(() => IPTV.Engine.nativeText()[0].mode === 'showing');
  await page.waitForFunction(() => /Native cue/.test((() => { const t = IPTV.Engine.nativeText()[0]; return t.activeCues && t.activeCues.length ? t.activeCues[0].text : ''; })()), null, { timeout: 10000 });
  step('native text tracks are listed and can be switched on');

  // ---- 4. nothing to choose -------------------------------------------------------------------------------------------------------------
  await open(5001, 'mp4', { audioLang: '' });
  await playing();
  await press(GREEN);
  assert.match(await page.locator('#toast').innerText(), /No other audio or subtitle tracks/);
  assert.equal(await page.locator('.tracks-open').count(), 0);
  step('a stream with a single audio track and no subtitles says so instead of opening an empty panel');

  // ---- 5. settings list scrolls (11 rows) -----------------------------------------------------------------------------------------------
  await page.evaluate(() => { while (IPTV.Router.stack.length > 2) IPTV.Router.pop(); IPTV.Router.push(IPTV.Screens.Settings(), {}); });
  await page.waitForSelector('.about');
  await press('ArrowDown', 14);
  const visible = await page.evaluate(() => {
    const sc = document.querySelector('.form-wrap.scroller').getBoundingClientRect();
    const last = [...document.querySelectorAll('.form-list .fi')].pop().getBoundingClientRect();
    return last.bottom <= sc.bottom + 1 && last.top >= sc.top - 1;
  });
  assert.ok(visible, 'last settings row is scrolled into view');
  await page.screenshot({ path: 'tests/e2e/shots/settings-scrolled.png' });
  step('the longer Settings list scrolls to keep the focused row visible');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nTRACKS E2E PASSED');
} catch (e) {
  await page.screenshot({ path: 'tests/e2e/shots/TRACKS-FAILURE.png' }).catch(() => {});
  console.error('\nTRACKS E2E FAILED:', e.message, '\nPage errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
