/**
 * ESSA (Arlanda) pushback vs startup stand rules from Swedavia / VATSIM procedures.
 *
 * Pushback is normal for jets and props, with stand/apron exceptions that start up
 * and taxi out under own power (STUP instead of PUSH).
 */

import { isPropellerEngine } from "./slow-aircraft.js"

/** Normalize stand labels: "F 28" → "F28", trim spaces. */
export function normalizeStandName(stand: string | undefined | null): string {
    return (stand ?? "").trim().toUpperCase().replace(/\s+/g, "")
}

function standInRange(stand: string, prefix: string, from: number, to: number): boolean {
    if (!stand.startsWith(prefix)) return false
    const n = parseInt(stand.slice(prefix.length), 10)
    return Number.isFinite(n) && n >= from && n <= to
}

/** Jet exceptions: R9C, G149, S4–S6, S71–S82, Apron M */
function jetStartupOnlyStand(stand: string): boolean {
    if (stand === "R9C" || stand === "G149") return true
    if (standInRange(stand, "S", 4, 6)) return true
    if (standInRange(stand, "S", 71, 82)) return true
    if (stand.startsWith("M")) return true // Apron M
    return false
}

/** Prop exceptions: R9C, G149, 52/54/56/58, Apron G, Apron M, Apron S */
function propStartupOnlyStand(stand: string): boolean {
    if (stand === "R9C" || stand === "G149") return true
    if (stand === "52" || stand === "54" || stand === "56" || stand === "58") return true
    if (stand.startsWith("G")) return true // Apron G (incl. G141–G149)
    if (stand.startsWith("M")) return true // Apron M
    if (stand.startsWith("S")) return true // Apron S
    return false
}

/**
 * True when this stand + aircraft should use startup (STUP) instead of pushback (PUSH).
 * Unknown engine defaults to jet rules (most traffic). Missing stand → push (normal).
 */
export function standRequiresStartupInsteadOfPush(
    stand: string | undefined | null,
    engineType?: string | null,
): boolean {
    const s = normalizeStandName(stand)
    if (!s) return false
    if (isPropellerEngine(engineType)) return propStartupOnlyStand(s)
    return jetStartupOnlyStand(s)
}

/** Remap PUSH → STUP when stand rules say startup-only. */
export function remapPushActionForStand<T extends string>(
    action: T | undefined,
    stand: string | undefined | null,
    engineType?: string | null,
): T | undefined {
    if (action !== ("PUSH" as T)) return action
    if (standRequiresStartupInsteadOfPush(stand, engineType)) return "STUP" as T
    return action
}
