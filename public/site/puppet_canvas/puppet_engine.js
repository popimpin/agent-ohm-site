/**
 * puppet_engine.js — Sovereign Puppet Animation & Rigging Engine for Design Space
 * 
 * Provides:
 * 1. 2-Bone Analytical Inverse Kinematics (IK) Solver (law of cosines, singularity-safe)
 * 2. 2D Mesh Pin Deformer (OpenToonz Plastic / After Effects Puppet barycentric weighting)
 * 3. CMU Mocap Frame Sequencer & Retargeter (interpolated 60fps playback of INK_CLIPS)
 * 4. Procedural Spring Dynamics (damped harmonic oscillator for secondary lag & bounce)
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PuppetEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- 1. Analytical 2-Bone Inverse Kinematics Solver ---
  function solve2BoneIK(root, target, len1, len2, bendDir) {
    bendDir = bendDir == null ? 1 : Math.sign(bendDir) || 1;
    var rx = root[0], ry = root[1];
    var tx = target[0], ty = target[1];
    var dx = tx - rx, dy = ty - ry;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1e-5) {
      dist = 1e-5;
      dx = 1e-5;
      dy = 0;
    }

    var maxReach = len1 + len2;
    var minReach = Math.abs(len1 - len2);
    var reached = true;
    var clampedDist = dist;

    if (dist >= maxReach - 1e-4) {
      clampedDist = maxReach - 1e-4;
      reached = false;
    } else if (dist <= minReach + 1e-4) {
      clampedDist = minReach + 1e-4;
      reached = false;
    }

    var baseAngle = Math.atan2(dy, dx);
    var cosAlpha = (len1 * len1 + clampedDist * clampedDist - len2 * len2) / (2 * len1 * clampedDist);
    cosAlpha = Math.max(-1, Math.min(1, cosAlpha));
    var alpha = Math.acos(cosAlpha);

    var angle1 = baseAngle + bendDir * alpha;
    var midX = rx + Math.cos(angle1) * len1;
    var midY = ry + Math.sin(angle1) * len1;

    var tipX, tipY, angle2;
    if (reached) {
      tipX = tx;
      tipY = ty;
      angle2 = Math.atan2(ty - midY, tx - midX);
    } else {
      var cosBeta = (len1 * len1 + len2 * len2 - clampedDist * clampedDist) / (2 * len1 * len2);
      cosBeta = Math.max(-1, Math.min(1, cosBeta));
      var beta = Math.acos(cosBeta);
      angle2 = angle1 + bendDir * (Math.PI - beta);
      tipX = midX + Math.cos(angle2) * len2;
      tipY = midY + Math.sin(angle2) * len2;
    }

    return {
      mid: [midX, midY],
      tip: [tipX, tipY],
      reached: reached,
      angle1: angle1,
      angle2: angle2
    };
  }

  // --- 2. Biped Skeleton & Mocap Retargeter ---
  var DEFAULT_STAND = {
    rootY: 0,
    hips: [0, 0],
    chest: [0, -88],
    neck: [0, -150],
    head: [0, -182],
    shR: [52, -140], elR: [64, -58], haR: [72, 26],
    shL: [-52, -140], elL: [-64, -58], haL: [-72, 26],
    hipR: [26, -6], knR: [32, 120], ftR: [40, 262],
    hipL: [-26, -6], knL: [-32, 120], ftL: [-40, 262],
    groundY: 262
  };

  function dist(p1, p2) {
    var dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  function PuppetSkeleton(options) {
    options = options || {};
    this.cx = options.cx != null ? options.cx : 400;
    this.groundY = options.groundY != null ? options.groundY : 400;
    this.scale = options.scale != null ? options.scale : 1.0;
    this.pose = JSON.parse(JSON.stringify(DEFAULT_STAND));
    this.ikTargets = {
      haR: null,
      haL: null,
      ftR: null,
      ftL: null
    };

    this.lengths = {
      armR_upper: dist(DEFAULT_STAND.shR, DEFAULT_STAND.elR),
      armR_lower: dist(DEFAULT_STAND.elR, DEFAULT_STAND.haR),
      armL_upper: dist(DEFAULT_STAND.shL, DEFAULT_STAND.elL),
      armL_lower: dist(DEFAULT_STAND.elL, DEFAULT_STAND.haL),
      legR_upper: dist(DEFAULT_STAND.hipR, DEFAULT_STAND.knR),
      legR_lower: dist(DEFAULT_STAND.knR, DEFAULT_STAND.ftR),
      legL_upper: dist(DEFAULT_STAND.hipL, DEFAULT_STAND.knL),
      legL_lower: dist(DEFAULT_STAND.knL, DEFAULT_STAND.ftL)
    };
  }

  PuppetSkeleton.prototype.setPose = function (p) {
    if (!p) return;
    for (var k in p) {
      if (Array.isArray(p[k])) {
        this.pose[k] = [p[k][0], p[k][1]];
      } else {
        this.pose[k] = p[k];
      }
    }
    this._applyIK();
  };

  PuppetSkeleton.prototype.setIKTarget = function (effector, targetXY, bendDir) {
    if (targetXY == null) {
      this.ikTargets[effector] = null;
    } else {
      this.ikTargets[effector] = { target: [targetXY[0], targetXY[1]], bendDir: bendDir };
    }
    this._applyIK();
  };

  PuppetSkeleton.prototype._applyIK = function () {
    var p = this.pose;
    if (this.ikTargets.haR) {
      var solR = solve2BoneIK(p.shR, this.ikTargets.haR.target, this.lengths.armR_upper, this.lengths.armR_lower, this.ikTargets.haR.bendDir || 1);
      p.elR = solR.mid;
      p.haR = solR.tip;
    }
    if (this.ikTargets.haL) {
      var solL = solve2BoneIK(p.shL, this.ikTargets.haL.target, this.lengths.armL_upper, this.lengths.armL_lower, this.ikTargets.haL.bendDir || -1);
      p.elL = solL.mid;
      p.haL = solL.tip;
    }
    if (this.ikTargets.ftR) {
      var solLegR = solve2BoneIK(p.hipR, this.ikTargets.ftR.target, this.lengths.legR_upper, this.lengths.legR_lower, this.ikTargets.ftR.bendDir || -1);
      p.knR = solLegR.mid;
      p.ftR = solLegR.tip;
    }
    if (this.ikTargets.ftL) {
      var solLegL = solve2BoneIK(p.hipL, this.ikTargets.ftL.target, this.lengths.legL_upper, this.lengths.legL_lower, this.ikTargets.ftL.bendDir || 1);
      p.knL = solLegL.mid;
      p.ftL = solLegL.tip;
    }
  };

  PuppetSkeleton.prototype.sampleClip = function (clip, localTime, loop) {
    if (!clip || !clip.frames || clip.frames.length === 0) return;
    var fps = clip.fps || 30;
    var totalDur = (clip.frames.length - 1) / fps;
    var t = localTime;
    if (loop !== false && totalDur > 0) {
      t = t % totalDur;
      if (t < 0) t += totalDur;
    } else {
      t = Math.max(0, Math.min(totalDur, t));
    }

    var frameFloat = t * fps;
    var idx0 = Math.floor(frameFloat);
    var idx1 = Math.min(clip.frames.length - 1, idx0 + 1);
    var u = frameFloat - idx0;

    var f0 = clip.frames[idx0];
    var f1 = clip.frames[idx1];

    var interpPose = {};
    for (var k in f0) {
      if (Array.isArray(f0[k])) {
        interpPose[k] = [
          f0[k][0] + (f1[k][0] - f0[k][0]) * u,
          f0[k][1] + (f1[k][1] - f0[k][1]) * u
        ];
      } else {
        interpPose[k] = f0[k] + (f1[k] - f0[k]) * u;
      }
    }
    this.setPose(interpPose);
  };

  PuppetSkeleton.prototype.toWorld = function (jointXY) {
    var rx = this.pose.hips ? this.pose.hips[0] : 0;
    var ry = this.pose.rootY || 0;
    var baseGround = this.pose.groundY || DEFAULT_STAND.groundY;
    var wx = this.cx + (jointXY[0] - rx) * this.scale;
    var wy = (this.groundY - (baseGround * this.scale)) + (jointXY[1] + ry) * this.scale;
    return [wx, wy];
  };

  PuppetSkeleton.prototype.toLocal = function (worldXY) {
    var rx = this.pose.hips ? this.pose.hips[0] : 0;
    var ry = this.pose.rootY || 0;
    var baseGround = this.pose.groundY || DEFAULT_STAND.groundY;
    var lx = (worldXY[0] - this.cx) / this.scale + rx;
    var ly = (worldXY[1] - (this.groundY - (baseGround * this.scale))) / this.scale - ry;
    return [lx, ly];
  };

  // --- 3. 2D Mesh Pin Deformer (OpenToonz Plastic Tool) ---
  function PuppetMeshDeformer(width, height, cols, rows) {
    this.width = width || 200;
    this.height = height || 300;
    this.cols = Math.max(2, cols || 8);
    this.rows = Math.max(2, rows || 12);
    this.vertices0 = [];
    this.vertices = [];
    this.triangles = [];
    this.pins = [];

    this._buildMesh();
  }

  PuppetMeshDeformer.prototype._buildMesh = function () {
    this.vertices0 = [];
    this.vertices = [];
    this.triangles = [];

    var dx = this.width / this.cols;
    var dy = this.height / this.rows;

    for (var r = 0; r <= this.rows; r++) {
      for (var c = 0; c <= this.cols; c++) {
        var x = c * dx;
        var y = r * dy;
        this.vertices0.push([x, y]);
        this.vertices.push([x, y]);
      }
    }

    var stride = this.cols + 1;
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        var i0 = r * stride + c;
        var i1 = i0 + 1;
        var i2 = (r + 1) * stride + c;
        var i3 = i2 + 1;
        this.triangles.push([i0, i1, i2]);
        this.triangles.push([i1, i3, i2]);
      }
    }
  };

  PuppetMeshDeformer.prototype.addPin = function (id, x, y, weightPower) {
    var p = {
      id: id,
      rest: [x, y],
      cur: [x, y],
      weightPower: weightPower || 2.0
    };
    this.pins.push(p);
    return p;
  };

  PuppetMeshDeformer.prototype.setPinPos = function (id, x, y) {
    for (var i = 0; i < this.pins.length; i++) {
      if (this.pins[i].id === id) {
        this.pins[i].cur = [x, y];
        break;
      }
    }
  };

  PuppetMeshDeformer.prototype.getPin = function (id) {
    for (var i = 0; i < this.pins.length; i++) {
      if (this.pins[i].id === id) return this.pins[i];
    }
    return null;
  };

  PuppetMeshDeformer.prototype.update = function () {
    if (this.pins.length === 0) {
      for (var i = 0; i < this.vertices0.length; i++) {
        this.vertices[i][0] = this.vertices0[i][0];
        this.vertices[i][1] = this.vertices0[i][1];
      }
      return;
    }

    for (var i = 0; i < this.vertices0.length; i++) {
      var v0 = this.vertices0[i];
      var totalWeight = 0;
      var sumDx = 0;
      var sumDy = 0;

      for (var p = 0; p < this.pins.length; p++) {
        var pin = this.pins[p];
        var dpx = v0[0] - pin.rest[0];
        var dpy = v0[1] - pin.rest[1];
        var distSq = dpx * dpx + dpy * dpy;
        var dist = Math.sqrt(distSq);

        var eps = 1e-3;
        var w = 1.0 / Math.pow(dist + eps, pin.weightPower);
        totalWeight += w;

        var pinDispX = pin.cur[0] - pin.rest[0];
        var pinDispY = pin.cur[1] - pin.rest[1];
        sumDx += pinDispX * w;
        sumDy += pinDispY * w;
      }

      var dx = totalWeight > 1e-6 ? sumDx / totalWeight : 0;
      var dy = totalWeight > 1e-6 ? sumDy / totalWeight : 0;

      this.vertices[i][0] = v0[0] + dx;
      this.vertices[i][1] = v0[1] + dy;
    }
  };

  // --- 4. Procedural Damped Harmonic Oscillator (Spring Dynamics) ---
  function SpringBone(options) {
    options = options || {};
    this.stiffness = options.stiffness || 180;
    this.damping = options.damping || 12;
    this.mass = options.mass || 1.0;
    this.length = options.length || 50;
    this.angle = options.restAngle || 0;
    this.vel = 0;
    this.curAngle = this.angle;
  }

  SpringBone.prototype.update = function (dt, externalForceAngle) {
    dt = Math.max(0.001, Math.min(0.05, dt || 0.016));
    var force = 0;
    if (externalForceAngle != null) {
      force = (externalForceAngle - this.curAngle) * 50.0;
    }
    var delta = this.curAngle - this.angle;
    var springForce = -this.stiffness * delta;
    var dampingForce = -this.damping * this.vel;
    var accel = (springForce + dampingForce + force) / this.mass;

    this.vel += accel * dt;
    this.curAngle += this.vel * dt;

    return this.curAngle;
  };

  SpringBone.prototype.getTip = function (rootX, rootY) {
    return [
      rootX + Math.sin(this.curAngle) * this.length,
      rootY + Math.cos(this.curAngle) * this.length
    ];
  };

  // --- 5. 2D Affine Transform Utilities ---
  function affineMultiply(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  function affineInvert(m) {
    var a = m[0], b = m[1], c = m[2], d = m[3], tx = m[4], ty = m[5];
    var det = a * d - b * c;
    if (Math.abs(det) < 1e-8) return [1, 0, 0, 1, 0, 0];
    var invDet = 1.0 / det;
    return [
      d * invDet,
      -b * invDet,
      -c * invDet,
      a * invDet,
      (c * ty - d * tx) * invDet,
      (b * tx - a * ty) * invDet
    ];
  }

  function affineApply(m, x, y) {
    return [
      m[0] * x + m[2] * y + m[4],
      m[1] * x + m[3] * y + m[5]
    ];
  }

  // --- 6. Sovereign Hierarchical Puppet Bone ---
  function PuppetBone(name, options) {
    options = options || {};
    this.name = name;
    this.parent = null;
    this.children = [];
    this.x = options.x || 0;
    this.y = options.y || 0;
    this.rotation = options.rotation || 0; // radians
    this.scaleX = options.scaleX != null ? options.scaleX : 1.0;
    this.scaleY = options.scaleY != null ? options.scaleY : 1.0;
    this.length = options.length || 50;

    this.bindPose = {
      x: this.x,
      y: this.y,
      rotation: this.rotation,
      scaleX: this.scaleX,
      scaleY: this.scaleY
    };

    this.worldTransform = [1, 0, 0, 1, 0, 0];
    this.bindWorldTransform = [1, 0, 0, 1, 0, 0];
    this.invBindWorldTransform = [1, 0, 0, 1, 0, 0];
  }

  PuppetBone.prototype.addChild = function (child) {
    child.parent = this;
    if (this.children.indexOf(child) === -1) {
      this.children.push(child);
    }
  };

  PuppetBone.prototype.updateLocalTransform = function () {
    var cos = Math.cos(this.rotation);
    var sin = Math.sin(this.rotation);
    return [
      cos * this.scaleX,
      sin * this.scaleX,
      -sin * this.scaleY,
      cos * this.scaleY,
      this.x,
      this.y
    ];
  };

  PuppetBone.prototype.updateWorldTransform = function (parentWorld) {
    var local = this.updateLocalTransform();
    if (parentWorld) {
      this.worldTransform = affineMultiply(parentWorld, local);
    } else {
      this.worldTransform = local;
    }
    for (var i = 0; i < this.children.length; i++) {
      this.children[i].updateWorldTransform(this.worldTransform);
    }
  };

  PuppetBone.prototype.setBindPose = function () {
    this.updateWorldTransform(this.parent ? this.parent.worldTransform : null);
    this.bindWorldTransform = this.worldTransform.slice();
    this.invBindWorldTransform = affineInvert(this.bindWorldTransform);
    for (var i = 0; i < this.children.length; i++) {
      this.children[i].setBindPose();
    }
  };

  PuppetBone.prototype.getWorldPosition = function () {
    return [this.worldTransform[4], this.worldTransform[5]];
  };

  PuppetBone.prototype.getWorldTip = function () {
    return affineApply(this.worldTransform, this.length, 0);
  };

  // --- 7. Weighted Skinned Mesh ---
  function PuppetSkinnedMesh(options) {
    options = options || {};
    this.vertices = options.vertices || [];   // [[x, y], ...]
    this.uvs = options.uvs || [];             // [[u, v], ...] (0..1 or pixel coords)
    this.triangles = options.triangles || []; // [[i0, i1, i2], ...]
    this.weights = options.weights || [];     // [ [ [boneIndexOrName, weight], ... ], ... ]
    this.deformedVertices = [];
    this.image = options.image || null;
    this.rigid = !!options.rigid;               // a cut-out part: drawn as one piece (see render)
    this.name = options.name || null;
    this.bones = [];
  }

  PuppetSkinnedMesh.prototype.setBones = function (bonesList) {
    this.bones = bonesList;
  };

  PuppetSkinnedMesh.prototype.updateSkinning = function () {
    this.deformedVertices = [];
    for (var i = 0; i < this.vertices.length; i++) {
      var v0 = this.vertices[i];
      var wList = this.weights[i];
      if (!wList || wList.length === 0) {
        this.deformedVertices.push([v0[0], v0[1]]);
        continue;
      }

      var finalX = 0, finalY = 0, totalW = 0;
      for (var j = 0; j < wList.length; j++) {
        var boneRef = wList[j][0];
        var weight = wList[j][1];
        var bone = null;
        if (typeof boneRef === 'number') {
          bone = this.bones[boneRef];
        } else {
          for (var b = 0; b < this.bones.length; b++) {
            if (this.bones[b].name === boneRef) {
              bone = this.bones[b];
              break;
            }
          }
        }
        if (!bone) continue;

        var localPos = affineApply(bone.invBindWorldTransform, v0[0], v0[1]);
        var skinnedPos = affineApply(bone.worldTransform, localPos[0], localPos[1]);

        finalX += skinnedPos[0] * weight;
        finalY += skinnedPos[1] * weight;
        totalW += weight;
      }

      if (totalW > 0) {
        this.deformedVertices.push([finalX / totalW, finalY / totalW]);
      } else {
        this.deformedVertices.push([v0[0], v0[1]]);
      }
    }
  };

  PuppetSkinnedMesh.prototype.render = function (ctx) {
    if (!this.image || !this.image.complete || this.image.naturalWidth === 0 || this.deformedVertices.length === 0) return;
    var img = this.image;
    var imgW = img.width || img.naturalWidth || 1;
    var imgH = img.height || img.naturalHeight || 1;

    /* RIGID PART (2026-09-25): a cut-out part bound 100% to one bone moves as ONE affine
       piece, so draw it as one piece - one transform, clipped once to its outline. Per
       triangle, every shared edge is clipped twice with anti-aliasing and leaves a hairline
       seam across the part (visible on Alice's deformed mesh, and it would stripe every
       limb of a silhouette hero). The outline sits in the part's transparent padding, so
       its own clip edge is invisible. */
    if (this.rigid && this.triangles.length) {
      var q0 = this.triangles[0], P = this.deformedVertices, T = this.uvs;
      var a0 = P[q0[0]], a1 = P[q0[1]], a2 = P[q0[2]];
      if (a0 && a1 && a2) {
        var U = function (k) { return T[k][0] * (T[k][0] <= 1.01 ? imgW : 1); };
        var V = function (k) { return T[k][1] * (T[k][1] <= 1.01 ? imgH : 1); };
        var s0 = U(q0[0]), t0 = V(q0[0]), s1 = U(q0[1]), t1 = V(q0[1]), s2 = U(q0[2]), t2 = V(q0[2]);
        var dn = s0 * (t1 - t2) + s1 * (t2 - t0) + s2 * (t0 - t1);
        if (Math.abs(dn) > 1e-5) {
          ctx.save();
          ctx.beginPath();
          for (var k = 0; k < P.length; k++) { if (k) ctx.lineTo(P[k][0], P[k][1]); else ctx.moveTo(P[k][0], P[k][1]); }
          ctx.closePath();
          ctx.clip();
          ctx.transform(
            (a0[0] * (t1 - t2) + a1[0] * (t2 - t0) + a2[0] * (t0 - t1)) / dn,
            (a0[1] * (t1 - t2) + a1[1] * (t2 - t0) + a2[1] * (t0 - t1)) / dn,
            (a0[0] * (s2 - s1) + a1[0] * (s0 - s2) + a2[0] * (s1 - s0)) / dn,
            (a0[1] * (s2 - s1) + a1[1] * (s0 - s2) + a2[1] * (s1 - s0)) / dn,
            (a0[0] * (s1 * t2 - s2 * t1) + a1[0] * (s2 * t0 - s0 * t2) + a2[0] * (s0 * t1 - s1 * t0)) / dn,
            (a0[1] * (s1 * t2 - s2 * t1) + a1[1] * (s2 * t0 - s0 * t2) + a2[1] * (s0 * t1 - s1 * t0)) / dn);
          ctx.drawImage(img, 0, 0);
          ctx.restore();
        }
      }
      return;
    }

    for (var t = 0; t < this.triangles.length; t++) {
      var tri = this.triangles[t];
      var i0 = tri[0], i1 = tri[1], i2 = tri[2];

      var p0 = this.deformedVertices[i0];
      var p1 = this.deformedVertices[i1];
      var p2 = this.deformedVertices[i2];
      if (!p0 || !p1 || !p2) continue;

      var u0 = this.uvs[i0][0] * (this.uvs[i0][0] <= 1.01 ? imgW : 1);
      var v0 = this.uvs[i0][1] * (this.uvs[i0][1] <= 1.01 ? imgH : 1);
      var u1 = this.uvs[i1][0] * (this.uvs[i1][0] <= 1.01 ? imgW : 1);
      var v1 = this.uvs[i1][1] * (this.uvs[i1][1] <= 1.01 ? imgH : 1);
      var u2 = this.uvs[i2][0] * (this.uvs[i2][0] <= 1.01 ? imgW : 1);
      var v2 = this.uvs[i2][1] * (this.uvs[i2][1] <= 1.01 ? imgH : 1);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.closePath();
      ctx.clip();

      var denom = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
      if (Math.abs(denom) > 1e-5) {
        var x0 = p0[0], y0 = p0[1];
        var x1 = p1[0], y1 = p1[1];
        var x2 = p2[0], y2 = p2[1];

        var a = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / denom;
        var b = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / denom;
        var c = (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) / denom;
        var d = (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) / denom;
        var tx = (x0 * (u1 * v2 - u2 * v1) + x1 * (u2 * v0 - u0 * v2) + x2 * (u0 * v1 - u1 * v0)) / denom;
        var ty = (y0 * (u1 * v2 - u2 * v1) + y1 * (u2 * v0 - u0 * v2) + y2 * (u0 * v1 - u1 * v0)) / denom;

        ctx.transform(a, b, c, d, tx, ty);
        ctx.drawImage(img, 0, 0);
      }
      ctx.restore();
    }
  };

  // --- 8. Autonomous Procedural Life & Constraints ---
  function AimConstraint(bone, options) {
    this.bone = bone;
    options = options || {};
    this.maxAngle = options.maxAngle || (Math.PI / 4); // 45 deg limit
    this.weight = options.weight != null ? options.weight : 0.8;
    this.smoothing = options.smoothing || 0.15;
    this.curOffset = 0;
  }

  AimConstraint.prototype.update = function (targetX, targetY) {
    if (!this.bone) return;
    var bPos = this.bone.getWorldPosition();
    var dx = targetX - bPos[0];
    var dy = targetY - bPos[1];
    var targetAngle = Math.atan2(dy, dx);

    var parentAngle = 0;
    if (this.bone.parent) {
      parentAngle = Math.atan2(this.bone.parent.worldTransform[1], this.bone.parent.worldTransform[0]);
    }
    var desiredLocal = targetAngle - parentAngle;
    while (desiredLocal > Math.PI) desiredLocal -= 2 * Math.PI;
    while (desiredLocal < -Math.PI) desiredLocal += 2 * Math.PI;

    var clamped = Math.max(-this.maxAngle, Math.min(this.maxAngle, desiredLocal * this.weight));
    this.curOffset += (clamped - this.curOffset) * this.smoothing;
    this.bone.rotation = this.bone.bindPose.rotation + this.curOffset;
  };

  function ProceduralBreath(chestBone, spineBone, options) {
    this.chestBone = chestBone;
    this.spineBone = spineBone;
    options = options || {};
    this.rate = options.rate || 2.4; // seconds per cycle
    this.scaleAmount = options.scaleAmount || 0.035;
    this.swayAmount = options.swayAmount || 0.02; // radians
  }

  ProceduralBreath.prototype.update = function (timeSec) {
    var phase = (timeSec * 2 * Math.PI) / this.rate;
    var breath = Math.sin(phase);
    if (this.chestBone) {
      this.chestBone.scaleX = this.chestBone.bindPose.scaleX + breath * this.scaleAmount;
      this.chestBone.scaleY = this.chestBone.bindPose.scaleY + breath * (this.scaleAmount * 0.7);
    }
    if (this.spineBone) {
      this.spineBone.rotation = this.spineBone.bindPose.rotation + Math.cos(phase * 0.5) * this.swayAmount;
    }
  };

  // --- 9. Keyframed 2D Skeletal Animation (Spine-Grade Timeline) ---
  function interpolateTimeline(frames, time, loopDuration) {
    if (!frames || frames.length === 0) return null;
    if (frames.length === 1) return frames[0].value;

    var t = time;
    if (loopDuration && loopDuration > 0) {
      t = t % loopDuration;
      if (t < 0) t += loopDuration;
    }

    // Before first keyframe
    if (t <= frames[0].time) return frames[0].value;
    // After last keyframe
    if (t >= frames[frames.length - 1].time) return frames[frames.length - 1].value;

    // Binary search or linear scan for segment
    for (var i = 0; i < frames.length - 1; i++) {
      var f0 = frames[i];
      var f1 = frames[i + 1];
      if (t >= f0.time && t <= f1.time) {
        var span = f1.time - f0.time;
        var progress = span > 0 ? (t - f0.time) / span : 0;
        
        var curve = f0.curve || 'smooth';
        if (curve === 'step') {
          return f0.value;
        } else if (curve === 'linear') {
          return f0.value + (f1.value - f0.value) * progress;
        } else {
          // Smooth cosine ease-in-out
          var ease = 0.5 * (1 - Math.cos(progress * Math.PI));
          return f0.value + (f1.value - f0.value) * ease;
        }
      }
    }
    return frames[frames.length - 1].value;
  }

  function PuppetAnimation(name, definition) {
    this.name = name;
    this.duration = definition.duration || 1.0;
    this.loop = definition.loop !== false;
    this.bones = definition.bones || {}; // { boneName: { rotation: [...], x: [...], y: [...] } }
    this.events = definition.events || []; // [ { time: 0.5, name: 'step' }, ... ]
  }

  PuppetAnimation.prototype.evaluate = function (time, targetPose) {
    targetPose = targetPose || {};
    var dur = this.duration;
    for (var boneName in this.bones) {
      if (!this.bones.hasOwnProperty(boneName)) continue;
      var track = this.bones[boneName];
      if (!targetPose[boneName]) {
        targetPose[boneName] = {};
      }
      if (track.rotation) {
        targetPose[boneName].rotation = interpolateTimeline(track.rotation, time, dur);
      }
      if (track.x) {
        targetPose[boneName].x = interpolateTimeline(track.x, time, dur);
      }
      if (track.y) {
        targetPose[boneName].y = interpolateTimeline(track.y, time, dur);
      }
      if (track.scaleX) {
        targetPose[boneName].scaleX = interpolateTimeline(track.scaleX, time, dur);
      }
      if (track.scaleY) {
        targetPose[boneName].scaleY = interpolateTimeline(track.scaleY, time, dur);
      }
    }
    return targetPose;
  };

  function AnimationPlayer(rig) {
    this.rig = rig;
    this.animations = {};
    this.currentClip = null;
    this.time = 0.0;
    this.speed = 1.0;
    this.isPlaying = true;
    this.crossFadeTarget = null;
    this.crossFadeDuration = 0.0;
    this.crossFadeElapsed = 0.0;
    this.eventListeners = [];
  }

  AnimationPlayer.prototype.addAnimation = function (clip) {
    this.animations[clip.name] = clip;
    if (!this.currentClip) {
      this.currentClip = clip;
    }
  };

  AnimationPlayer.prototype.getActiveClipName = function () {
    return this.crossFadeTarget ? this.crossFadeTarget.name : (this.currentClip ? this.currentClip.name : 'none');
  };

  AnimationPlayer.prototype.play = function (clipName, blendDuration) {
    var target = this.animations[clipName];
    if (!target) return;
    if (this.currentClip === target && !this.crossFadeTarget) return;

    if (blendDuration && blendDuration > 0 && this.currentClip) {
      this.crossFadeTarget = target;
      this.crossFadeDuration = blendDuration;
      this.crossFadeElapsed = 0.0;
    } else {
      this.currentClip = target;
      this.crossFadeTarget = null;
      this.time = 0.0;
    }
    this.isPlaying = true;
  };

  AnimationPlayer.prototype.update = function (dt) {
    if (!this.isPlaying || !this.currentClip) return;
    var step = dt * this.speed;
    this.time += step;

    var pose = this.currentClip.evaluate(this.time);

    // Check crossfade blend
    if (this.crossFadeTarget) {
      this.crossFadeElapsed += dt;
      var alpha = Math.min(1.0, this.crossFadeElapsed / this.crossFadeDuration);
      var targetPose = this.crossFadeTarget.evaluate(this.crossFadeElapsed);

      for (var boneName in targetPose) {
        if (!targetPose.hasOwnProperty(boneName)) continue;
        if (!pose[boneName]) pose[boneName] = {};
        for (var prop in targetPose[boneName]) {
          if (!targetPose[boneName].hasOwnProperty(prop)) continue;
          var v0 = pose[boneName][prop] != null ? pose[boneName][prop] : (this.rig.bonesByName[boneName] ? this.rig.bonesByName[boneName].bindPose[prop] : 0);
          var v1 = targetPose[boneName][prop];
          pose[boneName][prop] = v0 + (v1 - v0) * alpha;
        }
      }

      if (alpha >= 1.0) {
        this.currentClip = this.crossFadeTarget;
        this.time = this.crossFadeElapsed;
        this.crossFadeTarget = null;
      }
    }

    // Apply evaluated pose onto rig bones
    for (var bName in pose) {
      if (!pose.hasOwnProperty(bName)) continue;
      var b = this.rig.bonesByName[bName];
      if (!b) continue;
      var p = pose[bName];
      if (p.rotation != null) b.rotation = b.bindPose.rotation + p.rotation;
      if (p.x != null) b.x = b.bindPose.x + p.x;
      if (p.y != null) b.y = b.bindPose.y + p.y;
      if (p.scaleX != null) b.scaleX = b.bindPose.scaleX * p.scaleX;
      if (p.scaleY != null) b.scaleY = b.bindPose.scaleY * p.scaleY;
    }
  };

  // --- 10. Complete Sovereign Puppet Rig ---
  function PuppetRig(definition) {
    definition = definition || {};
    this.name = definition.name || 'Sovereign Rig';
    this.bones = [];
    this.bonesByName = {};
    this.rootBone = null;
    this.meshes = [];
    this.springs = [];
    this.aimControllers = [];
    this.breathing = null;
    this.animPlayer = new AnimationPlayer(this);
    this.sockets = {};

    if (definition.bones) this._buildBones(definition.bones);
    if (definition.mesh || definition.meshes) this._buildMesh(definition.mesh || definition.meshes);
    if (definition.animations) this._buildAnimations(definition.animations);
    if (definition.aim) this._buildAim(definition.aim);
    if (definition.breathing) this._buildBreathing(definition.breathing);
  }

  PuppetRig.prototype._buildBones = function (bonesDef) {
    for (var i = 0; i < bonesDef.length; i++) {
      var bd = bonesDef[i];
      var bone = new PuppetBone(bd.name, bd);
      this.bones.push(bone);
      this.bonesByName[bd.name] = bone;
    }
    for (var i = 0; i < bonesDef.length; i++) {
      var bd = bonesDef[i];
      if (bd.parent && this.bonesByName[bd.parent]) {
        this.bonesByName[bd.parent].addChild(this.bonesByName[bd.name]);
      } else if (!this.rootBone) {
        this.rootBone = this.bonesByName[bd.name];
      }
    }
    if (this.rootBone) {
      this.rootBone.setBindPose();
    }
  };

  PuppetRig.prototype._buildMesh = function (meshDef) {
    var meshList = Array.isArray(meshDef) ? meshDef : [meshDef];
    for (var i = 0; i < meshList.length; i++) {
      var mesh = new PuppetSkinnedMesh(meshList[i]);
      mesh.setBones(this.bones);
      this.meshes.push(mesh);
    }
  };

  PuppetRig.prototype._buildAnimations = function (animsDef) {
    for (var key in animsDef) {
      if (!animsDef.hasOwnProperty(key)) continue;
      var clip = new PuppetAnimation(key, animsDef[key]);
      this.animPlayer.addAnimation(clip);
    }
  };

  PuppetRig.prototype._buildAim = function (aimDef) {
    var list = Array.isArray(aimDef) ? aimDef : [aimDef];
    for (var i = 0; i < list.length; i++) {
      var targetBone = this.bonesByName[list[i].bone];
      if (targetBone) {
        this.aimControllers.push(new AimConstraint(targetBone, list[i]));
      }
    }
  };

  PuppetRig.prototype._buildBreathing = function (breathDef) {
    var chest = this.bonesByName[breathDef.chestBone || 'chest'];
    var spine = this.bonesByName[breathDef.spineBone || 'spine'];
    this.breathing = new ProceduralBreath(chest, spine, breathDef);
  };

  PuppetRig.prototype.attachSocket = function (boneName, spec) {
    if (!spec) return null;
    var bone = this.bonesByName[boneName];
    if (!bone) {
      console.warn('[PuppetRig] attachSocket: bone "' + boneName + '" not found');
      return null;
    }
    var sock = {
      id: spec.id || ('sock_' + boneName),
      boneName: boneName,
      bone: bone,
      kind: spec.kind || 'custom',
      canvas: spec.canvas || null,
      image: spec.image || null,
      avatar: spec.avatar || null,
      ox: spec.ox || 0,
      oy: spec.oy || 0,
      scale: spec.scale != null ? spec.scale : 1.0,
      rotation: spec.rotation || 0,
      w: spec.w || (spec.canvas ? spec.canvas.width : 512),
      h: spec.h || (spec.canvas ? spec.canvas.height : 512),
      autoSyncHead: spec.autoSyncHead !== false,
      onUpdate: spec.onUpdate || null
    };
    this.sockets[sock.id] = sock;
    return sock;
  };

  PuppetRig.prototype.detachSocket = function (idOrBone) {
    if (this.sockets[idOrBone]) {
      delete this.sockets[idOrBone];
      return true;
    }
    for (var k in this.sockets) {
      if (this.sockets[k].boneName === idOrBone) {
        delete this.sockets[k];
        return true;
      }
    }
    return false;
  };

  PuppetRig.prototype.getSocket = function (idOrBone) {
    if (this.sockets[idOrBone]) return this.sockets[idOrBone];
    for (var k in this.sockets) {
      if (this.sockets[k].boneName === idOrBone) return this.sockets[k];
    }
    return null;
  };

  PuppetRig.prototype.update = function (dt, timeSec, cursorTarget) {
    // 1. Keyframe Animation Timeline Evaluation
    if (this.animPlayer) {
      this.animPlayer.update(dt || 0.016);
    }

    // 2. Procedural Sinusoidal Breath
    if (this.breathing) {
      this.breathing.update(timeSec != null ? timeSec : (this.animPlayer ? this.animPlayer.time : 0));
    }

    // 3. Dynamic Cursor Aim Constraints
    if (cursorTarget && this.aimControllers.length > 0) {
      for (var i = 0; i < this.aimControllers.length; i++) {
        this.aimControllers[i].update(cursorTarget[0], cursorTarget[1]);
      }
    }

    // 4. Propagate 2x3 Affine Matrix Transforms down bone hierarchy
    if (this.rootBone) {
      this.rootBone.updateWorldTransform();
    }

    // 5. Deform weighted mesh vertices
    for (var m = 0; m < this.meshes.length; m++) {
      this.meshes[m].updateSkinning();
    }

    // 6. Update attached sockets (e.g. Mesh Avatar expressions, gaze tracking, head roll)
    for (var sId in this.sockets) {
      var sock = this.sockets[sId];
      var bone = this.bonesByName[sock.boneName];
      if (!bone) continue;
      if (typeof sock.onUpdate === 'function') {
        sock.onUpdate(bone, dt, cursorTarget);
      } else if (sock.kind === 'mesh_avatar' && sock.avatar) {
        var wt = bone.worldTransform;
        var boneAngle = Math.atan2(wt[1], wt[0]);
        if (sock.autoSyncHead) {
          var rollDeg = -boneAngle * 180 / Math.PI;
          var gazeX = 0, gazeY = 0;
          if (cursorTarget) {
            var bPos = bone.getWorldPosition();
            var dx = cursorTarget[0] - bPos[0];
            var dy = cursorTarget[1] - bPos[1];
            var dLen = Math.hypot(dx, dy) || 1;
            gazeX = Math.max(-1, Math.min(1, (dx / dLen) * 1.5));
            gazeY = Math.max(-1, Math.min(1, (-dy / dLen) * 1.5));
          }
          if (typeof sock.avatar.setParameters === 'function') {
            sock.avatar.setParameters({
              roll: rollDeg * 0.5,
              gazeX: gazeX,
              gazeY: gazeY
            }, 0.85);
          }
        }
      }
    }
  };

  /* SEEK: pose the rig at EXACTLY time t of one clip, then skin it (2026-09-25, for the
     sprite-sheet baker). update(dt) cannot do this - it accumulates dt into the player's
     clock, so frame k of a bake would carry k rounding errors and depend on what ran before.
     Every bone returns to its bind pose first: a bone the clip does not key must not keep
     the previous frame's value. A non-looping clip holds its last pose at t >= duration
     (evaluate() always wraps, so t == duration would otherwise snap back to frame 0).
     Breathing is off unless asked: it OVERWRITES the spine's rotation, which would hide the
     clip's own spine keys, and a bake should contain the clip and nothing else. */
  PuppetRig.prototype.poseAt = function (clipName, t, opts) {
    var clip = this.animPlayer.animations[clipName];
    if (!clip) throw new Error('poseAt: no clip "' + clipName + '"');
    for (var i = 0; i < this.bones.length; i++) {
      var b = this.bones[i], bp = b.bindPose;
      b.x = bp.x; b.y = bp.y; b.rotation = bp.rotation; b.scaleX = bp.scaleX; b.scaleY = bp.scaleY;
    }
    var dur = clip.duration;
    var tt = clip.loop ? t : Math.max(0, Math.min(t, dur - 1e-6));
    var pose = clip.evaluate(tt, {});
    for (var bName in pose) {
      if (!pose.hasOwnProperty(bName)) continue;
      var bone = this.bonesByName[bName];
      if (!bone) continue;
      var p = pose[bName];
      if (p.rotation != null) bone.rotation = bone.bindPose.rotation + p.rotation;
      if (p.x != null) bone.x = bone.bindPose.x + p.x;
      if (p.y != null) bone.y = bone.bindPose.y + p.y;
      if (p.scaleX != null) bone.scaleX = bone.bindPose.scaleX * p.scaleX;
      if (p.scaleY != null) bone.scaleY = bone.bindPose.scaleY * p.scaleY;
    }
    if (opts && opts.breathing && this.breathing) this.breathing.update(tt);
    if (this.rootBone) this.rootBone.updateWorldTransform();
    for (var m = 0; m < this.meshes.length; m++) this.meshes[m].updateSkinning();
    return this;
  };
  /* the BIND pose, skinned - the reference a bake measures height and ground from */
  PuppetRig.prototype.poseBind = function () {
    for (var i = 0; i < this.bones.length; i++) {
      var b = this.bones[i], bp = b.bindPose;
      b.x = bp.x; b.y = bp.y; b.rotation = bp.rotation; b.scaleX = bp.scaleX; b.scaleY = bp.scaleY;
    }
    if (this.rootBone) this.rootBone.updateWorldTransform();
    for (var m = 0; m < this.meshes.length; m++) this.meshes[m].updateSkinning();
    return this;
  };

  PuppetRig.prototype.render = function (ctx) {
    for (var i = 0; i < this.meshes.length; i++) {
      this.meshes[i].render(ctx);
    }
    // Render attached sockets
    for (var sId in this.sockets) {
      var sock = this.sockets[sId];
      var bone = this.bonesByName[sock.boneName];
      if (!bone) continue;
      var cv = sock.canvas || sock.image;
      if (!cv || !cv.width || !cv.height) continue;
      var wt = bone.worldTransform;
      ctx.save();
      ctx.transform(wt[0], wt[1], wt[2], wt[3], wt[4], wt[5]);
      if (sock.ox || sock.oy) ctx.translate(sock.ox, sock.oy);
      if (sock.rotation) ctx.rotate(sock.rotation);
      if (sock.scale != null && sock.scale !== 1.0) ctx.scale(sock.scale, sock.scale);
      var sw = sock.w || cv.width, sh = sock.h || cv.height;
      ctx.drawImage(cv, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }
  };

  // --- 11. Spine-Standard Visual Rig & Weight Debugger ---
  PuppetRig.prototype.renderDebug = function (ctx, options) {
    options = options || {};
    var drawBones = options.drawBones !== false;
    var drawMesh = options.drawMesh !== false;
    var drawWeights = options.drawWeights === true;

    // 1. Draw Mesh Wireframe & Triangles
    if (drawMesh) {
      for (var m = 0; m < this.meshes.length; m++) {
        var mesh = this.meshes[m];
        if (!mesh.deformedVertices || mesh.deformedVertices.length === 0) continue;

        ctx.save();
        ctx.strokeStyle = options.meshColor || 'rgba(0, 240, 255, 0.35)';
        ctx.fillStyle = 'rgba(0, 240, 255, 0.04)';
        ctx.lineWidth = 1;

        for (var t = 0; t < mesh.triangles.length; t++) {
          var tri = mesh.triangles[t];
          var p0 = mesh.deformedVertices[tri[0]];
          var p1 = mesh.deformedVertices[tri[1]];
          var p2 = mesh.deformedVertices[tri[2]];
          if (!p0 || !p1 || !p2) continue;

          ctx.beginPath();
          ctx.moveTo(p0[0], p0[1]);
          ctx.lineTo(p1[0], p1[1]);
          ctx.lineTo(p2[0], p2[1]);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        // Draw Vertex Points
        for (var v = 0; v < mesh.deformedVertices.length; v++) {
          var pt = mesh.deformedVertices[v];
          ctx.fillStyle = drawWeights ? 'rgba(255, 180, 84, 0.85)' : 'rgba(0, 240, 255, 0.7)';
          ctx.beginPath();
          ctx.arc(pt[0], pt[1], 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // 2. Draw Spine-Style Articulated Kinematic Diamonds
    if (drawBones) {
      ctx.save();

      function getBoneTheme(name) {
        if (name.indexOf('arm_l') !== -1 || name.indexOf('hand_l') !== -1) {
          return {
            light: 'rgba(0, 240, 255, 0.40)',
            dark: 'rgba(0, 160, 200, 0.40)',
            border: 'rgba(140, 255, 255, 0.95)',
            pin: '#00f0ff'
          };
        }
        if (name.indexOf('leg_l') !== -1) {
          return {
            light: 'rgba(0, 200, 255, 0.38)',
            dark: 'rgba(0, 130, 180, 0.38)',
            border: 'rgba(100, 220, 255, 0.95)',
            pin: '#33ccff'
          };
        }
        if (name.indexOf('arm_r') !== -1 || name.indexOf('hand_r') !== -1) {
          return {
            light: 'rgba(255, 140, 0, 0.42)',
            dark: 'rgba(190, 80, 0, 0.42)',
            border: 'rgba(255, 190, 80, 0.95)',
            pin: '#ff9900'
          };
        }
        if (name.indexOf('leg_r') !== -1) {
          return {
            light: 'rgba(255, 110, 0, 0.38)',
            dark: 'rgba(180, 60, 0, 0.38)',
            border: 'rgba(255, 160, 60, 0.95)',
            pin: '#ff7700'
          };
        }
        if (name.indexOf('skirt') !== -1) {
          return {
            light: 'rgba(180, 130, 255, 0.32)',
            dark: 'rgba(120, 70, 200, 0.32)',
            border: 'rgba(210, 170, 255, 0.90)',
            pin: '#c299ff'
          };
        }
        // Core / Spine / Pelvis / Neck / Head (Sovereign Amber Gold)
        return {
          light: 'rgba(229, 169, 59, 0.42)',
          dark: 'rgba(175, 115, 20, 0.42)',
          border: 'rgba(255, 220, 110, 0.95)',
          pin: '#ffb454'
        };
      }

      function drawSpineDiamond(ctx, p1, p2, boneName) {
        var dx = p2[0] - p1[0];
        var dy = p2[1] - p1[1];
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 3) return;

        var angle = Math.atan2(dy, dx);
        var width = Math.min(15, Math.max(5, len * 0.18));
        var theme = getBoneTheme(boneName);

        ctx.save();
        ctx.translate(p1[0], p1[1]);
        ctx.rotate(angle);

        var wingX = len * 0.22;

        // Facet 1: Top facet (light)
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(wingX, -width);
        ctx.lineTo(len, 0);
        ctx.closePath();
        ctx.fillStyle = theme.light;
        ctx.fill();

        // Facet 2: Bottom facet (dark)
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(wingX, width);
        ctx.lineTo(len, 0);
        ctx.closePath();
        ctx.fillStyle = theme.dark;
        ctx.fill();

        // Perimeter border
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(wingX, -width);
        ctx.lineTo(len, 0);
        ctx.lineTo(wingX, width);
        ctx.closePath();
        ctx.strokeStyle = theme.border;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Neon Marrow Center Line
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(len, 0);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Joint Pivot Rings at root (0, 0)
        ctx.strokeStyle = theme.border;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, Math.PI * 2);
        ctx.fill();

        // Tip Pin Dot
        ctx.fillStyle = theme.pin;
        ctx.beginPath();
        ctx.arc(len, 0, 3, 0, Math.PI * 2);
        ctx.fill();

        // Sleek Monospace Bone Label Tag
        ctx.save();
        ctx.font = "8px 'JetBrains Mono', monospace";
        ctx.fillStyle = 'rgba(226, 232, 240, 0.70)';
        ctx.fillText(boneName, wingX - 4, -width - 4);
        ctx.restore();

        ctx.restore();
      }

      for (var b = 0; b < this.bones.length; b++) {
        var bone = this.bones[b];
        var rootPos = bone.getWorldPosition();

        if (bone.children && bone.children.length > 0) {
          for (var c = 0; c < bone.children.length; c++) {
            var child = bone.children[c];
            var childPos = child.getWorldPosition();
            drawSpineDiamond(ctx, rootPos, childPos, bone.name);
          }
        } else {
          // Leaf bone (head, hands, lower legs, skirt)
          var tipPos = null;
          if (bone.parent) {
            var parentPos = bone.parent.getWorldPosition();
            var dx = rootPos[0] - parentPos[0];
            var dy = rootPos[1] - parentPos[1];
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 1) {
              tipPos = [
                rootPos[0] + (dx / dist) * bone.length,
                rootPos[1] + (dy / dist) * bone.length
              ];
            }
          }
          if (!tipPos) {
            tipPos = bone.getWorldTip();
          }
          drawSpineDiamond(ctx, rootPos, tipPos, bone.name);
        }
      }
      ctx.restore();
    }
  };

  // Static Factory Deserializer
  PuppetRig.fromJSON = function (spec, imageElement) {
    if (typeof spec === 'string') {
      spec = JSON.parse(spec);
    }
    var rig = new PuppetRig(spec);
    if (imageElement && rig.meshes.length > 0) {
      for (var i = 0; i < rig.meshes.length; i++) {
        rig.meshes[i].image = imageElement;
      }
    }
    return rig;
  };

  return {
    solve2BoneIK: solve2BoneIK,
    PuppetSkeleton: PuppetSkeleton,
    PuppetMeshDeformer: PuppetMeshDeformer,
    SpringBone: SpringBone,
    DEFAULT_STAND: DEFAULT_STAND,
    affineMultiply: affineMultiply,
    affineInvert: affineInvert,
    affineApply: affineApply,
    PuppetBone: PuppetBone,
    PuppetSkinnedMesh: PuppetSkinnedMesh,
    AimConstraint: AimConstraint,
    ProceduralBreath: ProceduralBreath,
    PuppetAnimation: PuppetAnimation,
    AnimationPlayer: AnimationPlayer,
    PuppetRig: PuppetRig,
    version: '2.0.0-sovereign'
  };
}));

