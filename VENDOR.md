# Vendored third-party sources

Sources copied into the repo (not installed from npm). All MIT. Upstream licence text for the ElevenLabs
components: `src/renderer/vendor/elevenlabs-ui/LICENSE`.

## ElevenLabs UI (https://github.com/elevenlabs/ui)

Pinned upstream reference: commit `3a28ebab197f8cfa599934f52db12ad1396e54f4` (main). The sources themselves
were fetched on 2026-10-19 from the shadcn registry (`https://ui.elevenlabs.io/r/<name>.json`).
LICENSE text taken from `LICENSE.md` at the pinned commit (MIT, Copyright (c) 2025 Eleven Labs Inc.).

| Component | Source | Fetched | Licence | Local path |
| --- | --- | --- | --- | --- |
| orb | https://ui.elevenlabs.io/r/orb.json | 2026-10-19 | MIT | `src/renderer/vendor/elevenlabs-ui/orb.tsx` |
| orb-lazy (Atelier addition, not upstream) | - | - | - | `src/renderer/vendor/elevenlabs-ui/orb-lazy.tsx` |
| shimmering-text | https://ui.elevenlabs.io/r/shimmering-text.json | 2026-10-19 | MIT | `src/renderer/vendor/elevenlabs-ui/shimmering-text.tsx` |
| audio-player | https://ui.elevenlabs.io/r/audio-player.json | 2026-10-19 | MIT | `src/renderer/vendor/elevenlabs-ui/audio-player.tsx` |
| scrub-bar | https://ui.elevenlabs.io/r/scrub-bar.json | 2026-10-19 | MIT | `src/renderer/vendor/elevenlabs-ui/scrub-bar.tsx` |
| waveform | https://ui.elevenlabs.io/r/waveform.json | 2026-10-19 | MIT | `src/renderer/vendor/elevenlabs-ui/waveform.tsx` |
| conversation | https://ui.elevenlabs.io/r/conversation.json | 2026-10-19 | MIT | `src/renderer/vendor/elevenlabs-ui/conversation.tsx` |
| message | https://ui.elevenlabs.io/r/message.json | 2026-10-19 | MIT | `src/renderer/vendor/elevenlabs-ui/message.tsx` |
| response | https://ui.elevenlabs.io/r/response.json | 2026-10-19 | MIT | `src/renderer/vendor/elevenlabs-ui/response.tsx` |

Public API: `src/renderer/vendor/elevenlabs-ui/index.ts`. App code must use `LazyOrb` (never import `./orb`
directly) so three.js / react-three-fiber stay in a separate chunk.

### Modifications

All files: `"use client"` removed; attribution header comment added; strict-TS fixes only where
`noUncheckedIndexedAccess` complained.

- **orb**: the upstream `useTexture("https://storage.googleapis.com/.../perlin-noise.png")` (remote, blocked by the
  renderer CSP `default-src 'self'`) is replaced by `createNoiseTexture()`, a deterministic, tileable, in-memory
  fractal value-noise `THREE.DataTexture` (256x256, no network). `@react-three/drei` is no longer imported by
  `orb.tsx`. Shader uniforms are accessed through a narrow `OrbUniforms` type cast.
- **orb-lazy** (new): `LazyOrb` = `React.lazy` + `Suspense`, with a CSS radial-gradient fallback circle built
  from the `colors` prop (`OrbFallback`).
- **shimmering-text**: upstream depends on the `motion` package, which is not installed. `motion.span` /
  `useInView` are replaced by a plain `span`, an `IntersectionObserver`, and the Web Animations API with the same
  keyframes/timing (sweep of `backgroundPosition` 100% -> 0%, linear, repeat + repeatDelay; 0.3 s fade-in).
  `inViewMargin` is now a `rootMargin` string. Props are unchanged.
- **audio-player**: `@radix-ui/react-slider` import replaced by `import { Slider as SliderPrimitive } from "radix-ui"`;
  the `exampleTracks` array (ten remote `storage.googleapis.com` mp3 URLs) is removed; `vals[0] ?? 0` guard.
  It never used `@elevenlabs/react` / `@elevenlabs/client`.
  User-visible strings (`aria-label`s, the loading text) go through `t()` from `src/shared/fr.ts` (French UI).
