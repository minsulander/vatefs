/**
 * Generic paper board roles: AD / T / P.
 *
 * Staffed (paperLayoutRoles) = your login + online at the airport, cut to catalog.
 * Covering (paperRoles) = what you act as:
 *   - Solo AD covers every role the airport has
 *   - When T is online, AD does not cover T (or P — T takes that)
 *   - Solo T (no AD online) also covers AD (top-down APP)
 *   - When P is online, neither AD nor T covers P
 *   - P covers only P
 *
 * Landvetter tower (ESGG TWR/GND/DEL) keeps CD/GND/TWR via esgg-roles.ts.
 */

import type { Bay, EfsLayout, Section } from "@vatefs/common"
import type { ControllerRole } from "./config-types.js"
import {
    isEseDirectorCallsign,
    resolveEsePosition,
} from "./ese-airspace.js"
import {
    type PaperPositionRole,
    paperPositionsForAirport,
    sortPaperRoles,
} from "./paper-positions.js"

export type { PaperPositionRole }

/** Unified paper menu file (replaces ESGG / STD / ESMS / ESSB / STD 2 RWY in the picker). */
export const PAPER_CONFIG_FILE = "paper.yml"

/** Legacy filenames that now open the unified paper mode. */
export const LEGACY_PAPER_CONFIG_FILES: Readonly<Record<string, string>> = {
    "esgg.yml": PAPER_CONFIG_FILE,
    "esms.yml": PAPER_CONFIG_FILE,
    "essb.yml": PAPER_CONFIG_FILE,
    "std.yml": PAPER_CONFIG_FILE,
    "std-2rwy.yml": PAPER_CONFIG_FILE,
}

/** Hide from the config menu (still loadable as PAPER overlays). */
export const HIDDEN_PAPER_MENU_FILES = new Set([
    "esgg.yml",
    "esms.yml",
    "essb.yml",
    "std.yml",
    "std-2rwy.yml",
])

/** Airports with dedicated AD-strip tower overlays (not Landvetter CD/GND/TWR). */
export const AD_STRIP_TOWER_ICAOS = ["ESMS", "ESSB"] as const

export type AdStripTowerIcao = (typeof AD_STRIP_TOWER_ICAOS)[number]

export function isAdStripTowerIcao(icao: string | null | undefined): boolean {
    const u = (icao ?? "").trim().toUpperCase()
    return (AD_STRIP_TOWER_ICAOS as readonly string[]).includes(u)
}

export function resolvePaperConfigFile(file: string | null | undefined): string | undefined {
    if (!file) return undefined
    return LEGACY_PAPER_CONFIG_FILES[file] ?? file
}

export function isUnifiedPaperConfigFile(file: string | null | undefined): boolean {
    const resolved = resolvePaperConfigFile(file)
    return resolved === PAPER_CONFIG_FILE
}

/**
 * ESGG DEL/GND/TWR (and remote tower) → Landvetter AD board + CD/GND/TWR.
 * ESGG APP stays on the generic AD/T/P board with T strips.
 */
export function isEsggTowerCallsign(callsign: string | null | undefined): boolean {
    const cs = (callsign ?? "").trim().toUpperCase()
    return cs.startsWith("ESGG") && isAdStripGroundPosition(cs)
}

/** Tower-side login that uses the AD-strip ground board (not APP/T). */
function isAdStripGroundPosition(callsign: string): boolean {
    return (
        callsign.endsWith("TWR") ||
        callsign.endsWith("GND") ||
        callsign.endsWith("DEL") ||
        callsign.endsWith("_R_APP") ||
        callsign.endsWith("_R_CTR")
    )
}

/** ESMS DEL/GND/TWR (and remote tower) → Sturup AD board overlay (esms.yml). */
export function isEsmsTowerCallsign(callsign: string | null | undefined): boolean {
    const cs = (callsign ?? "").trim().toUpperCase()
    return cs.startsWith("ESMS") && isAdStripGroundPosition(cs)
}

/** ESSB DEL/GND/TWR (and remote tower) → Bromma AD board overlay (essb.yml). */
export function isEssbTowerCallsign(callsign: string | null | undefined): boolean {
    const cs = (callsign ?? "").trim().toUpperCase()
    return cs.startsWith("ESSB") && isAdStripGroundPosition(cs)
}

