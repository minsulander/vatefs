/**
 * Slow aircraft detection.
 * Determines if an aircraft is "slow" based on wake turbulence category and type.
 */

import fs from "fs"

interface SlowRule {
    wakeTurbulence: string
    includeTypes?: string[]
    excludeTypes?: string[]
}

let rules: SlowRule[] = []

/**
 * Load slow aircraft rules from a JSON config file.
 */
export function loadSlowAircraft(filePath: string) {
    if (!fs.existsSync(filePath)) {
        console.warn(`Slow aircraft config not found: ${filePath}`)
        return
    }

    const content = fs.readFileSync(filePath, "utf-8")
    const data = JSON.parse(content)
    rules = data.rules ?? []
    console.log(`Loaded ${rules.length} slow aircraft rules`)
}

/**
 * Check if an aircraft is considered "slow" based on its wake turbulence and type.
 */
export function isSlowAircraft(wakeTurbulence: string, aircraftType: string): boolean {
    const type = aircraftType.toUpperCase()
    const wtc = wakeTurbulence.toUpperCase()

    for (const rule of rules) {
        if (rule.wakeTurbulence.toUpperCase() !== wtc) continue

        if (rule.includeTypes) {
            // Only match specific types
            if (rule.includeTypes.some(t => t.toUpperCase() === type)) return true
        } else if (rule.excludeTypes) {
            // Match all of this WTC except excluded types
            if (!rule.excludeTypes.some(t => t.toUpperCase() === type)) return true
        } else {
            // Match all of this WTC
            return true
        }
    }
    return false
}

/**
 * ESSA auto-SLOW is only applied 06:00–22:00 local time (Europe/Stockholm).
 * Window is [06:00, 22:00).
 */
export function isEssaAutoSlowHours(now: Date = new Date()): boolean {
    const hourStr = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Stockholm",
        hour: "2-digit",
        hour12: false
    }).format(now)
    const hour = Number(hourStr)
    const h = hour === 24 ? 0 : hour
    return h >= 6 && h < 22
}
