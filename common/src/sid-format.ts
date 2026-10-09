/**
 * Display formatting for SID names.
 *
 * - RNAV: "PETEV3G" → "PETEV 3G"
 * - VFR:  "VFR·NORTH" / "VFR.NORTH" → "NORTH"
 * - Radar-vector (not SLOW): "ARS6E·KOGAV" → "ARS 6E veKOGAV"
 * - SLOW track:
 *   - one separator:  "120·BABAP" → "120veBABAP"
 *   - two separators: "010·240·NOSLI" → "010·240veNOSLI" (keep first ·, replace second with ve)
 */

const TRACK_SEP_RE = /[·•*]/

/** Real SLOW/track SIDs: NNN·EXIT or NNN·NNN·EXIT (not namedSID·EXIT). */
const TRACK_SID_RE = /^\d{3}([·•*]\d{3})?[·•*][A-Z]{2,}$/i

/**
 * True when the FPL route starts with a forced SID/rwy (or track·…/rwy),
 * not bare ICAO/rwy (e.g. ESSA/01L).
 */
export function hasForcedSidInRoute(route: string | undefined | null): boolean {
    if (!route) return false
    const first = route.trim().split(/\s+/)[0] || ""
    const slash = first.indexOf("/")
    if (slash <= 0) return false
    const prefix = first.slice(0, slash)
    if (/^[A-Z]{4}$/i.test(prefix)) return false
    return true
}

/** RNAV spacing for a compact designator: ARS6E → ARS 6E */
function formatNamedSidBase(base: string): string {
    const m = base.match(/^([A-Za-z]{2,})(\d+[A-Za-z]+)$/)
    if (!m) return base.toUpperCase()
    return `${m[1]!.toUpperCase()} ${m[2]!.toUpperCase()}`
}

/**
 * Radar-vector SID: named procedure · TMA exit (e.g. ARS6E·KOGAV, KOGAV4L·ARS).
 * Not a SLOW track — normal RNAV CFL (5000 ft at ESSA).
 */
export function parseVectorSidName(
    sid: string | undefined | null,
): { base: string; exit: string } | null {
    if (!sid) return null
    const raw = sid.trim().toUpperCase().replace(/\s+/g, "")
    if (!raw || /^VFR/i.test(raw)) return null
    if (!TRACK_SEP_RE.test(raw)) return null
    const parts = raw.split(TRACK_SEP_RE).filter(Boolean)
    if (parts.length !== 2) return null
    const [base, exit] = parts
    if (!base || !exit) return null
    if (!/^[A-Z]{2,}\d+[A-Z]+$/.test(base)) return null
    if (!/^[A-Z]{2,5}$/.test(exit) || exit.length === 4) return null
    return { base, exit }
}

export function isVectorSidName(sid: string | undefined | null): boolean {
    return parseVectorSidName(sid) !== null
}

/**
 * True for heading/track SLOW SIDs only (NNN·EXIT / NNN·NNN·EXIT).
 * Radar-vector SIDs (ARS6E·KOGAV) return false.
 */
export function isTrackSidName(sid: string | undefined | null): boolean {
    if (!sid) return false
    const raw = sid.trim().toUpperCase().replace(/\s+/g, "")
    if (!raw || raw.startsWith("VFR")) return false
    if (isVectorSidName(raw)) return false
    return TRACK_SID_RE.test(raw)
}

/**
 * IFR / IFR→VFR only — preferred SID + auto-SLOW rules apply.
 * V (VFR) and Z (VFR→IFR) never auto-assign SLOW SIDs or the SLOW flag.
 */
export function isIfrSidEligible(flightRules: string | undefined | null): boolean {
    return flightRules === 'I' || flightRules === 'Y'
}

/** True when remarks contain a SLOW token (exact or among other flags). */
export function hasSlowRemark(remarks: string | undefined | null): boolean {
    return /\bSLOW\b/i.test(remarks ?? '')
}

/** Add or remove the SLOW remarks token. Returns trimmed remarks (may be empty). */
export function withSlowRemark(remarks: string | undefined | null, enabled: boolean): string {
    const current = (remarks ?? '').trim()
    if (enabled) {
        if (hasSlowRemark(current)) return current
        return current ? `${current} SLOW` : 'SLOW'
    }
    return current.replace(/\.?\bSLOW\b/gi, '').replace(/\s+/g, ' ').trim()
}

