/**
 * ESSA (Arlanda) pushback vs startup from Swedavia parking-stand tables
 * (valid from 2026-10-07).
 *
 * When an action rule would show PUSH, remap to STUP (START UP) when the
 * stand + aircraft type requires startup / self-manoeuvre instead of push-back.
 * Types not approved on a stand follow the majority of approved types with the
 * same engine class on that stand.
 */

import { isPropellerEngine } from "./slow-aircraft.js"

/** Normalize stand labels: "F 28" → "F28", "APK2"/"APNK2" → "K2", "01" → "1". */
export function normalizeStandName(stand: string | undefined | null): string {
    let s = (stand ?? "").trim().toUpperCase().replace(/\s+/g, "")
    // GRplugin apron K uses APK1/APK2 (not K1/K2).
    if (/^APK[0-9]/.test(s)) s = "K" + s.slice(3)
    // Display / alt forms: APNK2 → K2, APNG141 → G141
    else if (s.startsWith("APN") && s.length > 3) s = s.slice(3)
    // Pier stands are zero-padded in GRplugin (01) but tables use 1.
    if (/^\d+$/.test(s)) s = String(Number.parseInt(s, 10))
    return s
}

function normalizeType(aircraftType: string | undefined | null): string {
    return (aircraftType ?? "").trim().toUpperCase()
}

type EngineClass = "jet" | "prop"

function engineClass(engineType?: string | null): EngineClass {
    return isPropellerEngine(engineType) ? "prop" : "jet"
}

/** Stand rule: explicit type outcomes + majority fallback for unapproved types. */
interface StandRule {
    /** ICAO types that start up (no push-back) when approved on this stand. */
    startupTypes: ReadonlySet<string>
    /** ICAO types that push when approved. Empty = none listed (use majority only for unknowns). */
    pushTypes: ReadonlySet<string>
    jetMajorityStartup: boolean
    propMajorityStartup: boolean
}

function setOf(...types: string[]): ReadonlySet<string> {
    return new Set(types.map((t) => t.toUpperCase()))
}

// --- ICAO type groups (common EuroScope / ICAO designators) ---

const ATR = setOf("AT43", "AT45", "AT46", "AT72", "AT73", "AT75", "AT76", "AT7", "ATE", "ATF", "AT4")
const DH8D = setOf("DH8D", "DH4")
const DH8_ALL = setOf("DH8A", "DH8B", "DH8C", "DH8D", "DH4", "DH1", "DH2", "DH3", "DHC6", "DHT", "DH7")
const F50 = setOf("F50")
const SAAB = setOf("SF34", "SF3", "SFA", "SFB", "SB20", "S20")
const CRJ_T3N_PUSH = setOf("CRJ1", "CRJ2", "CRJ7", "CRJ9", "CR1", "CR2", "CR7", "CR9")
const F100 = setOf("F100", "100")
const E120 = setOf("E120", "EM2", "120")
const E135_145 = setOf("E135", "E145", "ER3", "ER4", "135", "145")
const E170_175 = setOf("E170", "E175", "E70", "E75", "E7W")
const E190_195 = setOf("E190", "E195", "E90", "E95", "290", "295")
const CASA = setOf("CN35", "C295", "CS5", "CS9")
const FALCON = setOf("FA7X", "FA8X", "F900", "F2TH", "DF7", "DF8", "DF9", "D9L", "D20", "D2L", "DF2", "DF5")
const GLOBAL = setOf("GLEX", "GL5T", "GL6T", "GL7T", "CCX", "CC6", "CC7")
const GULF = setOf("GLF5", "GLF6", "GLF7", "GA5", "GJ5", "GJ6", "GJ7", "GLF4", "GLF2", "GLF3", "GA5", "GJ4", "GR2", "GR3", "GR1")
const CL60 = setOf("CL60", "CCJ", "CL6")
const AN26_72 = setOf("AN26", "A26", "AN72", "A72", "AN7")
const BIZ_S71 = setOf(
    "BE40", "BE4", "B40", "BE20", "B20", "B30", "BE30", "B25", "B35", "BE9L", "BE99", "B99",
    "PRM1", "PR1", "C208", "C182", "C180", "C425", "CL30", "CL35", "CL60", "CCJ", "CL6",
    "C56X", "C525", "C550", "C650", "C510", "C680", "C68A", "C560", "D328", "D38",
    "E120", "EM2", "E45X", "E55P", "E50P", "EP3", "E550", "ET6", "FA20", "DF2", "FA50", "DF5",
    "F900", "DF9", "F2TH", "D20", "H25B", "H25", "H25C", "H28", "H29", "H25A", "H21", "HA4T", "H24",
    "HDJT", "HHJ", "JS31", "JS32", "J31", "J32", "JS41", "J41", "LJ31", "L31", "LJ35", "L35",
    "LJ55", "L55", "LJ45", "L45", "LJ60", "LJ4", "LJ6", "SW2", "SW3", "SW4", "SWM",
    "P180", "PC12", "PL2", "PC24", "PL4", "P28A", "P28B", "P31", "P32", "P42", "SF34", "SF3", "SFA", "SFB",
)
const A320_FAM = setOf(
    "A318", "A319", "A320", "A321", "A19N", "A20N", "A21N", "318", "319", "320", "321",
    "31N", "32A", "32N", "32B", "32Q", "32X", "31B",
)
const A220 = setOf("BCS1", "BCS3", "221", "223", "A220")
const B737 = setOf(
    "B733", "B734", "B735", "B736", "B737", "B738", "B739", "B37M", "B38M", "B39M", "B3XM",
    "733", "734", "735", "736", "73G", "73H", "73J", "73W", "73C", "73E", "7S8", "7M7", "7M8", "7M9",
    "73Y", "73P", "73K", "7S7", "7S9", "731", "732", "738", "739",
)
const CRJ_ALL = setOf("CRJ1", "CRJ2", "CRJ7", "CRJ9", "CRJX", "CR1", "CR2", "CR7", "CR9", "CRK")
const RJ_BAE = setOf("RJ70", "RJ85", "RJ1H", "B461", "B462", "B463", "AR7", "AR8", "AR1", "141", "142", "143")
const ATP = setOf("ATP")
const DO228_328 = setOf("D228", "D28", "D328", "D38", "FRJ")
const IL114 = setOf("I114", "IL1")
const MD80 = setOf("MD81", "MD82", "MD83", "MD87", "MD88", "MD90", "M81", "M82", "M83", "M87", "M88", "M90")
const B717_727 = setOf("B712", "B721", "B722", "712", "721", "722", "717")
const F70 = setOf("F70")
const AN148 = setOf("A148", "A81")
const AN32 = setOf("AN32", "A32")

