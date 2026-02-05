import type { EfsLayout, FlightStrip, Section, Bay, Gap } from "@vatefs/common"
import { GAP_BUFFER, gapKey } from "@vatefs/common"
import { staticConfig } from "./config.js"
import { flightStore } from "./flightStore.js"
import { mockPluginMessages, mockBackendStateUpdates } from "./mockPluginMessages.js"
import type { PluginMessage } from "./types.js"
import { isPluginMessage } from "./types.js"

/**
 * Compare two strips for equality
 * Returns true if strips are equal (no change needed)
 */
function stripsEqual(a: FlightStrip, b: FlightStrip): boolean {
    return (
        a.id === b.id &&
        a.callsign === b.callsign &&
        a.aircraftType === b.aircraftType &&
        a.wakeTurbulence === b.wakeTurbulence &&
        a.flightRules === b.flightRules &&
        a.adep === b.adep &&
        a.ades === b.ades &&
        a.route === b.route &&
        a.sid === b.sid &&
        a.rfl === b.rfl &&
        a.squawk === b.squawk &&
        a.clearedAltitude === b.clearedAltitude &&
        a.assignedHeading === b.assignedHeading &&
        a.assignedSpeed === b.assignedSpeed &&
        a.eobt === b.eobt &&
        a.eta === b.eta &&
        a.atd === b.atd &&
        a.ata === b.ata &&
        a.stand === b.stand &&
        a.runway === b.runway &&
        a.remarks === b.remarks &&
        a.stripType === b.stripType &&
        a.bayId === b.bayId &&
        a.sectionId === b.sectionId &&
        a.position === b.position &&
        a.bottom === b.bottom &&
        a.defaultAction === b.defaultAction &&
        a.clearedForTakeoff === b.clearedForTakeoff
    )
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

class EfsStore {
    private layout: EfsLayout
    private strips: Map<string, FlightStrip>
    private deletedStrips: Map<string, FlightStrip>  // Soft-deleted strips (hidden but recoverable)
    private gaps: Map<string, Gap>  // key: bayId:sectionId:index

    constructor() {
        this.layout = { bays: [] }
        this.strips = new Map()
        this.deletedStrips = new Map()
        this.gaps = new Map()
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
        deleteStripId?: string
        isNew?: boolean
        sectionChanged?: boolean
        previousSection?: { bayId: string; sectionId: string }
        softDeleted?: boolean
        restored?: boolean
        shiftedStrips?: FlightStrip[]
        shiftedGaps?: Gap[]
        deletedGapKeys?: string[]
    } {
        const result = flightStore.processMessage(message)

        if (result.deleteStripId) {
            this.strips.delete(result.deleteStripId)
            this.deletedStrips.delete(result.deleteStripId)
            return { deleteStripId: result.deleteStripId }
        }

        // Handle soft-delete: move strip to deletedStrips map
        if (result.softDeleted && result.flight) {
            const stripId = result.flight.callsign
            const existingStrip = this.strips.get(stripId)
            if (existingStrip) {
                this.deletedStrips.set(stripId, existingStrip)
                this.strips.delete(stripId)
                return { deleteStripId: stripId, softDeleted: true }
            }
            return { softDeleted: true }
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
            if (!stripChanged && !result.sectionChanged && !result.restored) {
                return {}
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
            // Only shift when it's a NEW strip (not updates to existing strips)
            let shiftedStrips: FlightStrip[] | undefined
            let shiftedGaps: Gap[] | undefined
            let deletedGapKeys: string[] | undefined
            if (isNew && result.shiftedCallsigns && result.shiftedCallsigns.length > 0) {
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
                deletedGapKeys: deletedGapKeys && deletedGapKeys.length > 0 ? deletedGapKeys : undefined
            }
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

    // Get layout (for sending to clients)
    getLayout(): EfsLayout {
        return this.layout
    }

    // Get all strips as array
    getAllStrips(): FlightStrip[] {
        return Array.from(this.strips.values())
    }

    // Get all gaps as array
    getAllGaps(): Gap[] {
        return Array.from(this.gaps.values())
    }

    // Get a single strip
    getStrip(stripId: string): FlightStrip | undefined {
        return this.strips.get(stripId)
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
        flightStore.setStripAssignment(strip.callsign, targetBayId, targetSectionId, position ?? 0, isBottom)

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
     * Manually delete a strip (user-initiated from context menu)
     * Returns the strip ID if successfully deleted, undefined otherwise
     */
    manualDeleteStrip(stripId: string): string | undefined {
        const strip = this.strips.get(stripId)
        if (!strip) return undefined

        // Move strip to deleted store
        this.deletedStrips.set(stripId, strip)
        this.strips.delete(stripId)

        // Mark the flight as manually deleted so it won't be auto-restored
        const flight = flightStore.getFlight(strip.callsign)
        if (flight) {
            flight.deleted = true
            flight.manuallyDeleted = true
        }

        console.log(`Strip ${stripId} manually deleted by user`)
        return stripId
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
    private shiftGapsDown(bayId: string, sectionId: string): { shiftedGaps: Gap[], deletedGapKeys: string[] } {
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
    private recomputePositions(bayId: string, sectionId: string, bottom: boolean) {
        const strips = this.getStripsForSection(bayId, sectionId, bottom)
        strips.forEach((strip, index) => {
            strip.position = index
        })
    }
}

// Singleton instance
export const store = new EfsStore()
