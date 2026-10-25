#!/usr/bin/env node
// Dev server: serves ./app and a fake IPTV provider so the UI can be exercised in a desktop browser.
//
//   Xtream login : server http://localhost:8080   user demo   password demo
//   M3U playlist : http://localhost:8080/playlist.m3u
//
// Streams are a generated test pattern (needs ffmpeg once: `npm run mock:media`). No real content is involved.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// test hooks: /__stats (request counts), /__rename?suffix=X (changes channel names), /__fail?on=1 (provider returns 503),
// /__delay?ms=N (slows the Xtream API)
const stats = {};
let liveSuffix = '', providerDown = false, apiDelayMs = 0;
const count = (k) => { stats[k] = (stats[k] || 0) + 1; };
let throttleKbps = 0;   // set with GET /__throttle?kbps=N (0 = unlimited); applies to media responses
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app');
const mediaDir = path.join(root, 'tools', '.media');
const port = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.m3u8': 'application/vnd.apple.mpegurl', '.vtt': 'text/vtt', '.m4s': 'video/iso.segment', '.ts': 'video/mp2t', '.svg': 'image/svg+xml'
};

// ---- fake catalogue -----------------------------------------------------------
const LIVE_CATS = ['News', 'Sports', 'Movies', 'Kids', 'Music', 'Documentary', 'Local', 'Radio'];
const live = [];
LIVE_CATS.forEach((c, ci) => {
  const n = c === 'News' ? 1200 : 60;   // one huge category to exercise list virtualization
  for (let i = 1; i <= n; i++) live.push({ num: live.length + 1, name: `${c} Channel ${i}`, stream_id: 1000 + live.length, stream_icon: '', category_id: String(ci + 1), epg_channel_id: `ch${live.length}` });
});
const vod = [];
// every 5th movie is "mkv" (played natively); the rest are MP4 (smart-cache path)
for (let i = 1; i <= 240; i++) vod.push({ num: i, name: `Demo Movie ${i}`, stream_id: 5000 + i, stream_icon: '', category_id: String((i % 4) + 1), rating: String((i % 9) + 1), container_extension: i % 5 === 0 ? 'mkv' : 'mp4' });
const series = [];
for (let i = 1; i <= 30; i++) series.push({ num: i, name: `Demo Series ${i}`, series_id: 9000 + i, cover: '', category_id: String((i % 3) + 1), plot: 'A made-up show used to test the series screen. '.repeat(4), rating: '7.5' });

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };

function api(q, res) {
  count(q.get('action') || 'login');
  if (providerDown) { res.writeHead(503, { 'Access-Control-Allow-Origin': '*' }); return res.end('down'); }
  if (q.get('username') !== 'demo' || q.get('password') !== 'demo') {
    return json(res, { user_info: { auth: 0 } });
  }
  switch (q.get('action')) {
    case null: case '':
      return json(res, { user_info: { auth: 1, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 86400 * 90), max_connections: '1' }, server_info: {} });
    case 'get_live_categories': return json(res, LIVE_CATS.map((n, i) => ({ category_id: String(i + 1), category_name: n })));
    case 'get_live_streams': return json(res, liveSuffix ? live.map((c) => ({ ...c, name: c.name + liveSuffix })) : live);
    case 'get_vod_categories': return json(res, ['Action', 'Comedy', 'Drama', 'Sci-Fi'].map((n, i) => ({ category_id: String(i + 1), category_name: n })));
    case 'get_vod_streams': return json(res, vod);
    case 'get_series_categories': return json(res, ['Crime', 'Fantasy', 'Anime'].map((n, i) => ({ category_id: String(i + 1), category_name: n })));
    case 'get_series': return json(res, series);
    case 'get_series_info': {
      const id = Number(q.get('series_id'));
      const episodes = {};
      for (let s = 1; s <= 2; s++) {
        episodes[s] = [];
        for (let e = 1; e <= 6; e++) episodes[s].push({ id: String(id * 100 + s * 10 + e), episode_num: e, title: `S${s}E${e} - Pilot of the test`, container_extension: 'webm', info: { duration_secs: 10, plot: '' } });
      }
      return json(res, { info: { name: `Demo Series ${id - 9000}`, plot: 'A made-up show used to test the series screen.', genre: 'Test', rating: '7.5' }, episodes });
    }
    case 'get_vod_info': {
      const id = Number(q.get('vod_id')), n = id - 5000;
      return json(res, {
        info: { movie_image: '', backdrop_path: [], plot: `Plot of Demo Movie ${n}. A made-up film used to test the detail page.`, cast: 'Actor One, Actor Two, Actor Three',
                director: 'Dir Ector', genre: 'Action / Test', releasedate: '2021-05-04', duration_secs: 120, duration: '00:02:00', rating: '7.2' },
        movie_data: { stream_id: id, name: `Demo Movie ${n}`, container_extension: n % 5 === 0 ? 'mkv' : 'mp4' }
      });
    }
    case 'get_short_epg': {
      const t = Math.floor(Date.now() / 1000), slot = 1800, start = t - (t % slot);
      return json(res, { epg_listings: [0, 1, 2].map((k) => ({
        title: b64(`Mock Show ${k + 1} – éè`), description: b64('This is a generated programme description used for UI testing.'),
        start_timestamp: String(start + k * slot), stop_timestamp: String(start + (k + 1) * slot) })) });
    }
  }
  return json(res, []);
}

