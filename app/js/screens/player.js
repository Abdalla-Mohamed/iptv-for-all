/* Full-screen player: zapping, number entry, channel drawer, seek, resume, aspect/audio switching.
 * params: { list, index, provider, playlist, kind: 'live' | 'vod' | 'episode' } */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  IPTV.Screens = IPTV.Screens || {};
  var h = IPTV.h, Engine = IPTV.Engine, Store = IPTV.Store;

  var ASPECTS = [
    { value: 'contain', label: 'Fit' },
    { value: 'cover', label: 'Zoom' },
    { value: 'fill', label: 'Stretch' }
  ];
  var SEEK_STEPS = [10, 10, 30, 30, 60, 120, 300];
  var OVERLAY_MS = 4500;

  IPTV.Screens.Player = function () {
    var p = {};              // current params
    var item = null;         // currently playing item
    var live = false;
    var state = 'loading';
    var aspect = 0;
    var overlayTimer = null, zapTimer = null, numTimer = null, seekTimer = null, saveAt = 0;
    var typed = '';
    var seekTarget = null, seekCount = 0, lastSeekAt = 0;
    var drawer = null, drawerOpen = false;
    var epgToken = 0;

    // ---- DOM ---------------------------------------------------------------
    var logo = h('img', { className: 'p-logo' });
    var title = h('div', { className: 'p-title' });
    var sub = h('div', { className: 'p-sub' });
    var favMark = h('span', { className: 'p-fav', text: '★' });
    var top = h('div', { className: 'p-top' }, [logo, h('div', { className: 'p-meta' }, [h('div', { className: 'p-line' }, [title, favMark]), sub])]);

    var nowTitle = h('div', { className: 'p-now' });
    var nextTitle = h('div', { className: 'p-next' });
    var barFill = h('div', { className: 'p-fill' });
    var timeL = h('span', { className: 'p-tl' });
    var timeR = h('span', { className: 'p-tr' });
    var hints = h('div', { className: 'p-hints' });
    var bottom = h('div', { className: 'p-bottom' }, [
      nowTitle, h('div', { className: 'p-bar' }, barFill), h('div', { className: 'p-times' }, [timeL, timeR]), nextTitle, hints
    ]);

    var spinner = h('div', { className: 'p-spinner' });
    var errTitle = h('div', { className: 'p-errt' });
    var errMsg = h('div', { className: 'p-errm' });
    var err = h('div', { className: 'p-error' }, [errTitle, errMsg, h('div', { className: 'p-errh', text: 'OK: retry     BACK: exit' })]);
    var numBox = h('div', { className: 'p-num' });
    var pauseMark = h('div', { className: 'p-pause', text: '⏸' });
    var drawerEl = h('div', { className: 'p-drawer' });

    var el = h('div', { className: 'screen player' }, [spinner, top, bottom, numBox, pauseMark, err, drawerEl]);

    // ---- helpers -------------------------------------------------------------
    function hideOverlay() { el.classList.remove('show-ui'); }
    function showOverlay(ms) {
      el.classList.add('show-ui');
      clearTimeout(overlayTimer);
      overlayTimer = setTimeout(function () { if (!drawerOpen && state !== 'paused') hideOverlay(); }, ms || OVERLAY_MS);
    }

    function setState(s, msg) {
      state = s;
      el.classList.toggle('is-loading', s === 'loading');
      el.classList.toggle('is-paused', s === 'paused');
      el.classList.toggle('is-error', s === 'error');
      if (s === 'error') { errTitle.textContent = 'Cannot play this stream'; errMsg.textContent = msg || ''; }
      if (s === 'paused') showOverlay(60000);
    }

    function updateFav() {
      favMark.style.display = Store.isFav(p.playlist.id, item.key) ? 'inline' : 'none';
    }

    function renderEpg(list) {
      var now = Date.now(), cur = null, nxt = null, i;
      for (i = 0; i < list.length; i++) {
        if (list[i].start <= now && list[i].end > now) { cur = list[i]; nxt = list[i + 1] || null; break; }
        if (list[i].start > now) { nxt = list[i]; break; }
      }
      nowTitle.textContent = cur ? 'Now  ' + IPTV.fmtClock(cur.start) + '–' + IPTV.fmtClock(cur.end) + '  ' + cur.title : '';
      nextTitle.textContent = nxt ? 'Next  ' + IPTV.fmtClock(nxt.start) + '  ' + nxt.title : '';
      if (cur) {
        barFill.style.width = IPTV.clamp((now - cur.start) / (cur.end - cur.start) * 100, 0, 100) + '%';
        timeL.textContent = IPTV.fmtClock(cur.start);
        timeR.textContent = IPTV.fmtClock(cur.end);
      }
    }

    function paintTime() {
      if (live) return;
      var v = Engine.video, t = seekTarget != null ? seekTarget : v.currentTime, d = v.duration;
      timeL.textContent = IPTV.fmtDuration(t);
      timeR.textContent = isFinite(d) ? IPTV.fmtDuration(d) : '';
      barFill.style.width = isFinite(d) && d > 0 ? IPTV.clamp(t / d * 100, 0, 100) + '%' : '0%';
    }

    function paintHints() {
      var parts = live ? ['OK Channels', 'CH± Zap', '0-9 Jump'] : ['◀▶ Seek', 'OK Pause'];
      parts.push('Red Favorite', 'Green Audio', 'Yellow Aspect (' + ASPECTS[aspect].label + ')');
      hints.textContent = parts.join('    ·    ');
    }

    // ---- playback ------------------------------------------------------------
    function play(index) {
      p.index = IPTV.clamp(index, 0, p.list.length - 1);
      item = p.list[p.index];
      live = item.kind === 'live';
      seekTarget = null;
      el.classList.toggle('is-live', live);
      title.textContent = (live && item.num ? item.num + '   ' : '') + item.name;
      sub.textContent = '';
      if (item.logo) { logo.src = item.logo; logo.style.display = 'block'; } else logo.style.display = 'none';
      nowTitle.textContent = ''; nextTitle.textContent = ''; barFill.style.width = '0%'; timeL.textContent = ''; timeR.textContent = '';
      paintHints();
      updateFav();
      showOverlay();
      if (drawer) drawer.setIndex(p.index);

      var startAt = live ? 0 : Store.getProgress(p.playlist.id, item.key);
      Store.pushRecent(p.playlist.id, item.kind === 'live' ? 'live' : 'vod', item.key);
      Engine.load(p.provider.urlFor(item), { live: live, startAt: startAt });
      if (startAt > 30) IPTV.toast('Resuming at ' + IPTV.fmtDuration(startAt));

      if (live && p.provider.hasEpg) {
        var token = ++epgToken;
        p.provider.epg(item).then(function (list) { if (token === epgToken) renderEpg(list); });
      }
    }

    /** Debounced so rapid CH+ presses don't open a connection per channel. */
    function zap(delta) {
      if (p.list.length < 2) return;
      var next = (p.index + delta + p.list.length) % p.list.length;
      p.index = next;
      item = p.list[next];
      title.textContent = (item.num ? item.num + '   ' : '') + item.name;
      showOverlay();
      clearTimeout(zapTimer);
      zapTimer = setTimeout(function () { play(next); }, 350);
    }

    function saveProgress(force) {
      if (live || !item) return;
      var v = Engine.video, now = Date.now();
      if (!force && now - saveAt < 10000) return;
      saveAt = now;
      var t = v.currentTime, d = v.duration;
      Store.setProgress(p.playlist.id, item.key, (isFinite(d) && t > d - 45) || t < 20 ? 0 : t);
    }

    function seek(dir) {
      var v = Engine.video, now = Date.now();
      seekCount = now - lastSeekAt < 900 ? Math.min(seekCount + 1, SEEK_STEPS.length - 1) : 0;
      lastSeekAt = now;
      var base = seekTarget != null ? seekTarget : v.currentTime;
      seekTarget = IPTV.clamp(base + dir * SEEK_STEPS[seekCount], 0, isFinite(v.duration) ? v.duration : base);
      showOverlay();
      paintTime();
      clearTimeout(seekTimer);
      seekTimer = setTimeout(function () { Engine.seekTo(seekTarget); seekTarget = null; }, 500);
    }

    function jumpToNumber(n) {
      for (var i = 0; i < p.list.length; i++) {
        if (p.list[i].num === n) { clearTimeout(zapTimer); play(i); return; }
      }
      IPTV.toast('No channel ' + n);
    }

    function openDrawer() {
      if (!drawer) {
        drawer = new IPTV.VirtualGrid({
          cols: 1, rowH: 72, className: 'drawer-grid',
          render: function (it) {
            return h('div', { className: 'dr-row' }, [
              h('span', { className: 'dr-num', text: it.num || '' }),
              h('span', { className: 'dr-name', text: it.name })
            ]);
          },
          onSelect: function (it, i) { closeDrawer(); play(i); }
        });
        drawerEl.appendChild(drawer.el);
      }
      drawerOpen = true;
      el.classList.add('drawer-open');
      drawer.setItems(p.list, p.index);
      drawer.setActive(true);
      showOverlay(60000);
    }

    function closeDrawer() {
      drawerOpen = false;
      el.classList.remove('drawer-open');
      showOverlay();
    }

    // ---- engine events -----------------------------------------------------
    function onEngine(type, msg) {
      if (type === 'loading') { if (state !== 'error') setState('loading'); }
      else if (type === 'playing') setState('playing');
      else if (type === 'paused') { if (state !== 'loading' && state !== 'error') setState('paused'); }
      else if (type === 'error') setState('error', msg);
      else if (type === 'meta') paintTime();
      else if (type === 'time') {
        if (!live && el.classList.contains('show-ui') && seekTarget == null) paintTime();
        saveProgress(false);
      } else if (type === 'ended') {
        saveProgress(true);
        if (item.kind === 'episode' && p.index < p.list.length - 1) play(p.index + 1);
        else if (!live) IPTV.Router.pop();
      }
    }

    // ---- keys ----------------------------------------------------------------
    function onKey(a) {
      if (drawerOpen) {
        if (a === 'back' || a === 'left') { closeDrawer(); return true; }
        if (drawer.handleKey(a)) return true;
        return a !== 'back';
      }
      if (state === 'error') {
        if (a === 'enter') { play(p.index); return true; }
        if (a === 'back') return false;
      }
      switch (a) {
        case 'back': case 'stop': IPTV.Router.pop(); return true;
        case 'enter':
          if (live) openDrawer(); else { Engine.togglePause(); showOverlay(); }
          return true;
        case 'play': if (Engine.video.paused) Engine.togglePause(); return true;
        case 'pause': if (!Engine.video.paused) Engine.togglePause(); return true;
        case 'playpause': Engine.togglePause(); return true;
        case 'up': case 'chup':
          if (live || item.kind === 'episode') { zap(1); } else showOverlay();
          return true;
        case 'down': case 'chdown':
          if (live || item.kind === 'episode') { zap(-1); } else showOverlay();
          return true;
        case 'right': case 'ff': if (live) showOverlay(); else seek(1); return true;
        case 'left': case 'rw': if (live) showOverlay(); else seek(-1); return true;
        case 'info': case 'blue': showOverlay(); return true;
        case 'red':
          IPTV.toast(Store.toggleFav(p.playlist.id, item.key) ? 'Added to favorites' : 'Removed from favorites');
          updateFav(); showOverlay(); return true;
        case 'yellow':
          aspect = (aspect + 1) % ASPECTS.length;
          Engine.setAspect(ASPECTS[aspect].value);
          IPTV.toast('Aspect: ' + ASPECTS[aspect].label); paintHints(); return true;
        case 'green':
          var label = Engine.nextAudio();
          IPTV.toast(label ? 'Audio: ' + label : 'No other audio tracks'); return true;
      }
      if (live && /^num\d$/.test(a)) {
        typed += a.charAt(3);
        numBox.textContent = typed;
        numBox.classList.add('show');
        clearTimeout(numTimer);
        numTimer = setTimeout(function () {
          numBox.classList.remove('show');
          var n = parseInt(typed, 10);
          typed = '';
          jumpToNumber(n);
        }, 1800);
        return true;
      }
      return true; // swallow everything else while playing
    }

    return {
      el: el,
      onKey: onKey,
      onShow: function (params) {
        p = params;
        aspect = 0;
        ASPECTS.forEach(function (a, i) { if (a.value === Store.settings().aspect) aspect = i; });
        Engine.setAspect(ASPECTS[aspect].value);
        document.body.classList.add('playing');
        Engine.onEvent = onEngine;
        play(p.index);
      },
      onClose: function () {
        saveProgress(true);
        [overlayTimer, zapTimer, numTimer, seekTimer].forEach(clearTimeout);
        epgToken++;
        Engine.onEvent = function () {};
        Engine.stop();
        document.body.classList.remove('playing');
      }
    };
  };
})(window);
