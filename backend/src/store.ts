import type { EfsLayout, FlightStrip, Section, Bay, Gap, DeletedStripInfo } from "@vatefs/common"
import { determineSectionForFlight } from "./config.js"
import { GAP_BUFFER, gapKey } from "@vatefs/common"
import { staticConfig } from "./config.js"
import type { EfsStaticConfig } from "./config-types.js"
import { flightStore } from "./flightStore.js"
import type { ProcessMessageResult } from "./flightStore.js"
import { mockPluginMessages, mockBackendStateUpdates } from "./mockPluginMessages.js"
import type { PluginMessage } from "./types.js"
import { isPluginMessage } from "./types.js"
import { getVisibleLayout, IDLE_BAY_ID, isMultiAirportConfig, resolveBayForAirport, prefixedSectionId } from "./multi-airport.js"
import {
    filterEssaLayout,
    isEssaRolesConfig,
    collectEssaRunwayPairs,
    applyEssaRunwayPairLayout,
    syncEssaRunwaySectionToBay,
    essaRunwayPairsFingerprint,
    activeOnlineTwrRoles,
    remapStripsForEssaGndOnly,
    remapBayIdsToLayout,
} from "./essa-roles.js"

/**
 * Resolve template variables in section titles.
 * Supported variables:
 *   <arwy>  - active arrival runway(s), e.g. "26" or "01L/01R"
 *   <drwy>  - active departure runway(s), e.g. "19R" or "08/19R"
 */
function resolveLayoutTemplates(layout: EfsLayout, config: EfsStaticConfig): EfsLayout {
    // Check if any title contains a template variable (fast path)
    const hasTemplates = layout.bays.some(bay =>
        bay.sections.some(section => section.title.includes('<'))
    )
    if (!hasTemplates) return layout

    // Collect active runways across all airports
    const allArrRunways: string[] = []
    const allDepRunways: string[] = []
    if (config.activeRunways) {
        for (const airport of config.myAirports) {
            const rwy = config.activeRunways[airport]
            if (rwy) {
                allArrRunways.push(...rwy.arr)
                allDepRunways.push(...rwy.dep)
            }
        }
    }

    const arrRwyStr = allArrRunways.join('/') || '??'
    const depRwyStr = allDepRunways.join('/') || '??'

    return {
        bays: layout.bays.map(bay => ({
            ...bay,
            sections: bay.sections.map(section => ({
                ...section,
                title: section.title
                    .replace('<arwy>', arrRwyStr)
                    .replace('<drwy>', depRwyStr)
            }))
        }))
    }
}

const STRIP_COMPARE_FIELDS: Array<keyof FlightStrip> = [
    "id",
    "callsign",
    "rtfCallsign",
    "aircraftType",
    "wakeTurbulence",
    "flightRules",
    "adep",
    "ades",
    "adepName",
    "adesName",
    "route",
    "sid",
    "rfl",
    "squawk",
    "clearedAltitude",
    "assignedHeading",
    "assignedSpeed",
    "eobt",
    "eta",
    "atd",
    "ata",
    "stand",
    "runway",
    "remarks",
    "stripType",
    "bayId",
    "sectionId",
    "position",
    "bottom",
    "canResetSquawk",
    "canEditClearance",
    "direct",
    "clearance",
    "clearedForTakeoff",
    "clearedToLand",
    "dclStatus",
    "dclMessage",
    "dclClearance",
    "noteText",
    "hasMatchingFlight",
    "groundstate",
    // CDM / vIFF — must be compared or TOBT/TSAT/REA-only updates are dropped
    "tobt",
    "tsat",
    "tobtSetBy",
    "asrt",
    "tsac",
    "ctoc",
    "cdmSts",
    "ctot",
    "ctotCancelled",
    "ctotReason",
    // Ownership / transfer — SI and pending handoff must refresh clients
    "isAssumed",
    "ownerSi",
    "ownedByOther",
    "dimmed",
    "transferPending",
    "transferSi",
    "ownerCallsign",
    "ownerFrequency",
    "transferCallsign",
    "transferFrequency",
    "xferFrequency",
    "nextSi",
    "nextSiCallsign",
    // Incoming TopSky ROF
    "rofRequestSi",
    "rofRequestCallsign",
    "rofRequestFrequency",
    "rofFlashUntil",
]

/**
 * Compare two strips for equality
 * Returns true if strips are equal (no change needed)
 */
function stripsEqual(a: FlightStrip, b: FlightStrip): boolean {
    for (const field of STRIP_COMPARE_FIELDS) {
        if (a[field] !== b[field]) {
            return false
        }
    }
    return actionsEqual(a.actions, b.actions)
}

function actionsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
    if (a === b) return true
    if (!a || !b) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false
    }
    return true
}

export interface MoveStripResult {
    strip: FlightStrip
    affectedGaps: Gap[]
    deletedGapKeys: string[]
}

export interface SetGapResult {
    gap: Gap | null  // null if gap was deleted
    deleted: boolean
}

type DeletedStripEntry = {
    strip: FlightStrip
    deletedAt: number
    reason?: string
}

class EfsStore {
    private layout: EfsLayout
    private strips: Map<string, FlightStrip>
    private deletedStrips: Map<string, DeletedStripEntry>  // Soft-deleted (trash recovery)
    private gaps: Map<string, Gap>  // key: bayId:sectionId:index

    constructor() {
        this.layout = { bays: [] }
        this.strips = new Map()
        this.deletedStrips = new Map()
        this.gaps = new Map()
    }

    private stashDeletedStrip(strip: FlightStrip, reason?: string) {
        this.deletedStrips.set(strip.id, {
            strip: { ...strip },
            deletedAt: Date.now(),
            reason,
        })
    }

    /**
     * Soft-delete active strips for a callsign into trash (e.g. Auto PARK → delete_parked).
     * Returns the strip ids removed.
     */
    softDeleteCallsignToTrash(callsign: string, reason?: string): string[] {
        const matches = [...this.strips.values()].filter((s) => s.callsign === callsign)
        const ids: string[] = []
        for (const strip of matches) {
            this.stashDeletedStrip(strip, reason)
            this.strips.delete(strip.id)
            ids.push(strip.id)
        }
        return ids
    }

    // Initialize store, optionally with mock data
    loadMockData(useMocks: boolean = false) {
        // Load layout from static config
        this.layout = JSON.parse(JSON.stringify(staticConfig.layout))

        // Clear existing data
        this.strips.clear()
        this.deletedStrips.clear()
        this.gaps.clear()
        flightStore.clear()

        if (useMocks) {
            // Process mock plugin messages through the flight store
            for (const message of mockPluginMessages) {
                const result = flightStore.processMessage(message)
                if (result.strip) {
                    this.strips.set(result.strip.id, result.strip)
                }
                // Regenerate shifted strips so their positions stay in sync
                if (result.shiftedCallsigns) {
                    for (const callsign of result.shiftedCallsigns) {
                        const shifted = flightStore.regenerateStrip(callsign)
                        if (shifted) {
                            this.strips.set(shifted.id, shifted)
                        }
                    }
                }
            }

            // Apply backend state updates (clearedToLand, airborne flags)
            for (const update of mockBackendStateUpdates) {
                const result = flightStore.setBackendFlags(update.callsign, {
                    clearedToLand: update.clearedToLand,
                    airborne: update.airborne
                })
                if (result.strip) {
                    this.strips.set(result.strip.id, result.strip)
                }
            }

            console.log(`Store loaded with mock data: ${this.strips.size} strips, ${this.layout.bays.length} bays`)
        } else {
            console.log(`Store initialized: ${this.layout.bays.length} bays (no mock data)`)
        }
    }

