/* "Continue watching": turns the saved resume points into list items for the Movies / Series tabs.
 * Works in the browser and in Node (for tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.IPTV = root.IPTV || {}).Continue = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMIT = 60;

  function copy(o) {
    var out = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
    return out;
  }

  function fraction(e) {
    return e.duration > 0 ? Math.max(0, Math.min(1, e.seconds / e.duration)) : 0;
  }

  /** Metadata remembered with a resume point so the entry can be shown even if the catalog changed. */
  function metaFor(item, series) {
    var m = { kind: item.kind, id: item.id, name: item.name, logo: item.logo || '', ext: item.ext || '', cat: item.cat || '' };
    if (item.url) m.url = item.url;
    if (series) m.series = { id: series.id, name: series.name, logo: series.logo || '' };
    return m;
  }

  /**
   * entries: [{key, seconds, at, duration, meta}] newest first; kind: 'vod' | 'series'; keyMap: key -> catalog item.
   * vod    -> the movie itself (catalog item when still listed), with .progress 0..1
   * series -> the latest unfinished episode of each series, as an 'episode' item pointing at its series
   */
  function items(entries, kind, keyMap) {
    var out = [], seen = {};
    for (var i = 0; i < entries.length && out.length < LIMIT; i++) {
      var e = entries[i], m = e.meta;
      if (!m) continue;
      var it;
      if (kind === 'vod') {
        if (m.kind !== 'vod') continue;
        it = copy((keyMap && keyMap[e.key]) || { id: m.id, key: e.key, kind: 'vod', name: m.name, logo: m.logo, cat: m.cat, ext: m.ext, url: m.url });
      } else {
        if (m.kind !== 'episode' || !m.series || seen[m.series.id]) continue;
        seen[m.series.id] = true;
        it = { id: m.id, key: e.key, kind: 'episode', name: m.series.name + '  ·  ' + m.name, logo: m.series.logo || m.logo,
               ext: m.ext, series: m.series };
      }
      it.progress = fraction(e);
      it.resumeAt = e.seconds;
      out.push(it);
    }
    return out;
  }

  return { items: items, metaFor: metaFor, fraction: fraction };
});
