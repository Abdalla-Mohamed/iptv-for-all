/* PIN flows on top of parental.js: ask for the PIN (3 tries), create a new one (twice). All resolve true/false. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};

  IPTV.parental = IPTV.Parental.create(IPTV.Store);

  var MAX_TRIES = 3;

  /** Ask for the current PIN. Unlocks nothing by itself: the caller decides what the PIN is for. */
  function verify(title) {
    function attempt(left, note) {
      return IPTV.W.pinPad(title, note).then(function (pin) {
        if (pin == null) return false;
        if (IPTV.parental.checkPin(pin)) return true;
        if (left <= 1) { IPTV.toast('Wrong PIN'); return false; }
        return attempt(left - 1, 'Wrong PIN. ' + (left - 1) + (left - 1 === 1 ? ' try left' : ' tries left'));
      });
    }
    return attempt(MAX_TRIES);
  }

  /** Choose a new PIN (entered twice). Saves it and resolves true. */
  function create(title) {
    function ask(note) {
      return IPTV.W.pinPad(title || 'Choose a 4-digit PIN', note).then(function (first) {
        if (first == null) return false;
        return IPTV.W.pinPad('Repeat the PIN').then(function (second) {
          if (second == null) return false;
          if (first !== second) return ask('The two PINs were different. Try again');
          IPTV.parental.setPin(first);
          IPTV.toast('PIN saved');
          return true;
        });
      });
    }
    return ask();
  }

  IPTV.PinFlow = { verify: verify, create: create };
})(window);