    /**
     * Process a plugin message and return any resulting strip changes
     */
    processPluginMessage(message: PluginMessage): {
        strip?: FlightStrip
        strips?: FlightStrip[]
        deleteStripId?: string
        deletedStripIds?: string[]
        isNew?: boolean
        sectionChanged?: boolean
        previousSection?: { bayId: string; sectionId: string }
        softDeleted?: boolean
        restored?: boolean
        shiftedStrips?: FlightStrip[]
        shiftedGaps?: Gap[]
        deletedGapKeys?: string[]
        setScratchValue?: string
        clearScratchpadCallsign?: string
        clearScratchpadDelayMs?: number
        transferSound?: ProcessMessageResult['transferSound']
        multiUpdates?: ProcessMessageResult['multiUpdates']
    } {
        const result = flightStore.processMessage(message)
        const transferSound = result.transferSound
        const scratchClear = {
            clearScratchpadCallsign: result.clearScratchpadCallsign,
            clearScratchpadDelayMs: result.clearScratchpadDelayMs,
        }

        // Multi-airport: apply each update
        if (result.multiUpdates && result.multiUpdates.length > 0) {
            const strips: FlightStrip[] = []
            const deletedStripIds: string[] = []
            let shiftedStrips: FlightStrip[] | undefined
            let shiftedGaps: Gap[] | undefined
            let deletedGapKeys: string[] | undefined

            for (const update of result.multiUpdates) {
                if (update.deleteStripId) {
                    const existing = this.strips.get(update.deleteStripId)
                    if (existing && update.softDeleted) {
                        const flight = flightStore.getFlight(existing.callsign)
                        this.stashDeletedStrip(existing, flight?.lastDeleteRule)
                    } else {
                        this.deletedStrips.delete(update.deleteStripId)
                    }
                    this.strips.delete(update.deleteStripId)
                    deletedStripIds.push(update.deleteStripId)
                    continue
                }
                if (!update.strip) continue

                if (update.sectionChanged && update.previousSection) {
                    this.recomputePositions(
                        update.previousSection.bayId,
                        update.previousSection.sectionId,
                        false
                    )
                }

                this.strips.set(update.strip.id, update.strip)
                strips.push(update.strip)

                if ((update.isNew || update.sectionChanged) && update.shiftedCallsigns && update.shiftedCallsigns.length > 0) {
                    if (!shiftedStrips) shiftedStrips = []
                    for (const sid of update.shiftedCallsigns) {
                        const regeneratedStrip = flightStore.regenerateStrip(sid)
                        if (regeneratedStrip) {
                            this.strips.set(regeneratedStrip.id, regeneratedStrip)
                            shiftedStrips.push(regeneratedStrip)
                        }
                    }
                    const gapResult = this.shiftGapsDown(update.strip.bayId, update.strip.sectionId)
                    shiftedGaps = [...(shiftedGaps ?? []), ...gapResult.shiftedGaps]
                    deletedGapKeys = [...(deletedGapKeys ?? []), ...gapResult.deletedGapKeys]
                }
            }

            return {
                strip: strips[0],
                strips: strips.length ? strips : undefined,
                deletedStripIds: deletedStripIds.length ? deletedStripIds : undefined,
                deleteStripId: deletedStripIds[0],
                softDeleted: deletedStripIds.length > 0,
                shiftedStrips,
                shiftedGaps: shiftedGaps && shiftedGaps.length > 0 ? shiftedGaps : undefined,
                deletedGapKeys: deletedGapKeys && deletedGapKeys.length > 0 ? deletedGapKeys : undefined,
                setScratchValue: result.setScratchValue,
                ...scratchClear,
                transferSound,
                multiUpdates: result.multiUpdates
            }
        }

        // Batch strip updates (CDM local file poll) — not already handled via multiUpdates
        if (result.strips && result.strips.length > 0 && !result.strip) {
            const changed: FlightStrip[] = []
            for (const strip of result.strips) {
                const existing = this.strips.get(strip.id)
                if (!existing || !stripsEqual(existing, strip)) {
                    this.strips.set(strip.id, strip)
                    changed.push(strip)
                }
            }
            return changed.length > 0
                ? { strips: changed, transferSound, ...scratchClear }
                : { transferSound, ...scratchClear }
        }

        if (result.deleteStripId && !result.softDeleted) {
            this.strips.delete(result.deleteStripId)
            this.deletedStrips.delete(result.deleteStripId)
            return { deleteStripId: result.deleteStripId, transferSound, ...scratchClear }
        }

        if (result.deletedStripIds && result.deletedStripIds.length > 0 && !result.softDeleted) {
            for (const id of result.deletedStripIds) {
                this.strips.delete(id)
                this.deletedStrips.delete(id)
            }
            return {
                deletedStripIds: result.deletedStripIds,
                deleteStripId: result.deletedStripIds[0],
                transferSound,
                ...scratchClear,
            }
        }

        // Handle soft-delete: move strip to deletedStrips map (trash)
        if (result.softDeleted) {
            const reason = result.flight?.lastDeleteRule
            const ids =
                result.deletedStripIds ??
                (result.deleteStripId ? [result.deleteStripId] : [])
            // Prefer explicit ids; else match by callsign (single-airport)
            if (ids.length > 0) {
                for (const stripId of ids) {
                    const existingStrip = this.strips.get(stripId)
                    if (existingStrip) this.stashDeletedStrip(existingStrip, reason)
                    this.strips.delete(stripId)
                }
                return {
                    deletedStripIds: ids,
                    deleteStripId: ids[0],
                    softDeleted: true,
                    transferSound,
                    ...scratchClear,
                }
            }
            if (result.flight) {
                const callsign = result.flight.callsign
                const matches = [...this.strips.values()].filter((s) => s.callsign === callsign)
                for (const existingStrip of matches) {
                    this.stashDeletedStrip(existingStrip, reason)
                    this.strips.delete(existingStrip.id)
                }
                if (matches.length > 0) {
                    return {
                        deletedStripIds: matches.map((s) => s.id),
                        deleteStripId: matches[0]!.id,
                        softDeleted: true,
                        transferSound,
                        ...scratchClear,
                    }
                }
            }
            return { softDeleted: true, transferSound, ...scratchClear }
        }

        // Handle restore: move strip back from deletedStrips
        if (result.restored && result.strip) {
            this.deletedStrips.delete(result.strip.id)
        }

        if (result.strip) {
            const existingStrip = this.strips.get(result.strip.id)
            const isNew = !existingStrip

            // Check if anything actually changed
            const stripChanged = isNew || !stripsEqual(existingStrip, result.strip)

            // If nothing changed and no section change, skip the update
            // (still forward scratch clears — e.g. consumed /ROF/ with no strip field change)
            if (!stripChanged && !result.sectionChanged && !result.restored) {
                if (transferSound || scratchClear.clearScratchpadCallsign) {
                    return { transferSound, ...scratchClear }
                }
                return {}
            }

            // Log which fields changed for non-trivial updates (helps trace misbehavior to code)
            if (!isNew && !result.sectionChanged && !result.restored && stripChanged && existingStrip) {
                const changed: string[] = STRIP_COMPARE_FIELDS.filter(f => existingStrip[f] !== result.strip![f])
                if (!actionsEqual(existingStrip.actions, result.strip.actions)) changed.push('actions')
                if (changed.length > 0) console.log(`Strip ${result.strip.callsign} fields: ${changed.join(', ')}`)
            }

            // If section changed, we need to recompute positions in both old and new sections
            if (result.sectionChanged && result.previousSection) {
                this.recomputePositions(
                    result.previousSection.bayId,
                    result.previousSection.sectionId,
                    false
                )
            }

            this.strips.set(result.strip.id, result.strip)

            // Handle shifted strips and gaps (from add-from-top)
            // Shift when a strip enters a section: either new or moved from another section
            let shiftedStrips: FlightStrip[] | undefined
            let shiftedGaps: Gap[] | undefined
            let deletedGapKeys: string[] | undefined
            if ((isNew || result.sectionChanged) && result.shiftedCallsigns && result.shiftedCallsigns.length > 0) {
                shiftedStrips = []
                for (const callsign of result.shiftedCallsigns) {
                    const regeneratedStrip = flightStore.regenerateStrip(callsign)
                    if (regeneratedStrip) {
                        this.strips.set(regeneratedStrip.id, regeneratedStrip)
                        shiftedStrips.push(regeneratedStrip)
                    }
                }

                // Also shift gaps in the section
                const gapResult = this.shiftGapsDown(result.strip.bayId, result.strip.sectionId)
                shiftedGaps = gapResult.shiftedGaps
                deletedGapKeys = gapResult.deletedGapKeys
            }

            return {
                strip: result.strip,
                isNew,
                sectionChanged: result.sectionChanged,
                previousSection: result.previousSection,
                restored: result.restored,
                shiftedStrips,
                shiftedGaps: shiftedGaps && shiftedGaps.length > 0 ? shiftedGaps : undefined,
                deletedGapKeys: deletedGapKeys && deletedGapKeys.length > 0 ? deletedGapKeys : undefined,
                setScratchValue: result.setScratchValue,
                ...scratchClear,
                transferSound
            }
        }

        if (transferSound || scratchClear.clearScratchpadCallsign) {
            return { transferSound, ...scratchClear }
        }
        return {}
    }