/** Union helper */
function union(...sets: ReadonlySet<string>[]): ReadonlySet<string> {
    const out = new Set<string>()
    for (const s of sets) for (const t of s) out.add(t)
    return out
}

const T3_SOUTH_STARTUP_ON_57 = union(ATR, DH8D, F50, SAAB)
const T3_NORTH_STARTUP = union(ATR, E120, E135_145, F50, SAAB)
const T3_NORTH_PUSH = union(CRJ_T3N_PUSH, F100)

const APRON_G_STARTUP = union(
    ATR, CASA, setOf("CRJ9", "CR9"), DH8D, FALCON, F50, GLOBAL,
    setOf("GLF5", "GLF6", "GA5", "GJ5"), SAAB,
)
const APRON_G_PUSH = union(
    A220, A320_FAM, B737,
    setOf("CRJ2", "CRJ7", "CRJX", "CR2", "CR7", "CRK"),
    setOf("E145", "ER4"), E170_175, E190_195, F100,
)

const R3_R4_STARTUP = union(
    AN26_72, ATR, CL60, CASA, E120, E135_145, E170_175, F50, FALCON, GLOBAL, GULF, SAAB,
)

const R5_STARTUP = union(ATR, F50)
const R5_PUSH = union(
    setOf(
        "A306", "ABY", "A310", "313", "31Y", "A320", "A321", "320", "321", "32A", "32N", "32B", "32Q", "32X",
        "A332", "A333", "A339", "A342", "A343", "A346", "A359", "A35K", "A388", "332", "333", "339", "342", "343", "346", "359", "351", "388",
        "AN12", "ANF", "AN26", "A26", "A124", "A4F", "B703", "K35R", "K35",
    ),
    B737,
    setOf(
        "B744", "B748", "744", "74Y", "74H", "74N", "B752", "B753", "752", "75C", "75W", "75V", "75T",
        "B762", "B763", "B764", "762", "76X", "763", "76Y", "76W", "76V", "764",
        "B772", "B77L", "B77W", "772", "77L", "77X", "77W",
        "B788", "B789", "788", "789", "C130", "LOH",
    ),
    CRJ_ALL, setOf("E190", "E90"), SAAB, setOf("IL76", "IL7", "MD11", "M1F"),
)

const S1_STARTUP = union(
    ATR, ATP, RJ_BAE, CASA, CRJ_ALL, DH8_ALL, DO228_328,
    setOf("E110", "EMB", "E140", "ERD"), E120, E135_145, E170_175,
    FALCON, F50, GLOBAL, GULF, IL114, setOf("JS31", "JS32", "JS41", "J31", "J32", "J41"),
    setOf("SW3"), SAAB,
)
const S1_PUSH = union(
    A220, A320_FAM, AN148, AN26_72, AN32, B717_727, B737, E190_195, F70, F100, MD80,
)

