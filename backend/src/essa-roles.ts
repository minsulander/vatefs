/**
 * ESSA position roles for role-based bay/section visibility.
 * Physical/working positions (role picker + headers) from ESAA .ese / AOR:
 *   ESSA_DEL, ESSA_E_GND, ESSA_N_GND, ESSA_W_GND, ESSA_E_TWR, ESSA_W_TWR
 *
 * ESSA_S_TWR is a pseudo-position in the sector file: IRL only two TWR working
 * positions exist (E/W). Logging as S inherits TWR-E and/or TWR-W per AOR staffing.
 */

import type { ControllerRole } from "./config-types.js"
import type { EfsLayout, Section } from "@vatefs/common"
import {
    ESSA_PHYSICAL_RWY_PAIRS,
    essaPhysicalPairForRunway,
    essaRunwaySectionId,
    formatEssaRunwaySectionTitle,
    isEssaDynamicRunwaySectionId,
    normalizeEssaRwy,
    type EssaPhysicalRwyPair,
} from "@vatefs/common"

/** Fine-grained ESSA positions shown in the role picker / headers (physical only) */
export type EssaPositionRole =
    | 'CD'
    | 'GND-E' | 'GND-N' | 'GND-W'
    | 'TWR-E' | 'TWR-W'

export type EssaFamily = 'CD' | 'GND' | 'TWR'

export function isEssaRolesConfig(config: { layoutMode?: string }): boolean {
    return config.layoutMode === 'essaRoles'
}

/**
 * ESSA strip SI display overrides (EuroScope position id → short label).
 * Only DEL/GND 3-letter SIs; TWR/APP/others pass through unchanged.
 */
const ESSA_SI_DISPLAY: Record<string, string> = {
    SAD: 'CD', // ESSA_DEL
    AGE: 'GE', // ESSA_E_GND
    AGN: 'GN', // ESSA_N_GND
    AGW: 'GW', // ESSA_W_GND
}

/** Shorten ESSA DEL/GND SIs for strip ownership display; leave all others as-is */
export function formatEssaDisplaySi(si: string | undefined | null): string | undefined {
    if (!si) return undefined
    const key = si.toUpperCase()
    return ESSA_SI_DISPLAY[key] ?? si
}

export const ALL_ESSA_POSITIONS: EssaPositionRole[] = [
    'CD',
    'GND-E', 'GND-N', 'GND-W',
    'TWR-E', 'TWR-W',
]

export const ALL_GND_POSITIONS: EssaPositionRole[] = ['GND-E', 'GND-N', 'GND-W']
export const ALL_TWR_POSITIONS: EssaPositionRole[] = ['TWR-E', 'TWR-W']

/** Login identity including the TWR-S pseudo-callsign */
type EssaLoginId = EssaPositionRole | 'TWR-S'

export function isEssaPositionRole(value: string): value is EssaPositionRole {
    return (ALL_ESSA_POSITIONS as string[]).includes(value)
}

/** Canonical display/storage order: CD, GND-*, TWR-E, TWR-W */
export function sortEssaRoles(roles: EssaPositionRole[]): EssaPositionRole[] {
    const order = new Map(ALL_ESSA_POSITIONS.map((r, i) => [r, i]))
    return [...new Set(roles)].sort(
        (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99)
    )
}

export function familyOf(role: EssaPositionRole): EssaFamily {
    if (role === 'CD') return 'CD'
    if (role.startsWith('GND-')) return 'GND'
    return 'TWR'
}

export function familiesFromRoles(roles: EssaPositionRole[]): Set<EssaFamily> {
    const families = new Set<EssaFamily>()
    for (const role of roles) families.add(familyOf(role))
    return families
}

/**
 * Parse login identity from callsign (includes TWR-S pseudo).
 */
export function parseEssaLoginId(callsign: string): EssaLoginId | undefined {
    const upper = callsign.toUpperCase()
    if (upper === 'ESSA_DEL' || (upper.startsWith('ESSA') && upper.endsWith('_DEL'))) {
        return 'CD'
    }
    const gnd = upper.match(/^ESSA_([ENW])_GND$/)
    if (gnd) return `GND-${gnd[1]}` as EssaPositionRole
    if (upper === 'ESSA_S_TWR') return 'TWR-S'
    const twr = upper.match(/^ESSA_([EW])_TWR$/)
    if (twr) return `TWR-${twr[1]}` as EssaPositionRole
    return undefined
}

