/**
 * ESSA config-aware preferred SID matching (Appendix A/B + ESE).
 *
 * Normal prefs: prefix + letter (AIRAC-flexible number).
 * SLOW prefs: track/heading SIDs (middle-dot separator) or HAPZI.
 */

import fs from "fs"
import {
    getEssaRwyCombination,
    isTrackSidName,
    isVectorSidName,
    normalizeEssaRwy,
} from "@vatefs/common"
import { getSidsForRunway } from "./sid-data.js"

const TRACK_SEP = "\u00B7" // middle dot ·

export type AppDepSector = "DEP-W" | "DEP-E" | "ARR-W" | "ARR-E"

export interface NamedSidPref {
    exits: string[]
    sid: string
    letter: string
    track?: undefined
    heading?: undefined
    /** Appendix A receiving sector for this SID/exit */
    nextSector?: AppDepSector
}

export interface TrackSidPref {
    exits: string[]
    track?: string
    heading?: string
    sid?: undefined
    letter?: undefined
    nextSector?: AppDepSector
}

export type SidPref = NamedSidPref | TrackSidPref

export interface EssaSidConfigPrefs {
    depRunway: string
    prefs: SidPref[]
    slowPrefs?: SidPref[]
    /** Night configs: low-speed traffic follows normal SID */
    slowFollowSid?: boolean
    /** Low-speed delivery sector (06–22 LT) */
    slowNextSector?: AppDepSector
    /** Missed approach / GOA delivery sector */
    mapNextSector?: AppDepSector
    /** Appendix A MAP delivery heading (e.g. H270 → 270) */
    mapHeading?: number
    /** Appendix A MAP delivery altitude feet (e.g. 4000 FT) */
    mapAltitudeFt?: number
}

let prefsByConfig: Map<string, EssaSidConfigPrefs> = new Map()

