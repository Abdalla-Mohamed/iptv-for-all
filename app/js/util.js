/* Small DOM + formatting helpers. ES2015 only: webOS 4 ships Chromium 53. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};

  function append(el, kids) {
    if (kids == null || kids === false) return;
    if (!Array.isArray(kids)) kids = [kids];
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) append(el, c);
      else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
  }

  /** h('div', {className: 'x', text: 'hi', onclick: fn}, [children]) */
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (v == null || v === false) continue;
        if (k === 'className') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') { for (var s in v) el.style[s] = v[s]; }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
    }
    append(el, kids);
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function debounce(fn, ms) {
    var t = null;
    var d = function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
    d.cancel = function () { clearTimeout(t); };
    return d;
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /** 3725 -> "1:02:05", 65 -> "1:05" */
  function fmtDuration(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
    return hh > 0 ? hh + ':' + pad2(mm) + ':' + pad2(ss) : mm + ':' + pad2(ss);
  }

  function fmtClock(ms) {
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** djb2 -> base36. Short, stable ids for favorites/progress keys. */
  function hash(str) {
    var x = 5381;
    for (var i = 0; i < str.length; i++) x = ((x << 5) + x + str.charCodeAt(i)) | 0;
    return (x >>> 0).toString(36);
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, ms || 2500);
  }

  IPTV.h = h;
  IPTV.clear = clear;
  IPTV.debounce = debounce;
  IPTV.clamp = clamp;
  IPTV.fmtDuration = fmtDuration;
  IPTV.fmtClock = fmtClock;
  IPTV.hash = hash;
  IPTV.toast = toast;
})(window);
