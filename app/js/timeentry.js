/* "Jump to time" entry for remote controls. Digits fill in from the right, like a microwave timer:
 *   1 3 0      -> 00:01:30        1 0 0 0 0 -> 01:00:00      9 0 -> 00:01:30 (90 s; fields may overflow)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.IPTV = root.IPTV || {}).TimeEntry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_DIGITS = 6;

  function pad(digits) {
    digits = String(digits).slice(-MAX_DIGITS);
    return '000000'.slice(digits.length) + digits;
  }

  /** "130" -> 90 */
  function toSeconds(digits) {
    var p = pad(digits);
    return parseInt(p.slice(0, 2), 10) * 3600 + parseInt(p.slice(2, 4), 10) * 60 + parseInt(p.slice(4, 6), 10);
  }

  /** "130" -> "00:01:30" */
  function format(digits) {
    var p = pad(digits);
    return p.slice(0, 2) + ':' + p.slice(2, 4) + ':' + p.slice(4, 6);
  }

  /** Append a digit; leading zeros and anything beyond HHMMSS are dropped. */
  function push(digits, d) {
    return (String(digits) + d).replace(/^0+/, '').slice(-MAX_DIGITS);
  }

  function pop(digits) { return String(digits).slice(0, -1); }

  return { toSeconds: toSeconds, format: format, push: push, pop: pop, MAX_DIGITS: MAX_DIGITS };
});
