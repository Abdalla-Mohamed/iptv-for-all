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
    url: '',
    live: false,
    startAt: 0,
    retries: 0,
    bufferingSince: 0,
    watchdog: null,
    onEvent: function () {},   // (type, data) type: loading | playing | paused | ended | error | time | meta

    init: function () {
      var v = Engine.video = document.getElementById('video');
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
      v.addEventListener('error', function () {
        if (Engine.cache) return;                              // the cache player reacts and falls back itself
        var codes = { 1: 'Playback aborted', 2: 'Network error', 3: 'Media could not be decoded', 4: 'Stream format not supported or unavailable' };
        Engine.fail(codes[v.error && v.error.code] || 'Playback error');
      });
    },

    load: function (url, opts) {
      opts = opts || {};
      Engine.stop();
      Engine.url = url;
      Engine.live = !!opts.live;
      Engine.startAt = opts.startAt || 0;
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

    /** Cycle audio language. Returns the new track label, or null if there is nothing to switch to. */
    nextAudio: function () {
      var v = Engine.video, hls = Engine.hls;
      if (hls && hls.audioTracks && hls.audioTracks.length > 1) {
        hls.audioTrack = (hls.audioTrack + 1) % hls.audioTracks.length;
        var t = hls.audioTracks[hls.audioTrack];
        return t.name || t.lang || ('Track ' + (hls.audioTrack + 1));
      }
      var tracks = v.audioTracks;
      if (tracks && tracks.length > 1) {
        var cur = 0, i;
        for (i = 0; i < tracks.length; i++) if (tracks[i].enabled) cur = i;
        for (i = 0; i < tracks.length; i++) tracks[i].enabled = (i === (cur + 1) % tracks.length);
        var n = tracks[(cur + 1) % tracks.length];
        return n.label || n.language || ('Track ' + (((cur + 1) % tracks.length) + 1));
      }
      return null;
    }
  };

  IPTV.Engine = Engine;
})(window);