    /**
     * Check if data is a plugin message and process it
     */
    tryProcessPluginMessage(data: unknown): ReturnType<typeof this.processPluginMessage> | null {
        if (isPluginMessage(data)) {
            return this.processPluginMessage(data)
        }
        return null
    }

    // Get layout (for sending to clients), with section title templates resolved
    getLayout(): EfsLayout {
        // ESSA role mode: always use config bay structure so role filtering
        // cannot resurrect a stale combined bay from the store cache.
        const base = isMultiAirportConfig(staticConfig)
            ? getVisibleLayout(staticConfig)
            : isEssaRolesConfig(staticConfig)
              ? staticConfig.layout
              : this.layout
        // Prefer store layout for section heights, but drop idle bay
        let withHeights: EfsLayout = {
            bays: base.bays.map(bay => {
                const storeBay = this.layout.bays.find(b => b.id === bay.id)
                if (!storeBay) return bay
                return {
                    ...bay,
                    title: bay.title ?? storeBay.title,
                    airport: bay.airport ?? storeBay.airport,
                    sections: bay.sections.map(section => {
                        const storeSection = storeBay.sections.find(s => s.id === section.id)
                        return storeSection ? { ...section, height: storeSection.height } : section
                    })
                }
            }).filter(b => b.id !== IDLE_BAY_ID)
        }

        if (isEssaRolesConfig(staticConfig)) {
            const onlineCallsigns = staticConfig.onlineControllers
                ? [...staticConfig.onlineControllers.keys()]
                : []
            const activeTwr = activeOnlineTwrRoles(onlineCallsigns)
            withHeights = filterEssaLayout(
                withHeights,
                staticConfig.essaRoles ?? [],
                staticConfig.sectionVisibleFor,
                activeTwr
            )
            const placements = collectEssaRunwayPairs(
                staticConfig.activeRunways,
                staticConfig.myAirports,
                staticConfig.essaAssignedRunways
            )
            const { layout: rwyLayout, sectionToBay: rwySectionToBay } =
                applyEssaRunwayPairLayout(withHeights, placements)
            withHeights = rwyLayout
            syncEssaRunwaySectionToBay(staticConfig.sectionToBay, rwySectionToBay)
            staticConfig.essaRunwayLayoutFingerprint = essaRunwayPairsFingerprint(placements)
        }

        return resolveLayoutTemplates(withHeights, staticConfig)
    }