const APRON_K_PUSH = union(
    setOf(
        "A306", "AB6", "ABY", "A30B", "AB4", "ABF", "ABX", "A310", "312", "31X", "313", "31Y",
        "A332", "A333", "A339", "332", "333", "339", "AN12", "ANF",
    ),
    A320_FAM,
    setOf("RJ1H", "AR1"),
    setOf("B712", "717"),
    B737,
    setOf(
        "B742", "B743", "B744", "74Y", "B752", "75W", "75C", "75V", "B762", "76X", "B763", "76W", "76Y", "76V",
        "B788", "B789", "788", "789", "DC10", "D10", "F70", "F100", "100", "L101", "L11",
        "MD81", "MD82", "MD83", "M81", "M82", "M83",
    ),
)
const APRON_K_STARTUP = union(
    setOf("AN26", "A26", "A148", "A81"), ATP, ATR, setOf("RJ70", "RJ85", "AR7", "AR8"),
    setOf("C17", "C212", "CS2", "C130", "LOH"),
    CRJ_ALL, setOf("CL60", "CCJ", "CL6", "CL30", "CL35", "CL3", "CL4"),
    DH8D, E120, E135_145, E170_175, E190_195, FALCON, F50, GULF, GLOBAL,
    setOf("H25B", "H25", "H28", "H29", "HA4T", "H24", "LJ45", "LR4", "L45"),
    SAAB,
)

const ALWAYS_PUSH_RULE: StandRule = {
    startupTypes: setOf(),
    pushTypes: setOf(), // any approved → push; unapproved majority also push
    jetMajorityStartup: false,
    propMajorityStartup: false,
}

const S71_RULE: StandRule = {
    startupTypes: BIZ_S71,
    pushTypes: setOf(),
    jetMajorityStartup: true,
    propMajorityStartup: true,
}

const R9C_RULE: StandRule = {
    startupTypes: setOf("A388", "388", "A124", "A4F", "B748", "74H", "74N", "C5M"),
    pushTypes: setOf(),
    jetMajorityStartup: true,
    propMajorityStartup: true,
}

function rule(
    startup: ReadonlySet<string>,
    push: ReadonlySet<string>,
    jetMaj: boolean,
    propMaj: boolean,
): StandRule {
    return {
        startupTypes: startup,
        pushTypes: push,
        jetMajorityStartup: jetMaj,
        propMajorityStartup: propMaj,
    }
}

/** Resolve stand key used for rule lookup (normalize apron G / F / R / K / M prefixes). */
function canonicalStand(stand: string): string {
    // Apron G: accept 141–148 or G141–G148
    if (/^G?14[1-8]$/.test(stand)) {
        const n = stand.replace(/^G/, "")
        return `G${n}`
    }
    if (stand === "G149" || stand === "149") return "G149"
    return stand
}

function isAlwaysStartupStand(stand: string): boolean {
    if (stand === "G149") return true
    if (stand === "S4" || stand === "S5" || stand === "S6") return true
    if (/^M\d/.test(stand) || stand.startsWith("M")) return true
    return false
}

function isAlwaysPushStand(stand: string): boolean {
    // Terminal 2: 62–68
    if (/^6[2-8]$/.test(stand)) return true
    // Terminal 4: 31,33,35,37,39,41,43
    if (["31", "33", "35", "37", "39", "41", "43"].includes(stand)) return true
    // Pier A: 1,3,4,5,6,7,8,9,10
    if (["1", "3", "4", "5", "6", "7", "8", "9", "10"].includes(stand)) return true
    // Pier B: 12,14,16,18,20
    if (["12", "14", "16", "18", "20"].includes(stand)) return true
    // Pier F west / east
    if (/^F(28L|28R|29L|29R|30|31|32L|32R|33|34|35|36L|36R|37|38|39L|39R)$/.test(stand)) return true
    // Apron D even 102–112
    if (["102", "104", "106", "108", "110", "112"].includes(stand)) return true
    // Apron E odd 101–119
    if (["101", "103", "105", "107", "109", "111", "113", "115", "117", "119"].includes(stand)) return true
    // Apron F
    if (["F40", "F42", "F44"].includes(stand)) return true
    // K6–K9 tow-only → leave PUSH
    if (/^K[6-9]$/.test(stand)) return true
    return false
}

