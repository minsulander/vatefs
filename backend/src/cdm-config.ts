/**
 * Load CDM plugin PrivateMessage text from ESAA/Plugins/CDMconfig.xml.
 * Used when EFS sends the CDM flow PM (same text as the CDM SEND/PM action).
 */

import fs from "fs"
import path from "path"
import { resolveEsaaPluginsDir } from "./euroscope-paths.js"

/** ESAA sectorfile default when CDMconfig.xml is missing or has no PrivateMessage. */
export const DEFAULT_CDM_PRIVATE_MESSAGE =
    "[FLOW MSG] VERIFY E/TOBT AND MONITOR https://vats.im/vdgs FOR UPDATES. [END OF MSG]"

let cachedText: string = DEFAULT_CDM_PRIVATE_MESSAGE
let loadedFromFile = false
let lastConfigPath: string | undefined

/**
 * Parse `<PrivateMessage text="…"/>` from CDMconfig.xml (attr may use " or ').
 */
function parsePrivateMessageText(xml: string): string | undefined {
    const m = xml.match(/<PrivateMessage\b[^>]*\btext\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    const text = (m?.[1] ?? m?.[2] ?? "").trim()
    return text || undefined
}

/**
 * Load / reload PrivateMessage from EuroScope Plugins/CDMconfig.xml.
 * Always leaves a usable string (file text or ESAA default).
 */
export function loadCdmConfig(
    euroscopeDir: string,
    packageName = "ESAA",
): { text: string; fromFile: boolean; path?: string } {
    const plugins =
        resolveEsaaPluginsDir(euroscopeDir, packageName) ??
        path.join(euroscopeDir, packageName, "Plugins")
    const configPath = path.join(plugins, "CDMconfig.xml")
    lastConfigPath = configPath

    if (!fs.existsSync(configPath)) {
        cachedText = DEFAULT_CDM_PRIVATE_MESSAGE
        loadedFromFile = false
        console.log(`CDM PrivateMessage: using default (CDMconfig.xml not found: ${configPath})`)
        return { text: cachedText, fromFile: false, path: configPath }
    }

    try {
        const xml = fs.readFileSync(configPath, "utf-8")
        const parsed = parsePrivateMessageText(xml)
        if (parsed) {
            cachedText = parsed
            loadedFromFile = true
            console.log(`CDM PrivateMessage loaded from ${configPath}`)
            return { text: cachedText, fromFile: true, path: configPath }
        }
        cachedText = DEFAULT_CDM_PRIVATE_MESSAGE
        loadedFromFile = false
        console.log(`CDM PrivateMessage: no text= in ${configPath} — using default`)
        return { text: cachedText, fromFile: false, path: configPath }
    } catch (err) {
        cachedText = DEFAULT_CDM_PRIVATE_MESSAGE
        loadedFromFile = false
        console.warn(
            `CDM PrivateMessage: failed to read ${configPath}: ${err instanceof Error ? err.message : err}`,
        )
        return { text: cachedText, fromFile: false, path: configPath }
    }
}

/** Cached PrivateMessage (always non-empty; default if file missing). */
export function getCdmPrivateMessageText(): string {
    return cachedText || DEFAULT_CDM_PRIVATE_MESSAGE
}

export function getCdmPrivateMessageSource(): { fromFile: boolean; path?: string } {
    return { fromFile: loadedFromFile, path: lastConfigPath }
}
