/* Provider = a playlist source behind one interface (M3U file or Xtream account). */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};

  function M3UProvider(cfg) {
    this.type = 'm3u';
    this.hasEpg = false;
    this.cfg = cfg;
    this.lib = null;
    this.pending = null;
  }

  var P = M3UProvider.prototype;

  P.reset = function () { this.lib = null; this.pending = null; };

  /** Downloads + parses the whole file once; every section is served from it. */
  P.prepare = function () {
    var self = this;
    if (this.lib) return Promise.resolve();
    if (!this.pending) {
      this.pending = IPTV.Http.getText(this.cfg.url, { timeout: 120000 }).then(function (text) {
        var parsed = IPTV.M3U.parse(text);
        if (!parsed.items.length) throw new Error('No channels found. Is this really an M3U playlist?');
        self.lib = IPTV.M3U.buildLibrary(parsed.items);
      }).catch(function (err) {
        self.pending = null;
        throw err;
      });
    }
    return this.pending;
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

  IPTV.createProvider = function (playlist) {
    if (playlist.type === 'xtream') {
      return new IPTV.Xtream.Provider(playlist, { http: IPTV.Http, getSettings: IPTV.Store.settings });
    }
    return new M3UProvider(playlist);
  };
})(window);