/** Strip display form for ESE track/SLOW SIDs. */
export function formatTrackSidDisplay(sid: string | undefined | null): string | null {
    if (!sid) return null
    const raw = sid.trim().toUpperCase().replace(/\s+/g, "")
    if (!raw || /^VFR/i.test(raw)) return null
    if (isVectorSidName(raw)) return null
    if (!TRACK_SEP_RE.test(raw)) return null

    const parts = raw.split(TRACK_SEP_RE).filter(Boolean)
    if (parts.length === 3) {
        const [a, b, exit] = parts
        if (/^\d{3}$/.test(a!) && /^\d{3}$/.test(b!) && /^[A-Z]{2,}$/.test(exit!)) {
            // Keep first separator, replace second with ve
            return `${a!}·${b!}ve${exit!}`
        }
        return null
    }
    if (parts.length === 2) {
        const [heading, exit] = parts
        if (/^\d{3}$/.test(heading!) && /^[A-Z]{2,}$/.test(exit!)) {
            return `${heading!}ve${exit!}`
        }
    }
    return null
}

/**
 * Display for radar-vector SIDs: "ARS 6E veKOGAV".
 * Prefers filled TMA exit from FPL when provided.
 */
export function formatVectorSidDisplay(
    sid: string | undefined | null,
    tmaExit?: string | null,
): string | null {
    const parsed = parseVectorSidName(sid)
    if (!parsed) return null
    const exit = (tmaExit || "").trim().toUpperCase() || parsed.exit
    return `${formatNamedSidBase(parsed.base)} ve${exit}`
}

/** @deprecated AHDG is no longer derived from SID */
export function parseTrackSid(sid: string | undefined | null): { ahdg: string; display: string } | null {
    const display = formatTrackSidDisplay(sid)
    if (!display) return null
    const raw = sid!.trim().toUpperCase().replace(/\s+/g, "")
    const parts = raw.split(TRACK_SEP_RE).filter(Boolean)
    const ahdg = parts[0] && /^\d{3}$/.test(parts[0]) ? parts[0] : ""
    if (!ahdg) return null
    return { ahdg, display }
}

export function formatSidForDisplay(
    sid: string | undefined | null,
    tmaExit?: string | null,
): string {
    if (!sid) return ""
    const s = sid.trim()
    if (!s) return ""

    // VFR·NAME / VFR.NAME / VFR NAME → NAME
    if (/^VFR/i.test(s)) {
        const rest = s.replace(/^VFR\s*[·.•.]?\s*/i, "").trim()
        return rest || s
    }

    const vector = formatVectorSidDisplay(s, tmaExit)
    if (vector) return vector

    const track = formatTrackSidDisplay(s)
    if (track) return track

    if (/\s/.test(s)) return s
    // EXIT + designator (digits + letter), e.g. PETEV3G, ARS5C, ROKNI3R
    const m = s.match(/^([A-Za-z]{2,})(\d+[A-Za-z]+)$/)
    if (!m) return s
    return `${m[1]!.toUpperCase()} ${m[2]!.toUpperCase()}`
}

/**
 * TMA exit = first significant FPL route point, excluding ADEP/rwy and SID/rwy.
 * SID procedure name is ignored (ROKNI4R/08 ARS … → ARS).
 * `sid` is unused (kept for call-site compatibility).
 */
export function extractTmaExitPoint(
    _sid: string | undefined | null,
    route: string | undefined | null,
): string | undefined {
    if (!route) return undefined
    for (const raw of route.split(/\s+/)) {
        const upper = raw.trim().toUpperCase()
        if (!upper || upper === "DCT") continue
        // Skip ADEP/rwy and SID/rwy entirely (do not treat SID name as the exit)
        if (upper.includes("/")) continue
        if (/^\d{1,2}[LRC]?$/i.test(upper)) continue
        if (/^[NKM]\d{3,4}[FASM]\d{3,4}$/i.test(upper)) continue
        if (/^VFR/i.test(upper)) continue
        // Skip bare ICAO airports
        if (/^[A-Z]{4}$/.test(upper)) continue
        // Skip named SID designators left in the route without /rwy
        if (/^[A-Z]{2,}\d+[A-Z]+$/.test(upper)) continue
        // Vector SID in route (ARS6E·KOGAV) → exit is the suffix
        const vector = parseVectorSidName(upper)
        if (vector) return vector.exit
        if (TRACK_SEP_RE.test(upper)) {
            const last = upper.split(TRACK_SEP_RE).filter(Boolean).pop()
            if (last && /^[A-Z]{2,}$/.test(last)) return last
            continue
        }
        // Bare fix (2–3 or 5 letters) — the TMA exit
        if (/^[A-Z]{2,3}$/.test(upper) || /^[A-Z]{5}$/.test(upper)) return upper
    }
    return undefined
}
