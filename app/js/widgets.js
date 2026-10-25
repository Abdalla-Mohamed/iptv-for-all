/* D-pad widgets: VirtualGrid (windowed list/grid for huge playlists), ListZone (buttons/inputs/selects), confirm(). */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};
  var h = IPTV.h, clamp = IPTV.clamp;

  // ------------------------------------------------------------------------
  // VirtualGrid: only the cells inside the viewport exist in the DOM, so a
  // 30,000-channel playlist scrolls as smoothly as a 30-channel one.
  // opts: { cols, rowH, render(item, index) -> Node, onSelect, onFocus, onPointer, className }
  // ------------------------------------------------------------------------
  function VirtualGrid(opts) {
    var self = this;
    this.opts = opts;
    this.cols = opts.cols || 1;
    this.rowH = opts.rowH || 64;
    this.items = [];
    this.index = 0;
    this.active = false;
    this.nodes = {};
    this.sizer = h('div', { className: 'vsizer' });
    this.msg = h('div', { className: 'vmsg' });
    this.el = h('div', { className: 'vgrid' + (opts.className ? ' ' + opts.className : '') }, [this.sizer, this.msg]);
    this.el.addEventListener('scroll', function () { self.render(); });
  }

  var G = VirtualGrid.prototype;

  G.setLayout = function (cols, rowH) {
    this.cols = cols;
    this.rowH = rowH;
    this.setItems(this.items, this.index, true);
  };

  /** Show a status line ("Loading...", "No results") instead of items. Pass '' to clear. */
  G.setMessage = function (text) {
    this.msg.textContent = text || '';
    this.msg.style.display = text ? 'block' : 'none';
  };

  G.setItems = function (items, index, keepScroll) {
    this.items = items;
    this.index = clamp(index || 0, 0, Math.max(0, items.length - 1));
    this.sizer.style.height = Math.ceil(items.length / this.cols) * this.rowH + 'px';
    this.dropNodes();
    if (!keepScroll) this.el.scrollTop = 0;
    this.ensureVisible();
    this.render(true);
    if (this.opts.onFocus) this.opts.onFocus(this.items[this.index], this.index);
  };

  G.dropNodes = function () {
    for (var k in this.nodes) this.sizer.removeChild(this.nodes[k]);
    this.nodes = {};
  };

  /** Re-render visible cells (e.g. after a favorite toggled). */
  G.refresh = function () { this.dropNodes(); this.render(true); };

  G.current = function () { return this.items[this.index]; };

  G.render = function () {
    var n = this.items.length, cols = this.cols, rowH = this.rowH;
    var rows = Math.ceil(n / cols), vh = this.el.clientHeight || 1080, st = this.el.scrollTop;
    var firstRow = Math.max(0, Math.floor(st / rowH) - 1);
    var lastRow = Math.min(rows - 1, Math.ceil((st + vh) / rowH) + 1);
    var first = firstRow * cols, last = Math.min(n - 1, (lastRow + 1) * cols - 1);
    for (var k in this.nodes) {
      var ki = +k;
      if (ki < first || ki > last) { this.sizer.removeChild(this.nodes[k]); delete this.nodes[k]; }
    }
    for (var i = first; i <= last; i++) if (!this.nodes[i]) this.nodes[i] = this.makeCell(i);
  };

  G.makeCell = function (i) {
    var self = this, cols = this.cols;
    var cell = h('div', {
      className: 'vcell' + (i === this.index ? ' sel' : ''),
      style: {
        top: Math.floor(i / cols) * this.rowH + 'px',
        left: (i % cols) * 100 / cols + '%',
        width: 100 / cols + '%',
        height: this.rowH + 'px'
      }
    }, this.opts.render(this.items[i], i));
    cell.addEventListener('click', function () {
      if (self.opts.onPointer) self.opts.onPointer();
      self.setIndex(i);
      if (self.opts.onSelect) self.opts.onSelect(self.items[i], i);
    });
    this.sizer.appendChild(cell);
    return cell;
  };

  G.ensureVisible = function () {
    var row = Math.floor(this.index / this.cols), top = row * this.rowH, bottom = top + this.rowH;
    var st = this.el.scrollTop, vh = this.el.clientHeight || 1080;
    var margin = vh >= this.rowH * 4 ? this.rowH : 0;
    if (top - margin < st) this.el.scrollTop = Math.max(0, top - margin);
    else if (bottom + margin > st + vh) this.el.scrollTop = bottom + margin - vh;
  };

  G.setIndex = function (i) {
    if (!this.items.length) return;
    i = clamp(i, 0, this.items.length - 1);
    var old = this.nodes[this.index];
    if (old) old.classList.remove('sel');
    this.index = i;
    this.ensureVisible();
    this.render();
    var cell = this.nodes[i];
    if (cell) cell.classList.add('sel');
    if (this.opts.onFocus) this.opts.onFocus(this.items[i], i);
  };

  G.setActive = function (on) {
    this.active = on;
    this.el.classList.toggle('active', on);
  };

  /** Returns true if the key was consumed; false lets the screen move focus elsewhere. */
  G.handleKey = function (action) {
    var n = this.items.length, i = this.index, cols = this.cols;
    if (!n) return false;
    var page = Math.max(1, Math.floor((this.el.clientHeight || 600) / this.rowH) - 1) * cols;
    switch (action) {
      case 'up':
        if (i - cols < 0) return false;
        this.setIndex(i - cols); return true;
      case 'down':
        if (i + cols < n) this.setIndex(i + cols);
        else if (Math.floor(i / cols) < Math.floor((n - 1) / cols)) this.setIndex(n - 1);
        else return false;
        return true;
      case 'left':
        if (cols === 1 || i % cols === 0) return false;
        this.setIndex(i - 1); return true;
      case 'right':
        if (cols === 1 || i % cols === cols - 1 || i + 1 >= n) return false;
        this.setIndex(i + 1); return true;
      case 'chup': this.setIndex(i - page); return true;
      case 'chdown': this.setIndex(i + page); return true;
      case 'enter':
        if (this.opts.onSelect) this.opts.onSelect(this.items[i], i);
        return true;
    }
    return false;
  };

  // ------------------------------------------------------------------------
  // ListZone: a row/column of buttons, inputs and selects.
  // ------------------------------------------------------------------------
  function ListZone(opts) {
    this.dir = opts.dir || 'v';
    this.onPointer = opts.onPointer;
    this.items = [];
    this.index = 0;
    this.active = false;
    if (opts.items) this.setItems(opts.items);
  }

  var Z = ListZone.prototype;

  Z.setItems = function (items) {
    var self = this;
    this.items = items;
    this.index = clamp(this.index, 0, Math.max(0, items.length - 1));
    items.forEach(function (it) {
      if (it.bound) return;   // items can be re-used across setItems() calls
      it.bound = true;
      it.el.addEventListener('click', function (e) {
        var i = self.items.indexOf(it);
        if (it.type === 'input' && e.target === it.input) { self.setIndex(i); return; }
        if (self.onPointer) self.onPointer();
        self.setIndex(i);
        self.activate(it);
      });
    });
    this.paint();
  };

  Z.paint = function () {
    var self = this;
    this.items.forEach(function (it, i) {
      it.el.classList.toggle('sel', i === self.index);
    });
  };

  Z.setIndex = function (i) {
    this.index = clamp(i, 0, Math.max(0, this.items.length - 1));
    this.paint();
    if (this.dir === 'v' && this.items[this.index]) reveal(this.items[this.index].el);
  };

  /** Scroll the nearest .scroller ancestor so `el` is fully visible (works under the desktop stage scale too). */
  function reveal(el) {
    var sc = el.parentNode;
    while (sc && !(sc.classList && sc.classList.contains('scroller'))) sc = sc.parentNode;
    if (!sc) return;
    var r = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
    var scale = sc.offsetHeight ? b.height / sc.offsetHeight : 1;
    if (r.top < b.top + 8 * scale) sc.scrollTop -= (b.top + 8 * scale - r.top) / scale;
    else if (r.bottom > b.bottom - 8 * scale) sc.scrollTop += (r.bottom - (b.bottom - 8 * scale)) / scale;
  }

  Z.setActive = function (on) {
    this.active = on;
    this.paint();
  };

  Z.current = function () { return this.items[this.index]; };

  Z.activate = function (it) {
    if (it.type === 'input') IPTV.Keys.edit(it.input);
    else if (it.type === 'select') it.cycle(1);
    else if (it.onEnter) it.onEnter();
  };

  Z.handleKey = function (action) {
    var it = this.items[this.index];
    if (!it) return false;
    var prev = this.dir === 'h' ? 'left' : 'up', next = this.dir === 'h' ? 'right' : 'down';
    if (action === prev) {
      if (this.index === 0) return false;
      this.setIndex(this.index - 1); return true;
    }
    if (action === next) {
      if (this.index >= this.items.length - 1) return false;
      this.setIndex(this.index + 1); return true;
    }
    if ((action === 'left' || action === 'right') && it.type === 'select') {
      it.cycle(action === 'right' ? 1 : -1); return true;
    }
    if (action === 'enter') { this.activate(it); return true; }
    return false;
  };

  // ---- ListZone item factories ---------------------------------------------

  function button(label, onEnter, className) {
    return { type: 'button', onEnter: onEnter, el: h('div', { className: 'fi btn ' + (className || ''), text: label }) };
  }

  function input(label, value, o) {
    o = o || {};
    var field = h('input', { type: o.type || 'text', value: value || '', placeholder: o.placeholder || '', autocomplete: 'off', spellcheck: 'false' });
    if (o.onChange) field.addEventListener('input', function () { o.onChange(field.value); });
    var el = h('div', { className: 'fi field' }, [h('label', { text: label }), field]);
    return { type: 'input', el: el, input: field };
  }

  /** options: [{value, label}] */
  function select(label, options, value, onChange) {
    var val = h('span', { className: 'sval' });
    var idx = 0;
    options.forEach(function (o, i) { if (o.value === value) idx = i; });
    function paint() { val.textContent = '◀  ' + options[idx].label + '  ▶'; }
    var it = {
      type: 'select',
      el: h('div', { className: 'fi field' }, [h('label', { text: label }), val]),
      get value() { return options[idx].value; },
      cycle: function (d) {
        idx = (idx + d + options.length) % options.length;
        paint();
        if (onChange) onChange(options[idx].value);
      }
    };
    paint();
    return it;
  }

  // ------------------------------------------------------------------------
  // confirm(): modal Yes/No. Resolves true/false. Captures all keys meanwhile.
  // ------------------------------------------------------------------------
  function confirmDialog(title, message, okLabel) {
    return new Promise(function (resolve) {
      var zone;
      function done(v) {
        IPTV.Router.modal = null;
        box.parentNode.removeChild(box);
        resolve(v);
      }
      var cancel = button('Cancel', function () { done(false); });
      var ok = button(okLabel || 'OK', function () { done(true); }, 'danger');
      zone = new ListZone({ dir: 'h', items: [cancel, ok] });
      zone.setActive(true);
      var box = h('div', { className: 'modal' }, h('div', { className: 'dialog' }, [
        h('h2', { text: title }), h('p', { text: message }), h('div', { className: 'dlg-btns' }, [cancel.el, ok.el])
      ]));
      document.getElementById('app').appendChild(box);
      IPTV.Router.modal = {
        onKey: function (a) {
          if (a === 'back') done(false);
          else zone.handleKey(a);
        }
      };
    });
  }

  // ------------------------------------------------------------------------
  // pinPad(): modal 4-digit entry (number keys, or click the digits with the Magic Remote).
  // Resolves the digits, or null if cancelled. `note` is a line under the title (e.g. "Wrong PIN, 2 tries left").
  // ------------------------------------------------------------------------
  function pinPad(title, note) {
    return new Promise(function (resolve) {
      var digits = '';
      var dots = [0, 1, 2, 3].map(function () { return h('span', { className: 'pin-dot' }); });
      function paint() { dots.forEach(function (d, i) { d.classList.toggle('on', i < digits.length); }); }
      function done(v) {
        IPTV.Router.modal = null;
        box.parentNode.removeChild(box);
        resolve(v);
      }
      function push(n) {
        if (digits.length >= 4) return;
        digits += n;
        paint();
        if (digits.length === 4) setTimeout(function () { done(digits); }, 150);
      }
      var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '\u232B', '0', '\u2715'].map(function (k) {
        return h('div', { className: 'pin-key', text: k, onclick: function () {
          if (k === '\u232B') { digits = digits.slice(0, -1); paint(); } else if (k === '\u2715') done(null); else push(k);
        } });
      });
      var box = h('div', { className: 'modal' }, h('div', { className: 'dialog pin' }, [
        h('h2', { text: title }),
        h('p', { className: note ? 'pin-note bad' : 'pin-note', text: note || 'Type the 4 digits with the number keys' }),
        h('div', { className: 'pin-dots' }, dots),
        h('div', { className: 'pin-pad' }, keys),
        h('div', { className: 'pin-help', text: '\u25C0 delete     BACK cancel' })
      ]));
      document.getElementById('app').appendChild(box);
      IPTV.Router.modal = {
        onKey: function (a) {
          if (/^num\d$/.test(a)) push(a.charAt(3));
          else if (a === 'left' || a === 'rw') { digits = digits.slice(0, -1); paint(); }
          else if (a === 'back') done(null);
        }
      };
    });
  }

  IPTV.VirtualGrid = VirtualGrid;
  IPTV.ListZone = ListZone;
  IPTV.W = { button: button, input: input, select: select, confirm: confirmDialog, pinPad: pinPad };
})(window);
