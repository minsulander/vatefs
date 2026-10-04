/**
 * Multi-airport layout helpers: active vs visible columns, scoped config, strip placement.
 */

import type { Bay, EfsLayout, Section } from "@vatefs/common"
import type { EfsStaticConfig } from "./config-types.js"
import type { Flight } from "./types.js"

export const IDLE_BAY_ID = "idle"
export const DEFAULT_COLUMN_COUNT = 4
export const LOGICAL_SECTIONS = ["app", "rwy", "twy", "dep"] as const
export type LogicalSectionId = (typeof LOGICAL_SECTIONS)[number]

export interface BayTemplateSection {
    title: string
    addFromTop?: boolean
    height?: number
}

export interface BayTemplate {
    sections: Record<string, BayTemplateSection>
}

/** Column accent colors by slot index (unique for up to MAX_COLUMN_COUNT) */
export const COLUMN_COLORS = [
    "#4d9eab",
    "#f3b84b",
    "#9e6dc2",
    "#e57373",
    "#81c784",
    "#64b5f6",
] as const

export const MIN_COLUMN_COUNT = 2
export const MAX_COLUMN_COUNT = 6

export function isMultiAirportConfig(config: EfsStaticConfig): boolean {
    return config.layoutMode === "multiAirport"
}

export function stripIdForAirport(callsign: string, airport: string): string {
    return `${callsign}@${airport}`
}

export function parseStripAirportId(stripId: string): { callsign: string; airport: string } | null {
    const at = stripId.lastIndexOf("@")
    if (at <= 0 || at === stripId.length - 1) return null
    return {
        callsign: stripId.slice(0, at),
        airport: stripId.slice(at + 1)
    }
}

export function logicalSectionId(sectionId: string): string {
    // bay1_app -> app, idle_rwy -> rwy, plain "app" -> app
    const parts = sectionId.split("_")
    if (parts.length >= 2) {
        const last = parts[parts.length - 1]!
        if ((LOGICAL_SECTIONS as readonly string[]).includes(last)) return last
    }
    return sectionId
}

export function prefixedSectionId(bayId: string, logicalId: string): string {
    return `${bayId}_${logicalId}`
}

/**
 * Build layout for N visible columns + an idle bay (not shown to clients by default).
 */
export function buildMultiAirportLayout(
    template: BayTemplate,
    columnCount: number,
    columnAirports: (string | null)[]
): { layout: EfsLayout; sectionToBay: Map<string, string>; idleLayout: EfsLayout } {
    const bays: Bay[] = []
    const idleBays: Bay[] = []
    const sectionToBay = new Map<string, string>()

    const makeBay = (bayId: string, title?: string | null): Bay => {
        const sections: Section[] = []
        for (const [logicalId, sectionData] of Object.entries(template.sections)) {
            const sectionId = prefixedSectionId(bayId, logicalId)
            sectionToBay.set(sectionId, bayId)
            sections.push({
                id: sectionId,
                title: sectionData.title,
                addFromTop: sectionData.addFromTop,
                height: sectionData.height
            })
        }
        return {
            id: bayId,
            title: title ?? undefined,
            airport: title ?? undefined,
            sections
        }
    }

    const count = Math.max(1, columnCount)
    for (let i = 0; i < count; i++) {
        const bayId = `bay${i + 1}`
        const airport = columnAirports[i] ?? null
        bays.push(makeBay(bayId, airport))
    }

    idleBays.push(makeBay(IDLE_BAY_ID, null))

    return {
        layout: { bays },
        sectionToBay,
        idleLayout: { bays: idleBays }
    }
}

/**
 * Client-facing layout: visible columns only (no idle bay).
 */
export function getVisibleLayout(config: EfsStaticConfig): EfsLayout {
    return {
        bays: config.layout.bays.filter(b => b.id !== IDLE_BAY_ID)
    }
}

/**
 * Resolve which bay a strip for `airport` should live in.
 */
export function resolveBayForAirport(
    airport: string,
    columnAirports: (string | null)[] | undefined
): string {
    if (!columnAirports) return IDLE_BAY_ID
    const idx = columnAirports.indexOf(airport)
    if (idx >= 0) return `bay${idx + 1}`
    return IDLE_BAY_ID
}

/**
 * Airports among active set that are relevant for this flight (origin/dest/alternate).
 */
export function getRelevantActiveAirports(flight: Flight, activeAirports: string[]): string[] {
    const relevant: string[] = []
    for (const airport of activeAirports) {
        if (
            flight.origin === airport ||
            flight.destination === airport ||
            flight.alternate === airport
        ) {
            relevant.push(airport)
        }
    }
    return relevant
}

/**
 * Shallow-scoped config copy with myAirports = [airport] for rule evaluation.
 */
export function withAirportScope(config: EfsStaticConfig, airport: string): EfsStaticConfig {
    return {
        ...config,
        myAirports: [airport]
    }
}

/**
 * Ensure columnAirports array has exactly `count` slots.
 */
export function normalizeColumnAirports(
    airports: (string | null)[] | undefined,
    count: number
): (string | null)[] {
    const result: (string | null)[] = []
    for (let i = 0; i < count; i++) {
        result.push(airports?.[i] ?? null)
    }
    return result
}

/**
 * Seed column slots from active airports (first N).
 */
export function seedColumnAirports(activeAirports: string[], count: number): (string | null)[] {
    const result: (string | null)[] = []
    for (let i = 0; i < count; i++) {
        result.push(activeAirports[i] ?? null)
    }
    return result
}
