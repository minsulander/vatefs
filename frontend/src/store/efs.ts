import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { FlightStrip, EfsConfig, ServerMessage, ClientMessage } from "@vatefs/common"
import { isServerMessage } from "@vatefs/common"

export const useEfsStore = defineStore("efs", () => {

    let socket: WebSocket | undefined = undefined

    const connected = ref(false)
    const config = ref<EfsConfig>({ bays: [] })
    const strips = ref<Map<string, FlightStrip>>(new Map())

    function connect() {
        if (connected.value && socket?.readyState == WebSocket.OPEN) return
        socket = new WebSocket(`ws://${location.hostname}:17770`)
        ;(window as any).socket = socket
        if (socket.readyState == WebSocket.OPEN) {
            console.log("socket open at mounted")
            requestData()
            connected.value = true
        }
        socket.onopen = () => {
            console.log("socket opened")
            requestData()
            connected.value = true
        }
        socket.onclose = () => {
            console.log("socket closed")
            connected.value = false
        }
        socket.onmessage = (event: MessageEvent) => {
            handleMessage(event.data)
        }
    }

    // Request initial data from server
    function requestData() {
        // Use legacy "?" for backwards compatibility
        if (socket) socket.send("?")
    }

    // Send a typed request to the server
    function sendRequest(request: ClientMessage['request']) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            const message: ClientMessage = { type: 'request', request }
            socket.send(JSON.stringify(message))
        }
    }

    // Handle incoming WebSocket messages
    function handleMessage(data: string) {
        try {
            const message = JSON.parse(data)
            if (isServerMessage(message)) {
                if (message.type === 'config') {
                    handleConfigMessage(message.config)
                } else if (message.type === 'flight') {
                    handleFlightMessage(message.flight)
                }
            } else {
                console.log("received unknown message:", message)
            }
        } catch (err) {
            console.log("received non-JSON message:", data)
        }
    }

    // Handle config message from server
    function handleConfigMessage(newConfig: EfsConfig) {
        console.log("received config:", newConfig)
        config.value = newConfig
    }

    // Handle flight message from server
    function handleFlightMessage(flight: FlightStrip) {
        console.log("received flight:", flight.callsign)
        strips.value.set(flight.id, flight)

        // Add strip to the appropriate section
        const bay = config.value.bays.find(b => b.id === flight.bayId)
        const section = bay?.sections.find(s => s.id === flight.sectionId)
        if (section && !section.stripIds.includes(flight.id)) {
            section.stripIds.push(flight.id)
        }
    }

    // Computed getters
    const getBays = computed(() => config.value.bays)

    const getStripsBySection = (bayId: string, sectionId: string) => {
        const sectionStrips: FlightStrip[] = []
        strips.value.forEach((strip) => {
            if (strip.bayId === bayId && strip.sectionId === sectionId) {
                sectionStrips.push(strip)
            }
        })
        return sectionStrips.sort((a, b) => a.position - b.position)
    }

    // Get top-attached strips (scrollable area)
    const getTopStrips = (bayId: string, sectionId: string) => {
        const bay = config.value.bays.find(b => b.id === bayId)
        const section = bay?.sections.find(s => s.id === sectionId)
        if (!section) return []
        return section.stripIds
            .map(id => strips.value.get(id))
            .filter((s): s is FlightStrip => s !== undefined)
    }

    // Get bottom-attached strips (pinned at bottom)
    const getBottomStrips = (bayId: string, sectionId: string) => {
        const bay = config.value.bays.find(b => b.id === bayId)
        const section = bay?.sections.find(s => s.id === sectionId)
        if (!section) return []
        return section.bottomStripIds
            .map(id => strips.value.get(id))
            .filter((s): s is FlightStrip => s !== undefined)
    }

    // Actions
    function moveStripToSection(
        stripId: string,
        targetBayId: string,
        targetSectionId: string,
        position?: number
    ) {
        const strip = strips.value.get(stripId)
        if (!strip) return

        const oldBayId = strip.bayId
        const oldSectionId = strip.sectionId
        const isSameSection = oldBayId === targetBayId && oldSectionId === targetSectionId

        // Find old position before removal
        const oldBay = config.value.bays.find(b => b.id === oldBayId)
        const oldSection = oldBay?.sections.find(s => s.id === oldSectionId)
        const oldPosition = oldSection?.stripIds.indexOf(stripId) ?? -1

        // Remove from old section (both top and bottom lists)
        if (oldSection) {
            oldSection.stripIds = oldSection.stripIds.filter(id => id !== stripId)
            oldSection.bottomStripIds = oldSection.bottomStripIds.filter(id => id !== stripId)
        }

        // Update strip
        strip.bayId = targetBayId
        strip.sectionId = targetSectionId

        // Add to new section (top strips)
        const targetBay = config.value.bays.find(b => b.id === targetBayId)
        const targetSection = targetBay?.sections.find(s => s.id === targetSectionId)
        if (targetSection) {
            if (position !== undefined) {
                targetSection.stripIds.splice(position, 0, stripId)
            } else {
                targetSection.stripIds.push(stripId)
            }
        }

        // Handle gaps for same-section moves
        if (isSameSection && oldPosition !== -1 && position !== undefined) {
            adjustGapsForMove(targetBayId, targetSectionId, oldPosition, position)
        }

        // Cleanup gaps (remove trailing gaps)
        if (isSameSection) {
            cleanupGaps(targetBayId, targetSectionId)
        } else {
            cleanupGaps(oldBayId, oldSectionId)
            cleanupGaps(targetBayId, targetSectionId)
        }

        // Recompute positions
        recomputePositions(targetBayId, targetSectionId)
        if (!isSameSection) {
            recomputePositions(oldBayId, oldSectionId)
        }
    }

    function moveStripToBottom(
        stripId: string,
        targetBayId: string,
        targetSectionId: string,
        position?: number
    ) {
        const strip = strips.value.get(stripId)
        if (!strip) return

        const oldBayId = strip.bayId
        const oldSectionId = strip.sectionId

        // Remove from old section (both lists)
        const oldBay = config.value.bays.find(b => b.id === oldBayId)
        const oldSection = oldBay?.sections.find(s => s.id === oldSectionId)
        if (oldSection) {
            oldSection.stripIds = oldSection.stripIds.filter(id => id !== stripId)
            oldSection.bottomStripIds = oldSection.bottomStripIds.filter(id => id !== stripId)
        }

        // Update strip
        strip.bayId = targetBayId
        strip.sectionId = targetSectionId

        // Add to bottom of target section
        const targetBay = config.value.bays.find(b => b.id === targetBayId)
        const targetSection = targetBay?.sections.find(s => s.id === targetSectionId)
        if (targetSection) {
            if (position !== undefined) {
                targetSection.bottomStripIds.splice(position, 0, stripId)
            } else {
                targetSection.bottomStripIds.push(stripId)
            }
        }

        // Cleanup gaps in old section
        cleanupGaps(oldBayId, oldSectionId)

        // Recompute positions
        recomputePositions(targetBayId, targetSectionId)
        if (oldBayId !== targetBayId || oldSectionId !== targetSectionId) {
            recomputePositions(oldBayId, oldSectionId)
        }
    }

    // Gap management - gaps are stored by index position in the section
    const GAP_BUFFER = 30 // Minimum pixels to create/maintain a gap

    function setGapAtIndex(bayId: string, sectionId: string, index: number, gapSize: number) {
        const bay = config.value.bays.find(b => b.id === bayId)
        const section = bay?.sections.find(s => s.id === sectionId)
        if (!section) return

        if (gapSize >= GAP_BUFFER) {
            section.gaps[index] = gapSize
        } else {
            delete section.gaps[index]
        }
    }

    function removeGapAtIndex(bayId: string, sectionId: string, index: number) {
        const bay = config.value.bays.find(b => b.id === bayId)
        const section = bay?.sections.find(s => s.id === sectionId)
        if (!section) return
        delete section.gaps[index]
    }

    function getGapAtIndex(bayId: string, sectionId: string, index: number): number {
        const bay = config.value.bays.find(b => b.id === bayId)
        const section = bay?.sections.find(s => s.id === sectionId)
        return section?.gaps[index] ?? 0
    }

    // Clean up gaps: remove any gap at the last position (after all strips)
    function cleanupGaps(bayId: string, sectionId: string) {
        const bay = config.value.bays.find(b => b.id === bayId)
        const section = bay?.sections.find(s => s.id === sectionId)
        if (!section) return

        const stripCount = section.stripIds.length
        // Remove gaps at or beyond the strip count (gaps after last strip)
        Object.keys(section.gaps).forEach(key => {
            const idx = parseInt(key)
            if (idx >= stripCount) {
                delete section.gaps[idx]
            }
        })
    }

    // Adjust gap indices when strips are moved
    function adjustGapsForMove(bayId: string, sectionId: string, fromIndex: number, toIndex: number) {
        const bay = config.value.bays.find(b => b.id === bayId)
        const section = bay?.sections.find(s => s.id === sectionId)
        if (!section) return

        const newGaps: Record<number, number> = {}

        Object.entries(section.gaps).forEach(([key, value]) => {
            let idx = parseInt(key)

            if (fromIndex < toIndex) {
                // Moving down: gaps between from and to shift up by 1
                if (idx > fromIndex && idx <= toIndex) {
                    idx -= 1
                } else if (idx === fromIndex) {
                    // Gap at the original position stays at the same index
                    // (strip moved away, gap remains)
                }
            } else {
                // Moving up: gaps between to and from shift down by 1
                if (idx >= toIndex && idx < fromIndex) {
                    idx += 1
                }
            }

            newGaps[idx] = value
        })

        section.gaps = newGaps
        cleanupGaps(bayId, sectionId)
    }

    function setSectionHeight(bayId: string, sectionId: string, height: number) {
        const bay = config.value.bays.find(b => b.id === bayId)
        const section = bay?.sections.find(s => s.id === sectionId)
        if (section) {
            section.height = Math.max(80, height) // Enforce min height
        }
    }

    function moveStripToNextSection(stripId: string) {
        const strip = strips.value.get(stripId)
        if (!strip) return

        const bay = config.value.bays.find(b => b.id === strip.bayId)
        if (!bay) return

        const currentSectionIndex = bay.sections.findIndex(s => s.id === strip.sectionId)
        if (currentSectionIndex === -1 || currentSectionIndex >= bay.sections.length - 1) return

        const nextSection = bay.sections[currentSectionIndex + 1]
        if (!nextSection) return
        moveStripToSection(stripId, strip.bayId, nextSection.id)
    }

    function recomputePositions(bayId: string, sectionId: string) {
        const bay = config.value.bays.find(b => b.id === bayId)
        const section = bay?.sections.find(s => s.id === sectionId)
        if (!section) return

        section.stripIds.forEach((stripId, index) => {
            const strip = strips.value.get(stripId)
            if (strip) {
                strip.position = index
            }
        })
    }

    // Initialize connection
    connect()
    setInterval(() => {
        if (!connected.value) connect()
    }, 3000)

    return {
        connected,
        getBays,
        getStripsBySection,
        getTopStrips,
        getBottomStrips,
        moveStripToSection,
        moveStripToNextSection,
        moveStripToBottom,
        setGapAtIndex,
        removeGapAtIndex,
        getGapAtIndex,
        setSectionHeight,
        GAP_BUFFER,
        sendRequest
    }
})
