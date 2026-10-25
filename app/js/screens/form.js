/* Add / edit playlist. Xtream logins are verified before saving; "Save anyway" covers servers that block the test request. */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  IPTV.Screens = IPTV.Screens || {};
  var h = IPTV.h, W = IPTV.W, Store = IPTV.Store;

  IPTV.Screens.PlaylistForm = function () {
    var editing = null, type = 'm3u', failed = false, busy = false;
    var zone, fields = {};

    var status = h('div', { className: 'form-status' });
    var titleEl = h('h1', { text: 'Add playlist' });
    var list = h('div', { className: 'form-list' });
    var el = h('div', { className: 'screen' }, [
      h('div', { className: 'brand-bar' }, [h('div', { className: 'brand', text: 'IPTV For All' })]),
      h('div', { className: 'form-wrap' }, [titleEl, list, status]),
      IPTV.hints(['▲▼ Move', 'OK Edit / Select', 'BACK Cancel'])
    ]);

    function clearFailure() { failed = false; saveBtn.el.textContent = 'Save'; status.textContent = ''; }

    var saveBtn = W.button('Save', save, 'primary');
    var cancelBtn = W.button('Cancel', function () { IPTV.Router.pop(); });

    /** Current text of every field, so rebuilding the form (type switch) keeps what was typed. */
    function snapshot() {
      var out = {};
      ['name', 'url', 'server', 'username', 'password'].forEach(function (k) {
        out[k] = fields[k] ? fields[k].input.value : (editing ? editing[k] : '');
      });
      return out;
    }

    function build() {
      var pl = snapshot();
      fields.name = W.input('Name', pl.name, { placeholder: 'My IPTV' });
      fields.type = W.select('Type', [{ value: 'm3u', label: 'M3U / M3U8 URL' }, { value: 'xtream', label: 'Xtream Codes login' }], type, function (v) {
        type = v; clearFailure(); build();
      });
      fields.url = W.input('Playlist URL', pl.url, { placeholder: 'http://example.com/playlist.m3u' });
      fields.server = W.input('Server URL', pl.server, { placeholder: 'http://example.com:8080' });
      fields.username = W.input('Username', pl.username);
      fields.password = W.input('Password', pl.password);
      var items = [fields.name, fields.type];
      if (type === 'm3u') items.push(fields.url); else items.push(fields.server, fields.username, fields.password);
      items.push(saveBtn, cancelBtn);
      var idx = zone ? zone.index : 0;
      IPTV.clear(list);
      items.forEach(function (it) { list.appendChild(it.el); });
      if (!zone) zone = new IPTV.ListZone({ dir: 'v' });
      zone.setItems(items);
      zone.setIndex(Math.min(idx, items.length - 1));
      zone.setActive(true);
    }

    function setStatus(msg, bad) {
      status.textContent = msg;
      status.className = 'form-status' + (bad ? ' bad' : '');
    }

    function save() {
      if (busy) return;
      var pl = {
        id: editing ? editing.id : null,
        type: type,
        name: fields.name.input.value.trim()
      };
      if (type === 'm3u') {
        pl.url = fields.url.input.value.trim();
        if (!/^https?:\/\//i.test(pl.url)) { setStatus('Enter a full playlist URL starting with http:// or https://', true); return; }
        pl.name = pl.name || IPTV.Screens.hostName(pl.url);
        finish(pl);
        return;
      }
      pl.server = IPTV.Xtream.normalizeServer(fields.server.input.value);
      pl.username = fields.username.input.value.trim();
      pl.password = fields.password.input.value;
      if (!pl.server || !pl.username) { setStatus('Server URL and username are required.', true); return; }
      pl.name = pl.name || IPTV.Screens.hostName(pl.server);
      if (failed) { finish(pl); return; }
      busy = true;
      setStatus('Connecting...');
      IPTV.createProvider(pl).login().then(function (info) {
        busy = false;
        var extra = info.expires ? '  ·  expires ' + info.expires.toLocaleDateString() : '';
        IPTV.toast('Connected: ' + info.status + extra, 3500);
        finish(pl);
      }).catch(function (e) {
        busy = false;
        failed = true;
        saveBtn.el.textContent = 'Save anyway';
        setStatus(e.message, true);
      });
    }

    function finish(pl) {
      var isNew = !editing;
      Store.savePlaylist(pl);
      IPTV.Router.pop();
      if (isNew) {   // first thing a new user wants is to see their channels
        Store.setActiveId(pl.id);
        IPTV.Router.push(IPTV.Screens.Main(), { playlist: pl });
      }
    }

    // any edit invalidates a previous failed check
    list.addEventListener('input', function () { if (failed) clearFailure(); });

    return {
      el: el,
      onShow: function (params) {
        editing = params.playlist || null;
        if (editing) { type = editing.type; titleEl.textContent = 'Edit playlist'; }
        build();
      },
      onKey: function (a) {
        if (busy) return true;
        return zone.handleKey(a);
      }
    };
  };

  IPTV.Screens.hostName = function (url) {
    var m = /^[a-z]+:\/\/([^\/?#:]+)/i.exec(url || '');
    return m ? m[1] : 'Playlist';
  };
})(window);
