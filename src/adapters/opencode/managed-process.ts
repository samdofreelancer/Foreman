import { spawn, execFile, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const SHIM_TARGET = /"?%dp0%\\([^"]+?\.exe)"?/i

export async function resolveOpenCodeExecutable(
  name = "opencode",
  platform: NodeJS.Platform = process.platform,
  run: (file: string, args: string[]) => Promise<{ stdout: string }> = (file, args) => execFileAsync(file, args),
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
  exists: (path: string) => boolean = existsSync,
): Promise<string> {
  if (platform !== "win32") return name
  if (/[\\/]/.test(name)) return name

  let candidates: string[] = []
  try {
    const { stdout } = await run("where.exe", [name])
    candidates = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  } catch {
    return name
  }

  const direct = candidates.find((p) => /\.exe$/i.test(p))
  if (direct) return direct

  const shim = candidates.find((p) => /\.(cmd|bat)$/i.test(p))
  if (!shim) return name
  const match = SHIM_TARGET.exec(readFile(shim))
  if (!match) return name
  const target = join(dirname(shim), match[1])
  return exists(target) ? target : name
}

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

  constructor(
    private readonly spawnChild: SpawnChild = spawn,
    private readonly portProvider: () => Promise<number> = reservePort,
    private readonly resolveCommand: (name: string) => Promise<string> = (name) => resolveOpenCodeExecutable(name),
  ) {}

  async start(options: ManagedProcessOptions): Promise<string> {
    if (this.child && this.child.exitCode === null) throw new Error("Managed OpenCode process is already running")
    const port = await this.portProvider()
    const endpoint = `http://127.0.0.1:${port}`
    const commandName = options.executable ?? process.env.FOREMAN_OPENCODE_BIN ?? "opencode"
    const executable = await this.resolveCommand(commandName)

    let spawnError: Error | undefined
    const child = this.spawnChild(executable, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      stdio: "ignore", windowsHide: true, shell: false,
    })
    this.child = child
    this.endpoint = endpoint
    child.once("exit", (code, signal) => options.onExit?.(code, signal))
    child.once("error", (error) => { spawnError = error })

    const deadline = Date.now() + (options.startupTimeoutMs ?? 20_000)
    while (Date.now() < deadline) {
      if (spawnError) {
        const code = (spawnError as NodeJS.ErrnoException).code
        if (code === "ENOENT") {
          throw new Error(`OpenCode executable "${executable}" was not found. Please install OpenCode 2.4.x or specify the executable path in Settings.`)
        }
        throw new Error(`Managed OpenCode failed to start: ${spawnError.message}`)
      }
      if (child.exitCode !== null) {
        throw new Error(`Managed OpenCode exited during startup (code ${child.exitCode})`)
      }
      try {
        if (await options.healthCheck(endpoint)) return endpoint
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "UNSUPPORTED_RUNTIME_VERSION") throw error
        // Other failures are expected while the child is still starting.
      }
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