function m3u(host) {
  const lines = [`#EXTM3U x-tvg-url="http://${host}/epg.xml.gz"`];
  // channel 50 has no tvg-id: the guide is matched through its display name
  for (let i = 1; i <= 50; i++) lines.push(`#EXTINF:-1 ${i === 50 ? '' : `tvg-id="m${i}" `}tvg-logo="" group-title="${i % 2 ? 'Odd, Group' : 'Even'}",M3U Channel ${i}`, `http://${host}/stream/test.webm?c=${i}`);
  lines.push('#EXTINF:-1 group-title="Films",A Movie', `http://${host}/movie/demo/demo/1.webm`);
  return lines.join('\n') + '\n';
}

function sendStream(stream, res) {
  if (!throttleKbps) { stream.pipe(res); return; }
  const bytesPerMs = (throttleKbps * 1024) / 1000;
  stream.on('data', (chunk) => { stream.pause(); res.write(chunk); setTimeout(() => stream.resume(), chunk.length / bytesPerMs); });
  stream.on('end', () => res.end());
  res.on('close', () => stream.destroy());
}

/** XMLTV for the M3U channels, times written in UTC+2 to exercise offset parsing; titles carry an entity to exercise decoding. */
function xmltv() {
  const slot = 30 * 60000, base = Date.now() - (Date.now() % slot);
  const fmt = (ms) => new Date(ms + 2 * 3600000).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0200';
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="mock">\n';
  for (let i = 1; i <= 50; i++) {
    const id = i === 50 ? 'x50' : `m${i}`;
    out += `<channel id="${id}"><display-name>M3U Channel ${i}</display-name></channel>\n`;
    ['Earlier', 'Now', 'Next', 'Later'].forEach((label, k) => {
      const title = k === 1 ? `Now &amp; Live on ${i}` : `${label} on ${i}`;
      out += `<programme start="${fmt(base + (k - 1) * slot)}" stop="${fmt(base + k * slot)}" channel="${id}"><title lang="en">${title}</title><desc>About ${label} ${i}</desc></programme>\n`;
    });
  }
  return out + '</tv>\n';
}

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file);
    const type = TYPES[ext] || 'application/octet-stream';
    const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    const media = ext === '.webm' || ext === '.mp4';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    let start = 0, end = st.size - 1;
    if (range) {
      if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), end); }
      else if (range[2]) start = Math.max(0, st.size - Number(range[2]));   // suffix range
      if (start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    } else {
      res.writeHead(200, { ...head, 'Content-Length': st.size });
    }
    const stream = fs.createReadStream(file, { start, end, highWaterMark: 16 * 1024 });
    if (media) sendStream(stream, res); else stream.pipe(res);
  });
}

