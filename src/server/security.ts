import { timingSafeEqual } from "node:crypto"

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"])

function trustedHttpsOrigin(): URL | undefined {
  const value = process.env.FOREMAN_TRUSTED_HTTPS_ORIGIN
  if (!value) return undefined
  try {
    const origin = new URL(value)
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return undefined
    return origin
  } catch {
    return undefined
  }
}

export function isAllowedBindHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1"
    || (host === "0.0.0.0" && process.env.FOREMAN_ALLOW_NON_LOOPBACK_BIND === "1")
}

export function isAllowedHostHeader(value: string | undefined, port: number): boolean {
  if (!value) return false
  try {
    const url = new URL(`http://${value}`)
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
    const trustedOrigin = trustedHttpsOrigin()
    return !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash
      && ((LOOPBACK_HOSTS.has(hostname) && url.port === String(port))
        || (trustedOrigin !== undefined && url.host.toLowerCase() === trustedOrigin.host.toLowerCase()))
  } catch {
    return false
  }
}

export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false
  try {
    const url = new URL(origin)
    const hostUrl = new URL(`http://${host}`)
    const trustedOrigin = trustedHttpsOrigin()
    return ((url.protocol === "http:" && LOOPBACK_HOSTS.has(hostUrl.hostname.toLowerCase()))
      || (url.protocol === "https:" && trustedOrigin?.origin === url.origin))
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
