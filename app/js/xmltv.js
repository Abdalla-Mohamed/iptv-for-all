/* XMLTV program guide: tolerant regex parser (a DOM parse of a 50 MB guide would freeze a TV), time-sliced so the UI
 * stays responsive, keeping only a window around "now" to bound memory. Works in the browser and in Node.
 *
 * Result: { programmes: { channelId: [[startMs, endMs, title, description], ...] sorted }, names: { normalizedName: channelId } }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.IPTV = root.IPTV || {}).XmlTv = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HOUR = 3600 * 1000;
  var PAST = 2 * HOUR, FUTURE = 48 * HOUR;       // programmes outside [now - 2 h, now + 48 h] are dropped
  var DESC_MAX = 260;

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function decode(s) {
    if (!s) return '';
    s = s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, e) {
      if (e.charAt(0) === '#') {
        var code = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code < 0x110000 ? String.fromCodePoint ? String.fromCodePoint(code) : String.fromCharCode(code) : m;
      }
      return ENTITIES[e] != null ? ENTITIES[e] : m;
    }).trim();
  }

  /** "20240131203000 +0100" / "20240131203000" (UTC) / "202401312030" -> epoch ms, or NaN */
  function parseTime(str) {
    var m = /^\s*(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])?(\d{2})?:?(\d{2})?/.exec(str || '');
    if (!m) return NaN;
    var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7] && m[8]) ms -= (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +(m[9] || 0)) * 60000;
    return ms;
  }

  function attr(tag, name) {
    var m = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')').exec(tag);
    return m ? decode(m[1] != null ? m[1] : m[2]) : '';
  }

  /** "BBC One HD" -> "bbconehd": same key for the playlist's channel name and the guide's display-name. */
  function normName(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\u00C0-\uFFFF]+/g, '');
  }

  /** Incremental parser: call step(budgetMs) until it returns true, then result(). */
  function Parser(text, now) {
    this.text = text;
    this.now = now == null ? Date.now() : now;
    this.pos = 0;
    this.programmes = {};
    this.names = {};
    this.count = 0;
  }

  Parser.prototype.step = function (budgetMs) {
    var t0 = Date.now(), text = this.text, now = this.now;
    var from = now - PAST, to = now + FUTURE;
    while (this.pos < text.length) {
      var open = text.indexOf('<', this.pos);
      if (open < 0) { this.pos = text.length; break; }
      var isProg = text.substr(open, 11) === '<programme ' || text.substr(open, 11) === '<programme\n';
      var isChan = !isProg && (text.substr(open, 9) === '<channel ' || text.substr(open, 9) === '<channel\n');
      if (!isProg && !isChan) { this.pos = open + 1; continue; }

      var tagEnd = text.indexOf('>', open);
      if (tagEnd < 0) { this.pos = text.length; break; }
      var tag = text.slice(open, tagEnd + 1);
      var closeName = isProg ? '</programme>' : '</channel>';
      var close = tag.charAt(tag.length - 2) === '/' ? tagEnd + 1 : text.indexOf(closeName, tagEnd);
      if (close < 0) { this.pos = text.length; break; }
      var inner = text.slice(tagEnd + 1, close);
      this.pos = close + (tag.charAt(tag.length - 2) === '/' ? 0 : closeName.length);

      if (isChan) {
        var id = attr(tag, 'id');
        var re = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g, dn;
        while (id && (dn = re.exec(inner))) {
          var key = normName(decode(dn[1]));
          if (key && !this.names[key]) this.names[key] = id;
        }
      } else {
        var s = parseTime(attr(tag, 'start')), e = parseTime(attr(tag, 'stop'));
        var ch = attr(tag, 'channel');
        if (!ch || isNaN(s)) continue;
        if (isNaN(e)) e = s + 30 * 60000;
        if (e <= from || s >= to) continue;
        var tm = /<title[^>]*>([\s\S]*?)<\/title>/.exec(inner);
        var dm = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(inner);
        (this.programmes[ch] = this.programmes[ch] || []).push([s, e, tm ? decode(tm[1]) : '', dm ? decode(dm[1]).slice(0, DESC_MAX) : '']);
        this.count++;
      }
      if (budgetMs && Date.now() - t0 > budgetMs) return false;
    }
    return true;
  };

  Parser.prototype.result = function () {
    for (var ch in this.programmes) this.programmes[ch].sort(function (a, b) { return a[0] - b[0]; });
    return { programmes: this.programmes, names: this.names };
  };

  /** Synchronous parse (tests, small files). */
  function parse(text, now) {
    var p = new Parser(text, now);
    p.step(0);
    return p.result();
  }

  /** Time-sliced parse for the TV: yields to the UI between slices. Resolves with the result. */
  function parseAsync(text, now, sliceMs) {
    return new Promise(function (resolve) {
      var p = new Parser(text, now);
      (function slice() {
        if (p.step(sliceMs || 25)) resolve(p.result());
        else setTimeout(slice, 0);
      })();
    });
  }

  /** The guide's channel id for a playlist item: tvg-id if it exists in the guide, else a display-name match. */
  function channelFor(guide, item) {
    if (item.epgId && guide.programmes[item.epgId]) return item.epgId;
    var byName = guide.names[normName(item.name)];
    if (byName && guide.programmes[byName]) return byName;
    if (item.epgId && guide.names[normName(item.epgId)]) return guide.names[normName(item.epgId)];
    return '';
  }

  /** Current + upcoming programmes for an item: [{title, desc, start, end}], the current one first when airing. */
  function lookup(guide, item, now, limit) {
    var list = guide.programmes[channelFor(guide, item)] || [], out = [];
    now = now == null ? Date.now() : now;
    for (var i = 0; i < list.length && out.length < (limit || 4); i++) {
      if (list[i][1] > now) out.push({ start: list[i][0], end: list[i][1], title: list[i][2], desc: list[i][3] });
    }
    return out;
  }

  return { parse: parse, parseAsync: parseAsync, parseTime: parseTime, normName: normName, channelFor: channelFor, lookup: lookup, Parser: Parser };
});