/** Any AD-strip tower login (ESMS / ESSB DEL|GND|TWR|_R_*). */
export function isAdStripTowerCallsign(callsign: string | null | undefined): boolean {
    return isEsmsTowerCallsign(callsign) || isEssbTowerCallsign(callsign)
}

/**
 * look:paper AD-strip board for ESMS/ESSB (AD roles — not ESGG CD/GND/TWR).
 * Only GG / MS / SB ever use AD strip chrome; others stay look:std.
 */
export function isAdStripTowerBoard(config: {
    look?: string
    myCallsign?: string
    myAirports?: string[]
}): boolean {
    if (config.look !== "paper") return false
    if (isAdStripTowerCallsign(config.myCallsign)) return true
    if (isEsggTowerCallsign(config.myCallsign)) return false
    const airports = (config.myAirports ?? []).map((a) => a.toUpperCase())
    return airports.length > 0 && airports.every((a) => isAdStripTowerIcao(a))
}

/** Overlay YAML for an AD-strip tower callsign, if any. */
export function adStripTowerOverlayFile(
    callsign: string | null | undefined,
): "esms.yml" | "essb.yml" | undefined {
    if (isEsmsTowerCallsign(callsign)) return "esms.yml"
    if (isEssbTowerCallsign(callsign)) return "essb.yml"
    return undefined
}

/**
 * PAPER AD-strip overlay from login only (ESMS / ESSB DEL|GND|TWR|_R_*).
 * APP and all other airports → undefined → generic AD+T board + T strips.
 */
export function resolveAdStripTowerOverlay(opts: {
    callsign?: string | null
    airports?: string[] | null
}): "esms.yml" | "essb.yml" | undefined {
    void opts.airports
    return adStripTowerOverlayFile(opts.callsign)
}

/**
 * Map a VATSIM login callsign to a paper board role (no ESE).
 * Remote tower (_R_APP / _R_CTR) is AD. Plain _APP is T.
 * Director is _F_APP and is normally resolved via ESE frequency/SI — see resolvePaperPositionRole.
 */
export function callsignToPaperRole(callsign: string | null | undefined): PaperPositionRole | undefined {
    if (!callsign) return undefined
    const upper = callsign.trim().toUpperCase()
    if (!upper) return undefined
    if (upper.endsWith("_R_APP") || upper.endsWith("_R_CTR")) return "AD"
    // Literal ESE-style director login (rare); normally detected via frequency/SI
    if (/_F_APP\b/.test(upper)) return "P"
    if (upper.endsWith("_APP")) return "T"
    if (upper.endsWith("_DEL") || upper.endsWith("_GND") || upper.endsWith("_TWR")) return "AD"
    // AFIS / bare airport logins act as tower-side
    if (!upper.endsWith("_CTR")) return "AD"
    return undefined
}

/** ControllerRole → paper role (director is not a ControllerRole — use ESE). */
export function controllerRoleToPaperRole(role: ControllerRole | undefined): PaperPositionRole | undefined {
    if (!role) return undefined
    if (role === "APP") return "T"
    if (role === "DEL" || role === "GND" || role === "TWR") return "AD"
    return undefined
}

export function highestPaperControllerRole(roles: PaperPositionRole[]): ControllerRole | undefined {
    // P and T both act as APP for EuroScope-style checks
    if (roles.includes("P") || roles.includes("T")) return "APP"
    if (roles.includes("AD")) return "TWR"
    return undefined
}

/**
 * Paper role for a controller: ESE SI / primary frequency first (F_APP → P),
 * then login callsign / ControllerRole fallback.
 */
export function resolvePaperPositionRole(opts: {
    callsign?: string | null
    frequency?: number | null
    positionId?: string | null
    airport?: string | null
    controllerRole?: ControllerRole
}): PaperPositionRole | undefined {
    const airport =
        opts.airport ??
        (opts.callsign && opts.callsign.trim().length >= 4
            ? opts.callsign.trim().slice(0, 4).toUpperCase()
            : undefined)
    const ese = resolveEsePosition({
        callsign: opts.callsign,
        frequency: opts.frequency,
        positionId: opts.positionId,
        airport,
    })
    if (ese && isEseDirectorCallsign(ese.callsign)) return "P"
    return (
        callsignToPaperRole(opts.callsign) ?? controllerRoleToPaperRole(opts.controllerRole)
    )
}