    // Get all strips as array
    getAllStrips(): FlightStrip[] {
        const strips = Array.from(this.strips.values())
        if (!isEssaRolesConfig(staticConfig)) return strips
        const remapped = remapStripsForEssaGndOnly(
            strips,
            staticConfig.essaRoles ?? [],
            staticConfig.sectionToBay
        )
        // Align bayIds after CD ALL+TSAT column merge (max 4 columns)
        return remapBayIdsToLayout(remapped, this.getLayout())
    }

    // Get all gaps as array
    getAllGaps(): Gap[] {
        const gaps = Array.from(this.gaps.values())
        if (!isEssaRolesConfig(staticConfig)) return gaps
        return remapBayIdsToLayout(gaps, this.getLayout())
    }

    // Get a single strip
    getStrip(stripId: string): FlightStrip | undefined {
        return this.strips.get(stripId)
    }

    // Update a strip (used when backend flags change)
    updateStripFromFlight(strip: FlightStrip): void {
        this.strips.set(strip.id, strip)
    }

    // Get strips for a specific section and zone
    getStripsForSection(bayId: string, sectionId: string, bottom: boolean): FlightStrip[] {
        const result: FlightStrip[] = []
        this.strips.forEach(strip => {
            if (strip.bayId === bayId && strip.sectionId === sectionId && strip.bottom === bottom) {
                result.push(strip)
            }
        })
        return result.sort((a, b) => a.position - b.position)
    }

    // Get gaps for a specific section
    getGapsForSection(bayId: string, sectionId: string): Gap[] {
        const result: Gap[] = []
        this.gaps.forEach(gap => {
            if (gap.bayId === bayId && gap.sectionId === sectionId) {
                result.push(gap)
            }
        })
        return result.sort((a, b) => a.index - b.index)
    }

    // Find a bay by ID
    private findBay(bayId: string): Bay | undefined {
        return this.layout.bays.find(b => b.id === bayId)
    }

    // Find a section by bay and section ID
    private findSection(bayId: string, sectionId: string): Section | undefined {
        const bay = this.findBay(bayId)
        return bay?.sections.find(s => s.id === sectionId)
    }

    // Move a strip to a section (top or bottom)
    moveStrip(
        stripId: string,
        targetBayId: string,
        targetSectionId: string,
        position?: number,
        isBottom: boolean = false
    ): MoveStripResult | null {
        const strip = this.strips.get(stripId)
        if (!strip) return null

        // Notify flight store about manual move (prevents auto-move back)
        flightStore.setStripAssignment(strip.id, targetBayId, targetSectionId, position ?? 0, isBottom)

        const oldBayId = strip.bayId
        const oldSectionId = strip.sectionId
        const oldBottom = strip.bottom
        const oldPosition = strip.position

        const isSameSection = oldBayId === targetBayId && oldSectionId === targetSectionId
        const isSameZone = isSameSection && oldBottom === isBottom

        // Get current strips in target zone (excluding the moving strip if same section)
        const targetStrips = this.getStripsForSection(targetBayId, targetSectionId, isBottom)
            .filter(s => s.id !== stripId)

        // Calculate target position
        const targetPosition = (position !== undefined && position >= 0 && position <= targetStrips.length)
            ? position
            : targetStrips.length

        // Track affected gaps and deleted gap keys
        const affectedGaps: Gap[] = []
        const deletedGapKeys: string[] = []

        // Handle gap adjustments for same-zone moves (top to top only, gaps don't exist for bottom)
        if (isSameZone && !isBottom) {
            const gapResult = this.adjustGapsForMove(targetBayId, targetSectionId, oldPosition, targetPosition)
            affectedGaps.push(...gapResult.affected)
            deletedGapKeys.push(...gapResult.deleted)
        }

        // Update strip metadata
        strip.bayId = targetBayId
        strip.sectionId = targetSectionId
        strip.bottom = isBottom

        // Insert strip at target position and recompute all positions
        // targetStrips is already sorted and excludes the moving strip
        targetStrips.splice(targetPosition, 0, strip)
        targetStrips.forEach((s, index) => {
            s.position = index
        })

        // If moved to different section/zone, recompute old section too
        if (!isSameZone) {
            this.recomputePositions(oldBayId, oldSectionId, oldBottom)
        }

        // Cleanup gaps (only for top zone)
        if (!isBottom) {
            const cleanupResult = this.cleanupGaps(targetBayId, targetSectionId)
            deletedGapKeys.push(...cleanupResult)
        }
        if (!isSameSection && !oldBottom) {
            const cleanupResult = this.cleanupGaps(oldBayId, oldSectionId)
            deletedGapKeys.push(...cleanupResult)
        }

        return { strip, affectedGaps, deletedGapKeys }
    }

