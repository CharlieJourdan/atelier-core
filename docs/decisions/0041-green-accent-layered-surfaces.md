# 0041 — One calm green accent and layered, warmer surfaces

Date: 2026-11-01 · Chantier: ui-couleur · Status: accepted · Decided by: Charlie (his words of 11-01). Replaces the earlier rule « ink as the single accent, no brand hue ».

## Context
Charlie (11-01) on the UI: « c'est pas mal mais pas encore incroyable, car tout est en noir et blanc sans trop de relief.
Essaie d'y ajouter un tout petit peu plus de couleur, genre du vert ou quoi, mais que ça reste premium et que ça suive
OpenAI / ChatGPT et Apple en termes de design. » The proto refresh (10-24) had made ink (white on dark, black on light)
the only accent; surfaces were near-identical greys and cards had no shadow.

## Decision
1. **One accent, a calm jade green, on `--brand`.** Dark `#38b883` (text on it `--brand-ink` `#06140d`, 7.5:1), light
   `#0d7a52` (white on it, 5.4:1). `--brand-fg` is the green used as text (≥ 4.5:1 on every surface, both themes),
   `--brand-soft` a 11–14 % tint for selected rows, badges and the user's chat bubble, `--brand-line` its outline.
   `--ok` is the same green, so success and the accent are one colour. `--ring`, `--primary` and `--progress` point at
   it. No second accent; the channel identity colours (`--ch-*`) stay as they were.
2. **Where the green goes (sparingly):** primary buttons (`Button` default and `brand`, « Nouvelle vidéo »), active
   item of the main sidebar (tint + green icon), count badges, focus rings, switches when on, progress bars and rings,
   send buttons, the user's avatar in Messages, today and the « now » line in Planning, the revenue curve in
   Monétisation, links. Secondary navigation (Réglages' column, top tabs) stays neutral, so the hierarchy reads.
3. **Ink stays** a neutral strong mark (`bg-ink` where a screen wants black/white on purpose). A `neutral` button variant
   keeps the old ink button. A disabled green button turns grey, not pale green.
4. **Layered, warmer neutrals:** sidebar < canvas < card < raised < popover are distinct steps (dark `#111110` /
   `#161615` / `#1c1c1b` / `#232322` / `#252524`; light `#f3f2f0` / `#fafaf9` / `#ffffff` / `#f2f1ee` / `#ffffff`),
   warm (stone) greys, hairlines in low-alpha white or warm black.
5. **Relief:** `.card` has a hairline plus `--shadow-card` (a 1 px top highlight and a soft drop in dark, a very soft
   drop in light), `card-hover` lifts to `--shadow-card-hover`; segmented controls and top tabs show the active segment
   as a raised pill (Apple); menus and toasts are translucent and blurred (`.glass`, pure CSS `backdrop-filter`, CSP
   safe); dialogs use `--shadow-modal` over a blurred scrim. Page titles 26 px, tracking −0.026em. Hover/press
   transitions 150 ms; `prefers-reduced-motion` still cuts them (app.css).
6. **Not done on purpose:** the sidebar and top bar are not translucent: nothing scrolls under them in this layout, so a
   blur would show nothing. Production screens (owned by another chantier) only receive the tokens and shared
   primitives; their own `bg-ink` stays neutral until that chantier adopts `bg-brand`.

## Consequences
- `tests/unit/tokens-contrast.test.ts` checks the green as text and under its text in both themes;
  `tests/unit/design-system.test.tsx` pins the new key values.
- New code: primary action → `Button` (default) or `bg-brand text-brand-ink`; selected row → `bg-brand-soft`; green text →
  `text-brand-fg`; neutral black/white → `bg-ink text-ink-fg`.
