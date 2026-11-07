# resources/maps

The data behind the documentary map card (`src/engine/motion/geo.ts`, `src/engine/motion/map-card.ts`). Everything here is
public domain. Rebuild with `python -I scripts/maps-build.py <source folder>`.

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `earth.jpg` | The Earth, equirectangular, 5400 x 2700 (lon -180..180, lat 90..-90), JPEG q85 | NASA Blue Marble Next Generation, `world.topo.bathy.200408` (August 2004 land colours + bathymetry), `https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73776/world.topo.bathy.200408.3x5400x2700.jpg` | Public domain (NASA) |
| `countries.json` | Every country of the world: ISO code, English and French names, other names, bounding box (`bbox`) and mainland box (`main`), rings | Natural Earth 1:50m Admin 0 Countries, `https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip` | Public domain (Natural Earth) |

## countries.json

Rings are simplified (Douglas-Peucker, 0.02 degree) and quantised to 0.01 degree. Each ring is a flat list of integers,
delta-coded: `[lon0, lat0, dlon1, dlat1, ...]` in hundredths of a degree. `bbox` and `main` are `[west, south, east, north]` in
degrees; `main` leaves out far-away territories (French Guiana is not in France's `main`), so a default view is not stretched.

## Sharp pictures (optional, downloaded on demand)

The bundled picture has 15 pixels a degree, soft for a view narrower than ~100 degrees. When the host gives a cache folder,
`prepareMapAssets` asks NASA's GIBS web map service (`https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi`, layer
`BlueMarble_ShadedRelief_Bathymetry`, the same Blue Marble at about 220 pixels a degree, public domain) for exactly the box the camera
needs (one JPEG of 0.3 to 1 MB per box, kept in the cache folder), and for a second, sharper picture of where the camera arrives.
Offline, or when GIBS refuses, the bundled `earth.jpg` is used and the assets carry a warning. (NASA's 21600 x 21600 tiles of
the same picture cannot be cropped: ffmpeg refuses a picture that large.)

## Credit

Map imagery: NASA Earth Observatory (Blue Marble Next Generation, Reto Stockli, NASA Goddard Space Flight Center).
Borders: Natural Earth (naturalearthdata.com).
