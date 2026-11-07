// The motion studio's page script, part 1 of 2 (decision 0111): three.js (MIT, loaded from the page's own text), the renderer, the
// measured look (background, light, grain, vignette), closed-form springs, the camera through its keys, type from glyph outlines (flat or
// extruded) and the frame key. Part 2 (studio-build.ts) builds the items. A frame is a function of t alone: no clock, no state carried
// between frames (a count, a growing city, a drawn curve are all computed from t), a seeded random. The page writes its frame key into an
// inline style synchronously in `atelierRenderAt` (from t and the spec alone), so the fast capture photographs a still stretch once.
export const STUDIO_HEAD_JS = String.raw`
(function () {
  var D = JSON.parse(document.getElementById('std').textContent);
  var L = D.look, P = L.palette, S = L.springs, W = D.width, H = D.height;
  var hudItems = 0, T = null, renderer = null, scene = null, hud = null, cam = null, hudCam = null, items = [], curT = 0, drawnT = -1;
  var keyEl = document.getElementById('stk'), grainEl = document.getElementById('stg');
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function glide(x) { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function outCubic(x) { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); }
  function outQuint(x) { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 5); }
  /** closed-form damped spring 0 → 1 at time t (seconds since it started) */
  function spring(t, s) {
    if (t <= 0) return 0;
    var w0 = Math.sqrt(s.k), z = s.d / (2 * w0);
    if (z < 1) { var wd = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)); }
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  }
  function rng(seed) { var a = seed | 0; return function () { a = (a + 0x6d2b79f5) | 0; var x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
  function hex(role) { return P[role] || role || '#ffffff'; }

  // ---- the frame key: which stretches of the card move (from the spec alone) -------------------------------------------------------
  var windows = [], always = false;
  (function () {
    var n = function (x, d) { return typeof x === 'number' ? x : d; };
    D.items.forEach(function (it) {
      var long = 2.2;
      if (it.kind === 'counter') long = Math.max(long, n(it.countS, 1.2) + 0.2);
      if (it.kind === 'bar') long = Math.max(long, n(it.growS, 0.9) + 1.6);
      if (it.kind === 'curve') long = n(it.drawS, 0.7) + L.stagger * it.to.length + 0.6;
      if (it.kind === 'dots') long = n(it.fillS, 1.6) + 1.2;
      if (it.kind === 'city') long = Math.max(n(it.growS, 8), typeof it.wallAtS === 'number' ? it.wallAtS - it.atS + n(it.wallS, 3) : 0) + 1.5;
      if (it.kind === 'terrain' && it.enter === 'none') long = 0;
      if (it.kind === 'object' && (it.spin[0] || it.spin[1] || it.spin[2])) always = true;
      if (it.kind === 'block' && it.enter === 'drop') long = 3;
      if (long > 0) windows.push([it.atS, it.atS + long]);
      if (typeof it.outS === 'number') windows.push([it.outS, it.outS + 0.5]);
      (it.moves || []).forEach(function (m) { windows.push([m.atS, m.atS + 2.2]); });
      if (it.kind === 'counter' && it.keys) windows.push([it.keys[0][0], it.keys[it.keys.length - 1][0] + 0.05]);
    });
    var k = D.camera.keys || [];
    if (k.length > 1) windows.push([k[0].atS, k[k.length - 1].atS + (D.camera.ease === 'spring' ? 3 : 0.05)]);
    if (D.camera.drift > 0) always = true;
  })();
  function frameKey(t) {
    if (always) return 't' + t.toFixed(4);
    var ended = 0;
    for (var i = 0; i < windows.length; i++) {
      if (t >= windows[i][0] && t < windows[i][1]) return 't' + t.toFixed(4);
      if (t >= windows[i][1]) ended++;
    }
    return 'h' + ended;
  }
  // grain moves with the key (a still stretch keeps the same grain, so it is photographed once)
  function grainAt(key) {
    if (!grainEl) return;
    var h = 2166136261;
    for (var i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
    var r = rng(h >>> 0);
    grainEl.style.backgroundPosition = Math.round(r() * 256) + 'px ' + Math.round(r() * 256) + 'px';
  }

  // ---- type: glyph outlines into three.js shapes ------------------------------------------------------------------------------------
  var geoCache = {};
  function shapesOf(d) {
    var sp = new T.ShapePath(), tk = d.split(' '), i = 0;
    while (i < tk.length) {
      var c = tk[i++];
      if (c === 'M') { sp.moveTo(+tk[i], +tk[i + 1]); i += 2; }
      else if (c === 'L') { sp.lineTo(+tk[i], +tk[i + 1]); i += 2; }
      else if (c === 'Q') { sp.quadraticCurveTo(+tk[i], +tk[i + 1], +tk[i + 2], +tk[i + 3]); i += 4; }
    }
    return sp.toShapes(false);
  }
  /** one glyph's geometry at 1 em, extruded by depth em (0 = flat) */
  function glyphGeo(face, ch, depth) {
    var key = face + '|' + ch + '|' + depth.toFixed(3);
    if (geoCache[key] !== undefined) return geoCache[key];
    var g = D.fonts[face] && D.fonts[face].glyphs[ch], geo = null;
    if (g && g.d) {
      var shapes = shapesOf(g.d);
      geo = depth > 0
        ? new T.ExtrudeGeometry(shapes, { depth: depth, curveSegments: 6, bevelEnabled: true, bevelThickness: Math.min(0.03, depth * 0.25), bevelSize: 0.012, bevelSegments: 2 })
        : new T.ShapeGeometry(shapes, 6);
      if (depth > 0) geo.translate(0, 0, -depth);
    }
    geoCache[key] = geo;
    return geo;
  }
  function advance(face, ch) { var g = D.fonts[face] && D.fonts[face].glyphs[ch]; return g ? g.adv : 0.3; }
  function textWidth(face, s, tracking) { var w = 0; for (var i = 0; i < s.length; i++) w += advance(face, s[i]) + (i < s.length - 1 ? tracking : 0); return w; }
  /** a vertical gradient (role2 at the top, role at the bottom) as a texture over span units of the geometry's own y */
  var gradCache = {};
  function gradient(top, bottom, span) {
    var key = top + bottom + span;
    if (gradCache[key]) return gradCache[key];
    var c = document.createElement('canvas'); c.width = 4; c.height = 256;
    var g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, top); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    var tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace; tex.wrapS = T.RepeatWrapping;
    tex.repeat.set(1, 1 / span); tex.offset.set(0, 0);
    gradCache[key] = tex;
    return tex;
  }
  /** a text as a group of glyph meshes: size world units an em, its middle (or edge) at x = 0, its capitals centred on y = 0 */
  function TextMesh(o) {
    this.group = new T.Group();
    this.o = o; this.str = null; this.meshes = []; this.width = 0;
    this.mat = o.material;
  }
  TextMesh.prototype.set = function (s) {
    if (s === this.str) return;
    this.str = s;
    var o = this.o, tr = o.tracking || 0, x = 0, w = textWidth(o.face, s, tr);
    var x0 = o.align === 'left' ? 0 : o.align === 'right' ? -w : -w / 2;
    var cap = 0.36;
    for (var i = 0; i < s.length; i++) {
      var geo = glyphGeo(o.face, s[i], (o.depth || 0) / o.size), m = this.meshes[i];
      if (!m) { m = new T.Mesh(geo || undefined, this.mat); m.castShadow = !!o.shadow; this.meshes.push(m); this.group.add(m); }
      if (geo) m.geometry = geo;
      m.visible = !!geo;
      m.position.set((x0 + x) * o.size, -cap * o.size, 0);
      m.scale.set(o.size, o.size, o.size);
      x += advance(o.face, s[i]) + tr;
    }
    for (var j = s.length; j < this.meshes.length; j++) this.meshes[j].visible = false;
    this.width = w * o.size;
  };
  function textMaterial(role, role2, depth, size, glowy) {
    var top = hex(role2 || role), bottom = hex(role);
    var map = role2 ? gradient(top, bottom, 0.75) : null;
    if (depth > 0) {
      var m = new T.MeshPhysicalMaterial({ color: map ? 0xffffff : bottom, map: map, roughness: 0.28, metalness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.2, emissive: glowy ? bottom : '#000000', emissiveIntensity: glowy ? 0.25 : 0 });
      return m;
    }
    // flat type keeps its exact colour (no tone mapping, no fog): a channel's palette is measured
    return new T.MeshBasicMaterial({ color: map ? 0xffffff : bottom, map: map, transparent: true, toneMapped: false, fog: false });
  }

  // ---- glow: a soft additive halo behind emissive things -------------------------------------------------------------------------
  var haloTex = null;
  function halo(role, w, h, strength) {
    if (!haloTex) {
      var c = document.createElement('canvas'); c.width = c.height = 128;
      var g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      haloTex = new T.CanvasTexture(c);
    }
    var m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: haloTex, color: hex(role), transparent: true, opacity: L.glow * strength, blending: T.AdditiveBlending, depthWrite: false }));
    m.scale.set(w, h, 1);
    m.renderOrder = -1;
    m.userData.base = L.glow * strength;
    return m;
  }

  // ---- arriving and leaving ----------------------------------------------------------------------------------------------------
  /** how far an item has arrived (k, a spring that may overshoot) and how visible it is (a), at card time t */
  function presence(it, t, s) {
    var local = t - it.atS;
    if (local < 0) return { k: 0, a: 0, local: local };
    var a = it.enter === 'none' ? 1 : clamp(local / 0.35, 0, 1);
    if (typeof it.outS === 'number' && t > it.outS) a *= 1 - clamp((t - it.outS) / 0.35, 0, 1);
    var k = it.enter === 'none' ? 1 : spring(local, s || S.type);
    return { k: k, a: a, local: local };
  }
  function setOpacity(obj, a) {
    obj.visible = a > 0.001;
    obj.traverse(function (o) {
      var m = o.material;
      if (!m) return;
      var ms = Array.isArray(m) ? m : [m];
      ms.forEach(function (x) {
        if (x.userData.base === undefined) x.userData.base = x.opacity;
        x.opacity = x.userData.base * a;
        var tr = a < 0.999 || x.userData.base < 0.999 || x.blending === T.AdditiveBlending;
        if (tr !== x.transparent) { x.transparent = tr; x.needsUpdate = true; }
      });
    });
  }
  /** where an item is at card time t: its place, then each later place it glides to (a spring) */
  function placeAt(it, t) {
    var at = it.at.slice(), prev = it.at;
    (it.moves || []).forEach(function (m) {
      var f = spring(t - m.atS, S.type);
      for (var q = 0; q < 3; q++) at[q] += (m.at[q] - prev[q]) * f;
      prev = m.at;
    });
    return at;
  }
  /** the common moves of an enter: rise, pop, zoom, drop (a group placed at its rest position) */
  function enterMove(g, it, p, ref) {
    var at = placeAt(it, it.atS + p.local);
    g.position.set(at[0], at[1], at[2]);
    g.scale.set(1, 1, 1);
    if (it.enter === 'rise') g.position.y = at[1] - (1 - p.k) * 0.35 * ref;
    else if (it.enter === 'pop') { var s = 0.55 + 0.45 * p.k; g.scale.set(s, s, s); }
    else if (it.enter === 'zoom') { var z = 1 + 0.55 * (1 - clamp(p.k, 0, 1.2)); g.scale.set(z, z, z); }
    else if (it.enter === 'drop') { var f = it.from || [0, 2.5, 0]; g.position.set(at[0] + f[0] * (1 - p.k), at[1] + f[1] * (1 - p.k), at[2] + f[2] * (1 - p.k)); }
    else if (it.enter === 'fade') { var s2 = 0.96 + 0.04 * p.k; g.scale.set(s2, s2, s2); }
  }
`

