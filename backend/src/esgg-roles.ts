/**
 * ESGG paper role picker: CD / GND / TWR (maps to DEL / GND / TWR for rules).
 */

import type { Bay, EfsLayout, Section } from "@vatefs/common"
import type { ControllerRole } from "./config-types.js"

export type EsggPositionRole = "CD" | "GND" | "TWR"

export const ALL_ESGG_POSITIONS: EsggPositionRole[] = ["CD", "GND", "TWR"]

export function isEsggPositionRole(value: string): value is EsggPositionRole {
    return (ALL_ESGG_POSITIONS as string[]).includes(value)
}

export function sortEsggRoles(roles: EsggPositionRole[]): EsggPositionRole[] {
    const order = new Map(ALL_ESGG_POSITIONS.map((r, i) => [r, i]))
    return [...new Set(roles)].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
}

export function normalizeEsggRoles(roles: string[] | undefined): EsggPositionRole[] | undefined {
    if (!roles) return undefined
    const out = roles.filter(isEsggPositionRole)
    return sortEsggRoles(out)
}

/** Paper ESGG config (look:paper + ESGG in airports). */
export function isEsggRolesConfig(config: {
    look?: string
    myAirports?: string[]
}): boolean {
    if (config.look !== "paper") return false
    return (config.myAirports ?? []).some((a) => a.toUpperCase() === "ESGG")
}

export function esggRoleToControllerRole(role: EsggPositionRole): ControllerRole {
    if (role === "CD") return "DEL"
    return role
}

export function controllerRoleToEsggRole(role: ControllerRole): EsggPositionRole | undefined {
    if (role === "DEL") return "CD"
    if (role === "GND") return "GND"
    if (role === "TWR") return "TWR"
    return undefined
}

/** Highest acting role for callsign-style checks (TWR > GND > CD). */
export function highestEsggControllerRole(roles: EsggPositionRole[]): ControllerRole | undefined {
    if (roles.includes("TWR")) return "TWR"
    if (roles.includes("GND")) return "GND"
    if (roles.includes("CD")) return "DEL"
    return undefined
}

/** Auto roles from effective ControllerRoles at ESGG. */
export function computeAutoEsggRoles(effective: ControllerRole[]): EsggPositionRole[] {
    const set = new Set<EsggPositionRole>()
    for (const r of effective) {
        const mapped = controllerRoleToEsggRole(r)
        if (mapped) set.add(mapped)
    }
    return sortEsggRoles([...set])
}

/**
 * GND and/or CD without TWR — pending ARR (INBOUND) unused;
 * shift ops left and put KLARERING alone on the far right.
 */
export function isEsggGndCdLayout(roles: EsggPositionRole[]): boolean {
    if (roles.includes("TWR")) return false
    return roles.includes("GND") || roles.includes("CD")
}

function findSectionById(layout: EfsLayout, sectionId: string): Section | undefined {
    for (const bay of layout.bays) {
        const found = bay.sections.find((s) => s.id === sectionId)
        if (found) return found
    }
    return undefined
}

function bayWith(id: string, sectionIds: string[], layout: EfsLayout): Bay | undefined {
    const sections = sectionIds
        .map((sid) => findSectionById(layout, sid))
        .filter((s): s is Section => !!s)
    if (sections.length === 0) return undefined
    return { id, sections }
}

/**
 * Headerless drop zone above START-UP & PUSH-BACK.
 * CD (not covering GND) dropping here → XFER to GND; cleared strips stay under KLARERING.
 */
export const ESGG_ABOVE_PUSH_SECTION_ID = "above_push"

/**
 * Remap ESGG bays for GND/CD (no TWR):
 *   bay1: ctr_arr / PÅ BANAN / UTFLYGNING  (was bay2)
 *   bay2: PÅ TAXI                          (was bay3)
 *   bay3: above_push (empty/transfer) + START-UP & PUSH-BACK
 *   bay4: pending_dep + cleared (KLARERING — cleared still below header)
 * Pending ARR (inbound) is dropped.
 */
export function applyEsggRoleLayout(layout: EfsLayout, roles: EsggPositionRole[]): EfsLayout {
    if (!isEsggGndCdLayout(roles)) return layout

    const push = findSectionById(layout, "push_start")
    const bay3Sections: Section[] = [
        {
            id: ESGG_ABOVE_PUSH_SECTION_ID,
            title: "ABOVE PUSH",
            hideHeader: true,
        },
    ]
    if (push) bay3Sections.push(push)

    const bays = [
        bayWith("bay1", ["ctr_arr", "runway", "ctr_dep"], layout),
        bayWith("bay2", ["taxi"], layout),
        { id: "bay3", sections: bay3Sections },
        bayWith("bay4", ["pending_dep", "cleared"], layout),
    ].filter((b): b is Bay => !!b)

    return bays.length > 0 ? { bays } : layout
}

/** Align sectionToBay with the layout currently served to clients. */
export function syncSectionToBayFromLayout(
    sectionToBay: Map<string, string>,
    layout: EfsLayout
): void {
    for (const bay of layout.bays) {
        for (const section of bay.sections) {
            sectionToBay.set(section.id, bay.id)
        }
    }
}
