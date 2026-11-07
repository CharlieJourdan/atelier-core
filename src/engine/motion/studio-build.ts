// The motion studio's page script, part 2 of 2 (decision 0111): the builders, one per item kind (formats/studio.ts). Each takes its
// item and returns `{ root, update(t) }`: `root` is added to the scene (or to the screen layer), `update` places everything for card
// time t from t alone. Runs inside part 1's closure (studio-runtime.ts): T (three.js), the springs, TextMesh, halo, presence, hex.
export const STUDIO_BUILD_JS = String.raw`
  function roundRect(w, h, r, x0, y0) {
    var s = new T.Shape(), x = x0 === undefined ? -w / 2 : x0, y = y0 === undefined ? 0 : y0;
    r = Math.max(0.0001, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4));
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  /** a rounded box: its base on y = 0 (centred in x and z), depth d */
  function roundBox(w, h, d, r) {
    var bt = Math.min(0.04, d * 0.12, r), g = new T.ExtrudeGeometry(roundRect(w - 2 * bt, h - 2 * bt, Math.max(0.001, r - bt), -(w - 2 * bt) / 2, bt), { depth: Math.max(0.001, d - 2 * bt), curveSegments: 8, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 3 });
    g.translate(0, 0, -(d - 2 * bt) / 2);
    return g;
  }
  function material(kind, role, role2, span) {
    var c = hex(role), map = role2 ? gradient(hex(role2), c, span || 1) : null, base = map ? 0xffffff : c;
    if (kind === 'matte') return new T.MeshStandardMaterial({ color: base, map: map, roughness: 0.85, metalness: 0 });
    if (kind === 'metal') return new T.MeshStandardMaterial({ color: base, map: map, roughness: 0.3, metalness: 1 });
    if (kind === 'gold') return new T.MeshPhysicalMaterial({ color: hex('gold'), roughness: 0.22, metalness: 1, clearcoat: 0.4 });
    if (kind === 'frost') return new T.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0, transmission: 0.9, thickness: 2, ior: 1.45, attenuationColor: c, attenuationDistance: 2.5, emissive: c, emissiveIntensity: 0.12, clearcoat: 0.9, clearcoatRoughness: 0.15 });
    if (kind === 'glass') return new T.MeshPhysicalMaterial({ color: base, map: map, roughness: 0.16, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.25, transparent: true, opacity: 0.94 });
    if (kind === 'emissive') return new T.MeshStandardMaterial({ color: base, map: map, roughness: 0.4, metalness: 0, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.55 });
    return new T.MeshPhysicalMaterial({ color: base, map: map, roughness: 0.32, metalness: 0.08, clearcoat: 1, clearcoatRoughness: 0.15 });
  }
  function textOf(o) { var tm = new TextMesh(o); tm.set(o.text || ''); return tm; }

  var BUILD = {};
  BUILD.text = function (it) {
    var g = new T.Group(), face = it.face || L.face, sh = null, sm = null;
    var mat = textMaterial(it.role, it.role2 || null, it.depth, it.size, it.glow);
    mat.userData.base = it.opacity;
    var tm = textOf({ face: face, size: it.size, depth: it.depth, align: it.align, tracking: it.tracking, material: mat, text: it.text, shadow: L.shadows });
    if (it.shadow) {
      sm = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, toneMapped: false, fog: false });
      sh = textOf({ face: face, size: it.size, depth: 0, align: it.align, tracking: it.tracking, material: sm, text: it.text });
      sh.group.position.set(it.size * 0.025, -it.size * 0.035, -0.02); g.add(sh.group);
    }
    g.add(tm.group);
    if (it.lead) {
      var lm = textMaterial(it.leadRole, null, it.depth, it.size, false);
      var lt = textOf({ face: face, size: it.size, depth: it.depth, align: 'left', tracking: it.tracking, material: lm, text: it.lead });
      var gapL = it.size * 0.45, totalW = lt.width + gapL + tm.width, left = it.align === 'left' ? 0 : it.align === 'right' ? -totalW : -totalW / 2;
      lt.group.position.x = left;
      tm.o.align = 'left'; tm.str = null; tm.set(it.text); tm.group.position.x = left + lt.width + gapL;
      if (it.shadow) { sh.o.align = 'left'; sh.str = null; sh.set(it.text); sh.group.position.x += left + lt.width + gapL; var ls = textOf({ face: face, size: it.size, depth: 0, align: 'left', tracking: it.tracking, material: sm, text: it.lead }); ls.group.position.set(left + it.size * 0.025, -it.size * 0.035, -0.02); g.add(ls.group); }
      g.add(lt.group);
    }
    if (it.glow) { var hl = halo(it.role, tm.width * 1.5 + it.size, it.size * 2.2, 0.55); hl.position.x = it.align === 'left' ? tm.width / 2 : it.align === 'right' ? -tm.width / 2 : 0; hl.position.z = -0.05; g.add(hl); }
    return { root: g, update: function (t) { var p = presence(it, t, S.type); enterMove(g, it, p, it.size); setOpacity(g, p.a); } };
  };
  function formatNumber(v, dec, sep) {
    var s = Math.abs(v).toFixed(dec), parts = s.split('.'), int = parts[0], out = '';
    for (var i = 0; i < int.length; i++) { if (i > 0 && (int.length - i) % 3 === 0) out += sep; out += int[i]; }
    return (v < 0 ? '-' : '') + out + (parts[1] ? ',' + parts[1] : '');
  }
  BUILD.counter = function (it) {
    var g = new T.Group(), face = it.face || L.face;
    var role2 = it.role2 || (it.role === 'accent' ? 'accent2' : null);
    var mat = textMaterial(it.role, role2, it.depth, it.size, it.glow);
    var smat = textMaterial(it.suffixRole || it.role, role2, it.depth * it.suffixScale, it.size * it.suffixScale, it.glow);
    var num = new TextMesh({ face: face, size: it.size, depth: it.depth, align: 'left', material: mat });
    var suf = new TextMesh({ face: face, size: it.size * it.suffixScale, depth: it.depth * it.suffixScale, align: 'left', material: smat });
    g.add(num.group); g.add(suf.group);
    suf.set(it.suffix);
    // the widest the number gets: the layout is set on it, so the count does not slide
    var lo = it.keys ? it.keys[0][1] : it.from, hi = it.keys ? it.keys[it.keys.length - 1][1] : it.to;
    var widest = Math.max(textWidth(face, it.prefix + formatNumber(lo, it.decimals, it.group), 0), textWidth(face, it.prefix + formatNumber(hi, it.decimals, it.group), 0)) * it.size;
    var gap = it.suffix ? it.size * 0.22 : 0, total = widest + gap + suf.width;
    var x0 = it.align === 'left' ? 0 : it.align === 'right' ? -total : -total / 2;
    var hl = it.glow ? halo(it.role, total * 1.35 + it.size, it.size * 2.4, 0.5) : null;
    if (hl) { hl.position.set(x0 + total / 2, 0, -0.05); g.add(hl); }
    return { root: g, update: function (t) {
      var p = presence(it, t, S.type);
      var v;
      if (it.keys) {
        var ks = it.keys, j = 0;
        while (j < ks.length - 2 && t >= ks[j + 1][0]) j++;
        var u = clamp((t - ks[j][0]) / Math.max(1e-3, ks[j + 1][0] - ks[j][0]), 0, 1);
        v = Math.floor(lerp(ks[j][1], ks[j + 1][1], u));
      } else {
        var k = it.countS > 0 ? outQuint((t - it.atS) / it.countS) : 1;
        v = it.from + (it.to - it.from) * k;
      }
      var s = it.prefix + formatNumber(v, it.decimals, it.group);
      num.set(s);
      var w = num.width;
      num.group.position.x = x0 + (widest - w) ;
      suf.group.position.set(x0 + widest + gap, -(it.size - it.size * it.suffixScale) * 0.36 * 0.0, 0);
      suf.group.position.y = -(it.size * 0.36) + (it.size * it.suffixScale * 0.36);
      enterMove(g, it, p, it.size);
      setOpacity(g, p.a);
    } };
  };
  BUILD.bar = function (it) {
    var g = new T.Group(), w = it.size[0], h = it.size[1], d = it.size[2], full = it.axis === 'y' ? h : w;
    var geo = it.axis === 'y' ? roundBox(w, h, d, it.radius) : roundBox(h, w, d, it.radius);
    var mat = material('emissive', it.role, it.role2 || (it.role === 'accent' ? 'accent2' : null), it.axis === 'y' ? h : w);
    var bar = new T.Mesh(geo, mat);
    if (it.axis === 'x') { bar.rotation.z = -Math.PI / 2; }
    var holder = new T.Group(); holder.add(bar); g.add(holder);
    if (it.track) {
      var tr = new T.Mesh(it.axis === 'y' ? roundBox(w, h, d * 0.9, it.radius) : roundBox(h, w, d * 0.9, it.radius), material('glossy', 'panel'));
      if (it.axis === 'x') tr.rotation.z = -Math.PI / 2;
      tr.position.z = -d * 0.08; g.add(tr);
    }
    var hl = it.glow ? halo(it.role, 1, 1, 0.6) : null;
    if (hl) g.add(hl);
    return { root: g, update: function (t) {
      var p = presence(it, t, S.type);
      var k = it.enter === 'grow' ? Math.max(0.0001, spring((t - it.atS) / Math.max(0.2, it.growS) * 1.1, S.heavy)) : 1;
      var s = Math.max(0.0001, it.fill * Math.min(k, 1.04));
      if (it.axis === 'y') holder.scale.set(1, s, 1); else holder.scale.set(s, 1, 1);
      if (hl) {
        if (it.axis === 'y') { hl.scale.set(w * 2.6, h * s * 1.5 + w, 1); hl.position.set(0, h * s / 2, -d); }
        else { hl.scale.set(w * s * 1.4 + h, h * 3, 1); hl.position.set(w * s / 2, 0, -d); }
      }
      enterMove(g, it.enter === 'grow' ? Object.assign({}, it, { enter: 'none' }) : it, p, full);
      setOpacity(g, p.a);
    } };
  };
  function icon(kind, s, role) {
    var g = new T.Group(), m = new T.MeshBasicMaterial({ color: hex(role), transparent: true, opacity: 0.85 });
    if (kind === 'case') {
      // a small glass briefcase in relief: a rounded body, a lid line and a handle
      var gm = new T.MeshPhysicalMaterial({ color: hex('muted'), roughness: 0.25, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.9, emissive: hex('cool'), emissiveIntensity: 0.25 });
      var bodyG = roundBox(s, s * 0.7, s * 0.34, s * 0.1); bodyG.translate(0, -s * 0.42, 0);
      var bm = new T.Mesh(bodyG, gm); bm.position.z = s * 0.17; g.add(bm);
      var lid = new T.Mesh(new T.BoxGeometry(s * 1.01, s * 0.04, s * 0.36), new T.MeshStandardMaterial({ color: hex('panel'), roughness: 0.4 })); lid.position.set(0, -s * 0.12, s * 0.17); g.add(lid);
      var hdl = new T.Mesh(new T.TorusGeometry(s * 0.15, s * 0.035, 10, 24, Math.PI), gm); hdl.position.set(0, s * 0.28, s * 0.17); g.add(hdl);
      return g;
    }
    if (kind === 'case-flat') {
      var body = roundRect(s, s * 0.7, s * 0.12, -s / 2, -s * 0.42), hole = roundRect(s * 0.86, s * 0.56, s * 0.08, -s * 0.43, -s * 0.35);
      body.holes.push(hole);
      g.add(new T.Mesh(new T.ShapeGeometry(body, 6), m));
      g.add(new T.Mesh(new T.PlaneGeometry(s * 0.9, s * 0.06).translate(0, -s * 0.12, 0), m));
      var hd = roundRect(s * 0.4, s * 0.22, s * 0.06, -s * 0.2, s * 0.26); hd.holes.push(roundRect(s * 0.28, s * 0.16, s * 0.04, -s * 0.14, s * 0.26));
      g.add(new T.Mesh(new T.ShapeGeometry(hd, 6), m));
    } else if (kind === 'lock') {
      g.add(new T.Mesh(new T.ShapeGeometry(roundRect(s * 0.8, s * 0.6, s * 0.08, -s * 0.4, -s * 0.45), 6), m));
      g.add(new T.Mesh(new T.RingGeometry(s * 0.2, s * 0.28, 24, 1, 0, Math.PI).translate(0, s * 0.15, 0), m));
    }
    return g;
  }
  BUILD.block = function (it) {
    var g = new T.Group(), w = it.size[0], h = it.size[1], d = it.size[2];
    var geo = roundBox(w, h, d, it.radius);
    geo.translate(0, -h / 2, 0);
    var mesh = new T.Mesh(geo, material(it.material, it.role, it.role2, h));
    mesh.castShadow = L.shadows;
    g.add(mesh);
    var front = d / 2 + 0.006;
    if (it.glow) { var bh = halo(it.role2 || it.role, w * 1.6, h * 1.9, 0.55); bh.position.z = -d; g.add(bh); }
    if (it.edge) {
      var ring = roundRect(w + 0.03, h + 0.03, it.radius + 0.015, -(w + 0.03) / 2, -(h + 0.03) / 2);
      ring.holes.push(roundRect(w - 0.012, h - 0.012, Math.max(0.001, it.radius - 0.006), -(w - 0.012) / 2, -(h - 0.012) / 2));
      var e = new T.Mesh(new T.ShapeGeometry(ring, 8), new T.MeshBasicMaterial({ color: hex('fg'), transparent: true, opacity: 0.32 }));
      e.position.z = front; g.add(e);
    }
    if (it.label) {
      var tm = textOf({ face: it.labelFace || L.labelFace, size: it.labelSize, depth: 0, align: 'center', tracking: 0.04, material: textMaterial(it.labelRole, null, 0, it.labelSize, false), text: it.label });
      tm.group.position.z = front + 0.002;
      if (it.icon !== 'none') tm.group.position.y = -h * 0.28;
      g.add(tm.group);
    }
    if (it.icon !== 'none') { var ic = icon(it.icon, Math.min(w, h) * 0.42, 'fg'); ic.position.set(0, it.label ? h * 0.08 : 0, front + 0.002); g.add(ic); }
    return { root: g, update: function (t) {
      var p = presence(it, t, it.enter === 'drop' ? { k: S.heavy.k * 1.6, d: S.heavy.d * 1.05 } : S.ui);
      if (it.enter === 'grow') {
        var at = placeAt(it, t), k = Math.max(0.0001, clamp(spring(t - it.atS, S.type), 0, 1.03));
        g.position.set(at[0], at[1] - h / 2 * (1 - k), at[2]); g.scale.set(1, k, 1);
        setOpacity(g, Math.min(1, p.a * 3));
        return;
      }
      enterMove(g, it, p, h); setOpacity(g, p.a);
    } };
  };
  BUILD.curve = function (it) {
    var g = new T.Group(), tubes = [], seg = 72;
    var mat = new T.MeshBasicMaterial({ color: it.role2 ? 0xffffff : hex(it.role), vertexColors: !!it.role2, transparent: true });
    var c0 = new T.Color(hex(it.role)), c1 = new T.Color(hex(it.role2 || it.role)), cc = new T.Color();
    var paint = function (geo) {
      var n = geo.attributes.position.count, cols = new Float32Array(n * 3), ring = 9;
      for (var v = 0; v < n; v++) { cc.copy(c0).lerp(c1, Math.min(1, Math.floor(v / ring) / seg)); cols[v * 3] = cc.r; cols[v * 3 + 1] = cc.g; cols[v * 3 + 2] = cc.b; }
      geo.setAttribute('color', new T.BufferAttribute(cols, 3));
      return geo;
    };
    var gm = it.glow ? new T.MeshBasicMaterial({ color: hex(it.role), transparent: true, opacity: 0.18 * L.glow * 2, blending: T.AdditiveBlending, depthWrite: false }) : null;
    it.to.forEach(function (e) {
      var a = new T.Vector3(0, 0, 0), b = new T.Vector3(e[0] - it.at[0], e[1] - it.at[1], e[2] - it.at[2]), dy = b.y - a.y;
      var c1 = new T.Vector3(a.x, a.y + dy * it.bend, a.z), c2 = new T.Vector3(b.x, b.y - dy * it.bend * 0.35, b.z);
      var curve = new T.CubicBezierCurve3(a, c1, c2, b);
      var tube = new T.Mesh(paint(new T.TubeGeometry(curve, seg, it.width / 2, 8, false)), mat);
      g.add(tube);
      var glow = gm ? new T.Mesh(new T.TubeGeometry(curve, seg, it.width * 1.8, 8, false), gm) : null;
      if (glow) g.add(glow);
      tubes.push([tube, glow]);
    });
    return { root: g, update: function (t) {
      var p = presence(it, t, S.ui);
      g.position.set(it.at[0], it.at[1], it.at[2]);
      tubes.forEach(function (tb, i) {
        var f = outCubic((t - it.atS - i * L.stagger) / it.drawS), n = Math.floor(f * seg) * 8 * 6;
        tb[0].geometry.setDrawRange(0, n); tb[0].visible = n > 0;
        if (tb[1]) { tb[1].geometry.setDrawRange(0, n); tb[1].visible = n > 0; }
      });
      setOpacity(g, it.enter === 'draw' ? (typeof it.outS === 'number' && t > it.outS ? 1 - clamp((t - it.outS) / 0.35, 0, 1) : (t >= it.atS ? 1 : 0)) : p.a);
    } };
  };
  BUILD.object = function (it) {
    var g = new T.Group(), inner = new T.Group(), s = it.size, mat = material(it.material, it.role, null, s);
    g.add(inner);
    var add = function (geo, m, x, y, z) { var o = new T.Mesh(geo, m || mat); o.position.set(x || 0, y || 0, z || 0); o.castShadow = L.shadows; inner.add(o); return o; };
    if (it.shape === 'vault') {
      var body = roundBox(s, s, s * 0.92, s * 0.12); body.translate(0, -s / 2, 0); add(body);
      var dm = material(it.material, it.role, null, s); dm.color.multiplyScalar(0.75);
      var door = roundBox(s * 0.78, s * 0.78, s * 0.08, s * 0.07); door.translate(0, -s * 0.39, 0); add(door, dm, 0, 0, s * 0.46);
      var metal = material('metal', 'fg', null, s); metal.color.set(hex('muted'));
      add(new T.TorusGeometry(s * 0.15, s * 0.028, 14, 48), metal, 0, 0, s * 0.53);
      add(new T.CylinderGeometry(s * 0.05, s * 0.05, s * 0.06, 24).rotateX(Math.PI / 2), metal, 0, 0, s * 0.53);
      for (var k = 0; k < 3; k++) { var sp = add(new T.BoxGeometry(s * 0.24, s * 0.02, s * 0.02), metal, 0, 0, s * 0.54); sp.rotation.z = k * Math.PI / 3; }
      add(new T.CylinderGeometry(s * 0.03, s * 0.03, s * 0.16, 16), metal, -s * 0.36, s * 0.22, s * 0.48);
      add(new T.CylinderGeometry(s * 0.03, s * 0.03, s * 0.16, 16), metal, -s * 0.36, -s * 0.22, s * 0.48);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { add(new T.BoxGeometry(s * 0.1, s * 0.06, s * 0.1), dm, q[0] * s * 0.36, -s * 0.53, q[1] * s * 0.3); });
    } else if (it.shape === 'coin') add(new T.CylinderGeometry(s / 2, s / 2, s * 0.12, 64).rotateX(Math.PI / 2));
    else if (it.shape === 'ingot') {
      var sh = new T.Shape(); sh.moveTo(-s / 2, 0); sh.lineTo(s / 2, 0); sh.lineTo(s * 0.4, s * 0.3); sh.lineTo(-s * 0.4, s * 0.3); sh.lineTo(-s / 2, 0);
      var ig = new T.ExtrudeGeometry(sh, { depth: s * 0.45, bevelEnabled: true, bevelThickness: s * 0.02, bevelSize: s * 0.02, bevelSegments: 2 }); ig.translate(0, -s * 0.15, -s * 0.225); add(ig);
    } else if (it.shape === 'sphere') add(new T.SphereGeometry(s / 2, 64, 32));
    else if (it.shape === 'cylinder') add(new T.CylinderGeometry(s / 2, s / 2, s, 48));
    else if (it.shape === 'tower') { add(new T.CylinderGeometry(s * 0.2, s * 0.24, s, 24).translate(0, s / 2, 0)); add(new T.ConeGeometry(s * 0.28, s * 0.4, 24).translate(0, s * 1.2, 0), material('matte', 'roof')); }
    else { var cb = roundBox(s, s, s, s * 0.08); cb.translate(0, -s / 2, 0); add(cb); }
    var r0 = it.rot.map(function (x) { return x * Math.PI / 180; }), sp0 = it.spin.map(function (x) { return x * Math.PI / 180; });
    return { root: g, update: function (t) {
      var p = presence(it, t, S.heavy);
      inner.rotation.set(r0[0] + sp0[0] * t, r0[1] + sp0[1] * t, r0[2] + sp0[2] * t);
      enterMove(g, it, p, s);
      setOpacity(g, p.a);
    } };
  };
  function dotGeo(kind) {
    if (kind === 'drop') { var sh = new T.Shape(); sh.moveTo(0, 0.62); sh.quadraticCurveTo(0.34, 0.12, 0.34, -0.1); sh.absarc(0, -0.1, 0.34, 0, Math.PI, true); sh.quadraticCurveTo(-0.34, 0.12, 0, 0.62); return new T.ShapeGeometry(sh, 10); }
    if (kind === 'cube') { var b = roundBox(0.8, 0.8, 0.8, 0.1); b.translate(0, -0.4, 0); return b; }
    if (kind === 'coin') return new T.CylinderGeometry(0.45, 0.45, 0.1, 32).rotateX(Math.PI / 2);
    return new T.CircleGeometry(0.42, 28);
  }
  BUILD.dots = function (it) {
    var g = new T.Group(), n = it.cols * it.rows, geo = dotGeo(it.icon), lit = Math.round(n * it.share);
    var on = new T.InstancedMesh(geo, it.icon === 'cube' ? material('emissive', it.role, null, 1) : new T.MeshBasicMaterial({ color: hex(it.role), transparent: true }), n);
    var off = new T.InstancedMesh(geo, it.icon === 'cube' ? material('glossy', it.offRole, null, 1) : new T.MeshBasicMaterial({ color: hex(it.offRole), transparent: true, opacity: 0.55 }), n);
    g.add(off); g.add(on);
    var pos = [];
    for (var r = 0; r < it.rows; r++) for (var c = 0; c < it.cols; c++) pos.push([(c - (it.cols - 1) / 2) * it.gap, (r - (it.rows - 1) / 2) * it.gap]);
    var m4 = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), sc = new T.Vector3();
    var hl = it.glow ? halo(it.role, 1, 1, 0.5) : null;
    if (hl) g.add(hl);
    return { root: g, update: function (t) {
      var p = presence(it, t, S.ui), dt = lit > 0 ? it.fillS / lit : 0, shown = 0;
      for (var i = 0; i < n; i++) {
        var k = i < lit ? clamp(spring(t - it.atS - 0.15 - i * dt, S.ui), 0, 1.15) : 0;
        if (k > 0.02) shown = i + 1;
        v.set(pos[i][0], pos[i][1], 0);
        sc.setScalar(it.size * Math.max(0.0001, k)); m4.compose(v, q, sc); on.setMatrixAt(i, m4);
        sc.setScalar(it.size * (k > 0.6 ? 0.0001 : 1)); m4.compose(v.set(pos[i][0], pos[i][1], -0.01), q, sc); off.setMatrixAt(i, m4);
      }
      on.instanceMatrix.needsUpdate = true; off.instanceMatrix.needsUpdate = true;
      if (hl) { var rows = Math.ceil(shown / it.cols); hl.scale.set(it.cols * it.gap * 1.5, Math.max(0.01, rows * it.gap * 1.6), 1); hl.position.set(0, -(it.rows - 1) / 2 * it.gap + (rows - 1) / 2 * it.gap, -0.1); hl.visible = shown > 0; }
      enterMove(g, it, p, it.gap * it.rows);
      setOpacity(g, p.a);
    } };
  };

  // ---- 3D places ---------------------------------------------------------------------------------------------------------------
  function inPoly(x, z, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function segDist(x, z, a, b) {
    var dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, u = l > 0 ? clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l, 0, 1) : 0;
    var px = a[0] + u * dx - x, pz = a[1] + u * dz - z; return Math.sqrt(px * px + pz * pz);
  }
  function lineDist(x, z, pts, closed) {
    var d = 1e9;
    for (var i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, z, pts[i], pts[i + 1]));
    if (closed) d = Math.min(d, segDist(x, z, pts[pts.length - 1], pts[0]));
    return d;
  }
  /** the river's middle line smoothed (Catmull-Rom through its points) */
  function smoothLine(pts) {
    if (pts.length < 3) return pts;
    var c = new T.CatmullRomCurve3(pts.map(function (p) { return new T.Vector3(p[0], 0, p[1]); }));
    return c.getPoints(pts.length * 12).map(function (v) { return [v.x, v.z]; });
  }
  function noise2(seed) {
    var hash = function (x, z) { var h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    var one = function (x, z) {
      var xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), w = zf * zf * (3 - 2 * zf);
      return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), w);
    };
    return function (x, z) { return one(x, z) * 0.65 + one(x * 2.3 + 17, z * 2.3 + 5) * 0.35; };
  }
  var GROUND = null;
  BUILD.terrain = function (it) {
    var g = new T.Group(), n = noise2(it.seed), size = it.size, river = it.river ? smoothLine(it.river) : null, rw = it.riverWidth / 2, isl = it.island, bare = it.bare;
    var islandH = 0.35;
    var height = function (x, z) {
      var base = 0.7 + it.hills * (n(x / 38, z / 38) - 0.35);
      if (isl && inPoly(x, z, isl)) return islandH;
      if (river) {
        var d = lineDist(x, z, river, false), bank = clamp((d - rw + 1.2) / 3.5, 0, 1);
        base = lerp(-0.9, base, bank * bank * (3 - 2 * bank));
        if (isl) { var di = lineDist(x, z, isl, true); if (di < 1.4 && d < rw + 1) base = Math.max(base, lerp(islandH, -0.9, di / 1.4)); }
      }
      return base;
    };
    GROUND = function (x, z) { return Math.max(0, height(x, z)); };
    var seg = Math.min(260, Math.round(size * 1.1)), geo = new T.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    var pa = geo.attributes.position, cols = new Float32Array(pa.count * 3);
    var grass = new T.Color(hex('grass')), dark = new T.Color(hex('tree')), dirt = new T.Color(hex('ground')), cc = new T.Color();
    for (var i = 0; i < pa.count; i++) {
      var x = pa.getX(i) + it.at[0], z = pa.getZ(i) + it.at[2], h = height(x, z);
      pa.setY(i, h);
      if (bare ? inPoly(x, z, bare) : isl && inPoly(x, z, isl)) cc.copy(dirt).lerp(dark, 0.08 * n(x * 0.7, z * 0.7)).lerp(grass, clamp(n(x / 6, z / 6) - 0.55, 0, 0.5));
      else { cc.copy(grass).lerp(dark, clamp(n(x / 9 + 3, z / 9) * 0.9 - 0.15, 0, 0.6)); if (h < 0.2) cc.lerp(dirt, 0.5); }
      cols[i * 3] = cc.r; cols[i * 3 + 1] = cc.g; cols[i * 3 + 2] = cc.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    var ground = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    ground.receiveShadow = true;
    g.add(ground);
    if (river) {
      var wc = document.createElement('canvas'); wc.width = wc.height = 256;
      var wg = wc.getContext('2d'), wr = rng(it.seed + 99); wg.fillStyle = '#ffffff'; wg.fillRect(0, 0, 256, 256);
      for (var wi = 0; wi < 900; wi++) { wg.fillStyle = 'rgba(' + (wr() < 0.5 ? '40,60,40' : '255,255,240') + ',' + (0.015 + wr() * 0.025).toFixed(3) + ')'; wg.beginPath(); wg.ellipse(wr() * 256, wr() * 256, 4 + wr() * 18, 2 + wr() * 6, wr() * 3, 0, 6.3); wg.fill(); }
      var wt = new T.CanvasTexture(wc); wt.wrapS = wt.wrapT = T.RepeatWrapping; wt.repeat.set(size / 70, size / 70); wt.colorSpace = T.SRGBColorSpace;
      var water = new T.Mesh(new T.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({ color: hex('water'), map: wt, roughness: 0.3, metalness: 0.05 }));
      water.position.y = 0; water.receiveShadow = true; g.add(water);
    }
    if (it.trees > 0) {
      var r = rng(it.seed * 7 + 3), tg = new T.IcosahedronGeometry(1, 1), tm = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
      var trees = new T.InstancedMesh(tg, tm, it.trees), m4 = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), sc = new T.Vector3(), tc = new T.Color(), placed = 0;
      for (var a = 0; a < it.trees * 6 && placed < it.trees; a++) {
        var tx = (r() - 0.5) * size * 0.96 + it.at[0], tz = (r() - 0.5) * size * 0.96 + it.at[2], th = height(tx, tz);
        if (th < 0.35 || (isl && lineDist(tx, tz, isl, true) < 3) || (isl && inPoly(tx, tz, isl))) continue;
        if (n(tx / 14 + 40, tz / 14) < 0.42) continue;
        var s = 1.1 + r() * 1.5;
        v.set(tx - it.at[0], th + s * 0.55, tz - it.at[2]); sc.set(s, s * (0.75 + r() * 0.3), s); m4.compose(v, q, sc);
        trees.setMatrixAt(placed, m4);
        tc.set(hex('tree')).offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.08); trees.setColorAt(placed, tc);
        placed++;
      }
      trees.count = placed; trees.castShadow = true; trees.receiveShadow = true; g.add(trees);
    }
    g.position.set(it.at[0], 0, it.at[2]);
    return { root: g, update: function (t) { var p = presence(it, t, S.type); setOpacity(g, p.a); } };
  };
  BUILD.city = function (it) {
    var g = new T.Group(), r = rng(it.seed), area = it.area, hs = it.house;
    var cx = 0, cz = 0; area.forEach(function (p) { cx += p[0]; cz += p[1]; }); cx /= area.length; cz /= area.length;
    var cellX = hs.w[1] + it.gap, cellZ = hs.d[1] + it.gap, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    area.forEach(function (p) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); });
    var cand = [];
    for (var x = minX + cellX / 2; x < maxX; x += cellX) for (var z = minZ + cellZ / 2; z < maxZ; z += cellZ) {
      var jx = x + (r() - 0.5) * it.gap * 0.6, jz = z + (r() - 0.5) * it.gap * 0.6;
      if (inPoly(jx, jz, area) && lineDist(jx, jz, area, true) > 1.3) cand.push([jx, jz, Math.hypot(jx - cx, jz - cz) + r() * Math.max(maxX - minX, maxZ - minZ) * 0.35]);
    }
    cand.sort(function (a, b) { return a[2] - b[2]; });
    var n = Math.min(it.count, cand.length), houses = [];
    for (var i = 0; i < n; i++) {
      var c = cand[i], w = lerp(hs.w[0], hs.w[1], r()), d = lerp(hs.d[0], hs.d[1], r()), h = lerp(hs.h[0], hs.h[1], r());
      var at = i < it.startCount ? -1e9 : it.atS + it.growS * (i - it.startCount + 1) / Math.max(1, n - it.startCount);
      houses.push({ x: c[0], z: c[1], w: w, d: d, h: h, rot: (r() - 0.5) * 0.1 + (r() < 0.35 ? Math.PI / 2 : 0), at: at, y: GROUND ? GROUND(c[0], c[1]) : 0 });
    }
    var wallGeo = new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), roofGeo = new T.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    // a villa: four wings around a courtyard (the Roman house); a plain house: one block under a hip roof
    var WINGS = it.style === 'villa' ? [[0, -0.29, 1, 0.42], [0, 0.31, 1, 0.38], [-0.38, 0, 0.24, 0.3], [0.38, 0, 0.24, 0.3]] : [[0, 0, 1, 1]];
    var nw = WINGS.length;
    var walls = new T.InstancedMesh(wallGeo, new T.MeshStandardMaterial({ color: hex('wall'), roughness: 0.9 }), Math.max(1, n * nw));
    var roofs = new T.InstancedMesh(roofGeo, new T.MeshStandardMaterial({ color: hex('roof'), roughness: 0.75, flatShading: true }), Math.max(1, n * nw));
    walls.castShadow = roofs.castShadow = true; walls.receiveShadow = roofs.receiveShadow = true;
    var tc = new T.Color(), m4 = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), sc = new T.Vector3(), up = new T.Vector3(0, 1, 0), off = new T.Vector3();
    houses.forEach(function (hh, i) { tc.set(hex('roof')).offsetHSL((r() - 0.5) * 0.02, (r() - 0.5) * 0.1, (r() - 0.5) * 0.1); for (var wi = 0; wi < nw; wi++) roofs.setColorAt(i * nw + wi, tc); });
    if (it.style === 'villa') {
      var yard = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({ color: hex('grass'), roughness: 1 }), Math.max(1, n));
      houses.forEach(function (hh, i) { m4.compose(v.set(hh.x, hh.y + 0.03, hh.z), q.setFromAxisAngle(up, hh.rot), sc.set(hh.w * 0.5, 1, hh.d * 0.3)); yard.setMatrixAt(i, m4); });
      yard.receiveShadow = true; g.add(yard);
      var yardOf = yard;
    }
    g.add(walls); g.add(roofs);
    var ring = null, segs = [];
    if (typeof it.wallAtS === 'number') {
      ring = new T.Group(); g.add(ring);
      var wm = new T.MeshStandardMaterial({ color: hex('wall'), roughness: 0.85 }), pts = [];
      area.forEach(function (p, j) {
        var q = area[(j + 1) % area.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]), m = Math.max(1, Math.ceil(len / it.towerEvery));
        for (var u = 0; u < m; u++) pts.push([p[0] + (q[0] - p[0]) * u / m, p[1] + (q[1] - p[1]) * u / m]);
      });
      for (var j = 0; j < pts.length; j++) {
        var a = pts[j], b = pts[(j + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        var wseg = new T.Mesh(wallGeo, wm); wseg.position.set((a[0] + b[0]) / 2, GROUND ? GROUND((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) : 0, (a[1] + b[1]) / 2);
        wseg.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); wseg.userData.len = len + 0.3; wseg.castShadow = true;
        var tw = new T.Mesh(new T.CylinderGeometry(0.85, 0.95, 1, 14).translate(0, 0.5, 0), wm); tw.position.set(a[0], GROUND ? GROUND(a[0], a[1]) : 0, a[1]); tw.castShadow = true;
        var cap = new T.Mesh(new T.ConeGeometry(1.05, 0.9, 14).translate(0, 0.45, 0), new T.MeshStandardMaterial({ color: hex('roof'), roughness: 0.7 })); cap.castShadow = true; ring.add(cap);
        ring.add(wseg); ring.add(tw); segs.push([wseg, tw, cap, a]);
      }
    }
    return { root: g, update: function (t) {
      houses.forEach(function (hh, i) {
        var k = hh.at < -1e8 ? 1 : clamp(spring(t - hh.at, S.ui), 0, 1.2);
        q.setFromAxisAngle(up, hh.rot);
        var s = Math.max(0.0001, k);
        var f = Math.min(1, 0.35 + 0.65 * s);
        for (var wi = 0; wi < nw; wi++) {
          var wg = WINGS[wi], ww = hh.w * wg[2] * f, wd = hh.d * wg[3] * f;
          off.set(wg[0] * hh.w * f, 0, wg[1] * hh.d * f).applyQuaternion(q);
          v.set(hh.x + off.x, hh.y, hh.z + off.z); sc.set(ww, hh.h * s, wd); m4.compose(v, q, sc); walls.setMatrixAt(i * nw + wi, m4);
          var rh = Math.min(ww, wd) * (nw > 1 ? 0.75 : 0.42);
          v.set(hh.x + off.x, hh.y + hh.h * s, hh.z + off.z); sc.set(ww * 1.08, rh * s, wd * 1.08); m4.compose(v, q, sc); roofs.setMatrixAt(i * nw + wi, m4);
        }
      });
      walls.instanceMatrix.needsUpdate = true; roofs.instanceMatrix.needsUpdate = true;
      walls.count = roofs.count = houses.length * nw;
      if (typeof yardOf !== 'undefined') { yardOf.count = houses.filter(function (hh) { return hh.at < -1e8 || t > hh.at + 0.15; }).length; }
      segs.forEach(function (sg, j) {
        var k = clamp(spring(t - it.wallAtS - it.wallS * j / segs.length, S.ui), 0, 1.1), s = Math.max(0.0001, k);
        sg[0].scale.set(sg[0].userData.len, it.wallHeight * s, 0.95); sg[0].visible = k > 0.001;
        sg[1].scale.set(1, it.wallHeight * 1.5 * s, 1); sg[1].visible = k > 0.001;
        sg[2].position.set(sg[3][0], sg[1].position.y + it.wallHeight * 1.5 * s, sg[3][1]); sg[2].scale.setScalar(s); sg[2].visible = k > 0.001;
      });
      setOpacity(g, presence(it, t, S.ui).a > 0 || it.startCount > 0 ? 1 : 0);
    } };
  };
`
