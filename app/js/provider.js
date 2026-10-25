/* Provider = a playlist source behind one interface (M3U file or Xtream account). */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};

  function M3UProvider(cfg, deps) {
    deps = deps || {};
    this.type = 'm3u';
    this.hasEpg = false;
    this.cfg = cfg;
    this.lib = null;
    this.pending = null;
    this.store = deps.store || null;
    this.isStale = deps.isStale || function () { return true; };
    this.describeAge = deps.age || function () { return 'earlier'; };
    this.getSettings = deps.getSettings || function () { return {}; };
    this.forced = false;
    this.updatedAt = 0;
    this.onRefresh = null;
    this.onNotice = null;
  }

  var P = M3UProvider.prototype;

  P.reset = function () { this.lib = null; this.pending = null; this.forced = true; };

  P.cacheKey = function () { return 'pl:' + this.cfg.id + ':lib'; };
  P.age = function () { return this.updatedAt; };

  /** Download + parse the file, save the parsed library for the next start. */
  P.download = function () {
    var self = this;
    return IPTV.Http.getText(this.cfg.url, { timeout: 120000 }).then(function (text) {
      var parsed = IPTV.M3U.parse(text);
      if (!parsed.items.length) throw new Error('No channels found. Is this really an M3U playlist?');
      var lib = IPTV.M3U.buildLibrary(parsed.items);
      self.updatedAt = Date.now();
      if (self.store) self.store.set(self.cacheKey(), { at: self.updatedAt, lib: self.strip(lib) });
      return lib;
    });
  };

  /** byCat is derived data: keep it out of the saved copy. */
  P.strip = function (lib) {
    var out = {};
    ['live', 'vod', 'series'].forEach(function (k) { out[k] = { cats: lib[k].cats, items: lib[k].items }; });
    return out;
  };

  P.inflate = function (saved) {
    var lib = {};
    ['live', 'vod', 'series'].forEach(function (k) {
      var items = saved[k].items, byCat = {};
      for (var i = 0; i < items.length; i++) (byCat[items[i].cat] = byCat[items[i].cat] || []).push(items[i]);
      lib[k] = { cats: saved[k].cats, items: items, byCat: byCat };
    });
    return lib;
  };

  /**
   * One download serves every section. A saved copy makes the start instant (and is refreshed in the background
   * when older than the refresh setting); after a manual reload the network goes first and the copy is the fallback.
   */
  P.prepare = function () {
    var self = this;
    if (this.lib) return Promise.resolve();
    if (!this.pending) {
      var force = this.forced;
      this.forced = false;
      var saved = this.store ? this.store.get(this.cacheKey()) : Promise.resolve(null);
      this.pending = saved.then(function (rec) {
        var usable = rec && rec.lib && rec.lib.live;
        if (usable && !force) {
          self.lib = self.inflate(rec.lib);
          self.updatedAt = rec.at;
          if (self.isStale(rec.at, self.getSettings().refreshHours)) self.refreshInBackground();
          return;
        }
        return self.download().then(function (lib) { self.lib = lib; }, function (err) {
          if (!usable) throw err;
          self.lib = self.inflate(rec.lib);
          self.updatedAt = rec.at;
          if (self.onNotice) self.onNotice('Provider not reachable: showing the copy saved ' + self.describeAge(rec.at));
        });
      }).catch(function (err) {
        self.pending = null;
        throw err;
      });
    }
    return this.pending;
  };

  P.refreshInBackground = function () {
    var self = this;
    this.download().then(function (lib) {
      self.lib = lib;
      if (self.onRefresh) ['live', 'vod', 'series'].forEach(function (k) { self.onRefresh(k, lib[k]); });
    }).catch(function () { /* stay on the saved copy */ });
  };

  P.kinds = function () {
    var lib = this.lib;
    return ['live', 'vod', 'series'].filter(function (k) { return lib && lib[k].items.length; });
  };

  P.ensure = function (kind) {
    var self = this;
    return this.prepare().then(function () { return self.lib[kind]; });
  };

  P.urlFor = function (item) { return item.url; };
  P.epg = function () { return Promise.resolve([]); };
  P.seriesInfo = function () { return Promise.reject(new Error('Series browsing needs an Xtream account.')); };

  /** Saved copies of downloaded playlists (IndexedDB). */
  IPTV.library = IPTV.LibraryCache.create(root.indexedDB, 'iptv-library');

  IPTV.createProvider = function (playlist) {
    var deps = { http: IPTV.Http, getSettings: IPTV.Store.settings, store: IPTV.library,
                 isStale: IPTV.LibraryCache.isStale, age: IPTV.LibraryCache.age };
    return playlist.type === 'xtream' ? new IPTV.Xtream.Provider(playlist, deps) : new M3UProvider(playlist, deps);
  };
})(window);