const safeJoin = (base, rel) => { const p = path.normalize(path.join(base, rel)); return p.startsWith(base) ? p : null; };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);
  if (p === '/player_api.php') return apiDelayMs ? setTimeout(() => api(url.searchParams, res), apiDelayMs) : api(url.searchParams, res);
  if (p === '/__delay') { apiDelayMs = Number(url.searchParams.get('ms')) || 0; res.writeHead(200); return res.end('ok'); }
  if (p === '/epg.xml' || p === '/epg.xml.gz') {
    count('epg');
    if (providerDown) { res.writeHead(503, { 'Access-Control-Allow-Origin': '*' }); return res.end('down'); }
    const xml = xmltv(), gz = p.endsWith('.gz');
    res.writeHead(200, { 'Content-Type': gz ? 'application/gzip' : 'application/xml', 'Access-Control-Allow-Origin': '*' });
    return res.end(gz ? zlib.gzipSync(xml) : xml);
  }
  if (p === '/__stats') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(stats)); }
  if (p === '/__rename') { liveSuffix = url.searchParams.get('suffix') || ''; res.writeHead(200); return res.end('ok'); }
  if (p === '/__fail') { providerDown = url.searchParams.get('on') === '1'; res.writeHead(200); return res.end('ok'); }
  if (p === '/playlist.m3u') {
    count('m3u');
    if (providerDown) { res.writeHead(503, { 'Access-Control-Allow-Origin': '*' }); return res.end('down'); }
    res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl', 'Access-Control-Allow-Origin': '*' }); return res.end(m3u(req.headers.host)); }
  if (p === '/__throttle') { throttleKbps = Number(url.searchParams.get('kbps')) || 0; res.writeHead(200); return res.end(String(throttleKbps)); }
  // HLS movie with alternate audio + subtitles: .../ID.m3u8 is the master playlist, its relative files live in hls-sub/
  if (/^\/(movie|series)\//.test(p)) {
    const base = path.basename(p), sub = path.join(mediaDir, 'hls-sub', base);
    if (/^\d+\.m3u8$/.test(base)) return serveFile(req, res, path.join(mediaDir, 'hls-sub', 'master.m3u8'));
    if (!/^\d+\.\w+$/.test(base) && fs.existsSync(sub)) return serveFile(req, res, sub);
  }
  // any Xtream stream URL maps to the generated test media (MP4 ids divisible by 7 get the moov-at-end file)
  if (/^\/(movie|series)\//.test(p) || p.startsWith('/stream/')) {
    const id = Number((/(\d+)\.\w+$/.exec(p) || [])[1]) || 0;
    // ids divisible by 11 are a WebM served under a .mp4 URL (a provider that lies about the container)
    // ids divisible by 13 carry two audio tracks (eng / ara)
    const file = p.endsWith('.mp4') && id % 11 !== 0 ? (id % 13 === 0 ? 'movie-2audio.mp4' : id % 7 === 0 ? 'movie-tail.mp4' : 'movie.mp4') : 'test.webm';
    return serveFile(req, res, path.join(mediaDir, file));
  }
  if (/^\/live\/[^/]+\/[^/]+\/\d+\.m3u8$/.test(p)) return serveFile(req, res, path.join(mediaDir, 'hls', 'index.m3u8'));
  if (/^\/live\/[^/]+\/[^/]+\/[\w.-]+\.(m4s|mp4)$/.test(p)) return serveFile(req, res, path.join(mediaDir, 'hls', path.basename(p)));
  if (p.startsWith('/live/')) return serveFile(req, res, path.join(mediaDir, 'test.webm'));
  if (p.startsWith('/hls/')) { const f = safeJoin(path.join(mediaDir, 'hls'), p.slice(5)); return f ? serveFile(req, res, f) : (res.writeHead(400), res.end()); }
  const f = safeJoin(appDir, p === '/' ? '/index.html' : p);
  if (!f) { res.writeHead(400); return res.end(); }
  serveFile(req, res, f);
}).listen(port, () => console.log(`IPTV For All dev server: http://localhost:${port}\nXtream: http://localhost:${port}  demo / demo\nM3U:    http://localhost:${port}/playlist.m3u`));