    // Set a gap at an index - returns the gap or null if deleted
    setGap(bayId: string, sectionId: string, index: number, gapSize: number): SetGapResult {
        const key = gapKey(bayId, sectionId, index)

        if (gapSize >= GAP_BUFFER) {
            const gap: Gap = { bayId, sectionId, index, size: gapSize }
            this.gaps.set(key, gap)
            return { gap, deleted: false }
        } else {
            this.gaps.delete(key)
            return { gap: null, deleted: true }
        }
    }

    // Get a gap
    getGap(bayId: string, sectionId: string, index: number): Gap | undefined {
        return this.gaps.get(gapKey(bayId, sectionId, index))
    }

    // Set section height - returns section and whether it changed
    setSectionHeight(bayId: string, sectionId: string, height: number): { section: Section; changed: boolean } | null {
        const section = this.findSection(bayId, sectionId)
        if (!section) return null

        const newHeight = Math.max(80, Math.round(height))
        const oldHeight = section.height ?? 0
        const changed = Math.abs(newHeight - oldHeight) >= 3 // 3px threshold

        if (changed) {
            section.height = newHeight
        }

        return { section, changed }
    }

    // Clear all data (called on refresh/reconnect)
    clear() {
        this.strips.clear()
        this.deletedStrips.clear()
        this.gaps.clear()
        flightStore.clear()
        // Reload layout from config
        this.layout = JSON.parse(JSON.stringify(staticConfig.layout))
        console.log('Store cleared')
    }

    /**
     * Re-process all flights with current rules (used after config switch).
     * Clears strips/gaps and re-evaluates all flights, keeping flight data intact.
     */
    reprocessAllFlights() {
        this.strips.clear()
        this.deletedStrips.clear()
        this.gaps.clear()
        // Reload layout from new config
        this.layout = JSON.parse(JSON.stringify(staticConfig.layout))

        // Clear assignments so flights re-evaluate
        flightStore.clearAssignments()

        // Re-process all flights through new rules
        const results = flightStore.reprocessAll()
        for (const { strip, softDeleted } of results) {
            if (!softDeleted) {
                this.strips.set(strip.id, strip)
            }
        }

        console.log(`Reprocessed all flights: ${this.strips.size} strips placed`)
    }

    /**
     * Sync layout from staticConfig without clearing strips (multi-airport column changes).
     * Preserves user-resized section heights per bay/section id.
     */
    syncLayoutFromConfig() {
        const heightBySection = new Map<string, number>()
        for (const bay of this.layout.bays) {
            for (const section of bay.sections) {
                if (section.height !== undefined) {
                    heightBySection.set(`${bay.id}:${section.id}`, section.height)
                }
            }
        }

        this.layout = JSON.parse(JSON.stringify(staticConfig.layout))

        for (const bay of this.layout.bays) {
            for (const section of bay.sections) {
                const h = heightBySection.get(`${bay.id}:${section.id}`)
                if (h !== undefined) {
                    section.height = h
                }
            }
        }
    }