function lookupStandRule(stand: string): StandRule | undefined {
    if (stand === "R9C") return R9C_RULE

    // Terminal 3 south
    if (stand === "57") {
        return rule(T3_SOUTH_STARTUP_ON_57, setOf(), false, true)
    }
    if (stand === "60A" || stand === "53" || stand === "55") {
        // Props approved but push (not stop D); unapproved both → PUSH
        return rule(setOf(), T3_SOUTH_STARTUP_ON_57, false, false)
    }

    // Terminal 3 north
    if (stand === "52" || stand === "54" || stand === "56" || stand === "58") {
        return rule(T3_NORTH_STARTUP, T3_NORTH_PUSH, false, true)
    }

    // Apron G 141–148
    if (/^G14[1-8]$/.test(stand)) {
        return rule(APRON_G_STARTUP, APRON_G_PUSH, false, true)
    }

    // Apron R
    if (stand === "R3" || stand === "R4") {
        return rule(R3_R4_STARTUP, setOf(), true, true)
    }
    if (/^R(5|6|7|8|9|10|10[ABC])$/.test(stand)) {
        return rule(R5_STARTUP, R5_PUSH, false, true)
    }

    // Apron S
    if (stand === "S1" || stand === "S2" || stand === "S3") {
        return rule(S1_STARTUP, S1_PUSH, false, true)
    }
    if (/^S(7[1-9]|8[0-2])$/.test(stand)) {
        return S71_RULE
    }

    // Apron K (simplified: known push / startup type lists; majority jet PUSH / prop START UP)
    // GRplugin: K3A–K3E, K5/K5L/K5R; APK1/APK2 normalize to K1/K2
    if (/^K(1|2|3[ABCDE]|4[ABC]|5|5L|5R)$/.test(stand)) {
        return rule(APRON_K_STARTUP, APRON_K_PUSH, false, true)
    }

    if (isAlwaysPushStand(stand)) return ALWAYS_PUSH_RULE

    return undefined
}

/** How a stand name maps into the push/start tables (after normalize). */
export type EssaPushStandCoverage =
    | "always-startup"
    | "always-push"
    | "typed-rule"
    | "unknown"

export function classifyEssaPushStandCoverage(
    stand: string | undefined | null,
): EssaPushStandCoverage {
    const s = canonicalStand(normalizeStandName(stand))
    if (!s) return "unknown"
    if (isAlwaysStartupStand(s)) return "always-startup"
    if (isAlwaysPushStand(s)) return "always-push"
    if (lookupStandRule(s)) return "typed-rule"
    return "unknown"
}

function resolveFromRule(
    rule: StandRule,
    type: string,
    eng: EngineClass,
): boolean {
    if (type && rule.startupTypes.has(type)) return true
    if (type && rule.pushTypes.has(type)) return false

    // Not approved or missing type → majority for this engine (missing engine → jet).
    // Precomputed majorities already apply the “other engine” fallback where needed.
    if (eng === "prop") return rule.propMajorityStartup
    return rule.jetMajorityStartup
}

/**
 * True when this stand + aircraft should use startup (STUP) instead of pushback (PUSH).
 * Missing stand → push. Always-startup stands (G149, S4–S6, apron M) ignore type.
 */
export function standRequiresStartupInsteadOfPush(
    stand: string | undefined | null,
    aircraftType?: string | null,
    engineType?: string | null,
): boolean {
    const s = canonicalStand(normalizeStandName(stand))
    if (!s) return false

    if (isAlwaysStartupStand(s)) return true

    const type = normalizeType(aircraftType)
    const eng = engineClass(engineType)
    const standRule = lookupStandRule(s)
    if (!standRule) return false

    return resolveFromRule(standRule, type, eng)
}

/** Remap PUSH → STUP when stand rules say startup-only. */
export function remapPushActionForStand<T extends string>(
    action: T | undefined,
    stand: string | undefined | null,
    aircraftType?: string | null,
    engineType?: string | null,
): T | undefined {
    if (action !== ("PUSH" as T)) return action
    if (standRequiresStartupInsteadOfPush(stand, aircraftType, engineType)) return "STUP" as T
    return action
}

/**
 * Ground state when dropping onto a PUSH BACK / START UP workspace header (ESSA).
 * - PUSH BACK → PUSH
 * - START UP → STUP
 * - Merged PUSH BACK / START UP → same as action-key (stand + type)
 */
export function groundstateForEssaPushDrop(
    dropSectionId: string,
    stand: string | undefined | null,
    aircraftType?: string | null,
    engineType?: string | null,
): "PUSH" | "STUP" | undefined {
    if (dropSectionId === "push_back") return "PUSH"
    if (dropSectionId === "start_up") return "STUP"
    if (dropSectionId === "push_start" || dropSectionId.endsWith("_push_start")) {
        return standRequiresStartupInsteadOfPush(stand, aircraftType, engineType) ? "STUP" : "PUSH"
    }
    return undefined
}
