import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"

export type ManagedProcessOptions = {
  executable?: string
  startupTimeoutMs?: number
  healthCheck: (endpoint: string) => Promise<boolean>
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

type SpawnChild = typeof spawn

/** Owns only the child process created by this instance; it never discovers or stops shared services. */
export class ManagedOpenCodeProcess {
  private child?: ChildProcess
  private endpoint?: string

  constructor(private readonly spawnChild: SpawnChild = spawn, private readonly portProvider: () => Promise<number> = reservePort) {}

  async start(options: ManagedProcessOptions): Promise<string> {
    if (this.child && this.child.exitCode === null) throw new Error("Managed OpenCode process is already running")
    const port = await this.portProvider()
    const endpoint = `http://127.0.0.1:${port}`
    const child = this.spawnChild(options.executable ?? process.env.FOREMAN_OPENCODE_BIN ?? "opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      stdio: "ignore", windowsHide: true, shell: false,
    })
    this.child = child
    this.endpoint = endpoint
    child.once("exit", (code, signal) => options.onExit?.(code, signal))
    child.once("error", () => { /* surfaced by startup health timeout */ })

    const deadline = Date.now() + (options.startupTimeoutMs ?? 20_000)
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Managed OpenCode exited during startup (code ${child.exitCode})`)
      try { if (await options.healthCheck(endpoint)) return endpoint } catch { /* not ready */ }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    await this.stop()
    throw new Error("Managed OpenCode did not become healthy before startup timeout")
  }

  async stop(timeoutMs = 5_000): Promise<void> {
    const child = this.child
    this.child = undefined
    this.endpoint = undefined
    if (!child || child.exitCode !== null || child.killed) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve() }, timeoutMs)
      child.once("exit", () => { clearTimeout(timer); resolve() })
      child.kill("SIGTERM")
    })
  }

  get url() { return this.endpoint }
  get pid() { return this.child?.pid }
}

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Could not reserve a local OpenCode port")
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}
