/* M3U / M3U8 playlist parser. Works in the browser and in Node (for tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.IPTV = root.IPTV || {}).M3U = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hash(str) {
    var x = 5381;
    for (var i = 0; i < str.length; i++) x = ((x << 5) + x + str.charCodeAt(i)) | 0;
    return (x >>> 0).toString(36);
  }

  function parseAttrs(s) {
    var out = {}, re = /([A-Za-z0-9_-]+)="([^"]*)"/g, m;
    while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2];
    return out;
  }

  /** "#EXTINF:-1 tvg-id="a" group-title="x, y",Name" -> {attrs, name} (comma inside quotes is ignored) */
  function parseInfo(line) {
    var inQuote = false, comma = -1;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') inQuote = !inQuote;
      else if (c === ',' && !inQuote) { comma = i; break; }
    }
    return {
      attrs: parseAttrs(comma < 0 ? line : line.slice(0, comma)),
      name: comma < 0 ? '' : line.slice(comma + 1).trim()
    };
  }

  /** Strip Kodi-style "url|User-Agent=x" suffixes; browsers cannot send those headers anyway. */
  function cleanUrl(line) {
    var i = line.indexOf('|');
    if (i > 0 && /^[\w-]+=/.test(line.slice(i + 1))) return line.slice(0, i);
    return line;
  }

  function nameFromUrl(url) {
    var path = url.split('?')[0].replace(/\/+$/, '');
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1) || url);
  }

  /** @returns {{items: Array, epgUrl: string}} raw entries in file order */
  function parse(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var lines = text.split(/\r?\n/);
    var items = [], cur = null, epgUrl = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('#EXTM3U') === 0) {
        var head = parseAttrs(line);
        epgUrl = head['x-tvg-url'] || head['url-tvg'] || '';
      } else if (line.indexOf('#EXTINF:') === 0) {
        cur = parseInfo(line.slice(8));
      } else if (line.indexOf('#EXTGRP:') === 0) {
        if (cur && !cur.group) cur.group = line.slice(8).trim();
      } else if (line.charAt(0) === '#') {
        continue; // #EXTVLCOPT, #KODIPROP, comments ...
      } else {
        var url = cleanUrl(line);
        var a = cur ? cur.attrs : {};
        items.push({
          name: (cur && cur.name) || a['tvg-name'] || nameFromUrl(url),
          url: url,
          logo: a['tvg-logo'] || '',
          group: (cur && cur.group) || a['group-title'] || '',
          tvgId: a['tvg-id'] || '',
          chno: a['tvg-chno'] ? parseInt(a['tvg-chno'], 10) || 0 : 0
        });
        cur = null;
      }
    }
    return { items: items, epgUrl: epgUrl };
  }

  /** Xtream-style URL layout is the only reliable signal for movies/series in plain M3U. */
  function kindOf(url) {
    if (/\/series\//i.test(url)) return 'series';
    if (/\/movie\//i.test(url) || /\.(mp4|mkv|avi|mov)(\?|$)/i.test(url)) return 'vod';
    return 'live';
  }

  /** Group parsed entries into {live, vod, series}: each {cats, items, byCat}. */
  function buildLibrary(entries) {
    var lib = {};
    ['live', 'vod', 'series'].forEach(function (k) { lib[k] = { cats: [], items: [], byCat: {}, _seen: {} }; });
    entries.forEach(function (e) {
      var kind = kindOf(e.url), sec = lib[kind];
      var cat = e.group || 'Uncategorized';
      if (!sec._seen[cat]) {
        sec._seen[cat] = { id: cat, name: cat, count: 0 };
        sec.cats.push(sec._seen[cat]);
      }
      sec._seen[cat].count++;
      var id = hash(e.url);
      sec.items.push({
        id: id, key: 'm:' + id, kind: kind, name: e.name, logo: e.logo, cat: cat,
        url: e.url, epgId: e.tvgId, num: e.chno || sec.items.length + 1
      });
    });
    ['live', 'vod', 'series'].forEach(function (k) {
      delete lib[k]._seen;
      lib[k].items.forEach(function (it) {
        (lib[k].byCat[it.cat] = lib[k].byCat[it.cat] || []).push(it);
      });
    });
    return lib;
  }

  return { parse: parse, buildLibrary: buildLibrary, kindOf: kindOf, hash: hash };
});
