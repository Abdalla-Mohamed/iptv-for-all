# IPTV For All

An open-source IPTV player for **LG webOS TVs**, in the spirit of IPTV Smarters / Smarter IPTV.
You bring your own playlist or provider login; the app ships with **no channels or content**.

| Live TV | Movies | Player |
|---|---|---|
| ![Live TV](docs/screenshots/live.jpg) | ![Movies](docs/screenshots/movies.jpg) | ![Player](docs/screenshots/player.jpg) |

## Features

- **Xtream Codes** logins (verified on save) and **M3U / M3U8** URLs, multiple playlists
- **Live TV, Movies, Series** (seasons and episodes), categories, search, **favorites**, recently watched
- **EPG** now/next for Xtream live channels (list panel and player overlay)
- Player: CH+/CH- zapping, number-key channel entry, channel drawer (OK), seek with accelerating steps,
  **resume where you left off**, auto-play next episode, aspect cycling, audio-track switching, auto-retry on dropped live streams
- HLS through the TV's native player, with **hls.js** as an alternative (Settings) and for desktop testing
- Built for the Magic Remote and the D-pad: colour keys, media keys, pointer clicks all work
- Handles huge playlists (tens of thousands of channels) by only keeping the visible rows in the DOM
- No build step, no runtime dependencies besides the vendored hls.js (Apache-2.0)

### Remote control

| Key | Browse | Player |
|---|---|---|
| OK | play / select | live: channel drawer, VOD: pause |
| Up / Down, CH+ / CH- | move | next / previous channel |
| Left / Right | change column | VOD: seek (10 s, accelerates up to 5 min) |
| 0-9 | | jump to channel number |
| Red | add / remove favorite | add / remove favorite |
| Green | playlists | switch audio track |
| Yellow | settings | cycle aspect (Fit / Zoom / Stretch) |
| Blue | reload playlist | show info |
| Back | up one screen (exits from the playlist list) | stop |

## Install on your TV

You need an LG TV on **webOS 4.0 or newer (2018+)**. Sideloading uses LG's Developer Mode.

1. On the TV: install **Developer Mode** from the LG Content Store, sign in with a free LG developer account, switch Dev Mode and *Key Server* on, and note the TV's IP address.
2. On your computer (Node 18+):
   ```sh
   npm install
   npx ares-setup-device            # add the TV: host = TV IP, port 9922, user = prestodev; name it "tv"
   npx ares-novacom --device tv --getkey   # enter the passphrase shown in the Developer Mode app
   npm run package                  # -> dist/com.iptvforall.app_0.1.0_all.ipk
   npm run install:tv
   npm run launch:tv
   ```
3. Dev Mode sessions expire after a while; re-open the Developer Mode app and extend the session when the app stops launching.

CI builds the `.ipk` on every push (see the **ipk** artifact of the workflow run).

## Adding a playlist

Typing on a TV is slow, so the form takes the minimum: for **M3U**, a URL; for **Xtream**, server URL, username, password.
Tip: type long URLs once using the Magic Remote's on-screen keyboard, or use a short link from a URL shortener.

If the TV cannot reach your provider's API because of CORS rules, set a **CORS proxy** prefix in Settings
(the real URL is appended URL-encoded). Streams themselves are played by the TV's media pipeline and do not need CORS.

## Develop on a desktop

```sh
npm install
npm run mock:media     # one-time, needs ffmpeg: generates a test pattern (no real content)
npm run dev            # http://localhost:8080  (Xtream demo/demo at http://localhost:8080, M3U at /playlist.m3u)
```

Open it in a browser. The 1920x1080 stage scales to the window; arrow keys = D-pad, Enter = OK, Esc = Back, F1-F4 = Red/Green/Yellow/Blue, PageUp/PageDown = CH+/CH-.

```sh
npm test               # unit tests: M3U parser, Xtream client
npm run check:syntax   # app code must stay ES2015 (webOS 4 ships Chromium 53)
node tests/e2e/smoke.mjs   # drives the whole UI with key presses against the mock server (needs playwright + Chromium)
```

### Layout

```
app/                 the webOS app (this folder is what ares-package ships)
  appinfo.json
  js/m3u.js          M3U parser (also runs in Node for tests)
  js/xtream.js       Xtream Codes API client (also runs in Node)
  js/engine.js       <video> + hls.js wrapper, retries, stall watchdog
  js/widgets.js      VirtualGrid (windowed list/grid), ListZone (buttons/inputs/selects)
  js/screens/*.js    playlists, form, settings, main browser, series, player
tools/mock-server.mjs   fake Xtream + M3U provider and static server for development
tests/                  unit + e2e
```

## Status and limitations

- Developed and tested in desktop Chromium against the mock server (unit tests, a full keyboard-driven end-to-end run, and a successful `ares-package`).
  **It has not been run on a physical LG TV yet**: expect to find webOS-specific rough edges. Issues and PRs are welcome.
- Not implemented yet: XMLTV EPG for plain M3U playlists, subtitles, catch-up/timeshift, parental lock, casting, entering playlists from a phone.
- Plain-M3U movies/series are detected only from Xtream-style URLs (`/movie/`, `/series/`) or video file extensions; everything else is Live.
- Browsers cannot send custom HTTP headers for media; `|User-Agent=...` suffixes in M3U URLs are ignored.
- You are responsible for only using playlists and services you are entitled to.

## License

Apache-2.0, see [LICENSE](LICENSE). `app/js/vendor/hls.min.js` is [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0, license in `app/js/vendor/hls.js.LICENSE`).
