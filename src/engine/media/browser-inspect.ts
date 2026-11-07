// What a sandboxed page shows, measured in the page itself (docs/ENGINE-SPEC.md §25.2): every run of text with its box, size, colour, the
// colour behind it, whether a shadow or an outline carries it, whether it overflows its box or leaves a box that clips it, and its opacity at
// the current time. The lint of a custom brick (motion/brick-lint.ts) turns these facts into pass / fail rules. Plain JavaScript in a string,
// evaluated as an expression (a compiled function's source could carry the build's helpers, which the page does not have).
export const INSPECT = String.raw`(() => {
  var out = [], seen = [], W = window.innerWidth, H = window.innerHeight;
  var clear = function (c) { return !c || c === 'transparent' || /^rgba\([^)]*,\s*0\)$/.test(c); };
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (var n = walker.nextNode(); n && out.length < 80; n = walker.nextNode()) {
    var el = n.parentElement;
    if (!el || seen.indexOf(el) >= 0 || !n.textContent || !n.textContent.trim()) continue;
    if (el.closest('script,style,head')) continue;
    seen.push(el);
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, text = '';
    for (var k = 0; k < el.childNodes.length; k++) {
      var c = el.childNodes[k];
      if (c.nodeType !== 3 || !c.textContent.trim()) continue;
      text += c.textContent;
      var r = document.createRange(); r.selectNodeContents(c);
      var rects = r.getClientRects();
      for (var q = 0; q < rects.length; q++) {
        var b = rects[q]; if (b.width === 0 && b.height === 0) continue;
        x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom);
      }
    }
    if (!isFinite(x0)) continue;
    var cs = getComputedStyle(el), op = 1;
    for (var a = el; a; a = a.parentElement) {
      var s = getComputedStyle(a);
      op *= parseFloat(s.opacity);
      if (s.visibility === 'hidden' || s.display === 'none') op = 0;
    }
    var backing = null;
    for (var a2 = el; a2; a2 = a2.parentElement) {
      var s2 = getComputedStyle(a2);
      if (s2.backgroundImage && s2.backgroundImage !== 'none') { backing = 'image'; break; }
      if (!clear(s2.backgroundColor)) { backing = s2.backgroundColor; break; }
    }
    var stroke = parseFloat(cs.getPropertyValue('-webkit-text-stroke-width') || '0');
    var shadow = (cs.textShadow && cs.textShadow !== 'none') || stroke > 0;
    var clipped = el.clientWidth > 0 && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    if (x0 < -1 || y0 < -1 || x1 > W + 1 || y1 > H + 1) clipped = true;
    // a glyph's box is taller than a tight line (accents, descenders): the vertical tests allow a quarter of the font size
    var slack = Math.max(2, parseFloat(cs.fontSize) * 0.25);
    for (var a3 = el; a3 && !clipped; a3 = a3.parentElement) {
      if (a3 === document.body || a3 === document.documentElement) break;
      var s3 = getComputedStyle(a3);
      var boxed = s3.overflowX !== 'visible' || s3.overflowY !== 'visible' || !clear(s3.backgroundColor) || (s3.backgroundImage && s3.backgroundImage !== 'none');
      if (!boxed) continue;
      var br = a3.getBoundingClientRect();
      if (br.width === 0 || br.height === 0) continue;
      if (x0 < br.left - 1 || x1 > br.right + 1 || y0 < br.top - slack || y1 > br.bottom + slack) clipped = true;
    }
    out.push({ text: text.trim().replace(/\s+/g, ' ').slice(0, 60), x: x0, y: y0, w: x1 - x0, h: y1 - y0, fontPx: parseFloat(cs.fontSize), color: cs.color, backing: backing, shadow: !!shadow, clipped: clipped, opacity: op });
  }
  return { texts: out };
})()`
