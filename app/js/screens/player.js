/* Full-screen player: zapping, number entry, channel drawer, seeking (keys, pointer, jump-to-time), resume,
 * aspect/audio switching, cache status.
 * params: { list, index, provider, playlist, kind: 'live' | 'vod' | 'episode' } */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  IPTV.Screens = IPTV.Screens || {};
  var h = IPTV.h, W = IPTV.W, Engine = IPTV.Engine, Store = IPTV.Store, TE = IPTV.TimeEntry;

  var ASPECTS = [
    { value: 'contain', label: 'Fit' },
    { value: 'cover', label: 'Zoom' },
    { value: 'fill', label: 'Stretch' }
  ];
  var SEEK_STEPS = [10, 10, 30, 30, 60, 120, 300];   // left/right: grows while the key is held or tapped quickly
  var MINUTE = 60, BIG_JUMP = 600;                    // up/down and CH+/CH- for movies
  var OVERLAY_MS = 4500;

  function fmtSpeed(bytesPerSec) {
    if (!bytesPerSec) return '';
    return bytesPerSec >= 1048576 ? (bytesPerSec / 1048576).toFixed(1) + ' MB/s' : Math.round(bytesPerSec / 1024) + ' KB/s';
  }

  IPTV.Screens.Player = function () {
    var p = {};              // current params
    var item = null;         // currently playing item
    var live = false;
    var state = 'loading';
    var aspect = 0;
    var overlayTimer = null, zapTimer = null, numTimer = null, seekTimer = null, saveAt = 0;
    var typed = '';
    var seekTarget = null, seekCount = 0, lastSeekAt = 0;
    var jump = null;         // { digits } while the jump-to-time box is open
    var scrubbing = false;
    var cacheStatus = null;
    var drawer = null, drawerOpen = false;
    var epgToken = 0, lastMove = 0;

    // ---- DOM ---------------------------------------------------------------
    var logo = h('img', { className: 'p-logo' });
    var title = h('div', { className: 'p-title' });
    var sub = h('div', { className: 'p-sub' });
    var favMark = h('span', { className: 'p-fav', text: '★' });
    var top = h('div', { className: 'p-top' }, [logo, h('div', { className: 'p-meta' }, [h('div', { className: 'p-line' }, [title, favMark]), sub])]);

    var nowTitle = h('div', { className: 'p-now' });
    var nextTitle = h('div', { className: 'p-next' });
    var barBuf = h('div', { className: 'p-buf' });
    var barFill = h('div', { className: 'p-fill' });
    var knob = h('div', { className: 'p-knob' });
    var tip = h('div', { className: 'p-tip' });
    var barHit = h('div', { className: 'p-barhit' }, [h('div', { className: 'p-bar' }, [barBuf, barFill]), knob, tip]);
    var timeL = h('span', { className: 'p-tl' });
    var timeC = h('span', { className: 'p-tc' });
    var timeR = h('span', { className: 'p-tr' });
    var hints = h('div', { className: 'p-hints' });
    var bottom = h('div', { className: 'p-bottom' }, [
      nowTitle, barHit, h('div', { className: 'p-times' }, [timeL, timeC, timeR]), nextTitle, hints
    ]);

    var spinnerText = h('div', { className: 'p-spintext' });
    var spinner = h('div', { className: 'p-spinwrap' }, [h('div', { className: 'p-spinner' }), spinnerText]);
    var errTitle = h('div', { className: 'p-errt' });
    var errMsg = h('div', { className: 'p-errm' });
    var err = h('div', { className: 'p-error' }, [errTitle, errMsg, h('div', { className: 'p-errh', text: 'OK: retry     BACK: exit' })]);
    var numBox = h('div', { className: 'p-num' });
    var pauseMark = h('div', { className: 'p-pause', text: '⏸' });
    var drawerEl = h('div', { className: 'p-drawer' });
    var tracksEl = h('div', { className: 'p-tracks scroller' });
    var tracksOpen = false, tracksZone = null;
    var jumpValue = h('div', { className: 'p-jv' });
    var jumpNote = h('div', { className: 'p-jn' });
    var jumpBox = h('div', { className: 'p-jump' }, [
      h('div', { className: 'p-jt', text: 'Jump to' }), jumpValue, jumpNote,
      h('div', { className: 'p-jh', text: '0-9 type time     ◀ delete     OK go     BACK cancel' })
    ]);

    var el = h('div', { className: 'screen player' }, [spinner, top, bottom, numBox, pauseMark, err, drawerEl, tracksEl, jumpBox]);

    // ---- helpers -------------------------------------------------------------
    function hideOverlay() { el.classList.remove('show-ui'); }
    function showOverlay(ms) {
      el.classList.add('show-ui');
      clearTimeout(overlayTimer);
      overlayTimer = setTimeout(function () {
        if (!drawerOpen && !jump && !scrubbing && !tracksOpen && state !== 'paused') hideOverlay();
      }, ms || OVERLAY_MS);
    }

    function duration() {
      var d = Engine.video.duration;
      return isFinite(d) && d > 0 ? d : 0;
    }

    function setState(s, msg) {
      state = s;
      el.classList.toggle('is-loading', s === 'loading');
      el.classList.toggle('is-paused', s === 'paused');
      el.classList.toggle('is-error', s === 'error');
      if (s === 'error') { errTitle.textContent = 'Cannot play this stream'; errMsg.textContent = msg || ''; }
      if (s === 'paused') showOverlay(60000);
      paintSpinnerText();
    }

    function paintSpinnerText() {
      if (state !== 'loading') { spinnerText.textContent = ''; return; }
      var st = cacheStatus;
      if (st && st.state === 'buffering') {
        spinnerText.textContent = 'Caching ' + Math.round(st.ahead) + ' / ' + Math.round(st.need) + ' s' +
          (st.speed ? '   ·   ' + fmtSpeed(st.speed) : '') + '\nOK: start now';
      } else spinnerText.textContent = '';
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

    /** Position, cached range and the "+2:35 cached" label for movies/episodes. */
    function paintTime() {
      if (live) return;
      var v = Engine.video, d = duration();
      var t = seekTarget != null ? seekTarget : v.currentTime;
      var pct = d ? IPTV.clamp(t / d * 100, 0, 100) : 0;
      timeL.textContent = IPTV.fmtDuration(t);
      timeR.textContent = d ? IPTV.fmtDuration(d) : '';
      barFill.style.width = pct + '%';
      knob.style.left = pct + '%';
      var b = Engine.bufferInfo();
      if (d) {
        barBuf.style.left = IPTV.clamp(b.start / d * 100, 0, 100) + '%';
        barBuf.style.width = IPTV.clamp((b.end - b.start) / d * 100, 0, 100) + '%';
      }
      timeC.textContent = b.ahead >= 1 ? 'Cached +' + IPTV.fmtDuration(b.ahead) : '';
    }

    function paintHints() {
      var parts = live ? ['OK Channels', 'CH± Zap', '0-9 Jump']
        : ['◀▶ ±10 s', '▲▼ ±1 min', 'CH± ±10 min', '0-9 / Blue Go to time', 'OK Pause'];
      parts.push('Red Favorite', 'Green Audio / Subtitles', 'Yellow Aspect (' + ASPECTS[aspect].label + ')');
      hints.textContent = parts.join('    ·    ');
    }

    // ---- playback ------------------------------------------------------------
    function play(index) {
      p.index = IPTV.clamp(index, 0, p.list.length - 1);
      item = p.list[p.index];
      live = item.kind === 'live';
      seekTarget = null; cacheStatus = null; closeJump();
      el.classList.toggle('is-live', live);
      title.textContent = (live && item.num ? item.num + '   ' : '') + item.name;
      sub.textContent = '';
      if (item.logo) { logo.src = item.logo; logo.style.display = 'block'; } else logo.style.display = 'none';
      nowTitle.textContent = ''; nextTitle.textContent = ''; timeL.textContent = ''; timeC.textContent = ''; timeR.textContent = '';
      barFill.style.width = '0%'; barBuf.style.width = '0%'; knob.style.left = '0%';
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
      Store.setProgress(p.playlist.id, item.key, (isFinite(d) && t > d - 45) || t < 20 ? 0 : t, isFinite(d) ? d : 0,
                        IPTV.Continue.metaFor(item, p.series));
    }

    // ---- seeking ---------------------------------------------------------------
    /** Move the target and apply it after `delay` ms, so repeated presses add up into one seek. */
    function seekTo(t, delay) {
      var d = duration();
      if (!d) { IPTV.toast('This video cannot seek'); return; }
      seekTarget = IPTV.clamp(t, 0, d);
      showOverlay();
      paintTime();
      clearTimeout(seekTimer);
      seekTimer = setTimeout(function () {
        var target = seekTarget;
        seekTarget = null;
        Engine.seekTo(target);
      }, delay);
    }

    function seekRel(sec, delay) {
      var base = seekTarget != null ? seekTarget : Engine.video.currentTime;
      seekTo(base + sec, delay == null ? 450 : delay);
    }

    /** Left/right: 10 s, growing to 5 min while the key is held or tapped quickly. */
    function seekStep(dir) {
      var now = Date.now();
      seekCount = now - lastSeekAt < 900 ? Math.min(seekCount + 1, SEEK_STEPS.length - 1) : 0;
      lastSeekAt = now;
      seekRel(dir * SEEK_STEPS[seekCount]);
    }

    // jump-to-time box
    function openJump(firstDigit) {
      if (!duration()) { IPTV.toast('This video cannot seek'); return; }
      jump = { digits: firstDigit != null ? TE.push('', firstDigit) : '' };
      jumpBox.classList.add('show');
      showOverlay(60000);
      paintJump();
    }
    function closeJump() {
      jump = null;
      jumpBox.classList.remove('show');
      if (item && !drawerOpen) showOverlay();
    }
    function paintJump() {
      var d = duration(), secs = TE.toSeconds(jump.digits);
      jumpValue.textContent = TE.format(jump.digits);
      jumpNote.textContent = secs > d ? 'Past the end (' + IPTV.fmtDuration(d) + '): will go to the end' : 'of ' + IPTV.fmtDuration(d);
      jumpNote.className = 'p-jn' + (secs > d ? ' warn' : '');
    }
    function onJumpKey(a) {
      if (/^num\d$/.test(a)) { jump.digits = TE.push(jump.digits, a.charAt(3)); paintJump(); }
      else if (a === 'left' || a === 'rw') { jump.digits = TE.pop(jump.digits); paintJump(); }
      else if (a === 'enter') { var secs = TE.toSeconds(jump.digits); closeJump(); seekTo(secs, 0); }
      else if (a === 'back' || a === 'blue') closeJump();
      return true;
    }

    // pointer (Magic Remote): click or drag anywhere on the bar
    function barFraction(e) {
      var r = barHit.getBoundingClientRect();     // already includes the stage scale
      return IPTV.clamp((e.clientX - r.left) / r.width, 0, 1);
    }
    function onBarMove(e) {
      var f = barFraction(e), d = duration();
      if (!d) return;
      tip.textContent = IPTV.fmtDuration(f * d);
      tip.style.left = f * 100 + '%';
      tip.style.display = 'block';
      if (scrubbing) seekTo(f * d, 150);
    }
    barHit.addEventListener('mousemove', onBarMove);
    barHit.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
    barHit.addEventListener('mousedown', function (e) {
      if (live || !duration()) return;
      scrubbing = true;
      seekTo(barFraction(e) * duration(), 150);
      e.stopPropagation();
    });
    function onMouseUp() { scrubbing = false; }
    root.addEventListener('mouseup', onMouseUp);

    // any pointer movement wakes the overlay; a click on the picture acts like OK
    el.addEventListener('mousemove', function () {
      var now = Date.now();
      if (now - lastMove > 250) { lastMove = now; showOverlay(); }
    });
    el.addEventListener('click', function (e) {
      var t = e.target;
      if (barHit.contains(t) || drawerEl.contains(t) || jumpBox.contains(t) || err.contains(t)) return;
      if (live) { if (!drawerOpen) openDrawer(); else closeDrawer(); }
      else if (!jump) { Engine.togglePause(); showOverlay(); }
    });

    // ---- audio / subtitle picker ------------------------------------------------------------------
    var SIZES = [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }];

    function openTracks() {
      var t = Engine.tracks();
      if (t.audio.length < 2 && !t.text.length) { IPTV.toast('No other audio or subtitle tracks in this stream'); return; }
      var zoneItems = [];
      IPTV.clear(tracksEl);
      tracksEl.appendChild(h('div', { className: 'pt-title', text: 'Audio & subtitles' }));
      function row(label, active, fn) {
        var b = W.button((active ? '\u2713  ' : '      ') + label, fn, active ? 'on' : '');
        tracksEl.appendChild(b.el);
        zoneItems.push(b);
      }
      if (t.audio.length > 1) {
        tracksEl.appendChild(h('div', { className: 'pt-head', text: 'Audio' }));
        t.audio.forEach(function (a) {
          row(a.label, a.active, function () { Engine.setAudio(a.id); closeTracks(); IPTV.toast('Audio: ' + a.label); });
        });
      }
      if (t.text.length) {
        tracksEl.appendChild(h('div', { className: 'pt-head', text: 'Subtitles' }));
        row('Off', !t.text.some(function (x) { return x.active; }), function () { Engine.setText(-1); closeTracks(); IPTV.toast('Subtitles off'); });
        t.text.forEach(function (x) {
          row(x.label, x.active, function () { Engine.setText(x.id); closeTracks(); IPTV.toast('Subtitles: ' + x.label); });
        });
        var size = W.select('Subtitle size', SIZES, Store.settings().subSize, function (v) { Store.setSetting('subSize', v); IPTV.applyCueStyle(); });
        tracksEl.appendChild(h('div', { className: 'pt-head', text: 'Appearance' }));
        tracksEl.appendChild(size.el);
        zoneItems.push(size);
      }
      tracksZone = new IPTV.ListZone({ dir: 'v', items: zoneItems });
      var first = -1;                           // start on the active audio track (the first ticked row)
      zoneItems.forEach(function (b, n) { if (first < 0 && b.el.classList.contains('on')) first = n; });
      tracksZone.setIndex(Math.max(0, first));
      tracksZone.setActive(true);
      tracksOpen = true;
      el.classList.add('tracks-open');
      showOverlay(60000);
    }

    function closeTracks() {
      tracksOpen = false;
      el.classList.remove('tracks-open');
      showOverlay();
    }

    // ---- channel jump / drawer -------------------------------------------------------
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
      else if (type === 'notice') IPTV.toast(msg, 4000);
      else if (type === 'buffer') {
        cacheStatus = msg;
        paintSpinnerText();
        if (el.classList.contains('show-ui')) paintTime();
      } else if (type === 'time') {
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
      if (jump) return onJumpKey(a);
      if (tracksOpen) {
        if (a === 'back' || a === 'green' || a === 'subtitle') { closeTracks(); return true; }
        tracksZone.handleKey(a);
        return true;
      }
      if (drawerOpen) {
        if (a === 'back' || a === 'left') { closeDrawer(); return true; }
        if (drawer.handleKey(a)) return true;
        return true;
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
        case 'up':
          if (live || item.kind === 'episode') zap(1); else seekRel(MINUTE);
          return true;
        case 'down':
          if (live || item.kind === 'episode') zap(-1); else seekRel(-MINUTE);
          return true;
        case 'chup':
          if (live || item.kind === 'episode') zap(1); else seekRel(BIG_JUMP);
          return true;
        case 'chdown':
          if (live || item.kind === 'episode') zap(-1); else seekRel(-BIG_JUMP);
          return true;
        case 'right': case 'ff': if (live) showOverlay(); else seekStep(1); return true;
        case 'left': case 'rw': if (live) showOverlay(); else seekStep(-1); return true;
        case 'info': showOverlay(); return true;
        case 'blue': if (live) showOverlay(); else openJump(); return true;
        case 'red':
          IPTV.toast(Store.toggleFav(p.playlist.id, item.key) ? 'Added to favorites' : 'Removed from favorites');
          updateFav(); showOverlay(); return true;
        case 'yellow':
          aspect = (aspect + 1) % ASPECTS.length;
          Engine.setAspect(ASPECTS[aspect].value);
          IPTV.toast('Aspect: ' + ASPECTS[aspect].label); paintHints(); return true;
        case 'green': case 'subtitle': openTracks(); return true;
      }
      if (/^num\d$/.test(a)) {
        if (!live) { openJump(a.charAt(3)); return true; }
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
        IPTV.applyCueStyle();
        Engine.onEvent = onEngine;
        play(p.index);
      },
      onClose: function () {
        saveProgress(true);
        [overlayTimer, zapTimer, numTimer, seekTimer].forEach(clearTimeout);
        epgToken++;
        Engine.onEvent = function () {};
        root.removeEventListener('mouseup', onMouseUp);
        Engine.stop();
        document.body.classList.remove('playing');
      }
    };
  };
})(window);
