// Makes the fake media of the tests and demo mode (resources/fake-media/): a 10-second 640×360 video and a 10-second voice,
// both from ffmpeg's synthetic sources (a moving colour gradient, a warbling tone). Nothing recorded, nothing
// downloaded. Run once with ffmpeg on PATH: `node scripts/make-fake-media.mjs`. The files are committed.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const dir = path.resolve(import.meta.dirname, '..', 'resources', 'fake-media')
mkdirSync(dir, { recursive: true })
const voice = 'aevalsrc=0.25*sin(2*PI*(180+40*sin(2*PI*0.5*t))*t)*(0.6+0.4*sin(2*PI*3*t)):s=22050:d=10'
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
ff([
  '-f', 'lavfi', '-i', 'gradients=s=640x360:d=10:r=25:c0=0x1b1035:c1=0x6d4ad8:c2=0xe0a96d:speed=0.03',
  '-f', 'lavfi', '-i', voice,
  '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '36', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '32k',
  '-movflags', '+faststart', '-shortest', path.join(dir, 'sample.mp4')
])
ff(['-f', 'lavfi', '-i', voice, '-c:a', 'libmp3lame', '-b:a', '32k', path.join(dir, 'voice.mp3')])
console.log(`written to ${dir}`)
