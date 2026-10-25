/* Remote-control key mapping. LG webOS key codes plus desktop fallbacks for development. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};

  var MAP = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
    461: 'back', 27: 'back', 8: 'back',
    403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
    112: 'red', 113: 'green', 114: 'yellow', 115: 'blue',            // F1-F4
    415: 'play', 19: 'pause', 179: 'playpause', 10252: 'playpause',
    413: 'stop', 412: 'rw', 417: 'ff',
    427: 'chup', 428: 'chdown', 33: 'chup', 34: 'chdown',
    457: 'info', 460: 'subtitle'
  };

  function action(code) {
    if (MAP[code]) return MAP[code];
    if (code >= 48 && code <= 57) return 'num' + (code - 48);
    if (code >= 96 && code <= 105) return 'num' + (code - 96);
    return null;
  }

  function isTextField(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  var Keys = {
    init: function (handler) {
      document.addEventListener('keydown', function (e) {
        var a = action(e.keyCode);
        if (isTextField(e.target)) {
          // While typing: Enter/Back close the keyboard, Up/Down leave the field, the rest types.
          if (a === 'enter' || a === 'back') { e.target.blur(); e.preventDefault(); return; }
          if (a === 'up' || a === 'down') e.target.blur();
          else return;
        }
        if (!a) return;
        e.preventDefault();
        handler(a, e);
      }, true);
    },
    /** Start editing a text input (raises the on-screen keyboard on a TV). */
    edit: function (input) {
      input.focus();
      try { var n = input.value.length; input.setSelectionRange(n, n); } catch (e) { /* type=password etc. */ }
    },
    isEditing: function () { return isTextField(document.activeElement); }
  };

  IPTV.Keys = Keys;
})(window);
