import type { EfsConfig, FlightStrip, Section, Bay } from "@vatefs/common"
import { mockConfig, mockStrips } from "./mockData.js"

const GAP_BUFFER = 30 // Minimum pixels to create/maintain a gap

class EfsStore {
    private config: EfsConfig
    private strips: Map<string, FlightStrip>

    constructor() {
        this.config = { bays: [] }
        this.strips = new Map()
    }

    // Initialize store with mock data
    loadMockData() {
        // Deep clone config to avoid mutations to original
        this.config = JSON.parse(JSON.stringify(mockConfig))

        // Load strips and populate section stripIds
        mockStrips.forEach(strip => {
            this.strips.set(strip.id, { ...strip })

            // Add strip to appropriate section
            const section = this.findSection(strip.bayId, strip.sectionId)
            if (section && !section.stripIds.includes(strip.id)) {
                section.stripIds.push(strip.id)
            }
        })

        console.log(`Store loaded: ${this.strips.size} strips, ${this.config.bays.length} bays`)
    }

    // Get full config (for sending to clients)
    getConfig(): EfsConfig {
        return this.config
    }

    // Get all strips as array
    getAllStrips(): FlightStrip[] {
        return Array.from(this.strips.values())
    }

    // Get a single strip
    getStrip(stripId: string): FlightStrip | undefined {
        return this.strips.get(stripId)
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
    ): boolean {
        const strip = this.strips.get(stripId)
        if (!strip) return false

        const oldBayId = strip.bayId
        const oldSectionId = strip.sectionId

        // Find old section
        const oldSection = this.findSection(oldBayId, oldSectionId)

        // Find old position and whether it was in bottom
        let oldPosition = -1
        let wasBottom = false
        if (oldSection) {
            oldPosition = oldSection.stripIds.indexOf(stripId)
            if (oldPosition === -1) {
                oldPosition = oldSection.bottomStripIds.indexOf(stripId)
                wasBottom = oldPosition !== -1
            }
        }

        const isSameSection = oldBayId === targetBayId && oldSectionId === targetSectionId

        // Remove from old section
        if (oldSection) {
            oldSection.stripIds = oldSection.stripIds.filter(id => id !== stripId)
            oldSection.bottomStripIds = oldSection.bottomStripIds.filter(id => id !== stripId)
        }

        // Update strip metadata
        strip.bayId = targetBayId
        strip.sectionId = targetSectionId

        // Add to target section
        const targetSection = this.findSection(targetBayId, targetSectionId)
        if (targetSection) {
            const targetList = isBottom ? targetSection.bottomStripIds : targetSection.stripIds
            if (position !== undefined && position >= 0 && position <= targetList.length) {
                targetList.splice(position, 0, stripId)
            } else {
                targetList.push(stripId)
            }
        }

        // Handle gaps for same-section moves (top to top only)
        if (isSameSection && !wasBottom && !isBottom && oldPosition !== -1 && position !== undefined) {
            this.adjustGapsForMove(targetBayId, targetSectionId, oldPosition, position)
        }

        // Cleanup gaps
        if (isSameSection) {
            this.cleanupGaps(targetBayId, targetSectionId)
        } else {
            this.cleanupGaps(oldBayId, oldSectionId)
            this.cleanupGaps(targetBayId, targetSectionId)
        }

        // Recompute positions
        this.recomputePositions(targetBayId, targetSectionId)
        if (!isSameSection) {
            this.recomputePositions(oldBayId, oldSectionId)
        }

        return true
    }

    // Set a gap at an index
    setGap(bayId: string, sectionId: string, index: number, gapSize: number) {
        const section = this.findSection(bayId, sectionId)
        if (!section) return

        if (gapSize >= GAP_BUFFER) {
            section.gaps[index] = gapSize
        } else {
            delete section.gaps[index]
        }
    }

    // Set section height
    setSectionHeight(bayId: string, sectionId: string, height: number) {
        const section = this.findSection(bayId, sectionId)
        if (section) {
            section.height = Math.max(80, height)
        }
    }

    // Clean up trailing gaps
    private cleanupGaps(bayId: string, sectionId: string) {
        const section = this.findSection(bayId, sectionId)
        if (!section) return

        const stripCount = section.stripIds.length
        Object.keys(section.gaps).forEach(key => {
            const idx = parseInt(key)
            if (idx >= stripCount) {
                delete section.gaps[idx]
            }
        })
    }

    // Adjust gap indices when strips are moved
    private adjustGapsForMove(bayId: string, sectionId: string, fromIndex: number, toIndex: number) {
        const section = this.findSection(bayId, sectionId)
        if (!section) return

        const newGaps: Record<number, number> = {}

        Object.entries(section.gaps).forEach(([key, value]) => {
            let idx = parseInt(key)

            if (fromIndex < toIndex) {
                // Moving down
                if (idx > fromIndex && idx <= toIndex) {
                    idx -= 1
                }
            } else {
                // Moving up
                if (idx >= toIndex && idx < fromIndex) {
                    idx += 1
                }
            }

            newGaps[idx] = value
        })

        section.gaps = newGaps
        this.cleanupGaps(bayId, sectionId)
    }

    // Recompute strip positions
    private recomputePositions(bayId: string, sectionId: string) {
        const section = this.findSection(bayId, sectionId)
        if (!section) return

        section.stripIds.forEach((stripId, index) => {
            const strip = this.strips.get(stripId)
            if (strip) {
                strip.position = index
            }
        })
    }
}

// Singleton instance
export const store = new EfsStore()
