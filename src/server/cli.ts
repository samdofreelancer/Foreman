#!/usr/bin/env node
import open from "open"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"
import { startForemanLoopback, type ForemanLoopbackServers, type ForemanServerOptions } from "./server"

export type ForemanCliRuntime = Pick<ForemanLoopbackServers, "url" | "close">

export type ForemanCliOptions = {
  port?: number
  openBrowser?: boolean
  logger?: ForemanServerOptions["logger"]
}

export function parseForemanPort(value: string | undefined): number {
  if (value === undefined || value === "") return 4317
  if (!/^\d+$/.test(value)) throw new Error("Foreman port must be an integer between 1 and 65535")
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("Foreman port must be an integer between 1 and 65535")
  }
  return port
}

export async function startForemanCli(options: ForemanCliOptions = {}): Promise<ForemanCliRuntime> {
  const port = options.port ?? parseForemanPort(process.env.FOREMAN_PORT)
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error("Foreman port must be an integer between 1 and 65535 (or 0 for an ephemeral test port)")
  }

  const runtime = await startForemanLoopback({ port, logger: options.logger })
  const shouldOpenBrowser = options.openBrowser ?? process.env.FOREMAN_NO_OPEN !== "1"
  if (shouldOpenBrowser) {
    void open(runtime.url).catch(() => {
      process.stderr.write("Foreman started, but the browser could not be opened automatically.\n")
    })
  }
  return runtime
}

async function main(): Promise<void> {
  const runtime = await startForemanCli()
  process.stdout.write(`Foreman is running at ${runtime.url}\n`)

  let closing = false
  const shutdown = (): void => {
    if (closing) return
    closing = true
    void runtime.close().catch(() => {
      process.stderr.write("Foreman encountered an error during shutdown.\n")
      process.exitCode = 1
    })
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown startup error"
    process.stderr.write(`Foreman failed to start: ${message}\n`)
    process.exitCode = 1
  })
}