/**
 * Parse a physical ESSA position from a login callsign.
 * TWR-S returns undefined here — use resolvePhysicalTwrsForLogin / computeAutoEssaRoles.
 */
export function parseEssaPosition(callsign: string): EssaPositionRole | undefined {
    const id = parseEssaLoginId(callsign)
    if (!id || id === 'TWR-S') return undefined
    return id
}

/**
 * AOR: when two TWR callsigns are open, runway/CTR work is split across E/W/S slots.
 * Physical EFS roles are only TWR-E and TWR-W. Map a login + online peers to those.
 *
 * Solo (≤1 TWR login online, counting self): covers both physical TWR roles.
 * Two open — inherit the complementary physical role(s):
 *   E+W online → S gets neither exclusive sector (third-runway pseudo); still needs
 *     TWR family visibility → both E+W for layout until geo-routing exists.
 *   E+S online → S inherits TWR-W areas (AOR row pairing); E keeps TWR-E.
 *   W+S online → S inherits TWR-E areas; W keeps TWR-W.
 */
export function resolvePhysicalTwrsForLogin(
    loginId: EssaLoginId | undefined,
    onlineLoginIds: EssaLoginId[]
): EssaPositionRole[] {
    const twrLogins = new Set<EssaLoginId>()
    for (const id of onlineLoginIds) {
        if (id === 'TWR-E' || id === 'TWR-W' || id === 'TWR-S') twrLogins.add(id)
    }
    if (loginId === 'TWR-E' || loginId === 'TWR-W' || loginId === 'TWR-S') {
        twrLogins.add(loginId)
    }

    if (twrLogins.size <= 1) {
        return [...ALL_TWR_POSITIONS]
    }

    if (loginId === 'TWR-E') return ['TWR-E']
    if (loginId === 'TWR-W') return ['TWR-W']
    if (loginId === 'TWR-S') {
        const hasE = twrLogins.has('TWR-E')
        const hasW = twrLogins.has('TWR-W')
        if (hasE && !hasW) return ['TWR-W']
        if (hasW && !hasE) return ['TWR-E']
        // E+W+S or E+W: S is pseudo for 01R/19L — keep both for section visibility (no geo split yet)
        return [...ALL_TWR_POSITIONS]
    }

    // Covering TWR via top-down without a TWR login id
    return [...ALL_TWR_POSITIONS]
}

/**
 * Collect ESSA login ids from callsigns (physical + TWR-S).
 */
export function parseOnlineEssaLoginIds(callsigns: Iterable<string>): EssaLoginId[] {
    const set = new Set<EssaLoginId>()
    for (const cs of callsigns) {
        const id = parseEssaLoginId(cs)
        if (id) set.add(id)
    }
    return [...set]
}

/**
 * Compute auto-selected ESSA roles from effective coverage + AOR solo rules.
 *
 * Effective ControllerRoles are already a contiguous top-down slice
 * (TWR alone → DEL+GND+TWR; GND online → TWR only; GND alone → DEL+GND).
 * TWR never gets CD without GND. Manual picker may break that on purpose.
 *
 * - GND: if ≤1 GND online, select all GND-*; else only own sector.
 * - TWR: physical E/W only; TWR-S inherits per resolvePhysicalTwrsForLogin.
 */
