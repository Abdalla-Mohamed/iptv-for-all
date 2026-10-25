/* Settings. Every change is persisted immediately. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  IPTV.Screens = IPTV.Screens || {};
  var h = IPTV.h, W = IPTV.W, Store = IPTV.Store;

  IPTV.Version = '0.1.0';

  IPTV.Screens.Settings = function () {
    var s = Store.settings();
    var items = [
      W.select('Live stream format (Xtream)', [{ value: 'm3u8', label: 'HLS (m3u8)' }, { value: 'ts', label: 'MPEG-TS' }], s.liveFormat,
        function (v) { Store.setSetting('liveFormat', v); }),
      W.select('HLS playback engine', [{ value: 'auto', label: 'Automatic' }, { value: 'native', label: 'TV native' }, { value: 'hlsjs', label: 'hls.js' }], s.hlsEngine,
        function (v) { Store.setSetting('hlsEngine', v); }),
      W.select('Smart cache for MP4 movies (memory)', [{ value: 0, label: 'Off (TV decides)' }, { value: 64, label: '64 MB' }, { value: 128, label: '128 MB' }, { value: 256, label: '256 MB' }], s.cacheMb,
        function (v) { Store.setSetting('cacheMb', v); }),
      W.select('HLS movie buffer (hls.js engine)', [{ value: 30, label: '30 seconds' }, { value: 120, label: '2 minutes' }, { value: 300, label: '5 minutes' }], s.hlsBufferSec,
        function (v) { Store.setSetting('hlsBufferSec', v); }),
      W.select('Refresh saved playlists', [{ value: 0, label: 'Every start' }, { value: 6, label: 'After 6 hours' }, { value: 24, label: 'After 1 day' }, { value: -1, label: 'Only when I press Blue' }], s.refreshHours,
        function (v) { Store.setSetting('refreshHours', v); }),
      W.select('Preferred audio language', IPTV.Langs.OPTIONS.map(function (o) { return o.value ? o : { value: '', label: 'Stream default' }; }), s.audioLang,
        function (v) { Store.setSetting('audioLang', v); }),
      W.select('Preferred subtitles', IPTV.Langs.OPTIONS.map(function (o) { return o.value ? o : { value: '', label: 'Off' }; }), s.subLang,
        function (v) { Store.setSetting('subLang', v); }),
      W.select('Subtitle size', [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }], s.subSize,
        function (v) { Store.setSetting('subSize', v); IPTV.applyCueStyle(); }),
      W.select('Default picture mode', [{ value: 'contain', label: 'Fit' }, { value: 'cover', label: 'Zoom' }, { value: 'fill', label: 'Stretch' }], s.aspect,
        function (v) { Store.setSetting('aspect', v); }),
      W.input('CORS proxy (advanced, optional)', s.corsProxy, {
        placeholder: 'https://my-proxy.example/?url=',
        onChange: function (v) { Store.setSetting('corsProxy', v.trim()); }
      }),
      W.button('Parental PIN: set or change', function () {
        var P = IPTV.parental;
        (P.hasPin() ? IPTV.PinFlow.verify('Current PIN') : Promise.resolve(true)).then(function (ok) {
          if (ok) IPTV.PinFlow.create(P.hasPin() ? 'Choose a new PIN' : 'Choose a 4-digit PIN');
        });
      }),
      W.button('Parental PIN: remove (unlocks everything)', function () {
        var P = IPTV.parental;
        if (!P.hasPin()) { IPTV.toast('No PIN is set'); return; }
        IPTV.PinFlow.verify('Current PIN').then(function (ok) { if (ok) { P.clearPin(); IPTV.toast('PIN removed, all categories unlocked'); } });
      }, 'danger'),
      W.select('Lock adult categories automatically (needs a PIN)', [{ value: true, label: 'On' }, { value: false, label: 'Off' }], IPTV.parental.adultLock(),
        function (v) { IPTV.parental.setAdultLock(v); }),
      W.button('Clear all data (playlists, favorites, history)', function () {
        W.confirm('Clear all data?', 'This removes every playlist, favorite and resume point.', 'Clear').then(function (yes) {
          if (!yes) return;
          Store.clearAll();
          IPTV.library.clear();
          IPTV.toast('All data cleared');
          IPTV.Router.popToRoot();
          IPTV.Router.top().onResume();
        });
      }, 'danger')
    ];

    var list = h('div', { className: 'form-list' }, items.map(function (i) { return i.el; }));
    var zone = new IPTV.ListZone({ dir: 'v', items: items });
    zone.setActive(true);

    var el = h('div', { className: 'screen' }, [
      h('div', { className: 'brand-bar' }, [h('div', { className: 'brand', text: 'IPTV For All' }), h('div', { className: 'brand-sub', text: 'Settings' })]),
      h('div', { className: 'form-wrap scroller' }, [
        list,
        h('div', { className: 'about', text: 'IPTV For All v' + IPTV.Version + '  ·  open source (Apache-2.0)  ·  ships without any channels or content' })
      ]),
      IPTV.hints(['▲▼ Move', '◀▶ Change', 'BACK Done'])
    ]);

    return { el: el, onKey: function (a) { return zone.handleKey(a); } };
  };
})(window);
