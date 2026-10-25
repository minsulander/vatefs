/**
 * Resolve EuroScope package paths (ESAA / Plugins / ICAO).
 * Some installs nest the sector package (…/EuroScope/ESAA/ESAA/Plugins/…).
 */

import fs from "fs"
import path from "path"

const MAX_DEPTH = 5

/** Marker files that identify a real ESAA Plugins folder. */
const PLUGIN_MARKERS = [
    "TopSkyCPDLChoppieCode.txt",
    "TopSkyCPDLC.txt",
    "TopSkyAirspace.txt",
    "GRpluginStands.txt",
    "TopSkySoundCPDLC.wav",
]

function scoreEsaaCandidate(esaaDir: string): number {
    const plugins = path.join(esaaDir, "Plugins")
    if (!fs.existsSync(plugins) || !fs.statSync(plugins).isDirectory()) return 0
    let score = 10
    for (const name of PLUGIN_MARKERS) {
        if (fs.existsSync(path.join(plugins, name))) score += 5
    }
    if (fs.existsSync(path.join(esaaDir, "ICAO", "ICAO_Airlines.txt"))) score += 2
    try {
        const n = fs.readdirSync(plugins).length
        score += Math.min(n, 20)
    } catch {
        /* ignore */
    }
    return score
}

/**
 * Walk under euroscopeDir for directories named ESAA that contain Plugins/.
 * Picks the best match (TopSky / GR plugin files), so nested ESAA/ESAA wins
 * when that is where the sector package actually lives.
 */
export function resolveEsaaPackageDir(
    euroscopeDir: string,
    packageName = "ESAA",
): string | undefined {
    if (!euroscopeDir || !fs.existsSync(euroscopeDir)) return undefined
    const want = packageName.toUpperCase()
    const found: { dir: string; score: number; depth: number }[] = []

    const walk = (dir: string, depth: number) => {
        if (depth > MAX_DEPTH) return
        let entries: fs.Dirent[]
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const ent of entries) {
            if (!ent.isDirectory()) continue
            const full = path.join(dir, ent.name)
            if (ent.name.toUpperCase() === want) {
                const score = scoreEsaaCandidate(full)
                if (score > 0) found.push({ dir: full, score, depth })
            }
            walk(full, depth + 1)
        }
    }

    walk(euroscopeDir, 0)
    if (found.length === 0) {
        // Flat fallback: euroscopeDir/ESAA even if empty (callers log missing files)
        const flat = path.join(euroscopeDir, packageName)
        return fs.existsSync(flat) ? flat : undefined
    }
    found.sort((a, b) => b.score - a.score || b.depth - a.depth)
    return found[0]!.dir
}

/** ESAA/Plugins — nested package aware. */
export function resolveEsaaPluginsDir(
    euroscopeDir: string,
    packageName = "ESAA",
): string | undefined {
    const pkg = resolveEsaaPackageDir(euroscopeDir, packageName)
    if (!pkg) return undefined
    const plugins = path.join(pkg, "Plugins")
    return fs.existsSync(plugins) ? plugins : undefined
}

/** Path to a file under ESAA/Plugins, or undefined if missing. */
export function resolveEsaaPluginFile(
    euroscopeDir: string,
    fileName: string,
    packageName = "ESAA",
): string | undefined {
    const plugins = resolveEsaaPluginsDir(euroscopeDir, packageName)
    if (!plugins) return undefined
    const file = path.join(plugins, fileName)
    return fs.existsSync(file) ? file : undefined
}

/** ESAA/ICAO/ICAO_Airlines.txt when present. */
export function resolveIcaoAirlinesFile(
    euroscopeDir: string,
    packageName = "ESAA",
): string | undefined {
    const pkg = resolveEsaaPackageDir(euroscopeDir, packageName)
    if (!pkg) return undefined
    const file = path.join(pkg, "ICAO", "ICAO_Airlines.txt")
    return fs.existsSync(file) ? file : undefined
}
