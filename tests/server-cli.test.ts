import { afterEach, describe, expect, it } from "vitest"
import { startForemanCli, parseForemanPort, type ForemanCliRuntime } from "../src/server/cli"
import { startForemanLoopback } from "../src/server/server"

const runtimes: ForemanCliRuntime[] = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
})

describe("standalone CLI runtime", () => {
  it("starts the local application without requiring an OpenCode runtime", async () => {
    const runtime = await startForemanCli({ port: 0, openBrowser: false })
    runtimes.push(runtime)

    expect(new URL(runtime.url).hostname).toBe("127.0.0.1")
    const response = await fetch(`${runtime.url}/api/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })

  it("validates configured ports instead of silently coercing invalid values", () => {
    expect(parseForemanPort(undefined)).toBe(4317)
    expect(parseForemanPort("4318")).toBe(4318)
    expect(() => parseForemanPort("0")).toThrow(/port/i)
    expect(() => parseForemanPort("70000")).toThrow(/port/i)
    expect(() => parseForemanPort("abc")).toThrow(/port/i)
  })

  it("gracefully closes its loopback listeners", async () => {
    const runtime = await startForemanCli({ port: 0, openBrowser: false, logger: false })
    await runtime.close()
    await expect(fetch(`${runtime.url}/api/health`)).rejects.toThrow()
  })

  it("starts IPv4 and IPv6 listeners on the same port and closes both", async () => {
    const listeners = await startForemanLoopback({ port: 0, logger: false })
    try {
      if (!listeners.ipv6) return
      expect(listeners.ipv6.address.port).toBe(listeners.primary.address.port)
      expect((await fetch(`http://[::1]:${listeners.ipv6.address.port}/api/health`)).status).toBe(200)
    } finally {
      await listeners.close()
    }
    await expect(fetch(`${listeners.url}/api/health`)).rejects.toThrow()
  })
})
