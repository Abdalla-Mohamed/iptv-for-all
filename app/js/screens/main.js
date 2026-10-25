/* Main browser: Live / Movies / Series tabs, category column, content list or poster grid, search, favorites.
 * params: { playlist } */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  IPTV.Screens = IPTV.Screens || {};
  var h = IPTV.h, W = IPTV.W, Store = IPTV.Store;

  var TAB_LABEL = { live: 'Live TV', vod: 'Movies', series: 'Series' };
  var NOUN = { live: ['channel', 'channels'], vod: ['movie', 'movies'], series: ['series', 'series'] };
  function plural(n, kind) { return n + ' ' + NOUN[kind][n === 1 ? 0 : 1]; }
  var POSTER_COLS = 6;

  IPTV.Screens.Main = function () {
    var pl, provider;
    var kinds = [], kind = 'live', section = null, catId = '*', query = '';
    var filtered = [];
    var zoneName = 'content';      // header | cats | content
    var lastBodyZone = 'content';
    var epgToken = 0;

    // ---- header ----------------------------------------------------------
    var plName = h('div', { className: 'brand-sub' });
    var tabsWrap = h('div', { className: 'tabs' });
    var search = W.input('', '', { placeholder: 'Search', onChange: IPTV.debounce(function (v) { query = v.trim(); applyFilter(0); }, 220) });
    search.el.classList.add('search');
    var clock = h('div', { className: 'clock' });
    var header = new IPTV.ListZone({ dir: 'h', onPointer: function () { focusZone('header'); } });
    var count = h('div', { className: 'count' });

    // ---- body ------------------------------------------------------------
    var cats = new IPTV.VirtualGrid({
      cols: 1, rowH: 64, className: 'cats',
      render: function (c) {
        return h('div', { className: 'cat-row' + (c.id === catId && !query ? ' cur' : '') }, [
          h('span', { className: 'cat-name', text: c.name }),
          h('span', { className: 'cat-count', text: c.count })
        ]);
      },
      onSelect: function (c) { selectCat(c.id); },
      onPointer: function () { focusZone('cats'); }
    });

    var content = new IPTV.VirtualGrid({
      cols: 1, rowH: 84, className: 'content',
      render: renderItem,
      onSelect: openItem,
      onFocus: onItemFocus,
      onPointer: function () { focusZone('content'); }
    });

    var infoLogo = h('img', { className: 'in-logo' });
    var infoName = h('div', { className: 'in-name' });
    var infoCat = h('div', { className: 'in-cat' });
    var infoNow = h('div', { className: 'in-now' });
    var infoNowTime = h('div', { className: 'in-time' });
    var infoBar = h('div', { className: 'in-fill' });
    var infoDesc = h('div', { className: 'in-desc' });
    var infoNext = h('div', { className: 'in-next' });
    var info = h('div', { className: 'info' }, [
      infoLogo, infoName, infoCat, h('div', { className: 'in-sep' }),
      infoNow, infoNowTime, h('div', { className: 'in-bar' }, infoBar), infoDesc, infoNext
    ]);

    var body = h('div', { className: 'body' }, [
      h('div', { className: 'col col-cats' }, cats.el),
      h('div', { className: 'col col-content' }, [count, content.el]),
      info
    ]);

    var el = h('div', { className: 'screen main kind-live' }, [
      h('div', { className: 'topbar' }, [h('div', { className: 'brand', text: 'IPTV For All' }), plName, tabsWrap, search.el, clock]),
      body,
      IPTV.hints(['OK Play', 'Red Favorite', 'Green Playlists', 'Yellow Settings', 'Blue Reload'])
    ]);

    // ---- item rendering ------------------------------------------------------
    function poster(it) {
      var img = h('img', { src: it.logo || '', alt: '' });
      img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
      return img;
    }

    function renderItem(it) {
      var fav = Store.isFav(pl.id, it.key);
      if (it.kind === 'live') {
        return h('div', { className: 'row-live' }, [
          h('span', { className: 'rl-num', text: it.num }),
          h('div', { className: 'rl-logo' }, it.logo ? poster(it) : null),
          h('span', { className: 'rl-name', text: it.name }),
          fav ? h('span', { className: 'star', text: '★' }) : null
        ]);
      }
      return h('div', { className: 'poster' }, [
        h('div', { className: 'po-img' }, [h('span', { className: 'po-fallback', text: it.name }), it.logo ? poster(it) : null,
          fav ? h('span', { className: 'star', text: '★' }) : null,
          it.rating && Number(it.rating) > 0 ? h('span', { className: 'po-rating', text: '★ ' + Number(it.rating).toFixed(1) }) : null,
          it.progress > 0 ? h('div', { className: 'po-prog' }, h('i', { style: { width: Math.round(it.progress * 100) + '%' } })) : null]),
        h('div', { className: 'po-title', text: it.name })
      ]);
    }

    function layoutContent() {
      el.classList.remove('kind-live', 'kind-vod', 'kind-series');
      el.classList.add('kind-' + kind);
      if (kind === 'live') content.setLayout(1, 84);
      else {
        var w = content.el.clientWidth || 1200;
        content.setLayout(POSTER_COLS, Math.round(w / POSTER_COLS * 1.5) + 62);
      }
    }

    // ---- data flow -------------------------------------------------------------
    function buildTabs() {
      IPTV.clear(tabsWrap);
      var items = kinds.map(function (k) {
        var b = W.button(TAB_LABEL[k], function () { selectKind(k); }, 'tab' + (k === kind ? ' on' : ''));
        b.kind = k;
        return b;
      });
      items.forEach(function (b) { tabsWrap.appendChild(b.el); });
      items.push(search);
      header.setItems(items);
      header.setIndex(kinds.indexOf(kind));
    }

    function specialCats() {
      var favs = Store.favs(pl.id), nf = 0;
      for (var i = 0; i < section.items.length; i++) if (favs[section.items[i].key]) nf++;
      var list = [{ id: '*', name: 'All', count: section.items.length }, { id: '__fav', name: '★ Favorites', count: nf }];
      if (kind !== 'series') list.push({ id: '__recent', name: 'Recently watched', count: recentItems().length });
      var cont = continueItems().length;
      if (cont) list.unshift({ id: '__continue', name: '\u25B6 Continue watching', count: cont });
      return list;
    }

    function keyMap() {
      if (!section.keyMap) {
        var m = section.keyMap = {};
        for (var i = 0; i < section.items.length; i++) m[section.items[i].key] = section.items[i];
      }
      return section.keyMap;
    }

    function recentItems() {
      var map = keyMap();
      return Store.recents(pl.id, kind === 'live' ? 'live' : 'vod').map(function (k) { return map[k]; }).filter(Boolean);
    }

    /** Unfinished movies (Movies tab) / latest unfinished episode per series (Series tab). */
    function continueItems() {
      return kind === 'live' ? [] : IPTV.Continue.items(Store.progressEntries(pl.id), kind, keyMap());
    }

    function selectKind(k) {
      kind = k;
      query = ''; search.input.value = '';
      catId = '*';
      section = null;
      buildTabs();
      layoutContent();
      cats.setItems([]); content.setItems([]);
      count.textContent = '';
      cats.setMessage(''); content.setMessage('Loading ' + NOUN[k][1] + '...');
      var asked = k;
      provider.ensure(k).then(function (sec) {
        if (asked !== kind) return;
        section = sec;
        showAge();
        content.setMessage('');
        if (continueItems().length) catId = '__continue';     // most common thing to want on the Movies / Series tabs
        refreshCats(0);
        applyFilter(0);
        focusZone(sec.items.length ? 'content' : 'cats');
      }).catch(function (e) {
        if (asked !== kind) return;
        content.setMessage(e.message + '\n\nPress BLUE to retry.');
      });
    }

    function refreshCats(idx) {
      var list = specialCats().concat(section.cats);
      cats.setItems(list, idx != null ? idx : cats.index, idx == null);
    }

    function selectCat(id) {
      catId = id;
      query = ''; search.input.value = '';
      cats.refresh();
      applyFilter(0);
      focusZone('content');
    }

    function applyFilter(index, keepKey) {
      if (!section) return;
      var q = query.toLowerCase(), list;
      if (q) {
        list = section.items.filter(function (it) { return it.name.toLowerCase().indexOf(q) >= 0; });
      } else if (catId === '*') list = section.items;
      else if (catId === '__fav') {
        var favs = Store.favs(pl.id);
        list = section.items.filter(function (it) { return favs[it.key]; });
      } else if (catId === '__recent') list = recentItems();
      else if (catId === '__continue') list = continueItems();
      else list = section.byCat[catId] || [];
      filtered = list;
      if (keepKey) {            // a background refresh swapped the data: stay on the same item
        for (var k = 0; k < list.length; k++) if (list[k].key === keepKey) { index = k; break; }
      }
      var catName = 'All';
      cats.items.forEach(function (c) { if (c.id === catId) catName = c.name; });
      count.textContent = (q ? 'Search "' + query + '"' : catName) + '  ·  ' + plural(list.length, kind);
      content.setMessage(list.length ? '' : (q ? 'No matches' : catId === '__fav' ? 'No favorites yet. Press RED on an item to add it.' : 'Nothing here'));
      content.setItems(list, index || 0);
      if (!list.length) showInfo(null);
    }

    function openItem(it, i) {
      if (it.kind === 'episode') {
        IPTV.Router.push(IPTV.Screens.Series(), { item: it.series, provider: provider, playlist: pl, focusKey: it.key });
      } else if (it.kind === 'series') {
        IPTV.Router.push(IPTV.Screens.Series(), { item: it, provider: provider, playlist: pl });
      } else {
        IPTV.Router.push(IPTV.Screens.Player(), { list: filtered, index: i, provider: provider, playlist: pl, kind: it.kind });
      }
    }

    function showAge() {
      var at = provider.age(kind);
      plName.textContent = pl.name + (at ? '  \u00B7  ' + IPTV.LibraryCache.age(at) : '');
    }

    /** A background refresh finished: swap the data in place, keep category and selected item. */
    function onRefreshed(k, sec) {
      if (provider.type === 'm3u') {
        var now = provider.kinds();
        if (now.join() !== kinds.join()) { kinds = now; if (kinds.indexOf(kind) < 0) { selectKind(kinds[0]); return; } buildTabs(); }
      }
      if (k !== kind || !section) return;
      var cur = content.current();
      section = sec;
      showAge();
      refreshCats();
      applyFilter(content.index, cur && cur.key);
      IPTV.toast('Playlist updated');
    }

    // ---- live info panel ---------------------------------------------------------
    var loadInfo = IPTV.debounce(function (it) {
      var token = ++epgToken;
      if (!provider.hasEpg) { infoNow.textContent = ''; infoNowTime.textContent = 'No program guide for this playlist'; return; }
      provider.epg(it).then(function (list) {
        if (token !== epgToken) return;
        var now = Date.now(), cur = null, nxt = null;
        for (var i = 0; i < list.length; i++) {
          if (list[i].start <= now && list[i].end > now) { cur = list[i]; nxt = list[i + 1] || null; break; }
          if (list[i].start > now) { nxt = list[i]; break; }
        }
        infoNow.textContent = cur ? cur.title : 'No program information';
        infoNowTime.textContent = cur ? IPTV.fmtClock(cur.start) + ' – ' + IPTV.fmtClock(cur.end) : '';
        infoBar.style.width = cur ? IPTV.clamp((now - cur.start) / (cur.end - cur.start) * 100, 0, 100) + '%' : '0%';
        infoDesc.textContent = cur ? cur.desc : '';
        infoNext.textContent = nxt ? 'Next: ' + IPTV.fmtClock(nxt.start) + '  ' + nxt.title : '';
      });
    }, 300);

    function showInfo(it) {
      epgToken++;
      infoLogo.style.display = it && it.logo ? 'block' : 'none';
      if (it && it.logo) infoLogo.src = it.logo;
      infoName.textContent = it ? it.name : '';
      infoCat.textContent = it && section ? catName(it.cat) : '';
      infoNow.textContent = ''; infoNowTime.textContent = ''; infoDesc.textContent = ''; infoNext.textContent = '';
      infoBar.style.width = '0%';
    }

    function catName(id) {
      for (var i = 0; i < section.cats.length; i++) if (section.cats[i].id === id) return section.cats[i].name;
      return '';
    }

    function onItemFocus(it) {
      if (kind !== 'live') return;
      showInfo(it);
      if (it) loadInfo(it);
    }

    // ---- focus -----------------------------------------------------------------------
    var zoneMap = { header: header, cats: cats, content: content };
    function focusZone(name) {
      zoneName = name;
      if (name !== 'header') lastBodyZone = name;
      for (var k in zoneMap) zoneMap[k].setActive(k === name);
      el.classList.toggle('on-header', name === 'header');
    }

    function onKey(a) {
      if (a === 'green') { IPTV.Router.pop(); return true; }
      if (a === 'yellow') { IPTV.Router.push(IPTV.Screens.Settings(), {}); return true; }
      if (a === 'blue') { provider.reset(); IPTV.toast('Reloading playlist...'); loadAll(); return true; }

      if (a === 'red' && zoneName === 'content') {
        var it = content.current();
        if (!it) return true;
        var on = Store.toggleFav(pl.id, it.key);
        IPTV.toast(on ? 'Added to favorites' : 'Removed from favorites');
        if (catId === '__fav' && !query) { refreshCats(); applyFilter(content.index); }
        else { content.refresh(); refreshCats(); }
        return true;
      }

      var z = zoneMap[zoneName];
      if (z.handleKey(a)) return true;

      // moves between zones
      if (zoneName === 'header') {
        if (a === 'down') { if (section) focusZone(lastBodyZone === 'cats' || !filtered.length ? 'cats' : 'content'); return true; }
      } else if (zoneName === 'cats') {
        if (a === 'up') { focusZone('header'); return true; }
        if (a === 'right' && filtered.length) { focusZone('content'); return true; }
      } else {
        if (a === 'up') { focusZone('header'); return true; }
        if (a === 'left') { focusZone('cats'); return true; }
      }
      return a === 'left' || a === 'right' || a === 'up' || a === 'down';
    }

    function loadAll() {
      plName.textContent = pl.name;
      cats.setItems([]); content.setItems([]);
      content.setMessage('Loading playlist...');
      provider.prepare().then(function () {
        kinds = provider.kinds();
        if (!kinds.length) { content.setMessage('This playlist has no content.'); return; }
        if (kinds.indexOf(kind) < 0) kind = kinds[0];
        selectKind(kind);
      }).catch(function (e) {
        kinds = [];
        buildTabs();
        content.setMessage(e.message + '\n\nPress BLUE to retry, GREEN to switch playlist.');
      });
    }

    var clockTimer = null;
    function tick() { clock.textContent = IPTV.fmtClock(Date.now()); }

    return {
      el: el,
      onShow: function (params) {
        pl = params.playlist;
        provider = IPTV.createProvider(pl);
        provider.onNotice = function (msg) { IPTV.toast(msg, 5000); };
        provider.onRefresh = onRefreshed;
        kinds = ['live', 'vod', 'series'];
        kind = 'live';
        buildTabs();
        focusZone('content');
        tick();
        clockTimer = setInterval(tick, 30000);
        loadAll();
      },
      onResume: function () {
        tick();
        // favorites / recents may have changed in the player
        if (section) {
          refreshCats();
          if (!query && (catId === '__fav' || catId === '__recent' || catId === '__continue')) applyFilter(content.index);
          else content.refresh();
        }
      },
      onClose: function () { clearInterval(clockTimer); },
      onKey: onKey
    };
  };
})(window);
