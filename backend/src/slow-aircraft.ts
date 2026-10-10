/**
 * Slow aircraft detection.
 * Determines if an aircraft is "slow" based on wake turbulence category and type.
 *
 * Per ESSA procedures (low speed traffic):
 * - WTC L: all propeller-driven (P/T engines), except P180
 * - WTC M: explicit turboprop include list
 */

import fs from "fs"

interface SlowRule {
    wakeTurbulence: string
    includeTypes?: string[]
    excludeTypes?: string[]
    /** When set, only these EuroScope engine types match (P/T/J/E). */
    engineTypes?: string[]
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

/** True for piston / turboprop / turboshaft (not jet or electric). */
export function isPropellerEngine(engineType: string | undefined | null): boolean {
    if (!engineType) return false
    const e = engineType.trim().toUpperCase()
    return e === "P" || e === "T"
}

/**
 * Check if an aircraft is considered "slow" based on its wake turbulence and type.
 * @param engineType Optional EuroScope engine type (P/T/J/E/?). Used when rule has engineTypes.
 */
export function isSlowAircraft(
    wakeTurbulence: string,
    aircraftType: string,
    engineType?: string | null,
): boolean {
    const type = aircraftType.toUpperCase()
    const wtc = wakeTurbulence.toUpperCase()
    const eng = (engineType ?? "").trim().toUpperCase()

    for (const rule of rules) {
        if (rule.wakeTurbulence.toUpperCase() !== wtc) continue

        if (rule.excludeTypes?.some((t) => t.toUpperCase() === type)) {
            continue
        }

        if (rule.engineTypes?.length) {
            // Propeller-only L rule: require known P/T; unknown engine → not slow
            if (!eng || !rule.engineTypes.some((e) => e.toUpperCase() === eng)) {
                continue
            }
        }

        if (rule.includeTypes) {
            if (rule.includeTypes.some((t) => t.toUpperCase() === type)) return true
            continue
        }

        // Match all of this WTC (optionally filtered by engineTypes / excludeTypes above)
        return true
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
