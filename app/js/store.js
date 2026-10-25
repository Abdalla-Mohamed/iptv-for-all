/* Persistent state (localStorage): playlists, settings, favorites, recents, resume points. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var PREFIX = 'iptv.';
  var MAX_RECENT = 40;
  var MAX_PROGRESS = 300;

  var DEFAULTS = {
    liveFormat: 'm3u8',  // Xtream live container: m3u8 | ts
    hlsEngine: 'auto',   // auto | native | hlsjs
    aspect: 'contain',   // contain | cover | fill
    corsProxy: '',       // optional prefix; the real URL is appended URL-encoded
    cacheMb: 128,        // smart cache for MP4 movies/episodes: 0 = off, else memory budget in MB
    hlsBufferSec: 120,   // hls.js read-ahead for HLS movies
    refreshHours: 6,     // refresh a saved playlist in the background when older than this: 0 = every start, -1 = manual
    audioLang: '',       // preferred audio language code ('' = whatever the stream starts with)
    subLang: '',         // preferred subtitle language code ('' = subtitles off)
    subSize: 'medium'    // small | medium | large
  };

  function read(key, def) {
    try {
      var v = root.localStorage.getItem(PREFIX + key);
      return v == null ? def : JSON.parse(v);
    } catch (e) { return def; }
  }
  function write(key, val) {
    try { root.localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch (e) { /* quota / private mode */ }
  }
  function drop(key) {
    try { root.localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
  }

  var Store = {
    // ---- playlists -------------------------------------------------------
    playlists: function () { return read('playlists', []); },
    getPlaylist: function (id) {
      var all = Store.playlists();
      for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
      return null;
    },
    savePlaylist: function (pl) {
      var all = Store.playlists();
      if (!pl.id) pl.id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      var found = false;
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === pl.id) { all[i] = pl; found = true; }
      }
      if (!found) all.push(pl);
      write('playlists', all);
      return pl;
    },
    removePlaylist: function (id) {
      write('playlists', Store.playlists().filter(function (p) { return p.id !== id; }));
      drop('fav.' + id); drop('recent.' + id); drop('progress.' + id);
      if (Store.activeId() === id) drop('active');
    },
    activeId: function () { return read('active', null); },
    setActiveId: function (id) { write('active', id); },

    // ---- settings --------------------------------------------------------
    settings: function () {
      var s = read('settings', {}), out = {};
      for (var k in DEFAULTS) out[k] = s[k] != null ? s[k] : DEFAULTS[k];
      return out;
    },
    setSetting: function (key, val) {
      var s = read('settings', {});
      s[key] = val;
      write('settings', s);
    },

    // ---- favorites (map of item key -> 1) --------------------------------
    favs: function (pid) { return read('fav.' + pid, {}); },
    isFav: function (pid, key) { return !!Store.favs(pid)[key]; },
    toggleFav: function (pid, key) {
      var f = Store.favs(pid), on = !f[key];
      if (on) f[key] = 1; else delete f[key];
      write('fav.' + pid, f);
      return on;
    },

    // ---- recents (most recent first, per kind) ---------------------------
    recents: function (pid, kind) { return (read('recent.' + pid, {}))[kind] || []; },
    pushRecent: function (pid, kind, key) {
      var all = read('recent.' + pid, {});
      var list = (all[kind] || []).filter(function (k) { return k !== key; });
      list.unshift(key);
      all[kind] = list.slice(0, MAX_RECENT);
      write('recent.' + pid, all);
    },

    // ---- resume points: key -> [seconds, savedAt, duration, meta] ---------------------------------------------
    getProgress: function (pid, key) {
      var p = read('progress.' + pid, {})[key];
      return p ? p[0] : 0;
    },
    setProgress: function (pid, key, seconds, duration, meta) {
      var all = read('progress.' + pid, {});
      if (seconds > 0) all[key] = [Math.floor(seconds), Date.now(), Math.floor(duration || 0), meta || (all[key] && all[key][3]) || null];
      else delete all[key];
      var keys = Object.keys(all);
      if (keys.length > MAX_PROGRESS) {
        keys.sort(function (a, b) { return all[a][1] - all[b][1]; });
        for (var i = 0; i < keys.length - MAX_PROGRESS; i++) delete all[keys[i]];
      }
      write('progress.' + pid, all);
    },
    /** All unfinished titles, newest first: [{key, seconds, at, duration, meta}] */
    progressEntries: function (pid) {
      var all = read('progress.' + pid, {});
      return Object.keys(all).map(function (k) {
        return { key: k, seconds: all[k][0], at: all[k][1], duration: all[k][2] || 0, meta: all[k][3] || null };
      }).sort(function (a, b) { return b.at - a.at; });
    },

    clearAll: function () {
      try { root.localStorage.clear(); } catch (e) { /* ignore */ }
    }
  };

  IPTV.Store = Store;
})(window);