export function loadEssaSidPrefs(filePath: string): void {
    if (!fs.existsSync(filePath)) {
        console.warn(`ESSA SID prefs not found: ${filePath}`)
        prefsByConfig = new Map()
        return
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, EssaSidConfigPrefs>
    prefsByConfig = new Map(Object.entries(data))
    console.log(`Loaded ESSA SID prefs for ${prefsByConfig.size} runway configs`)
}

export function getEssaSidConfigPrefs(configId: string): EssaSidConfigPrefs | undefined {
    return prefsByConfig.get(configId)
}

function isNamedPref(p: SidPref): p is NamedSidPref {
    return typeof p.sid === "string" && typeof p.letter === "string"
}

/** Walk FPL route tokens; return first that appears in `exits` (case-insensitive). */
export function findRouteExit(route: string | undefined, exits: Iterable<string>): string | undefined {
    if (!route) return undefined
    const exitList = [...exits].map(e => e.toUpperCase())
    const exitSet = new Set(exitList)
    for (const raw of route.split(/\s+/)) {
        if (!raw) continue
        const upper = raw.toUpperCase()
        if (upper === "DCT") continue
        const slashIdx = upper.indexOf("/")
        const token = slashIdx >= 0 ? upper.substring(0, slashIdx) : upper
        if (!token) continue
        if (/^\d{1,2}[LRC]?$/i.test(token)) continue
        if (slashIdx >= 0 && /^[A-Z]{4}$/.test(token)) continue
        // ICAO speed/level group (N0450F350, M078F100, …)
        if (/^[NKM]\d{3,4}[FASM]\d{3,4}$/i.test(token)) continue
        if (exitSet.has(token)) return token
        // Track SID in route: 240·PETEV or 190·120·BABAP
        if (token.includes(TRACK_SEP)) {
            const last = token.split(TRACK_SEP).pop()
            if (last && exitSet.has(last)) return last
        }
        // Named SID designator starting with exit: RESNA6G
        for (const exit of exitList) {
            if (token.startsWith(exit) && new RegExp(`^${escapeRe(exit)}\\d`).test(token)) {
                return exit
            }
        }
    }
    return undefined
}

function namedSidRegex(prefix: string, letter: string): RegExp {
    return new RegExp(`^${escapeRe(prefix)}\\d+${escapeRe(letter)}$`, "i")
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Find ESE SID matching prefix+letter on runway. Skips names containing `?`.
 * When `exit` is set, prefer radar-vector form `BASE·EXIT` (e.g. ARS6E·KOGAV).
 */
export function findNamedSid(
    airport: string,
    runway: string,
    prefix: string,
    letter: string,
    exit?: string,
): string | undefined {
    const names = getSidsForRunway(airport, runway)
        .map(s => s.name)
        .filter(name => !name.includes("?"))

    if (exit) {
        const exitU = exit.toUpperCase()
        const vectorRe = new RegExp(
            `^${escapeRe(prefix)}\\d+${escapeRe(letter)}${escapeRe(TRACK_SEP)}${escapeRe(exitU)}$`,
            "i",
        )
        const vectorHits = names.filter(n => vectorRe.test(n))
        if (vectorHits.length === 1) return vectorHits[0]
        if (vectorHits.length > 1) return [...vectorHits].sort()[0]
    }

    const matches = names.filter(name => namedSidRegex(prefix, letter).test(name))
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
        // Prefer shortest / most recent designator — take first sorted for stability
        return [...matches].sort()[0]
    }
    return undefined
}

/**
 * Match track/heading SID names (· separator) for an exit on runway.
 */
export function findTrackSid(
    airport: string,
    runway: string,
    exit: string,
    track?: string,
    heading?: string
): string | undefined {
    const exitU = exit.toUpperCase()
    const names = getSidsForRunway(airport, runway)
        .map(s => s.name)
        .filter(n => {
            if (!n.includes(TRACK_SEP) || n.toUpperCase().startsWith("VFR")) return false
            // Exclude radar-vector SIDs (ARS6E·KOGAV) — not SLOW tracks
            const left = n.split(TRACK_SEP)[0] || ""
            return /^\d{3}$/.test(left)
        })

    if (track && heading) {
        const exact = `${track}${TRACK_SEP}${heading}${TRACK_SEP}${exitU}`
        const hit = names.find(n => n.toUpperCase() === exact.toUpperCase())
        if (hit) return hit
    }

    if (track) {
        // Prefer exact track·exit (matches typical ES selection); fall back to NNN·track·exit
        const simple = `${track}${TRACK_SEP}${exitU}`
        const hit = names.find(n => n.toUpperCase() === simple.toUpperCase())
        if (hit) return hit

        const leadRe = new RegExp(
            `^\\d{3}${escapeRe(TRACK_SEP)}${escapeRe(track)}${escapeRe(TRACK_SEP)}${escapeRe(exitU)}$`,
            "i",
        )
        const lead = names.filter(n => leadRe.test(n))
        if (lead.length === 1) return lead[0]
        if (lead.length > 1) return [...lead].sort()[0]
    }

    if (heading) {
        const simple = `${heading}${TRACK_SEP}${exitU}`
        const hit = names.find(n => n.toUpperCase() === simple.toUpperCase())
        if (hit) return hit
    }

    return undefined
}

function resolvePrefSid(airport: string, runway: string, pref: SidPref, exit: string): string | undefined {
    if (isNamedPref(pref)) {
        return findNamedSid(airport, runway, pref.sid, pref.letter, exit)
    }
    return findTrackSid(airport, runway, exit, pref.track, pref.heading)
}

function activePrefList(config: EssaSidConfigPrefs, slow: boolean): SidPref[] {
    if (slow && !config.slowFollowSid && config.slowPrefs?.length) {
        return config.slowPrefs
    }
    return config.prefs
}

export interface PreferredSidResult {
    sid: string | null
    /** All ESE SID names matching any active pref pattern (for dropdown sort) */
    sortGroup: string[]
    exit?: string
    nextSector?: AppDepSector
}

const SECTOR_TO_SI: Record<AppDepSector, string> = {
    "DEP-W": "DW",
    "DEP-E": "DE",
    "ARR-W": "W",
    "ARR-E": "E",
}

export function appDepSectorToSi(sector: AppDepSector): string {
    return SECTOR_TO_SI[sector]
}

/**
 * Appendix A missed-approach delivery (HDG / ALT / next sector).
 * HDG/CFL only when `arrRwy` matches the config's primary ARR (or arrRwy is unset).
 * Differing ARR (e.g. 01L under config 1) → sector only, no heading/altitude.
 */
export function resolveMapDelivery(
    configId: string,
    arrRwy?: string
): {
    sector: AppDepSector
    heading?: number
    altitudeFt?: number
} {
    const config = prefsByConfig.get(configId)
    const sector = config?.mapNextSector ?? "ARR-E"
    const combo = getEssaRwyCombination(configId)
    const configArr = combo?.arrName ? normalizeEssaRwy(combo.arrName) : undefined
    const flightArr = arrRwy ? normalizeEssaRwy(arrRwy) : undefined

    const arrMatches =
        !flightArr || !configArr || flightArr === configArr

    if (!arrMatches) {
        return { sector }
    }

    return {
        sector,
        heading: config?.mapHeading,
        altitudeFt: config?.mapAltitudeFt,
    }
}

/**
 * Appendix A next APP/DEP sector for TWR handoff (normal SID / slow / MAP).
 */
export function resolveAppDepNextSector(options: {
    configId: string
    route?: string
    slow?: boolean
    missedApproach?: boolean
}): AppDepSector {
    const config = prefsByConfig.get(options.configId)
    if (!config) return "DEP-W"

    if (options.missedApproach) {
        return resolveMapDelivery(options.configId).sector
    }

    const useSlow = !!options.slow && !config.slowFollowSid
    if (useSlow && config.slowNextSector) {
        return config.slowNextSector
    }

    const prefs = activePrefList(config, useSlow)
    const allExits = prefs.flatMap((p) => p.exits)
    const exit = findRouteExit(options.route, allExits)
    if (exit) {
        const pref = prefs.find((p) => p.exits.some((e) => e.toUpperCase() === exit))
        if (pref?.nextSector) return pref.nextSector
    }

    // Prefer first pref with nextSector, else DEP-W
    for (const p of prefs) {
        if (p.nextSector) return p.nextSector
    }
    return "DEP-W"
}

/**
 * Resolve preferred SID + sort group for an ESSA departure.
 */
export function resolvePreferredSid(options: {
    airport: string
    runway: string
    configId: string
    route?: string
    slow?: boolean
}): PreferredSidResult {
    const config = prefsByConfig.get(options.configId)
    if (!config) return { sid: null, sortGroup: [] }

    const runway = options.runway || config.depRunway
    const prefs = activePrefList(config, !!options.slow)
    const allExits = prefs.flatMap(p => p.exits)
    const exit = findRouteExit(options.route, allExits)

    const sortGroup = collectSortGroup(options.airport, runway, prefs)

    if (!exit) return { sid: null, sortGroup }

    const pref = prefs.find(p => p.exits.some(e => e.toUpperCase() === exit))
    if (!pref) return { sid: null, sortGroup, exit }

    const sid = resolvePrefSid(options.airport, runway, pref, exit) ?? null
    return { sid, sortGroup, exit, nextSector: pref.nextSector }
}

/** SIDs matching any pref in the active list (named letter-group or track patterns). */
function collectSortGroup(airport: string, runway: string, prefs: SidPref[]): string[] {
    const names = getSidsForRunway(airport, runway).map(s => s.name)
    const out = new Set<string>()

    for (const pref of prefs) {
        addPrefSidsToSet(names, pref, out)
    }

    // HAPZI is named — already covered. Also add HAPZI matches when named pref.
    return [...out]
}

/** Add ESE SID names matching one pref (named letter-group or track pattern). */
function addPrefSidsToSet(names: string[], pref: SidPref, out: Set<string>, exitFilter?: string): void {
    if (isNamedPref(pref)) {
        const re = namedSidRegex(pref.sid, pref.letter)
        for (const name of names) {
            if (!name.includes("?") && re.test(name)) out.add(name)
        }
        return
    }
    const exits = new Set(pref.exits.map(e => e.toUpperCase()))
    const trk = pref.track?.toUpperCase()
    const hdg = pref.heading?.toUpperCase()
    if (!trk && !hdg) return
    const wantExit = exitFilter?.toUpperCase()
    for (const name of names) {
        if (!name.includes(TRACK_SEP) || name.toUpperCase().startsWith("VFR")) continue
        const parts = name.toUpperCase().split(TRACK_SEP)
        const exitPart = parts[parts.length - 1]
        if (!exitPart || !exits.has(exitPart)) continue
        if (wantExit && exitPart !== wantExit) continue
        if (trk && hdg) {
            if (parts.length === 3 && parts[0] === trk && parts[1] === hdg) out.add(name)
            continue
        }
        if (trk) {
            if (parts.length === 2 && parts[0] === trk) out.add(name)
            else if (parts.length === 3 && parts[1] === trk) out.add(name)
            continue
        }
        if (hdg && parts.length === 2 && parts[0] === hdg) out.add(name)
    }
}

/**
 * Prefs to consult for exit→SID highlighting on a runway:
 * active ES config + every config whose depRunway matches the strip RWY
 * (manual RWY select may differ from the selected ESSA combination).
 */
function prefsForRunwayHighlight(configId: string, runway: string): SidPref[] {
    const seen = new Set<SidPref>()
    const out: SidPref[] = []
    const add = (cfg: EssaSidConfigPrefs | undefined) => {
        if (!cfg) return
        for (const p of [...cfg.prefs, ...(cfg.slowPrefs ?? [])]) {
            if (seen.has(p)) continue
            seen.add(p)
            out.push(p)
        }
    }
    add(prefsByConfig.get(configId))
    const rwy = normalizeEssaRwy(runway)
    if (rwy) {
        for (const cfg of prefsByConfig.values()) {
            if (normalizeEssaRwy(cfg.depRunway) === rwy) add(cfg)
        }
    }
    return out
}

/**
 * Runway SIDs to highlight for a filled TMA exit:
 * - named SIDs whose designator is the exit (ARS*)
 * - single-exit alternatives (ROKNI when ARS is filled, ABENI when PETEV)
 * - radar-vector SIDs ending with ·exit (KOGAV4L·ARS)
 * - SLOW track SIDs ending with ·exit (240·ARS, 010·240·NOSLI)
 *
 * Does not highlight sibling exits from multi-exit prefs (e.g. RESNA/KOGAV when
 * matching an ARS-named pref), catch-all SIDs (KOGAV for ARS+PETEV+…), or HAPZI.
 */
export function collectSidsForTmaExit(options: {
    airport: string
    runway: string
    configId: string
    tmaExit: string
}): string[] {
    const tmaExit = options.tmaExit.trim().toUpperCase()
    if (!tmaExit) return []

    const runway = options.runway
    if (!runway) return []
    const names = getSidsForRunway(options.airport, runway).map(s => s.name)
    const allPrefs = prefsForRunwayHighlight(options.configId, runway)
    if (allPrefs.length === 0) return []
    const out = new Set<string>()

    // 1. Named RNAV SIDs for the exit itself (ARS*, KOGAV*, …)
    const exitSidRe = new RegExp(`^${escapeRe(tmaExit)}\\d+[A-Z]+$`, "i")
    for (const name of names) {
        if (!name.includes("?") && exitSidRe.test(name)) out.add(name)
    }

    // 2. Dedicated single-exit alternatives (exits:[ARS] → sid:ROKNI)
    const altPrefixes = new Set<string>()
    for (const pref of allPrefs) {
        if (!isNamedPref(pref)) continue
        const exits = pref.exits.map(e => e.toUpperCase())
        if (exits.length !== 1 || exits[0] !== tmaExit) continue
        const sid = pref.sid.toUpperCase()
        if (sid === tmaExit) continue
        altPrefixes.add(sid)
    }
    for (const prefix of altPrefixes) {
        const altRe = new RegExp(`^${escapeRe(prefix)}\\d+[A-Z]+$`, "i")
        for (const name of names) {
            if (!name.includes("?") && altRe.test(name)) out.add(name)
        }
    }

    // 3. ·exit SIDs: radar-vector (KOGAV·ARS) and SLOW tracks (240·ARS) — not HAPZI
    for (const name of names) {
        if (name.includes("?")) continue
        if (!isVectorSidName(name) && !isTrackSidName(name)) continue
        const last = name.toUpperCase().split(TRACK_SEP).filter(Boolean).pop()
        if (last === tmaExit) out.add(name)
    }

    return [...out]
}
