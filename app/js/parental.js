/* Parental lock logic: PIN, manually locked categories, automatic "adult" categories, timed unlock.
 * This keeps children out of the way; it is not a security feature (the PIN hash is kept in local storage).
 * Works in the browser and in Node. `io` is { get(key, default), set(key, value) } (the app passes Store).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.IPTV = root.IPTV || {}).Parental = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'parental';
  var UNLOCK_MINUTES = 30;
  var ADULT = /(^|[^a-z0-9])(xxx|adults?|porn\w*|erotic\w*|nsfw|hentai|18\s*\+|\+\s*18)([^a-z0-9]|$)/i;

  function hashPin(pin) {
    var s = 'iptv-for-all:pin:' + pin, x = 5381;
    for (var i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
    return (x >>> 0).toString(36);
  }

  function isAdultName(name) { return ADULT.test(String(name || '')); }
  function validPin(pin) { return /^\d{4}$/.test(String(pin)); }

  function create(io, clock) {
    var now = clock || function () { return Date.now(); };
    var unlockedUntil = 0;

    function data() {
      var d = io.get(KEY, null) || {};
      if (!d.locked) d.locked = {};
      if (d.adult == null) d.adult = true;
      return d;
    }
    function save(d) { io.set(KEY, d); }

    var api = {
      hasPin: function () { return !!data().pin; },

      setPin: function (pin) {
        if (!validPin(pin)) throw new Error('PIN must be 4 digits');
        var d = data();
        d.pin = hashPin(pin);
        save(d);
      },

      checkPin: function (pin) {
        var d = data();
        return !!d.pin && d.pin === hashPin(pin);
      },

      /** Removing the PIN removes every lock (nothing could unlock them anymore). */
      clearPin: function () { save({ adult: data().adult, locked: {} }); unlockedUntil = 0; },

      adultLock: function () { return data().adult; },
      setAdultLock: function (on) { var d = data(); d.adult = !!on; save(d); },

      manuallyLocked: function (pid, kind, catId) {
        var l = data().locked;
        return !!(l[pid] && l[pid][kind] && l[pid][kind][catId]);
      },

      /** A category is locked when a PIN exists and it is locked by hand, or its name looks adult (and that is enabled). */
      isLocked: function (pid, kind, cat) {
        var d = data();
        if (!d.pin) return false;
        return api.manuallyLocked(pid, kind, cat.id) || (d.adult && isAdultName(cat.name));
      },

      /** Locked by name only (cannot be unlocked by hand: turn the setting off instead). */
      lockedByName: function (cat) { var d = data(); return !!d.pin && d.adult && isAdultName(cat.name); },

      /** Returns true if the category is now locked by hand. */
      toggleLock: function (pid, kind, catId) {
        var d = data();
        d.locked[pid] = d.locked[pid] || {};
        d.locked[pid][kind] = d.locked[pid][kind] || {};
        var on = !d.locked[pid][kind][catId];
        if (on) d.locked[pid][kind][catId] = 1; else delete d.locked[pid][kind][catId];
        save(d);
        return on;
      },

      /** {catId: true} for every locked category of a section. */
      lockedIds: function (pid, kind, cats) {
        var out = {};
        for (var i = 0; i < cats.length; i++) if (api.isLocked(pid, kind, cats[i])) out[cats[i].id] = true;
        return out;
      },

      unlock: function () { unlockedUntil = now() + UNLOCK_MINUTES * 60000; },
      lock: function () { unlockedUntil = 0; },
      isUnlocked: function () { return now() < unlockedUntil; },

      /** Items of locked categories are hidden until unlocked. */
      visible: function (items, lockedMap) {
        if (api.isUnlocked() || !Object.keys(lockedMap).length) return items;
        return items.filter(function (it) { return !lockedMap[it.cat]; });
      }
    };
    return api;
  }

  return { create: create, isAdultName: isAdultName, validPin: validPin, UNLOCK_MINUTES: UNLOCK_MINUTES };
});
