/* Xtream Codes API client (player_api.php). Works in the browser and in Node (for tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.IPTV = root.IPTV || {}).Xtream = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** "demo.tv:8080/c/" -> "http://demo.tv:8080" */
  function normalizeServer(url) {
    url = String(url || '').trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    url = url.replace(/[?#].*$/, '').replace(/\/+$/, '');
    url = url.replace(/\/(player_api|get|panel_api|xmltv)\.php$/i, '').replace(/\/c$/i, '');
    return url.replace(/\/+$/, '');
  }

  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') return Object.keys(v).map(function (k) { return v[k]; });
    return [];
  }

  function b64(s) {
    if (!s) return '';
    try {
      var bin = (typeof atob === 'function') ? atob(s) : Buffer.from(s, 'base64').toString('binary');
      return decodeURIComponent(escape(bin));
    } catch (e) { return String(s); }
  }

  var SECTIONS = {
    live: { cats: 'get_live_categories', items: 'get_live_streams' },
    vod: { cats: 'get_vod_categories', items: 'get_vod_streams' },
    series: { cats: 'get_series_categories', items: 'get_series' }
  };

  function XtreamProvider(cfg, deps) {
    this.type = 'xtream';
    this.hasEpg = true;
    this.cfg = cfg;
    this.http = deps.http;
    this.getSettings = deps.getSettings || function () { return {}; };
    this.store = deps.store || null;       // persistent saved copies (see library-cache.js)
    this.isStale = deps.isStale || function () { return true; };
    this.describeAge = deps.age || function () { return 'earlier'; };
    this.server = normalizeServer(cfg.server);
    this.sections = {};
    this.forced = {};                      // kinds the user asked to reload (network first)
    this.updatedAt = {};                   // kind -> ms the data was downloaded
    this.onRefresh = null;                 // (kind, section) when a background refresh finished
    this.onNotice = null;                  // (message) e.g. "Provider unreachable, showing the saved copy"
    this.epgCache = {};
  }

  var P = XtreamProvider.prototype;

  P.kinds = function () { return ['live', 'vod', 'series']; };
  P.prepare = function () { return Promise.resolve(); };
  /** Reload: forget what is in memory and go to the network first (the saved copy is only a fallback). */
  P.reset = function () {
    this.sections = {};
    this.epgCache = {};
    this.forced = { live: true, vod: true, series: true };
  };

  P.cacheKey = function (kind) { return 'pl:' + this.cfg.id + ':' + kind; };

  P.age = function (kind) { return this.updatedAt[kind] || 0; };

  P.apiUrl = function (action, params) {
    var q = 'username=' + encodeURIComponent(this.cfg.username) + '&password=' + encodeURIComponent(this.cfg.password);
    if (action) q += '&action=' + action;
    for (var k in (params || {})) q += '&' + k + '=' + encodeURIComponent(params[k]);
    return this.server + '/player_api.php?' + q;
  };

  P.api = function (action, params, opts) {
    return this.http.getJSON(this.apiUrl(action, params), opts);
  };

  /** Validates credentials. Resolves with a short account summary, rejects with a readable error. */
  P.login = function () {
    return this.api('', null).then(function (json) {
      var u = json && json.user_info;
      if (!u || String(u.auth) === '0') throw new Error('Login failed: wrong username or password.');
      var status = u.status || 'Active';
      if (/expired|disabled|banned/i.test(status)) throw new Error('Account is ' + String(status).toLowerCase() + '.');
      return {
        status: status,
        expires: u.exp_date ? new Date(Number(u.exp_date) * 1000) : null,
        maxConnections: u.max_connections ? Number(u.max_connections) : null
      };
    });
  };

  /** Download one section from the provider, normalize it, save a copy for the next start. */
  P.download = function (kind) {
    var self = this, def = SECTIONS[kind], big = { timeout: 90000 };
    return Promise.all([
      this.api(def.cats, null, big),
      this.api(def.items, null, big)
    ]).then(function (r) {
      var sec = self.normalize(kind, asArray(r[0]), asArray(r[1]));
      var at = Date.now();
      self.updatedAt[kind] = at;
      if (self.store) self.store.set(self.cacheKey(kind), { at: at, cats: sec.cats, items: sec.items });
      return sec;
    });
  };

  /** A saved record -> section (the per-category index is rebuilt, it is not stored). */
  P.fromSaved = function (rec) {
    var byCat = {};
    for (var i = 0; i < rec.items.length; i++) (byCat[rec.items[i].cat] = byCat[rec.items[i].cat] || []).push(rec.items[i]);
    return { cats: rec.cats, items: rec.items, byCat: byCat };
  };

  /**
   * Saved copy first (instant start, works offline); refreshed in the background when older than the refresh setting.
   * After a manual reload the network goes first and the saved copy is the fallback.
   */
  P.ensure = function (kind) {
    var self = this;
    if (this.sections[kind]) return this.sections[kind];
    var force = !!this.forced[kind];
    delete this.forced[kind];
    var saved = this.store ? this.store.get(this.cacheKey(kind)) : Promise.resolve(null);

    this.sections[kind] = saved.then(function (rec) {
      var usable = rec && rec.items && rec.cats;
      if (usable && !force) {
        self.updatedAt[kind] = rec.at;
        if (self.isStale(rec.at, self.getSettings().refreshHours)) self.refreshInBackground(kind);
        return self.fromSaved(rec);
      }
      return self.download(kind).catch(function (err) {
        if (usable) {      // provider down / slow: the saved copy is better than an error
          self.updatedAt[kind] = rec.at;
          if (self.onNotice) self.onNotice('Provider not reachable: showing the copy saved ' + self.describeAge(rec.at));
          return self.fromSaved(rec);
        }
        throw err;
      });
    }).catch(function (err) {
      delete self.sections[kind];   // allow retry
      throw err;
    });
    return this.sections[kind];
  };

  P.refreshInBackground = function (kind) {
    var self = this;
    this.download(kind).then(function (sec) {
      self.sections[kind] = Promise.resolve(sec);
      if (self.onRefresh) self.onRefresh(kind, sec);
    }).catch(function () { /* stay on the saved copy */ });
  };

  P.normalize = function (kind, rawCats, rawItems) {
    var cats = [], catMap = {}, byCat = {}, items = new Array(rawItems.length);
    rawCats.forEach(function (c) {
      var id = String(c.category_id);
      catMap[id] = { id: id, name: c.category_name || 'Unnamed', count: 0 };
    });
    for (var i = 0; i < rawItems.length; i++) {
      var r = rawItems[i];
      var cat = r.category_id == null || r.category_id === '' ? '0' : String(r.category_id);
      if (!catMap[cat]) catMap[cat] = { id: cat, name: 'Uncategorized', count: 0 };
      catMap[cat].count++;
      var item;
      if (kind === 'series') {
        item = { id: String(r.series_id), key: 'x:series:' + r.series_id, kind: 'series', name: r.name || '?',
                 logo: r.cover || '', cat: cat, plot: r.plot || '', rating: r.rating || '' };
      } else if (kind === 'vod') {
        item = { id: String(r.stream_id), key: 'x:vod:' + r.stream_id, kind: 'vod', name: r.name || '?',
                 logo: r.stream_icon || '', cat: cat, ext: r.container_extension || 'mp4', rating: r.rating || '' };
      } else {
        item = { id: String(r.stream_id), key: 'x:live:' + r.stream_id, kind: 'live', name: r.name || '?',
                 logo: r.stream_icon || '', cat: cat, num: Number(r.num) || i + 1, epgId: r.epg_channel_id || '' };
      }
      items[i] = item;
      (byCat[cat] = byCat[cat] || []).push(item);
    }
    // Server order for categories; hide empty ones.
    rawCats.forEach(function (c) { var m = catMap[String(c.category_id)]; if (m.count) cats.push(m); delete catMap[String(c.category_id)]; });
    Object.keys(catMap).forEach(function (id) { if (catMap[id].count) cats.push(catMap[id]); });
    return { cats: cats, items: items, byCat: byCat };
  };

  P.urlFor = function (item) {
    var base = this.server, u = encodeURIComponent(this.cfg.username), p = encodeURIComponent(this.cfg.password);
    if (item.kind === 'live') {
      var fmt = this.getSettings().liveFormat === 'ts' ? 'ts' : 'm3u8';
      return base + '/live/' + u + '/' + p + '/' + item.id + '.' + fmt;
    }
    if (item.kind === 'vod') return base + '/movie/' + u + '/' + p + '/' + item.id + '.' + (item.ext || 'mp4');
    if (item.kind === 'episode') return base + '/series/' + u + '/' + p + '/' + item.id + '.' + (item.ext || 'mp4');
    throw new Error('Not playable: ' + item.kind);
  };

  P.seriesInfo = function (item) {
    return this.api('get_series_info', { series_id: item.id }, { timeout: 45000 }).then(function (j) {
      var info = j.info || {}, seasons = [], eps = j.episodes || {};
      var nums = Object.keys(eps);
      nums.sort(function (a, b) { return Number(a) - Number(b); });
      nums.forEach(function (n) {
        var list = asArray(eps[n]).map(function (e, i) {
          var meta = e.info || {};
          return {
            id: String(e.id), key: 'x:ep:' + e.id, kind: 'episode',
            name: e.title || ('Episode ' + (e.episode_num || i + 1)),
            num: Number(e.episode_num) || i + 1, ext: e.container_extension || 'mp4',
            duration: Number(meta.duration_secs) || 0, logo: meta.movie_image || '', plot: meta.plot || ''
          };
        });
        seasons.push({ num: Number(n), name: 'Season ' + n, episodes: list });
      });
      return {
        title: info.name || item.name, cover: info.cover || item.logo, plot: info.plot || item.plot || '',
        genre: info.genre || '', rating: info.rating || item.rating || '', seasons: seasons
      };
    });
  };

  /** Now/next programmes: [{title, desc, start, end}] with ms timestamps. */
  P.epg = function (item) {
    var cached = this.epgCache[item.id];
    if (cached && Date.now() - cached.at < 120000) return cached.promise;
    var promise = this.api('get_short_epg', { stream_id: item.id, limit: 4 }, { timeout: 10000 }).then(function (j) {
      return asArray(j && j.epg_listings).map(function (e) {
        return { title: b64(e.title), desc: b64(e.description),
                 start: Number(e.start_timestamp) * 1000, end: Number(e.stop_timestamp) * 1000 };
      }).filter(function (e) { return e.title && e.end > 0; });
    }).catch(function () { return []; });
    this.epgCache[item.id] = { at: Date.now(), promise: promise };
    return promise;
  };

  return { Provider: XtreamProvider, normalizeServer: normalizeServer };
});
