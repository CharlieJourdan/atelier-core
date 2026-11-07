# Fonts

The fonts the production engine draws with (burned-in captions and labels, demo pictures, the DÉMO mark).

| File | Family (as libass sees it) | Use |
|---|---|---|
| `Inter-Bold.ttf` | `Inter`, bold | captions, demo pictures, DÉMO mark |
| `Inter-SemiBold.ttf` | `Inter SemiBold` | labels (names, places, dates, figures) |
| `Oswald-SemiBold.ttf`, `Oswald-Bold.ttf` | `Oswald` 600 / 700 | the channel promo's condensed titles, URL and labels (motion) |
| `SourceSerif4-Regular.ttf` | `Source Serif 4` 400 | the channel promo's serif line (motion) |
| `Montserrat-ExtraBold.ttf` | `Montserrat ExtraBold` | the one-word captions of a story short (`word` preset) |

- **Source:** Inter 4.1 by The Inter Project Authors, release archive `Inter-4.1.zip` of https://github.com/rsms/inter
  (files `extras/ttf/Inter-Bold.ttf` and `extras/ttf/Inter-SemiBold.ttf`, unmodified), fetched on 2026-10-20 for lot P4.
- **Licence:** SIL Open Font License 1.1, full text in `OFL-Inter.txt`. It allows use, embedding and redistribution,
  including in software that is sold, as long as the fonts are not sold on their own and the licence travels with them
  (PLAN-V2-PRODUCTION §3: OFL fonts only).
- ffmpeg's `ass` filter needs real TrueType/OpenType files (the WOFF2 files of the app's UI fonts do not load in
  libass), which is why these two files are here rather than taken from `node_modules/@fontsource*`.
- **Oswald and Source Serif 4** (promo-motion, 2026-11-01): from the Google Fonts repository
  (`ofl/oswald/Oswald[wght].ttf`, `ofl/sourceserif4/SourceSerif4[opsz,wght].ttf`, https://github.com/google/fonts),
  instanced with fontTools (Oswald at wght 600 and 700; Source Serif 4 at wght 400, opsz 20) and subset to Latin and
  Latin-1 with the French punctuation, so a promo page embeds about 150 KB. SIL Open Font License 1.1: `OFL-Oswald.txt`,
  `OFL-SourceSerif4.txt`. They are the closest free faces to the channel promo of the reference (decision 0050).
- **Documentary cards** (style-markets, `docFontCssOf` in `src/engine/motion/fonts.ts`): the serif of names, labels, quotes and word punches is
  Source Serif 4. The cards ask for its **italic** (`SourceSerif4-Italic.ttf`) and **semibold** (`SourceSerif4-SemiBold.ttf`); both files are
  optional, and until they are added here (from the official release of https://github.com/adobe-fonts/source-serif, same instancing and
  Latin subset as the regular file, SIL OFL 1.1, `OFL-SourceSerif4.txt` already covers them) the browser draws a synthetic italic and the
  regular weight. Nothing else needs to change when they arrive.
- **Montserrat ExtraBold** (clone-reddit-shorts, 2026-11-02): `fonts/ttf/Montserrat-ExtraBold.ttf` of the official repository
  https://github.com/JulietaUla/Montserrat (unmodified), the closest free face to a story channel's captions (glyphs and widths
  measured, research note style-redditchroniques-2026-11 (old repository)). SIL Open Font License 1.1: `OFL-Montserrat.txt`.
