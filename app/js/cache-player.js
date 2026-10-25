/* Smart cache player.
 *
 * Plays a progressive MP4 through Media Source Extensions with our own read-ahead cache instead of leaving
 * buffering to the TV's media pipeline:
 *   - pulls the file in small HTTP range requests (adaptive size) and remuxes them on the fly with mp4box.js
 *   - keeps up to `cacheBytes` of media in memory around the playhead (read-ahead + a back buffer for rewinds)
 *   - waits until a few seconds are cached before starting, and after an underrun pauses and refills to a
 *     larger threshold, so a slow connection gives long smooth stretches instead of constant stutter
 *   - a seek outside the cache jumps straight to the right byte offset (no downloading from the start)
 * Anything unexpected (codec the TV cannot play through MSE, no range support, network errors, start timeout)
 * calls opts.onFallback so the engine can continue with plain <video src>. MKV/AVI/TS never get here.
 *
 * The pure helpers (policy, chunkSize, plan) are exported for unit tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else (root.IPTV = root.IPTV || {}).CachePlayer = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var SEGMENT_SECONDS = 4;
  var TICK_MS = 400;
  var FIRST_CHUNK = 512 * 1024, MIN_CHUNK = 128 * 1024, MAX_CHUNK = 2 * 1024 * 1024;
  var START_AHEAD = 8;              // seconds cached before the first frame plays
  var LOW_WATER = 1.0;              // seconds: below this while playing -> pause and refill (ticks are 0.4 s apart, so pause before the decoder starves)
  var START_TIMEOUT_MS = 20000;     // no 'playing' this long after we asked -> fall back to native
  var MAX_QUEUE_BYTES = 12 * 1024 * 1024;
  var MAX_RETRIES = 3;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // ---- pure helpers ------------------------------------------------------------------------------------

  /** Seconds to read ahead / keep behind for a byte budget and the stream's average byte rate. */
  function plan(cacheBytes, bytesPerSec) {
    var bps = Math.max(bytesPerSec, 16 * 1024);
    return {
      target: clamp(cacheBytes * 0.8 / bps, 10, 3600),
      back: clamp(cacheBytes * 0.2 / bps, 5, 900),
      resume: clamp(cacheBytes * 0.8 / bps * 0.15, 12, 30)   // refill level after an underrun
    };
  }

  /**
   * Range-request size: ~1.5 s of measured throughput, so slow links get frequent small deliveries; never more
   * than the room left in the cache budget (`room` bytes), so a fast link cannot overshoot the memory limit.
   */
  function chunkSize(speedBytesPerSec, room) {
    var n = speedBytesPerSec ? clamp(Math.round(speedBytesPerSec * 1.5), MIN_CHUNK, MAX_CHUNK) : FIRST_CHUNK;
    if (room != null) n = Math.min(n, Math.max(MIN_CHUNK, room));
    return Math.floor(n);               // goes into a Range header: must be an integer
  }

  /**
   * The rebuffer state machine. s: { autoPaused, paused, hasPlayed, ahead, remaining, drained, plan }
   *   ahead = cached seconds after the playhead, remaining = content seconds left, drained = whole file is in
   *   memory (nothing more can arrive, so waiting is pointless).
   * Returns 'pause' (start refilling), 'resume' (enough cached), or null.
   */
  function policy(s) {
    if (s.autoPaused) {
      var need = s.hasPlayed ? s.plan.resume : START_AHEAD;
      if (s.ahead >= Math.min(need, Math.max(0.5, s.remaining - 0.3)) || s.drained) return 'resume';
      return null;
    }
    if (!s.paused && s.hasPlayed && s.ahead < LOW_WATER && s.remaining > 1 && !s.drained) return 'pause';
    return null;
  }

  function supported(url) {
    return !!(root && root.MediaSource && root.MP4Box && /\.(mp4|m4v|mov)(\?|#|$)/i.test(url));
  }

  var api = { policy: policy, chunkSize: chunkSize, plan: plan, supported: supported, START_AHEAD: START_AHEAD };
  if (!root) return api;

  // ---- the player (browser only) ----------------------------------------------------------------------------

  /** opts: { startAt, cacheBytes, onStatus(status), onFallback(reason, time) } */
  function CachePlayer(video, url, opts) {
    this.video = video;
    this.url = url;
    this.opts = opts;
    this.cacheBytes = opts.cacheBytes;

    this.mp4 = null; this.ms = null; this.objectUrl = '';
    this.info = null; this.msOpen = false; this.setupDone = false;
    this.entries = [];
    this.duration = 0;
    this.bytesPerSec = 512 * 1024;
    this.plan = plan(this.cacheBytes, this.bytesPerSec);

    this.fetchPos = 0; this.xhr = null; this.eof = false; this.retries = 0;
    this.limit = Infinity;        // for moov-at-the-end files: where the media data stops (the moov box itself is already parsed)
    this.speed = 0;
    this.seekOffset = null; this.lastSeek = -1;

    this.autoPaused = true;       // we hold playback until enough is cached
    this.hasPlayed = false;
    this.playRequestedAt = 0;
    this.destroyed = false;
    this.timer = null;
  }

  var C = CachePlayer.prototype;

  C.start = function () {
    var self = this, v = this.video;
    this.ms = new root.MediaSource();
    this.objectUrl = root.URL.createObjectURL(this.ms);
    this.ms.addEventListener('sourceopen', function () { self.msOpen = true; self.trySetup(); });

    this.mp4 = root.MP4Box.createFile();
    this.mp4.onError = function () { self.fail('could not parse the MP4'); };
    this.mp4.onReady = function (info) { self.info = info; self.trySetup(); };
    this.mp4.onSegment = function (id, user, buffer, sampleNum) { self.onSegment(user, buffer, sampleNum); };

    this.onSeeking = function () { self.handleSeeking(); };
    this.onPlaying = function () { self.hasPlayed = true; self.playRequestedAt = 0; };
    this.onVideoError = function () { self.fail('the TV rejected the stream'); };
    v.addEventListener('seeking', this.onSeeking);
    v.addEventListener('playing', this.onPlaying);
    v.addEventListener('error', this.onVideoError);

    v.src = this.objectUrl;
    this.timer = setInterval(function () { self.tick(); }, TICK_MS);
    this.fetchNext();
  };

  C.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.timer);
    var v = this.video;
    v.removeEventListener('seeking', this.onSeeking);
    v.removeEventListener('playing', this.onPlaying);
    v.removeEventListener('error', this.onVideoError);
    if (this.xhr) { this.xhr.onload = this.xhr.onerror = this.xhr.ontimeout = this.xhr.onreadystatechange = null; this.xhr.abort(); this.xhr = null; }
    try { this.mp4.stop(); } catch (e) { /* ignore */ }
    try { root.URL.revokeObjectURL(this.objectUrl); } catch (e) { /* ignore */ }
    this.entries = [];
  };

  C.fail = function (reason) {
    if (this.destroyed) return;
    var t = this.video.currentTime || this.opts.startAt || 0;
    this.opts.onFallback(reason, t);
  };

  /** User pressed OK while we were refilling: play now, accept the stutter. */
  C.forcePlay = function () {
    this.autoPaused = false;
    var p = this.video.play();
    if (p && p.catch) p.catch(function () {});
  };

  // ---- set-up once the MP4 header is parsed and the MediaSource is open ------------------------------------------

  C.trySetup = function () {
    if (this.setupDone || !this.info || !this.msOpen || this.destroyed) return;
    var info = this.info, self = this;
    if (info.isFragmented) { this.fail('fragmented MP4'); return; }

    var vt = null, at = null;
    info.tracks.forEach(function (t) {
      if (t.video && !vt) vt = t;
      else if (t.audio && !at) at = t;
    });
    if (!vt) { this.fail('no video track'); return; }

    var tracks = at ? [vt, at] : [vt], entries = [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i], kind = t.video ? 'video' : 'audio', mime = null, cands = [t.codec, String(t.codec).toLowerCase()];
      for (var c = 0; c < cands.length && !mime; c++) {
        var m = kind + '/mp4; codecs="' + cands[c] + '"';
        if (root.MediaSource.isTypeSupported(m)) mime = m;
      }
      if (!mime) { this.fail('codec ' + t.codec + ' is not supported'); return; }
      try { entries.push({ track: t, mime: mime, sb: this.ms.addSourceBuffer(mime), queue: [], queuedBytes: 0 }); }
      catch (e) { this.fail('cannot create buffer for ' + t.codec); return; }
    }

    this.duration = info.duration / info.timescale;
    try { this.ms.duration = this.duration; } catch (e) { /* some stacks want it after the first append */ }
    var rate = 0;
    tracks.forEach(function (t) { rate += (t.bitrate || 0) / 8; });
    if (rate > 0) this.bytesPerSec = rate;
    this.plan = plan(this.cacheBytes, this.bytesPerSec);

    entries.forEach(function (e) {
      var secs = e.track.duration / e.track.timescale || self.duration;
      var nb = Math.max(1, Math.round(e.track.nb_samples / secs * SEGMENT_SECONDS));
      self.mp4.setSegmentOptions(e.track.id, e, { nbSamples: nb });
      e.sb.addEventListener('updateend', function () { self.pump(e); });
    });
    this.entries = entries;
    this.mp4.initializeSegmentation().forEach(function (seg) {
      seg.user.queue.push(seg.buffer);
      seg.user.queuedBytes += seg.buffer.byteLength;
    });
    this.mp4.start();
    this.setupDone = true;

    if (this.opts.startAt > 1) {
      var r = this.mp4.seek(this.opts.startAt, true);
      this.seekOffset = r.offset;
      this.lastSeek = this.opts.startAt;
      this.video.currentTime = this.opts.startAt;
    }
    entries.forEach(function (e) { self.pump(e); });
  };

  // ---- downloading ------------------------------------------------------------------------------------------------

  C.fetchNext = function () {
    if (this.xhr || this.destroyed || this.eof) return;
    if (this.fetchPos >= this.limit) { this.eof = true; this.onEof(); return; }
    var self = this, start = this.fetchPos;
    var room = this.setupDone ? (this.plan.target - this.aheadSeconds(this.video.currentTime) - this.queuedSeconds()) * this.bytesPerSec : null;
    var len = chunkSize(this.speed, room);
    if (this.limit - start < len) len = this.limit - start;
    var xhr = this.xhr = new root.XMLHttpRequest(), t0 = Date.now();
    xhr.open('GET', this.url, true);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = 30000;
    xhr.setRequestHeader('Range', 'bytes=' + start + '-' + (start + len - 1));
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 2 && xhr.status === 200) {   // server ignored Range: we'd be downloading the whole file
        xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onreadystatechange = null;
        xhr.abort();
        self.xhr = null;
        self.fail('server does not support range requests');
      }
    };
    xhr.onload = function () {
      self.xhr = null;
      if (self.destroyed) return;
      if (xhr.status === 416) {                       // asked for bytes beyond the end of the file
        self.eof = true;
        if (!self.info) { self.fail('no MP4 header found'); return; }
        self.onEof();
        return;
      }
      if (xhr.status !== 206) { self.fail('HTTP ' + xhr.status); return; }
      self.retries = 0;
      var buf = xhr.response, ms = Math.max(1, Date.now() - t0);
      var inst = buf.byteLength * 1000 / ms;
      self.speed = self.speed ? self.speed * 0.6 + inst * 0.4 : inst;
      self.onData(buf, start, buf.byteLength < len || start + buf.byteLength >= self.limit);
    };
    var retry = function () {
      self.xhr = null;
      if (self.destroyed) return;
      if (++self.retries > MAX_RETRIES) { self.fail('network error'); return; }
      setTimeout(function () { self.fetchNext(); }, 1000 * Math.pow(2, self.retries - 1));
    };
    xhr.onerror = retry;
    xhr.ontimeout = retry;
    xhr.send();
  };

  /**
   * mp4box's "next position" is only trustworthy while the header is being discovered (it follows the box
   * structure: ftyp -> skip mdat -> moov). Once the header is parsed we read sequentially; the one exception is
   * the call that completed the header, where its answer points at the first sample we still miss (this is what
   * sends a moov-at-the-end file back to the start of its media data).
   */
  C.onData = function (buf, start, short) {
    var wasReady = !!this.info;
    buf.fileStart = start;
    var next = this.mp4.appendBuffer(buf);
    var sequential = start + buf.byteLength;
    if (wasReady) this.fetchPos = sequential;
    else if (this.info) {
      this.fetchPos = typeof next === 'number' ? next : sequential;
      var m = this.mp4;
      if (m.moov && m.mdats && m.mdats.length && m.mdats[0].start < m.moov.start) this.limit = m.moov.start;
    } else this.fetchPos = typeof next === 'number' ? next : sequential;
    if (this.seekOffset != null) { this.fetchPos = this.seekOffset; this.seekOffset = null; }
    // a short read means "file ends here", but only matters if there is nothing left to fetch before that point
    // (a moov-at-the-end file ends with the moov, yet its media data lies in front of it)
    var fileEnd = short ? sequential : Infinity;
    if (this.fetchPos >= Math.min(fileEnd, this.limit)) {
      this.eof = true;
      if (!this.info) { this.fail('no MP4 header found'); return; }     // whole file read, still no moov: not an MP4
      this.onEof();
    }
  };

  C.onEof = function () {
    try { this.mp4.flush(); } catch (e) { /* ignore */ }
    this.entries.forEach(this.pump, this);
  };

  C.onSegment = function (entry, buffer, sampleNum) {
    entry.queue.push(buffer);
    entry.queuedBytes += buffer.byteLength;
    this.mp4.releaseUsedSamples(entry.track.id, sampleNum);
    this.pump(entry);
  };

  C.pump = function (entry) {
    if (this.destroyed || entry.sb.updating || !entry.queue.length || this.ms.readyState === 'closed') return;
    var buf = entry.queue.shift();
    entry.queuedBytes -= buf.byteLength;
    try {
      entry.sb.appendBuffer(buf);
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {          // TV memory is tighter than we planned: shrink and retry
        entry.queue.unshift(buf);
        entry.queuedBytes += buf.byteLength;
        this.plan.target = Math.max(10, this.plan.target * 0.6);
        this.plan.back = Math.max(5, this.plan.back * 0.5);
        this.evict(true);
      } else this.fail('append failed: ' + (e && e.name));
    }
  };

  // ---- seeking ------------------------------------------------------------------------------------------------------

  C.isBuffered = function (t) {
    var b = this.video.buffered;
    for (var i = 0; i < b.length; i++) if (t >= b.start(i) - 0.05 && t <= b.end(i)) return true;
    return false;
  };

  C.handleSeeking = function () {
    if (!this.setupDone) return;
    var t = this.video.currentTime;
    if (Math.abs(t - this.lastSeek) < 0.05) return;       // Chrome fires 'seeking' twice
    this.lastSeek = t;
    if (this.isBuffered(t)) return;                        // inside the cache: nothing to download

    if (this.xhr) { this.xhr.onload = this.xhr.onerror = this.xhr.ontimeout = this.xhr.onreadystatechange = null; this.xhr.abort(); this.xhr = null; }
    this.entries.forEach(function (e) {
      e.queue = []; e.queuedBytes = 0;
      try { if (e.sb.updating) e.sb.abort(); } catch (err) { /* ignore */ }
    });
    var r = this.mp4.seek(t, true);
    this.fetchPos = r.offset;
    this.eof = false;
    this.retries = 0;
    if (this.hasPlayed) this.autoPaused = false;           // let the normal underrun logic decide about pausing
    this.fetchNext();
  };

  // ---- housekeeping loop --------------------------------------------------------------------------------------------

  C.aheadSeconds = function (t) {
    var b = this.video.buffered;
    for (var i = 0; i < b.length; i++) if (t >= b.start(i) - 0.15 && t <= b.end(i)) return b.end(i) - t;
    return 0;
  };

  C.queuedSeconds = function () {
    var bytes = 0;
    this.entries.forEach(function (e) { bytes += e.queuedBytes; });
    return bytes / this.bytesPerSec;
  };

  C.queuesEmpty = function () {
    return this.entries.every(function (e) { return !e.queue.length && !e.sb.updating; });
  };

  /** Drop what is behind the back-buffer and anything stranded far ahead (left over after a seek). */
  C.evict = function (urgent) {
    var t = this.video.currentTime, keepFrom = t - this.plan.back, keepTo = t + this.plan.target * 1.5;
    this.entries.forEach(function (e) {
      if (e.sb.updating) return;
      var b = e.sb.buffered;
      for (var i = 0; i < b.length; i++) {
        var s = b.start(i), end = b.end(i), from = null, to = null;
        if (end < keepFrom) { from = s; to = end; }
        else if (s < keepFrom - 5 || (urgent && s < keepFrom)) { from = s; to = keepFrom; }
        else if (s > keepTo) { from = s; to = end; }
        if (from != null && to > from) { try { e.sb.remove(from, to); } catch (err) { /* ignore */ } return; }
      }
    });
  };

  C.tick = function () {
    if (this.destroyed) return;
    var v = this.video, t = v.currentTime;
    var ahead = this.aheadSeconds(t);

    if (this.setupDone) {
      this.evict(false);
      var remaining = this.duration - t;
      var drained = this.eof && this.queuesEmpty();
      var action = policy({ autoPaused: this.autoPaused, paused: v.paused, hasPlayed: this.hasPlayed, ahead: ahead,
                            remaining: remaining, drained: drained, plan: this.plan });
      if (action === 'pause') {
        this.autoPaused = true;           // set first so the engine can tell this pause from the user's
        v.pause();
      } else if (action === 'resume') {
        this.autoPaused = false;
        if (!this.playRequestedAt && !this.hasPlayed) this.playRequestedAt = Date.now();
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
      }
      if (this.playRequestedAt && Date.now() - this.playRequestedAt > START_TIMEOUT_MS) { this.fail('playback did not start'); return; }
      this.jumpSmallGap(t, ahead);
      if (drained && this.entries.length && this.ms.readyState === 'open') {
        try { this.ms.endOfStream(); } catch (e) { /* ignore */ }
      }
    }

    var cachedAhead = ahead + this.queuedSeconds();
    var wantMore = !this.setupDone || (cachedAhead < this.plan.target && this.queueBytes() < MAX_QUEUE_BYTES);
    if (wantMore && !this.xhr && !this.eof) this.fetchNext();

    this.opts.onStatus({
      state: this.autoPaused ? 'buffering' : 'playing',
      ahead: ahead,
      need: this.hasPlayed ? this.plan.resume : START_AHEAD,
      target: this.plan.target,
      speed: this.speed
    });
  };

  C.queueBytes = function () {
    var n = 0;
    this.entries.forEach(function (e) { n += e.queuedBytes; });
    return n;
  };

  /** Playback stuck right before a buffered range (tiny gap between segments): hop over it. */
  C.jumpSmallGap = function (t, ahead) {
    var v = this.video;
    if (v.paused || v.readyState > 2 || ahead > 0.1) return;
    var b = v.buffered;
    for (var i = 0; i < b.length; i++) {
      if (b.start(i) > t && b.start(i) - t < 1.5) { v.currentTime = b.start(i) + 0.05; return; }
    }
  };

  for (var k in api) CachePlayer[k] = api[k];
  return CachePlayer;
});
