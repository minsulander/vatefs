/**
 * Local (ADEP+ADES at our airports) strip presentation helpers.
 *
 * Outbound locals use DEP strip layout (SID/EOBT/…); inbound/returning locals use
 * ARR layout (ETA/CTL/…). Matches ESSA/ESGG conventions: airborne locals default
 * to CTR DEP until the controller moves them to CTR ARR / inbound cues appear
 * (cleared-to-land, ARR/TXIN/PARK, ATA, or an ARR-side section).
 */

export type LocalStripPresentationFields = {
    stripType?: string
    groundstate?: string
    clearedToLand?: boolean
    ata?: string
    airborne?: boolean
    /** Current bay section — distinguishes CTR DEP vs CTR ARR / inbound */
    sectionId?: string
}

const ARR_GROUNDSTATES = new Set(["ARR", "TXIN", "PARK"])
const DEP_GROUNDSTATES = new Set([
    "NSTS",
    "ONFREQ",
    "DE-ICE",
    "STUP",
    "PUSH",
    "TAXI",
    "LINEUP",
    "DEPA",
])

/** ARR-side bay section for a local (CTR ARR / inbound / taxi-in / ARR RWY). */
export function isLocalArrSideSection(sectionId: string | undefined): boolean {
    if (!sectionId) return false
    const id = sectionId.toLowerCase()
    if (id === "ctr_arr" || id.endsWith("_ctr_arr")) return true
    if (id === "taxi_arr" || id.endsWith("_taxi_arr")) return true
    if (id === "arr_runway" || id.endsWith("_arr_runway") || id.endsWith("_arr_rwy")) return true
    if (id === "inbound" || id === "inbound_gnd") return true
    if (id.endsWith("_inbound") || id.endsWith("_inbound_gnd")) return true
    // ESSA INBOUND TWR AoR columns (inbound_twr_w / …)
    if (id.startsWith("inbound_") || id.includes("_inbound_")) return true
    return false
}

/** DEP-side bay section for a local (CTR DEP / dep ground flow / DEP RWY). */
export function isLocalDepSideSection(sectionId: string | undefined): boolean {
    if (!sectionId) return false
    const id = sectionId.toLowerCase()
    if (id === "ctr_dep" || id.endsWith("_ctr_dep")) return true
    if (id === "taxi_dep" || id.endsWith("_taxi_dep")) return true
    if (id === "dep_runway" || id.endsWith("_dep_runway") || id.endsWith("_dep_rwy")) return true
    if (id === "pending_dep" || id.endsWith("_pending_dep")) return true
    if (id === "cleared" || id.endsWith("_cleared")) return true
    if (id.endsWith("_clr") && !id.includes("taxi_arr")) return true
    if (id === "push_start" || id.includes("push_start")) return true
    if (id === "req_push" || id.endsWith("_req_push")) return true
    return false
}

/**
 * True when a local strip should use arrival presentation / ARR-like stacking.
 *
 * Priority:
 * 1. Explicit ARR groundstates / CTL / ATA → ARR
 * 2. Explicit DEP groundstates (outbound ground flow) → DEP
 * 3. ARR-side section (ctr_arr, inbound, taxi_arr, …) → ARR
 * 4. DEP-side section (ctr_dep, taxi_dep, …) → DEP
 * 5. Airborne without inbound cues → DEP (CTR DEP default for local circuit)
 * 6. Otherwise → DEP
 */
export function isLocalInboundPresentation(strip: LocalStripPresentationFields): boolean {
    if (strip.stripType !== "local") return false

    const gs = (strip.groundstate || "").toUpperCase()
    if (ARR_GROUNDSTATES.has(gs)) return true
    if (strip.clearedToLand) return true
    if (strip.ata) return true

    // Outbound ground flow stays DEP even if section is ambiguous
    if (DEP_GROUNDSTATES.has(gs)) return false

    if (isLocalArrSideSection(strip.sectionId)) return true
    if (isLocalDepSideSection(strip.sectionId)) return false

    // Airborne local without CTL / ARR section → outbound (CTR DEP convention)
    if (strip.airborne) return false

    return false
}
