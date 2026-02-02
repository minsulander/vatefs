import type { EfsConfig, FlightStrip, Section, Bay, Gap } from "@vatefs/common"
import { staticConfig } from "./config.js"
import { flightStore } from "./flightStore.js"
import { mockPluginMessages, mockBackendStateUpdates } from "./mockPluginMessages.js"
import type { PluginMessage } from "./types.js"
import { isPluginMessage } from "./types.js"

const GAP_BUFFER = 30 // Minimum pixels to create/maintain a gap

export interface MoveStripResult {
    strip: FlightStrip
    affectedGaps: Gap[]
    deletedGapKeys: string[]
}

export interface SetGapResult {
    gap: Gap | null  // null if gap was deleted
    deleted: boolean
}

function gapKey(bayId: string, sectionId: string, index: number): string {
    return `${bayId}:${sectionId}:${index}`
}

class EfsStore {
    private config: EfsConfig
    private strips: Map<string, FlightStrip>
    private gaps: Map<string, Gap>  // key: bayId:sectionId:index

    constructor() {
        this.config = { bays: [] }
        this.strips = new Map()
        this.gaps = new Map()
    }

    // Initialize store with mock data
    loadMockData() {
        // Load config from static config
        this.config = JSON.parse(JSON.stringify(staticConfig.layout))

        // Clear existing data
        this.strips.clear()
        this.gaps.clear()
        flightStore.clear()

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

        console.log(`Store loaded: ${this.strips.size} strips, ${this.config.bays.length} bays`)
    }

    /**
     * Process a plugin message and return any resulting strip changes
     */
    processPluginMessage(message: PluginMessage): {
        strip?: FlightStrip
        deleteStripId?: string
        sectionChanged?: boolean
        previousSection?: { bayId: string; sectionId: string }
    } {
        const result = flightStore.processMessage(message)

        if (result.deleteStripId) {
            this.strips.delete(result.deleteStripId)
            return { deleteStripId: result.deleteStripId }
        }

        if (result.strip) {
            // If section changed, we need to recompute positions in both old and new sections
            if (result.sectionChanged && result.previousSection) {
                this.recomputePositions(
                    result.previousSection.bayId,
                    result.previousSection.sectionId,
                    false
                )
            }

            this.strips.set(result.strip.id, result.strip)
            return {
                strip: result.strip,
                sectionChanged: result.sectionChanged,
                previousSection: result.previousSection
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

    // Get full config (for sending to clients)
    getConfig(): EfsConfig {
        return this.config
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
        return this.config.bays.find(b => b.id === bayId)
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

    // Set section height - returns the section
    setSectionHeight(bayId: string, sectionId: string, height: number): Section | null {
        const section = this.findSection(bayId, sectionId)
        if (section) {
            section.height = Math.max(80, height)
            return section
        }
        return null
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
