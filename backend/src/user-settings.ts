/**
 * Persist user settings to VatEFSsettings.json in the EuroScope directory.
 */

import fs from "fs"
import path from "path"
import type { DclMode, UiSettings } from "@vatefs/common"
import { DEFAULT_UI_SETTINGS } from "@vatefs/common"

export interface UserSettings {
    activeConfig?: string
    dclMode?: DclMode
    activeAirports?: string[]
    columnAirports?: (string | null)[]
    columnCount?: number
    dclSoundEnabled?: boolean
    flashChangedTimes?: boolean
    flashTsatWindow?: boolean
}

let settingsPath: string | undefined

/**
 * Initialize the settings module with a writable directory.
 * Creates the directory if needed. Must be called before load/save.
 */
export function initUserSettings(dir: string) {
    try {
        fs.mkdirSync(dir, { recursive: true })
    } catch {
        // Directory may already exist or be unwritable; write will report errors
    }
    settingsPath = path.join(dir, "VatEFSsettings.json")
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

/**
 * Resolve UI preference fields from a saved settings object (defaults when missing).
 */
export function resolveUiSettings(saved: UserSettings): UiSettings {
    return {
        dclSoundEnabled:
            typeof saved.dclSoundEnabled === "boolean" ? saved.dclSoundEnabled : DEFAULT_UI_SETTINGS.dclSoundEnabled,
        flashChangedTimes:
            typeof saved.flashChangedTimes === "boolean"
                ? saved.flashChangedTimes
                : DEFAULT_UI_SETTINGS.flashChangedTimes,
        flashTsatWindow:
            typeof saved.flashTsatWindow === "boolean" ? saved.flashTsatWindow : DEFAULT_UI_SETTINGS.flashTsatWindow,
    }
}
