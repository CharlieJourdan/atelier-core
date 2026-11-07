// Synthesises the three instrumental beds of resources/music/ (CC0): `reflective`, `tension`, `hopeful`.
// Original music made of plain sines, ADSR envelopes and a feedback echo; nothing is sampled or borrowed.
// Deterministic (no randomness at all: the same bytes of PCM every run) and seamlessly loopable: every note and every
// echo wraps around the end of the loop, so the last sample flows into the first one.
// Needs only the system ffmpeg (spawned without a shell). Usage: node scripts/make-music.mjs [outDir]
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 48000
const TARGET_LUFS = -20
const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(process.argv[2] ?? path.join(here, '..', 'resources', 'music'))

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12)

/** A loop: two channels of doubles whose index wraps around. */
const makeLoop = (seconds) => {
  const n = Math.round(seconds * SR)
  return { n, l: new Float64Array(n), r: new Float64Array(n) }
}

/**
 * Adds one note into the loop (wrapping past the end). Envelope: smooth attack `a`, exponential decay to `sus` with
 * time constant `d`, held until `dur`, then an exponential release `rel` that ends at zero.
 */
function note(loop, o) {
  const { t, dur, midi, amp, partials, pan = 0, a = 0.02, d = 1, sus = 1, rel = 0.5, detune = [0] } = o
  const total = dur + rel
  const len = Math.floor(total * SR)
  const start = Math.round(t * SR)
  const gl = Math.cos(((pan + 1) * Math.PI) / 4)
  const gr = Math.sin(((pan + 1) * Math.PI) / 4)
  const base = midiHz(midi)
  const level = (tt) => {
    const att = tt < a ? 0.5 - 0.5 * Math.cos((Math.PI * tt) / a) : 1
    return att * (sus + (1 - sus) * Math.exp(-Math.max(0, tt - a) / d))
  }
  const endLevel = level(dur)
  const norm = amp / detune.length
  for (let s = 0; s < len; s++) {
    const tt = s / SR
    const env = tt < dur ? level(tt) : endLevel * Math.exp(-((tt - dur) * 5) / rel) * (1 - (tt - dur) / rel)
    let v = 0
    for (const c of detune) {
      const f = base * 2 ** (c / 1200)
      for (const [ratio, pa] of partials) v += pa * Math.sin(2 * Math.PI * f * ratio * tt)
    }
    const idx = (start + s) % loop.n
    loop.l[idx] += v * env * norm * gl
    loop.r[idx] += v * env * norm * gr
  }
}

/** y[i] = x[i] + fb * y[i - d] with wrap-around (the periodic solution: two passes converge for fb < 1). */
function recursiveDelay(x, d, fb) {
  const n = x.length
  const y = Float64Array.from(x)
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) y[i] = x[i] + fb * y[(i - d + n) % n]
  }
  return y
}

/** Feedback echo (wet added to the dry) per channel, with different delay times left and right. */
function echo(loop, dl, dr, fb, mix) {
  for (const [ch, d] of [[loop.l, dl], [loop.r, dr]]) {
    const y = recursiveDelay(ch, Math.round(d * SR), fb)
    for (let i = 0; i < ch.length; i++) ch[i] += mix * (y[i] - ch[i])
  }
}

/** A small diffuse room: a few short feedback combs averaged. */
function room(loop, mix) {
  for (const [ch, shift] of [[loop.l, 0], [loop.r, 0.0013]]) {
    const wet = new Float64Array(ch.length)
    for (const d of [0.0297, 0.0371, 0.0411, 0.0437]) {
      const y = recursiveDelay(ch, Math.round((d + shift) * SR), 0.6)
      for (let i = 0; i < ch.length; i++) wet[i] += (y[i] - ch[i]) / 4
    }
    for (let i = 0; i < ch.length; i++) ch[i] += mix * wet[i]
  }
}

/** One-pole low-pass, circular (no highs above a soft cut, nothing harsh). */
function lowpass(ch, fc) {
  const k = 1 - Math.exp((-2 * Math.PI * fc) / SR)
  let y = 0
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < ch.length; i++) ch[i] = y += k * (ch[i] - y)
}