export function computeAutoEssaRoles(
    callsign: string | undefined,
    effectiveRoles: ControllerRole[] | undefined,
    onlineCallsigns: Iterable<string>
): EssaPositionRole[] {
    if (!effectiveRoles || effectiveRoles.length === 0) return []

    const mine = callsign ? parseEssaLoginId(callsign) : undefined
    const online = parseOnlineEssaLoginIds(onlineCallsigns)
    if (mine) online.push(mine)
    const onlineUnique = [...new Set(online)]

    const result: EssaPositionRole[] = []

    if (effectiveRoles.includes('DEL')) {
        result.push('CD')
    }

    if (effectiveRoles.includes('GND')) {
        const onlineGnd = onlineUnique.filter(
            (p): p is EssaPositionRole => p === 'GND-E' || p === 'GND-N' || p === 'GND-W'
        )
        if (onlineGnd.length <= 1) {
            result.push(...ALL_GND_POSITIONS)
        } else if (mine && (mine === 'GND-E' || mine === 'GND-N' || mine === 'GND-W')) {
            result.push(mine)
        } else {
            result.push(...ALL_GND_POSITIONS)
        }
    }

    if (effectiveRoles.includes('TWR')) {
        result.push(...resolvePhysicalTwrsForLogin(mine, onlineUnique))
    }

    return sortEssaRoles(result)
}

/**
 * Physical TWR positions currently online (from ESSA_*_TWR callsigns).
 * Used for GND-only inbound headers: INBOUND TWR-E, TWR-W.
 */
export function activeOnlineTwrRoles(onlineCallsigns: Iterable<string>): EssaPositionRole[] {
    const set = new Set<EssaPositionRole>()
    for (const cs of onlineCallsigns) {
        const id = parseEssaLoginId(cs)
        if (id === 'TWR-E' || id === 'TWR-W') set.add(id)
        // TWR-S is pseudo — map to inherited physical roles when alone/paired
    }
    // Include TWR-S via resolve if present
    const logins = parseOnlineEssaLoginIds(onlineCallsigns)
    if (logins.includes('TWR-S')) {
        for (const r of resolvePhysicalTwrsForLogin('TWR-S', logins)) set.add(r)
    }
    const list = ALL_TWR_POSITIONS.filter(r => set.has(r))
    return list.length > 0 ? list : [...ALL_TWR_POSITIONS]
}

/**
 * Inbound header:
 * - TWR covered → INBOUND APP (arrivals from approach)
 * - GND-only → INBOUND TWR-* (active/online TWR peers, else both)
 */
export function resolveInboundTitle(
    roles: EssaPositionRole[],
    yamlTitle: string,
    activeTwrPeers?: EssaPositionRole[]
): string {
    const families = familiesFromRoles(roles)
    if (families.has('TWR')) return 'INBOUND APP'
    if (families.has('GND')) {
        const twrs =
            activeTwrPeers && activeTwrPeers.length > 0
                ? activeTwrPeers
                : ALL_TWR_POSITIONS
        return `INBOUND ${twrs.join(', ')}`
    }
    return yamlTitle
}

/** Max visible ESSA columns; CD ALL + TSAT share a column when this would be exceeded */
const ESSA_MAX_COLUMNS = 4

/**
 * When more than ESSA_MAX_COLUMNS bays remain, merge CD ALL (pending_dep) onto
 * the TSAT (cleared) bay with CD ALL on top. Drops the empty CD ALL bay.
 */
export function mergeCdAllOntoTsatIfNeeded(
    bays: EfsLayout['bays']
): EfsLayout['bays'] {
    if (bays.length <= ESSA_MAX_COLUMNS) return bays

    const cdIdx = bays.findIndex(b => b.sections.some(s => s.id === 'pending_dep'))
    const tsatIdx = bays.findIndex(b => b.sections.some(s => s.id === 'cleared'))
    if (cdIdx < 0 || tsatIdx < 0 || cdIdx === tsatIdx) return bays

    const keepIdx = Math.min(cdIdx, tsatIdx)
    const dropIdx = Math.max(cdIdx, tsatIdx)
    const keepBay = bays[keepIdx]!
    const dropBay = bays[dropIdx]!
    const combined = [...keepBay.sections, ...dropBay.sections]
    const pending = combined.filter(s => s.id === 'pending_dep')
    const cleared = combined.filter(s => s.id === 'cleared')
    const others = combined.filter(s => s.id !== 'pending_dep' && s.id !== 'cleared')

    const mergedBay = {
        ...keepBay,
        sections: [...pending, ...cleared, ...others],
    }

    return bays
        .map((bay, i) => (i === keepIdx ? mergedBay : bay))
        .filter((_, i) => i !== dropIdx)
}

