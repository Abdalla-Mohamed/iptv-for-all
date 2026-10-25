/* Series detail: seasons + episodes. params: { item, provider, playlist } */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  IPTV.Screens = IPTV.Screens || {};
  var h = IPTV.h, Store = IPTV.Store;

  IPTV.Screens.Series = function () {
    var p = {}, info = null, zoneIdx = 1;

    var cover = h('img', { className: 's-cover' });
    var title = h('div', { className: 's-title' });
    var meta = h('div', { className: 's-meta' });
    var plot = h('div', { className: 's-plot' });

    var seasons = new IPTV.VirtualGrid({
      cols: 1, rowH: 68, className: 's-seasons',
      render: function (s) { return h('div', { className: 'cat-row' }, [h('span', { className: 'cat-name', text: s.name }), h('span', { className: 'cat-count', text: s.episodes.length })]); },
      onSelect: function () { activate(1); },
      onPointer: function () { activate(0); },
      onFocus: function (s) { if (s) showEpisodes(s); }
    });
    var episodes = new IPTV.VirtualGrid({
      cols: 1, rowH: 92, className: 's-episodes',
      render: function (e) {
        var pos = Store.getProgress(p.playlist.id, e.key);
        return h('div', { className: 'ep-row' }, [
          h('span', { className: 'ep-num', text: e.num }),
          h('div', { className: 'ep-info' }, [
            h('div', { className: 'ep-name', text: e.name }),
            h('div', { className: 'ep-sub', text: [e.duration >= 60 ? Math.round(e.duration / 60) + ' min' : '', pos > 30 ? 'resume at ' + IPTV.fmtDuration(pos) : ''].filter(Boolean).join('   ·   ') })
          ])
        ]);
      },
      onSelect: function (e, i) {
        IPTV.Router.push(IPTV.Screens.Player(), { list: episodes.items, index: i, provider: p.provider, playlist: p.playlist, kind: 'episode' });
      },
      onPointer: function () { activate(1); }
    });

    var zones = [seasons, episodes];
    function activate(i) {
      zoneIdx = i;
      zones.forEach(function (z, n) { z.setActive(n === i); });
    }

    function showEpisodes(season) {
      episodes.setItems(season.episodes, 0);
      episodes.setMessage(season.episodes.length ? '' : 'No episodes');
    }

    var el = h('div', { className: 'screen' }, [
      h('div', { className: 's-layout' }, [
        h('div', { className: 's-side' }, [cover, title, meta, plot]),
        h('div', { className: 's-col s-col-seasons' }, seasons.el),
        h('div', { className: 's-col s-col-eps' }, episodes.el)
      ]),
      IPTV.hints(['OK Play', '◀▶ Seasons / Episodes', 'BACK Return'])
    ]);

    return {
      el: el,
      onShow: function (params) {
        p = params;
        title.textContent = p.item.name;
        if (p.item.logo) cover.src = p.item.logo;
        plot.textContent = p.item.plot || '';
        seasons.setMessage('Loading...');
        activate(0);
        p.provider.seriesInfo(p.item).then(function (i) {
          info = i;
          if (i.cover) cover.src = i.cover;
          title.textContent = i.title;
          plot.textContent = i.plot;
          meta.textContent = [i.genre, i.rating ? '★ ' + i.rating : ''].filter(Boolean).join('   ·   ');
          seasons.setMessage(i.seasons.length ? '' : 'No episodes found');
          seasons.setItems(i.seasons, 0);
          activate(i.seasons.length ? 1 : 0);
        }).catch(function (e) { seasons.setMessage(e.message); });
      },
      onResume: function () { episodes.refresh(); },
      onKey: function (a) {
        if (zones[zoneIdx].handleKey(a)) return true;
        if (a === 'right' && zoneIdx === 0 && episodes.items.length) { activate(1); return true; }
        if (a === 'left' && zoneIdx === 1) { activate(0); return true; }
        return false;
      }
    };
  };
})(window);
