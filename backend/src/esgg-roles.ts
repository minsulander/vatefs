/**
 * ESGG paper role picker: CD / GND / TWR (maps to DEL / GND / TWR for rules).
 *
 * Covering roles (esggRoles) = what you act as (TWR alone → CD+GND+TWR).
 * Layout roles (esggLayoutRoles) = who is STAFFED (your login + online GND/DEL/TWR).
 *
 * Bay board (same for every client — not the UI ± visible-width setting):
 *   TWR only (no GND/DEL open) → YAML 4 (KLARERING packed with S/P)
 *   GND and/or DEL open        → always 5: INBOUND | ops | taxi | S/P | KLARERING (bay5)
 *
 * Frontend: when bay5 exists, columns are ¼ window width with horizontal scroll.
 * Covering GND + 5-col board: default scroll pans right (INBOUND out of view).
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

/** Auto covering roles from effective ControllerRoles at ESGG. */
export function computeAutoEsggRoles(effective: ControllerRole[]): EsggPositionRole[] {
    const set = new Set<EsggPositionRole>()
    for (const r of effective) {
        const mapped = controllerRoleToEsggRole(r)
        if (mapped) set.add(mapped)
    }
    return sortEsggRoles([...set])
}

/**
 * Staffed ESGG positions for bay layout: your login role + other online DEL/GND/TWR.
 * Does NOT expand covering (TWR alone → [TWR], not CD+GND+TWR).
 */
export function computeEsggStaffedRoles(
    myRole: ControllerRole | undefined,
    onlineRolesAtEsgg: ControllerRole[],
): EsggPositionRole[] {
    const set = new Set<EsggPositionRole>()
    const mine = myRole ? controllerRoleToEsggRole(myRole) : undefined
    if (mine) set.add(mine)
    for (const r of onlineRolesAtEsgg) {
        const mapped = controllerRoleToEsggRole(r)
        if (mapped) set.add(mapped)
    }
    return sortEsggRoles([...set])
}

/**
 * True when GND or CD/DEL is staffed — triggers the shared 5-column board.
 * (Legacy name; no longer means “hide INBOUND / 4-col GND-CD layout”.)
 */
export function isEsggGndCdLayout(roles: EsggPositionRole[]): boolean {
    return roles.includes("GND") || roles.includes("CD")
}

/**
 * True when GND is covering with TWR still selected — UI should default-pan
 * so INBOUND is scrolled out of view (physical table: GND works the right bays).
 */
export function esggDefaultPanHideInbound(roles: EsggPositionRole[]): boolean {
    return roles.includes("GND") && roles.includes("TWR")
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
 * CD→GND READY handoff pins here (stick-top); drag to non-pinned = ASSUME.
 */
export const ESGG_ABOVE_PUSH_SECTION_ID = "above_push"

/** Extra KLARERING column id when the board splits to 5 bays (scroll-target). */
export const ESGG_KLARERING_BAY_ID = "bay5"

function buildPushBaySections(layout: EfsLayout): Section[] {
    const push = findSectionById(layout, "push_start")
    const sections: Section[] = [
        {
            id: ESGG_ABOVE_PUSH_SECTION_ID,
            title: "ABOVE PUSH",
            hideHeader: true,
        },
    ]
    if (push) sections.push(push)
    return sections
}

function buildKlareringBay(layout: EfsLayout, bayId: string): Bay | undefined {
    const pending = findSectionById(layout, "pending_dep")
    const cleared = findSectionById(layout, "cleared")
    const sections = [pending, cleared].filter((s): s is Section => !!s)
    if (sections.length === 0) return undefined
    return { id: bayId, sections }
}

/**
 * Remap ESGG bays by STAFFED roles (not covering) — see file header.
 * Same 5-column board for every role whenever GND or DEL is open.
 */
export function applyEsggRoleLayout(layout: EfsLayout, roles: EsggPositionRole[]): EfsLayout {
    // TWR-only (or nothing): keep YAML (KLARERING packed with S/P in bay4)
    if (!isEsggGndCdLayout(roles)) return layout

    const pushSections = buildPushBaySections(layout)
    // Identical 5-bay board for all clients (TWR / GND / CD)
    const bays = [
        bayWith("bay1", ["inbound"], layout),
        bayWith("bay2", ["ctr_arr", "runway", "ctr_dep"], layout),
        bayWith("bay3", ["taxi"], layout),
        { id: "bay4", sections: pushSections },
        buildKlareringBay(layout, ESGG_KLARERING_BAY_ID),
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
