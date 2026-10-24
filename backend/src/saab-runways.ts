/**
 * OTHER dynamic RUNWAY section helpers (catalog-added headers + auto-route).
 *
 * Section ids:
 * - Single-airport style: runway_17_35 (same shape as ESSA pairs)
 * - Multi-airport: runway_ESMS_17_35
 */

import { isEssaDynamicRunwaySectionId } from '@vatefs/common'
import type { EfsStaticConfig } from './config-types.js'
import type { Flight } from './types.js'
import { isOnAnyRunway } from './runway-detection.js'
import { isSaabLayoutsConfig } from './config-loader.js'
import { getRunwaysByAirport } from './runway-data.js'

const ICAO_SCOPED = /^runway_([A-Z]{4})_(.+)$/i

export function isSaabLayouts(config: { layoutMode?: string }): boolean {
    return isSaabLayoutsConfig(config)
}

/** True for runway / arr_runway / dep_runway / runway_* */
export function isSaabRunwayFamilySectionId(sectionId: string): boolean {
    if (sectionId === 'runway' || sectionId === 'arr_runway' || sectionId === 'dep_runway') {
        return true
    }
    return isEssaDynamicRunwaySectionId(sectionId)
}

export function parseSaabRunwaySectionId(sectionId: string): {
    airport?: string
    endsKey: string
    ends: string[]
} | null {
    if (!isEssaDynamicRunwaySectionId(sectionId)) return null
    const rest = sectionId.slice('runway_'.length)
    const m = rest.match(/^([A-Za-z]{4})_(.+)$/)
    if (m) {
        const airport = m[1]!.toUpperCase()
        const endsKey = m[2]!
        return { airport, endsKey, ends: endsKey.split('_').map((e) => e.toUpperCase()) }
    }
    return { endsKey: rest, ends: rest.split('_').map((e) => e.toUpperCase()) }
}

export function saabRunwaySectionId(opts: {
    ends: string[]
    airport?: string
    multiAirport?: boolean
}): string {
    const key = opts.ends.map((e) => e.toUpperCase()).join('_')
    if (opts.multiAirport && opts.airport) {
        return `runway_${opts.airport.toUpperCase()}_${key}`
    }
    return `runway_${key}`
}

export function formatSaabRunwaySectionTitle(opts: {
    ends: string[]
    airport?: string
    multiAirport?: boolean
}): string {
    const label = opts.ends.join('/')
    if (opts.multiAirport && opts.airport) {
        return `${opts.airport.toUpperCase()} RUNWAY ${label}`
    }
    return `RUNWAY ${label}`
}

function normalizeRwy(rwy: string | undefined | null): string {
    return (rwy ?? '').trim().toUpperCase()
}

function flightRelevantRunways(flight: Flight): string[] {
    const out: string[] = []
    for (const r of [flight.arrRwy, flight.depRwy]) {
        const n = normalizeRwy(r)
        if (n) out.push(n)
    }
    return out
}

function flightAirportHint(flight: Flight, myAirports: string[]): string | undefined {
    const origin = (flight.origin ?? '').toUpperCase()
    const dest = (flight.destination ?? '').toUpperCase()
    if (myAirports.includes(dest)) return dest
    if (myAirports.includes(origin)) return origin
    return myAirports[0]
}

/**
 * If the board has a catalog-added runway_* matching this flight, return it.
 * Otherwise undefined (caller keeps legacy runway / arr_runway / dep_runway).
 */
