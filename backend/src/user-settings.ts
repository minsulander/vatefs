/**
 * Persist user settings to VatEFSsettings.json in the EuroScope directory.
 */

import fs from "fs"
import path from "path"
import type { AutoLopSsrMode, DclMode, StripPrintMode, StripPrintSound, UiSettings } from "@vatefs/common"
import { DEFAULT_UI_SETTINGS, isAutoLopSsrMode } from "@vatefs/common"

function isStripPrintSound(value: unknown): value is StripPrintSound {
    return value === "off" || value === "short" || value === "long"
}

function isStripPrintMode(value: unknown): value is StripPrintMode {
    return value === "auto" || value === "manual"
}

/** Prefer autoLopSsr; migrate legacy autoDepSquawkCfl boolean (true→instant, false→manual). */
function resolveAutoLopSsr(saved: UserSettings): AutoLopSsrMode {
    if (isAutoLopSsrMode(saved.autoLopSsr)) return saved.autoLopSsr
    if (typeof saved.autoDepSquawkCfl === "boolean") {
        return saved.autoDepSquawkCfl ? "instant" : "manual"
    }
    return DEFAULT_UI_SETTINGS.autoLopSsr
}

export interface UserSettings {
    activeConfig?: string
    dclMode?: DclMode
    activeAirports?: string[]
    columnAirports?: (string | null)[]
    columnCount?: number
    dclSoundEnabled?: boolean
    flashChangedTimes?: boolean
    flashTsatWindow?: boolean
    showStripOwnership?: boolean
    dimOtherOwnedStrips?: boolean
    transferSoundsEnabled?: boolean
    showAppDepXcFrequency?: boolean
    autoParkEnabled?: boolean
    /** @deprecated Prefer autoLopSsr; true→instant, false→manual */
    autoDepSquawkCfl?: boolean
    autoLopSsr?: AutoLopSsrMode
    showTobtSetByA?: boolean
    stripPrintSound?: StripPrintSound
    stripPrintMode?: StripPrintMode
    /** Manual ESSA role selection (physical positions) */
    essaRoles?: string[]
    essaRolesManual?: boolean
    /** Manual ESGG paper role selection (CD / GND / TWR) */
    esggRoles?: string[]
    esggRolesManual?: boolean
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
    const merged = { ...current, ...update } as UserSettings & { equalBayColumns?: boolean }
    // Drop removed / migrated preferences if still present in older settings files
    delete merged.equalBayColumns
    if (merged.autoLopSsr !== undefined) delete merged.autoDepSquawkCfl
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
        showStripOwnership:
            typeof saved.showStripOwnership === "boolean"
                ? saved.showStripOwnership
                : DEFAULT_UI_SETTINGS.showStripOwnership,
        dimOtherOwnedStrips:
            typeof saved.dimOtherOwnedStrips === "boolean"
                ? saved.dimOtherOwnedStrips
                : DEFAULT_UI_SETTINGS.dimOtherOwnedStrips,
        transferSoundsEnabled:
            typeof saved.transferSoundsEnabled === "boolean"
                ? saved.transferSoundsEnabled
                : DEFAULT_UI_SETTINGS.transferSoundsEnabled,
        showAppDepXcFrequency:
            typeof saved.showAppDepXcFrequency === "boolean"
                ? saved.showAppDepXcFrequency
                : DEFAULT_UI_SETTINGS.showAppDepXcFrequency,
        autoParkEnabled:
            typeof saved.autoParkEnabled === "boolean"
                ? saved.autoParkEnabled
                : DEFAULT_UI_SETTINGS.autoParkEnabled,
        autoLopSsr: resolveAutoLopSsr(saved),
        showTobtSetByA:
            typeof saved.showTobtSetByA === "boolean"
                ? saved.showTobtSetByA
                : DEFAULT_UI_SETTINGS.showTobtSetByA,
        stripPrintSound: isStripPrintSound(saved.stripPrintSound)
            ? saved.stripPrintSound
            : DEFAULT_UI_SETTINGS.stripPrintSound,
        stripPrintMode: isStripPrintMode(saved.stripPrintMode)
            ? saved.stripPrintMode
            : DEFAULT_UI_SETTINGS.stripPrintMode,
    }
}