const PAD = [[1, 1], [2, 0.3], [3, 0.1], [4, 0.04]]
const PLUCK = [[1, 1], [2, 0.3], [3, 0.1], [4, 0.03]]
const SINE = [[1, 1], [2, 0.12]]
const DRONE = [[1, 1], [2, 0.45], [3, 0.25], [4, 0.12], [5, 0.06]]
const BELL = [[1, 1], [2.76, 0.4], [5.4, 0.15]]

function reflective() {
  const B = 60 / 64
  const bar = 4 * B
  const loop = makeLoop(12 * bar)
  const chords = [[45, 57, 60, 64, 67], [41, 53, 57, 60, 64], [48, 55, 60, 64, 71], [43, 55, 59, 62, 66]]
  for (let b = 0; b < 12; b++) {
    const ch = chords[b % 4]
    for (const m of ch) note(loop, { t: b * bar, dur: bar, midi: m, amp: 0.07, partials: PAD, a: 1.4, rel: 1.8, detune: [-6, 6] })
    const pattern = [1, 2, 3, 4, 3, 2, 3, 2]
    for (let q = 0; q < 4; q++) {
      const up = b >= 4 ? 12 : 0
      const m = ch[1 + (pattern[(b * 4 + q) % 8] - 1) % 4] + up
      note(loop, { t: b * bar + q * B, dur: 1.2, midi: m, amp: 0.09, partials: PLUCK, a: 0.01, d: 0.6, sus: 0, rel: 0.5, pan: q % 2 ? 0.35 : -0.35 })
    }
  }
  ;[[8, 76], [9, 77], [10, 76], [11, 74]].forEach(([b, m]) => {
    note(loop, { t: b * bar + B, dur: 2.5, midi: m, amp: 0.08, partials: SINE, a: 0.06, d: 1.6, sus: 0.1, rel: 1.5, pan: 0.2 })
  })
  echo(loop, 0.75 * B * 2, 0.75 * B * 3, 0.42, 0.45)
  room(loop, 0.5)
  return loop
}

function tension() {
  const B = 60 / 72
  const bar = 4 * B
  const loop = makeLoop(12 * bar)
  const drones = [[38, 45, 50, 53], [34, 41, 50, 53], [43, 50, 55, 58]]
  drones.forEach((ch, i) => {
    for (const m of ch) note(loop, { t: i * 4 * bar, dur: 4 * bar, midi: m, amp: 0.08, partials: DRONE, a: 3, rel: 3.5, detune: [-9, 8] })
  })
  for (let b = 0; b < 12; b++) {
    for (let q = 0; q < 4; q++) {
      note(loop, { t: b * bar + q * B, dur: 0.3, midi: 38, amp: q === 0 ? 0.4 : 0.2, partials: [[1, 1], [2, 0.3]], a: 0.012, d: 0.16, sus: 0, rel: 0.25 })
    }
  }
  ;[[1, 2, 77], [4, 0, 81], [6, 3, 82], [9, 1, 76], [11, 2, 77]].forEach(([b, q, m], i) => {
    note(loop, { t: b * bar + q * B, dur: 3.5, midi: m, amp: 0.06, partials: BELL, a: 0.01, d: 1.4, sus: 0, rel: 1.5, pan: i % 2 ? 0.5 : -0.5 })
  })
  echo(loop, 1.5 * B, 2.5 * B, 0.45, 0.45)
  room(loop, 0.6)
  return loop
}

