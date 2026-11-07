# Atelier sound-effects library

Real recorded sound effects for the editing kit (`src/engine/media/sfx.ts`): `whoosh`, `whoosh-soft`, `paper`, `click`,
`tick`, `pop`, `impact`, `stamp`, `riser`. Each kind holds several recordings (4 to 8); for every event the engine picks
one by the film's seed, never the file the previous event of that kind used (nor the last two when the kind has three or
more), and varies it a little (gain ±2 dB, speed ±4 %), so a film never hears the same sample twice in a row.

Synthesised effects (`src/engine/media/sfx-synth.ts`) are **opt-in only** (`allowSynth`, node param `sfxSynth` of
`edit.fx@1`). By default an event whose kind has no recording here is dropped, and the node logs a warning.

## How it is filled

`scripts/sfx-library-fetch.ts` builds this folder; do not edit the sounds by hand:

```
node --import ./scripts/ts-resolve.mjs scripts/sfx-library-fetch.ts [--source keyless|freesound|both] [--per-kind 6]
```

It searches the sources, reads each recording's licence at the source, downloads (cached in
`$ATELIER_INPUTS/tests-2026-11/motion/sfx-cache/` (default: a folder under the temp directory, outside git), cuts every take of a recording apart, measures
each cut (length, attack, where its peak sits, spectral centroid, low-band share, clipping, whether it dies away) and keeps
only cuts that look like their kind, at most two per recording and kind. The kept cuts are faded, peak-normalised to
-1 dBFS and stored as 48 kHz mono Ogg Vorbis. It also writes a listening report (one WAV per kind playing all its sounds)
to `$ATELIER_INPUTS/tests-2026-11/motion/sfx-library/`.

Sources: Freesound (only with `FREESOUND_API_KEY` in the environment; CC0 and CC BY), and keyless: the Internet Archive's
CC0 sound-effect collections (The Designer's Choice UCS packs by Nicholas A. Judy; the USC Cinema / Sunset Editorial
archive) and Wikimedia Commons (Gravity Sound, CC BY 4.0). Risers are cymbal rolls, crashes and hits played backwards.

## `library.json`

```json
{
  "version": 1,
  "sounds": [
    {
      "id": "whoosh-1", "kind": "whoosh", "file": "whoosh-1.ogg", "licence": "CC0-1.0",
      "author": "…", "title": "…", "source": "https://…", "credit": "… — …, CC0 1.0, via Internet Archive (cut)",
      "peakS": 0.21, "durationS": 0.62, "centroidHz": 2400
    }
  ]
}
```

`file` is relative to this folder (no `..`). `peakS` is the sound's key moment in seconds from the start of the file (the
attack of a hit, the loudest point of a whoosh or paper, the end of a riser): the engine puts that moment on the target time.

## Licence rule

Only `CC0-1.0`, `PD` (public domain) or CC BY (`CC-BY-2.0` … `CC-BY-4.0`); never NC, ND, SA, Sampling+ or an unclear
licence (the schema refuses them). A CC BY sound must carry `author`, `source` and `credit`; `CREDITS.md` lists every sound
with its author, title, licence and link, and a film that uses a CC BY sound credits it with its `credit` line. The whole
folder stays under 4 MB.
