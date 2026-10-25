/* Boot: scale the 1920x1080 stage, wire keys, open the last playlist. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV;

  // The TV renders at exactly 1920x1080; in a desktop browser we scale the stage to fit.
  function fit() {
    var app = document.getElementById('app');
    var s = Math.min(root.innerWidth / 1920, root.innerHeight / 1080);
    if (Math.abs(s - 1) < 0.001) { app.style.transform = ''; app.style.left = app.style.top = '0'; return; }
    app.style.transform = 'scale(' + s + ')';
    app.style.left = (root.innerWidth - 1920 * s) / 2 + 'px';
    app.style.top = (root.innerHeight - 1080 * s) / 2 + 'px';
  }

  function boot() {
    fit();
    root.addEventListener('resize', fit);
    IPTV.Engine.init();
    IPTV.Keys.init(IPTV.Router.dispatch);

    IPTV.Router.push(IPTV.Screens.Playlists(), {});
    var all = IPTV.Store.playlists();
    if (!all.length) {
      IPTV.Router.push(IPTV.Screens.PlaylistForm(), {});
      return;
    }
    var last = IPTV.Store.getPlaylist(IPTV.Store.activeId());
    if (last) IPTV.Router.push(IPTV.Screens.Main(), { playlist: last });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