    /**
     * Create a note strip (no associated flight, just text).
     * Returns the created strip.
     */
    createNoteStrip(
        targetBayId?: string,
        targetSectionId?: string,
        position?: number,
        isBottom?: boolean,
        airport?: string
    ): FlightStrip | undefined {
        const stripId = `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const icao = airport?.toUpperCase()

        // Determine bay/section
        let bayId: string
        let sectionId: string
        let pos: number

        if (targetBayId && targetSectionId) {
            bayId = targetBayId
            sectionId = targetSectionId
            pos = position ?? 0
        } else if (icao && isMultiAirportConfig(staticConfig)) {
            bayId = resolveBayForAirport(icao, staticConfig.columnAirports)
            sectionId = prefixedSectionId(bayId, 'app')
            pos = position ?? 0
        } else if (staticConfig.layout.bays.length > 0 && staticConfig.layout.bays[0].sections.length > 0) {
            bayId = staticConfig.layout.bays[0].id
            sectionId = staticConfig.layout.bays[0].sections[0].id
            pos = 0
        } else {
            return undefined
        }

        const strip: FlightStrip = {
            id: stripId,
            callsign: '',
            aircraftType: '',
            wakeTurbulence: 'M',
            flightRules: 'V',
            adep: '',
            ades: '',
            stripType: 'note',
            bayId,
            sectionId,
            position: pos,
            bottom: isBottom ?? false,
            noteText: '',
            airport: icao,
        }

        this.strips.set(stripId, strip)
        return strip
    }

    /**
     * Update note text on a note strip.
     * Returns the updated strip, or undefined if not found.
     */
    updateNoteText(stripId: string, text: string): FlightStrip | undefined {
        const strip = this.strips.get(stripId)
        if (!strip || strip.stripType !== 'note') return undefined
        strip.noteText = text
        return strip
    }

    /**
     * Manually delete a strip (user-initiated from context menu)
     * Returns the strip ID if successfully deleted, undefined otherwise
     */
    manualDeleteStrip(stripId: string): string | undefined {
        const strip = this.strips.get(stripId)
        if (!strip) return undefined

        // Mark the flight as manually deleted so it won't be auto-restored
        const flight = flightStore.getFlight(strip.callsign)
        if (flight) {
            flight.deleted = true
            flight.manuallyDeleted = true
            flight.lastDeleteRule = 'manual'
        }

        this.stashDeletedStrip(strip, 'manual')
        this.strips.delete(stripId)

        console.log(`Strip ${stripId} manually deleted by user`)
        return stripId
    }

    /** List soft-deleted strips for trash recovery UI (newest first). */
    getDeletedStripInfos(): DeletedStripInfo[] {
        return [...this.deletedStrips.values()]
            .map(({ strip, deletedAt, reason }) => ({
                stripId: strip.id,
                callsign: strip.callsign || (strip.stripType === 'note' ? '(note)' : strip.id),
                stripType: strip.stripType,
                adep: strip.adep,
                ades: strip.ades,
                aircraftType: strip.aircraftType,
                sectionId: strip.sectionId,
                bayId: strip.bayId,
                noteText: strip.noteText,
                deletedAt,
                reason,
            }))
            .sort((a, b) => b.deletedAt - a.deletedAt)
    }

    /**
     * Restore a soft-deleted strip from the trash.
     * Clears deleted flags and recreates the strip in the rule-chosen (or previous) section.
     * If the flight was PARK'd (delete_parked), clears PARK so delete rules don't hide it again.
     */
    restoreDeletedStrip(stripId: string): { strip: FlightStrip; clearedPark: boolean } | undefined {
        const entry = this.deletedStrips.get(stripId)
        if (!entry) return undefined
        const saved = entry.strip
        this.deletedStrips.delete(stripId)

        let clearedPark = false
        const flight = flightStore.getFlight(saved.callsign)
        if (flight) {
            flight.deleted = false
            flight.manuallyDeleted = false
            flight.deletedByBeyondRange = false
            flight.lastDeleteRule = undefined
            flight.noSectionFound = false
            // Restoring a PARK'd strip must clear PARK or delete_parked hides it immediately
            if (flight.groundstate === 'PARK') {
                flight.groundstate = ''
                clearedPark = true
            }
        }

        // Prefer current section rules; fall back to where it was deleted from
        let bayId = saved.bayId
        let sectionId = saved.sectionId
        if (flight) {
            const target = determineSectionForFlight(flight, staticConfig)
            if (target) {
                bayId = target.bayId
                sectionId = target.sectionId
            }
        }

        // Insert at top of section (shift others down)
        const sectionStrips = this.getStripsForSection(bayId, sectionId, false)
            .filter((s) => s.id !== saved.id)
            .sort((a, b) => a.position - b.position)
        for (const s of sectionStrips) {
            s.position += 1
            this.strips.set(s.id, s)
            flightStore.setStripAssignment(s.id, {
                bayId,
                sectionId,
                position: s.position,
                bottom: false,
            })
        }

        // Notes / unmatched specials: restore snapshot
        if (saved.stripType === 'note' || !flight) {
            const restored: FlightStrip = {
                ...saved,
                bayId,
                sectionId,
                position: 0,
                bottom: false,
                actions: undefined,
            }
            this.strips.set(restored.id, restored)
            console.log(`Strip ${stripId} restored from trash → ${sectionId}`)
            return { strip: restored, clearedPark }
        }

        const restored = flightStore.restoreStripToSection(saved.id, flight, bayId, sectionId, 0)
        if (restored) {
            this.strips.set(restored.id, restored)
            console.log(
                `Strip ${restored.id} restored from trash → ${sectionId}` +
                    (clearedPark ? ' (cleared PARK)' : '')
            )
            return { strip: restored, clearedPark }
        }

        // Fallback: put saved strip back
        const fallback: FlightStrip = {
            ...saved,
            bayId,
            sectionId,
            position: 0,
            bottom: false,
        }
        this.strips.set(fallback.id, fallback)
        console.log(`Strip ${stripId} restored from trash (snapshot) → ${sectionId}`)
        return { strip: fallback, clearedPark }
    }

    // Clean up trailing gaps - returns deleted keys
    private cleanupGaps(bayId: string, sectionId: string): string[] {
        const strips = this.getStripsForSection(bayId, sectionId, false)
        const stripCount = strips.length
        const deletedKeys: string[] = []

        this.gaps.forEach((gap, key) => {
            if (gap.bayId === bayId && gap.sectionId === sectionId && gap.index >= stripCount) {
                this.gaps.delete(key)
                deletedKeys.push(key)
            }
        })

        return deletedKeys
    }

    // Adjust gap indices when strips are moved - returns affected and deleted gaps
    private adjustGapsForMove(
        bayId: string,
        sectionId: string,
        fromIndex: number,
        toIndex: number
    ): { affected: Gap[], deleted: string[] } {
        const sectionGaps = this.getGapsForSection(bayId, sectionId)
        const affected: Gap[] = []
        const deleted: string[] = []

        // Calculate new indices
        const updates: { oldKey: string, gap: Gap, newIndex: number }[] = []

        sectionGaps.forEach(gap => {
            let newIndex = gap.index

            if (fromIndex < toIndex) {
                // Moving down
                if (gap.index > fromIndex && gap.index <= toIndex) {
                    newIndex = gap.index - 1
                }
            } else {
                // Moving up
                if (gap.index >= toIndex && gap.index < fromIndex) {
                    newIndex = gap.index + 1
                }
            }

            if (newIndex !== gap.index) {
                updates.push({
                    oldKey: gapKey(bayId, sectionId, gap.index),
                    gap,
                    newIndex
                })
            }
        })

        // Apply updates
        updates.forEach(({ oldKey, gap, newIndex }) => {
            this.gaps.delete(oldKey)
            deleted.push(oldKey)

            const newGap: Gap = { ...gap, index: newIndex }
            const newKey = gapKey(bayId, sectionId, newIndex)
            this.gaps.set(newKey, newGap)
            affected.push(newGap)
        })

        return { affected, deleted }
    }

    // Shift all gap indices in a section down by 1 (for add-from-top)
    // Returns the new gaps and the keys of deleted gaps (for client notification)
    shiftGapsDown(bayId: string, sectionId: string): { shiftedGaps: Gap[], deletedGapKeys: string[] } {
        const sectionGaps = this.getGapsForSection(bayId, sectionId)
        const shiftedGaps: Gap[] = []
        const deletedGapKeys: string[] = []

        // Collect gaps to update (we need to delete old keys and create new ones)
        const updates: { oldKey: string, gap: Gap }[] = []

        sectionGaps.forEach(gap => {
            updates.push({
                oldKey: gapKey(bayId, sectionId, gap.index),
                gap
            })
        })

        // Apply updates: delete old keys, create new gaps with incremented indices
        updates.forEach(({ oldKey, gap }) => {
            this.gaps.delete(oldKey)
            deletedGapKeys.push(oldKey)

            const newGap: Gap = { ...gap, index: gap.index + 1 }
            const newKey = gapKey(bayId, sectionId, newGap.index)
            this.gaps.set(newKey, newGap)
            shiftedGaps.push(newGap)
        })

        return { shiftedGaps, deletedGapKeys }
    }

    // Recompute strip positions
    recomputePositions(bayId: string, sectionId: string, bottom: boolean) {
        const strips = this.getStripsForSection(bayId, sectionId, bottom)
        strips.forEach((strip, index) => {
            strip.position = index
        })
    }
}

// Singleton instance
export const store = new EfsStore()
