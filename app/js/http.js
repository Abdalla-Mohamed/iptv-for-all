/* XHR wrapper with timeouts, readable errors and an optional CORS proxy. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};

  function httpError(status) {
    var msg;
    if (status === 401 || status === 403) msg = 'Access denied (' + status + '). Check username / password.';
    else if (status === 404) msg = 'Not found (404). Check the address.';
    else if (status >= 500) msg = 'Server error (' + status + ').';
    else msg = 'Request failed (' + status + ').';
    var e = new Error(msg);
    e.status = status;
    return e;
  }

  function proxify(url) {
    var proxy = (IPTV.Store.settings().corsProxy || '').trim();
    return proxy ? proxy + encodeURIComponent(url) : url;
  }

  function getText(url, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      try { xhr.open('GET', proxify(url), true); } catch (e) { reject(new Error('Invalid address.')); return; }
      xhr.timeout = opts.timeout || 30000;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
        else reject(httpError(xhr.status));
      };
      xhr.onerror = function () {
        var e = new Error('Cannot reach the server. It may be offline, the address is wrong, or the request was blocked (CORS). See Settings > CORS proxy.');
        e.status = 0;
        reject(e);
      };
      xhr.ontimeout = function () {
        var e = new Error('The server took too long to respond.');
        e.status = 0;
        reject(e);
      };
      xhr.send();
    });
  }

  function getJSON(url, opts) {
    return getText(url, opts).then(function (text) {
      try { return JSON.parse(text); }
      catch (e) { throw new Error('The server returned an unexpected response (not JSON).'); }
    });
  }

  IPTV.Http = { getText: getText, getJSON: getJSON };
})(window);