function hopeful() {
  const B = 60 / 90
  const bar = 4 * B
  const loop = makeLoop(16 * bar)
  const chords = [[48, 60, 64, 67], [43, 59, 62, 67], [45, 60, 64, 69], [41, 60, 65, 69]]
  const steps = [0.12, 0, 0.07, 0.09, 0, 0.08, 0.07, 0]
  const lead = [79, 74, 76, 72]
  for (let b = 0; b < 16; b++) {
    const ch = chords[b % 4]
    for (const m of ch) note(loop, { t: b * bar, dur: bar, midi: m, amp: 0.07, partials: PAD.slice(0, 3), a: 0.8, rel: 1.2, detune: [-5, 5] })
    for (const q of [0, 2]) note(loop, { t: b * bar + q * B, dur: 1.4, midi: ch[0] - 12, amp: 0.16, partials: SINE, a: 0.03, d: 0.9, sus: 0.2, rel: 0.4 })
    steps.forEach((amp, e) => {
      if (amp === 0) return
      const m = ch[1 + ([1, 2, 3, 2, 1, 2, 3, 2][e] - 1) % 3] + 12
      note(loop, { t: b * bar + e * (B / 2), dur: 0.8, midi: m, amp, partials: PLUCK, a: 0.008, d: 0.3, sus: 0, rel: 0.3, pan: e % 2 ? 0.4 : -0.4 })
    })
    if (b >= 8) note(loop, { t: b * bar, dur: 2, midi: lead[b % 4], amp: 0.07, partials: SINE, a: 0.05, d: 1.2, sus: 0.15, rel: 1.2, pan: 0.15 })
  }
  echo(loop, 0.75 * B, 1.25 * B, 0.38, 0.4)
  room(loop, 0.4)
  return loop
}

const TRACKS = [
  { id: 'atelier-reflective-1', file: 'reflective-1.m4a', title: 'Lueur lente', mood: 'reflective', build: reflective },
  { id: 'atelier-tension-1', file: 'tension-1.m4a', title: 'Pouls sourd', mood: 'tension', build: tension },
  { id: 'atelier-hopeful-1', file: 'hopeful-1.m4a', title: 'Matin clair', mood: 'hopeful', build: hopeful }
]

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw new Error(`ffmpeg could not start: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-1500)}`)
  return r.stderr
}

function measure(args) {
  const err = ffmpeg([...args, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'])
  const j = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1))
  return { lufs: Number(j.input_i), peak: Number(j.input_tp) }
}

function render(track, tmp) {
  const loop = track.build()
  lowpass(loop.l, 5000)
  lowpass(loop.r, 5000)
  let peak = 0
  for (let i = 0; i < loop.n; i++) peak = Math.max(peak, Math.abs(loop.l[i]), Math.abs(loop.r[i]))
  const k = 0.5 / peak
  const pcm = Buffer.alloc(loop.n * 8)
  for (let i = 0; i < loop.n; i++) {
    pcm.writeFloatLE(loop.l[i] * k, i * 8)
    pcm.writeFloatLE(loop.r[i] * k, i * 8 + 4)
  }
  const raw = path.join(tmp, `${track.mood}.f32`)
  writeFileSync(raw, pcm)
  const input = ['-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', raw]
  const before = measure(input)
  const gain = TARGET_LUFS - before.lufs
  const out = path.join(outDir, track.file)
  ffmpeg([
    '-y', ...input, '-af', `volume=${gain.toFixed(3)}dB`, '-c:a', 'aac', '-b:a', '160k', '-ar', String(SR), '-ac', '2',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    '-metadata', `title=${track.title}`, '-metadata', 'artist=Atelier (scripts/make-music.mjs)', '-metadata', 'comment=CC0-1.0',
    '-movflags', '+faststart', out
  ])
  const after = measure(['-i', out])
  console.log(
    `${track.file}: ${(loop.n / SR).toFixed(3)} s, gain ${gain.toFixed(2)} dB, ${after.lufs.toFixed(2)} LUFS, ` +
      `true peak ${after.peak.toFixed(2)} dBTP, ${statSync(out).size} bytes`
  )
  return { durationS: Math.round((loop.n / SR) * 1000) / 1000 }
}

mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'atelier-music-'))
try {
  const tracks = TRACKS.map((t) => {
    const { durationS } = render(t, tmp)
    return {
      id: t.id, file: t.file, title: t.title, mood: t.mood, durationS, loop: true, licence: 'CC0-1.0',
      author: 'Atelier (scripts/make-music.mjs)', lufs: TARGET_LUFS
    }
  })
  writeFileSync(path.join(outDir, 'library.json'), `${JSON.stringify({ tracks }, null, 2)}\n`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
