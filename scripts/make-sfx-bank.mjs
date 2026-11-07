// `node scripts/make-sfx-bank.mjs <dir>`: synthesises a starter CC0 sound-effect bank with the system ffmpeg (our own synthesis, so
// CC0) and writes `<dir>/bank.json` for the sourcing module's `localBank(dir)`. Free, offline, ~1 s. Re-running overwrites.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/make-sfx-bank.mjs <dir>')
  process.exit(2)
}
mkdirSync(dir, { recursive: true })

// [file, title, tags, duration, lavfi graph]
const SOUNDS = [
  ['whoosh-1.wav', 'Whoosh, soft transition', ['whoosh', 'swoosh', 'transition', 'swipe', 'wind'], 0.9, 'anoisesrc=color=pink:duration=0.9:amplitude=0.6,highpass=f=250,lowpass=f=5500,afade=t=in:d=0.4,afade=t=out:st=0.4:d=0.5'],
  ['whoosh-2.wav', 'Whoosh, fast swipe', ['whoosh', 'swipe', 'fast', 'transition', 'cut'], 0.45, 'anoisesrc=color=white:duration=0.45:amplitude=0.5,highpass=f=800,lowpass=f=9000,afade=t=in:d=0.2,afade=t=out:st=0.2:d=0.25'],
  ['hit-1.wav', 'Impact hit, low boom', ['hit', 'impact', 'boom', 'punch', 'thud', 'title'], 0.8, "aevalsrc='sin(2*PI*(70-40*t)*t)*exp(-5*t)':d=0.8:s=44100"],
  ['hit-2.wav', 'Impact hit, short thump', ['hit', 'thump', 'impact', 'cut', 'bass'], 0.35, "aevalsrc='sin(2*PI*(110-60*t)*t)*exp(-12*t)':d=0.35:s=44100"],
  ['riser-1.wav', 'Riser, tension build', ['riser', 'tension', 'build', 'suspense', 'rise'], 3, "aevalsrc='sin(2*PI*(180+500*t)*t)*0.4*(t/3)':d=3:s=44100"],
  ['rumble-1.wav', 'Low rumble, dread', ['rumble', 'low', 'dread', 'thunder', 'war', 'ominous'], 4, 'anoisesrc=color=brown:duration=4:amplitude=0.9,lowpass=f=140,afade=t=in:d=1.5,afade=t=out:st=2.5:d=1.5'],
  ['click-1.wav', 'Click, interface', ['click', 'ui', 'mouse', 'button', 'tap'], 0.05, 'anoisesrc=color=white:duration=0.05:amplitude=0.7,highpass=f=2500,afade=t=out:st=0.01:d=0.04'],
  ['tick-1.wav', 'Tick, clock', ['tick', 'clock', 'timer', 'countdown'], 0.06, "aevalsrc='sin(2*PI*1800*t)*exp(-90*t)':d=0.06:s=44100"],
  ['pop-1.wav', 'Pop, bubble', ['pop', 'bubble', 'appear', 'bloop'], 0.12, "aevalsrc='sin(2*PI*(500+900*t)*t)*exp(-30*t)':d=0.12:s=44100"],
  ['ding-1.wav', 'Ding, bell notification', ['ding', 'bell', 'notification', 'chime', 'success'], 1.4, "aevalsrc='(sin(2*PI*1320*t)+0.5*sin(2*PI*1980*t))*0.4*exp(-3*t)':d=1.4:s=44100"],
  ['stamp-1.wav', 'Stamp, document thud', ['stamp', 'document', 'paper', 'thud', 'approved'], 0.3, "aevalsrc='(sin(2*PI*140*t)*exp(-18*t))+0.3*random(0)*exp(-60*t)':d=0.3:s=44100"]
]

const items = []
for (const [file, title, tags, durationS, graph] of SOUNDS) {
  const out = path.join(dir, file)
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', graph, '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', out], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(`ffmpeg failed for ${file}: ${r.stderr}`)
    process.exit(1)
  }
  items.push({ file, title, tags, kind: 'sfx', durationS, licence: 'CC0', creator: 'Atelier synth' })
}
writeFileSync(path.join(dir, 'bank.json'), JSON.stringify({ items }, null, 2))
console.log(`wrote ${items.length} sounds + bank.json to ${dir}`)
