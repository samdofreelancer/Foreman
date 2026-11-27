import { timingSafeEqual } from "node:crypto"

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"])

export function isLoopbackBindHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1"
}

export function isAllowedHostHeader(value: string | undefined, port: number): boolean {
  if (!value) return false
  try {
    const url = new URL(`http://${value}`)
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
    return !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash
      && LOOPBACK_HOSTS.has(hostname)
      && url.port === String(port)
  } catch {
    return false
  }
}

export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false
  try {
    const url = new URL(origin)
    return url.protocol === "http:"
      && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash
      && url.host.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

export function safeTokenEquals(expected: string | undefined, supplied: string | undefined): boolean {
  if (!expected || !supplied) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(supplied)
  return left.length === right.length && timingSafeEqual(left, right)
}
