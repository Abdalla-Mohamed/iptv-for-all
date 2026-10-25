/* Persistent key/value store for downloaded playlists (IndexedDB; localStorage is far too small for a 50k-channel
 * catalog). Every method resolves and never rejects: if IndexedDB is missing or broken the app simply behaves as
 * if nothing was saved. Works in the browser and, with MemoryStore, in Node tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.IPTV = root.IPTV || {}).LibraryCache = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORE = 'kv';

  /**
   * hours: < 0 never refresh automatically, 0 refresh on every start, n refresh when older than n hours.
   * `at` is the time the data was downloaded (ms).
   */
  function isStale(at, hours, now) {
    if (hours < 0) return false;
    if (hours === 0 || !at) return true;
    return (now == null ? Date.now() : now) - at > hours * 3600 * 1000;
  }

  /** "3 h ago" style label for the header. */
  function age(at, now) {
    var min = Math.max(0, Math.round(((now == null ? Date.now() : now) - at) / 60000));
    if (min < 2) return 'just now';
    if (min < 90) return min + ' min ago';
    if (min < 36 * 60) return Math.round(min / 60) + ' h ago';
    return Math.round(min / 1440) + ' days ago';
  }

  // ---- in-memory implementation (tests, or when IndexedDB is unavailable) --------------------------------
  function MemoryStore() { this.data = {}; }
  MemoryStore.prototype.get = function (key) { return Promise.resolve(this.data[key] || null); };
  MemoryStore.prototype.set = function (key, value) { this.data[key] = value; return Promise.resolve(true); };
  MemoryStore.prototype.removePrefix = function (prefix) {
    for (var k in this.data) if (k.indexOf(prefix) === 0) delete this.data[k];
    return Promise.resolve();
  };
  MemoryStore.prototype.clear = function () { this.data = {}; return Promise.resolve(); };

  // ---- IndexedDB implementation ------------------------------------------------------------------------------------
  function IdbStore(idb, name) {
    this.idb = idb;
    this.name = name;
    this.dbp = null;
  }

  IdbStore.prototype.open = function () {
    var self = this;
    if (!this.dbp) {
      this.dbp = new Promise(function (resolve) {
        try {
          var req = self.idb.open(self.name, 1);
          req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { resolve(null); };
          req.onblocked = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }
    return this.dbp;
  };

  /** Runs fn(objectStore) in a transaction; resolves with the request result (or null on any failure). */
  IdbStore.prototype.run = function (mode, fn) {
    return this.open().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, mode), out = null;
          var req = fn(tx.objectStore(STORE));
          if (req) req.onsuccess = function () { out = req.result; };
          tx.oncomplete = function () { resolve(out); };
          tx.onerror = tx.onabort = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  };

  IdbStore.prototype.get = function (key) {
    return this.run('readonly', function (os) { return os.get(key); }).then(function (v) { return v || null; });
  };

  IdbStore.prototype.set = function (key, value) {
    return this.run('readwrite', function (os) { return os.put(value, key); }).then(function (v) { return v != null; });
  };

  IdbStore.prototype.removePrefix = function (prefix) {
    return this.run('readwrite', function (os) { return os.delete(IDBKeyRange.bound(prefix, prefix + '\uffff')); });
  };

  IdbStore.prototype.clear = function () {
    return this.run('readwrite', function (os) { return os.clear(); });
  };

  /** Real IndexedDB when given a factory, otherwise memory. */
  function create(idbFactory, name) {
    return idbFactory ? new IdbStore(idbFactory, name || 'iptv-library') : new MemoryStore();
  }

  return { create: create, MemoryStore: MemoryStore, IdbStore: IdbStore, isStale: isStale, age: age };
});
