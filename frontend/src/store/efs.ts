import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { FlightStrip, EfsLayout, Gap, Section, ClientMessage, AssignmentType, AirportAtisInfo, ConfigInfo, DclMode, ControllerInfo, UiSettings } from "@vatefs/common"
import { isServerMessage, GAP_BUFFER, gapKey, DEFAULT_UI_SETTINGS } from "@vatefs/common"

export const useEfsStore = defineStore("efs", () => {

    let socket: WebSocket | undefined = undefined

    const connected = ref(false)
    const layout = ref<EfsLayout>({ bays: [] })
    const strips = ref<Map<string, FlightStrip>>(new Map())
    /** Bumps on every strip add/update/delete so list computeds (e.g. time-sort) always re-run */
    const stripsVersion = ref(0)
    /** Sections where the user manually reordered; time-sort resumes when E/TOBT or TSAT changes */
    const manualOrderSections = ref<Set<string>>(new Set())
    const gaps = ref<Map<string, Gap>>(new Map())  // key: bayId:sectionId:index

    const TIME_SORT_SECTION_IDS = new Set(['pending_dep', 'cleared', 'dep'])

    /** E/TOBT–TSAT sort: pending/cleared, or RTC bay*_dep — not ctr_dep */
    function isTimeSortSectionId(sectionId: string): boolean {
        if (TIME_SORT_SECTION_IDS.has(sectionId)) return true
        return /^(bay\d+|idle)_dep$/.test(sectionId)
    }

    function sectionOrderKey(bayId: string, sectionId: string): string {
        return `${bayId}:${sectionId}`
    }

    function markManualOrder(bayId: string, sectionId: string) {
        if (!isTimeSortSectionId(sectionId)) return
        const next = new Set(manualOrderSections.value)
        next.add(sectionOrderKey(bayId, sectionId))
        manualOrderSections.value = next
    }

    function clearManualOrder(bayId: string, sectionId: string) {
        const key = sectionOrderKey(bayId, sectionId)
        if (!manualOrderSections.value.has(key)) return
        const next = new Set(manualOrderSections.value)
        next.delete(key)
        manualOrderSections.value = next
    }

    function hasManualOrder(bayId: string, sectionId: string): boolean {
        return manualOrderSections.value.has(sectionOrderKey(bayId, sectionId))
    }

    /** Section heights preserved across server refresh until the next layout arrives */
    const pendingLayoutHeights = ref<Map<string, number> | null>(null)

    function snapshotSectionHeights(): Map<string, number> {
        const m = new Map<string, number>()
        for (const bay of layout.value.bays) {
            for (const section of bay.sections) {
                if (section.height !== undefined) {
                    m.set(`${bay.id}:${section.id}`, section.height)
                }
            }
        }
        return m
    }

    function applyPreservedSectionHeights(target: EfsLayout, preserved: Map<string, number>) {
        for (const bay of target.bays) {
            for (const section of bay.sections) {
                if (section.height !== undefined) continue
                const h = preserved.get(`${bay.id}:${section.id}`)
                if (h !== undefined) section.height = h
            }
        }
    }

    // Controller status
    const myCallsign = ref('')
    const myAirports = ref<string[]>([])
    const myRole = ref<string | undefined>(undefined)
    const isController = ref(false)

    // Multi-airport mode
    const multiAirport = ref(false)
    const activeAirports = ref<string[]>([])
    /** Airports ARR/DEP in EuroScope rwyselect — always "relevant" in the picker */
    const esAirports = ref<string[]>([])
    const columnAirports = ref<(string | null)[]>([])
    const columnCount = ref(4)
    /** Swedish (ES*) airports for RTC column picker — includes name/country when known */
    const airportOptions = ref<Array<{ icao: string; name?: string; country?: string }>>([])

    // DCL status
    const dclStatus = ref<'unavailable' | 'available' | 'connected' | 'error'>('unavailable')
    const dclError = ref<string | undefined>(undefined)
    const dclMode = ref<DclMode>('manual')

    // ATIS info per airport
    const atisInfo = ref<AirportAtisInfo[]>([])

    // Configuration
    const availableConfigs = ref<ConfigInfo[]>([])
    const activeConfig = ref('')

    // Online controllers (for manual transfer menu)
    const controllers = ref<ControllerInfo[]>([])

    // UI preferences (persisted via backend VatEFSsettings.json)
    const dclSoundEnabled = ref(DEFAULT_UI_SETTINGS.dclSoundEnabled)
    const flashChangedTimes = ref(DEFAULT_UI_SETTINGS.flashChangedTimes)
    const flashTsatWindow = ref(DEFAULT_UI_SETTINGS.flashTsatWindow)
    const showStripOwnership = ref(DEFAULT_UI_SETTINGS.showStripOwnership)
    const dimOtherOwnedStrips = ref(DEFAULT_UI_SETTINGS.dimOtherOwnedStrips)
    const transferSoundsEnabled = ref(DEFAULT_UI_SETTINGS.transferSoundsEnabled)

    function applyUserSettings(settings: UiSettings) {
        dclSoundEnabled.value = settings.dclSoundEnabled
        flashChangedTimes.value = settings.flashChangedTimes
        flashTsatWindow.value = settings.flashTsatWindow
        showStripOwnership.value = settings.showStripOwnership
        dimOtherOwnedStrips.value = settings.dimOtherOwnedStrips
        transferSoundsEnabled.value = settings.transferSoundsEnabled
    }

    /** Update one or more UI settings (optimistic local apply + persist via backend). */
    function updateUserSettings(partial: Partial<UiSettings>) {
        if (typeof partial.dclSoundEnabled === 'boolean') dclSoundEnabled.value = partial.dclSoundEnabled
        if (typeof partial.flashChangedTimes === 'boolean') flashChangedTimes.value = partial.flashChangedTimes
        if (typeof partial.flashTsatWindow === 'boolean') flashTsatWindow.value = partial.flashTsatWindow
        if (typeof partial.showStripOwnership === 'boolean') showStripOwnership.value = partial.showStripOwnership
        if (typeof partial.dimOtherOwnedStrips === 'boolean') dimOtherOwnedStrips.value = partial.dimOtherOwnedStrips
        if (typeof partial.transferSoundsEnabled === 'boolean') transferSoundsEnabled.value = partial.transferSoundsEnabled
        sendMessage({ type: 'updateUserSettings', settings: partial })
    }
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
    function sendRequest(request: 'layout' | 'strips' | 'refresh') {
        sendMessage({ type: 'request', request })
    }

    // Handle incoming WebSocket messages
    function handleMessage(data: string) {
        try {
            const message = JSON.parse(data)
            if (isServerMessage(message)) {
                switch (message.type) {
                    case 'layout':
                        handleLayoutMessage(message.layout)
                        break
                    case 'strip':
                        handleStripMessage(message.strip, message.autoMoved)
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
                    case 'refresh':
                        console.log('Server requested refresh:', message.reason ?? 'no reason given')
                        refresh(true)
                        break
                    case 'status':
                        handleStatusMessage(message)
                        break
                    case 'dclStatus':
                        dclStatus.value = message.status
                        dclError.value = message.error
                        if (message.dclMode) dclMode.value = message.dclMode
                        break
                    case 'atisUpdate':
                        atisInfo.value = message.airports
                        break
                    case 'configList':
                        availableConfigs.value = message.configs
                        activeConfig.value = message.activeConfig
                        break
                    case 'controllers':
                        controllers.value = message.controllers
                        break
                    case 'userSettings':
                        applyUserSettings(message.settings)
                        break
                    case 'hoppieMessage':
                        console.log(`[HOPPIE] ${message.from} (${message.messageType}): ${message.packet}`)
                        break
                    default:
                        console.log(`received ${(message as { type?: string }).type ?? 'unknown'} server message:`, message)
                }
            } else {
                switch (message.type) {
                    case 'myselfUpdate':
                        break
                    default:
                        console.log(`received ${message.type ?? 'unknown'} message:`, message)
                }
            }
        } catch (err) {
            console.log("received non-JSON message:", data)
        }
    }

    // Handle layout message from server
    function handleLayoutMessage(newLayout: EfsLayout) {
        console.log("received layout:", newLayout)
        const preserved = pendingLayoutHeights.value ?? snapshotSectionHeights()
        pendingLayoutHeights.value = null
        applyPreservedSectionHeights(newLayout, preserved)
        layout.value = newLayout
    }

    // Auto-move animation: maps strip ID -> old rect + cloned DOM node (non-reactive, consumed once)
    const autoMoveData = new Map<string, { rect: DOMRect; clone: HTMLElement }>()

    // Handle strip message from server
    function handleStripMessage(strip: FlightStrip, autoMoved?: boolean) {
        console.log("received strip:", strip.callsign)

        // Capture old position and clone for fly-across animation before updating
        if (autoMoved) {
            const el = document.querySelector(`[data-strip-id="${strip.id}"]`) as HTMLElement | null
            if (el) {
                const rect = el.getBoundingClientRect()
                const clone = el.cloneNode(true) as HTMLElement
                autoMoveData.set(strip.id, { rect, clone })
            }
        }

        strips.value.set(strip.id, strip)
        stripsVersion.value++
    }

    // Handle strip delete message from server
    function handleStripDeleteMessage(stripId: string) {
        console.log("received strip delete:", stripId)
        strips.value.delete(stripId)
        stripsVersion.value++
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
        const bay = layout.value.bays.find(b => b.id === bayId)
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

    // Refresh all data from server
    function refresh(serverRequested: boolean = false) {
        console.log("Refreshing all data from server")
        pendingLayoutHeights.value = snapshotSectionHeights()
        // Clear local state
        layout.value = { bays: [] }
        strips.value.clear()
        stripsVersion.value++
        manualOrderSections.value = new Set()
        gaps.value.clear()

        // Request fresh data from server
        sendRequest('layout')
        sendRequest('strips')
        if (!serverRequested) sendRequest('refresh')
    }

    // Handle status message from server
    function handleStatusMessage(message: {
        callsign: string
        airports: string[]
        role?: string
        isController?: boolean
        multiAirport?: boolean
        activeAirports?: string[]
        esAirports?: string[]
        columnAirports?: (string | null)[]
        columnCount?: number
    }) {
        myCallsign.value = message.callsign
        myAirports.value = message.airports
        myRole.value = message.role
        isController.value = message.isController ?? false
        multiAirport.value = message.multiAirport ?? false
        const nextActive = message.activeAirports ?? message.airports
        markNewlyActiveAirports(nextActive)
        activeAirports.value = nextActive
        esAirports.value = message.esAirports ?? []
        columnAirports.value = message.columnAirports ?? []
        if (typeof message.columnCount === 'number') {
            columnCount.value = message.columnCount
        } else if (message.columnAirports) {
            columnCount.value = message.columnAirports.length
        }
        if (multiAirport.value && airportOptions.value.length === 0) {
            void fetchAirportOptions()
        }
    }

    async function fetchAirportOptions() {
        try {
            const res = await fetch('/api/airports?prefix=ES')
            if (!res.ok) return
            const data = await res.json() as {
                airports?: Array<string | { icao: string; name?: string | null; country?: string | null }>
            }
            if (!data.airports) return
            airportOptions.value = data.airports.map((a) => {
                if (typeof a === 'string') return { icao: a }
                return {
                    icao: a.icao,
                    name: a.name ?? undefined,
                    country: a.country ?? undefined,
                }
            })
        } catch (err) {
            console.warn('Failed to fetch airport list', err)
        }
    }

    function airportMeta(icao: string): { name?: string; country?: string } | undefined {
        return airportOptions.value.find((a) => a.icao === icao)
    }

    function setColumnAirport(columnIndex: number, airport: string | null) {
        sendMessage({ type: 'setColumnAirport', columnIndex, airport })
        // Optimistic local update
        const next = [...columnAirports.value]
        while (next.length <= columnIndex) next.push(null)
        if (airport) {
            const previous = next[columnIndex] ?? null
            // Already in another column → swap with this column's current airport
            for (let i = 0; i < next.length; i++) {
                if (i !== columnIndex && next[i] === airport) next[i] = previous
            }
        }
        next[columnIndex] = airport
        columnAirports.value = next

        // Drop user-picked airports that are no longer relevant (not ES, not in a column, no traffic)
        const es = new Set(esAirports.value)
        const inColumn = new Set(next.filter((a): a is string => !!a))
        activeAirports.value = activeAirports.value.filter(
            a => es.has(a) || inColumn.has(a) || airportHasTraffic(a),
        )
    }

    /** Whether an airport should appear relevant/active in the column picker. */
    function isAirportRelevant(icao: string): boolean {
        if (esAirports.value.includes(icao)) return true
        if (columnAirports.value.includes(icao)) return true
        if (activeAirports.value.includes(icao) && airportHasTraffic(icao)) return true
        return false
    }

    function addActiveAirport(airport: string) {
        sendMessage({ type: 'addActiveAirport', airport })
        if (!activeAirports.value.includes(airport)) {
            markNewlyActiveAirports([...activeAirports.value, airport])
            activeAirports.value = [...activeAirports.value, airport]
        }
    }

    function removeActiveAirport(airport: string) {
        sendMessage({ type: 'removeActiveAirport', airport })
        activeAirports.value = activeAirports.value.filter(a => a !== airport)
        columnAirports.value = columnAirports.value.map(a => (a === airport ? null : a))
        if (pendingIdleSwap.value === airport) pendingIdleSwap.value = null
    }

    function setColumnCount(count: number) {
        const n = Math.max(2, Math.min(6, Math.floor(count)))
        if (n === columnCount.value) return
        sendMessage({ type: 'setColumnCount', count: n })
        // Optimistic local update until status/layout arrives
        columnCount.value = n
        const next = [...columnAirports.value]
        while (next.length < n) next.push(null)
        columnAirports.value = next.slice(0, n)
    }

    function adjustColumnCount(delta: number) {
        setColumnCount(columnCount.value + delta)
    }

    /** True if any strip instance exists for this airport (including idle-bay strips). */
    function airportHasTraffic(icao: string): boolean {
        for (const strip of strips.value.values()) {
            if (strip.airport === icao) return true
        }
        return false
    }

    /** Arrival/departure strip counts for a multi-airport ICAO (notes/cross ignored). */
    function airportTrafficCounts(icao: string): { arr: number; dep: number } {
        let arr = 0
        let dep = 0
        for (const strip of strips.value.values()) {
            if (strip.airport !== icao) continue
            if (strip.stripType === 'arrival') arr++
            else if (strip.stripType === 'departure' || strip.stripType === 'local') dep++
        }
        return { arr, dep }
    }

    /**
     * Idle = active, not shown in any column, and has traffic.
     * Empty closed airports stay in activeAirports but are hidden from the idle bar
     * until traffic appears — then they show up for one-click swap.
     */
    const idleAirports = computed(() => {
        const visible = new Set(columnAirports.value.filter((a): a is string => !!a))
        return activeAirports.value.filter(a => !visible.has(a) && airportHasTraffic(a))
    })

    /** Idle airport selected for column swap (click idle, then click column). */
    const pendingIdleSwap = ref<string | null>(null)
    /** Column index briefly highlighted when its airport is clicked in the top bar. */
    const flashingColumnIndex = ref<number | null>(null)
    let flashTimer: ReturnType<typeof setTimeout> | null = null
    /** Airports that just became active — shown/blink on top bar briefly. */
    const newlyActiveAirports = ref<string[]>([])
    const newlyActiveTimers = new Map<string, ReturnType<typeof setTimeout>>()

    function markNewlyActiveAirports(nextActive: string[]) {
        // Skip initial populate (nothing to compare against yet)
        if (activeAirports.value.length === 0) return
        const prev = new Set(activeAirports.value)
        for (const icao of nextActive) {
            if (prev.has(icao)) continue
            if (!newlyActiveAirports.value.includes(icao)) {
                newlyActiveAirports.value = [...newlyActiveAirports.value, icao]
            }
            const existing = newlyActiveTimers.get(icao)
            if (existing) clearTimeout(existing)
            newlyActiveTimers.set(icao, setTimeout(() => {
                newlyActiveAirports.value = newlyActiveAirports.value.filter(a => a !== icao)
                newlyActiveTimers.delete(icao)
            }, 4000))
        }
    }

    function isNewlyActiveAirport(icao: string): boolean {
        return newlyActiveAirports.value.includes(icao)
    }

    function selectIdleForSwap(icao: string) {
        pendingIdleSwap.value = pendingIdleSwap.value === icao ? null : icao
    }

    function clearPendingIdleSwap() {
        pendingIdleSwap.value = null
    }

    function flashColumnForAirport(icao: string) {
        const index = columnAirports.value.findIndex(a => a === icao)
        if (index < 0) return false
        if (flashTimer) clearTimeout(flashTimer)
        flashingColumnIndex.value = index
        flashTimer = setTimeout(() => {
            flashingColumnIndex.value = null
            flashTimer = null
        }, 1200)
        return true
    }

    /**
     * Assign airport to a column.
     * Previous occupant stays in activeAirports: with traffic → idle bar;
     * without traffic → stays active but hidden from idle until traffic appears.
     */
    function assignAirportToColumn(columnIndex: number, airport: string | null) {
        setColumnAirport(columnIndex, airport)
    }

    /** Complete idle→column swap when a pending idle airport is selected. */
    function applyPendingIdleToColumn(columnIndex: number): boolean {
        const icao = pendingIdleSwap.value
        if (!icao) return false
        if (!activeAirports.value.includes(icao)) addActiveAirport(icao)
        assignAirportToColumn(columnIndex, icao)
        pendingIdleSwap.value = null
        return true
    }

    // Unique accents for up to MAX columns (2–6); no reuse within a layout
    const COLUMN_COLORS = [
        '#4d9eab',
        '#f3b84b',
        '#9e6dc2',
        '#e57373',
        '#81c784',
        '#64b5f6',
    ] as const

    function columnColor(index: number): string {
        return COLUMN_COLORS[index] ?? COLUMN_COLORS[COLUMN_COLORS.length - 1]!
    }

    // Computed: airports that are not part of the callsign (for display)
    const displayAirports = computed(() => {
        const callsign = myCallsign.value.toUpperCase()
        return myAirports.value.filter(airport => !callsign.includes(airport))
    })

    // Computed getters
    const getBays = computed(() => layout.value.bays)

    function getSectionStrips(bayId: string, sectionId: string, bottom?: boolean): FlightStrip[] {
        const sectionStrips: FlightStrip[] = []
        strips.value.forEach((strip) => {
            const matchesZone = bottom === undefined || strip.bottom === bottom
            if (strip.bayId === bayId && strip.sectionId === sectionId && matchesZone) {
                sectionStrips.push(strip)
            }
        })
        return sectionStrips.sort((a, b) => a.position - b.position)
    }

    // Get top-attached strips (scrollable area) - computed from strips Map
    function getTopStrips(bayId: string, sectionId: string): FlightStrip[] {
        return getSectionStrips(bayId, sectionId, false)
    }

    // Get bottom-attached strips (pinned at bottom) - computed from strips Map
    function getBottomStrips(bayId: string, sectionId: string): FlightStrip[] {
        return getSectionStrips(bayId, sectionId, true)
    }

    // Get all strips for a section (both top and bottom)
    function getStripsBySection(bayId: string, sectionId: string): FlightStrip[] {
        return getSectionStrips(bayId, sectionId)
    }

    function reindexStrips(sectionStrips: FlightStrip[]) {
        sectionStrips.forEach((s, index) => {
            s.position = index
        })
    }

    function bumpStripsVersion() {
        stripsVersion.value++
    }

    /** Reindex top-zone strips to match a visual/DOM order (ids top→bottom). */
    function reindexTopStripsByIds(bayId: string, sectionId: string, orderedIds: string[]) {
        orderedIds.forEach((id, index) => {
            const strip = strips.value.get(id)
            if (strip && strip.bayId === bayId && strip.sectionId === sectionId && !strip.bottom) {
                strip.position = index
            }
        })
        stripsVersion.value++
    }

    /**
     * Before a manual move into a time-sorted section still in auto-sort mode,
     * align store positions to the current DOM order so insert indices match what the user sees.
     */
    function syncTimeSortSectionFromDom(bayId: string, sectionId: string, container: Element | null) {
        if (!isTimeSortSectionId(sectionId)) return
        if (hasManualOrder(bayId, sectionId)) return
        if (!container) return
        const ids = Array.from(container.querySelectorAll<HTMLElement>('[data-strip-id]'))
            .map((el) => el.getAttribute('data-strip-id'))
            .filter((id): id is string => !!id)
        if (ids.length > 0) reindexTopStripsByIds(bayId, sectionId, ids)
    }

    function resolveTargetPosition(position: number | undefined, stripCount: number): number {
        if (position !== undefined && position >= 0 && position <= stripCount) {
            return position
        }
        return stripCount
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
        const targetPosition = resolveTargetPosition(position, targetStrips.length)

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
        reindexStrips(targetStrips)

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

        stripsVersion.value++
        markManualOrder(targetBayId, targetSectionId)

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
        const targetPosition = resolveTargetPosition(position, targetStrips.length)

        // Update strip location
        strip.bayId = targetBayId
        strip.sectionId = targetSectionId
        strip.bottom = true

        // Insert strip at target position and recompute all positions
        // targetStrips is already sorted and excludes the moving strip
        targetStrips.splice(targetPosition, 0, strip)
        reindexStrips(targetStrips)

        // Recompute old section if moved from different zone
        if (oldBayId !== targetBayId || oldSectionId !== targetSectionId || !oldBottom) {
            recomputePositions(oldBayId, oldSectionId, oldBottom)
        }

        // Cleanup gaps in old section if was in top zone
        if (!oldBottom) {
            cleanupGaps(oldBayId, oldSectionId)
        }

        stripsVersion.value++

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

    // Threshold for broadcasting height changes (in pixels)
    const HEIGHT_CHANGE_THRESHOLD = 3

    function setSectionHeight(bayId: string, sectionId: string, height: number, broadcast: boolean = true) {
        const bay = layout.value.bays.find(b => b.id === bayId)
        const section = bay?.sections.find(s => s.id === sectionId)
        if (!section) return

        const newHeight = Math.max(80, height)
        const oldHeight = section.height ?? 0

        // Only update if height actually changed
        if (Math.abs(newHeight - oldHeight) < 1) {
            return
        }

        section.height = newHeight

        // Send update to server only if change exceeds threshold
        if (broadcast && Math.abs(newHeight - oldHeight) >= HEIGHT_CHANGE_THRESHOLD) {
            sendMessage({
                type: 'setSectionHeight',
                bayId,
                sectionId,
                height: Math.round(newHeight) // Round to avoid floating point noise
            })
        }
    }

    // Batch send section heights (called at end of resize)
    function broadcastSectionHeights(bayId: string) {
        const bay = layout.value.bays.find(b => b.id === bayId)
        if (!bay) return

        bay.sections.forEach(section => {
            if (section.height !== undefined) {
                sendMessage({
                    type: 'setSectionHeight',
                    bayId,
                    sectionId: section.id,
                    height: Math.round(section.height)
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

    function sendAssignment(stripId: string, assignType: AssignmentType, value: string) {
        sendMessage({
            type: 'stripAssign',
            stripId,
            assignType,
            value
        })
    }

    function dclLogin() {
        sendMessage({ type: 'dclAction', action: 'login' })
    }

    function dclLogout() {
        sendMessage({ type: 'dclAction', action: 'logout' })
    }

    function dclSend(stripId: string, remarks: string) {
        sendMessage({ type: 'dclSend', stripId, remarks })
    }

    function dclReject(stripId: string) {
        sendMessage({ type: 'dclReject', stripId })
    }

    function dclSetMode(mode: DclMode) {
        dclMode.value = mode
        sendMessage({ type: 'dclSetMode', mode })
    }

    function viffRea(stripId: string, set: boolean) {
        sendMessage({ type: 'viffRea', stripId, set })
    }

    function viffUpdateEobt(stripId: string, eobt: string) {
        sendMessage({ type: 'viffUpdateEobt', stripId, eobt })
    }

    function viffUpdateTobt(stripId: string, tobt: string) {
        sendMessage({ type: 'viffUpdateTobt', stripId, tobt })
    }

    function viffReadyTobt(stripId: string) {
        sendMessage({ type: 'viffReadyTobt', stripId })
    }

    function switchConfig(file: string) {
        sendMessage({ type: 'switchConfig', file })
    }

    function deleteStrip(stripId: string) {
        // Optimistically remove from local state
        strips.value.delete(stripId)
        stripsVersion.value++

        // Send delete request to server
        sendMessage({
            type: 'deleteStrip',
            stripId
        })
    }

    function createStrip(
        stripType: 'vfrDep' | 'vfrArr' | 'cross' | 'note',
        callsign?: string,
        aircraftType?: string,
        airport?: string,
        targetBayId?: string,
        targetSectionId?: string,
        position?: number,
        isBottom?: boolean
    ) {
        sendMessage({
            type: 'createStrip',
            stripType,
            callsign,
            aircraftType,
            airport,
            targetBayId,
            targetSectionId,
            position,
            isBottom
        })
    }

    function updateNote(stripId: string, text: string) {
        // Optimistic update
        const strip = strips.value.get(stripId)
        if (strip) {
            strips.value.set(stripId, { ...strip, noteText: text })
            stripsVersion.value++
        }

        sendMessage({
            type: 'updateNote',
            stripId,
            text
        })
    }

    function updateRemarks(stripId: string, text: string) {
        // Optimistic update
        const strip = strips.value.get(stripId)
        if (strip) {
            strips.value.set(stripId, { ...strip, remarks: text || undefined })
            stripsVersion.value++
        }

        sendMessage({
            type: 'updateRemarks',
            stripId,
            text
        })
    }

    function releaseStrip(stripId: string) {
        sendMessage({
            type: 'releaseStrip',
            stripId
        })
    }

    function manualTransfer(stripId: string, targetCallsign: string) {
        sendMessage({
            type: 'manualTransfer',
            stripId,
            targetCallsign
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
        layout,
        strips,
        stripsVersion,
        markManualOrder,
        clearManualOrder,
        hasManualOrder,
        reindexTopStripsByIds,
        syncTimeSortSectionFromDom,
        bumpStripsVersion,
        gaps,
        myCallsign,
        myAirports,
        myRole,
        isController,
        multiAirport,
        activeAirports,
        esAirports,
        columnAirports,
        columnCount,
        airportOptions,
        airportMeta,
        idleAirports,
        pendingIdleSwap,
        flashingColumnIndex,
        newlyActiveAirports,
        columnColor,
        setColumnAirport,
        assignAirportToColumn,
        addActiveAirport,
        removeActiveAirport,
        setColumnCount,
        adjustColumnCount,
        selectIdleForSwap,
        clearPendingIdleSwap,
        applyPendingIdleToColumn,
        flashColumnForAirport,
        isNewlyActiveAirport,
        isAirportRelevant,
        airportHasTraffic,
        airportTrafficCounts,
        fetchAirportOptions,
        displayAirports,
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
        sendAssignment,
        deleteStrip,
        GAP_BUFFER,
        atisInfo,
        dclStatus,
        dclError,
        dclMode,
        dclLogin,
        dclLogout,
        dclSend,
        dclReject,
        dclSetMode,
        viffRea,
        viffUpdateEobt,
        viffUpdateTobt,
        viffReadyTobt,
        availableConfigs,
        activeConfig,
        switchConfig,
        sendRequest,
        connect,
        refresh,
        createStrip,
        updateNote,
        updateRemarks,
        autoMoveData,
        controllers,
        releaseStrip,
        manualTransfer,
        dclSoundEnabled,
        flashChangedTimes,
        flashTsatWindow,
        showStripOwnership,
        dimOtherOwnedStrips,
        transferSoundsEnabled,
        updateUserSettings,
    }
})
