/**
 * EuroScope / GRP ground-state tokens ↔ VatEFS canonical.
 *
 * READ: accept native ES names and legacy GRP aliases (S/P, TXO, xLU, …).
 * WRITE: native ES names only (PUSH, TAXI, LINEUP, …) — GNG display labels are
 * overridden via GRpluginSettings.txt; GRP aliases do not set GetGroundState().
 *
 * VatEFS rules / UI use:
 *   ONFREQ, DE-ICE, STUP, PUSH, TXIN, TAXI, LINEUP, DEPA, PARK
 */

/** GRP + legacy scratch tokens that count as ground-state (not remarks). */
const GROUNDSTATE_TOKEN_SET = new Set([
    // Canonical
    "LINEUP",
    "ONFREQ",
    "DE-ICE",
    "TAXI",
    "TXIN",
    "DEPA",
    "PUSH",
    "STUP",
    "ARR",
    "PARK",
    "NSTS",
    // GRP System_State_* (uppercased)
    "XLU",
    "XTO",
    "TXO",
    "TXI",
    "FRQ",
    "RDY",
    "S/U",
    "S/P",
    "PRK",
])

const TO_CANONICAL: Record<string, string> = {
    XLU: "LINEUP",
    XTO: "DEPA",
    TXO: "TAXI",
    TXI: "TXIN",
    FRQ: "ONFREQ",
    RDY: "DE-ICE",
    "S/U": "STUP",
    "S/P": "PUSH",
    PRK: "PARK",
    // Identity for already-canonical
    LINEUP: "LINEUP",
    DEPA: "DEPA",
    TAXI: "TAXI",
    TXIN: "TXIN",
    ONFREQ: "ONFREQ",
    "DE-ICE": "DE-ICE",
    STUP: "STUP",
    PUSH: "PUSH",
    PARK: "PARK",
    ARR: "ARR",
    NSTS: "NSTS",
}

/**
 * Canonical VatEFS → token written to ES scratch.
 * Native ES names (GRpluginSettings "actual"); GRP aliases like S/P/TXO do not stick.
 */
const TO_ES_WRITE: Record<string, string> = {
    LINEUP: "LINEUP",
    DEPA: "DEPA",
    TAXI: "TAXI",
    TXIN: "TXIN",
    ONFREQ: "ONFREQ",
    "DE-ICE": "DE-ICE",
    STUP: "STUP",
    PUSH: "PUSH",
    PARK: "PARK",
}

function tokenKey(raw: string): string {
    return raw.trim().toUpperCase()
}

export function isGroundstateToken(raw: string): boolean {
    return GROUNDSTATE_TOKEN_SET.has(tokenKey(raw))
}

/**
 * Normalize GRP/ES ground-state string to VatEFS canonical (LINEUP, TAXI, …).
 * Empty string stays empty; unknown tokens pass through trimmed.
 */
export function normalizeGroundstate(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined
    const trimmed = raw.trim()
    if (trimmed === "") return ""
    const key = tokenKey(trimmed)
    return TO_CANONICAL[key] ?? trimmed
}

/** Map canonical VatEFS GS to native ES write token for setGroundState. */
export function toSwedishGroundstateToken(canonical: string): string {
    const key = tokenKey(canonical)
    return TO_ES_WRITE[key] ?? canonical
}

/**
 * If scratch is a GS token, return canonical groundstate; else undefined.
 */
export function groundstateFromScratch(scratch: string | undefined): string | undefined {
    if (!scratch || !isGroundstateToken(scratch)) return undefined
    return normalizeGroundstate(scratch)
}

/**
 * GRP advanced / EFS tokens that refine coarse GetGroundState() (PUSH/TAXI/DEPA).
 * GetGroundState() often stays "TAXI" for both TXO and xLU — scratch holds xLU.
 */
export function isPreciseGroundstateToken(raw: string): boolean {
    const key = tokenKey(raw)
    return (
        key === "XLU" ||
        key === "XTO" ||
        key === "TXO" ||
        key === "TXI" ||
        key === "FRQ" ||
        key === "RDY" ||
        key === "S/U" ||
        key === "S/P" ||
        key === "PRK" ||
        key === "LINEUP" || // legacy EFS write
        key === "ONFREQ" ||
        key === "DE-ICE" ||
        key === "STUP" ||
        key === "TXIN" ||
        key === "NSTS"
    )
}

/** Coarse native ES GetGroundState() values (SDK: PUSH, TAXI, DEPA, empty). */
export function isCoarseNativeGroundstate(canonical: string): boolean {
    return canonical === "TAXI" || canonical === "PUSH" || canonical === "DEPA"
}

/**
 * Resolve incoming GS from CAD/refresh.
 * Precise scratch (xLU/TXO/…) wins over coarse GetGroundState TAXI/PUSH/DEPA.
 */
export function resolveIncomingGroundstate(opts: {
    scratch?: string
    groundstate?: string
    current?: string
}): string | undefined {
    const { scratch, groundstate, current } = opts
    if (scratch === "NOSTATE") return ""

    const scratchGs = groundstateFromScratch(scratch)
    const esGs =
        groundstate !== undefined && groundstate !== ""
            ? normalizeGroundstate(groundstate)
            : undefined
    const scratchPrecise = !!scratch && isPreciseGroundstateToken(scratch)
    const esPrecise = !!groundstate && isPreciseGroundstateToken(groundstate)

    // Live precise GetGroundState (xLU) always wins
    if (esPrecise && esGs) return esGs

    // GRP precise scratch (xLU) wins over coarse TAXI from GetGroundState
    if (scratchPrecise && scratchGs) return scratchGs

    if (esGs) {
        // Don't let coarse TAXI wipe LINEUP when scratch has no GS token
        if (
            isCoarseNativeGroundstate(esGs) &&
            current === "LINEUP" &&
            esGs === "TAXI" &&
            !scratchGs
        ) {
            return undefined
        }
        return esGs
    }

    if (scratchGs) return scratchGs
    // Bare empty GetGroundState() is unreliable (refresh dumps wipe known PUSH/TAXI/…).
    // Explicit clear is scratch NOSTATE (handled above). Treat empty as "no GS update".
    if (groundstate === "") return undefined
    return undefined
}
