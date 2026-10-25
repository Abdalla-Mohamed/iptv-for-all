/* Movie detail page (Xtream providers). params: { item, provider, playlist }
 * Buttons: Play / Resume from m:ss, Start over (when there is a resume point), Favorite. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  IPTV.Screens = IPTV.Screens || {};
  var h = IPTV.h, W = IPTV.W, Store = IPTV.Store;

  IPTV.Screens.Movie = function () {
    var p = {}, item = null, zone = null;

    var bg = h('img', { className: 'm-bg' });
    var cover = h('img', { className: 'm-cover' });
    var title = h('div', { className: 'm-title' });
    var meta = h('div', { className: 'm-meta' });
    var plot = h('div', { className: 'm-plot' });
    var facts = h('div', { className: 'm-facts' });
    var buttons = h('div', { className: 'm-btns' });

    var el = h('div', { className: 'screen movie' }, [
      bg,
      h('div', { className: 'm-shade' }),
      h('div', { className: 'm-layout' }, [
        h('div', { className: 'm-left' }, cover),
        h('div', { className: 'm-right' }, [title, meta, plot, facts, buttons])
      ]),
      IPTV.hints(['◀▶ Choose', 'OK Select', 'BACK Return'])
    ]);

    function fact(label, value) {
      return value ? h('div', { className: 'm-fact' }, [h('span', { className: 'm-fl', text: label }), h('span', { text: value })]) : null;
    }

    function play(fromStart) {
      if (fromStart) Store.setProgress(p.playlist.id, item.key, 0);
      IPTV.Router.push(IPTV.Screens.Player(), { list: [item], index: 0, provider: p.provider, playlist: p.playlist, kind: 'vod' });
    }

    function buildButtons() {
      var pos = Store.getProgress(p.playlist.id, item.key), isFav = Store.isFav(p.playlist.id, item.key);
      var items = [W.button(pos > 30 ? '▶  Resume from ' + IPTV.fmtDuration(pos) : '▶  Play', function () { play(false); }, 'primary')];
      if (pos > 30) items.push(W.button('↺  Start over', function () { play(true); }));
      var fav = W.button(isFav ? '★  In favorites' : '☆  Add to favorites', function () {
        var on = Store.toggleFav(p.playlist.id, item.key);
        fav.el.textContent = on ? '★  In favorites' : '☆  Add to favorites';
        IPTV.toast(on ? 'Added to favorites' : 'Removed from favorites');
      });
      items.push(fav);
      var keep = zone ? zone.index : 0;
      IPTV.clear(buttons);
      items.forEach(function (b) { buttons.appendChild(b.el); });
      zone = zone || new IPTV.ListZone({ dir: 'h' });
      zone.setItems(items);
      zone.setIndex(Math.min(keep, items.length - 1));
      zone.setActive(true);
    }

    function fill(info) {
      title.textContent = info.title;
      if (info.cover) cover.src = info.cover;
      if (info.backdrop) { bg.src = info.backdrop; bg.style.display = 'block'; }
      meta.textContent = [info.year, info.genre, info.duration ? Math.round(info.duration / 60) + ' min' : '', info.rating && Number(info.rating) > 0 ? '★ ' + Number(info.rating).toFixed(1) : '']
        .filter(Boolean).join('   ·   ');
      plot.textContent = info.plot || 'No description available.';
      IPTV.clear(facts);
      [fact('Cast', info.cast), fact('Director', info.director)].forEach(function (f) { if (f) facts.appendChild(f); });
      if (info.ext) item.ext = info.ext;       // the real container: decides the smart cache / native path
    }

    return {
      el: el,
      onShow: function (params) {
        p = params;
        item = {};                              // work on a copy: the catalog item is shared with the list
        for (var k in p.item) if (Object.prototype.hasOwnProperty.call(p.item, k)) item[k] = p.item[k];
        fill({ title: item.name, cover: item.logo, plot: 'Loading...', rating: item.rating, ext: '' });
        buildButtons();
        p.provider.vodInfo(item).then(fill).catch(function () { plot.textContent = 'No description available.'; });
      },
      onResume: function () { buildButtons(); },     // progress / favorite may have changed in the player
      onKey: function (a) {
        return zone.handleKey(a) || a === 'up' || a === 'down';
      }
    };
  };
})(window);