/** sectionId → bayId from a (possibly filtered/merged) layout */
export function sectionBayMapFromLayout(layout: EfsLayout): Map<string, string> {
    const map = new Map<string, string>()
    for (const bay of layout.bays) {
        for (const section of bay.sections) {
            map.set(section.id, bay.id)
        }
    }
    return map
}

/**
 * Align strip/gap bayIds with the visible layout (e.g. after CD ALL+TSAT merge).
 */
export function remapBayIdsToLayout<T extends { sectionId: string; bayId: string }>(
    items: T[],
    layout: EfsLayout
): T[] {
    const sectionToBay = sectionBayMapFromLayout(layout)
    if (sectionToBay.size === 0) return items
    return items.map(item => {
        const bayId = sectionToBay.get(item.sectionId)
        if (!bayId || bayId === item.bayId) return item
        return { ...item, bayId }
    })
}

/**
 * Filter layout to sections whose visibleFor intersects selected families.
 * Sections without visibleFor always remain. Empty bays are dropped.
 * Inbound title depends on TWR vs GND-only coverage.
 * Caps at ESSA_MAX_COLUMNS by stacking CD ALL above TSAT when needed.
 */
export function filterEssaLayout(
    layout: EfsLayout,
    roles: EssaPositionRole[],
    sectionVisibleFor: Map<string, EssaFamily[]> | undefined,
    activeTwrPeers?: EssaPositionRole[]
): EfsLayout {
    if (!sectionVisibleFor || sectionVisibleFor.size === 0) {
        return layout
    }
    // No roles yet (pre-auto) — keep full layout rather than hiding everything
    if (roles.length === 0) {
        return layout
    }

    const families = familiesFromRoles(roles)

    const bays = mergeCdAllOntoTsatIfNeeded(
        layout.bays
            .map(bay => ({
                ...bay,
                sections: bay.sections
                    .filter(section => {
                        const visibleFor = sectionVisibleFor.get(section.id)
                        if (!visibleFor || visibleFor.length === 0) return true
                        return visibleFor.some(f => families.has(f))
                    })
                    .map(section => {
                        if (section.id !== 'inbound') return section
                        return {
                            ...section,
                            title: resolveInboundTitle(roles, section.title, activeTwrPeers),
                        }
                    })
            }))
            .filter(bay => bay.sections.length > 0)
    )

    return { bays }
}

/** True when ESSA selection covers GND but not TWR */
export function isEssaGndOnly(roles: EssaPositionRole[]): boolean {
    const families = familiesFromRoles(roles)
    return families.has('GND') && !families.has('TWR')
}

/** True when ESSA selection covers TWR but not GND */
export function isEssaTwrOnly(roles: EssaPositionRole[]): boolean {
    const families = familiesFromRoles(roles)
    return families.has('TWR') && !families.has('GND')
}

export interface EssaRunwaySectionPlacement {
    sectionId: string
    title: string
    pair: EssaPhysicalRwyPair
    /** Prefer CTR DEP column vs CTR ARR column */
    preferDepColumn: boolean
}

/**
 * Collect unique physical runway pairs that need headers:
 * active ARR/DEP from RWY config, plus runways assigned on flight plans.
 */
export function collectEssaRunwayPairs(
    activeRunways: Record<string, { arr: string[]; dep: string[] }> | undefined,
    airports: string[],
    assigned?: { arr: string[]; dep: string[] }
): EssaRunwaySectionPlacement[] {
    type Acc = { pair: EssaPhysicalRwyPair; preferDepColumn: boolean }
    const byId = new Map<string, Acc>()

    const add = (rwy: string | undefined, asDep: boolean) => {
        const pair = essaPhysicalPairForRunway(rwy)
        if (!pair) return
        const existing = byId.get(pair.id)
        if (existing) {
            if (asDep) existing.preferDepColumn = true
            return
        }
        byId.set(pair.id, { pair, preferDepColumn: asDep })
    }

    for (const airport of airports) {
        const rwy = activeRunways?.[airport]
        if (!rwy) continue
        for (const d of rwy.dep) add(d, true)
        for (const a of rwy.arr) add(a, false)
    }
    if (assigned) {
        for (const d of assigned.dep) add(d, true)
        for (const a of assigned.arr) add(a, false)
    }

    // Stable order: physical pair table order
    const ordered: EssaRunwaySectionPlacement[] = []
    for (const pair of ESSA_PHYSICAL_RWY_PAIRS) {
        const acc = byId.get(pair.id)
        if (!acc) continue
        ordered.push({
            sectionId: essaRunwaySectionId(pair),
            title: formatEssaRunwaySectionTitle(pair),
            pair,
            preferDepColumn: acc.preferDepColumn,
        })
    }
    return ordered
}

