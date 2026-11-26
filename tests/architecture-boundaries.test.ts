import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const sourceRoot = resolve(repositoryRoot, "src")
const domainRoot = resolve(sourceRoot, "domain")
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"])

type ImportReference = {
  specifier: string
  line: number
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name)
    if (statSync(path).isDirectory()) return listSourceFiles(path)
    return sourceExtensions.has(extname(path)) ? [path] : []
  })
}

function readImports(file: string): ImportReference[] {
  const source = readFileSync(file, "utf8")
  const pattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g
  return [...source.matchAll(pattern)].map((match) => {
    const offset = match.index ?? 0
    return {
      specifier: match[1] ?? match[2] ?? match[3],
      line: source.slice(0, offset).split("\n").length,
    }
  })
}

function relativePath(path: string): string {
  return relative(repositoryRoot, path).split(sep).join("/")
}

function isLegacyPluginEntrypoint(path: string): boolean {
  const candidate = relativePath(path)
  return candidate === "src/gui.tsx"
    || candidate === "src/stores.ts"
    || candidate.startsWith("src/gui/")
    || candidate === "vite.config.ts"
}

describe("architecture boundaries", () => {
  it("keeps the domain independent from runtime, UI, and infrastructure", () => {
    const files = listSourceFiles(domainRoot)
    const violations: string[] = []

    for (const file of files) {
      for (const reference of readImports(file)) {
        const location = `${relativePath(file)}:${reference.line}`
        if (reference.specifier.startsWith(".")) {
          const target = resolve(dirname(file), reference.specifier)
          const pathFromDomain = relative(domainRoot, target)
          if (pathFromDomain === ".." || pathFromDomain.startsWith(`..${sep}`)) {
            violations.push(`${location} imports outside src/domain: ${reference.specifier}`)
          }
          continue
        }

        // Effect Schema is currently used as a pure validation/type declaration library.
        if (reference.specifier === "effect" || reference.specifier.startsWith("effect/")) {
          continue
        }

        violations.push(`${location} imports external dependency: ${reference.specifier}`)
      }
    }

    expect(violations).toEqual([])
  })

  it("confines OpenCode plugin-host imports to quarantined legacy reference files", () => {
    const files = [
      ...listSourceFiles(sourceRoot),
      resolve(repositoryRoot, "vite.config.ts"),
    ]
    const violations: string[] = []

    for (const file of files) {
      for (const reference of readImports(file)) {
        if (!reference.specifier.startsWith("@opencode/plugin")) continue
        if (isLegacyPluginEntrypoint(file)) continue
        violations.push(
          `${relativePath(file)}:${reference.line} imports ${reference.specifier}`,
        )
      }
    }

    expect(violations).toEqual([])
  })
})