- **scrub-bar**: unchanged apart from the header (uses `@/components/ui/progress`).
- **waveform**: `?? 0` / optional-chaining guards for indexed access; `aria-label`s through `t()` (French); no other behaviour change. No network access, no
  `@elevenlabs/*` imports. (`LiveMicrophoneWaveform` / `MicrophoneWaveform` call `getUserMedia` only when mounted.)

## shadcn/ui (https://github.com/shadcn-ui/ui, MIT) - style `new-york-v4`

Two kinds of files live in `src/renderer/components/ui/`:

**Fetched from the shadcn registry** (`https://ui.shadcn.com/r/styles/new-york-v4/<name>.json`, 2026-10-19), imports adapted
(`cn` from `@/lib/utils`, no `"use client"`), needed by the ElevenLabs components:

| Primitive | Local path |
| --- | --- |
| progress | `src/renderer/components/ui/progress.tsx` |
| dropdown-menu | `src/renderer/components/ui/dropdown-menu.tsx` |

**Written in the shadcn/ui pattern** (class-variance-authority + `radix-ui` / `cmdk` + `cn`, following the structure and API of
the shadcn components of the same name, but restyled with Atelier's tokens and written by hand, not byte-copied):

| Primitive | Local path | Notes |
| --- | --- | --- |
| button | `button.tsx` | pill shape, Atelier variants (`default` = ink, `brand`, `secondary`, `outline`, `ghost`, `destructive`, `link`) |
| dialog | `dialog.tsx` | serif title, 20 px radius, translated close label |
| tooltip | `tooltip.tsx` | |
| command | `command.tsx` | cmdk; `CommandDialog` is a Radix dialog with the palette inside (⌘K) |
| tabs | `tabs.tsx` | segmented-pill look |
| badge | `badge.tsx` | |
| skeleton | `skeleton.tsx` | |

Not used on purpose: shadcn `sonner` (the library injects a `<style>` tag at runtime, which the strict CSP forbids: Atelier has its
own small toast store in `src/renderer/lib/toast.tsx`) and Radix `ScrollArea` (same reason).

The shadcn/ui MIT licence text is in `src/renderer/components/ui/LICENSE`. `src/renderer/lib/utils.ts` (`cn`) is Atelier's own.

## Other npm dependencies added by the design system (installed, not vendored)

tailwindcss + @tailwindcss/vite (MIT), radix-ui (MIT), cmdk (MIT), lucide-react (ISC), class-variance-authority (Apache-2.0),
clsx (MIT), tailwind-merge (MIT), use-stick-to-bottom (MIT, lot 12), three + @react-three/fiber (MIT), fonts via @fontsource packages (Inter, JetBrains Mono,
Instrument Serif: all OFL-1.1, bundled locally, no CDN).

## Methods adapted from rea-video (not vendored)

rea-video (https://github.com/JuneYaooo/rea-video, commit `c9359c4`, Apache-2.0, Copyright 2026 JuneYaooo) was studied in
chantier rea-video (`docs/research/rea-video-2026-11.md`, decision 0110). No file was copied: Apache-2.0 would allow it, but
the tool is Python + OpenCV + ONNX models and Atelier's engine is TypeScript on ffmpeg. Two of its METHODS are re-implemented
in our own code, with our own thresholds calibrated on our references:

| Method | Where in Atelier |
| --- | --- |
| The palette size (4-bit colours covering 95 % of the pixels) as the pixel test of a rendered picture, and the rule that pixel forensics decide what they can prove while the vision model decides the rest | `src/engine/watch/forensics.ts`, `src/main/production/clone/analysis/forensic-guard.ts` |
| A per-shot production-method taxonomy with a remake route for each method | `src/main/production/clone/definition/how-made.ts` |

## Files over the ~550-line guideline

Vendored upstream files are kept as they are rather than split: `waveform.tsx` (1659 lines), `audio-player.tsx` (602), `orb.tsx` (559).
