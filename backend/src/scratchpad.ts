/**
 * EuroScope scratchpad ↔ VatEFS remarks + holding point (HP).
 *
 * VCH hold short (HS) is NOT stored here — strip annotation 4.
 * Departure Coordination (DepC / coo) is NOT stored here — strip annotation 6.
 *
 * Format:
 *   .URNAV /Y2     — remarks + HP (HP after remarks)
 *   .URNAV         — remarks only
 *   /Y2            — HP only (single alphanumeric token)
 *   .SLOW          — slow flag (leading dot, same as other remarks)
 *   SLOW           — bare TopSky form still accepted when reading
 *   1345 .URNAV /Y2  — optional leading CTOT (HHMM, no colon — ES rejects ":") or " SLC"
 *                      (leading space). Legacy "13:45" is still accepted when reading.
 *
 * Protocol scratches (/ROF/…, /LAM/ROF/…, /EFSROF/…, /RJC/…, etc.) must not
 * touch remarks or HP — return null to leave existing fields unchanged.
 */

import { isEssaRnpOpTextScratch } from "@vatefs/common"
import { groundstateFromScratch, isGroundstateToken } from "./groundstate.js"

export { groundstateFromScratch, isGroundstateToken }
/** @deprecated use isGroundstateToken */
export const isSwedishGroundstateScratch = isGroundstateToken

/**
 * Leading CTOT `HHMM` (legacy `HH:MM` still parsed), or leading-space SLC/SCL (FLEG-safe).
 * EuroScope does not allow ":" in the scratchpad — writes always use `HHMM`.
 */
const LEADING_CDM_SCRATCH_RE = /^(?:(\d{4}|\d{2}:\d{2})|(\s+(?:SLC|SCL)))(?:\s+|$)/i

/** Format HHmm → `HHMM` for scratchpad CTOT (no colon; ES truncates labels at ":"). */
export function formatCtotScratchHhmm(ctot: string | undefined | null): string | undefined {
    if (!ctot) return undefined
    const digits = String(ctot).replace(/\D/g, "")
    if (digits.length < 3) return undefined
    const n = digits.length === 3 ? digits.padStart(4, "0") : digits.slice(0, 4)
    if (n.length < 4) return undefined
    return n.slice(0, 4)
}

/**
 * ESSA CTOT/SLC scratch token (leading).
 * Live CTOT → `HHMM`; cancel latch / live SLC → ` SLC` (leading space for FLEG).
 */
export function cdmScratchToken(flight: {
    ctot?: string
    ctotCancelled?: boolean
    cdmSts?: string
}): string | undefined {
    const hhmm = formatCtotScratchHhmm(flight.ctot)
    if (hhmm) return hhmm
    if (flight.ctotCancelled) return " SLC"
    const sts = flight.cdmSts?.trim().toUpperCase()
    if (sts === "SLC" || sts === "SCL") return " SLC"
    return undefined
}

/** Which leading CDM token (if any) the scratch carries: live CTOT or SLC. */
export function leadingCdmScratchKind(
    scratch: string | undefined | null,
): "ctot" | "slc" | undefined {
    if (!scratch) return undefined
    const m = scratch.match(LEADING_CDM_SCRATCH_RE)
    if (!m) return undefined
    return m[1] ? "ctot" : "slc"
}

/** Strip a leading CTOT/SLC token written by VatEFS; returns remainder for remarks/HP parse. */
export function stripLeadingCdmScratchToken(scratch: string): string {
    const m = scratch.match(LEADING_CDM_SCRATCH_RE)
    if (!m) return scratch
    return scratch.slice(m[0].length)
}

/** Persistent scratch: optional leading CTOT/SLC + remarks + HP (never DepC / coo). */
export function buildCombinedScratch(
    remarks: string | undefined,
    hp: string | undefined,
    cdmToken?: string | undefined,
): string {
    const r = remarks?.trim()
    const h = hp?.trim().toUpperCase()
    let base = ""
    if (r && h) base = `.${r} /${h}`
    else if (h) base = `/${h}`
    else if (r) base = `.${r}`

    const c = cdmToken
    if (c == null || c === "") return base
    // SLC form already includes a leading space; HHMM needs a separator before notes.
    if (!base) return c
    if (c.startsWith(" ")) return `${c} ${base}`
    return `${c} ${base}`
}

/**
 * Scratch string for EuroScope. When `hpScratchCleared`, HP stays on the EFS
 * strip only (cleared from ES on airborne/CFTO) until the strip is removed.
 */
export function buildFlightScratch(flight: {
    remarks?: string
    hp?: string
    hpScratchCleared?: boolean
    ctot?: string
    ctotCancelled?: boolean
    cdmSts?: string
}, opts?: { cdmToken?: string | undefined }): string {
    const cdmToken =
        opts && "cdmToken" in opts ? opts.cdmToken : undefined
    return buildCombinedScratch(
        flight.remarks,
        flight.hpScratchCleared ? undefined : flight.hp,
        cdmToken,
    )
}

/** @deprecated use buildCombinedScratch — kept for call sites that only set remarks */
export function buildScratchRemarks(remarks: string | undefined): string {
    return buildCombinedScratch(remarks, undefined)
}

