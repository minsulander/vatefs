/**
 * Detect installed CDM plugin version from CDM.dll / version.txt next to
 * CDM_data_*.txt (EuroScope Plugins folder).
 *
 * CDM embeds MY_PLUGIN_VERSION as a short ASCII string (e.g. "2.31b", "2.30.2b").
 * PE FileVersion is often empty, so we scan the DLL for that string.
 */

import fs from "node:fs"
import path from "node:path"

/** Minimum CDM version required for EFS setMaster / removeMaster clickspot. */
export const CDM_MASTER_CLICK_MIN_VERSION: [number, number, number] = [2, 31, 0]

const VERSION_RE = /^2\.\d{1,2}(?:\.\d{1,3})?[a-z]?$/i

/** Parse "2.31b" / "2.30.2" → [2, 31, 0] / [2, 30, 2]. Trailing letter ignored. */
export function parseCdmPluginVersion(raw: string | undefined | null): number[] | null {
    if (!raw) return null
    const m = String(raw)
        .trim()
        .match(/^(\d+)\.(\d+)(?:\.(\d+))?[a-z]?$/i)
    if (!m) return null
    return [Number(m[1]), Number(m[2]), Number(m[3] || 0)]
}

export function compareCdmPluginVersions(a: number[], b: number[]): number {
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) {
        const av = a[i] ?? 0
        const bv = b[i] ?? 0
        if (av > bv) return 1
        if (av < bv) return -1
    }
    return 0
}

export function cdmPluginVersionAtLeast(
    raw: string | undefined | null,
    min: readonly [number, number, number] = CDM_MASTER_CLICK_MIN_VERSION,
): boolean {
    const v = parseCdmPluginVersion(raw)
    if (!v) return false
    return compareCdmPluginVersions(v, [...min]) >= 0
}

/** Scan CDM.dll binary for MY_PLUGIN_VERSION-like strings (e.g. 2.31b). */
export function readCdmVersionFromDll(dllPath: string): string | undefined {
    try {
        const buf = fs.readFileSync(dllPath)
        const text = buf.toString("latin1")
        const found: string[] = []
        // Null-terminated ASCII tokens
        for (const m of text.matchAll(/[\x00](2\.\d{1,2}(?:\.\d{1,3})?[a-z]?)[\x00]/gi)) {
            const v = m[1]
            if (VERSION_RE.test(v)) found.push(v)
        }
        if (found.length === 0) return undefined
        // Prefer the highest parsed version (DLL may contain older leftovers)
        found.sort((a, b) => {
            const pa = parseCdmPluginVersion(a) ?? [0, 0, 0]
            const pb = parseCdmPluginVersion(b) ?? [0, 0, 0]
            return compareCdmPluginVersions(pb, pa)
        })
        return found[0]
    } catch {
        return undefined
    }
}

export function readCdmVersionFromTxt(txtPath: string): string | undefined {
    try {
        const raw = fs.readFileSync(txtPath, "utf8").trim().split(/\r?\n/)[0]?.trim()
        if (raw && parseCdmPluginVersion(raw)) return raw
        return undefined
    } catch {
        return undefined
    }
}

/**
 * Resolve CDM plugin version from a Plugins directory (CDM.dll preferred over
 * stale version.txt which release zips sometimes leave behind).
 */
export function detectCdmPluginVersion(pluginsDir: string | undefined): string | undefined {
    if (!pluginsDir) return undefined
    const dll = path.join(pluginsDir, "CDM.dll")
    if (fs.existsSync(dll)) {
        const fromDll = readCdmVersionFromDll(dll)
        if (fromDll) return fromDll
    }
    const txt = path.join(pluginsDir, "version.txt")
    if (fs.existsSync(txt)) return readCdmVersionFromTxt(txt)
    return undefined
}