/** Part 3 (after the builders): the scene, the light, the camera, the clock. */
export const STUDIO_TAIL_JS = String.raw`
  // ---- the room the glossy things reflect -------------------------------------------------------------------------------------
  function roomEnv() {
    var room = new T.Scene(), box = new T.BoxGeometry(1, 1, 1);
    var walls = new T.Mesh(box, new T.MeshBasicMaterial({ color: L.light === 'sun' ? 0x8899aa : 0x1a1d26, side: T.BackSide }));
    walls.scale.set(20, 12, 20); room.add(walls);
    var panel = function (c, i, x, y, z, sx, sy, sz) { var m = new T.Mesh(box, new T.MeshBasicMaterial({ color: new T.Color(c).multiplyScalar(i) })); m.position.set(x, y, z); m.scale.set(sx, sy, sz); room.add(m); };
    if (L.light === 'rim') {
      panel(P.accent2, 5, -8, 2, -6, 0.2, 6, 6);
      panel(P.cool, 6, 8, 2, -6, 0.2, 6, 6);
      panel('#ffffff', 1.5, 0, 5.8, 0, 8, 0.2, 8);
    } else {
      panel('#ffffff', 4, 0, 5.8, 0, 10, 0.2, 6);
      panel('#ffffff', 2.2, -9.8, 1, 0, 0.2, 4, 10);
      panel('#ffffff', 1.6, 9.8, 1, 2, 0.2, 4, 8);
      panel(P.cool, 2, 0, 1, -9.8, 10, 4, 0.2);
    }
    var pm = new T.PMREMGenerator(renderer);
    var tex = pm.fromScene(room, 0.03).texture;
    pm.dispose();
    return tex;
  }
  function background() {
    var bg = L.background, c = document.createElement('canvas');
    c.width = 512; c.height = Math.round(512 * H / W);
    var g = c.getContext('2d');
    if (bg.kind === 'vignette') {
      var r = Math.max(c.width, c.height) * 0.75, gr = g.createRadialGradient(bg.spotAt[0] * c.width, bg.spotAt[1] * c.height, 0, bg.spotAt[0] * c.width, bg.spotAt[1] * c.height, r);
      gr.addColorStop(0, bg.spot || bg.top); gr.addColorStop(1, bg.bottom); g.fillStyle = gr;
    } else if (bg.kind === 'flat') g.fillStyle = bg.top;
    else { var lg = g.createLinearGradient(0, 0, 0, c.height); lg.addColorStop(0, bg.top); lg.addColorStop(1, bg.bottom); g.fillStyle = lg; }
    g.fillRect(0, 0, c.width, c.height);
    var tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }
  function lights(sc) {
    if (L.light === 'sun') {
      sc.add(new T.HemisphereLight(0xdfe9ff, 0x5a5030, 0.6));
      var sun = new T.DirectionalLight(0xfff1dc, 1.7);
      sun.position.set(-60, 90, 40);
      if (L.shadows) {
        sun.castShadow = true;
        var e = D.shadowSpan || 80;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left = -e; sun.shadow.camera.right = e; sun.shadow.camera.top = e; sun.shadow.camera.bottom = -e;
        sun.shadow.camera.near = 1; sun.shadow.camera.far = 400; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
      }
      sc.add(sun); sc.add(sun.target);
    } else if (L.light === 'rim') {
      sc.add(new T.AmbientLight(0xffffff, 0.15));
      var a = new T.PointLight(new T.Color(P.accent), 70, 30, 2); a.position.set(-5, 1.5, -2.5); sc.add(a);
      var b = new T.PointLight(new T.Color(P.cool), 45, 30, 2); b.position.set(5, 1.5, -3); sc.add(b);
      var k = new T.DirectionalLight(0xffffff, 0.95); k.position.set(1, 4, 7); sc.add(k);
      var f = new T.DirectionalLight(0xc8ccff, 0.5); f.position.set(-3, -2, 5); sc.add(f);
    } else {
      sc.add(new T.AmbientLight(0xffffff, 0.35));
      var key = new T.DirectionalLight(0xffffff, 1.2); key.position.set(-3, 6, 8); sc.add(key);
    }
  }

  // ---- the camera through its keys -------------------------------------------------------------------------------------------
  var dist = 4.5 / Math.tan(D.camera.fov * Math.PI / 360);
  var KEYS = (D.camera.keys && D.camera.keys.length) ? D.camera.keys : [{ atS: 0, pos: [0, 0, dist], target: [0, 0, 0] }];
  function camAt(t) {
    var k = KEYS, pos, tgt;
    if (k.length === 1 || t <= k[0].atS) { pos = k[0].pos.slice(); tgt = k[0].target.slice(); }
    else if (D.camera.ease === 'spring') {
      pos = k[0].pos.slice(); tgt = k[0].target.slice();
      for (var i = 1; i < k.length; i++) {
        var f = spring(t - k[i - 1].atS, S.heavy);
        for (var j = 0; j < 3; j++) { pos[j] += (k[i].pos[j] - k[i - 1].pos[j]) * f; tgt[j] += (k[i].target[j] - k[i - 1].target[j]) * f; }
      }
    } else {
      var n = 0;
      while (n < k.length - 2 && t >= k[n + 1].atS) n++;
      var a = k[n], b = k[n + 1], x = clamp((t - a.atS) / Math.max(1e-3, b.atS - a.atS), 0, 1);
      var e = D.camera.ease === 'linear' ? x : glide(x);
      pos = [0, 1, 2].map(function (q) { return lerp(a.pos[q], b.pos[q], e); });
      tgt = [0, 1, 2].map(function (q) { return lerp(a.target[q], b.target[q], e); });
    }
    var dr = D.camera.drift;
    if (dr > 0) { pos[0] += dr * Math.sin(t * 0.37); pos[1] += dr * 0.6 * Math.sin(t * 0.29 + 1.3); tgt[0] += dr * 0.3 * Math.sin(t * 0.23 + 0.4); }
    return { pos: pos, tgt: tgt };
  }

  function draw(t) {
    if (!renderer) return;
    items.forEach(function (it) { it.update(t); });
    var c = camAt(t);
    cam.position.set(c.pos[0], c.pos[1], c.pos[2]);
    cam.lookAt(c.tgt[0], c.tgt[1], c.tgt[2]);
    renderer.clear();
    renderer.render(scene, cam);
    if (hudItems > 0) { renderer.clearDepth(); renderer.render(hud, hudCam); }
    drawnT = t;
  }

  var ready = (function () {
    var coreUrl = URL.createObjectURL(new Blob([TH_CORE], { type: 'text/javascript' }));
    var mod = TH_MAIN.split("'./three.core.js'").join(JSON.stringify(coreUrl));
    return import(URL.createObjectURL(new Blob([mod], { type: 'text/javascript' }))).then(function (lib) {
      T = lib;
      var canvas = document.getElementById('stc');
      renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(1);
      renderer.setSize(W, H, false);
      renderer.autoClear = false;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = L.light === 'sun' ? T.ACESFilmicToneMapping : T.NeutralToneMapping;
      renderer.toneMappingExposure = L.exposure;
      if (L.shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; }
      scene = new T.Scene();
      scene.background = background();
      scene.environment = roomEnv();
      scene.environmentIntensity = L.light === 'sun' ? 0.25 : 1;
      if (L.fog) scene.fog = new T.Fog(L.fog.color, L.fog.near, L.fog.far);
      lights(scene);
      cam = new T.PerspectiveCamera(D.camera.fov, W / H, 0.1, 5000);
      hud = new T.Scene();
      hud.environment = scene.environment;
      lights(hud);
      var hw = 4.5 * W / H;
      hudCam = new T.OrthographicCamera(-hw, hw, 4.5, -4.5, -100, 100);
      hudCam.position.set(0, 0, 50);
      D.items.forEach(function (it) {
        var b = BUILD[it.kind] && BUILD[it.kind](it);
        if (!b) return;
        (it.screen ? hud : scene).add(b.root);
        if (it.screen) hudItems++;
        items.push(b);
      });
      draw(curT);
    });
  })();
  ready.catch(function (e) { window.atelierError = String(e && e.message || e); });
  document.addEventListener('DOMContentLoaded', function () {
    var base = window.atelierRenderAt;
    window.atelierRenderAt = function (t) {
      if (base) base(t);
      curT = t;
      var key = frameKey(t);
      keyEl.style.setProperty('--k', key);
      grainAt(key);
    };
  });
  window.atelierFrameReady = function () { return ready.then(function () { if (drawnT !== curT) draw(curT); return 0; }); };
})();
`
