// Entry of the Atelier MCP server (built to out/main/mcp.js, run by the Claude Code CLI through Electron's own
// binary with ELECTRON_RUN_AS_NODE=1). It reads the bridge address and the run's token from its environment.
import { ENV_BRIDGE, ENV_TOKEN } from './protocol'
import { connectBridge, runMcpServer } from './server'

const address = process.env[ENV_BRIDGE] ?? ''
const token = process.env[ENV_TOKEN] ?? ''
delete process.env[ENV_TOKEN]

const bridge = address && token ? connectBridge(address, token) : Promise.reject(new Error('No Atelier bridge configured'))
bridge.then(
  (client) => process.stdin.once('end', () => client.close()),
  (err: unknown) => process.stderr.write(`atelier mcp: ${err instanceof Error ? err.message : String(err)}\n`)
)

void runMcpServer({ input: process.stdin, output: process.stdout, bridge }).then(() => process.exit(0))