export function essaRunwayPairsFingerprint(placements: EssaRunwaySectionPlacement[]): string {
    return placements.map(p => `${p.sectionId}:${p.preferDepColumn ? 'D' : 'A'}`).join('|')
}

/**
 * Replace static arr_runway/dep_runway with one header per physical strip in use.
 * Single pair → CTR DEP column. Extra pairs (e.g. second ARR) → CTR ARR column.
 */
export function applyEssaRunwayPairLayout(
    layout: EfsLayout,
    placements: EssaRunwaySectionPlacement[]
): { layout: EfsLayout; sectionToBay: Map<string, string> } {
    const sectionToBay = new Map<string, string>()

    // Strip placeholder / prior dynamic runway sections
    let bays = layout.bays.map(bay => ({
        ...bay,
        sections: bay.sections.filter(
            s => s.id !== 'arr_runway' && s.id !== 'dep_runway' && !isEssaDynamicRunwaySectionId(s.id)
        ),
    }))

    if (placements.length === 0) {
        return {
            layout: { bays: bays.filter(b => b.sections.length > 0) },
            sectionToBay,
        }
    }

    const findBayId = (sectionId: string): string | undefined => {
        for (const bay of bays) {
            if (bay.sections.some(s => s.id === sectionId)) return bay.id
        }
        return undefined
    }

    const depBayId = findBayId('ctr_dep')
    const arrBayId = findBayId('ctr_arr')

    const insertAfter = (bayId: string, afterSectionId: string, section: Section) => {
        bays = bays.map(bay => {
            if (bay.id !== bayId) return bay
            const idx = bay.sections.findIndex(s => s.id === afterSectionId)
            const sections = [...bay.sections]
            if (idx >= 0) sections.splice(idx + 1, 0, section)
            else sections.push(section)
            return { ...bay, sections }
        })
        sectionToBay.set(section.id, bayId)
    }

    const insertStack = (bayId: string, afterSectionId: string, stack: EssaRunwaySectionPlacement[]) => {
        let after = afterSectionId
        for (const p of stack) {
            const section: Section = { id: p.sectionId, title: p.title }
            insertAfter(bayId, after, section)
            after = p.sectionId
        }
    }

    // One pair → CTR DEP column. Multiple → dep-associated in DEP column, others in ARR column.
    if (placements.length === 1) {
        if (depBayId) insertStack(depBayId, 'ctr_dep', placements)
        else if (arrBayId) insertStack(arrBayId, 'ctr_arr', placements)
    } else {
        const depStack = placements.filter(p => p.preferDepColumn)
        const arrStack = placements.filter(p => !p.preferDepColumn)
        // Ensure DEP column has at least one header when CTR DEP is visible
        if (depStack.length === 0 && arrStack.length > 0 && depBayId) {
            depStack.push(arrStack.shift()!)
        }
        if (depBayId && depStack.length > 0) insertStack(depBayId, 'ctr_dep', depStack)
        if (arrBayId && arrStack.length > 0) insertStack(arrBayId, 'ctr_arr', arrStack)
        else if (depBayId && arrStack.length > 0) insertStack(depBayId, depStack[depStack.length - 1]?.sectionId ?? 'ctr_dep', arrStack)
    }

    return {
        layout: { bays: bays.filter(b => b.sections.length > 0) },
        sectionToBay,
    }
}

/** Sync dynamic runway_* section→bay entries into the live config map */
export function syncEssaRunwaySectionToBay(
    sectionToBay: Map<string, string>,
    dynamic: Map<string, string>
): void {
    for (const key of [...sectionToBay.keys()]) {
        if (isEssaDynamicRunwaySectionId(key)) sectionToBay.delete(key)
    }
    for (const [id, bayId] of dynamic) {
        sectionToBay.set(id, bayId)
    }
}

