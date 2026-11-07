// A stand-in for `ssh -N -L 127.0.0.1:<local>:127.0.0.1:<remote> <host>`, run with Node by the tunnel tests: it
// forwards the local port to the remote port on this machine (the "remote" engine is a fake engine here).
//   host "unreachable"  → prints ssh's message and exits 255 (like a host that cannot be resolved)
//   host "noforward"    → exits 255 at once with "remote port forwarding failed" (ExitOnForwardFailure)
// It records its argv in FAKE_SSH_ARGS_FILE when that is set.
import { writeFileSync } from 'node:fs'
import net from 'node:net'

const args = process.argv.slice(2)
if (process.env.FAKE_SSH_ARGS_FILE) writeFileSync(process.env.FAKE_SSH_ARGS_FILE, JSON.stringify(args))
const host = args[args.length - 1]
if (host === 'unreachable') {
  console.error(`ssh: Could not resolve hostname ${host}: No such host is known.`)
  process.exit(255)
}
if (host === 'noforward') {
  console.error('Error: remote port forwarding failed for listen port')
  process.exit(255)
}
const spec = args[args.indexOf('-L') + 1] ?? ''
const m = /^127\.0\.0\.1:(\d+):127\.0\.0\.1:(\d+)$/.exec(spec)
if (!m) {
  console.error(`bad -L ${spec}`)
  process.exit(2)
}
const server = net.createServer((socket) => {
  const upstream = net.connect(Number(m[2]), '127.0.0.1')
  socket.pipe(upstream).pipe(socket)
  const end = () => {
    socket.destroy()
    upstream.destroy()
  }
  socket.on('error', end)
  upstream.on('error', end)
})
server.listen(Number(m[1]), '127.0.0.1')
