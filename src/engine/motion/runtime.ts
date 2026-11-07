// The clock of a motion page (docs/ENGINE-SPEC.md §25): one small script every template page carries. A frame is a pure function of
// the time `t` the host gives to `window.atelierRenderAt(t)`: no CSS animation clock, no timer, no network, so the same `t` always
// gives the same picture and a frame can be photographed at any moment, in any order. Elements say what they do with data attributes:
//   data-anim="fade|rise|pop|left|right|grow|growy|wipe|drop|blur|blurleft|blurright|reveal"  data-at=<s> data-dur=<s> data-out=<s>
//                                                               data-out-dur=<s> data-dx data-dy data-blur=<px> data-ease=out|inOut|linear
//   data-zoom (+ data-at data-dur data-z0 data-z1 data-ease)    a slow push in (or out) on a picture: its scale goes from z0 to z1
//   data-move="x0,y0,x1,y1" (+ data-at data-dur data-click=<s>) a pointer that travels (pixels, eased) and dips when it clicks
//   data-count (+ data-from data-to data-dec data-at data-dur)   a number that counts up, written in French (12 000, 3,5)
//   data-cam="x0 y0 w0 x1 y1 w1" (+ data-pw data-ph data-at data-dur data-ease)   the map camera, on ONE element: the view goes from the world box
//                                                               (x0,y0,w0) to (x1,y1,w1), world pixels, the page's own aspect. Then [data-cl] layers are
//                                                               moved and scaled by it, [data-sw=<px>] strokes keep that width on screen, [data-cp="x y"]
//                                                               elements ride the world point (no scale: text stays sharp) and [data-cpath="x0 y0 x1 y1 …"]
//                                                               ones travel along a polyline by arc length (like a data-draw path of the same points: a
//                                                               route's head rides its drawn end), from data-at over data-dur (hidden before)
//   data-draw (+ data-at data-dur data-ease)                    a path (pathLength=1, stroke-dasharray 1 1) that is drawn from its start to its end
//   data-typing (+ data-from data-to)                           three bouncing dots, shown between the two times
//   data-scroll (+ data-pad), children data-row-at=<s>          a list that scrolls up to keep its latest row in view
//   data-pulse (+ data-at data-period)                          a ring that grows and fades again and again
//   data-anim="slam"  (+ data-dy = shake px)                    the kinetic-type hit: lands from 1.6x with a hard ease, then a short damped shake
//   data-anim="shift"  (+ data-dy signed, data-at data-dur)     an element that is always shown and moves by data-dy from data-at (lines pushed up)
//   data-around=<id> (+ data-from data-to data-shape data-seed)  on a <path> in an <svg> laid over the layer (no transform, viewBox = px): at init the
//   data-box="x y w h"                                           phrase (chars from..to of the text of #id) or the box is measured, and the path gets a
//                                                               hand-drawn mark: highlight|underline|circle|box|strike (seeded wobble). Reveal it with
//                                                               data-draw (pathLength=1, stroke-dasharray 1 1)
//   data-follow=<zoom> (+ data-pw data-ph data-wide data-lead data-dur)   a layer (full frame) whose camera flies from the wide view to
//                                                               each child [data-focus-at=<s>] (+ data-focus-z): centred on it, eased over data-dur,
//                                                               starting data-lead before its time; a data-around/data-box path is focused on its box
//   data-trace="x0,y0,x1,y1,…" (+ data-at data-dur data-ease=linear data-trace-vals="v0,v1,…" data-dec)   an element that rides a polyline by
//                                                               arc length (like a data-draw path of the same points); its [data-trace-val][data-text]
//                                                               child counts the interpolated value, written in French
//   data-fit=<min px>                                           the text is made smaller until it fits its box (width for one line, width and height for
//                                                               a text in lines), down to a floor
//   data-lines=<n> (with data-fit)                             the text is made smaller until it takes n lines at most (counted on its laid-out
//                                                               glyphs, so a tall font's ink above or below its lines does not count as overflow)
// The maths (easings, scroll, number format, the follow camera, the marks, the trace) is also exported on `window.__atelierMotion` so the tests can run it without a browser.
// Plain ES5-style JavaScript in a string: it runs as written in the page (a function's toString would carry the build's helpers).
export const RUNTIME_JS = String.raw`
(function (root) {
  var clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };
  var C1 = 1.70158, C3 = C1 + 1;
  var ease = {
    linear: function (x) { return x; },
    out: function (x) { return 1 - Math.pow(1 - x, 3); },
    sine: function (x) { return 0.5 - 0.5 * Math.cos(Math.PI * x); },
    // the archive documentary's slow print zoom (director-motion, fitted on 36J1 shots 125, 162, 244): almost nothing, a soft rise, almost nothing
    settle: function (x) { var a = Math.pow(x, 2.3), b = Math.pow(1 - x, 2.3); return a + b > 0 ? a / (a + b) : x; },
    inOut: function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; },
    back: function (x) { return 1 + C3 * Math.pow(x - 1, 3) + C1 * Math.pow(x - 1, 2); },
    bounce: function (x) {
      var n = 7.5625, d = 2.75;
      if (x < 1 / d) return n * x * x;
      if (x < 2 / d) { x -= 1.5 / d; return n * x * x + 0.75; }
      if (x < 2.5 / d) { x -= 2.25 / d; return n * x * x + 0.9375; }
      x -= 2.625 / d; return n * x * x + 0.984375;
    }
  };
  function formatNumber(v, dec) {
    var s = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
    return s.replace(/[\u202f\u00a0]/g, '\u00a0');
  }
  // rows: [{at, bottom}], viewport height, padding -> how far the list has moved up at t (a sum of eased steps: continuous, never back)
  function scrollOffset(rows, viewport, pad, t, dur) {
    var y = 0, end = 0;
    for (var i = 0; i < rows.length; i++) {
      var next = Math.max(end, rows[i].bottom + pad - viewport);
      if (t >= rows[i].at) y += (next - end) * ease.inOut(clamp((t - rows[i].at) / dur, 0, 1));
      end = next;
    }
    return y;
  }
  // the state of an element at t from its preset: opacity, translate, scale, clip and blur, with the way out folded in
  function look(preset, p, q, dx, dy, blur, curve) {
    var e = (ease[curve] || ease.out)(p), o = e, tx = 0, ty = 0, sx = 1, sy = 1, clip = '', b = 0;
    // the blur presets: the element comes out of a soft focus while it fades in (rising, or sliding from a side)
    if (preset === 'blur' || preset === 'blurleft' || preset === 'blurright' || preset === 'reveal') b = (1 - e) * (blur || 0);
    if (preset === 'rise' || preset === 'blur') ty = (1 - e) * dy;
    else if (preset === 'blurleft') tx = -(1 - e) * dx;
    else if (preset === 'blurright') tx = (1 - e) * dx;
    else if (preset === 'reveal') sx = sy = 0.82 + 0.18 * e;
    else if (preset === 'pop') { o = clamp(p * 2.5, 0, 1); sx = sy = 0.6 + 0.4 * ease.back(p); }
    else if (preset === 'left') tx = -(1 - e) * dx;
    else if (preset === 'right') tx = (1 - e) * dx;
    else if (preset === 'grow') { o = p > 0 ? 1 : 0; sx = e; }
    else if (preset === 'growy') { o = p > 0 ? 1 : 0; sy = e; }
    else if (preset === 'wipe') { o = p > 0 ? 1 : 0; clip = 'inset(0 ' + ((1 - e) * 100).toFixed(3) + '% 0 0)'; }
    else if (preset === 'drop') { o = clamp(p * 4, 0, 1); ty = -(1 - ease.bounce(p)) * dy; }
    // the kinetic hit: the scale lands from 1.6 in the first 55 % of the time (hard ease), then a damped shake of dy / 2 px
    else if (preset === 'slam') {
      var hit = clamp(p / 0.55, 0, 1), shake = p > 0.55 ? 1 - (p - 0.55) / 0.45 : 0;
      o = clamp(p * 8, 0, 1); sx = sy = 1 + 0.6 * Math.pow(1 - hit, 4);
      ty = Math.sin((p - 0.55) * 21) * dy * 0.5 * shake; tx = Math.cos((p - 0.55) * 17) * dy * 0.25 * shake;
    }
    // a layout move: always shown, moves by dy (signed) as it eases in
    else if (preset === 'shift') { o = 1; ty = e * dy; }
    if (q > 0) { o *= 1 - ease.inOut(q); ty -= ease.inOut(q) * dy * 0.25; }
    return { o: o, tx: tx, ty: ty, sx: sx, sy: sy, clip: clip, blur: b };
  }
  // a pointer's place at t (from x0,y0 to x1,y1, eased) and its scale (a short dip when it clicks)
  function pointer(path, at, dur, click, t) {
    var k = ease.inOut(clamp((t - at) / dur, 0, 1)), c = click === null ? 1 : clamp(Math.abs(t - click) / 0.12, 0, 1);
    return { x: path[0] + (path[2] - path[0]) * k, y: path[1] + (path[3] - path[1]) * k, s: 0.84 + 0.16 * c };
  }
  // the map camera at k (0..1): the scale grows geometrically, the centre goes straight; box = [x, y, w] of the world, pw/ph the page
  function camera(a, b, pw, ph, k) {
    var s0 = pw / a[2], s1 = pw / b[2], s = s0 * Math.pow(s1 / s0, k);
    var cx0 = a[0] + a[2] / 2, cy0 = a[1] + a[2] * ph / pw / 2, cx1 = b[0] + b[2] / 2, cy1 = b[1] + b[2] * ph / pw / 2;
    var cx = cx0 + (cx1 - cx0) * k, cy = cy0 + (cy1 - cy0) * k;
    return { s: s, cx: cx, cy: cy, tx: pw / 2 - cx * s, ty: ph / 2 - cy * s };
  }

  // the follow camera: foci [{at, x, y, z?}] sorted by time (layer pixels), o = {lw, lh (layer), pw, ph (frame), wide, zoom, lead, dur}. The view
  // starts wide (scale o.wide, the layer centred), flies to each focus from lead seconds before its time over dur seconds (centre and scale eased), and
  // holds. A flight that starts before the previous one ends starts from where the camera is. The layer never shows what is past its edges.
  function followCam(foci, o, t) {
    var wide = { cx: o.lw / 2, cy: o.lh / 2, s: o.wide }, starts = [], i;
    var mix = function (a, f, k) { var z = f.z || o.zoom; return { cx: a.cx + (f.x - a.cx) * k, cy: a.cy + (f.y - a.cy) * k, s: a.s + (z - a.s) * k }; };
    var chain = function (n, time) {
      var cur = wide;
      for (var j = 0; j < n; j++) {
        var t0 = foci[j].at - o.lead;
        if (time <= t0) break;
        cur = mix(starts[j], foci[j], ease.inOut(clamp((time - t0) / o.dur, 0, 1)));
      }
      return cur;
    };
    for (i = 0; i < foci.length; i++) starts.push(chain(i, foci[i].at - o.lead));
    var st = chain(foci.length, t), tx = o.pw / 2 - st.cx * st.s, ty = o.ph / 2 - st.cy * st.s;
    var fx = o.pw - st.s * o.lw, fy = o.ph - st.s * o.lh;
    tx = fx >= 0 ? fx / 2 : clamp(tx, fx, 0); ty = fy >= 0 ? fy / 2 : clamp(ty, fy, 0);
    return { s: st.s, tx: tx, ty: ty, cx: st.cx, cy: st.cy };
  }
  // a small seeded random (the same seed always draws the same wobble)
  function rng(seed) {
    var a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function bounds(rects) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < rects.length; i++) { x0 = Math.min(x0, rects[i].x); y0 = Math.min(y0, rects[i].y); x1 = Math.max(x1, rects[i].x + rects[i].w); y1 = Math.max(y1, rects[i].y + rects[i].h); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  // a hand-drawn mark over rects [{x, y, w, h}] (one per line of the phrase): the path d and, for a highlight, the stroke width
  function markPath(shape, rects, seed) {
    var r = rng(seed), j = function (a) { return (r() * 2 - 1) * a; };
    var P = function (x, y) { return x.toFixed(1) + ' ' + y.toFixed(1); };
    var d = '', sw = 0, i, k;
    var box = bounds(rects);
    if (shape === 'highlight') {
      for (i = 0; i < rects.length; i++) sw += rects[i].h * 0.8 / rects.length;
      for (i = 0; i < rects.length; i++) {
        var yh = rects[i].y + rects[i].h * 0.56;
        d += (i ? ' ' : '') + 'M' + P(rects[i].x - 4, yh + j(1.2)) + ' L' + P(rects[i].x + rects[i].w + 4, yh + j(1.2));
      }
      sw = Math.round(sw);
    } else if (shape === 'underline') {
      for (i = 0; i < rects.length; i++) {
        var n = Math.max(2, Math.round(rects[i].w / 70)), yu = rects[i].y + rects[i].h * 0.97, tilt = j(2.2);
        for (k = 0; k <= n; k++) d += (k ? ' L' : (i ? ' M' : 'M')) + P(rects[i].x - 2 + (rects[i].w + 4) * k / n, yu + tilt * k / n + (k > 0 && k < n ? j(1.1) : 0));
      }
    } else if (shape === 'strike') {
      for (i = 0; i < rects.length; i++) {
        var ys = rects[i].y + rects[i].h * 0.57, x0 = rects[i].x - 6, x1 = rects[i].x + rects[i].w + 6, tl = j(2.5);
        d += (i ? ' M' : 'M') + P(x0, ys - tl) + ' L' + P((x0 + x1) / 2, ys + j(1.2)) + ' L' + P(x1, ys + tl);
      }
    } else if (shape === 'box') {
      var bx0 = box.x - 10, by0 = box.y - 4, bx1 = box.x + box.w + 10, by1 = box.y + box.h + 4;
      var q = function (ax, ay, bx, by, bow) { return ' Q' + P((ax + bx) / 2 + j(bow), (ay + by) / 2 + j(bow)) + ' ' + P(bx, by); };
      var c1 = [bx1 + j(3), by0 + j(2.5)], c2 = [bx1 + j(2.5), by1 + j(3)], c3 = [bx0 + j(2.5), by1 + j(2.5)], c4 = [bx0 + j(2) - 1, by0 + 16 + j(2)];
      var c0 = [bx0 - 5 + j(2), by0 + j(2)];
      d = 'M' + P(c0[0], c0[1]) + q(c0[0], c0[1], c1[0], c1[1], 3) + q(c1[0], c1[1], c2[0], c2[1], 3) + q(c2[0], c2[1], c3[0], c3[1], 3) + q(c3[0], c3[1], c4[0], c4[1], 2);
    } else {
      // circle: an ellipse round the box, drawn clockwise from the upper left in a bit more than one turn, its radius wobbling and growing
      var cx = box.x + box.w / 2, cy = box.y + box.h / 2, rx = box.w * 0.54 + 12, ry = box.h * 0.7 + 10;
      var p1 = j(3), p2 = j(3), a0 = -Math.PI * 0.82, turns = 1.07, m = 84;
      for (i = 0; i <= m; i++) {
        var f = i / m, th = a0 + f * turns * Math.PI * 2;
        var w = 1 + 0.022 * Math.sin(th * 2 + p1) + 0.016 * Math.sin(th * 3 + p2) + 0.07 * f;
        d += (i ? ' L' : 'M') + P(cx + Math.cos(th) * rx * w, cy + Math.sin(th) * ry * w);
      }
    }
    return { d: d, sw: sw };
  }
  // where an element riding the polyline pts [[x, y], …] is at k (0..1 of its length): the point, the segment i and the fraction f in it
  function tracePoint(pts, k) {
    var len = [0], total = 0, i;
    for (i = 1; i < pts.length; i++) { total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); len.push(total); }
    var at = total * clamp(k, 0, 1);
    for (i = 1; i < pts.length - 1 && len[i] < at; i++);
    var seg = len[i] - len[i - 1], f = seg > 0 ? clamp((at - len[i - 1]) / seg, 0, 1) : 1;
    return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f, i: i - 1, f: f };
  }
  root.__atelierMotion = { followCam: followCam, markPath: markPath, tracePoint: tracePoint, rng: rng, ease: ease, formatNumber: formatNumber, scrollOffset: scrollOffset, look: look, pointer: pointer, clamp: clamp, camera: camera };
  if (typeof document === 'undefined') return;

  var ready = false, rowsOf = [], followOf = null;
  // the number of lines a text is laid out on: the distinct tops of its glyphs' boxes
  function linesOf(el) {
    var r = document.createRange(); r.selectNodeContents(el);
    var rects = r.getClientRects(), tops = [];
    for (var i = 0; i < rects.length; i++) { var y = Math.round(rects[i].top); if (rects[i].width > 0 && tops.every(function (u) { return Math.abs(u - y) > 4; })) tops.push(y); }
    return tops.length;
  }
  var num = function (el, k, d) { var v = el.getAttribute(k); return v === null || v === '' ? d : parseFloat(v); };
  function init() {
    ready = true;
    // text fitting by measurement: the size goes down by 2 px until the text fits its box, down to the floor
    var fit = document.querySelectorAll('[data-fit]');
    for (var i = 0; i < fit.length; i++) {
      var el = fit[i], min = num(el, 'data-fit', 16), cs = getComputedStyle(el), size = parseFloat(cs.fontSize), line = cs.whiteSpace === 'nowrap';
      // a one-line text is fitted on its width alone; a text in several lines on its box
      var most = num(el, 'data-lines', 0);
      if (most > 0) { while (size > min && (el.scrollWidth > el.clientWidth + 1 || linesOf(el) > most)) { size -= 2; el.style.fontSize = size + 'px'; } continue; }
      while (size > min && (el.scrollWidth > el.clientWidth + 1 || (!line && el.scrollHeight > el.clientHeight + 1))) { size -= 2; el.style.fontSize = size + 'px'; }
    }
    // hand-drawn marks: measure the phrase (or take the box) and write the path. The layer has no transform yet, so client rects are layer pixels.
    var marks = document.querySelectorAll('[data-around],[data-box]');
    for (var mk = 0; mk < marks.length; mk++) {
      var me = marks[mk], rects = [], org = me.ownerSVGElement ? me.ownerSVGElement.getBoundingClientRect() : { left: 0, top: 0 }, bx = me.getAttribute('data-box');
      if (bx !== null) { var bv = bx.split(/[ ,]+/).map(parseFloat); rects.push({ x: bv[0], y: bv[1], w: bv[2], h: bv[3] }); }
      else {
        var host = document.getElementById(me.getAttribute('data-around')), from = num(me, 'data-from', 0), to = num(me, 'data-to', 0);
        if (!host) continue;
        var walk = document.createTreeWalker(host, 4), node, pos = 0, rg = document.createRange();
        while ((node = walk.nextNode())) {
          var nl = node.nodeValue.length, a = Math.max(from, pos), b = Math.min(to, pos + nl);
          if (b > a) {
            rg.setStart(node, a - pos); rg.setEnd(node, b - pos);
            var rl = rg.getClientRects();
            for (var q = 0; q < rl.length; q++) if (rl[q].width > 1) {
              var rr = { x: rl[q].left - org.left, y: rl[q].top - org.top, w: rl[q].width, h: rl[q].height }, last = rects[rects.length - 1];
              // the pieces of one line (several text nodes, a wrapped bit) are one rect
              if (last && Math.abs(last.y - rr.y) < 4 && Math.abs(last.h - rr.h) < 6) { var ux = Math.min(last.x, rr.x), ur = Math.max(last.x + last.w, rr.x + rr.w); last.x = ux; last.w = ur - ux; }
              else rects.push(rr);
            }
          }
          pos += nl;
        }
      }
      if (!rects.length) continue;
      var shape = markPath(me.getAttribute('data-shape') || 'highlight', rects, num(me, 'data-seed', 1));
      me.setAttribute('d', shape.d);
      if (shape.sw) me.style.strokeWidth = shape.sw + 'px';
      // the box in layer pixels (the focus of the follow camera), when the mark's <svg> sits inside the layer
      var ob = bounds(rects), layer0 = document.querySelector('[data-follow]'), lo = layer0 ? layer0.getBoundingClientRect() : org;
      me.__box = { x: ob.x + org.left - lo.left, y: ob.y + org.top - lo.top, w: ob.w, h: ob.h };
    }
    // the follow camera: the foci are measured now, before anything is moved
    var layer = document.querySelector('[data-follow]');
    if (layer) {
      var lr = layer.getBoundingClientRect(), fe = layer.querySelectorAll('[data-focus-at]'), foci = [];
      for (var fo = 0; fo < fe.length; fo++) {
        var bb = fe[fo].__box, fz = fe[fo].getAttribute('data-focus-z');
        if (!bb) { var cr = fe[fo].getBoundingClientRect(); bb = { x: cr.left - lr.left, y: cr.top - lr.top, w: cr.width, h: cr.height }; }
        foci.push({ at: num(fe[fo], 'data-focus-at', 0), x: bb.x + bb.w / 2, y: bb.y + bb.h / 2, z: fz === null ? 0 : parseFloat(fz) });
      }
      foci.sort(function (u, v) { return u.at - v.at; });
      layer.style.transformOrigin = '0 0';
      followOf = { layer: layer, foci: foci, o: { lw: layer.offsetWidth, lh: layer.offsetHeight, pw: num(layer, 'data-pw', layer.offsetWidth), ph: num(layer, 'data-ph', layer.offsetHeight), wide: num(layer, 'data-wide', 1), zoom: parseFloat(layer.getAttribute('data-follow')) || 1.35, lead: num(layer, 'data-lead', 0.3), dur: num(layer, 'data-dur', 0.8) } };
    }
    var views = document.querySelectorAll('[data-scroll]');
    for (var v = 0; v < views.length; v++) {
      var view = views[v], rows = view.querySelectorAll('[data-row-at]'), list = [];
      for (var r = 0; r < rows.length; r++) list.push({ at: num(rows[r], 'data-row-at', 0), bottom: rows[r].offsetTop + rows[r].offsetHeight });
      rowsOf.push({ view: view, list: view.firstElementChild, rows: list, pad: num(view, 'data-pad', 24), height: view.clientHeight });
    }
  }
  root.atelierRenderAt = function (t) {
    if (!ready) init();
    var els = document.querySelectorAll('[data-anim]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], at = num(el, 'data-at', 0), dur = num(el, 'data-dur', 0.5), out = el.getAttribute('data-out');
      var p = clamp((t - at) / dur, 0, 1), q = out === null ? 0 : clamp((t - parseFloat(out)) / num(el, 'data-out-dur', 0.35), 0, 1);
      var s = look(el.getAttribute('data-anim'), p, q, num(el, 'data-dx', 120), num(el, 'data-dy', 40), num(el, 'data-blur', 12), el.getAttribute('data-ease'));
      el.style.opacity = t < at && el.getAttribute('data-anim') !== 'shift' ? 0 : s.o;
      el.style.transform = 'translate(' + s.tx.toFixed(2) + 'px,' + s.ty.toFixed(2) + 'px) scale(' + s.sx.toFixed(4) + ',' + s.sy.toFixed(4) + ')';
      el.style.clipPath = s.clip;
      if (s.blur > 0.01 || el.style.filter) el.style.filter = s.blur > 0.01 ? 'blur(' + s.blur.toFixed(2) + 'px)' : '';
    }
    var zooms = document.querySelectorAll('[data-zoom]');
    for (var z = 0; z < zooms.length; z++) {
      var ze = zooms[z], z0 = num(ze, 'data-z0', 1), z1 = num(ze, 'data-z1', 1.12);
      var zk = (ease[ze.getAttribute('data-ease')] || ease.inOut)(clamp((t - num(ze, 'data-at', 0)) / num(ze, 'data-dur', 4), 0, 1));
      ze.style.transform = 'scale(' + (z0 + (z1 - z0) * zk).toFixed(5) + ')';
    }
    // a print that sat large alone glides to its place on the board as the others land (data-reframe="dx,dy,s": where it starts from)
    var reframes = document.querySelectorAll('[data-reframe]');
    for (var rf = 0; rf < reframes.length; rf++) {
      var re = reframes[rf], rv = re.getAttribute('data-reframe').split(',').map(parseFloat);
      var rk = ease.settle(clamp((t - num(re, 'data-at', 0)) / num(re, 'data-dur', 1.2), 0, 1));
      re.style.transform = 'translate(' + (rv[0] * (1 - rk)).toFixed(2) + 'px,' + (rv[1] * (1 - rk)).toFixed(2) + 'px) scale(' + (rv[2] + (1 - rv[2]) * rk).toFixed(5) + ')';
    }
    // a film inside a print: its frames, all decoded, shown one at a time (data-flip=<fps>; the last one holds)
    var flips = document.querySelectorAll('[data-flip]');
    for (var fl = 0; fl < flips.length; fl++) {
      var fe = flips[fl], kids = fe.children, fk = Math.min(kids.length - 1, Math.floor(Math.max(0, t) * num(fe, 'data-flip', 10)));
      if (fe.getAttribute('data-shown') !== String(fk)) {
        for (var fi = 0; fi < kids.length; fi++) kids[fi].style.opacity = fi === fk ? '1' : '0';
        fe.setAttribute('data-shown', String(fk));
      }
    }
    var movers = document.querySelectorAll('[data-move]');
    for (var mv = 0; mv < movers.length; mv++) {
      var me = movers[mv], path = me.getAttribute('data-move').split(',').map(parseFloat), ck = me.getAttribute('data-click');
      var pt = pointer(path, num(me, 'data-at', 0), num(me, 'data-dur', 1), ck === null ? null : parseFloat(ck), t);
      me.style.transform = 'translate(' + pt.x.toFixed(2) + 'px,' + pt.y.toFixed(2) + 'px) scale(' + pt.s.toFixed(4) + ')';
    }
    // a counted number changes once a frame (at the frame's own time): the sub-frames of a motion blur all show the same digits
    var tf = Math.floor(t * 30 + 1e-6) / 30;
    var counts = document.querySelectorAll('[data-count]');
    for (var c = 0; c < counts.length; c++) {
      var ce = counts[c], from = num(ce, 'data-from', 0), to = num(ce, 'data-to', 0);
      var k = ease.out(clamp((tf - num(ce, 'data-at', 0)) / num(ce, 'data-dur', 1.5), 0, 1));
      ce.textContent = formatNumber(from + (to - from) * k, num(ce, 'data-dec', 0));
    }
    var camEl = document.querySelector('[data-cam]');
    if (camEl) {
      var cv = camEl.getAttribute('data-cam').split(/[ ,]+/).map(parseFloat), pw = num(camEl, 'data-pw', 1920), ph = num(camEl, 'data-ph', 1080);
      var ck2 = (ease[camEl.getAttribute('data-ease')] || ease.sine)(clamp((t - num(camEl, 'data-at', 0)) / num(camEl, 'data-dur', 4), 0, 1));
      var cm = camera(cv.slice(0, 3), cv.slice(3, 6), pw, ph, ck2);
      var layers = document.querySelectorAll('[data-cl]');
      for (var l = 0; l < layers.length; l++) layers[l].style.transform = 'translate(' + cm.tx.toFixed(3) + 'px,' + cm.ty.toFixed(3) + 'px) scale(' + cm.s.toFixed(5) + ')';
      var strokes = document.querySelectorAll('[data-sw]');
      for (var w = 0; w < strokes.length; w++) strokes[w].style.strokeWidth = (num(strokes[w], 'data-sw', 1) / cm.s).toFixed(4) + 'px';
      var riders = document.querySelectorAll('[data-cp]');
      for (var rd = 0; rd < riders.length; rd++) {
        var re = riders[rd], rp = re.getAttribute('data-cp').split(/[ ,]+/).map(parseFloat), along = re.getAttribute('data-cpath');
        if (along !== null) {
          var ap = along.split(/[ ,]+/).map(parseFloat), apts = [], rat = num(re, 'data-at', 0);
          for (var ai = 0; ai + 1 < ap.length; ai += 2) apts.push([ap[ai], ap[ai + 1]]);
          var rk = (ease[re.getAttribute('data-ease')] || ease.out)(clamp((t - rat) / num(re, 'data-dur', 1), 0, 1));
          var rq = tracePoint(apts, rk);
          rp = [rq.x, rq.y];
          re.style.opacity = t < rat ? 0 : 1;
        }
        re.style.transform = 'translate(' + (cm.tx + rp[0] * cm.s).toFixed(2) + 'px,' + (cm.ty + rp[1] * cm.s).toFixed(2) + 'px)';
      }
    }
    var draws = document.querySelectorAll('[data-draw]');
    for (var dw = 0; dw < draws.length; dw++) {
      var de = draws[dw], dat = num(de, 'data-at', 0), dk = (ease[de.getAttribute('data-ease')] || ease.inOut)(clamp((t - dat) / num(de, 'data-dur', 1), 0, 1));
      de.style.opacity = t < dat ? 0 : 1;
      de.style.strokeDashoffset = (1 - dk).toFixed(5);
    }
    if (followOf) {
      var fc = followCam(followOf.foci, followOf.o, t);
      followOf.layer.style.transform = 'translate(' + fc.tx.toFixed(2) + 'px,' + fc.ty.toFixed(2) + 'px) scale(' + fc.s.toFixed(5) + ')';
    }
    var traces = document.querySelectorAll('[data-trace]');
    for (var tr = 0; tr < traces.length; tr++) {
      var tre = traces[tr], tp = tre.getAttribute('data-trace').split(',').map(parseFloat), tpts = [];
      for (var ti = 0; ti + 1 < tp.length; ti += 2) tpts.push([tp[ti], tp[ti + 1]]);
      var tat = num(tre, 'data-at', 0), tk = (ease[tre.getAttribute('data-ease')] || ease.linear)(clamp((t - tat) / num(tre, 'data-dur', 1), 0, 1));
      var tpos = tracePoint(tpts, tk);
      tre.style.opacity = t < tat ? 0 : 1;
      tre.style.transform = 'translate(' + tpos.x.toFixed(2) + 'px,' + tpos.y.toFixed(2) + 'px)';
      var tvals = tre.getAttribute('data-trace-vals'), tve = tre.querySelector('[data-trace-val]');
      if (tvals && tve) {
        var vv = tvals.split(',').map(parseFloat), tpf = tracePoint(tpts, (ease[tre.getAttribute('data-ease')] || ease.linear)(clamp((tf - tat) / num(tre, 'data-dur', 1), 0, 1)));
        tve.textContent = formatNumber(vv[tpf.i] + (vv[tpf.i + 1] - vv[tpf.i]) * tpf.f, num(tre, 'data-dec', 0));
      }
    }
    var typing = document.querySelectorAll('[data-typing]');
    for (var y = 0; y < typing.length; y++) {
      var te = typing[y], f = num(te, 'data-from', 0), u = num(te, 'data-to', 0);
      var on = t >= f && t < u;
      te.style.opacity = on ? clamp((t - f) / 0.12, 0, 1) * clamp((u - t) / 0.1, 0, 1) : 0;
      var dots = te.children;
      for (var d = 0; d < dots.length; d++) dots[d].style.transform = 'translateY(' + (-6 * Math.max(0, Math.sin((t * 5.2 - d * 0.9))) ).toFixed(2) + 'px)';
    }
    var pulses = document.querySelectorAll('[data-pulse]');
    for (var m = 0; m < pulses.length; m++) {
      var pe = pulses[m], pa = num(pe, 'data-at', 0), per = num(pe, 'data-period', 1.6);
      var ph = t < pa ? 0 : ((t - pa) / per) % 1;
      pe.style.opacity = t < pa ? 0 : (0.7 * (1 - ph)).toFixed(3);
      pe.style.transform = 'scale(' + (1 + 1.6 * ease.out(ph)).toFixed(3) + ')';
    }
    for (var s2 = 0; s2 < rowsOf.length; s2++) {
      var sv = rowsOf[s2];
      if (sv.list) sv.list.style.transform = 'translateY(' + (-scrollOffset(sv.rows, sv.height, sv.pad, t, 0.5)).toFixed(2) + 'px)';
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
`
