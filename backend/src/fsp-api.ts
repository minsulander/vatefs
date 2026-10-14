/**
 * VatFSP-compatible integration API helpers.
 * VatIRIS posts to POST /api/print/external with the same payload as VatFSP.
 * @see https://github.com/maxlk96/vatfsp/blob/main/VATIRIS_INTEGRATION_API.md
 */

import os from "node:os"
import type { PaperInfoKind } from "@vatefs/common"

export const EFS_HTTP_PORT = 17770

export type ExternalPrintBody = {
    callsign?: string
    type?: string
    flightRules?: string
    flightType?: string
    aircraft?: string
    aircraftType?: string
    wtc?: string
    wakeTurbulence?: string
    transponder?: string
    squawk?: string
    sid?: string
    departure?: string
    origin?: string
    /** VatIRIS flight list field */
    adep?: string
    arrival?: string
    destination?: string
    /** VatIRIS flight list field */
    ades?: string
    route?: string
    rfl?: string
    cruiseAltitude?: string
    altitude?: string
    eobt?: string
    departureTime?: string
    /** VatIRIS often sends scheduled time as std */
    std?: string
    ctot?: string
    ctotTime?: string
    ctot_time?: string
    eta?: string
    estimatedArrival?: string
    tas?: string
    speed?: string
}

export function pickExternalField(
    body: ExternalPrintBody,
    ...keys: (keyof ExternalPrintBody)[]
): string | undefined {
    for (const k of keys) {
        const v = body[k]
        if (typeof v === "string" && v.trim()) return v.trim()
    }
    return undefined
}

export function externalStripType(body: ExternalPrintBody): "departure" | "arrival" {
    const t = (body.type || "").toLowerCase()
    return t === "arrival" ? "arrival" : "departure"
}

export function blankPaperInfoKind(body: ExternalPrintBody): PaperInfoKind {
    return externalStripType(body) === "arrival" ? "empty_arr" : "empty_dep"
}

/** Score LAN IPv4 for "best" address to show in settings (same preference as ES plugin). */
function lanScore(ip: string): number {
    if (ip.startsWith("192.168.")) return 3
    if (ip.startsWith("10.")) return 2
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 1
    return 0
}

/**
 * Preferred LAN HTTP base URLs for VatIRIS FSP settings (copy into IRIS).
 * Excludes loopback / link-local.
 */
export function listFspServerBaseUrls(port: number = EFS_HTTP_PORT): string[] {
    const scored: { ip: string; score: number }[] = []
    for (const addrs of Object.values(os.networkInterfaces())) {
        if (!addrs) continue
        for (const a of addrs) {
            if (a.family !== "IPv4" && (a.family as unknown) !== 4) continue
            if (a.internal) continue
            const ip = a.address
            if (ip.startsWith("127.") || ip.startsWith("169.254.")) continue
            scored.push({ ip, score: lanScore(ip) })
        }
    }
    scored.sort((a, b) => b.score - a.score || a.ip.localeCompare(b.ip))
    const urls = scored.map((s) => `http://${s.ip}:${port}`)
    if (urls.length === 0) urls.push(`http://127.0.0.1:${port}`)
    return urls
}

export function parseExternalRflFeet(raw: string | undefined): number | undefined {
    if (!raw) return undefined
    const s = raw.trim().toUpperCase().replace(/\s+/g, "")
    if (!s) return undefined
    if (/^FL\d{2,3}$/.test(s)) return Number(s.slice(2)) * 100
    if (/^F\d{2,3}$/.test(s)) return Number(s.slice(1)) * 100
    if (/^A\d{3}$/.test(s)) return Number(s.slice(1)) * 100
    if (/^\d{2,3}$/.test(s) && Number(s) < 600) return Number(s) * 100
    if (/^\d{4,5}$/.test(s)) return Number(s)
    return undefined
}