/** Online staffed paper roles at the airport (your login + others), cut to catalog. */
export function computePaperStaffedRoles(
    myPaperRole: PaperPositionRole | undefined,
    onlinePaperRoles: PaperPositionRole[],
    available: PaperPositionRole[],
): PaperPositionRole[] {
    const allow = new Set(available)
    const set = new Set<PaperPositionRole>()
    if (myPaperRole && allow.has(myPaperRole)) set.add(myPaperRole)
    for (const r of onlinePaperRoles) {
        if (allow.has(r)) set.add(r)
    }
    return sortPaperRoles([...set])
}

/**
 * Covering roles from my paper login + who is staffed.
 * Staffed must include my role when I am logged in.
 */
export function computeAutoPaperRoles(
    myPaperRole: PaperPositionRole | undefined,
    staffed: PaperPositionRole[],
    available: PaperPositionRole[],
): PaperPositionRole[] {
    if (!myPaperRole || !available.includes(myPaperRole)) return []

    const allow = new Set(available)
    const adOnline = staffed.includes("AD")
    const tOnline = staffed.includes("T")
    const pOnline = staffed.includes("P")

    if (myPaperRole === "P") {
        return allow.has("P") ? ["P"] : []
    }

    if (myPaperRole === "T") {
        const out: PaperPositionRole[] = []
        // Top-down: APP covers tower when nobody is on AD
        if (allow.has("AD") && !adOnline) out.push("AD")
        if (allow.has("T")) out.push("T")
        if (allow.has("P") && !pOnline) out.push("P")
        return sortPaperRoles(out)
    }

    // AD
    const out: PaperPositionRole[] = []
    if (allow.has("AD")) out.push("AD")
    if (!tOnline) {
        if (allow.has("T")) out.push("T")
        if (allow.has("P") && !pOnline) out.push("P")
    }
    return sortPaperRoles(out)
}

/**
 * Pick the paper board's primary ICAO from myAirports.
 * Prefer login callsign prefix (ESPA_APP → ESPA) so sibling ES flags
 * (e.g. ESNP next to ESPA) do not steal AD-only catalog defaults.
 * Otherwise prefer the airport with the richest position catalog.
 */
export function primaryPaperAirport(
    airports: string[],
    callsign?: string | null,
): string | undefined {
    const list = [...new Set(airports.map((a) => a.trim().toUpperCase()).filter(Boolean))]
    const cs = (callsign ?? "").trim().toUpperCase()
    const prefix = cs.length >= 4 ? cs.slice(0, 4) : ""
    // Login ICAO wins even before rwyconfig seeds myAirports (or when a sibling
    // field is listed first).
    if (prefix) {
        if (list.length === 0 || list.includes(prefix)) return prefix
    }
    if (list.length === 0) return undefined
    let best = list[0]!
    let bestLen = paperPositionsForAirport(best).length
    for (const icao of list.slice(1)) {
        const len = paperPositionsForAirport(icao).length
        if (len > bestLen) {
            best = icao
            bestLen = len
        }
    }
    return best
}

