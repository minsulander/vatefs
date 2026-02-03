import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { FlightStrip, EfsConfig, Gap, Section, ClientMessage } from "@vatefs/common"
import { isServerMessage, GAP_BUFFER, gapKey } from "@vatefs/common"

export const useEfsStore = defineStore("efs", () => {

    let socket: WebSocket | undefined = undefined

    const connected = ref(false)
    const config = ref<EfsConfig>({ bays: [] })
    const strips = ref<Map<string, FlightStrip>>(new Map())
    const gaps = ref<Map<string, Gap>>(new Map())  // key: bayId:sectionId:index

    function connect() {
        if (connected.value && socket?.readyState == WebSocket.OPEN) return
        socket = new WebSocket(`ws://${location.hostname}:17770`)
        ;(window as any).socket = socket
        if (socket.readyState == WebSocket.OPEN) {
            console.log("socket open at mounted")
            connected.value = true
        }
        socket.onopen = () => {
            console.log("socket opened")
            connected.value = true
            // Server sends initial state on connect, no need to request
        }
        socket.onclose = () => {
            console.log("socket closed")
            connected.value = false
        }
        socket.onmessage = (event: MessageEvent) => {
            handleMessage(event.data)
        }
    }

    // Send a message to the server
    function sendMessage(message: ClientMessage) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(message))
        }
    }

    // Send a typed request to the server
    function sendRequest(request: 'config' | 'strips') {
        sendMessage({ type: 'request', request })
    }

    // Handle incoming WebSocket messages
    function handleMessage(data: string) {
        try {
            const message = JSON.parse(data)
            if (isServerMessage(message)) {
                switch (message.type) {
                    case 'config':
                        handleConfigMessage(message.config)
                        break
                    case 'strip':
                        handleStripMessage(message.strip)
                        break
                    case 'stripDelete':
                        handleStripDeleteMessage(message.stripId)
                        break
                    case 'gap':
                        handleGapMessage(message.gap)
                        break
                    case 'gapDelete':
                        handleGapDeleteMessage(message.bayId, message.sectionId, message.index)
                        break
                    case 'section':
                        handleSectionMessage(message.bayId, message.section)
                        break
                    default:
                        console.log(`received ${(message as { type?: string }).type ?? 'unknown'} server message:`, message)
                }
            } else {
                console.log(`received ${message.type ?? 'unknown'} message:`, message)
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

    // Handle strip message from server
    function handleStripMessage(strip: FlightStrip) {
        console.log("received strip:", strip.callsign)
        strips.value.set(strip.id, strip)
    }

    // Handle strip delete message from server
    function handleStripDeleteMessage(stripId: string) {
        console.log("received strip delete:", stripId)
        strips.value.delete(stripId)
    }

    // Handle gap message from server
    function handleGapMessage(gap: Gap) {
        console.log("received gap:", gap.sectionId, gap.index, gap.size)
        gaps.value.set(gapKey(gap.bayId, gap.sectionId, gap.index), gap)
    }

    // Handle gap delete message from server
    function handleGapDeleteMessage(bayId: string, sectionId: string, index: number) {
        console.log("received gap delete:", sectionId, index)
        gaps.value.delete(gapKey(bayId, sectionId, index))
    }

    // Handle section message from server
    function handleSectionMessage(bayId: string, section: Section) {
        console.log("received section:", section.id, section.height)
        const bay = config.value.bays.find(b => b.id === bayId)
        if (bay) {
            const existingIndex = bay.sections.findIndex(s => s.id === section.id)
            if (existingIndex !== -1) {
                // If this is the last section, clear its height (it should always flex)
                if (existingIndex === bay.sections.length - 1) {
                    delete section.height
                }
                bay.sections[existingIndex] = section
            }
        }
    }

    // Computed getters
    const getBays = computed(() => config.value.bays)

    // Get top-attached strips (scrollable area) - computed from strips Map
    function getTopStrips(bayId: string, sectionId: string): FlightStrip[] {
        const result: FlightStrip[] = []
        strips.value.forEach(strip => {
            if (strip.bayId === bayId && strip.sectionId === sectionId && !strip.bottom) {
                result.push(strip)
            }
        })
        return result.sort((a, b) => a.position - b.position)
    }

    // Get bottom-attached strips (pinned at bottom) - computed from strips Map
    function getBottomStrips(bayId: string, sectionId: string): FlightStrip[] {
        const result: FlightStrip[] = []
        strips.value.forEach(strip => {
            if (strip.bayId === bayId && strip.sectionId === sectionId && strip.bottom) {
                result.push(strip)
            }
        })
        return result.sort((a, b) => a.position - b.position)
    }

    // Get all strips for a section (both top and bottom)
    function getStripsBySection(bayId: string, sectionId: string): FlightStrip[] {
        const sectionStrips: FlightStrip[] = []
        strips.value.forEach((strip) => {
            if (strip.bayId === bayId && strip.sectionId === sectionId) {
                sectionStrips.push(strip)
            }
        })
        return sectionStrips.sort((a, b) => a.position - b.position)
    }

    // Get gaps for a section as a Record (for backwards compatibility)
    function getGapsForSection(bayId: string, sectionId: string): Record<number, number> {
        const result: Record<number, number> = {}
        gaps.value.forEach(gap => {
            if (gap.bayId === bayId && gap.sectionId === sectionId) {
                result[gap.index] = gap.size
            }
        })
        return result
    }

    // Get gap at specific index
    function getGapAtIndex(bayId: string, sectionId: string, index: number): number {
        const gap = gaps.value.get(gapKey(bayId, sectionId, index))
        return gap?.size ?? 0
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
        const oldBottom = strip.bottom
        const oldPosition = strip.position
        const isSameSection = oldBayId === targetBayId && oldSectionId === targetSectionId
        const isSameZone = isSameSection && !oldBottom  // moving within top zone

        // Get target strips count (excluding the moving strip)
        const targetStrips = getTopStrips(targetBayId, targetSectionId).filter(s => s.id !== stripId)
        const targetPosition = (position !== undefined && position >= 0 && position <= targetStrips.length)
            ? position
            : targetStrips.length

        // Handle gaps for same-zone moves
        if (isSameZone) {
            adjustGapsForMove(targetBayId, targetSectionId, oldPosition, targetPosition)
        }

        // Update strip location
        strip.bayId = targetBayId
        strip.sectionId = targetSectionId
        strip.bottom = false

        // Insert strip at target position and recompute all positions
        // targetStrips is already sorted and excludes the moving strip
        targetStrips.splice(targetPosition, 0, strip)
        targetStrips.forEach((s, index) => {
            s.position = index
        })

        // Recompute old section if moved from different zone
        if (!isSameZone) {
            recomputePositions(oldBayId, oldSectionId, oldBottom)
        }

        // Cleanup gaps
        if (!oldBottom || isSameSection) {
            cleanupGaps(targetBayId, targetSectionId)
        }
        if (!isSameSection && !oldBottom) {
            cleanupGaps(oldBayId, oldSectionId)
        }

        // Send update to server
        sendMessage({
            type: 'moveStrip',
            stripId,
            targetBayId,
            targetSectionId,
            position: targetPosition,
            isBottom: false
        })
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
        const oldBottom = strip.bottom

        // Get target bottom strips count (excluding the moving strip)
        const targetStrips = getBottomStrips(targetBayId, targetSectionId).filter(s => s.id !== stripId)
        const targetPosition = (position !== undefined && position >= 0 && position <= targetStrips.length)
            ? position
            : targetStrips.length

        // Update strip location
        strip.bayId = targetBayId
        strip.sectionId = targetSectionId
        strip.bottom = true

        // Insert strip at target position and recompute all positions
        // targetStrips is already sorted and excludes the moving strip
        targetStrips.splice(targetPosition, 0, strip)
        targetStrips.forEach((s, index) => {
            s.position = index
        })

        // Recompute old section if moved from different zone
        if (oldBayId !== targetBayId || oldSectionId !== targetSectionId || !oldBottom) {
            recomputePositions(oldBayId, oldSectionId, oldBottom)
        }

        // Cleanup gaps in old section if was in top zone
        if (!oldBottom) {
            cleanupGaps(oldBayId, oldSectionId)
        }

        // Send update to server
        sendMessage({
            type: 'moveStrip',
            stripId,
            targetBayId,
            targetSectionId,
            position: targetPosition,
            isBottom: true
        })
    }

    // Gap management
    function setGapAtIndex(bayId: string, sectionId: string, index: number, gapSize: number) {
        const key = gapKey(bayId, sectionId, index)

        if (gapSize >= GAP_BUFFER) {
            const gap: Gap = { bayId, sectionId, index, size: gapSize }
            gaps.value.set(key, gap)
        } else {
            gaps.value.delete(key)
        }

        // Send update to server
        sendMessage({
            type: 'setGap',
            bayId,
            sectionId,
            index,
            gapSize
        })
    }

    function removeGapAtIndex(bayId: string, sectionId: string, index: number) {
        gaps.value.delete(gapKey(bayId, sectionId, index))

        // Send update to server (gapSize 0 will remove it)
        sendMessage({
            type: 'setGap',
            bayId,
            sectionId,
            index,
            gapSize: 0
        })
    }

    // Clean up gaps: remove any gap at or beyond the strip count
    function cleanupGaps(bayId: string, sectionId: string) {
        const stripCount = getTopStrips(bayId, sectionId).length
        const keysToDelete: string[] = []

        gaps.value.forEach((gap, key) => {
            if (gap.bayId === bayId && gap.sectionId === sectionId && gap.index >= stripCount) {
                keysToDelete.push(key)
            }
        })

        keysToDelete.forEach(key => gaps.value.delete(key))
    }

    // Adjust gap indices when strips are moved
    function adjustGapsForMove(bayId: string, sectionId: string, fromIndex: number, toIndex: number) {
        const sectionGaps: Gap[] = []
        gaps.value.forEach(gap => {
            if (gap.bayId === bayId && gap.sectionId === sectionId) {
                sectionGaps.push(gap)
            }
        })

        const updates: { oldKey: string, gap: Gap, newIndex: number }[] = []

        sectionGaps.forEach(gap => {
            let newIndex = gap.index

            if (fromIndex < toIndex) {
                // Moving down: gaps between from and to shift up by 1
                if (gap.index > fromIndex && gap.index <= toIndex) {
                    newIndex = gap.index - 1
                }
            } else {
                // Moving up: gaps between to and from shift down by 1
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
            gaps.value.delete(oldKey)
            const newGap: Gap = { ...gap, index: newIndex }
            gaps.value.set(gapKey(bayId, sectionId, newIndex), newGap)
        })

        cleanupGaps(bayId, sectionId)
    }

    function setSectionHeight(bayId: string, sectionId: string, height: number, broadcast: boolean = true) {
        const bay = config.value.bays.find(b => b.id === bayId)
        const section = bay?.sections.find(s => s.id === sectionId)
        if (section) {
            section.height = Math.max(80, height) // Enforce min height
        }

        // Send update to server (only if requested - during resize we send after completion)
        if (broadcast) {
            sendMessage({
                type: 'setSectionHeight',
                bayId,
                sectionId,
                height: Math.max(80, height)
            })
        }
    }

    // Batch send section heights (called at end of resize)
    function broadcastSectionHeights(bayId: string) {
        const bay = config.value.bays.find(b => b.id === bayId)
        if (!bay) return

        bay.sections.forEach(section => {
            if (section.height !== undefined) {
                sendMessage({
                    type: 'setSectionHeight',
                    bayId,
                    sectionId: section.id,
                    height: section.height
                })
            }
        })
    }

    function sendStripAction(stripId: string, action: string) {
        sendMessage({
            type: 'stripAction',
            stripId,
            action
        })
    }

    function recomputePositions(bayId: string, sectionId: string, bottom: boolean) {
        const sectionStrips = bottom
            ? getBottomStrips(bayId, sectionId)
            : getTopStrips(bayId, sectionId)

        sectionStrips.forEach((strip, index) => {
            strip.position = index
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
        config,
        strips,
        gaps,
        getStripsBySection,
        getTopStrips,
        getBottomStrips,
        getGapsForSection,
        moveStripToSection,
        moveStripToBottom,
        setGapAtIndex,
        removeGapAtIndex,
        getGapAtIndex,
        setSectionHeight,
        broadcastSectionHeights,
        sendStripAction,
        GAP_BUFFER,
        sendRequest
    }
})
