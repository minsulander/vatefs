/**
 * Per-airport paper board positions (AD / T / P) from paper-positions.yml.
 * Missing ICAO → AD only.
 */

import fs from "fs"
import path from "path"
import yaml from "js-yaml"

export type PaperPositionRole = "AD" | "T" | "P"

export const ALL_PAPER_POSITIONS: PaperPositionRole[] = ["AD", "T", "P"]

const DEFAULT_POSITIONS: PaperPositionRole[] = ["AD"]

let catalog = new Map<string, PaperPositionRole[]>()
let catalogPath: string | undefined

export function isPaperPositionRole(value: string): value is PaperPositionRole {
    return (ALL_PAPER_POSITIONS as string[]).includes(value)
}

export function sortPaperRoles(roles: PaperPositionRole[]): PaperPositionRole[] {
    const order = new Map(ALL_PAPER_POSITIONS.map((r, i) => [r, i]))
    return [...new Set(roles)].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
}

/** Parse role strings for manual picker (empty allowed — unlike catalog defaults). */
export function normalizePaperRoles(roles: unknown): PaperPositionRole[] {
    if (!Array.isArray(roles)) return []
    return sortPaperRoles(
        roles
            .map((v) => (typeof v === "string" ? v.trim().toUpperCase() : ""))
            .filter(isPaperPositionRole),
    )
}

function normalizeList(raw: unknown): PaperPositionRole[] {
    if (!Array.isArray(raw)) return [...DEFAULT_POSITIONS]
    const out = raw
        .map((v) => (typeof v === "string" ? v.trim().toUpperCase() : ""))
        .filter(isPaperPositionRole)
    return out.length > 0 ? sortPaperRoles(out) : [...DEFAULT_POSITIONS]
}

/** Load or reload the catalog. Safe to call repeatedly. */
export function loadPaperPositionsCatalog(configDir: string): void {
    const filePath = path.join(configDir, "paper-positions.yml")
    catalogPath = filePath
    catalog = new Map()
    if (!fs.existsSync(filePath)) {
        console.warn(`[PAPER] Positions catalog missing: ${filePath} (default AD only)`)
        return
    }
    try {
        const raw = yaml.load(fs.readFileSync(filePath, "utf8")) as {
            airports?: Record<string, unknown>
        }
        const airports = raw?.airports ?? {}
        for (const [icao, list] of Object.entries(airports)) {
            const code = icao.trim().toUpperCase()
            if (!code) continue
            catalog.set(code, normalizeList(list))
        }
        console.log(`[PAPER] Positions catalog: ${catalog.size} airport(s) from ${filePath}`)
    } catch (err) {
        console.warn(
            `[PAPER] Failed to load positions catalog: ${err instanceof Error ? err.message : err}`,
        )
    }
}

/** Positions present at this airport. Unknown ICAO → AD only. */
export function paperPositionsForAirport(icao: string | null | undefined): PaperPositionRole[] {
    const code = (icao ?? "").trim().toUpperCase()
    if (!code) return [...DEFAULT_POSITIONS]
    return [...(catalog.get(code) ?? DEFAULT_POSITIONS)]
}

export function paperPositionsCatalogPath(): string | undefined {
    return catalogPath
}