/** Available positions for the primary paper airport. */
export function paperAvailableForAirports(
    airports: string[],
    callsign?: string | null,
): PaperPositionRole[] {
    const icao = primaryPaperAirport(airports, callsign)
    if (!icao) return ["AD"]
    return paperPositionsForAirport(icao)
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

/** True when a second runway designator is active (dual-runway paper board). */
export function paperNeedsSecondRunway(
    activeRunways: Record<string, { arr: string[]; dep: string[] }> | undefined,
    airports: string[],
): boolean {
    const icao = airports[0]?.toUpperCase()
    if (!icao || !activeRunways) return false
    const rw = activeRunways[icao]
    if (!rw) return false
    const ids = new Set(
        [...(rw.arr ?? []), ...(rw.dep ?? [])].map((r) => r.trim().toUpperCase()).filter(Boolean),
    )
    return ids.size >= 2
}

/**
 * Expand the 3-bay std board with a second runway bay (from std-2rwy).
 * No-op when the second runway sections are already present or not needed.
 */
export function applyPaperDualRunwayLayout(
    layout: EfsLayout,
    dual: boolean,
): EfsLayout {
    if (!dual) return layout
    if (layout.bays.some((b) => b.sections.some((s) => s.id === "runway_b"))) {
        return layout
    }

    const pendingDep = findSectionById(layout, "pending_dep")
    const clearance = findSectionById(layout, "clearance")
    const taxi = findSectionById(layout, "taxi")
    const sequence = findSectionById(layout, "sequence")
    const runway = findSectionById(layout, "runway")
    const pendingArr = findSectionById(layout, "pending_arr")
    const tma = findSectionById(layout, "tma_ctr")
    if (!runway || !tma) return layout

    const sequenceB: Section = {
        id: "sequence_b",
        title: "",
        hideHeader: true,
        addFromTop: true,
    }
    const runwayB: Section = {
        id: "runway_b",
        title: "RWY <rwy2>",
        addFromTop: false,
    }

    // Retitle primary runway header to RWY <rwy1> when dual
    const runway1: Section = { ...runway, title: "RWY <rwy1>" }

    const bays: Bay[] = [
        {
            id: "bay1",
            sections: [pendingDep, clearance, taxi].filter((s): s is Section => !!s),
        },
        {
            id: "bay2",
            sections: [sequence, runway1].filter((s): s is Section => !!s),
        },
        { id: "bay3", sections: [sequenceB, runwayB] },
        {
            id: "bay4",
            sections: [pendingArr, tma].filter((s): s is Section => !!s),
        },
    ].filter((b) => b.sections.length > 0)

    return bays.length > 0 ? { bays } : layout
}

/**
 * Covering T without AD: approach board — 4 columns.
 *   pending dep | above+DEP | above+ARR+APP | pending arr
 * APP header sits in the ARR bay, below ARR.
 * Exclusive P uses the mid-bay APP board instead (applyPaperApproachDivider).
 */
export function paperIsTowerWithoutAd(covering: PaperPositionRole[]): boolean {
    return covering.includes("T") && !covering.includes("AD")
}

export function paperIsExclusiveP(covering: PaperPositionRole[]): boolean {
    return covering.length === 1 && covering[0] === "P"
}

/** Mid-bay APP board: exclusive P only. */
export function paperShowsApproachDivider(covering: PaperPositionRole[]): boolean {
    return paperIsExclusiveP(covering)
}

function buildPaperTmaSections(layout: EfsLayout): {
    pendingDep: Section
    pendingArr: Section
    depAbove: Section
    tmaDep: Section
    arrAbove: Section
    tmaArr: Section
    appAbove: Section
    app: Section
} | null {
    const pendingDep = findSectionById(layout, "pending_dep")
    const pendingArr = findSectionById(layout, "pending_arr")
    if (!pendingDep || !pendingArr) return null

    const existingDepAbove = findSectionById(layout, "tma_dep_above")
    const existingArrAbove = findSectionById(layout, "tma_arr_above")
    const existingAppAbove = findSectionById(layout, "app_above")
    const existingDep = findSectionById(layout, "tma_dep")
    const existingArr =
        findSectionById(layout, "tma_arr") ?? findSectionById(layout, "tma_ctr")
    const existingApp = findSectionById(layout, "app")

    return {
        pendingDep: { ...pendingDep, title: "", hideHeader: true },
        pendingArr: { ...pendingArr, title: "", hideHeader: true },
        depAbove: {
            ...(existingDepAbove ?? { id: "tma_dep_above", addFromTop: true }),
            id: "tma_dep_above",
            title: "",
            hideHeader: true,
            addFromTop: true,
        },
        tmaDep: {
            ...(existingDep ?? { id: "tma_dep", addFromTop: false }),
            id: "tma_dep",
            title: "DEP",
            hideHeader: false,
            addFromTop: false,
        },
        arrAbove: {
            ...(existingArrAbove ?? { id: "tma_arr_above", addFromTop: true }),
            id: "tma_arr_above",
            title: "",
            hideHeader: true,
            addFromTop: true,
        },
        tmaArr: {
            ...(existingArr ?? { id: "tma_arr", addFromTop: true }),
            id: existingArr?.id === "tma_ctr" ? "tma_ctr" : "tma_arr",
            title: "ARR",
            hideHeader: false,
            addFromTop: existingArr?.addFromTop ?? true,
        },
        appAbove: {
            ...(existingAppAbove ?? { id: "app_above", addFromTop: true }),
            id: "app_above",
            title: "",
            hideHeader: true,
            addFromTop: true,
        },
        app: {
            ...(existingApp ?? { id: "app", addFromTop: false }),
            id: "app",
            title: "APP",
            hideHeader: false,
            addFromTop: false,
        },
    }
}

export function applyPaperCoveringLayout(
    layout: EfsLayout,
    covering: PaperPositionRole[],
): EfsLayout {
    if (!paperIsTowerWithoutAd(covering)) return layout
    const s = buildPaperTmaSections(layout)
    if (!s) return layout

    // APP under ARR in the same bay; runway from ES when selected
    const app: typeof s.app = {
        ...s.app,
        title: "APP <rwy1>",
        hideHeader: false,
        addFromTop: false,
    }

    return {
        bays: [
            { id: "bay1", sections: [s.pendingDep] },
            { id: "bay2", sections: [s.depAbove, s.tmaDep] },
            { id: "bay3", sections: [s.arrAbove, s.tmaArr, app] },
            { id: "bay4", sections: [s.pendingArr] },
        ],
    }
}

/**
 * Exclusive P only: three bays with APP divider in the middle.
 *   pending+DEP | APP [rwy] | pending+ARR
 * DEP/ARR stay as headerless pin hosts (no DEP/ARR titles).
 */
export function applyPaperApproachDivider(
    layout: EfsLayout,
    covering: PaperPositionRole[],
): EfsLayout {
    if (!paperShowsApproachDivider(covering)) return layout
    const s = buildPaperTmaSections(layout)
    if (!s) return layout

    const depHost: typeof s.tmaDep = {
        ...s.tmaDep,
        title: "",
        hideHeader: true,
    }
    const arrHost: typeof s.tmaArr = {
        ...s.tmaArr,
        title: "",
        hideHeader: true,
    }
    const app: typeof s.app = {
        ...s.app,
        // <rwy1> resolves to active ES runway; empty → plain "APP"
        title: "APP <rwy1>",
        hideHeader: false,
    }

    return {
        bays: [
            { id: "bay1", sections: [s.pendingDep, s.depAbove, depHost] },
            { id: "bay2", sections: [s.appAbove, app] },
            { id: "bay3", sections: [s.pendingArr, s.arrAbove, arrHost] },
        ],
    }
}

/** Preferred pin-host section id when giving T↔P (DEP vs ARR). */
export function paperTpPinSectionId(stripType: string | undefined): string {
    if (stripType === "arrival" || stripType === "cross") return "tma_arr"
    return "tma_dep"
}

/** Resolve pin host against the live layout (tma_ctr may stand in for tma_arr). */
export function resolvePaperTpPinSectionId(
    layout: EfsLayout,
    stripType: string | undefined,
): string {
    const prefer = paperTpPinSectionId(stripType)
    if (findSectionById(layout, prefer)) return prefer
    if (prefer === "tma_arr" && findSectionById(layout, "tma_ctr")) return "tma_ctr"
    return prefer
}

export function isPaperTpPinSectionId(sectionId: string | undefined): boolean {
    if (!sectionId) return false
    return (
        sectionId === "tma_dep" ||
        sectionId === "tma_arr" ||
        sectionId === "tma_ctr" ||
        sectionId.endsWith("_tma_dep") ||
        sectionId.endsWith("_tma_arr")
    )
}

/**
 * When P is staffed on a dual-runway board, pull sequence (+ sequence_b) into
 * a column between the runway pair and TMA (4 columns).
 * Single-runway boards stay at 3 columns — sequence remains above the runway
 * even when P is online (ESPA etc.).
 */
export function applyPaperRoleLayout(
    layout: EfsLayout,
    staffed: PaperPositionRole[],
): EfsLayout {
    if (!staffed.includes("P")) return layout
    const hasRwyB = !!findSectionById(layout, "runway_b")
    // P sequence column only pays off with two runway bays
    if (!hasRwyB) return layout

    const ground = bayWith("bay1", ["pending_dep", "clearance", "taxi"], layout)
    const rwyBay: Bay = {
        id: "bay2",
        sections: [findSectionById(layout, "runway"), findSectionById(layout, "runway_b")].filter(
            (s): s is Section => !!s,
        ),
    }

    const seqSections = ["sequence", "sequence_b"]
        .map((id) => findSectionById(layout, id))
        .filter((s): s is Section => !!s)
        .map((s) => ({
            ...s,
            hideHeader: true,
            title: s.title || "",
        }))
    const seqBay: Bay | undefined =
        seqSections.length > 0 ? { id: "bay3", sections: seqSections } : undefined

    const tmaBay = bayWith("bay4", ["pending_arr", "tma_ctr"], layout)
    const bays = [ground, rwyBay, seqBay, tmaBay].filter((b): b is Bay => !!b)
    return {
        bays: bays.map((b, i) => ({ ...b, id: `bay${i + 1}` })),
    }
}

/**
 * Default horizontal pan when T is staffed (shared board, role-based view).
 * - covering only AD → hide TMA (scroll so ground/runway stay in view)
 * - covering T (or P without AD) → hide clearance/taxi (show TMA)
 */
export function paperDefaultPanHideGround(covering: PaperPositionRole[]): boolean {
    return covering.includes("T") || (covering.includes("P") && !covering.includes("AD"))
}

export function paperDefaultPanHideTma(covering: PaperPositionRole[]): boolean {
    return covering.includes("AD") && !covering.includes("T") && !covering.includes("P")
}

/** Optional paper divider ids that can be added/removed from the bottom bar. */
export const PAPER_OPTIONAL_SECTION_PUSHBACK = "pushback"

/** True when taxi is already a combined TAXI/PUSHBACK host (ESMS AD board). */
export function layoutHasCombinedTaxiPushback(layout: EfsLayout): boolean {
    const taxi = findSectionById(layout, "taxi")
    const title = (taxi?.title || "").toUpperCase()
    return title.includes("PUSHBACK")
}

/**
 * Separate PUSHBACK divider is AD ground-board only — never on T or P approach boards.
 */
export function paperAllowsOptionalPushback(covering: PaperPositionRole[]): boolean {
    return covering.includes("AD")
}

/**
 * Inject optional paper sections (e.g. PUSHBACK) when open.
 * Default: before taxi in the ground bay.
 * Skipped for T/P boards, when taxi is missing, or when taxi is already TAXI/PUSHBACK (ESMS).
 */
export function applyPaperOptionalSections(
    layout: EfsLayout,
    openIds: Iterable<string> | undefined,
    covering?: PaperPositionRole[],
): EfsLayout {
    const open = new Set(openIds ?? [])
    if (!open.has(PAPER_OPTIONAL_SECTION_PUSHBACK)) return layout
    if (findSectionById(layout, PAPER_OPTIONAL_SECTION_PUSHBACK)) return layout
    // Combined host — no separate PUSHBACK divider
    if (layoutHasCombinedTaxiPushback(layout)) return layout
    // T / P approach boards have no ground taxi host
    if (covering && !paperAllowsOptionalPushback(covering)) return layout

    const taxiBayIdx = layout.bays.findIndex((b) => b.sections.some((s) => s.id === "taxi"))
    if (taxiBayIdx < 0) return layout

    const pushback: Section = {
        id: PAPER_OPTIONAL_SECTION_PUSHBACK,
        title: "PUSHBACK",
        addFromTop: false,
        hideHeader: false,
    }

    const bays = layout.bays.map((bay) => ({ ...bay, sections: [...bay.sections] }))
    const target = bays[taxiBayIdx]
    if (!target) return layout

    const taxiIdx = target.sections.findIndex((s) => s.id === "taxi")
    if (taxiIdx >= 0) target.sections.splice(taxiIdx, 0, pushback)
    else target.sections.push(pushback)

    return { bays }
}

/** True when dragging from the headerless zone above DEP/ARR/APP into the divider below. */
export function isPaperTmaAssumeCross(
    fromSectionId: string | undefined,
    toSectionId: string | undefined,
): boolean {
    if (!fromSectionId || !toSectionId) return false
    if (fromSectionId === "tma_dep_above" && toSectionId === "tma_dep") return true
    if (
        fromSectionId === "tma_arr_above" &&
        (toSectionId === "tma_arr" || toSectionId === "tma_ctr")
    ) {
        return true
    }
    // APP under ARR is T→P give, not ASSUME
    return false
}

/** Align sectionToBay with the layout served to clients. */
export function syncPaperSectionToBayFromLayout(
    sectionToBay: Map<string, string>,
    layout: EfsLayout,
): void {
    for (const bay of layout.bays) {
        for (const section of bay.sections) {
            sectionToBay.set(section.id, bay.id)
        }
    }
}

/**
 * Ensure runtime TMA sections (`tma_dep_above`, …) are in sectionToBay before
 * print/placement. getLayout() normally syncs these, but print can run first.
 */
export function ensurePaperCoveringSectionToBay(
    sectionToBay: Map<string, string>,
    baseLayout: EfsLayout,
    covering: PaperPositionRole[],
): void {
    if (!covering.length) return
    let layout = applyPaperCoveringLayout(baseLayout, covering)
    layout = applyPaperApproachDivider(layout, covering)
    syncPaperSectionToBayFromLayout(sectionToBay, layout)
}

/** Physical strip family for this covering (one family per VatEFS instance). */
export type PaperStripFamily = "unified" | "ad" | "tma"

/**
 * Resolve AD vs TMA strip family from covering roles.
 * - AD + T → unified (one strip through all phases)
 * - AD without T → ad (even if P is also covered)
 * - T and/or P without AD → tma
 * - empty / unknown → unified
 */
export function resolvePaperStripFamily(covering: PaperPositionRole[]): PaperStripFamily {
    const hasAd = covering.includes("AD")
    const hasT = covering.includes("T")
    const hasP = covering.includes("P")
    if (hasAd && hasT) return "unified"
    if (hasAd && !hasT) return "ad"
    if ((hasT || hasP) && !hasAd) return "tma"
    return "unified"
}

/** Strip id for IRIS / bay store: CALLSIGN, CALLSIGN#ad, or CALLSIGN#tma. */
export function paperFamilyStripId(callsign: string, family: PaperStripFamily): string {
    const cs = (callsign || "").trim()
    if (!cs) return cs
    if (family === "unified") return cs
    return `${cs}#${family}`
}

const PAPER_FAMILY_SUFFIX_RE = /#(ad|tma)$/i

/** Parse CALLSIGN#ad / CALLSIGN#tma; otherwise family is unified. */
export function parsePaperFamilyStripId(stripId: string): {
    callsign: string
    family: PaperStripFamily
} {
    const raw = (stripId || "").trim()
    const m = raw.match(PAPER_FAMILY_SUFFIX_RE)
    if (m && m.index != null && m.index > 0) {
        return {
            callsign: raw.slice(0, m.index),
            family: m[1]!.toLowerCase() as "ad" | "tma",
        }
    }
    return { callsign: raw, family: "unified" }
}

/** Strip family suffix from an id, or undefined when unified / absent. */
export function paperFamilyFromStripId(stripId: string | undefined): PaperStripFamily {
    if (!stripId) return "unified"
    return parsePaperFamilyStripId(stripId).family
}

/**
 * Callsign from a strip id that may include `#ad`/`#tma` and/or `@ICAO`.
 * Does not strip anonymous special prefixes (`vfrdep:…`).
 */
export function callsignFromPaperStripId(stripId: string): string {
    let s = (stripId || "").trim()
    const hash = s.search(PAPER_FAMILY_SUFFIX_RE)
    if (hash > 0) s = s.slice(0, hash)
    const at = s.lastIndexOf("@")
    if (at > 0) s = s.slice(0, at)
    return s
}
