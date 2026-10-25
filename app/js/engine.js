/* Playback engine around the <video> element: native HLS on webOS, hls.js elsewhere, plain src for TS/MP4/MKV. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};

  var MAX_RETRIES = 3;
  var STALL_LIMIT_MS = 20000;

  var Engine = {
    video: null,
    hls: null,
    cache: null,               // CachePlayer while the smart cache is active
    cacheRefilling: false,
    audioIndex: null,          // chosen audio track for the smart cache (it plays one audio track at a time)
    prefs: { audio: false, text: false },   // language preferences applied once per load (user choice stops it)
    url: '',
    live: false,
    startAt: 0,
    retries: 0,
    bufferingSince: 0,
    watchdog: null,
    onEvent: function () {},   // (type, data) type: loading | playing | paused | ended | error | time | meta

    init: function () {
      Engine.bind(document.getElementById('video'));
    },

    /**
     * hls.js adds subtitle TextTracks to the element and a browser can never remove them, so after an HLS stream
     * every later video would list the old tracks. Whenever the previous playback left tracks behind, continue on a
     * fresh <video> (same id, same picture mode).
     */
    freshVideo: function () {
      var old = Engine.video;
      if (!old.textTracks || !old.textTracks.length) return;
      var v = document.createElement('video');
      v.id = old.id;
      v.setAttribute('playsinline', '');
      v.style.objectFit = old.style.objectFit;
      old.parentNode.replaceChild(v, old);
      Engine.bind(v);
    },

    bind: function (v) {
      Engine.video = v;
      v.addEventListener('playing', function () { Engine.bufferingSince = 0; Engine.retries = 0; Engine.onEvent('playing'); });
      v.addEventListener('pause', function () {
        if (Engine.cache && Engine.cache.autoPaused) return;   // the cache is refilling, not the user pausing
        Engine.onEvent('paused');
      });
      v.addEventListener('waiting', function () { Engine.bufferingSince = Engine.bufferingSince || Date.now(); Engine.onEvent('loading'); });
      v.addEventListener('ended', function () { Engine.onEvent('ended'); });
      v.addEventListener('timeupdate', function () { Engine.onEvent('time'); });
      v.addEventListener('loadedmetadata', function () {
        if (!Engine.live && Engine.startAt > 0 && isFinite(v.duration) && Engine.startAt < v.duration - 5) {
          v.currentTime = Engine.startAt;
        }
        Engine.onEvent('meta');
      });
      var onTracks = function () { Engine.applyPreferences(); };
      if (v.textTracks && v.textTracks.addEventListener) v.textTracks.addEventListener('addtrack', onTracks);
      if (v.audioTracks && v.audioTracks.addEventListener) v.audioTracks.addEventListener('addtrack', onTracks);
      v.addEventListener('loadedmetadata', onTracks);
      v.addEventListener('error', function () {
        if (Engine.cache) return;                              // the cache player reacts and falls back itself
        var codes = { 1: 'Playback aborted', 2: 'Network error', 3: 'Media could not be decoded', 4: 'Stream format not supported or unavailable' };
        Engine.fail(codes[v.error && v.error.code] || 'Playback error');
      });
    },

    load: function (url, opts) {
      opts = opts || {};
      Engine.stop();
      Engine.freshVideo();
      Engine.url = url;
      Engine.live = !!opts.live;
      Engine.startAt = opts.startAt || 0;
      Engine.audioIndex = opts.audioIndex == null ? null : opts.audioIndex;
      Engine.prefs = { audio: opts.audioIndex != null, text: false };
      Engine.retries = 0;
      Engine.start();
      Engine.watchdog = setInterval(Engine.checkStall, 4000);
    },

    start: function () {
      var v = Engine.video, url = Engine.url;
      var pref = IPTV.Store.settings().hlsEngine;
      var isHls = /\.m3u8(\?|#|$)/i.test(url) || /[?&]output=m3u8/i.test(url);
      var nativeHls = !!v.canPlayType('application/vnd.apple.mpegurl');
      var cfg = IPTV.Store.settings();
      if (!isHls && !Engine.live && cfg.cacheMb > 0 && IPTV.CachePlayer && IPTV.CachePlayer.supported(url)) {
        Engine.startCache(url, cfg.cacheMb);
        return;
      }
      var useHlsJs = isHls && root.Hls && root.Hls.isSupported() && (pref === 'hlsjs' || (pref === 'auto' && !nativeHls));

      Engine.onEvent('loading');
      if (useHlsJs) {
        var Hls = root.Hls, vodSecs = cfg.hlsBufferSec;
        var hls = Engine.hls = new Hls(Engine.live ? {
          maxBufferLength: 30, liveSyncDurationCount: 3, manifestLoadingTimeOut: 15000
        } : {
          // movies: read far ahead and keep some history so rewinding is instant
          maxBufferLength: vodSecs, maxMaxBufferLength: Math.max(600, vodSecs), maxBufferSize: 200 * 1000 * 1000,
          backBufferLength: 60, manifestLoadingTimeOut: 15000, startPosition: Engine.startAt || -1
        });
        hls.on(Hls.Events.ERROR, function (e, data) {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && Engine.retries++ < MAX_RETRIES) hls.recoverMediaError();
          else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && Engine.retries++ < MAX_RETRIES) hls.startLoad();
          else Engine.fail('Stream error (' + data.details + ')');
        });
        var onHlsTracks = function () { Engine.applyPreferences(); };
        hls.on(Hls.Events.MANIFEST_PARSED, onHlsTracks);
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, onHlsTracks);
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, onHlsTracks);
        hls.loadSource(url);
        hls.attachMedia(v);
      } else {
        v.src = url;
      }
      var p = v.play();
      if (p && p.catch) p.catch(function () { /* autoplay blocked or superseded by a newer load() */ });
    },

    startCache: function (url, mb) {
      var v = Engine.video;
      Engine.cache = new IPTV.CachePlayer(v, url, {
        startAt: Engine.startAt,
        cacheBytes: mb * 1024 * 1024,
        audioIndex: Engine.audioIndex,
        preferAudio: IPTV.Store.settings().audioLang,
        onStatus: function (st) {
          // entering a refill (start or mid-playback underrun) must show the spinner; leaving it fires 'playing'
          if (st.state === 'buffering' && !Engine.cacheRefilling) Engine.onEvent('loading');
          Engine.cacheRefilling = st.state === 'buffering';
          Engine.onEvent('buffer', st);
        },
        onFallback: function (reason, time) {
          if (Engine.url !== url) return;
          Engine.teardown();
          Engine.startAt = time;
          Engine.onEvent('notice', 'Smart cache off for this video (' + reason + ')');
          v.src = url;
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        }
      });
      Engine.onEvent('loading');
      Engine.cache.start();
    },

    /** Cached range around the playhead (works for the smart cache, hls.js and native playback). */
    bufferInfo: function () {
      var v = Engine.video, b = v.buffered, t = v.currentTime;
      for (var i = 0; i < b.length; i++) {
        if (t >= b.start(i) - 0.15 && t <= b.end(i)) return { start: b.start(i), end: b.end(i), ahead: b.end(i) - t };
      }
      return { start: t, end: t, ahead: 0 };
    },

    /** Live streams get a few automatic retries; VOD fails immediately. */
    fail: function (msg) {
      if (Engine.live && Engine.retries < MAX_RETRIES) {
        Engine.retries++;
        Engine.onEvent('loading');
        var url = Engine.url;
        setTimeout(function () {
          if (Engine.url !== url) return;   // channel changed meanwhile
          Engine.teardown();
          Engine.start();
        }, 2000);
        return;
      }
      Engine.onEvent('error', msg);
    },

    checkStall: function () {
      if (Engine.live && Engine.bufferingSince && Date.now() - Engine.bufferingSince > STALL_LIMIT_MS) {
        Engine.bufferingSince = 0;
        Engine.fail('Stream stalled');
      }
    },

    teardown: function () {
      var v = Engine.video;
      if (Engine.cache) { Engine.cache.destroy(); Engine.cache = null; Engine.cacheRefilling = false; }
      if (Engine.hls) { Engine.hls.destroy(); Engine.hls = null; }
      v.pause();
      v.removeAttribute('src');
      v.load();
    },

    stop: function () {
      clearInterval(Engine.watchdog);
      Engine.url = '';
      Engine.bufferingSince = 0;
      if (Engine.video) Engine.teardown();
    },

    togglePause: function () {
      var v = Engine.video;
      if (Engine.cache && Engine.cache.autoPaused) { Engine.cache.forcePlay(); return; }   // skip the refill wait
      if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause();
    },

    seekTo: function (sec) {
      var v = Engine.video;
      if (isFinite(v.duration)) v.currentTime = IPTV.clamp(sec, 0, v.duration);
    },

    setAspect: function (mode) { Engine.video.style.objectFit = mode; },

    // ---- audio / subtitle tracks (hls.js, the smart cache or the TV's own player) ----------------------------------------

    /** Native text tracks that are subtitles/captions (hls.js manages its own, see below). */
    nativeText: function () {
      var out = [], list = Engine.video.textTracks || [];
      for (var i = 0; i < list.length; i++) if (list[i].kind === 'subtitles' || list[i].kind === 'captions') out.push(list[i]);
      return out;
    },

    /**
     * { audio: [{id, label, lang, active}], text: [{id, label, lang, active}] }. ids are source specific: pass them
     * back to setAudio / setText. Text id -1 means "off".
     */
    tracks: function () {
      var v = Engine.video, hls = Engine.hls, cache = Engine.cache, L = IPTV.Langs, out = { audio: [], text: [] }, i, t;
      if (hls) {
        (hls.audioTracks || []).forEach(function (a, n) { out.audio.push({ id: n, lang: a.lang || '', label: L.label({ lang: a.lang, label: a.name }, n), active: hls.audioTrack === n }); });
        (hls.subtitleTracks || []).forEach(function (a, n) { out.text.push({ id: n, lang: a.lang || '', label: L.label({ lang: a.lang, label: a.name }, n), active: hls.subtitleTrack === n }); });
        return out;
      }
      if (cache) {
        cache.audioTracks.forEach(function (a, n) { out.audio.push({ id: n, lang: a.lang, label: L.label(a, n), active: cache.audioIndex === n }); });
      } else if (v.audioTracks) {
        for (i = 0; i < v.audioTracks.length; i++) {
          t = v.audioTracks[i];
          out.audio.push({ id: i, lang: t.language || '', label: L.label({ lang: t.language, label: t.label }, i), active: !!t.enabled });
        }
      }
      Engine.nativeText().forEach(function (tt, n) {
        out.text.push({ id: n, lang: tt.language || '', label: L.label({ lang: tt.language, label: tt.label }, n), active: tt.mode === 'showing' });
      });
      return out;
    },

    /** Switch audio. `auto` marks a preference-driven choice (the user's own choice stops later automatic ones). */
    setAudio: function (id, auto) {
      var v = Engine.video, hls = Engine.hls;
      if (!auto) Engine.prefs.audio = true;
      if (hls) { hls.audioTrack = id; return; }
      if (Engine.cache) {                       // MSE plays one audio track: restart there with the other one
        if (auto || id === Engine.cache.audioIndex) return;
        Engine.load(Engine.url, { live: false, startAt: v.currentTime, audioIndex: id });
        return;
      }
      if (v.audioTracks) for (var i = 0; i < v.audioTracks.length; i++) v.audioTracks[i].enabled = (i === id);
    },

    /** Show subtitle track `id`, or hide them with -1. */
    setText: function (id, auto) {
      var hls = Engine.hls;
      if (!auto) Engine.prefs.text = true;
      if (hls) { hls.subtitleDisplay = id >= 0; hls.subtitleTrack = id; return; }
      Engine.nativeText().forEach(function (tt, n) { tt.mode = n === id ? 'showing' : 'disabled'; });
    },

    /** Once per load: pick the audio / subtitle languages from Settings as soon as the tracks are known. */
    applyPreferences: function () {
      if (!Engine.url) return;
      var cfg = IPTV.Store.settings(), t = Engine.tracks(), i;
      if (!Engine.prefs.audio && t.audio.length > 1) {
        Engine.prefs.audio = true;
        i = IPTV.Langs.pick(t.audio, cfg.audioLang);
        if (i >= 0 && !t.audio[i].active) Engine.setAudio(t.audio[i].id, true);
      }
      if (!Engine.prefs.text && t.text.length) {
        Engine.prefs.text = true;
        i = IPTV.Langs.pick(t.text, cfg.subLang);
        Engine.setText(i >= 0 ? t.text[i].id : -1, true);     // no preference, or no match: subtitles off
      }
    }
  };

  IPTV.Engine = Engine;
})(window);