/** Handover Assistant mark. Protocol-only — must not stick on the radar label. */
export function isHandoverAssistantScratch(scratch: string | undefined | null): boolean {
    if (!scratch) return false
    const s = scratch.trim().toUpperCase()
    return s === "EFSHO" || s === "/EFSHO/"
}

/**
 * Relieving controller who now tracks the flight should replace EFSHO with the
 * real remarks/HP scratch. The controller who wrote the token still tracks it
 * on purpose until the handoff is accepted.
 */
export function shouldClearHandoverScratch(opts: {
    efshoOnScratch: boolean
    efshoSetByMe: boolean
    trackedByMe: boolean
}): boolean {
    return opts.efshoOnScratch && !opts.efshoSetByMe && opts.trackedByMe
}

/** True when scratch is a TopSky/ops message that must not update remarks or HP. */
export function isProtocolScratch(scratch: string): boolean {
    // TopSky manual-alert / G/A scratch tokens (MISAP_, EST_, IRREG_, WX_)
    if (
        scratch === "MISAP_" ||
        scratch === "EST_" ||
        scratch === "IRREG_" ||
        scratch === "WX_" ||
        scratch === "NOSTATE" ||
        isHandoverAssistantScratch(scratch)
    ) {
        return true
    }
    if (isGroundstateToken(scratch)) return true
    // Holding point is exactly /TOKEN; anything else starting with / is protocol
    if (scratch.startsWith("/") && !/^\/[A-Z0-9]+\s*$/i.test(scratch)) return true
    return false
}

/**
 * Ground Radar stand broadcast embedded in the scratch pad.
 * - GRP/S/<stand> — list/handoff stand token
 * - GRP/M/<airport>/<stand> — move-to-stand (authoritative assignment)
 * Returns undefined when the scratch is not a stand broadcast (leave flight.stand).
 */
export function standFromGrpScratch(scratch: string | undefined | null): string | undefined {
    if (!scratch) return undefined
    const setMatch = scratch.match(/GRP\/S\/([A-Z0-9]{1,6})/i)
    if (setMatch?.[1]) return setMatch[1].toUpperCase()
    // GRP/M/ESSA/F34 — airport + stand (seen when controller moves ACFT on stand in GR)
    const moveMatch = scratch.match(/GRP\/M\/[A-Z]{4}\/([A-Z0-9]{1,6})/i)
    if (moveMatch?.[1]) return moveMatch[1].toUpperCase()
    return undefined
}

function parseRemarksAndHp(body: string): {
    remarks: string | undefined
    hp: string | undefined
} {
    const trimmed = body.trim()
    if (!trimmed) return { remarks: undefined, hp: undefined }

    const combined = trimmed.match(/^(.*?)\s+\/([A-Z0-9]+)\s*$/i)
    if (combined) {
        return {
            remarks: combined[1]!.trim() || undefined,
            hp: combined[2]!.trim().toUpperCase() || undefined,
        }
    }

    const hpOnly = trimmed.match(/^\/([A-Z0-9]+)\s*$/i)
    if (hpOnly) {
        return { remarks: undefined, hp: hpOnly[1]!.toUpperCase() }
    }

    return { remarks: trimmed || undefined, hp: undefined }
}

/**
 * Parse scratch into remarks + HP.
 * `null` = leave existing flight field unchanged (special TopSky ops).
 * DepC / coo is never derived from scratch (strip annotation 6).
 */
export function parseCombinedScratch(scratch: string): {
    remarks: string | undefined | null
    hp: string | undefined | null
} {
    // GRP/S/<stand> is a stand broadcast, not remarks. Do not start a scratch hold.
    if (standFromGrpScratch(scratch)) {
        return { remarks: null, hp: null }
    }
    if (isProtocolScratch(scratch)) {
        return { remarks: null, hp: null }
    }

    if (scratch === "") {
        return { remarks: undefined, hp: undefined }
    }

    // Strip leading CTOT HHMM (or legacy HH:MM) or " SLC"/" SCL" before remarks/HP parse
    const withoutCdm = stripLeadingCdmScratchToken(scratch)
    if (withoutCdm !== scratch) {
        if (!withoutCdm.trim()) {
            return { remarks: undefined, hp: undefined }
        }
        return parseCombinedScratch(withoutCdm)
    }

    if (scratch.toUpperCase() === "SLOW") {
        return { remarks: "SLOW", hp: undefined }
    }

    if (scratch.startsWith(".")) {
        const { remarks, hp } = parseRemarksAndHp(scratch.substring(1))
        return { remarks, hp }
    }

    // HP only: /Y2
    const hpOnly = scratch.match(/^\/([A-Z0-9]+)\s*$/i)
    if (hpOnly) {
        return {
            remarks: undefined,
            hp: hpOnly[1]!.toUpperCase(),
        }
    }

    // ESSA OP-TEXT2 RNP markers (LOP) — often entered without a leading "."
    if (isEssaRnpOpTextScratch(scratch)) {
        const { remarks, hp } = parseRemarksAndHp(scratch)
        return { remarks, hp }
    }

    return { remarks: undefined, hp: undefined }
}

/** Remarks-only parse (ignores HP). Prefer parseCombinedScratch. */
export function parseScratchRemarks(scratch: string | undefined): string | undefined | null {
    if (scratch === undefined) return null
    return parseCombinedScratch(scratch).remarks
}