/** Logical runway section ids used by YAML rules before pair remapping */
export function isEssaLegacyRunwaySectionId(sectionId: string): boolean {
    return sectionId === 'arr_runway' || sectionId === 'dep_runway' || isEssaDynamicRunwaySectionId(sectionId)
}

/**
 * Pick the physical pair for a flight (geo runway, else FPL assignment, else active RWY).
 */
export function resolveEssaPairForFlight(
    flight: {
        latitude?: number
        longitude?: number
        currentAltitude?: number
        origin?: string
        destination?: string
        airborne?: boolean
        arrRwy?: string
        depRwy?: string
    },
    activeRunways: Record<string, { arr: string[]; dep: string[] }> | undefined,
    airports: string[],
    geoRunwayEnds?: { leIdent: string; heIdent: string }
): EssaPhysicalRwyPair | undefined {
    if (geoRunwayEnds) {
        const fromGeo =
            essaPhysicalPairForRunway(geoRunwayEnds.leIdent) ??
            essaPhysicalPairForRunway(geoRunwayEnds.heIdent)
        if (fromGeo) return fromGeo
    }

    const originIsOurs = flight.origin !== undefined && airports.includes(flight.origin)
    const destIsOurs = flight.destination !== undefined && airports.includes(flight.destination)

    let assigned: string | undefined
    if (originIsOurs && destIsOurs) {
        assigned = (flight.airborne ?? false) ? flight.arrRwy : flight.depRwy
    } else if (originIsOurs) {
        assigned = flight.depRwy
    } else if (destIsOurs) {
        assigned = flight.arrRwy
    }
    const fromAssigned = essaPhysicalPairForRunway(assigned)
    if (fromAssigned) return fromAssigned

    // Fallback: first active dep pair, else first active arr pair
    for (const airport of airports) {
        const rwy = activeRunways?.[airport]
        if (!rwy) continue
        for (const d of rwy.dep) {
            const p = essaPhysicalPairForRunway(d)
            if (p) return p
        }
        for (const a of rwy.arr) {
            const p = essaPhysicalPairForRunway(a)
            if (p) return p
        }
    }
    return undefined
}

/** Normalize a list of runway ids for fingerprinting / pair collection */
export function normalizeRunwayList(rwys: string[]): string[] {
    return [...new Set(rwys.map(normalizeEssaRwy).filter(Boolean))].sort()
}

/** Sections whose strips appear under inbound in GND-only ESSA view */
const GND_ONLY_INBOUND_SECTIONS = new Set(['ctr_arr', 'arr_runway', 'dep_runway'])

function isGndOnlyInboundSection(sectionId: string): boolean {
    return GND_ONLY_INBOUND_SECTIONS.has(sectionId) || isEssaDynamicRunwaySectionId(sectionId)
}

/**
 * Remap CTR / runway strips into inbound for GND-only ESSA views so arrivals
 * remain visible when TWR sections are hidden.
 */
export function remapStripsForEssaGndOnly<T extends { sectionId: string; bayId: string; stripType?: string }>(
    strips: T[],
    roles: EssaPositionRole[],
    sectionToBay: Map<string, string>
): T[] {
    if (!isEssaGndOnly(roles)) return strips
    const inboundBay = sectionToBay.get('inbound')
    if (!inboundBay) return strips

    return strips.map(s => {
        if (!isGndOnlyInboundSection(s.sectionId)) return s
        // dep_runway / dep-pair: only arrivals/local (departures stay conceptually TWR-dep)
        if (
            (s.sectionId === 'dep_runway' || isEssaDynamicRunwaySectionId(s.sectionId)) &&
            s.stripType === 'departure'
        ) {
            return s
        }
        return { ...s, sectionId: 'inbound', bayId: inboundBay }
    })
}

export function normalizeEssaRoles(roles: unknown): EssaPositionRole[] | undefined {
    if (!Array.isArray(roles)) return undefined
    const out: EssaPositionRole[] = []
    for (const r of roles) {
        if (typeof r === 'string' && isEssaPositionRole(r)) out.push(r)
    }
    return out.length > 0 ? sortEssaRoles(out) : []
}
