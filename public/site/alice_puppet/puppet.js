/* AlicePuppet — plays keyed sprite-sheet clips with exact frame scrubbing.
 *
 * Why a canvas and not a <video> or CSS animation:
 *   - a puppet must sit on an EXACT frame (scrub, pause, step), which video cannot
 *     do reliably across browsers;
 *   - ping-pong needs frame N then frame N-1, i.e. random access.
 *
 * popimpin: "thats solved via ping pong method" — so looping never requires a matched
 * foot phase. Caveat kept honest in the UI: reversing a WALK runs the gait backwards,
 * which is why walk_left is real leftward footage rather than walk_right reversed.
 */
(function () {
  'use strict';

  function Clip(meta, img) {
    this.m = meta; this.img = img;
  }
  Clip.prototype.clamp = function (i) {
    return Math.max(0, Math.min(this.m.count - 1, i | 0));
  };
  /* Draw a horizontal BAND of frame i.  y0/y1 are in frame pixels; the whole
   * frame is y0=0,y1=fh.  dy is where the FEET go. */
  Clip.prototype.drawBand = function (ctx, i, y0, y1, dx, dy, scale) {
    var m = this.m;
    i = this.clamp(i);
    var c = i % m.cols, r = (i / m.cols) | 0;
    var w = m.fw * scale;
    ctx.drawImage(this.img,
      c * m.fw, r * m.fh + y0, m.fw, y1 - y0,
      dx - w / 2, dy - (m.fh - y0) * scale, w, (y1 - y0) * scale);
  };
  Clip.prototype.draw = function (ctx, i, dx, dy, scale) {
    this.drawBand(ctx, i, 0, this.m.fh, dx, dy, scale);
  };
  /* centre-x of frame i, from the track; used to align two bands that came from
   * different frames (they were shot at different positions in the plate). */
  Clip.prototype.cx = function (i) {
    var t = this.m.track && this.m.track[this.clamp(i)];
    return t ? t.cx : this.m.cx0;
  };

  function Puppet(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.clips = {}; this.name = null;
    this.t = 0; this.dir = 1; this.playing = true;
    this.pingpong = true; this.inPlace = true;
    this.depth = 0;             // 0 = near, 1 = far
    this.speed = 1;
    this.last = 0;
    /* TWO-BAND MODE.  popimpin: "only the legs need to move correctly ... her legs is
     * the core of the actual puppet, what we see above them is just frame
     * reordering."  The legs run the strict gait cycle; the upper body is chosen
     * independently, so 18 leg frames x N upper frames covers far more poses than
     * the N frames that were shot. */
    this.twoBand = false;
    this.upperMode = 'follow';  // follow | hold | drift
    this.upperFrame = 0;
    this.upperDrift = 0;
  }

  Puppet.prototype.load = function (names, base) {
    var self = this;
    return Promise.all(names.map(function (n) {
      return fetch(base + n + '.json').then(function (r) { return r.json(); })
        .then(function (meta) {
          return new Promise(function (res, rej) {
            var im = new Image();
            im.onload = function () { self.clips[n] = new Clip(meta, im); res(n); };
            im.onerror = function () { rej(new Error('sheet failed: ' + n)); };
            im.src = base + meta.sheet;
          });
        });
    })).then(function () { self.name = names[0]; return self; });
  };

  Puppet.prototype.play = function (n) {
    if (this.clips[n]) { this.name = n; this.t = 0; this.dir = 1; }
  };

  Puppet.prototype.frame = function () { return Math.round(this.t); };

  Puppet.prototype.step = function (dt) {
    var c = this.clips[this.name]; if (!c || !this.playing) return;
    var adv = c.m.fps * dt * this.speed;
    this.t += adv * this.dir;
    this.upperDrift = (this.upperDrift + adv * 0.37) % Math.max(1, c.m.count);
    /* A clip with a stitched cycle is an INFINITE WALK: t is gait phase, it only
     * ever runs forward, and it wraps at the cycle length. Ping-pong would run the
     * gait backwards -- it is only for clips with no cycle (front_on). */
    var cyc = c.m.cycle;
    if (cyc && cyc.length) {
      var L = cyc.length;
      this.t = ((this.t % L) + L) % L;
      this.dir = 1;
      return;
    }
    if (this.pingpong) {
      if (this.t >= c.m.count - 1) { this.t = c.m.count - 1; this.dir = -1; }
      else if (this.t <= 0) { this.t = 0; this.dir = 1; }
    } else {
      if (this.t >= c.m.count) this.t -= c.m.count;
      if (this.t < 0) this.t += c.m.count;
    }
  };

  Puppet.prototype.render = function () {
    var ctx = this.ctx, cv = this.cv, c = this.clips[this.name];
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!c) return;
    var i = this.frame();
    /* i is gait PHASE when the clip has a cycle; src is the still that phase maps
     * to. Every band and the in-place offset read src, never raw i. */
    var cyc = c.m.cycle;
    var src = cyc && cyc.length
            ? cyc[((i % cyc.length) + cyc.length) % cyc.length] : i;
    // depth: farther = smaller and higher up the frame
    var s = (1 - this.depth * 0.72) * (cv.height * 0.78 / c.m.fh);
    var groundNear = cv.height * 0.92, groundFar = cv.height * 0.46;
    var dy = groundNear + (groundFar - groundNear) * this.depth;
    /* Position each band by ITS OWN figure centre.
     * Aligning the upper band by (cx(legI) - cx(upI)) instead made a HELD upper
     * body slide sideways as the legs cycled -- the difference moves even when the
     * chosen frame does not. Anchoring both to one screen X is invariant. */
    var figureX = cv.width / 2;
    if (!this.inPlace) figureX += (c.cx(src) - c.m.cx0) * s;
    function put(frame, y0, y1) {
      c.drawBand(ctx, frame, y0, y1,
                 figureX - (c.cx(frame) - c.m.fw / 2) * s, dy, s);
    }

    if (!this.twoBand || !c.m.seam) { put(src, 0, c.m.fh); return; }

    /* The gait plays a STITCHED frame list, not `i % period`.
     * popimpin: "taking the right frames and stitching a walk together". The shot
     * order is an accident of the take; what matters is which frames connect. The
     * chosen path starts wherever the clean cycle actually begins (33 for toward,
     * 36 for away -- not 0) and drops frames that dragged the seam. Measured: the
     * loop seam fell from 4.4x a normal frame step to 1.7x on walk_toward. */
    var legI = cyc && cyc.length ? src
             : (c.m.legPeriod ? (i % c.m.legPeriod) : i);
    /* follow = the upper band from the SAME still as the legs. Reading raw i here
     * let the torso drift out of step with the stitched legs. */
    var upI = this.upperMode === 'follow' ? legI
            : this.upperMode === 'hold'   ? this.upperFrame
            : Math.round(this.upperDrift) % c.m.count;
    put(legI, c.m.seam, c.m.fh);   // legs: the strict gait cycle
    put(upI, 0, c.m.seam);         // upper: whatever pose was chosen
  };

  Puppet.prototype.start = function () {
    var self = this;
    function loop(ts) {
      var dt = self.last ? Math.min(0.05, (ts - self.last) / 1000) : 0;
      self.last = ts;
      self.step(dt); self.render();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    return this;
  };

  window.AlicePuppet = Puppet;
})();
