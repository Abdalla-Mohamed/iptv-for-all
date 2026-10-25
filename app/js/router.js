/* Screen stack + key dispatch. Screens below the top one stay alive (and keep focus/scroll) but are hidden. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};

  var Router = {
    stack: [],
    modal: null,

    top: function () { return Router.stack[Router.stack.length - 1]; },

    push: function (screen, params) {
      var app = document.getElementById('app'), prev = Router.top();
      if (prev) {
        prev.el.classList.add('hidden');
        if (prev.onHide) prev.onHide();
      }
      app.appendChild(screen.el);
      Router.stack.push(screen);
      if (screen.onShow) screen.onShow(params);
    },

    pop: function () {
      if (Router.stack.length <= 1) return Router.exit();
      var gone = Router.stack.pop();
      if (gone.onClose) gone.onClose();
      gone.el.parentNode.removeChild(gone.el);
      var now = Router.top();
      now.el.classList.remove('hidden');
      if (now.onResume) now.onResume();
    },

    /** Drop everything above the first screen (used after deleting the active playlist etc.). */
    popToRoot: function () {
      while (Router.stack.length > 1) Router.pop();
    },

    dispatch: function (action, ev) {
      if (Router.modal) { Router.modal.onKey(action, ev); return; }
      var s = Router.top();
      if (!s) return;
      var handled = s.onKey ? s.onKey(action, ev) : false;
      if (!handled && action === 'back') Router.pop();
    },

    exit: function () {
      if (root.PalmSystem && root.PalmSystem.platformBack) root.PalmSystem.platformBack();
      else if (root.webOS && root.webOS.platformBack) root.webOS.platformBack();
      else root.close();
    }
  };

  IPTV.Router = Router;
})(window);
