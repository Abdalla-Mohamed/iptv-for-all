/* Home: saved playlists + "Add playlist". */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  IPTV.Screens = IPTV.Screens || {};
  var h = IPTV.h, Store = IPTV.Store;

  function hostOf(url) {
    var m = /^[a-z]+:\/\/([^\/?#]+)/i.exec(url || '');
    return m ? m[1] : (url || '');
  }

  IPTV.hints = function (parts) {
    return h('div', { className: 'hintbar' }, parts.map(function (t) { return h('span', { text: t }); }));
  };

  IPTV.Screens.Playlists = function () {
    var grid = new IPTV.VirtualGrid({
      cols: 1, rowH: 120, className: 'pl-grid',
      render: function (it) {
        if (it.add) return h('div', { className: 'pl-row pl-add' }, [h('span', { className: 'pl-plus', text: '+' }), h('span', { text: 'Add playlist' })]);
        return h('div', { className: 'pl-row' }, [
          h('div', { className: 'pl-badge', text: it.type === 'xtream' ? 'XTREAM' : 'M3U' }),
          h('div', { className: 'pl-info' }, [
            h('div', { className: 'pl-name', text: it.name }),
            h('div', { className: 'pl-host', text: it.type === 'xtream' ? hostOf(it.server) + '  ·  ' + it.username : hostOf(it.url) })
          ])
        ]);
      },
      onSelect: function (it) {
        if (it.add) { IPTV.Router.push(IPTV.Screens.PlaylistForm(), {}); return; }
        open(it);
      }
    });
    grid.setActive(true);

    var el = h('div', { className: 'screen' }, [
      h('div', { className: 'brand-bar' }, [h('div', { className: 'brand', text: 'IPTV For All' }), h('div', { className: 'brand-sub', text: 'Choose a playlist' })]),
      h('div', { className: 'pl-wrap' }, grid.el),
      h('div', { className: 'hintbar' }, [
        h('span', { text: 'OK Open' }), h('span', { text: 'Red Delete' }), h('span', { text: 'Yellow Edit' }), h('span', { text: 'Blue Settings' })
      ])
    ]);

    function open(pl) {
      Store.setActiveId(pl.id);
      IPTV.Router.push(IPTV.Screens.Main(), { playlist: pl });
    }

    function load(keepIndex) {
      grid.setItems(Store.playlists().concat([{ add: true }]), keepIndex);
    }

    return {
      el: el,
      onShow: function () { load(0); },
      onResume: function () { load(grid.index); },
      onKey: function (a) {
        var it = grid.current();
        if (a === 'red' && it && !it.add) {
          IPTV.W.confirm('Delete playlist?', '"' + it.name + '" and its favorites will be removed from this TV.', 'Delete').then(function (yes) {
            if (yes) { Store.removePlaylist(it.id); IPTV.library.removePrefix('pl:' + it.id + ':'); load(grid.index); }
          });
          return true;
        }
        if (a === 'yellow' && it && !it.add) { IPTV.Router.push(IPTV.Screens.PlaylistForm(), { playlist: it }); return true; }
        if (a === 'blue') { IPTV.Router.push(IPTV.Screens.Settings(), {}); return true; }
        return grid.handleKey(a);
      }
    };
  };
})(window);
