#!/usr/bin/env python
"""Builds resources/maps/ for the map card (src/engine/motion/geo.ts) from public-domain sources.

    python -I scripts/maps-build.py <source folder> [--out resources/maps]

The source folder holds (see resources/maps/README.md for where to download them):
  bluemarble.jpg                              NASA Blue Marble Next Generation, world.topo.bathy.200412, 5400x2700
  ne50/ne_50m_admin_0_countries.{shp,dbf}     Natural Earth 1:50m countries

Writes earth.jpg (equirectangular, <= 4 MB), countries.json (every country, rings simplified and quantised) and keeps the README.
Needs Pillow only; the shapefile is read by a small reader of ours (no pyshp). Re-runnable: the outputs are overwritten.
"""
import argparse
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image

EARTH_SIZE = (5400, 2700)
EARTH_QUALITY = 85
SIMPLIFY_DEG = 0.02
QUANT = 100  # coordinates are stored as integers of 0.01 degree


def read_dbf(path):
    data = path.read_bytes()
    n, head, rec = struct.unpack('<xxxxIHH', data[:12])
    fields = []
    pos = 32
    while data[pos] != 0x0D:
        name = data[pos:pos + 11].split(chr(0).encode())[0].decode('ascii')
        fields.append((name, data[pos + 16]))
        pos += 32
    rows = []
    for i in range(n):
        raw = data[head + i * rec: head + (i + 1) * rec]
        off = 1
        row = {}
        for name, size in fields:
            row[name] = raw[off:off + size].split(chr(0).encode())[0].decode('utf-8', 'replace').strip()
            off += size
        rows.append(row)
    return rows


def read_shp(path):
    """Polygon shapes only: a list (one per record) of lists of rings (each an (n, 2) float array, lon/lat)."""
    data = path.read_bytes()
    pos = 100
    shapes = []
    while pos < len(data):
        _, clen = struct.unpack('>ii', data[pos:pos + 8])
        body = data[pos + 8: pos + 8 + clen * 2]
        pos += 8 + clen * 2
        stype = struct.unpack('<i', body[:4])[0]
        if stype == 0:
            shapes.append([])
            continue
        if stype not in (5, 15, 25):
            raise ValueError(f'shape type {stype} is not a polygon')
        nparts, npts = struct.unpack('<ii', body[36:44])
        parts = list(struct.unpack(f'<{nparts}i', body[44:44 + 4 * nparts])) + [npts]
        pts = np.frombuffer(body, dtype='<f8', count=npts * 2, offset=44 + 4 * nparts).reshape(npts, 2)
        shapes.append([pts[parts[i]:parts[i + 1]] for i in range(nparts)])
    return shapes


def simplify(points, eps):
    """Douglas-Peucker on an (n, 2) array; returns the kept points (ends always kept)."""
    n = len(points)
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = points[a], points[b]
        seg = q - p
        length = np.hypot(*seg)
        mid = points[a + 1:b]
        if length == 0:
            d = np.hypot(mid[:, 0] - p[0], mid[:, 1] - p[1])
        else:
            d = np.abs(seg[0] * (mid[:, 1] - p[1]) - seg[1] * (mid[:, 0] - p[0])) / length
        i = int(np.argmax(d))
        if d[i] > eps:
            k = a + 1 + i
            keep[k] = True
            stack.append((a, k))
            stack.append((k, b))
    return points[keep]


def ring_ints(ring):
    """A ring simplified, quantised, deduplicated, then delta-coded: [x0, y0, dx1, dy1, ...] (integers of 0.01 degree)."""
    pts = simplify(ring, SIMPLIFY_DEG)
    q = np.rint(pts * QUANT).astype(np.int64)
    keep = np.ones(len(q), dtype=bool)
    keep[1:] = np.any(q[1:] != q[:-1], axis=1)
    q = q[keep]
    if len(q) < 4:  # a ring needs a triangle at least (closing point included)
        return None
    d = np.diff(q, axis=0)
    return [int(q[0][0]), int(q[0][1])] + [int(v) for v in d.reshape(-1)]


def area_km2(ring):
    """Approximate area of a ring in km2 (x scaled by the cosine of its mean latitude), to tell a mainland from far-away islands."""
    x = ring[:, 0] * np.cos(np.radians(ring[:, 1].mean()))
    y = ring[:, 1]
    return abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))) / 2 * 111.0 ** 2


def bbox_of(rings):
    pts = np.concatenate(rings)
    return [round(float(pts[:, 0].min()), 2), round(float(pts[:, 1].min()), 2), round(float(pts[:, 0].max()), 2), round(float(pts[:, 1].max()), 2)]


def build_countries(src, out):
    rows = read_dbf(src / 'ne50' / 'ne_50m_admin_0_countries.dbf')
    shapes = read_shp(src / 'ne50' / 'ne_50m_admin_0_countries.shp')
    assert len(rows) == len(shapes)
    countries = []
    for row, rings in zip(rows, shapes):
        iso = row.get('ISO_A3', '')
        if iso in ('', '-99'):
            iso = row.get('ADM0_A3', '')
        name = row.get('NAME_EN') or row.get('NAME') or iso
        alts = []
        for key in ('ADMIN', 'NAME_LONG', 'FORMAL_EN', 'NAME'):
            v = row.get(key, '')
            if v and v != name and v not in alts:
                alts.append(v)
        coded = [r for r in (ring_ints(ring) for ring in rings if len(ring) >= 4) if r]
        if not coded:
            continue
        big = [r for r in rings if len(r) >= 4]
        areas = [area_km2(r) for r in big]
        # `main`: the box of the mainland (rings of at least a quarter of the largest), so a far-away territory does not stretch a default view
        main = [r for r, a in zip(big, areas) if a >= 0.25 * max(areas)]
        countries.append({'iso': iso, 'name': name, 'fr': row.get('NAME_FR') or name, 'alt': alts, 'bbox': bbox_of(big), 'main': bbox_of(main), 'rings': coded})
    doc = {
        'format': 'rings are delta-coded integers of 0.01 degree: [lon0, lat0, dlon1, dlat1, ...]; bbox and main are [west, south, east, north] in degrees (main: the mainland only)',
        'source': 'Natural Earth 1:50m Admin 0 Countries (public domain), rings simplified at %.2f degree' % SIMPLIFY_DEG,
        'countries': countries,
    }
    target = out / 'countries.json'
    target.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'countries.json: {len(countries)} countries, {target.stat().st_size / 1e6:.2f} MB')


def build_earth(src, out):
    img = Image.open(src / 'bluemarble.jpg').convert('RGB')
    if img.size != EARTH_SIZE:
        img = img.resize(EARTH_SIZE, Image.LANCZOS)
    target = out / 'earth.jpg'
    img.save(target, 'JPEG', quality=EARTH_QUALITY, optimize=True, progressive=False, subsampling=0)
    size = target.stat().st_size
    assert size <= 4_000_000, f'earth.jpg is {size} bytes'
    print(f'earth.jpg: {img.size[0]}x{img.size[1]}, {size / 1e6:.2f} MB')


def main():
    ap = argparse.ArgumentParser(description='Builds resources/maps/ from public-domain sources.')
    ap.add_argument('source', type=Path, help='folder holding bluemarble.jpg and ne50/')
    ap.add_argument('--out', type=Path, default=Path(__file__).resolve().parent.parent / 'resources' / 'maps')
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    build_earth(a.source, a.out)
    build_countries(a.source, a.out)


if __name__ == '__main__':
    main()
