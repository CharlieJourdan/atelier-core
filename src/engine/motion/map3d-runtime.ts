// The script of the 3D map page (motion/map3d.ts): it starts MapLibre GL JS from the inlined library, serves the inlined tiles through an
// `atelier://` protocol (the page has no network), builds the style, and draws frame t as a pure function of t: `atelierRenderAt(t)` (the
// motion runtime's, wrapped) sets the camera of that frame with jumpTo and every paint value of that moment; `atelierFrameReady()` resolves
// once the map has drawn that frame with all its tiles (MapLibre's `idle`), after the labels have been placed from `map.project`. Labels keep
// their size on screen, are hidden outside the frame and never overlap (placed in order of importance, each trying a few positions). The page
// writes its state into one inline style so the fast capture (motion/fast.ts) sees a frame change.
// Plain JavaScript in a string (it runs as written in the page).
export const MAP3D_JS = String.raw`
(function () {
  var D = JSON.parse(document.getElementById('m3d').textContent);
  var FPS = D.fps, W = D.width, H = D.height;
  var clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };
  var smooth = function (x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  var outCubic = function (x) { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); };
  var sine = function (x) { x = clamp(x, 0, 1); return 0.5 - 0.5 * Math.cos(Math.PI * x); };
  var map = null, ml = null, loaded = false, curT = 0, routeK = [], asked = {};
  var state = document.getElementById('m3s');
  function bytes(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; }
  function camAt(t) {
    var f = clamp(t * FPS, 0, D.frames.length - 1), i = Math.floor(f), k = f - i, a = D.frames[i], b = D.frames[Math.min(i + 1, D.frames.length - 1)];
    var o = []; for (var j = 0; j < 5; j++) o.push(a[j] + (b[j] - a[j]) * k);
    return o;
  }
  // the head of route i at progress k: the part drawn (coordinates) and its last point
  function partial(line, k) {
    var lens = [0], i;
    for (i = 1; i < line.length; i++) lens.push(lens[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    var want = lens[lens.length - 1] * k, out = [line[0]];
    for (i = 1; i < line.length && lens[i] <= want; i++) out.push(line[i]);
    if (i < line.length) { var s = lens[i] - lens[i - 1], f = s > 0 ? (want - lens[i - 1]) / s : 0; out.push([line[i - 1][0] + (line[i][0] - line[i - 1][0]) * f, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * f]); }
    if (out.length < 2) out.push(out[0]);
    return out;
  }
  var TONES = D.tones;
  // WebGL in software (SwiftShader, llvmpipe: a server without a GPU) draws a raised terrain about 50x slower: the relief stays flat there
  var software = (function () {
    try {
      var gl = document.createElement('canvas').getContext('webgl2'), info = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return /swiftshader|llvmpipe|software/i.test(String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''));
    } catch (e) { return false; }
  })();
  window.atelierMapInfo = function () { return { software: software, terrain: !!(map && map.getTerrain && map.getTerrain()) }; };
  // soft clouds over the land (the reference's white haze): seeded value noise in 5 octaves, drawn once into a canvas
  function clouds(w, h, seed) {
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var g = cv.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    var hash = function (x, y, o) { var n = Math.imul(x * 374761393 + y * 668265263 + o * 2147483647 + seed * 974711, 1274126177); n = Math.imul(n ^ (n >>> 13), 1103515245); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
    var noise = function (x, y, o) { var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      var a = hash(xi, yi, o), b = hash(xi + 1, yi, o), c = hash(xi, yi + 1, o), e = hash(xi + 1, yi + 1, o);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy; };
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var n = 0, amp = 0.5, f = 4 / w;
      for (var o = 0; o < 5; o++) { n += amp * noise(x * f, y * f * 2, o); amp *= 0.5; f *= 2; }
      var a = clamp((n - 0.52) * 3.2, 0, 1), i = (y * w + x) * 4;
      d[i] = 222; d[i + 1] = 226; d[i + 2] = 232; d[i + 3] = Math.round(255 * a * a);
    }
    g.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }
  function style() {
    var L = D.look, s = { version: 8, sources: {}, layers: [], transition: { duration: 0, delay: 0 } };
    s.layers.push({ id: 'bg', type: 'background', paint: { 'background-color': L.sea } });
    if (D.maxzoom.sat >= 0) {
      s.sources.sat = { type: 'raster', tiles: ['atelier://sat/{z}/{x}/{y}'], tileSize: 256, maxzoom: D.maxzoom.sat };
      s.layers.push({ id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-fade-duration': 0, 'raster-brightness-max': L.bright, 'raster-brightness-min': L.dark, 'raster-saturation': L.sat, 'raster-contrast': L.contrast, 'raster-resampling': 'linear' } });
    }
    if (D.land) {
      s.sources.land = { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: D.land } } };
      s.layers.push({ id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': L.land, 'fill-antialias': true } });
    }
    if (D.maxzoom.dem >= 0) {
      s.sources.dem = { type: 'raster-dem', tiles: ['atelier://dem/{z}/{x}/{y}'], tileSize: 256, maxzoom: D.maxzoom.dem, encoding: 'terrarium' };
      s.sources.hs = { type: 'raster-dem', tiles: ['atelier://dem/{z}/{x}/{y}'], tileSize: 256, maxzoom: D.maxzoom.dem, encoding: 'terrarium' };
      s.layers.push({ id: 'hs', type: 'hillshade', source: 'hs', paint: { 'hillshade-shadow-color': L.shadow, 'hillshade-highlight-color': L.highlight, 'hillshade-accent-color': L.shadow, 'hillshade-exaggeration': L.shade, 'hillshade-illumination-direction': 315 } });
      if (D.exaggeration > 0 && (!software || D.terrainOnSoftware)) s.terrain = { source: 'dem', exaggeration: D.exaggeration };
    }
    if (L.clouds > 0) {
      var b = D.box;
      s.sources.clouds = { type: 'image', url: clouds(1024, 512, 7), coordinates: [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]] };
      s.layers.push({ id: 'clouds', type: 'raster', source: 'clouds', paint: { 'raster-opacity': L.clouds, 'raster-fade-duration': 0 } });
    }
    s.sources.borders = { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: D.borders } } };
    s.layers.push({ id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': L.border, 'line-opacity': L.borderOpacity, 'line-width': L.borderWidth }, layout: { 'line-join': 'round' } });
    D.regions.forEach(function (r, i) {
      var tone = TONES[r.tone];
      s.sources['r' + i] = { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: D.shapes[i] } } };
      if (r.raise > 0) s.layers.push({ id: 'rx' + i, type: 'fill-extrusion', source: 'r' + i, paint: { 'fill-extrusion-color': tone.side, 'fill-extrusion-height': 0, 'fill-extrusion-opacity': 0, 'fill-extrusion-vertical-gradient': true } });
      else s.layers.push({ id: 'rf' + i, type: 'fill', source: 'r' + i, paint: { 'fill-color': tone.fill, 'fill-opacity': 0 } });
      s.layers.push({ id: 'rl' + i, type: 'line', source: 'r' + i, paint: { 'line-color': tone.line, 'line-width': L.regionLine, 'line-opacity': 0, 'line-blur': 0.4 }, layout: { 'line-join': 'round' } });
    });
    D.routes.forEach(function (line, i) {
      s.sources['u' + i] = { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [line[0], line[0]] } } };
      s.layers.push({ id: 'ug' + i, type: 'line', source: 'u' + i, paint: { 'line-color': L.route, 'line-width': L.routeWidth * 3.2, 'line-opacity': 0, 'line-blur': L.routeWidth * 2 }, layout: { 'line-cap': 'round' } });
      s.layers.push({ id: 'u' + i, type: 'line', source: 'u' + i, paint: { 'line-color': L.route, 'line-width': L.routeWidth, 'line-opacity': 0 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      routeK.push(-1);
    });
    if (D.maxzoom.dem >= 0 || L.fog) s.sky = { 'sky-color': L.skyColor, 'horizon-color': L.horizon, 'fog-color': L.fogColor, 'fog-ground-blend': L.fogGround, 'horizon-fog-blend': 0.6, 'sky-horizon-blend': 0.7, 'atmosphere-blend': 0 };
    return s;
  }
  // ---- what moves at t ----
  function apply(t) {
    var c = camAt(t);
    map.jumpTo({ center: [c[0], c[1]], zoom: c[2], pitch: c[3], bearing: c[4] });
    var sig = [c.map(function (v) { return v.toFixed(5); }).join(',')];
    D.regions.forEach(function (r, i) {
      var at = D.times.regions[i], line = smooth((t - at) / 0.3), fill = smooth((t - at - 0.25) / 0.8), up = outCubic((t - at - 0.2) / 1.1);
      map.setPaintProperty('rl' + i, 'line-opacity', line);
      if (r.raise > 0) { map.setPaintProperty('rx' + i, 'fill-extrusion-height', r.raise * 1000 * up); map.setPaintProperty('rx' + i, 'fill-extrusion-opacity', 0.74 * fill); }
      else map.setPaintProperty('rf' + i, 'fill-opacity', TONES[r.tone].alpha * fill);
      sig.push(line.toFixed(3) + '/' + fill.toFixed(3) + '/' + up.toFixed(3));
    });
    D.routes.forEach(function (line, i) {
      var start = D.times.routes[i] + 0.4, k = sine((t - start) / D.times.draw[i]);
      var on = t >= start ? 1 : 0;
      map.setPaintProperty('u' + i, 'line-opacity', on);
      map.setPaintProperty('ug' + i, 'line-opacity', on * 0.35);
      if (Math.abs(k - routeK[i]) > 1e-6) { map.getSource('u' + i).setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: partial(line, Math.max(k, 0.0005)) } }); routeK[i] = k; }
      sig.push(k.toFixed(4));
    });
    state.style.setProperty('--m3d', '"' + sig.join(';') + '"');
  }
  // ---- the labels, from map.project ----
  var items = [].slice.call(document.querySelectorAll('[data-ll]')).map(function (el) {
    var ll = el.getAttribute('data-ll').split(',').map(parseFloat);
    return { el: el, ll: ll, kind: el.getAttribute('data-kind'), at: parseFloat(el.getAttribute('data-at')), pri: parseFloat(el.getAttribute('data-pri')), tag: el.querySelector('.tg'), bb: el.getAttribute('data-bb') ? el.getAttribute('data-bb').split(',').map(parseFloat) : null, w: 0, h: 0 };
  }).sort(function (a, b) { return a.pri - b.pri; });
  var reserved = [].slice.call(document.querySelectorAll('[data-keep]'));
  var heads = [].slice.call(document.querySelectorAll('[data-head]'));
  function hit(a, list) { for (var i = 0; i < list.length; i++) { var b = list[i]; if (a.x < b.x + b.w + 6 && a.x + a.w + 6 > b.x && a.y < b.y + b.h + 4 && a.y + a.h + 4 > b.y) return true; } return false; }
  function inside(r) { var m = 16; return r.x >= m && r.y >= m && r.x + r.w <= W - m && r.y + r.h <= H - m; }
  function place(t) {
    var taken = reserved.map(function (el) { var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }).filter(function (r) { return r.w > 0; });
    items.forEach(function (it) {
      if (!it.w) { var box = (it.tag || it.el.firstElementChild || it.el).getBoundingClientRect(); it.w = box.width; it.h = box.height; }
      var p = map.project(it.ll), o = clamp((t - it.at) / (it.kind === 'pin' ? 0.25 : 0.5), 0, 1), chosen = null, cands;
      if (it.kind === 'pin') cands = [[18, -it.h / 2, 'r'], [-18 - it.w, -it.h / 2, 'l'], [-it.w / 2, -it.h - 14, 'u'], [-it.w / 2, 14, 'd']];
      else cands = [[-it.w / 2, -it.h / 2, 'c'], [-it.w / 2, -it.h * 1.6, 'c'], [-it.w / 2, it.h * 0.6, 'c']];
      if (it.bb) {
        var q = [[it.bb[0], it.bb[1]], [it.bb[2], it.bb[1]], [it.bb[0], it.bb[3]], [it.bb[2], it.bb[3]]].map(function (c) { return map.project(c); });
        var x0 = Math.min.apply(null, q.map(function (v) { return v.x; })), x1 = Math.max.apply(null, q.map(function (v) { return v.x; }));
        var y0 = Math.min.apply(null, q.map(function (v) { return v.y; })), y1 = Math.max.apply(null, q.map(function (v) { return v.y; }));
        if (it.w > 0.6 * (x1 - x0)) cands = [[-it.w / 2, y1 - p.y + 4, 'c'], [-it.w / 2, y0 - p.y - it.h - 4, 'c']].concat(cands);
      }
      for (var i = 0; i < cands.length && !chosen; i++) {
        var r = { x: p.x + cands[i][0], y: p.y + cands[i][1], w: it.w, h: it.h };
        if (inside(r) && !hit(r, taken)) chosen = { r: r, side: cands[i][2] };
      }
      // a pin's dot is kept even when its tag has no room; a label with no room is hidden
      if (o > 0 && chosen) taken.push(chosen.r);
      it.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px)';
      var vis = o > 0 && p.x > -40 && p.y > -40 && p.x < W + 40 && p.y < H + 40;
      it.el.style.opacity = vis ? (it.kind === 'pin' ? 1 : o).toFixed(3) : '0';
      if (it.kind === 'pin') {
        it.el.className = 'pin side-' + (chosen ? chosen.side : 'r');
        var dot = it.el.querySelector('.dt');
        dot.style.transform = 'scale(' + (0.4 + 0.6 * outCubic(o)).toFixed(3) + ')';
        dot.style.opacity = o.toFixed(3);
        // the tag is wiped open from the dot side, 0.3 s after the dot
        var w = clamp((t - it.at - 0.3) / 0.35, 0, 1);
        it.tag.style.visibility = chosen ? 'visible' : 'hidden';
        it.tag.style.clipPath = 'inset(0 ' + (chosen && chosen.side === 'l' ? '0 0 ' + ((1 - w) * 100).toFixed(1) + '%' : ((1 - w) * 100).toFixed(1) + '% 0 0') + ')';
        it.el.querySelector('.ld').style.transform = 'scaleX(' + smooth(w * 2).toFixed(3) + ')';
        if (chosen) { it.tag.style.left = (chosen.r.x - p.x).toFixed(1) + 'px'; it.tag.style.top = (chosen.r.y - p.y).toFixed(1) + 'px'; }
      } else if (!chosen) it.el.style.opacity = '0';
      else { it.el.firstElementChild.style.left = (chosen.r.x - p.x).toFixed(1) + 'px'; it.el.firstElementChild.style.top = (chosen.r.y - p.y).toFixed(1) + 'px'; }
    });
    heads.forEach(function (el) {
      var i = +el.getAttribute('data-head'), line = D.routes[i], start = D.times.routes[i] + 0.4, k = sine((t - start) / D.times.draw[i]);
      if (t < start || k >= 0.999) { el.style.opacity = '0'; return; }
      var pts = partial(line, Math.max(k, 0.0005)), a = map.project(pts[Math.max(0, pts.length - 2)]), b = map.project(pts[pts.length - 1]);
      el.style.opacity = '1';
      el.style.transform = 'translate(' + b.x.toFixed(1) + 'px,' + b.y.toFixed(1) + 'px) rotate(' + (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI).toFixed(2) + 'deg)';
    });
  }
  // MapLibre starts its workers as modules; a module worker cannot start from a blob: URL in this page (opaque origin): classic ones can
  var NativeWorker = window.Worker;
  window.Worker = function (url) { return new NativeWorker(url); };
  window.Worker.prototype = NativeWorker.prototype;
  var ready = import(URL.createObjectURL(new Blob([ML_MAIN], { type: 'text/javascript' }))).then(function (lib) {
    ml = lib;
    ml.setWorkerUrl(URL.createObjectURL(new Blob([ML_WORKER], { type: 'text/javascript' })));
    ml.addProtocol('atelier', function (params) {
      var key = params.url.slice(10), s = D.tiles[key];
      asked[key] = s ? 1 : 0;
      return s ? Promise.resolve({ data: bytes(s) }) : Promise.reject(new Error('no tile ' + key));
    });
    var c = camAt(0);
    map = new ml.Map({ container: 'map', style: style(), center: [c[0], c[1]], zoom: c[2], pitch: c[3], bearing: c[4], interactive: false, attributionControl: false, fadeDuration: 0, pixelRatio: 1, maxPitch: 85, renderWorldCopies: false, maxTileCacheSize: 4000, maxTileCacheZoomLevels: 12, canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true } });
    return new Promise(function (res, rej) { map.once('load', function () { loaded = true; res(); }); map.on('error', function (e) { if (!/no tile/.test(String(e && e.error && e.error.message))) window.atelierError = String(e && e.error && e.error.message); }); setTimeout(function () { rej(new Error('the map did not load')); }, 180000); });
  });
  // Synchronous draws until the frame is complete. With a terrain, MapLibre re-renders only one terrain tile's texture per animation frame
  // after a zoom change (smooth for a person, 15-20 frames of waiting for us): the follow-up draws are done here at once. When every
  // tile is there, 'idle' fires from inside a draw; otherwise the map keeps drawing on its own until it does.
  function drawNow(isDone) {
    for (var i = 0; i < 64 && !isDone(); i++) {
      map.redraw();
      var rtt = map.painter && map.painter.renderToTexture;
      if (!(rtt && rtt.needsFollowUpFrame)) break;
    }
  }
  // the warm-up: the camera visits its path once (every half second) so every tile it will need is decoded and kept in the map's cache;
  // a frame then draws in one render instead of waiting for tiles (about 6x faster on a GPU)
  ready = ready.then(function () {
    var n = Math.max(1, Math.round((D.frames.length - 1) / FPS * 2)), i = 0;
    return new Promise(function (res) {
      var step = function () {
        if (i > n) { res(); return; }
        var c = D.frames[Math.round(i++ * (D.frames.length - 1) / n)];
        map.jumpTo({ center: [c[0], c[1]], zoom: c[2], pitch: c[3], bearing: c[4] });
        var done = false;
        // the next step after this draw has returned (never a draw from inside a draw)
        map.once('idle', function () { done = true; setTimeout(step, 0); });
        drawNow(function () { return done; });
      };
      step();
    });
  });
  ready.catch(function (e) { window.atelierError = String(e && e.message || e); });
  document.addEventListener('DOMContentLoaded', function () {
    var base = window.atelierRenderAt;
    window.atelierRenderAt = function (t) { if (base) base(t); curT = t; if (loaded) apply(t); };
  });
  // the tiles the map asked for (1 = served, 0 = missing): the tests and the demo check the preparation against it
  window.atelierMapAsked = function () { return asked; };
  window.atelierFrameReady = function () {
    return ready.then(function () {
      // always set again: the warm-up may have moved the camera since atelierRenderAt(t)
      apply(curT);
      return new Promise(function (res, rej) {
        var to = setTimeout(function () { rej(new Error('the map did not finish drawing the frame at ' + curT)); }, 120000);
        var done = false;
        map.once('idle', function () { done = true; clearTimeout(to); place(curT); res(0); });
        drawNow(function () { return done; });
      });
    });
  };
})();
`
