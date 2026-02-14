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
    for (const rule of rules) {
        if (rule.wakeTurbulence !== wakeTurbulence) continue

        if (rule.includeTypes) {
            // Only match specific types
            if (rule.includeTypes.includes(aircraftType)) return true
        } else if (rule.excludeTypes) {
            // Match all of this WTC except excluded types
            if (!rule.excludeTypes.includes(aircraftType)) return true
        } else {
            // Match all of this WTC
            return true
        }
    }
    return false
}
