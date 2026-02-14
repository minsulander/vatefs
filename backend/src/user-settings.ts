/**
 * Persist user settings to VatEFSsettings.json in the EuroScope directory.
 */

import fs from "fs"
import path from "path"
import type { DclMode } from "@vatefs/common"

interface UserSettings {
    activeConfig?: string
    dclMode?: DclMode
}

let settingsPath: string | undefined

/**
 * Initialize the settings module with the EuroScope directory.
 * Must be called before load/save.
 */
export function initUserSettings(euroscopeDir: string) {
    settingsPath = path.join(euroscopeDir, "VatEFSsettings.json")
}

/**
 * Load saved user settings from disk.
 * Returns empty object if file doesn't exist or is invalid.
 */
export function loadUserSettings(): UserSettings {
    if (!settingsPath) return {}
    try {
        const raw = fs.readFileSync(settingsPath, "utf-8")
        const parsed = JSON.parse(raw)
        return parsed as UserSettings
    } catch {
        return {}
    }
}

/**
 * Save user settings to disk.
 * Merges the provided partial settings with the existing file.
 */
export function saveUserSettings(update: Partial<UserSettings>) {
    if (!settingsPath) return
    const current = loadUserSettings()
    const merged = { ...current, ...update }
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), "utf-8")
    } catch (err) {
        console.error(`Failed to save user settings: ${err instanceof Error ? err.message : err}`)
    }
}