export function resolveSaabDynamicRunwaySection(
    flight: Flight,
    config: EfsStaticConfig,
    legacySectionId: string,
): string | undefined {
    if (!isSaabLayouts(config)) return undefined
    if (!isSaabRunwayFamilySectionId(legacySectionId)) return undefined

    const multi = (config.myAirports?.length ?? 0) > 1
    const airportHint = flightAirportHint(flight, config.myAirports ?? [])

    let geoEnds: string[] = []
    if (
        flight.latitude !== undefined &&
        flight.longitude !== undefined &&
        flight.currentAltitude !== undefined
    ) {
        const geo = isOnAnyRunway(
            flight.latitude,
            flight.longitude,
            flight.currentAltitude,
            config.myAirports,
        )
        if (geo?.onRunway && geo.runway) {
            geoEnds = [geo.runway.leIdent, geo.runway.heIdent]
                .map(normalizeRwy)
                .filter(Boolean)
        }
    }

    const candidates = flightRelevantRunways(flight)
    const dynamicIds = [...config.sectionToBay.keys()].filter(isEssaDynamicRunwaySectionId)
    if (dynamicIds.length === 0) return undefined

    let best: string | undefined
    let bestScore = 0

    for (const id of dynamicIds) {
        const parsed = parseSaabRunwaySectionId(id)
        if (!parsed) continue
        if (multi && parsed.airport && airportHint && parsed.airport !== airportHint) continue

        let score = 0
        for (const end of parsed.ends) {
            if (candidates.includes(end)) score += 3
            if (geoEnds.includes(end)) score += 5
        }
        // Prefer ARR/DEP role when legacy section distinguishes them
        if (legacySectionId === 'dep_runway' && flight.depRwy) {
            if (parsed.ends.includes(normalizeRwy(flight.depRwy))) score += 1
        }
        if (legacySectionId === 'arr_runway' && flight.arrRwy) {
            if (parsed.ends.includes(normalizeRwy(flight.arrRwy))) score += 1
        }
        if (score > bestScore) {
            bestScore = score
            best = id
        }
    }

    return bestScore > 0 ? best : undefined
}

/** Escape ICAO_SCOPED for tests / tooling */
export function isIcaoScopedSaabRunwayId(sectionId: string): boolean {
    return ICAO_SCOPED.test(sectionId)
}

/** Catalog entries for addable physical RUNWAY headers (active airports). */
export function buildSaabRunwayCatalog(
    myAirports: string[],
): Array<{ sectionId: string; title: string }> {
    const multi = myAirports.length > 1
    const out: Array<{ sectionId: string; title: string }> = []
    const seen = new Set<string>()
    for (const icao of myAirports) {
        const runways = getRunwaysByAirport(icao)
        for (const rwy of runways) {
            const ends = [rwy.le_ident, rwy.he_ident].filter(Boolean).map((e) => e.toUpperCase())
            if (ends.length < 2) continue
            // Stable order: lower number / L before R when possible
            const sorted = [...ends].sort()
            const sectionId = saabRunwaySectionId({
                ends: sorted,
                airport: icao,
                multiAirport: multi,
            })
            if (seen.has(sectionId)) continue
            seen.add(sectionId)
            out.push({
                sectionId,
                title: formatSaabRunwaySectionTitle({
                    ends: sorted,
                    airport: icao,
                    multiAirport: multi,
                }),
            })
        }
    }
    return out
}

/**
 * Insert a section into the live config layout (catalog add).
 * Returns true if the layout changed.
 */
export function ensureSaabSectionInLayout(
    config: EfsStaticConfig,
    opts: {
        sectionId: string
        title: string
        bayId?: string
        beforeSectionId?: string
    },
): boolean {
    if (config.sectionToBay.has(opts.sectionId)) return false

    let bayId = opts.bayId
    if (!bayId) {
        // Prefer bay that already hosts a runway family section
        for (const [sid, bid] of config.sectionToBay) {
            if (isSaabRunwayFamilySectionId(sid)) {
                bayId = bid
                break
            }
        }
    }
    if (!bayId) bayId = config.layout.bays[0]?.id
    if (!bayId) return false

    let bay = config.layout.bays.find((b) => b.id === bayId)
    if (!bay) {
        bay = { id: bayId, sections: [] }
        config.layout.bays.push(bay)
    }

    const section = {
        id: opts.sectionId,
        title: opts.title,
        addFromTop: false as boolean | undefined,
    }

    if (opts.beforeSectionId) {
        const idx = bay.sections.findIndex((s) => s.id === opts.beforeSectionId)
        if (idx >= 0) bay.sections.splice(idx, 0, section)
        else bay.sections.push(section)
    } else {
        // After last runway-like section, else append
        let insertAt = bay.sections.length
        for (let i = bay.sections.length - 1; i >= 0; i--) {
            if (isSaabRunwayFamilySectionId(bay.sections[i]!.id)) {
                insertAt = i + 1
                break
            }
        }
        bay.sections.splice(insertAt, 0, section)
    }

    config.sectionToBay.set(opts.sectionId, bayId)
    return true
}
