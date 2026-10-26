import { defineStore } from "pinia"
import { ref, computed, watch } from "vue"
import type { FlightStrip, EfsLayout, Gap, Section, ClientMessage, AssignmentType, AirportAtisInfo, ConfigInfo, DclMode, ControllerInfo, UiSettings, AutoLopSsrMode, AutoFitStripSizeMode, DeletedStripInfo, AupR16Status, StripPrintSound, StripPrintMode, PendingPrintFlightInfo, StripLook, PaperInfoKind, EssaSepIndicators, EssaSepOverrides, EssaSepField } from "@vatefs/common"
import {
    isServerMessage,
    GAP_BUFFER,
    gapKey,
    DEFAULT_UI_SETTINGS,
    isAutoFitStripSizeMode,
    isAutoLopSsrMode,
    resolveEssaRwyConfigId,
    computeEssaSepIndicators,
    mergeEssaSepIndicators,
    nextEssaSepCycleValue,
    extractTmaExitPoint,
    formatAhdVectorSidDisplay,
    formatSidForDisplay,
    formatStripAltitude,
    parseAltitudeToFeet,
    DEFAULT_TRANSITION_ALTITUDE_FT,
    hasForcedSidInRoute,
    hasVectRemark,
    isEsmsAutoCoordReplyAltitude,
    isEsmsAutoCoordSid,
    isIfrSidEligible,
    isTrackSidName,
    isLopFprDepAirport,
    fprDepDisplayFix,
    hasSlowRemark,
    requiresSsrCoordination,
    sidsMatch,
    withVectRemark,
    canonicalPushStartSectionId,
    essaRnpCflLabel,
} from "@vatefs/common"
import {
    collapseExpandersOnLeaveCdAllOrTsat,
    collapseTopExpanderOnCdAllToTsatIfNoCtot,
} from "@/composables/useStripExpanders"
import {
    playStripPrintSound,
    getStripPrintDurationMs,
    isStripPrintSound,
} from "@/composables/useStripPrintSound"
import { driveAnimationWallClock } from "@/composables/wallClockAnimation"
import {
    applyRtcCoverageDefaults,
    resetRtcBayLayout,
    swapRtcBayExtras,
} from "@/composables/rtcColumnExtras"
import {
    clearStripScribbles,
    pushRisingDiagonalLeftCol,
    setStripScribbles,
    getStripScribbles,
    type ScribbleStroke,
} from "@/composables/useStripScribbles"
import type { ScribbleStrokePayload } from "@vatefs/common"

function isStripPrintMode(value: unknown): value is StripPrintMode {
    return value === 'auto' || value === 'manual'
}

export const useEfsStore = defineStore("efs", () => {

    let socket: WebSocket | undefined = undefined

    const connected = ref(false)
    /** EuroScope plugin sending UDP (from status.pluginConnected) */
    const pluginConnected = ref(false)
    /** Installed VatEFS / backend version */
    const backendVersion = ref<string | undefined>()
    /** Version pushed by the loaded ES plugin (myselfUpdate) */
    const pluginVersion = ref<string | undefined>()
    /** Primary frequency MHz from myselfUpdate */
    const myFrequency = ref<number | undefined>()
    /** Connection + parsing feed health */
    const feeds = ref<import('@vatefs/common').FeedsStatus | null>(null)
    const layout = ref<EfsLayout>({ bays: [] })
    const strips = ref<Map<string, FlightStrip>>(new Map())
    /** Bumps on every strip add/update/delete so list computeds (e.g. time-sort) always re-run */
    const stripsVersion = ref(0)
    /** Sections where the user manually reordered; time-sort resumes when E/TOBT or TSAT changes */
    const manualOrderSections = ref<Set<string>>(new Set())
    /** Explicit TOBT/TSAT/VCH vs MAN mode for CD ALL / TSAT / REQ PUSH */
    type SectionSortMode = 'time' | 'man' | 'vch'
    const sectionSortModes = ref<Map<string, SectionSortMode>>(new Map())
    const gaps = ref<Map<string, Gap>>(new Map())  // key: bayId:sectionId:index
    /** Soft-deleted strips for trash recovery (also mirrored to localStorage for WS reconnect). */
    const DELETED_STRIPS_STORAGE_KEY = 'efs/deletedStrips'
    const deletedStrips = ref<DeletedStripInfo[]>(loadPersistedDeletedStrips())

    function loadPersistedDeletedStrips(): DeletedStripInfo[] {
        try {
            const raw = localStorage.getItem(DELETED_STRIPS_STORAGE_KEY)
            if (!raw) return []
            const parsed = JSON.parse(raw)
            if (!Array.isArray(parsed)) return []
            return parsed.filter(
                (s): s is DeletedStripInfo =>
                    !!s && typeof s === 'object' && typeof s.stripId === 'string' && typeof s.deletedAt === 'number',
            )
        } catch {
            return []
        }
    }

    function persistDeletedStrips(list: DeletedStripInfo[]) {
        try {
            localStorage.setItem(DELETED_STRIPS_STORAGE_KEY, JSON.stringify(list))
        } catch {
            /* quota / private mode — ignore */
        }
    }

    function applyDeletedStrips(list: DeletedStripInfo[]) {
        deletedStrips.value = list
        persistDeletedStrips(list)
    }

    const TIME_SORT_SECTION_IDS = new Set(['pending_dep', 'cleared', 'dep'])
    const SECTION_SORT_MODE_PREFIX = 'efs/sectionSortMode/'

    /** E/TOBT–TSAT sort: pending/cleared(/tsat/eobt), or RTC bay*_dep / *_clr — not ctr_dep */
    function isTimeSortSectionId(sectionId: string): boolean {
        if (TIME_SORT_SECTION_IDS.has(sectionId)) return true
        if (
            sectionId === 'cleared_tsat' ||
            sectionId === 'cleared_eobt' ||
            sectionId.endsWith('_pending_dep') ||
            sectionId.endsWith('_cleared')
        ) {
            return true
        }
        // RTC DEP / CLR (earliest EOBT on top)
        return /^(bay\d+|idle)_(dep|clr)$/.test(sectionId)
    }

    /** RTC ARR/CTR(/merged): ETA auto-sort with sticky manual after drag */
    function isRtcArrEtaSortSectionId(sectionId: string): boolean {
        return (
            sectionId === 'arr' ||
            sectionId === 'app' ||
            /^(bay\d+|idle)_(arr|app|arr_app)$/.test(sectionId)
        )
    }

    /** CD ALL / TSAT (/EOBT) — sections that show time|MAN controls (not REQ PUSH) */
    function isModeToggleSectionId(sectionId: string): boolean {
        return (
            sectionId === 'pending_dep' ||
            sectionId === 'cleared' ||
            sectionId === 'cleared_tsat' ||
            sectionId === 'cleared_eobt' ||
            sectionId.endsWith('_pending_dep') ||
            sectionId.endsWith('_cleared')
        )
    }

    function isReqPushSectionId(sectionId: string): boolean {
        return sectionId === 'req_push' || sectionId.endsWith('_req_push')
    }

    function sectionTitleFromLayout(sectionId: string): string | undefined {
        for (const bay of layout.value.bays) {
            const section = bay.sections.find((s) => s.id === sectionId)
            if (section) return section.title
        }
        return undefined
    }

    /**
     * INBOUND / INBOUND APP / INBOUND ACC — always time auto-sort; never sticky manual.
     * ESGG plain INBOUND uses ETA; ESSA INBOUND APP / INBOUND ACC use ETN.
     * INBOUND TWR-* / INBOUND GND-* use appearing order + sticky like taxi.
     */
    function isInboundAppSection(sectionId: string): boolean {
        const t = (sectionTitleFromLayout(sectionId) || '').toUpperCase().trim()
        return t === 'INBOUND' || t === 'INBOUND APP' || t === 'INBOUND ACC'
    }

    /** CTR DEP — always ATD auto-sort (earliest at top); never sticky manual */
    function isCtrDepSectionId(sectionId: string): boolean {
        return sectionId === 'ctr_dep' || sectionId.endsWith('_ctr_dep')
    }

    function sectionOrderKey(bayId: string, sectionId: string): string {
        return `${bayId}:${sectionId}`
    }

    function loadSectionSortMode(key: string): SectionSortMode | undefined {
        try {
            const stored = sessionStorage.getItem(SECTION_SORT_MODE_PREFIX + key)
            if (stored === 'time' || stored === 'man' || stored === 'vch') return stored
        } catch {
            /* ignore */
        }
        return undefined
    }

    function persistSectionSortMode(key: string, mode: SectionSortMode) {
        try {
            sessionStorage.setItem(SECTION_SORT_MODE_PREFIX + key, mode)
        } catch {
            /* ignore */
        }
    }

    function getSectionSortMode(bayId: string, sectionId: string): SectionSortMode {
        const key = sectionOrderKey(bayId, sectionId)
        const fallback: SectionSortMode = isReqPushSectionId(sectionId) ? 'vch' : 'time'
        return sectionSortModes.value.get(key) ?? loadSectionSortMode(key) ?? fallback
    }

    function setSectionSortMode(bayId: string, sectionId: string, mode: SectionSortMode) {
        if (!isModeToggleSectionId(sectionId)) return
        const key = sectionOrderKey(bayId, sectionId)
        const next = new Map(sectionSortModes.value)
        next.set(key, mode)
        sectionSortModes.value = next
        persistSectionSortMode(key, mode)
        if (mode === 'man') {
            const man = new Set(manualOrderSections.value)
            man.add(key)
            manualOrderSections.value = man
        } else {
            const man = new Set(manualOrderSections.value)
            man.delete(key)
            manualOrderSections.value = man
        }
    }

    /**
     * Enter MAN on CD ALL / TSAT / PENDING CLR / CLEARED / merged DEP:
     * freeze `orderedIds` (current visual order) into strip positions and sync
     * flightStore via WS so add-from-top keeps that sequence.
     * Ids may span pending_dep+cleared under a merged DEP header.
     */
    function enterManualSortMode(bayId: string, sectionId: string, orderedIds: string[]) {
        if (!isModeToggleSectionId(sectionId)) return
        if (orderedIds.length > 0) {
            commitManualTopOrder(bayId, sectionId, orderedIds)
            return
        }
        setSectionSortMode(bayId, sectionId, 'man')
    }

    /**
     * Apply a visual top→bottom order as sticky MAN for a mode-toggle header.
     * Positions are global across the list (merged DEP = pending + cleared).
     * Membership section of each strip is preserved unless `movedStripId` is given
     * a `membershipSectionId` (cross-header drop into this bay).
     */
    function commitManualTopOrder(
        bayId: string,
        modeSectionId: string,
        orderedIds: string[],
        opts?: { movedStripId?: string; membershipSectionId?: string },
    ) {
        if (orderedIds.length === 0) {
            markManualOrder(bayId, modeSectionId)
            return
        }
        const groups = new Map<string, { bayId: string; sectionId: string; ids: string[] }>()
        let movedOldBay: string | undefined
        let movedOldSection: string | undefined
        let movedOldBottom: boolean | undefined
        let movedOldPosition: number | undefined
        /** Drop intent (e.g. push_back) — may differ from stored YAML sectionId */
        let movedDropIntent: string | undefined

        orderedIds.forEach((id, index) => {
            const strip = strips.value.get(id)
            if (!strip || strip.bottom) return
            if (opts?.movedStripId === id) {
                movedOldBay = strip.bayId
                movedOldSection = strip.sectionId
                movedOldBottom = strip.bottom
                movedOldPosition = strip.position
                if (opts.membershipSectionId) {
                    movedDropIntent = opts.membershipSectionId
                    strip.sectionId = canonicalPushStartSectionId(opts.membershipSectionId)
                }
            }
            strip.bayId = bayId
            strip.bottom = false
            strip.position = index
            const key = `${strip.bayId}\0${strip.sectionId}`
            let g = groups.get(key)
            if (!g) {
                g = { bayId: strip.bayId, sectionId: strip.sectionId, ids: [] }
                groups.set(key, g)
            }
            g.ids.push(id)
        })
        stripsVersion.value++

        const movedId = opts?.movedStripId
        if (movedId) {
            const strip = strips.value.get(movedId)
            const dropIntent = movedDropIntent ?? strip?.sectionId
            const pushSplitRetarget =
                !!movedDropIntent &&
                (movedDropIntent === 'push_back' || movedDropIntent === 'start_up') &&
                movedOldSection === 'push_start'
            if (
                strip &&
                (movedOldBay !== strip.bayId ||
                    movedOldSection !== strip.sectionId ||
                    movedOldBottom !== false ||
                    movedOldPosition !== strip.position ||
                    pushSplitRetarget)
            ) {
                sendMessage({
                    type: 'moveStrip',
                    stripId: movedId,
                    targetBayId: strip.bayId,
                    targetSectionId: dropIntent!,
                    position: strip.position,
                    isBottom: false,
                })
            }
        }
        for (const g of groups.values()) {
            sendMessage({
                type: 'reorderStrips',
                bayId: g.bayId,
                sectionId: g.sectionId,
                stripIds: g.ids,
            })
        }
        markManualOrder(bayId, modeSectionId)
    }

    function markManualOrder(bayId: string, sectionId: string) {
        // INBOUND APP / CTR DEP always auto-sort; never stick a manual drag order
        if (isInboundAppSection(sectionId) || isCtrDepSectionId(sectionId)) return
        if (isModeToggleSectionId(sectionId)) {
            setSectionSortMode(bayId, sectionId, 'man')
            return
        }
        // Time-sort (incl. RTC DEP/CLR) or RTC ARR/CTR ETA sort → sticky after drag
        if (!isTimeSortSectionId(sectionId) && !isRtcArrEtaSortSectionId(sectionId)) return
        const next = new Set(manualOrderSections.value)
        next.add(sectionOrderKey(bayId, sectionId))
        manualOrderSections.value = next
    }

    function clearManualOrder(bayId: string, sectionId: string) {
        const key = sectionOrderKey(bayId, sectionId)
        if (isModeToggleSectionId(sectionId)) {
            setSectionSortMode(bayId, sectionId, 'time')
            return
        }
        if (!manualOrderSections.value.has(key)) return
        const next = new Set(manualOrderSections.value)
        next.delete(key)
        manualOrderSections.value = next
    }

    function hasManualOrder(bayId: string, sectionId: string): boolean {
        if (isModeToggleSectionId(sectionId)) {
            return getSectionSortMode(bayId, sectionId) === 'man'
        }
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
    /** EuroScope position / SI */
    const myPositionId = ref<string | undefined>(undefined)
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

    // ESSA role-profile mode
    const essaRolesMode = ref(false)
    const essaRoles = ref<string[]>([])
    const essaRolesManual = ref(false)
    /** TWR AOR: runway ends we cover; null = all (solo / no split) */
    const essaCoveredRunways = ref<string[] | null>(null)

    // OTHER bay-profile mode (saab.yml + Layout / catalog; digital SAAB look)
    const saabLayoutsMode = ref(false)
    const saabLayoutId = ref<string | null>(null)
    const saabLayouts = ref<Array<{ id: string; name: string; bayCount: number }>>([])
    const saabRunwayCatalog = ref<Array<{ sectionId: string; title: string }>>([])
    /** ESSA roles or OTHER layouts — workspace catalog + bay rearrange */
    const workspaceMode = computed(() => essaRolesMode.value || saabLayoutsMode.value)
    /** Per-airport TMA/CTR ownership (ESE OWNER first-online) */
    const airportCoverage = ref<Record<string, { tma: boolean; ctr: boolean }>>({})

    // ESGG paper role picker (CD / GND / TWR)
    const esggRolesMode = ref(false)
    const esggRoles = ref<string[]>([])
    const esggRolesManual = ref(false)

    /** How many bay columns fit in the ESGG window (2–5); scroll pans the rest. */
    const ESGG_VISIBLE_COLS_KEY = 'vatefs-esgg-visible-columns'
    const esggVisibleColumns = ref(loadEsggVisibleColumns())

    function loadEsggVisibleColumns(): number {
        try {
            const n = parseInt(localStorage.getItem(ESGG_VISIBLE_COLS_KEY) || '', 10)
            if (n >= 2 && n <= 5) return n
        } catch {
            /* ignore */
        }
        return 4
    }

    function adjustEsggVisibleColumns(delta: number) {
        const next = Math.min(5, Math.max(2, esggVisibleColumns.value + delta))
        if (next === esggVisibleColumns.value) return
        esggVisibleColumns.value = next
        try {
            localStorage.setItem(ESGG_VISIBLE_COLS_KEY, String(next))
        } catch {
            /* ignore */
        }
    }

    /** Manual ESSA RWY combination id (Appendix A/B); cleared when ES runways change */
    const essaRwyConfigId = ref<string | null>(null)
    const essaRwyConfigManual = ref(false)
    /** Fingerprint of last ES ARR/DEP used to auto-clear manual RWY config */
    let essaRwyEsFingerprint = ''

    // DCL status
    const dclStatus = ref<'unavailable' | 'available' | 'connected' | 'error'>('unavailable')
    const dclError = ref<string | undefined>(undefined)
    const dclMode = ref<DclMode>('manual')
    /** Another Hoppie station already online as our DCL airport (while we are not connected). */
    const dclAirportStationOnline = ref(false)
    const dclAirport = ref<string | undefined>(undefined)

    /** CDM master ATC callsign for ESSA (null = none). */
    const cdmMasterPosition = ref<string | null>(null)
    const cdmMasterIsMe = computed(() => {
        const mine = (myCallsign.value || '').trim().toUpperCase()
        const master = (cdmMasterPosition.value || '').trim().toUpperCase()
        return !!mine && !!master && mine === master
    })
    const cdmMasterLabel = computed(() => {
        if (cdmMasterIsMe.value) return 'CDM: MASTER'
        const pos = cdmMasterPosition.value?.trim()
        return pos ? `CDM: ${pos}` : 'CDM: NO MASTER'
    })

    // Transient toast (ROF failures, etc.)
    const notifyText = ref('')
    const notifyLevel = ref<'error' | 'info'>('info')
    const notifyVisible = ref(false)
    let notifyHideTimer: ReturnType<typeof setTimeout> | null = null

    function showNotify(text: string, level: 'error' | 'info' = 'info') {
        notifyText.value = text
        notifyLevel.value = level
        notifyVisible.value = true
        if (notifyHideTimer) clearTimeout(notifyHideTimer)
        notifyHideTimer = setTimeout(() => {
            notifyVisible.value = false
            notifyHideTimer = null
        }, 8000)
    }

    function dismissNotify() {
        notifyVisible.value = false
        if (notifyHideTimer) {
            clearTimeout(notifyHideTimer)
            notifyHideTimer = null
        }
    }

    // ATIS info per airport
    const atisInfo = ref<AirportAtisInfo[]>([])

    /** ESSA WX SCC + METAR for SEP/DLV/DEP GAP (from server) */
    const essaSepScc = ref<Record<string, [number, number, number]>>({})
    const essaSepMetar = ref<string | null>(null)
    /** Last server-computed values (fallback before local recompute) */
    const essaSepFromServer = ref<EssaSepIndicators | null>(null)
    /** TWR-managed overrides (synced); absent key = auto */
    const essaSepOverrides = ref<EssaSepOverrides>({})

    /** Last seen ATIS letters + last acknowledged QNH per airport */
    type AtisAckSnapshot = {
        arrAtis?: string
        depAtis?: string
        atis?: string
        qnh?: number
    }
    const atisAckByAirport = ref<Record<string, AtisAckSnapshot>>({})

    /** Airports whose ATIS letter is briefly flashing (auto-clears; no ack). */
    const atisLetterFlashAirports = ref<string[]>([])
    const atisLetterFlashTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const ATIS_LETTER_FLASH_MS = 4000

    function atisSnapshot(info: AirportAtisInfo): AtisAckSnapshot {
        return {
            arrAtis: info.arrAtis,
            depAtis: info.depAtis,
            atis: info.atis,
            qnh: info.qnh,
        }
    }

    function atisLettersEqual(info: AirportAtisInfo, snap: AtisAckSnapshot): boolean {
        return (
            (info.arrAtis || '') === (snap.arrAtis || '') &&
            (info.depAtis || '') === (snap.depAtis || '') &&
            (info.atis || '') === (snap.atis || '')
        )
    }

    function startAtisLetterFlash(airport: string) {
        if (!atisLetterFlashAirports.value.includes(airport)) {
            atisLetterFlashAirports.value = [...atisLetterFlashAirports.value, airport]
        }
        const existing = atisLetterFlashTimers.get(airport)
        if (existing) clearTimeout(existing)
        atisLetterFlashTimers.set(airport, setTimeout(() => {
            atisLetterFlashAirports.value = atisLetterFlashAirports.value.filter((a) => a !== airport)
            atisLetterFlashTimers.delete(airport)
        }, ATIS_LETTER_FLASH_MS))
    }

    function applyAtisUpdate(airports: AirportAtisInfo[]) {
        atisInfo.value = airports
        const nextAck = { ...atisAckByAirport.value }
        for (const a of airports) {
            // First sighting: baseline letters + QNH so we don't flash on connect
            const prev = nextAck[a.airport]
            if (!prev) {
                nextAck[a.airport] = atisSnapshot(a)
                continue
            }
            const letterChanged = !atisLettersEqual(a, prev)
            if (letterChanged) {
                // Temporary informational flash; advance letter baseline immediately (no sticky ack)
                startAtisLetterFlash(a.airport)
                nextAck[a.airport] = {
                    ...prev,
                    arrAtis: a.arrAtis,
                    depAtis: a.depAtis,
                    atis: a.atis,
                    // Keep prior QNH ack until user confirms a real QNH change
                    qnh: prev.qnh,
                }
            }
            // QNH: leave ack.qnh unchanged so isQnhChanged stays sticky until acknowledgeQnh
        }
        atisAckByAirport.value = nextAck
    }

    /** Acknowledge current QNH for an airport (clears amber). ATIS letters auto-clear. */
    function acknowledgeQnh(airport: string) {
        const info = atisInfo.value.find((a) => a.airport === airport)
        if (!info) return
        const prev = atisAckByAirport.value[airport]
        atisAckByAirport.value = {
            ...atisAckByAirport.value,
            [airport]: {
                arrAtis: prev?.arrAtis ?? info.arrAtis,
                depAtis: prev?.depAtis ?? info.depAtis,
                atis: prev?.atis ?? info.atis,
                qnh: info.qnh,
            },
        }
    }

    function isAtisLetterChanged(airport: string): boolean {
        return atisLetterFlashAirports.value.includes(airport)
    }

    function isQnhChanged(airport: string): boolean {
        const info = atisInfo.value.find((a) => a.airport === airport)
        const ack = atisAckByAirport.value[airport]
        if (!info || !ack) return false
        return (info.qnh ?? null) !== (ack.qnh ?? null)
    }

    /** Active ESSA ARR/DEP from EuroScope (via ATIS/rwyconfig) */
    const essaEsRunways = computed(() => {
        const info = atisInfo.value.find(a => a.airport === 'ESSA') ?? atisInfo.value[0]
        if (!info) return { arr: [] as string[], dep: [] as string[] }
        return { arr: info.arrRunways ?? [], dep: info.depRunways ?? [] }
    })

    /** AUP R16 status ("R16 utökad"); null until the backend has sent one */
    const aupR16 = ref<AupR16Status | null>(null)

    /** Synced RWY occupied/closed flags (server authority; not localStorage). */
    const activeRwyFlags = ref<Set<string>>(new Set())
    /** Bump so Vue tracks Set membership changes. */
    const activeRwyFlagsVersion = ref(0)

    function applyRwyFlags(active: string[]) {
        activeRwyFlags.value = new Set(active.filter((x) => typeof x === 'string' && x.includes(':')))
        activeRwyFlagsVersion.value++
    }

    function isRwyFlagActive(flagId: string): boolean {
        void activeRwyFlagsVersion.value
        return activeRwyFlags.value.has(flagId)
    }

    function setRwyFlag(flagId: string, active: boolean) {
        const id = (flagId || '').trim()
        if (!id) return
        const next = new Set(activeRwyFlags.value)
        if (active) next.add(id)
        else next.delete(id)
        activeRwyFlags.value = next
        activeRwyFlagsVersion.value++
        sendMessage({ type: 'setRwyFlag', flagId: id, active })
    }

    /**
     * AUTO-mode preference from AUP R16 (9C / 15C). Ignored in manual RWY mode —
     * a manual config lock always wins (see essaRwyConfigIdResolved).
     */
    const essaRwyAutoPreferId = computed<string | null>(() => {
        if (essaRwyConfigManual.value) return null
        const r = aupR16.value
        return r?.active && r.suggestConfigId ? r.suggestConfigId : null
    })

    /** Resolved ESSA RWY config id (manual override or ES + night/day auto, R16 utökad hint) */
    const essaRwyConfigIdResolved = computed(() => {
        if (essaRwyConfigManual.value && essaRwyConfigId.value) return essaRwyConfigId.value
        const { arr, dep } = essaEsRunways.value
        return resolveEssaRwyConfigId(arr, dep, new Date(), {
            preferConfigId: essaRwyAutoPreferId.value,
        })
    })

    /**
     * ESSA top-bar SEP / DLV / DEP GAP — recomputed with local RWY config lock +
     * SCC/METAR from server, then TWR overrides applied.
     */
    const essaSepIndicators = computed<EssaSepIndicators>(() => {
        const { arr, dep } = essaEsRunways.value
        const sccMap = new Map<string, [number, number, number]>()
        for (const [k, v] of Object.entries(essaSepScc.value)) {
            if (Array.isArray(v) && v.length === 3) sccMap.set(k, v)
        }
        const auto =
            sccMap.size === 0 && !essaSepMetar.value && essaSepFromServer.value
                ? essaSepFromServer.value
                : computeEssaSepIndicators({
                      configId: essaRwyConfigIdResolved.value,
                      arrRunways: arr,
                      depRunways: dep,
                      sccByDesignator: sccMap,
                      metar: essaSepMetar.value,
                  })
        return mergeEssaSepIndicators(auto, essaSepOverrides.value)
    })

    function isEssaSepOverrideActive(field: EssaSepField): boolean {
        return essaSepOverrides.value[field] !== undefined
    }

    /** TWR: cycle SEP/DLV/DEP GAP preset (ends with clear → auto). */
    function cycleEssaSepField(field: EssaSepField) {
        if (!essaRolesMode.value) return
        const canEdit = essaRoles.value.some(
            (r) => r === 'TWR-E' || r === 'TWR-W' || r.startsWith('TWR')
        )
        if (!canEdit) return
        const effective = essaSepIndicators.value[field]
        const hasOverride = isEssaSepOverrideActive(field)
        const next = nextEssaSepCycleValue(field, effective, hasOverride)
        // Optimistic local apply
        const nextOverrides = { ...essaSepOverrides.value }
        if (next === null) delete nextOverrides[field]
        else nextOverrides[field] = next
        essaSepOverrides.value = nextOverrides
        sendMessage({
            type: 'setEssaSepIndicators',
            [field]: next,
        })
    }

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
    const showAppDepXcFrequency = ref(DEFAULT_UI_SETTINGS.showAppDepXcFrequency)
    const autoParkEnabled = ref(DEFAULT_UI_SETTINGS.autoParkEnabled)
    const autoLopSsr = ref<AutoLopSsrMode>(DEFAULT_UI_SETTINGS.autoLopSsr)
    const rtcAssrSimulation = ref(DEFAULT_UI_SETTINGS.rtcAssrSimulation)
    const contactMeEnabled = ref(DEFAULT_UI_SETTINGS.contactMeEnabled)
    /** Strip ids that left verbal-SSR hide mode (show live ES ASSR). */
    const ssrCoordOverrideIds = ref(new Set<string>())
    /** Manual (non-ES) SSR codes while in coordination hide mode. */
    const manualSsrByStripId = ref(new Map<string, string>())
    const showTobtSetByA = ref(DEFAULT_UI_SETTINGS.showTobtSetByA)
    const stripPrintSound = ref<StripPrintSound>(DEFAULT_UI_SETTINGS.stripPrintSound)
    const stripPrintMode = ref<StripPrintMode>(DEFAULT_UI_SETTINGS.stripPrintMode)
    const fspServerEnabled = ref(DEFAULT_UI_SETTINGS.fspServerEnabled)
    const syncEnabled = ref(DEFAULT_UI_SETTINGS.syncEnabled)
    const scribbleSyncUrl = ref(DEFAULT_UI_SETTINGS.scribbleSyncUrl)
    const vatsimCid = ref(DEFAULT_UI_SETTINGS.vatsimCid)
    const scribbleSyncRealm = ref(DEFAULT_UI_SETTINGS.scribbleSyncRealm)
    const hoppieLogonCode = ref(DEFAULT_UI_SETTINGS.hoppieLogonCode)
    const autoFitStripSizeMode = ref<AutoFitStripSizeMode>(DEFAULT_UI_SETTINGS.autoFitStripSizeMode)
    const autoFitStripSizeGrowBack = ref(DEFAULT_UI_SETTINGS.autoFitStripSizeGrowBack)
    /** Handover Assistant: auto-ASSUME inbound HA transfers (default on) */
    const handoverAssistantAutoAssume = ref(DEFAULT_UI_SETTINGS.handoverAssistantAutoAssume)
    /** Handover Assistant dialog open */
    const handoverAssistantOpen = ref(false)
    /** Last primed primary freq (MHz) — used to prefer matching targets after unprime */
    const handoverAssistantPreferredFreq = ref<number | undefined>()
    let lastPrimedFrequency: number | undefined
    /**
     * Wall-clock ms when primary became primed this session.
     * Switching between two primed frequencies keeps the same start (continuous priming).
     * Cleared on unprime. Used to suppress Handover Assistant auto-open until ≥5 min.
     */
    let primaryPrimedSinceMs: number | undefined
    const HANDOVER_AUTO_OPEN_MIN_PRIMED_MS = 5 * 60 * 1000
    /** True when TopSkyCPDLChoppieCode.txt has a valid code (backend). */
    const hoppieFileCodePresent = ref(false)
    /** True after first userSettings apply — used for one-shot CID prompt */
    const userSettingsLoaded = ref(false)
    const vatIrisSignInOpen = ref(false)
    const vatIrisSignInDetail = ref<string | undefined>()
    /** Strip chrome from active config (`paper` = ESGG FPS print features) */
    const stripLook = ref<StripLook>('saab')
    const pendingPrintFlights = ref<PendingPrintFlightInfo[]>([])
    /** Backend: any myAirport has GNG stand data */
    const autoParkAvailable = ref(false)

    const cidDialogOpen = ref(false)
    const cidDialogSuggested = ref<string | undefined>()
    const cidDialogReason = ref<'missing' | 'command' | undefined>()

    const isPaperLook = computed(() => stripLook.value === 'paper')

    /** Skip print sounds during bulk sync (connect / refresh / config switch). */
    let suppressPrintSoundUntil = 0
    function suppressStripPrintSounds(ms = 2000) {
        suppressPrintSoundUntil = Math.max(suppressPrintSoundUntil, Date.now() + ms)
    }

    function applyUserSettings(settings: UiSettings, available?: boolean, fileCodePresent?: boolean) {
        dclSoundEnabled.value = settings.dclSoundEnabled
        flashChangedTimes.value = settings.flashChangedTimes
        flashTsatWindow.value = settings.flashTsatWindow
        showStripOwnership.value = settings.showStripOwnership
        dimOtherOwnedStrips.value = settings.dimOtherOwnedStrips
        transferSoundsEnabled.value = settings.transferSoundsEnabled
        showAppDepXcFrequency.value = settings.showAppDepXcFrequency
        autoParkEnabled.value =
            typeof settings.autoParkEnabled === 'boolean'
                ? settings.autoParkEnabled
                : DEFAULT_UI_SETTINGS.autoParkEnabled
        autoLopSsr.value = isAutoLopSsrMode(settings.autoLopSsr)
            ? settings.autoLopSsr
            : DEFAULT_UI_SETTINGS.autoLopSsr
        {
            const legacy = (settings as UiSettings & { rtcSsrSimulation?: boolean }).rtcSsrSimulation
            rtcAssrSimulation.value =
                typeof settings.rtcAssrSimulation === 'boolean'
                    ? settings.rtcAssrSimulation
                    : typeof legacy === 'boolean'
                      ? legacy
                      : DEFAULT_UI_SETTINGS.rtcAssrSimulation
        }
        contactMeEnabled.value =
            typeof settings.contactMeEnabled === 'boolean'
                ? settings.contactMeEnabled
                : DEFAULT_UI_SETTINGS.contactMeEnabled
        showTobtSetByA.value =
            typeof settings.showTobtSetByA === 'boolean'
                ? settings.showTobtSetByA
                : DEFAULT_UI_SETTINGS.showTobtSetByA
        stripPrintSound.value = isStripPrintSound(settings.stripPrintSound)
            ? settings.stripPrintSound
            : DEFAULT_UI_SETTINGS.stripPrintSound
        stripPrintMode.value = isStripPrintMode(settings.stripPrintMode)
            ? settings.stripPrintMode
            : DEFAULT_UI_SETTINGS.stripPrintMode
        fspServerEnabled.value =
            typeof settings.fspServerEnabled === 'boolean'
                ? settings.fspServerEnabled
                : DEFAULT_UI_SETTINGS.fspServerEnabled
        syncEnabled.value =
            typeof settings.syncEnabled === 'boolean'
                ? settings.syncEnabled
                : DEFAULT_UI_SETTINGS.syncEnabled
        scribbleSyncUrl.value =
            typeof settings.scribbleSyncUrl === 'string'
                ? settings.scribbleSyncUrl
                : DEFAULT_UI_SETTINGS.scribbleSyncUrl
        vatsimCid.value =
            typeof settings.vatsimCid === 'string' ? settings.vatsimCid : DEFAULT_UI_SETTINGS.vatsimCid
        scribbleSyncRealm.value =
            settings.scribbleSyncRealm === 'live' ||
            settings.scribbleSyncRealm === 'sweatbox' ||
            settings.scribbleSyncRealm === 'playback' ||
            settings.scribbleSyncRealm === 'local' ||
            settings.scribbleSyncRealm === 'auto'
                ? settings.scribbleSyncRealm
                : DEFAULT_UI_SETTINGS.scribbleSyncRealm
        hoppieLogonCode.value =
            typeof settings.hoppieLogonCode === 'string'
                ? settings.hoppieLogonCode
                : DEFAULT_UI_SETTINGS.hoppieLogonCode
        autoFitStripSizeMode.value = isAutoFitStripSizeMode(settings.autoFitStripSizeMode)
            ? settings.autoFitStripSizeMode
            : DEFAULT_UI_SETTINGS.autoFitStripSizeMode
        autoFitStripSizeGrowBack.value =
            typeof settings.autoFitStripSizeGrowBack === 'boolean'
                ? settings.autoFitStripSizeGrowBack
                : DEFAULT_UI_SETTINGS.autoFitStripSizeGrowBack
        handoverAssistantAutoAssume.value =
            typeof settings.handoverAssistantAutoAssume === 'boolean'
                ? settings.handoverAssistantAutoAssume
                : DEFAULT_UI_SETTINGS.handoverAssistantAutoAssume
        if (typeof fileCodePresent === 'boolean') hoppieFileCodePresent.value = fileCodePresent
        if (typeof available === 'boolean') autoParkAvailable.value = available
        userSettingsLoaded.value = true
    }

    /** Update one or more UI settings (optimistic local apply + persist via backend). */
    function updateUserSettings(partial: Partial<UiSettings>) {
        if (typeof partial.dclSoundEnabled === 'boolean') dclSoundEnabled.value = partial.dclSoundEnabled
        if (typeof partial.flashChangedTimes === 'boolean') flashChangedTimes.value = partial.flashChangedTimes
        if (typeof partial.flashTsatWindow === 'boolean') flashTsatWindow.value = partial.flashTsatWindow
        if (typeof partial.showStripOwnership === 'boolean') showStripOwnership.value = partial.showStripOwnership
        if (typeof partial.dimOtherOwnedStrips === 'boolean') dimOtherOwnedStrips.value = partial.dimOtherOwnedStrips
        if (typeof partial.transferSoundsEnabled === 'boolean') transferSoundsEnabled.value = partial.transferSoundsEnabled
        if (typeof partial.showAppDepXcFrequency === 'boolean') showAppDepXcFrequency.value = partial.showAppDepXcFrequency
        if (typeof partial.autoParkEnabled === 'boolean') autoParkEnabled.value = partial.autoParkEnabled
        if (isAutoLopSsrMode(partial.autoLopSsr)) autoLopSsr.value = partial.autoLopSsr
        if (typeof partial.rtcAssrSimulation === 'boolean') rtcAssrSimulation.value = partial.rtcAssrSimulation
        if (typeof partial.contactMeEnabled === 'boolean') contactMeEnabled.value = partial.contactMeEnabled
        if (typeof partial.showTobtSetByA === 'boolean') showTobtSetByA.value = partial.showTobtSetByA
        if (isStripPrintSound(partial.stripPrintSound)) stripPrintSound.value = partial.stripPrintSound
        if (isStripPrintMode(partial.stripPrintMode)) stripPrintMode.value = partial.stripPrintMode
        if (typeof partial.fspServerEnabled === 'boolean') fspServerEnabled.value = partial.fspServerEnabled
        if (typeof partial.syncEnabled === 'boolean') syncEnabled.value = partial.syncEnabled
        if (typeof partial.scribbleSyncUrl === 'string') scribbleSyncUrl.value = partial.scribbleSyncUrl
        if (typeof partial.vatsimCid === 'string') vatsimCid.value = partial.vatsimCid
        if (typeof partial.hoppieLogonCode === 'string') hoppieLogonCode.value = partial.hoppieLogonCode.trim()
        if (isAutoFitStripSizeMode(partial.autoFitStripSizeMode)) {
            autoFitStripSizeMode.value = partial.autoFitStripSizeMode
        }
        if (typeof partial.autoFitStripSizeGrowBack === 'boolean') {
            autoFitStripSizeGrowBack.value = partial.autoFitStripSizeGrowBack
        }
        if (typeof partial.handoverAssistantAutoAssume === 'boolean') {
            handoverAssistantAutoAssume.value = partial.handoverAssistantAutoAssume
        }
        if (
            partial.scribbleSyncRealm === 'auto' ||
            partial.scribbleSyncRealm === 'live' ||
            partial.scribbleSyncRealm === 'sweatbox' ||
            partial.scribbleSyncRealm === 'playback' ||
            partial.scribbleSyncRealm === 'local'
        ) {
            scribbleSyncRealm.value = partial.scribbleSyncRealm
        }
        sendMessage({ type: 'updateUserSettings', settings: partial })
    }

    function isPrimedPrimaryFrequency(frequency: number | undefined | null): boolean {
        if (frequency == null || !(frequency > 0)) return false
        if (Math.abs(frequency - 199.998) <= 0.001) return false
        if (Math.abs(frequency - 199.98) <= 0.001) return false
        return true
    }

    function countAssumedFlightStrips(): number {
        let n = 0
        for (const s of strips.value.values()) {
            if (s.isAssumed && s.stripType !== 'note' && s.stripType !== 'vehicle') n++
        }
        return n
    }

    /** Open Handover Assistant (manual menu or auto on unprime). */
    function openHandoverAssistant(opts?: { preferredFrequency?: number; reason?: string }) {
        if (opts?.preferredFrequency != null && isPrimedPrimaryFrequency(opts.preferredFrequency)) {
            handoverAssistantPreferredFreq.value = opts.preferredFrequency
        } else if (lastPrimedFrequency != null) {
            handoverAssistantPreferredFreq.value = lastPrimedFrequency
        }
        handoverAssistantOpen.value = true
        if (opts?.reason) {
            console.log(`[Handover Assistant] Open (${opts.reason})`)
        }
    }

    function closeHandoverAssistant() {
        handoverAssistantOpen.value = false
    }

    /**
     * Track primary frequency for unprime → auto-open Handover Assistant.
     * Call whenever myFrequency is updated from status / myselfUpdate.
     * Auto-open only if primary was primed ≥5 minutes (avoids connect-time false opens).
     * Manual menu open is not gated here.
     */
    function onMyFrequencyUpdated(next: number | undefined) {
        const prev = myFrequency.value
        const wasPrimed = isPrimedPrimaryFrequency(prev)
        const nowPrimed = isPrimedPrimaryFrequency(next)
        if (wasPrimed && prev != null) {
            lastPrimedFrequency = prev
        }
        myFrequency.value = next

        if (!wasPrimed && nowPrimed) {
            // Fresh prime (connect or after unprime) — start the session timer
            primaryPrimedSinceMs = Date.now()
        } else if (wasPrimed && nowPrimed) {
            // Primed → primed (freq/AoR switch): keep timer; still continuous priming
            if (primaryPrimedSinceMs == null) {
                primaryPrimedSinceMs = Date.now()
            }
        } else if (wasPrimed && !nowPrimed) {
            const primedMs =
                primaryPrimedSinceMs != null ? Date.now() - primaryPrimedSinceMs : 0
            primaryPrimedSinceMs = undefined
            if (
                primedMs >= HANDOVER_AUTO_OPEN_MIN_PRIMED_MS &&
                countAssumedFlightStrips() > 0
            ) {
                openHandoverAssistant({
                    preferredFrequency: lastPrimedFrequency,
                    reason: 'primary frequency dropped',
                })
            } else if (countAssumedFlightStrips() > 0) {
                console.log(
                    `[Handover Assistant] Skip auto-open (primed only ${(primedMs / 1000).toFixed(0)}s, need ≥300s)`,
                )
            }
        } else {
            // Unprimed → unprimed
            primaryPrimedSinceMs = undefined
        }
    }

    function applyScribbleUpdate(stripId: string, strokes: ScribbleStrokePayload[]) {
        const local: ScribbleStroke[] = strokes.map((s) => {
            const color =
                s.color === 'red' || s.color === 'black' || s.color === 'blue' ? s.color : 'blue'
            const tag =
                s.tag === 'clr-read' ||
                s.tag === 'clr-correct' ||
                s.tag === 'cto' ||
                s.tag === 'ctl' ||
                s.tag === 'goa' ||
                s.tag === 'atd' ||
                s.tag === 'xfer-refuse' ||
                s.tag === 'xfer-app'
                    ? s.tag
                    : undefined
            return tag ? { points: s.points, color, tag } : { points: s.points, color }
        })
        setStripScribbles(stripId, local)
    }

    /** Persist local strokes to backend (+ fanout); optionally push to remote sync. */
    function syncStripScribbles(stripId: string, pushRemote = true) {
        const strokes = getStripScribbles(stripId)
        sendMessage({ type: 'scribbleSet', stripId, strokes })
        if (pushRemote && syncEnabled.value) {
            sendMessage({ type: 'scribbleSyncPush', stripId })
        }
    }

    function openCidDialog(suggested?: string, reason?: 'missing' | 'command') {
        cidDialogSuggested.value = suggested
        cidDialogReason.value = reason
        cidDialogOpen.value = true
        if (!suggested) sendMessage({ type: 'requestCidSuggest' })
    }

    function closeCidDialog() {
        cidDialogOpen.value = false
    }

    function submitVatsimCid(cid: string) {
        const trimmed = cid.trim()
        sendMessage({ type: 'setVatsimCid', cid: trimmed })
        vatsimCid.value = trimmed
        cidDialogOpen.value = false
    }

    function openVatIrisSignIn(detail?: string) {
        vatIrisSignInDetail.value = detail
        vatIrisSignInOpen.value = true
    }

    function closeVatIrisSignIn() {
        vatIrisSignInOpen.value = false
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
            // Server sends initial state on connect — don't print-sound the backlog
            suppressStripPrintSounds(2500)
            // Re-request trash in case the connect snapshot raced; localStorage already hydrated
            listDeletedStrips()
        }
        socket.onclose = () => {
            console.log("socket closed")
            connected.value = false
            pluginConnected.value = false
            pluginVersion.value = undefined
            // keep last feeds/backendVersion for offline display of parse state if needed
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
                        handleStripMessage(
                            message.strip,
                            message.autoMoved,
                            message.cleanReprint,
                            message.playPrintAnim,
                        )
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
                        dclAirportStationOnline.value = !!message.airportStationOnline
                        dclAirport.value = message.dclAirport
                        break
                    case 'cdmMasterStatus':
                        cdmMasterPosition.value = message.position?.trim() || null
                        break
                    case 'atisUpdate':
                        applyAtisUpdate(message.airports)
                        break
                    case 'essaSepIndicators': {
                        essaSepScc.value = message.scc ?? {}
                        essaSepMetar.value = message.metar ?? null
                        essaSepOverrides.value = { ...(message.overrides ?? {}) }
                        // Merged display values — used only when local SCC/METAR unavailable
                        essaSepFromServer.value = {
                            sep: message.sep,
                            dlv: message.dlv,
                            depGap: message.depGap,
                        }
                        break
                    }
                    case 'aupR16': {
                        const { type: _type, ...status } = message
                        aupR16.value = status
                        break
                    }
                    case 'rwyFlags':
                        applyRwyFlags(message.active)
                        break
                    case 'configList':
                        availableConfigs.value = message.configs
                        activeConfig.value = message.activeConfig
                        if (message.saabLayouts) {
                            saabLayouts.value = message.saabLayouts
                        }
                        if (message.saabLayoutId !== undefined) {
                            saabLayoutId.value = message.saabLayoutId ?? null
                        }
                        break
                    case 'controllers':
                        controllers.value = message.controllers
                        break
                    case 'userSettings':
                        applyUserSettings(
                            message.settings,
                            message.autoParkAvailable,
                            message.hoppieFileCodePresent,
                        )
                        break
                    case 'hoppieMessage':
                        console.log(`[HOPPIE] ${message.from} (${message.messageType}): ${message.packet}`)
                        break
                    case 'notify':
                        showNotify(message.text, message.level)
                        break
                    case 'handoverAssistantResult': {
                        const transferred = message.transferred?.length ?? 0
                        const failed = message.failed ?? []
                        if (failed.length === 0) {
                            showNotify(
                                transferred > 0
                                    ? `Handover Assistant: transferred ${transferred} strip${transferred === 1 ? '' : 's'} to ${message.targetCallsign}`
                                    : 'Handover Assistant: no strips transferred',
                                'info',
                            )
                        } else {
                            const failList = failed
                                .map((f: { callsign: string; reason: string }) =>
                                    f.callsign ? `${f.callsign} (${f.reason})` : f.reason,
                                )
                                .join(', ')
                            showNotify(
                                `Handover Assistant: ${transferred} ok, ${failed.length} failed — ${failList}`,
                                'error',
                            )
                        }
                        break
                    }
                    case 'deletedStrips':
                        applyDeletedStrips(message.strips)
                        break
                    case 'pendingPrintList':
                        pendingPrintFlights.value = message.flights
                        break
                    case 'scribbleUpdate':
                        applyScribbleUpdate(message.stripId, message.strokes)
                        break
                    case 'openCidDialog':
                        openCidDialog(message.suggestedCid, message.reason)
                        break
                    case 'cidSuggest':
                        if (message.suggestedCid) cidDialogSuggested.value = message.suggestedCid
                        break
                    case 'openVatIrisSignIn':
                        openVatIrisSignIn(
                            typeof (message as { detail?: string }).detail === 'string'
                                ? (message as { detail?: string }).detail
                                : undefined,
                        )
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
    /**
     * Strip ids whose destination instance must stay invisible until the fly-clone
     * finishes. Reactive and set *before* the strip map update so the first paint
     * of the remounted destination strip is already hidden (avoids ghost/double).
     */
    const autoMovingStripIds = ref<Set<string>>(new Set())

    function beginAutoMove(stripId: string) {
        if (autoMovingStripIds.value.has(stripId)) return
        const next = new Set(autoMovingStripIds.value)
        next.add(stripId)
        autoMovingStripIds.value = next
    }

    function endAutoMove(stripId: string) {
        if (!autoMovingStripIds.value.has(stripId)) return
        const next = new Set(autoMovingStripIds.value)
        next.delete(stripId)
        autoMovingStripIds.value = next
    }

    /**
     * Paper print animation: destination strip stays hidden while a clone
     * "prints" at bottom-right (sound length) then flies to the bay slot.
     */
    const printingStripIds = ref<Set<string>>(new Set())
    const printAnimDurationMs = new Map<string, number>()

    /** Callsigns awaiting print animation after Print dialog / printStrip. */
    const pendingPrintAnimCallsigns = new Set<string>()

    function beginPrintAnim(stripId: string, durationMs: number) {
        printAnimDurationMs.set(stripId, durationMs)
        if (printingStripIds.value.has(stripId)) return
        const next = new Set(printingStripIds.value)
        next.add(stripId)
        printingStripIds.value = next
    }

    function endPrintAnim(stripId: string) {
        printAnimDurationMs.delete(stripId)
        if (!printingStripIds.value.has(stripId)) return
        const next = new Set(printingStripIds.value)
        next.delete(stripId)
        printingStripIds.value = next
    }

    function getPrintAnimDurationMs(stripId: string): number {
        return printAnimDurationMs.get(stripId) ?? getStripPrintDurationMs(stripPrintSound.value)
    }

    /** Awaiting server id, then that strip id — bay note opens zoom scribble once. */
    const PENDING_NOTE_SCRIBBLE_AWAIT = '__awaiting__'
    const pendingNoteScribbleId = ref<string | null>(null)

    function consumePendingNoteScribbleOpen(stripId: string): boolean {
        if (pendingNoteScribbleId.value !== stripId) return false
        pendingNoteScribbleId.value = null
        return true
    }

    // Handle strip message from server
    function handleStripMessage(
        strip: FlightStrip,
        autoMoved?: boolean,
        cleanReprint?: boolean,
        playPrintAnim?: boolean,
    ) {
        console.log("received strip:", strip.callsign)

        // Paper G/A APP-assume reprint: wipe freehand ink (SAAB keeps scribbles)
        if (cleanReprint && isPaperLook.value) {
            clearStripScribbles(strip.id)
        }

        const prev = strips.value.get(strip.id)

        // Automove / server relocate: cock only applies in-place — land flush
        let nextStrip = strip
        if (prev && (autoMoved || prev.bayId !== strip.bayId || prev.sectionId !== strip.sectionId || !!prev.bottom !== !!strip.bottom)) {
            const relocated =
                prev.bayId !== strip.bayId ||
                prev.sectionId !== strip.sectionId ||
                !!prev.bottom !== !!strip.bottom ||
                prev.position !== strip.position
            if (relocated && (strip.klack === 'left' || strip.klack === 'right')) {
                nextStrip = { ...strip, klack: undefined }
            }
        }

        // Capture old position and clone for fly-across animation before updating.
        // Fly is wall-clock driven so it still completes when the tab is backgrounded.
        if (autoMoved) {
            const el = document.querySelector(`[data-strip-id="${strip.id}"]`) as HTMLElement | null
            if (el) {
                const rect = el.getBoundingClientRect()
                const clone = el.cloneNode(true) as HTMLElement
                autoMoveData.set(strip.id, { rect, clone })
                // Hide destination on first paint (before stripsVersion triggers remount)
                beginAutoMove(strip.id)
            }
        }

        // Collapse before remount: leaving CD ALL/TSAT destroys the old FlightStrip
        // instance, so its sectionId watcher never sees the transition.
        if (prev) {
            collapseExpandersOnLeaveCdAllOrTsat(strip.id, prev.sectionId, strip.sectionId)
            // CD ALL → TSAT: close top expander when unregulated (no CTOT)
            collapseTopExpanderOnCdAllToTsatIfNoCtot(
                strip.id,
                prev.sectionId,
                strip.sectionId,
                strip.ctot ?? prev.ctot,
            )
        }

        const isNew = !prev
        // Clear pending Print-dialog callsign mark (manual queue / printStrip)
        const csKey = strip.callsign?.trim().toUpperCase()
        if (csKey && pendingPrintAnimCallsigns.has(csKey)) pendingPrintAnimCallsigns.delete(csKey)
        // Bottom-bar blank/info templates appear instantly; FSP API always prints with anim
        const isPaperInfoTemplate = !!(strip.paperInfoKind && strip.stripType === 'note')
        const wantPrintAnim =
            !!playPrintAnim || ((isNew || !!cleanReprint) && !isPaperInfoTemplate)
        // Paper: print with sound length; Off → appear instantly.
        // Print/fly is wall-clock driven so it still completes when the tab is backgrounded.
        if (
            wantPrintAnim &&
            isPaperLook.value &&
            Date.now() >= suppressPrintSoundUntil
        ) {
            const mode = stripPrintSound.value
            if (mode !== 'off') {
                const playedMs = playStripPrintSound(mode)
                const durationMs = playedMs > 0 ? playedMs : getStripPrintDurationMs(mode)
                beginPrintAnim(strip.id, durationMs)
            }
        }
        strips.value.set(nextStrip.id, nextStrip)
        stripsVersion.value++

        // Bind pending “open zoom” to newly created note / vehicle strip id
        if (
            isNew &&
            (nextStrip.stripType === 'note' || nextStrip.stripType === 'vehicle') &&
            pendingNoteScribbleId.value === PENDING_NOTE_SCRIBBLE_AWAIT
        ) {
            pendingNoteScribbleId.value = nextStrip.id
        }
    }

    /**
     * Paper look: fly a clone of the strip into the bottom-bar trash icon
     * (used for auto-removes; manual trash-drop already removed the DOM node).
     */
    function flyStripToTrash(stripId: string) {
        if (!isPaperLook.value) return
        const nodes = document.querySelectorAll<HTMLElement>(`[data-strip-id="${stripId}"]`)
        let el: HTMLElement | null = null
        for (const n of nodes) {
            if (!n.classList.contains('is-large-view')) {
                el = n
                break
            }
        }
        if (!el) return
        const trash = document.querySelector<HTMLElement>('.efs-trash-drop')
        if (!trash) return

        const from = el.getBoundingClientRect()
        if (from.width < 2 || from.height < 2) return
        const to = trash.getBoundingClientRect()
        const clone = el.cloneNode(true) as HTMLElement
        clone.classList.remove('auto-move-hidden', 'print-anim-hidden', 'dragging')
        clone.removeAttribute('data-strip-id')
        Object.assign(clone.style, {
            position: 'fixed',
            left: `${from.left}px`,
            top: `${from.top}px`,
            width: `${from.width}px`,
            height: `${from.height}px`,
            zIndex: '10000',
            pointerEvents: 'none',
            margin: '0',
            transition: 'none',
            opacity: '1',
            visibility: 'visible',
            transformOrigin: 'center center',
        })
        document.body.appendChild(clone)

        const destX = to.left + to.width / 2 - from.width / 2
        const destY = to.top + to.height / 2 - from.height / 2
        trash.classList.add('trash-receiving')
        const clearReceiving = () => trash.classList.remove('trash-receiving')

        const trashMs = 480
        const anim = clone.animate(
            [
                {
                    left: `${from.left}px`,
                    top: `${from.top}px`,
                    transform: 'scale(1)',
                    opacity: 1,
                },
                {
                    left: `${destX}px`,
                    top: `${destY}px`,
                    transform: 'scale(0.12)',
                    opacity: 0.25,
                },
            ],
            { duration: trashMs, easing: 'ease-in', fill: 'forwards' },
        )
        driveAnimationWallClock(anim, trashMs, () => {
            clone.remove()
            clearReceiving()
        })
    }

    // Handle strip delete message from server
    function handleStripDeleteMessage(stripId: string) {
        console.log("received strip delete:", stripId)
        // Capture DOM before unmount so auto-removed strips can fly to trash
        flyStripToTrash(stripId)
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
        suppressStripPrintSounds(2500)
        pendingLayoutHeights.value = snapshotSectionHeights()
        // Clear local state
        layout.value = { bays: [] }
        strips.value.clear()
        stripsVersion.value++
        manualOrderSections.value = new Set()
        sectionSortModes.value = new Map()
        gaps.value.clear()

        // Request fresh data from server
        sendRequest('layout')
        sendRequest('strips')
        if (!serverRequested) sendRequest('refresh')
    }

    function reloadFeeds() {
        sendMessage({ type: 'reloadFeeds' })
    }

    /** Top-bar refresh (layout/strips/plugin) plus re-parse local files and network feeds */
    function reloadAll() {
        refresh()
        reloadFeeds()
    }

    // Handle status message from server
    function handleStatusMessage(message: {
        callsign: string
        airports: string[]
        role?: string
        positionId?: string
        pluginConnected?: boolean
        feeds?: import('@vatefs/common').FeedsStatus
        backendVersion?: string
        pluginVersion?: string
        frequency?: number
        isController?: boolean
        multiAirport?: boolean
        activeAirports?: string[]
        esAirports?: string[]
        columnAirports?: (string | null)[]
        columnCount?: number
        essaRolesMode?: boolean
        essaRoles?: string[]
        essaRolesManual?: boolean
        esggRolesMode?: boolean
        esggRoles?: string[]
        esggRolesManual?: boolean
        essaCoveredRunways?: string[]
        look?: StripLook
        saabLayoutsMode?: boolean
        saabLayoutId?: string | null
        saabLayouts?: Array<{ id: string; name: string; bayCount: number }>
        saabRunwayCatalog?: Array<{ sectionId: string; title: string }>
        airportCoverage?: Record<string, { tma: boolean; ctr: boolean }>
    }) {
        myCallsign.value = message.callsign
        myAirports.value = message.airports
        myRole.value = message.role
        myPositionId.value = message.positionId || undefined
        pluginConnected.value = message.pluginConnected ?? false
        feeds.value = message.feeds ?? null
        backendVersion.value = message.backendVersion
        pluginVersion.value = message.pluginVersion
        onMyFrequencyUpdated(
            typeof message.frequency === 'number' ? message.frequency : undefined,
        )
        isController.value = message.isController ?? false
        multiAirport.value = message.multiAirport ?? false
        // Only update when present — `?? false` was clearing mode on partial status frames
        if (typeof message.essaRolesMode === 'boolean') {
            essaRolesMode.value = message.essaRolesMode
            if (!message.essaRolesMode) {
                essaRoles.value = []
                essaRolesManual.value = false
            }
        }
        if (message.essaRoles) {
            essaRoles.value = message.essaRoles
        }
        if (typeof message.essaRolesManual === 'boolean') {
            essaRolesManual.value = message.essaRolesManual
        }
        if (typeof message.esggRolesMode === 'boolean') {
            esggRolesMode.value = message.esggRolesMode
            if (!message.esggRolesMode) {
                esggRoles.value = []
                esggRolesManual.value = false
            }
        }
        if (message.esggRoles) {
            esggRoles.value = message.esggRoles
        }
        if (typeof message.esggRolesManual === 'boolean') {
            esggRolesManual.value = message.esggRolesManual
        }
        if (typeof message.saabLayoutsMode === 'boolean') {
            saabLayoutsMode.value = message.saabLayoutsMode
            if (!message.saabLayoutsMode) {
                saabLayoutId.value = null
                saabRunwayCatalog.value = []
            }
        }
        if (message.saabLayoutId !== undefined) {
            saabLayoutId.value = message.saabLayoutId ?? null
        }
        if (message.saabLayouts) {
            saabLayouts.value = message.saabLayouts
        }
        if (message.saabRunwayCatalog) {
            saabRunwayCatalog.value = message.saabRunwayCatalog
        }
        if (message.airportCoverage) {
            airportCoverage.value = message.airportCoverage
            // Fresh RTC columns: apply coverage defaults without rewriting customized extras
            if (message.multiAirport && message.columnAirports) {
                message.columnAirports.forEach((icao, idx) => {
                    if (!icao) return
                    const bayId = `bay${idx + 1}`
                    applyRtcCoverageDefaults(bayId, message.airportCoverage![icao.toUpperCase()])
                })
            }
        }
        essaCoveredRunways.value = message.essaCoveredRunways ?? null
        stripLook.value = message.look === 'paper' ? 'paper' : 'saab'
        if (stripLook.value !== 'paper') {
            pendingPrintFlights.value = []
        }
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
        // Airport already open in another column → swap airports + their CTR/TMA extras.
        // Newly selected airport (idle / picker) → apply coverage CTR/TMA defaults for this bay.
        let swapFromIndex: number | null = null
        if (airport) {
            const previous = next[columnIndex] ?? null
            for (let i = 0; i < next.length; i++) {
                if (i !== columnIndex && next[i] === airport) {
                    next[i] = previous
                    swapFromIndex = i
                }
            }
        }
        next[columnIndex] = airport
        columnAirports.value = next

        if (airport && swapFromIndex != null) {
            swapRtcBayExtras(`bay${columnIndex + 1}`, `bay${swapFromIndex + 1}`)
        } else if (airport) {
            resetRtcBayLayout(
                `bay${columnIndex + 1}`,
                airportCoverage.value[airport.toUpperCase()],
            )
        }

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
        const n = Math.max(1, Math.min(6, Math.floor(count)))
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

    // Unique accents for up to MAX columns (1–6) — RTC header/frame colours
    // Teal is warm/greyish (not icy blue); orange stays as second column
    const COLUMN_COLORS = [
        '#5c9e94',
        '#e89a3a',
        '#9a6fb0',
        '#d96b6b',
        '#6fad72',
        '#6a9ec4',
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
     * Reverse the given visual order (top→bottom ids) and sync positions.
     * Used by workspace sort-flow toggle so existing strips flip, not only new inserts.
     * Groups by bayId+sectionId for backend reorderStrips; single-group (usual) gets
     * a clean 0..n reindex. Marks manual order so time-sort does not immediately undo.
     */
    function reverseSectionStripOrder(visualTopToBottomIds: string[]) {
        if (visualTopToBottomIds.length < 2) return
        const reversed = [...visualTopToBottomIds].reverse()
        const groups = new Map<string, { bayId: string; sectionId: string; ids: string[] }>()
        for (const id of reversed) {
            const strip = strips.value.get(id)
            if (!strip) continue
            const key = `${strip.bayId}\0${strip.sectionId}`
            let g = groups.get(key)
            if (!g) {
                g = { bayId: strip.bayId, sectionId: strip.sectionId, ids: [] }
                groups.set(key, g)
            }
            g.ids.push(id)
        }
        if (groups.size === 0) return

        if (groups.size === 1) {
            const g = [...groups.values()][0]!
            g.ids.forEach((id, index) => {
                const strip = strips.value.get(id)
                if (strip) strip.position = index
            })
            stripsVersion.value++
            sendMessage({
                type: 'reorderStrips',
                bayId: g.bayId,
                sectionId: g.sectionId,
                stripIds: g.ids,
            })
            markManualOrder(g.bayId, g.sectionId)
            return
        }

        // Multi-section header: global positions keep the flipped visual order in the UI.
        reversed.forEach((id, index) => {
            const strip = strips.value.get(id)
            if (strip) strip.position = index
        })
        stripsVersion.value++
        for (const g of groups.values()) {
            sendMessage({
                type: 'reorderStrips',
                bayId: g.bayId,
                sectionId: g.sectionId,
                stripIds: g.ids,
            })
            markManualOrder(g.bayId, g.sectionId)
        }
    }

    /**
     * Before a manual move into a time-sorted section still in auto-sort mode,
     * align store positions to the current DOM order so insert indices match what the user sees.
     * Also syncs backend/flightStore (same as sticky taxi) so the following moveStrip
     * and later add-from-top use the frozen visual sequence.
     * `matchSectionIds` — merged DEP etc.: assign one visual sequence across members.
     */
    function syncTimeSortSectionFromDom(
        bayId: string,
        sectionId: string,
        container: Element | null,
        matchSectionIds?: string[],
    ) {
        if (isInboundAppSection(sectionId) || isCtrDepSectionId(sectionId)) return
        const sticky =
            isTimeSortSectionId(sectionId) ||
            isRtcArrEtaSortSectionId(sectionId) ||
            !!matchSectionIds?.some(
                (id) => isTimeSortSectionId(id) || isRtcArrEtaSortSectionId(id),
            )
        if (!sticky) return
        if (hasManualOrder(bayId, sectionId)) return
        if (!container) return
        const ids = Array.from(container.querySelectorAll<HTMLElement>('[data-strip-id]'))
            .map((el) => el.getAttribute('data-strip-id'))
            .filter((id): id is string => !!id)
        if (ids.length === 0) return
        const allowed = matchSectionIds?.length ? new Set(matchSectionIds) : null
        if (allowed) {
            ids.forEach((id, index) => {
                const strip = strips.value.get(id)
                if (!strip || strip.bottom || !allowed.has(strip.sectionId)) return
                strip.position = index
            })
            stripsVersion.value++
            const groups = new Map<string, string[]>()
            for (const id of ids) {
                const strip = strips.value.get(id)
                if (!strip || !allowed.has(strip.sectionId)) continue
                const list = groups.get(strip.sectionId) ?? []
                list.push(id)
                groups.set(strip.sectionId, list)
            }
            for (const [sec, secIds] of groups) {
                sendMessage({ type: 'reorderStrips', bayId, sectionId: sec, stripIds: secIds })
            }
            return
        }
        reindexTopStripsByIds(bayId, sectionId, ids)
        sendMessage({ type: 'reorderStrips', bayId, sectionId, stripIds: ids })
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
    /**
     * Drag lock from EuroScope assume/track owner (`ownedByOther` / ownerCallsign / ownerSi).
     * Transfer parties (in or out) may still move; otherwise only the assume owner.
     */
    function isStripOwnedByOther(strip: FlightStrip): boolean {
        if (strip.stripType === 'note' || strip.stripType === 'vehicle') return false
        if (strip.transferPending === 'in' || strip.transferPending === 'out' || strip.isAssumed) {
            return false
        }
        if (strip.ownedByOther) return true
        const owner = strip.ownerCallsign?.trim()
        const mine = myCallsign.value.trim()
        if (owner && mine && owner.toUpperCase() !== mine.toUpperCase()) return true
        // Display SI present and not assumed by me → other owner
        // (ownerSi is formatted for UI; isAssumed already covers "mine")
        if (strip.ownerSi?.trim()) return true
        return false
    }

    /** Notes/vehicles always; else assume owner, or either party while a transfer is pending. */
    function allowMoveOwnedStrip(strip: FlightStrip): boolean {
        if (strip.stripType === 'note' || strip.stripType === 'vehicle') return true
        if (strip.isAssumed) return true
        if (strip.transferPending === 'in' || strip.transferPending === 'out') return true
        return !isStripOwnedByOther(strip)
    }

    function moveStripToSection(
        stripId: string,
        targetBayId: string,
        targetSectionId: string,
        position?: number
    ) {
        const strip = strips.value.get(stripId)
        if (!strip) return
        if (!allowMoveOwnedStrip(strip)) return

        // Workspace may pass push_back / start_up — store as YAML push_start
        const dropIntentSectionId = targetSectionId
        const storeSectionId = canonicalPushStartSectionId(targetSectionId)

        const oldBayId = strip.bayId
        const oldSectionId = strip.sectionId
        const oldBottom = strip.bottom
        const oldPosition = strip.position
        const isSameSection = oldBayId === targetBayId && oldSectionId === storeSectionId
        const isSameZone = isSameSection && !oldBottom  // moving within top zone

        // Get target strips count (excluding the moving strip)
        const targetStrips = getTopStrips(targetBayId, storeSectionId).filter(s => s.id !== stripId)
        let targetPosition = resolveTargetPosition(position, targetStrips.length)

        // Paper: pending (above KLARERING) → cleared always inserts at top of CLEARED
        if (
            !isSameSection &&
            isPaperLook.value &&
            isPendingDepSectionId(oldSectionId) &&
            isClearedSectionId(storeSectionId)
        ) {
            targetPosition = 0
        }

        // Handle gaps for same-zone moves
        if (isSameZone) {
            adjustGapsForMove(targetBayId, storeSectionId, oldPosition, targetPosition)
        }

        collapseExpandersOnLeaveCdAllOrTsat(stripId, oldSectionId, storeSectionId)
        collapseTopExpanderOnCdAllToTsatIfNoCtot(stripId, oldSectionId, storeSectionId, strip.ctot)

        // Update strip location
        strip.bayId = targetBayId
        strip.sectionId = storeSectionId
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
            cleanupGaps(targetBayId, storeSectionId)
        }
        if (!isSameSection && !oldBottom) {
            cleanupGaps(oldBayId, oldSectionId)
        }

        // Cock/klack only applies in-place — any real relocate resets flush
        const relocated =
            oldBayId !== targetBayId ||
            oldSectionId !== storeSectionId ||
            !!oldBottom ||
            oldPosition !== targetPosition
        if (relocated && (strip.klack === 'left' || strip.klack === 'right')) {
            strip.klack = undefined
            sendMessage({ type: 'setKlack', stripId, klack: null })
        }

        stripsVersion.value++
        markManualOrder(targetBayId, storeSectionId)

        // Send update to server (drop intent may be push_back / start_up)
        sendMessage({
            type: 'moveStrip',
            stripId,
            targetBayId,
            targetSectionId: dropIntentSectionId,
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
        if (!allowMoveOwnedStrip(strip)) return

        const dropIntentSectionId = targetSectionId
        const storeSectionId = canonicalPushStartSectionId(targetSectionId)

        const oldBayId = strip.bayId
        const oldSectionId = strip.sectionId
        const oldBottom = strip.bottom
        const oldPosition = strip.position

        // Get target bottom strips count (excluding the moving strip)
        const targetStrips = getBottomStrips(targetBayId, storeSectionId).filter(s => s.id !== stripId)
        const targetPosition = resolveTargetPosition(position, targetStrips.length)

        collapseExpandersOnLeaveCdAllOrTsat(stripId, oldSectionId, storeSectionId)
        collapseTopExpanderOnCdAllToTsatIfNoCtot(stripId, oldSectionId, storeSectionId, strip.ctot)

        // Update strip location
        strip.bayId = targetBayId
        strip.sectionId = storeSectionId
        strip.bottom = true

        // Insert strip at target position and recompute all positions
        // targetStrips is already sorted and excludes the moving strip
        targetStrips.splice(targetPosition, 0, strip)
        reindexStrips(targetStrips)

        // Recompute old section if moved from different zone
        if (oldBayId !== targetBayId || oldSectionId !== storeSectionId || !oldBottom) {
            recomputePositions(oldBayId, oldSectionId, oldBottom)
        }

        // Cleanup gaps in old section if was in top zone
        if (!oldBottom) {
            cleanupGaps(oldBayId, oldSectionId)
        }

        // Cock/klack only applies in-place — any real relocate resets flush
        const relocated =
            oldBayId !== targetBayId ||
            oldSectionId !== storeSectionId ||
            !oldBottom ||
            oldPosition !== targetPosition
        if (relocated && (strip.klack === 'left' || strip.klack === 'right')) {
            strip.klack = undefined
            sendMessage({ type: 'setKlack', stripId, klack: null })
        }

        stripsVersion.value++

        // ESGG paper: pin tray on UTFLYGNING → rising / (backend XFERs on isBottom)
        if (
            isPaperLook.value &&
            (storeSectionId === 'ctr_dep' || storeSectionId.endsWith('_ctr_dep'))
        ) {
            pushRisingDiagonalLeftCol(stripId, 'blue', 'xfer-app')
        }

        // Send update to server (drop intent may be push_back / start_up)
        sendMessage({
            type: 'moveStrip',
            stripId,
            targetBayId,
            targetSectionId: dropIntentSectionId,
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

        // Headerless zones (paper pending above KLARERING) may shrink below the SAAB floor
        const minH = section.hideHeader ? 0 : 80
        const newHeight = Math.max(minH, height)
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

    function isPendingDepSectionId(sectionId: string): boolean {
        return sectionId === 'pending_dep' || sectionId.endsWith('_pending_dep')
    }

    function isClearedSectionId(sectionId: string): boolean {
        return (
            sectionId === 'cleared' ||
            sectionId === 'cleared_tsat' ||
            sectionId === 'cleared_eobt' ||
            sectionId.endsWith('_cleared')
        )
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

    /** IFR DEP/local — eligible for VECT / ve{exit} SID display (ARR never). */
    function isVectCapableStrip(strip: FlightStrip): boolean {
        if (strip.stripType !== 'departure' && strip.stripType !== 'local') return false
        return isIfrSidEligible(strip.flightRules)
    }

    /** Auto-set VECT on AHD only while still on ground. */
    function shouldAutoVectOnAhd(strip: FlightStrip): boolean {
        return isVectCapableStrip(strip) && strip.airborne !== true
    }

    /**
     * Set/clear AHD. For IFR DEP/local on ground: clear SID + add VECT (SID cell → ve{exit}).
     * Arrivals / airborne: heading only (no VECT).
     */
    function applyAssignedHeading(stripId: string, heading: string) {
        const strip = strips.value.get(stripId)
        if (!strip) return

        const padded = heading.trim()
        const clearing = !padded || padded === '0' || padded === '000'
        const autoVect = shouldAutoVectOnAhd(strip)

        if (clearing) {
            sendAssignment(stripId, 'assignHeading', '0')
            // Clear VECT for IFR DEP/local even if now airborne
            if (isVectCapableStrip(strip) && hasVectRemark(strip.remarks)) {
                updateRemarks(stripId, withVectRemark(strip.remarks, false))
            }
            strips.value.set(stripId, {
                ...strips.value.get(stripId)!,
                assignedHeading: undefined,
            })
            stripsVersion.value++
            return
        }

        // TopSky AHD special: localizer (ARR) — backend sets scratch /LLZ/
        if (padded.toUpperCase() === 'LLZ') {
            sendAssignment(stripId, 'assignHeading', 'LLZ')
            strips.value.set(stripId, {
                ...strips.value.get(stripId)!,
                assignedHeading: 'LLZ',
                direct: undefined,
            })
            stripsVersion.value++
            return
        }

        const hdg = String(Math.min(360, Math.max(1, parseInt(padded, 10) || 0))).padStart(3, '0')

        if (autoVect) {
            if (essaPreferredSids.value.has(stripId)) {
                const next = new Map(essaPreferredSids.value)
                next.delete(stripId)
                essaPreferredSids.value = next
            }
            if (essaPreferredCfls.value.has(stripId)) {
                const next = new Map(essaPreferredCfls.value)
                next.delete(stripId)
                essaPreferredCfls.value = next
            }
        }

        sendAssignment(stripId, 'assignHeading', hdg)

        if (autoVect && !hasVectRemark(strip.remarks)) {
            updateRemarks(stripId, withVectRemark(strip.remarks, true))
        }

        const nextRoute = (() => {
            if (!autoVect) return strip.route || ''
            const route = strip.route || ''
            if (!hasForcedSidInRoute(route)) return route
            const tokens = route.trim().split(/\s+/).filter(Boolean)
            tokens.shift()
            return tokens.join(' ')
        })()
        strips.value.set(stripId, {
            ...strips.value.get(stripId)!,
            assignedHeading: hdg,
            sid: autoVect ? undefined : strip.sid,
            direct: undefined,
            route: nextRoute,
        })
        stripsVersion.value++
    }

    /**
     * After DCT clear: optimistically put ESE preferred SID back in the SID cell
     * (display only — do not force into FPL). Backend also restores flight.sid.
     */
    async function restorePreferredSidDisplayAfterDctClear(stripId: string): Promise<void> {
        const strip = strips.value.get(stripId)
        if (!strip || strip.direct || strip.clearance) return
        if (strip.assignedHeading || hasVectRemark(strip.remarks)) return
        if (!isIfrSidEligible(strip.flightRules)) return
        if (strip.stripType !== 'departure' && strip.stripType !== 'local') return
        const airport = strip.adep
        const runway = strip.runway
        if (!airport || !runway) return
        if (hasForcedSidInRoute(strip.route)) return
        try {
            // Preferred tables (ESSA/ESMS/ESGG) or ESE exit match for other airports
            let sid: string | null = null
            if (airport === 'ESSA' || airport === 'ESMS' || airport === 'ESGG') {
                if (airport === 'ESSA' && !essaRwyConfigIdResolved.value) return
                const params = new URLSearchParams({ airport, runway })
                if (airport === 'ESSA') {
                    params.set('config', essaRwyConfigIdResolved.value!)
                    params.set('slow', hasSlowRemark(strip.remarks) || strip.isSlow ? '1' : '0')
                }
                if (airport === 'ESGG' && strip.callsign) {
                    params.set('callsign', strip.callsign)
                }
                if (strip.route) params.set('route', strip.route)
                const res = await fetch(`/api/preferred-sid?${params}`)
                if (res.ok) {
                    const data = (await res.json()) as { sid: string | null }
                    sid = data.sid
                }
            }
            if (!sid && strip.route) {
                // Fallback: first SID from /api/sids matching route exit (ESE prio)
                const tma =
                    strip.tmaExit ||
                    extractTmaExitPoint(undefined, strip.route)
                if (tma) {
                    const res = await fetch(
                        `/api/sids?airport=${encodeURIComponent(airport)}&runway=${encodeURIComponent(runway)}`,
                    )
                    if (res.ok) {
                        const list = (await res.json()) as { name: string }[]
                        const exit = tma.toUpperCase()
                        const match = list
                            .filter(
                                (s) =>
                                    s.name.toUpperCase().startsWith(exit) &&
                                    s.name.length > exit.length &&
                                    /\d/.test(s.name.slice(exit.length)),
                            )
                            .sort((a, b) => a.name.localeCompare(b.name))[0]
                        sid = match?.name ?? null
                    }
                }
            }
            if (!sid) return
            const live = strips.value.get(stripId)
            if (!live || live.direct) return
            strips.value.set(stripId, { ...live, sid })
            stripsVersion.value++
        } catch {
            // ignore
        }
    }

    /**
     * Set/clear DCT (FPR): setting clears SID and AHD (no VECT);
     * drops forced SID/rwy from route like AHD does.
     */
    function applyAssignedDirect(stripId: string, point: string) {
        const strip = strips.value.get(stripId)
        if (!strip) return

        const fix = point.trim().toUpperCase()
        const clearing = !fix

        if (clearing) {
            // ES rejects SetDirectToPointName("") while DCT is set. Setting then
            // clearing AHD drops DCT (mutual exclusion) and restores preferred SID.
            applyAssignedHeading(stripId, '360')
            applyAssignedHeading(stripId, '')
            return
        }

        // Drop preferred SID preview immediately
        if (essaPreferredSids.value.has(stripId)) {
            const next = new Map(essaPreferredSids.value)
            next.delete(stripId)
            essaPreferredSids.value = next
        }
        if (essaPreferredCfls.value.has(stripId)) {
            const next = new Map(essaPreferredCfls.value)
            next.delete(stripId)
            essaPreferredCfls.value = next
        }

        // Clear AHD if set (DCT and heading are mutually exclusive in ES)
        if (strip.assignedHeading) {
            sendAssignment(stripId, 'assignHeading', '0')
        }
        // FPR/DCT follows filed route — drop VECT if present
        if (hasVectRemark(strip.remarks)) {
            updateRemarks(stripId, withVectRemark(strip.remarks, false))
        }

        sendAssignment(stripId, 'assignDirect', fix)

        const nextRoute = (() => {
            const route = strip.route || ''
            if (!hasForcedSidInRoute(route)) return route
            const tokens = route.trim().split(/\s+/).filter(Boolean)
            tokens.shift()
            return tokens.join(' ')
        })()
        strips.value.set(stripId, {
            ...strips.value.get(stripId)!,
            direct: fix,
            sid: undefined,
            assignedHeading: undefined,
            route: nextRoute,
            remarks: hasVectRemark(strip.remarks)
                ? withVectRemark(strip.remarks, false)
                : strip.remarks,
        })
        stripsVersion.value++
    }

    function dclLogin() {
        sendMessage({ type: 'dclAction', action: 'login' })
    }

    function dclLogout() {
        sendMessage({ type: 'dclAction', action: 'logout' })
    }

    function dclSend(stripId: string, remarks: string, proactive = false) {
        sendMessage({ type: 'dclSend', stripId, remarks, ...(proactive ? { proactive: true } : {}) })
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

    /** Ready TOBT: server sets TOBT=now (UTC HHMM) then REA. Optional tobt is ignored. */
    function viffReadyTobt(stripId: string, tobt?: string) {
        sendMessage({ type: 'viffReadyTobt', stripId, tobt })
    }

    /** Set or clear TSAC (communicated TSAT). Empty string clears. */
    function setTsac(stripId: string, tsac: string) {
        sendMessage({ type: 'setTsac', stripId, tsac })
    }

    /** Set or clear CTOC (communicated CTOT). Empty string clears. */
    function setCtoc(stripId: string, ctoc: string) {
        sendMessage({ type: 'setCtoc', stripId, ctoc })
    }

    /** Set or clear ATD (UTC HHmm). Empty string clears. EFS-only — not CDM. */
    function setAtd(stripId: string, atd: string) {
        const strip = strips.value.get(stripId)
        const normalized = atd.trim().replace(/\D/g, '').slice(0, 4)
        if (strip) {
            strips.value.set(stripId, {
                ...strip,
                atd: normalized || undefined,
            })
            stripsVersion.value++
        }
        sendMessage({ type: 'setAtd', stripId, atd: normalized })
    }

    /** Record QNH (+ optional ATIS letter) given to pilot, or clear with null. */
    function setQnhGiven(stripId: string, qnh: number | null, atis?: string | null) {
        const strip = strips.value.get(stripId)
        if (strip) {
            strips.value.set(stripId, {
                ...strip,
                qnhGiven: qnh ?? undefined,
                atisGiven: qnh == null ? undefined : (atis != null ? (atis || undefined) : strip.atisGiven),
            })
            stripsVersion.value++
        }
        sendMessage({
            type: 'setQnhGiven',
            stripId,
            qnh,
            ...(atis !== undefined ? { atis } : {}),
        })
    }

    /** Sideways offset — paper klack / SAAB cock. Null resets. Synced to peers. */
    function setKlack(stripId: string, klack: 'left' | 'right' | null) {
        const strip = strips.value.get(stripId)
        if (strip) {
            const next =
                klack === 'left' || klack === 'right'
                    ? { ...strip, klack }
                    : { ...strip, klack: undefined }
            strips.value.set(stripId, next)
            stripsVersion.value++
        }
        sendMessage({ type: 'setKlack', stripId, klack })
    }

    /** SAAB highlight (amber wash). Null clears. `global` syncs; `local` stays on this backend. */
    function setHighlight(stripId: string, highlight: 'local' | 'global' | null) {
        const strip = strips.value.get(stripId)
        if (strip) {
            const next =
                highlight === 'local' || highlight === 'global'
                    ? { ...strip, highlight }
                    : { ...strip, highlight: undefined }
            strips.value.set(stripId, next)
            stripsVersion.value++
        }
        sendMessage({ type: 'setHighlight', stripId, highlight })
    }

    /**
     * Long-hold QNH: acknowledge ATIS QNH change and stamp qnhGiven (+ ATIS) on every
     * strip for that airport (DEP uses adep, ARR uses ades).
     */
    function stampQnhGivenForAirport(airport: string) {
        const icao = airport.trim().toUpperCase()
        if (!icao) return
        const info = atisInfo.value.find((a) => a.airport === icao)
        if (!info) return
        const qnh = info.qnh
        if (qnh == null || !Number.isFinite(qnh)) return
        acknowledgeQnh(icao)
        const atisLetter = (info.atis || info.depAtis || info.arrAtis || '').trim() || undefined
        for (const strip of strips.value.values()) {
            if (strip.stripType === 'note' || strip.stripType === 'vehicle') continue
            const relevant =
                strip.stripType === 'arrival'
                    ? strip.ades === icao
                    : strip.adep === icao || strip.airport === icao
            if (!relevant) continue
            setQnhGiven(strip.id, qnh, atisLetter)
        }
    }

    /**
     * Hide live ES ASSR (manual/coordination mode) for this strip.
     * Keys off ADEP via SSR_COORDINATION_AIRPORTS (e.g. ESNS), not bay/config —
     * works on 1RWY3BAY and other non-multiAirport layouts. Never ESSA/ESGG,
     * arrivals, or local. An assigned EuroScope code stays visible otherwise.
     */
    function isSsrCoordinationActive(strip: FlightStrip): boolean {
        if (!rtcAssrSimulation.value) return false
        if (!requiresSsrCoordination(strip.adep, { stripType: strip.stripType })) return false
        if (ssrCoordOverrideIds.value.has(strip.id)) return false
        return true
    }

    /** ASSR shown on strip: manual code while coordinating, else live ES. */
    function displayAssrForStrip(strip: FlightStrip): string {
        if (!isSsrCoordinationActive(strip)) return strip.squawk || ''
        return manualSsrByStripId.value.get(strip.id) || ''
    }

    function setManualSsr(stripId: string, code: string) {
        const digits = code.replace(/\D/g, '').slice(0, 4)
        const next = new Map(manualSsrByStripId.value)
        if (digits) next.set(stripId, digits)
        else next.delete(stripId)
        manualSsrByStripId.value = next
        stripsVersion.value++
    }

    /** Leave hide mode — show live ES ASSR (after double-click generate/override). */
    function overrideSsrCoordination(stripId: string) {
        const next = new Set(ssrCoordOverrideIds.value)
        next.add(stripId)
        ssrCoordOverrideIds.value = next
        const manuals = new Map(manualSsrByStripId.value)
        manuals.delete(stripId)
        manualSsrByStripId.value = manuals
        stripsVersion.value++
    }

    function switchConfig(file: string) {
        sendMessage({ type: 'switchConfig', file })
    }

    function switchSaabLayout(layoutId: string) {
        sendMessage({ type: 'switchSaabLayout', layoutId })
    }

    function saabEnsureSection(
        sectionId: string,
        title: string,
        opts?: { bayId?: string; beforeSectionId?: string },
    ) {
        sendMessage({
            type: 'saabEnsureSection',
            sectionId,
            title,
            bayId: opts?.bayId,
            beforeSectionId: opts?.beforeSectionId,
        })
    }

    /** Set ESSA roles manually, or pass manual=false to return to auto-detect. */
    function setEssaRoles(roles: string[], manual: boolean) {
        if (manual) {
            essaRoles.value = [...roles]
            essaRolesManual.value = true
        } else {
            essaRolesManual.value = false
        }
        sendMessage({ type: 'setEssaRoles', roles, manual })
    }

    /**
     * Set ESSA RWY combination manually, or pass manual=false for auto
     * (ES runways + night/day letter selection).
     */
    function setEssaRwyConfig(configId: string | null, manual: boolean) {
        if (manual && configId) {
            essaRwyConfigId.value = configId
            essaRwyConfigManual.value = true
        } else {
            essaRwyConfigId.value = null
            essaRwyConfigManual.value = false
        }
        // Preferred SIDs refresh via watch(essaRwyConfigIdResolved)
    }

    /** When ES ARR/DEP change, drop manual RWY config so auto follows EuroScope. */
    function syncEssaRwyConfigFromEs(arr: string[], dep: string[]) {
        const fp = `${arr.join('/')}|${dep.join('/')}`
        if (fp === essaRwyEsFingerprint) return
        essaRwyEsFingerprint = fp
        if (essaRwyConfigManual.value) {
            essaRwyConfigId.value = null
            essaRwyConfigManual.value = false
        }
        // Preferred SIDs refresh via watch(essaRwyConfigIdResolved) when id changes
    }

    /**
     * Display-only preferred SIDs/CFLs for uncleared ESSA IFR deps (not assigned to EuroScope).
     * Actual assignSid/assignCfl happens when opening the clearance dialog.
     */
    const essaPreferredSids = ref<Map<string, string>>(new Map())
    const essaPreferredCfls = ref<Map<string, number>>(new Map())

    function getEssaPreferredSid(stripId: string): string | undefined {
        return essaPreferredSids.value.get(stripId)
    }

    function getEssaPreferredCfl(stripId: string): number | undefined {
        return essaPreferredCfls.value.get(stripId)
    }

    function isEssaPreferredIfrDep(strip: FlightStrip): boolean {
        return (
            !strip.clearance &&
            (strip.adep === 'ESSA' || strip.adep === 'ESMS' || strip.adep === 'ESGG') &&
            isIfrSidEligible(strip.flightRules) &&
            (strip.stripType === 'departure' || strip.stripType === 'local')
        )
    }

    /** True when strip CFL is a real controller/SID assignment (not blank / RFL echo). */
    function hasRealAssignedCfl(strip: FlightStrip): boolean {
        const cfl = strip.clearedAltitude
        if (!cfl) return false
        if (!strip.clearance && strip.rfl && cfl === strip.rfl) return false
        return true
    }

    /**
     * Preferred SID preview not yet entered via CLR (amber until SID/rwy is forced in FPL).
     * GetSid may already show the same name — still amber until CLR assigns it.
     */
    function isPreferredSidPending(strip: FlightStrip): boolean {
        if (strip.assignedHeading) return false
        if (!isEssaPreferredIfrDep(strip)) return false
        if (hasForcedSidInRoute(strip.route)) return false
        return !!essaPreferredSids.value.get(strip.id)
    }

    /**
     * @deprecated Prefer isXflPending — kept for callers; amber moved to XFL cell.
     * True when XFL is known but no real CFL is set.
     */
    function isPreferredCflPending(strip: FlightStrip): boolean {
        return isXflPending(strip)
    }

    /** SID altitude cache: `AIRPORT|sid|0|1` → feet */
    const sidAltitudeCache = ref<Map<string, number>>(new Map())

    function sidAltCacheKey(airport: string, sid: string, slow: boolean): string {
        return `${airport.toUpperCase()}|${sid}|${slow ? '1' : '0'}`
    }

    function defaultInitialClimbFt(airport: string, slow: boolean): number | undefined {
        const apt = airport.toUpperCase()
        if (apt !== 'ESSA' && apt !== 'ESGG' && apt !== 'ESMS') return undefined
        if (slow) return 3000
        if (apt === 'ESMS') return 4000
        return 5000
    }

    /** Raw SID used to resolve XFL (preferred preview or strip SID). */
    function sidForXfl(strip: FlightStrip): string | undefined {
        if (strip.assignedHeading && !hasForcedSidInRoute(strip.route) && !strip.sid) {
            return undefined
        }
        if (isEssaPreferredIfrDep(strip)) {
            const preferred = essaPreferredSids.value.get(strip.id)
            if (preferred) {
                const forced = hasForcedSidInRoute(strip.route)
                if (!forced || !strip.sid) return preferred
            }
        }
        return strip.sid || undefined
    }

    /**
     * XFL in feet — prefer EuroScope exit coordination altitude.
     * Fallback: preferred SID-alt / /api/sidalt / TMA default (mock / pre-refresh).
     */
    function xflFeetForStrip(strip: FlightStrip): number | undefined {
        if (
            strip.stripType === 'arrival' ||
            strip.stripType === 'cross' ||
            strip.stripType === 'note' ||
            strip.stripType === 'vehicle'
        ) {
            return undefined
        }

        // EuroScope XFL (GetExitCoordinationAltitude)
        const esXfl = parseAltitudeToFeet(strip.xfl)
        if (esXfl != null) return esXfl

        const airport = (strip.adep || '').toUpperCase()
        const slow = hasSlowRemark(strip.remarks)

        if (isEssaPreferredIfrDep(strip)) {
            const preferred = essaPreferredCfls.value.get(strip.id)
            if (preferred) return preferred
        }

        const sid = sidForXfl(strip)
        if (sid && airport) {
            const cached = sidAltitudeCache.value.get(sidAltCacheKey(airport, sid, slow))
            if (cached != null) return cached
        }

        return defaultInitialClimbFt(airport, slow)
    }

    /** XFL shown on strip. */
    function displayXflForStrip(strip: FlightStrip): string {
        const feet = xflFeetForStrip(strip)
        return formatStripAltitude(feet, DEFAULT_TRANSITION_ALTITUDE_FT) ?? ''
    }

    /**
     * CFL shown on strip — only when a real CFL is set and it differs from XFL.
     * XFL === CFL → empty CFL cell (XFL cell carries the level).
     * Arrivals: CA is treated as empty (VA / CAT2/3 / OS still shown).
     */
    function displayCflForStrip(strip: FlightStrip): string {
        if (!hasRealAssignedCfl(strip)) return ''
        const formatted =
            formatStripAltitude(strip.clearedAltitude, DEFAULT_TRANSITION_ALTITUDE_FT) ?? ''
        if (!formatted) return ''
        // Arrivals/locals: bare CA is hidden; ESSA RNP APP (STAR / informed OP-TEXT2)
        // shows like CAT2/3. RQ/REQ RNP alone never paints.
        if (
            (strip.stripType === 'arrival' || strip.stripType === 'local') &&
            formatted === 'CA'
        ) {
            const dest = (strip.ades || '').toUpperCase()
            const orig = (strip.adep || '').toUpperCase()
            if (dest === 'ESSA' || orig === 'ESSA') {
                const rnp = essaRnpCflLabel(strip.star, strip.remarks)
                if (rnp) return rnp
            }
            return ''
        }
        // Display-string match (same level, any token form) + feet fallback
        const xflFormatted = displayXflForStrip(strip)
        if (xflFormatted && formatted === xflFormatted) return ''
        const cflFeet = parseAltitudeToFeet(strip.clearedAltitude)
        const xflFeet = xflFeetForStrip(strip)
        if (cflFeet != null && xflFeet != null && cflFeet === xflFeet) return ''
        return formatted
    }

    /** No CFL selected → XFL shown in orange. */
    function isXflPending(strip: FlightStrip): boolean {
        return !!xflFeetForStrip(strip) && !hasRealAssignedCfl(strip)
    }

    async function fetchAndCacheSidAltitude(
        airport: string,
        sid: string,
        slow: boolean,
    ): Promise<number | undefined> {
        const key = sidAltCacheKey(airport, sid, slow)
        const existing = sidAltitudeCache.value.get(key)
        if (existing != null) return existing
        try {
            const params = new URLSearchParams({ airport, sid })
            if (slow) params.set('slow', '1')
            const res = await fetch(`/api/sidalt?${params}`)
            let altitude: number | undefined
            if (res.ok) {
                const altData = (await res.json()) as { altitude: number | null }
                altitude = altData.altitude ?? defaultInitialClimbFt(airport, slow)
            } else {
                altitude = defaultInitialClimbFt(airport, slow)
            }
            if (altitude) {
                const next = new Map(sidAltitudeCache.value)
                next.set(key, altitude)
                sidAltitudeCache.value = next
            }
            return altitude
        } catch {
            return defaultInitialClimbFt(airport, slow)
        }
    }

    /** Populate SID-alt cache for dep/local strips that have a resolvable SID. */
    async function refreshSidAltitudeCache() {
        const jobs: Promise<unknown>[] = []
        for (const strip of strips.value.values()) {
            if (
                strip.stripType !== 'departure' &&
                strip.stripType !== 'local' &&
                strip.stripType !== 'vfr'
            ) {
                continue
            }
            const airport = (strip.adep || '').toUpperCase()
            if (airport !== 'ESSA' && airport !== 'ESGG' && airport !== 'ESMS') continue
            const sid = sidForXfl(strip)
            if (!sid) continue
            const slow = hasSlowRemark(strip.remarks)
            if (sidAltitudeCache.value.has(sidAltCacheKey(airport, sid, slow))) continue
            jobs.push(fetchAndCacheSidAltitude(airport, sid, slow))
        }
        if (jobs.length) await Promise.all(jobs)
    }

    /**
     * SID shown on strip.
     * - AHD set → ve{TMA exit} (SID/preferred cleared)
     * - ESE preferred preview when FPL has no forced SID/rwy (after clear in ES/EFS)
     * - Forced SID in FPL (RNAV / track / VFR) always wins when present
     */
    function displaySidForStrip(strip: FlightStrip): string {
        // Assigned DCT: show the waypoint name in the SID cell (not "FPR")
        const dct = (strip.direct || '').trim().toUpperCase()
        if (dct) return dct

        const exit = strip.tmaExit || extractTmaExitPoint(undefined, strip.route)
        // Vector IFR DEP/local: ve{exit} while AHD/VECT — never for arrivals
        if (
            isVectCapableStrip(strip) &&
            (strip.assignedHeading || hasVectRemark(strip.remarks)) &&
            !hasForcedSidInRoute(strip.route)
        ) {
            return formatAhdVectorSidDisplay(exit)
        }

        // FPR airports: first FPL fix when DEP RWY is set (ES GetDepartureRwy,
        // FPL ADEP/rwy, or strip.runway from ES-active DEP — same as RWY cell).
        // VFR/Z: never auto-preview FPR — only show an entered SID (e.g. VFR·NORTH).
        if (isLopFprDepAirport(strip.adep) && !hasForcedSidInRoute(strip.route)) {
            if (strip.flightRules === 'V' || strip.flightRules === 'Z') {
                return formatSidForDisplay(strip.sid || '', strip.tmaExit, isPaperLook.value)
            }
            const fromFpl = fprDepDisplayFix(strip.adep, strip.route, strip.runway, strip.flightRules)
            return formatSidForDisplay(
                fromFpl || strip.sid || '',
                strip.tmaExit,
                isPaperLook.value,
            )
        }

        let raw = strip.sid || ''
        if (
            !strip.assignedHeading &&
            !hasVectRemark(strip.remarks) &&
            isEssaPreferredIfrDep(strip)
        ) {
            const preferred = essaPreferredSids.value.get(strip.id)
            if (preferred) {
                const forced = hasForcedSidInRoute(strip.route)
                if (!forced) {
                    // No SID in FPL — ESE priority (not sticky GetSid / cleared track)
                    raw = preferred
                } else if (!raw) {
                    raw = preferred
                }
            }
        }
        // Paper/ESGG: no space between SID name and designator (PETEV2G)
        return formatSidForDisplay(raw, strip.tmaExit, isPaperLook.value)
    }

    /**
     * Refresh display-only preferred SIDs + CFLs (no EuroScope assign).
     * Cleared strips are left alone / dropped from the preview map.
     */
    async function refreshEssaPreferredSids() {
        if (!essaRolesMode.value) {
            if (essaPreferredSids.value.size > 0) essaPreferredSids.value = new Map()
            if (essaPreferredCfls.value.size > 0) essaPreferredCfls.value = new Map()
            return
        }
        const configId = essaRwyConfigIdResolved.value
        if (!configId) {
            if (essaPreferredSids.value.size > 0) essaPreferredSids.value = new Map()
            if (essaPreferredCfls.value.size > 0) essaPreferredCfls.value = new Map()
            return
        }

        const candidates = [...strips.value.values()].filter(
            s =>
                s.adep === 'ESSA' &&
                isIfrSidEligible(s.flightRules) &&
                (s.stripType === 'departure' || s.stripType === 'local') &&
                !s.clearance &&
                !s.assignedHeading &&
                !hasVectRemark(s.remarks) &&
                !!s.runway
        )

        const nextSids = new Map<string, string>()
        const nextCfls = new Map<string, number>()
        await Promise.all(
            candidates.map(async strip => {
                try {
                    // Preferred SID table follows SLOW remarks flag (not isSlow ATYP alone)
                    const slow = hasSlowRemark(strip.remarks)
                    const params = new URLSearchParams({
                        airport: strip.adep,
                        runway: strip.runway!,
                        config: configId,
                        slow: slow ? '1' : '0',
                    })
                    if (strip.route) params.set('route', strip.route)
                    const res = await fetch(`/api/preferred-sid?${params}`)
                    if (!res.ok) return
                    const data = (await res.json()) as { sid: string | null }
                    if (!data.sid) return
                    nextSids.set(strip.id, data.sid)

                    const altParams = new URLSearchParams({
                        airport: strip.adep,
                        sid: data.sid,
                    })
                    if (slow) altParams.set('slow', '1')
                    const altitude = await fetchAndCacheSidAltitude(strip.adep, data.sid, slow)
                    if (altitude) nextCfls.set(strip.id, altitude)
                } catch {
                    // ignore per-strip failures
                }
            })
        )
        essaPreferredSids.value = nextSids
        essaPreferredCfls.value = nextCfls
        void refreshSidAltitudeCache()
    }

    /**
     * Assign preferred SID for uncleared ESSA/ESMS/ESGG IFR deps.
     * Used by the SLOW chip and after manual DEP RWY changes.
     */
    async function preferSidForStrip(
        stripId: string,
        slow: boolean,
        opts?: { runway?: string; ignoreForcedRoute?: boolean },
    ): Promise<void> {
        const strip = strips.value.get(stripId)
        if (!strip || strip.clearance || !strip.canEditClearance) return
        // AHD / VECT: vector departure — do not auto-enter preferred SID
        if (strip.assignedHeading || hasVectRemark(strip.remarks)) return
        // V / Z: never auto-assign preferred / SLOW SID
        if (!isIfrSidEligible(strip.flightRules)) return
        if (strip.stripType !== 'departure' && strip.stripType !== 'local') return
        const airport = strip.adep
        const runway = opts?.runway || strip.runway
        if (!airport || !runway) return
        if (airport !== 'ESSA' && airport !== 'ESMS' && airport !== 'ESGG') return
        if (airport === 'ESSA' && !essaRwyConfigIdResolved.value) return
        if (!opts?.ignoreForcedRoute && hasForcedSidInRoute(strip.route)) return

        try {
            const params = new URLSearchParams({ airport, runway })
            if (airport === 'ESSA') {
                params.set('config', essaRwyConfigIdResolved.value!)
                params.set('slow', slow ? '1' : '0')
            }
            if (airport === 'ESGG' && strip.callsign) {
                params.set('callsign', strip.callsign)
            }
            // After RWY change, drop stale SID/rwy prefix so exit matching uses the route body
            let route = strip.route || ''
            if (opts?.ignoreForcedRoute && route) {
                const tokens = route.trim().split(/\s+/).filter(Boolean)
                if (tokens[0]?.includes('/')) tokens.shift()
                route = tokens.join(' ')
            }
            if (route) params.set('route', route)
            const res = await fetch(`/api/preferred-sid?${params}`)
            if (!res.ok) return
            const data = (await res.json()) as { sid: string | null }
            if (!data.sid) {
                void refreshEssaPreferredSids()
                return
            }
            // ES GetSid already matches preferred — do not force into FPL
            if (sidsMatch(data.sid, strip.sid)) {
                void refreshEssaPreferredSids()
                return
            }
            // Already on a track SID while enabling slow — keep it (not after RWY change / SLOW chip)
            if (slow && !opts?.ignoreForcedRoute && isTrackSidName(strip.sid)) {
                void refreshEssaPreferredSids()
                return
            }
            sendAssignment(stripId, 'assignSid', data.sid)
            void refreshEssaPreferredSids()
        } catch {
            // ignore
        }
    }

    /** Clear a track/SLOW SID from the FPL (used when removing the SLOW flag). */
    function clearTrackSidForStrip(stripId: string): void {
        const strip = strips.value.get(stripId)
        if (!strip || strip.clearance || !strip.canEditClearance) return
        if (!isTrackSidName(strip.sid)) return
        sendAssignment(stripId, 'assignSid', '')
        void refreshEssaPreferredSids()
    }

    // Config change or strip set change → refresh preferred SID previews (display only)
    watch(essaRwyConfigIdResolved, (next, prev) => {
        if (!next || next === prev) return
        void refreshEssaPreferredSids()
    })
    let preferredSidRefreshTimer: ReturnType<typeof setTimeout> | null = null
    watch(stripsVersion, () => {
        if (preferredSidRefreshTimer) clearTimeout(preferredSidRefreshTimer)
        preferredSidRefreshTimer = setTimeout(() => {
            preferredSidRefreshTimer = null
            if (essaRolesMode.value) void refreshEssaPreferredSids()
            else void refreshSidAltitudeCache()
        }, 250)
    })

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

    function listDeletedStrips() {
        sendMessage({ type: 'listDeletedStrips' })
    }

    function listPendingPrint() {
        sendMessage({ type: 'listPendingPrint' })
    }

    function printStrip(callsign: string) {
        const cs = callsign.trim().toUpperCase()
        if (cs) pendingPrintAnimCallsigns.add(cs)
        sendMessage({ type: 'printStrip', callsign: cs || callsign })
    }

    function restoreStrip(stripId: string) {
        sendMessage({ type: 'restoreStrip', stripId })
    }

    function createStrip(
        stripType: 'vfrDep' | 'vfrArr' | 'cross' | 'note' | 'vehicle',
        callsign?: string,
        aircraftType?: string,
        airport?: string,
        targetBayId?: string,
        targetSectionId?: string,
        position?: number,
        isBottom?: boolean,
        paperInfoKind?: PaperInfoKind
    ) {
        // Auto-open scribble zoom for blank notes / empty paper strips only
        if (
            stripType === 'vehicle' ||
            (stripType === 'note' &&
                (!paperInfoKind ||
                    paperInfoKind === 'empty' ||
                    paperInfoKind === 'empty_frame' ||
                    paperInfoKind === 'empty_arr' ||
                    paperInfoKind === 'empty_dep'))
        ) {
            pendingNoteScribbleId.value = PENDING_NOTE_SCRIBBLE_AWAIT
        }
        sendMessage({
            type: 'createStrip',
            stripType,
            callsign,
            aircraftType,
            airport,
            targetBayId,
            targetSectionId,
            position,
            isBottom,
            paperInfoKind,
        })
    }

    /** Print a blank or paper info strip (paper look). */
    function printPaperInfoStrip(kind: PaperInfoKind) {
        const airport = myAirports.value[0] || undefined
        createStrip('note', undefined, undefined, airport, undefined, undefined, undefined, undefined, kind)
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

    function updateVehicleStrip(stripId: string, field: 'callsign' | 'hp' | 'std', text: string) {
        const strip = strips.value.get(stripId)
        if (strip && strip.stripType === 'vehicle') {
            const next = { ...strip }
            if (field === 'callsign') next.callsign = text.trim()
            else if (field === 'hp') next.hp = text.trim() || undefined
            else next.std = text.trim() || undefined
            strips.value.set(stripId, next)
            stripsVersion.value++
        }
        sendMessage({
            type: 'updateVehicleStrip',
            stripId,
            field,
            text,
        })
    }

    function updateRemarks(stripId: string, text: string) {
        // Optimistic — HP kept (backend rebuilds ".REMARKS /HP")
        const strip = strips.value.get(stripId)
        if (strip) {
            strips.value.set(stripId, {
                ...strip,
                remarks: text || undefined,
            })
            stripsVersion.value++
        }

        sendMessage({
            type: 'updateRemarks',
            stripId,
            text
        })
    }

    /** Holding point → scratchpad /TEXT (keeps remarks) */
    function updateHp(stripId: string, text: string) {
        const strip = strips.value.get(stripId)
        const normalized = text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
        if (strip) {
            strips.value.set(stripId, {
                ...strip,
                hp: normalized || undefined,
            })
            stripsVersion.value++
        }
        sendMessage({
            type: 'updateHp',
            stripId,
            text: normalized,
        })
    }

    /** Departure Coordination flag → strip annotation 6 ("DepC") */
    /**
     * Online peer suitable as EuroScope InitiateCoordination target.
     * Mirrors plugin fallback (CTR/FSS) plus APP (e.g. ÖKC) — not remote-tower R_APP/R_CTR.
     */
    function isSystemCoordinationTarget(ctrl: {
        callsign: string
        positionId?: string
    }): boolean {
        const cs = (ctrl.callsign || '').toUpperCase()
        const pos = (ctrl.positionId || '').toUpperCase()
        if (cs.includes('_R_APP') || cs.includes('_R_CTR')) return false
        if (cs.includes('_CTR') || cs.includes('_FSS') || cs.includes('_APP')) return true
        if (pos.includes('CTR') || pos.includes('FSS')) return true
        return false
    }

    /** True when at least one ACC/APP peer is online to receive XFL / DEP COORD. */
    const canInitiateSystemCoordination = computed(() =>
        controllers.value.some((c) => isSystemCoordinationTarget(c)),
    )

    /**
     * EuroScope COPX/XFL exit coordination request (not clearance / DepC flag).
     * Plugin calls InitiateCoordination toward next/ACC.
     */
    function initiateXflCoordination(
        stripId: string,
        opts?: { altitudeFeet?: number; point?: string; targetController?: string },
    ) {
        if (!canInitiateSystemCoordination.value && !opts?.targetController) return
        sendMessage({
            type: 'initiateXflCoordination',
            stripId,
            altitudeFeet: opts?.altitudeFeet,
            point: opts?.point,
            targetController: opts?.targetController,
        })
    }

    /**
     * Accept inbound ACC coordination proposal (exit XFL/COPX or entry PEL/COPN).
     * Normally does not set DepC (only ACC accepting our outbound DEP does).
     * Exception: ESMS eligible SID + ACC reply ~4000 → backend sets DepC; optimistic here too.
     */
    function acceptCoordination(stripId: string) {
        const strip = strips.value.get(stripId)
        if (strip?.exitCoordPending) {
            const pendingAlt = strip.exitCoordAltitude
            const esmsAutoDepC =
                isIfrSidEligible(strip.flightRules) &&
                (strip.stripType === 'departure' || strip.stripType === 'local') &&
                isEsmsAutoCoordSid(strip.adep, strip.sid, strip.runway) &&
                isEsmsAutoCoordReplyAltitude(pendingAlt)
            strips.value.set(stripId, {
                ...strip,
                exitCoordPending: undefined,
                exitCoordPoint: undefined,
                exitCoordAltitude: undefined,
                ...(esmsAutoDepC ? { coo: true, exitCoordRefused: undefined } : {}),
            })
            stripsVersion.value++
        }
        sendMessage({ type: 'acceptCoordination', stripId })
    }

    /** Reject ACC exit-coordination counter-proposal */
    function refuseCoordination(stripId: string) {
        const strip = strips.value.get(stripId)
        if (strip?.exitCoordPending) {
            strips.value.set(stripId, {
                ...strip,
                exitCoordPending: undefined,
                exitCoordPoint: undefined,
                exitCoordAltitude: undefined,
            })
            stripsVersion.value++
        }
        sendMessage({ type: 'refuseCoordination', stripId })
    }

    function setCoo(stripId: string, coo: boolean) {
        const strip = strips.value.get(stripId)
        if (strip) {
            strips.value.set(stripId, {
                ...strip,
                coo: coo || undefined,
                // DepC checkmark clears amber refuse highlight
                ...(coo ? { exitCoordRefused: undefined } : {}),
            })
            stripsVersion.value++
        }
        sendMessage({
            type: 'setCoo',
            stripId,
            coo,
        })
    }

    /** Hold short → VCH annotation 4, max 5 chars */
    function updateHs(stripId: string, text: string) {
        const strip = strips.value.get(stripId)
        const normalized = text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
        if (strip) {
            strips.value.set(stripId, {
                ...strip,
                hs: normalized || undefined,
            })
            stripsVersion.value++
        }
        sendMessage({
            type: 'updateHs',
            stripId,
            text: normalized,
        })
    }

    /** Push FPL field amendments to EuroScope via backend */
    function amendFlightPlan(
        stripId: string,
        fields: Omit<Extract<ClientMessage, { type: 'amendFlightPlan' }>, 'type' | 'stripId'>,
    ) {
        sendMessage({
            type: 'amendFlightPlan',
            stripId,
            ...fields,
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

    function handoverAssistantTransfer(targetCallsign: string, stripIds?: string[]) {
        const ids =
            stripIds ??
            [...strips.value.values()]
                .filter((s) => s.isAssumed && s.stripType !== 'note' && s.stripType !== 'vehicle')
                .map((s) => s.id)
        sendMessage({
            type: 'handoverAssistantTransfer',
            targetCallsign,
            stripIds: ids,
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
        pluginConnected,
        backendVersion,
        pluginVersion,
        myFrequency,
        feeds,
        reloadFeeds,
        reloadAll,
        notifyText,
        notifyLevel,
        notifyVisible,
        showNotify,
        dismissNotify,
        getBays,
        layout,
        strips,
        stripsVersion,
        markManualOrder,
        clearManualOrder,
        hasManualOrder,
        getSectionSortMode,
        setSectionSortMode,
        enterManualSortMode,
        commitManualTopOrder,
        isModeToggleSectionId,
        isCtrDepSectionId,
        reindexTopStripsByIds,
        reverseSectionStripOrder,
        syncTimeSortSectionFromDom,
        bumpStripsVersion,
        gaps,
        myCallsign,
        myAirports,
        myRole,
        myPositionId,
        isController,
        multiAirport,
        essaRolesMode,
        essaRoles,
        essaRolesManual,
        essaCoveredRunways,
        saabLayoutsMode,
        saabLayoutId,
        saabLayouts,
        saabRunwayCatalog,
        workspaceMode,
        airportCoverage,
        setEssaRoles,
        esggRolesMode,
        esggRoles,
        esggRolesManual,
        esggVisibleColumns,
        adjustEsggVisibleColumns,
        essaRwyConfigId,
        essaRwyConfigManual,
        essaRwyConfigIdResolved,
        essaSepIndicators,
        essaSepOverrides,
        isEssaSepOverrideActive,
        cycleEssaSepField,
        aupR16,
        activeRwyFlags,
        activeRwyFlagsVersion,
        isRwyFlagActive,
        setRwyFlag,
        showTobtSetByA,
        essaRwyAutoPreferId,
        essaPreferredSids,
        essaPreferredCfls,
        getEssaPreferredSid,
        getEssaPreferredCfl,
        isPreferredSidPending,
        isPreferredCflPending,
        isXflPending,
        displaySidForStrip,
        xflFeetForStrip,
        displayXflForStrip,
        displayCflForStrip,
        refreshEssaPreferredSids,
        preferSidForStrip,
        clearTrackSidForStrip,
        setEssaRwyConfig,
        syncEssaRwyConfigFromEs,
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
        isStripOwnedByOther,
        allowMoveOwnedStrip,
        moveStripToSection,
        moveStripToBottom,
        setGapAtIndex,
        removeGapAtIndex,
        getGapAtIndex,
        setSectionHeight,
        broadcastSectionHeights,
        sendStripAction,
        sendAssignment,
        applyAssignedHeading,
        applyAssignedDirect,
        deleteStrip,
        deletedStrips,
        listDeletedStrips,
        restoreStrip,
        GAP_BUFFER,
        atisInfo,
        acknowledgeQnh,
        isAtisLetterChanged,
        isQnhChanged,
        dclStatus,
        dclError,
        dclMode,
        dclAirportStationOnline,
        dclAirport,
        dclLogin,
        dclLogout,
        dclSend,
        dclReject,
        dclSetMode,
        cdmMasterPosition,
        cdmMasterIsMe,
        cdmMasterLabel,
        viffRea,
        viffUpdateEobt,
        viffUpdateTobt,
        viffReadyTobt,
        setTsac,
        setCtoc,
        setAtd,
        setQnhGiven,
        setKlack,
        setHighlight,
        availableConfigs,
        activeConfig,
        switchConfig,
        switchSaabLayout,
        saabEnsureSection,
        sendRequest,
        connect,
        refresh,
        createStrip,
        pendingNoteScribbleId,
        consumePendingNoteScribbleOpen,
        updateNote,
        updateVehicleStrip,
        updateRemarks,
        updateHp,
        setCoo,
        initiateXflCoordination,
        canInitiateSystemCoordination,
        acceptCoordination,
        refuseCoordination,
        updateHs,
        amendFlightPlan,
        autoMoveData,
        autoMovingStripIds,
        endAutoMove,
        printingStripIds,
        endPrintAnim,
        getPrintAnimDurationMs,
        controllers,
        releaseStrip,
        manualTransfer,
        handoverAssistantTransfer,
        handoverAssistantOpen,
        handoverAssistantPreferredFreq,
        handoverAssistantAutoAssume,
        openHandoverAssistant,
        closeHandoverAssistant,
        dclSoundEnabled,
        flashChangedTimes,
        flashTsatWindow,
        showStripOwnership,
        dimOtherOwnedStrips,
        transferSoundsEnabled,
        showAppDepXcFrequency,
        autoParkEnabled,
        autoLopSsr,
        rtcAssrSimulation,
        contactMeEnabled,
        isSsrCoordinationActive,
        displayAssrForStrip,
        setManualSsr,
        overrideSsrCoordination,
        stampQnhGivenForAirport,
        autoParkAvailable,
        stripPrintSound,
        stripPrintMode,
        fspServerEnabled,
        syncEnabled,
        scribbleSyncUrl,
        vatsimCid,
        scribbleSyncRealm,
        hoppieLogonCode,
        autoFitStripSizeMode,
        autoFitStripSizeGrowBack,
        hoppieFileCodePresent,
        userSettingsLoaded,
        cidDialogOpen,
        cidDialogSuggested,
        cidDialogReason,
        openCidDialog,
        closeCidDialog,
        submitVatsimCid,
        vatIrisSignInOpen,
        vatIrisSignInDetail,
        openVatIrisSignIn,
        closeVatIrisSignIn,
        syncStripScribbles,
        stripLook,
        isPaperLook,
        pendingPrintFlights,
        listPendingPrint,
        printStrip,
        printPaperInfoStrip,
        updateUserSettings,
    }
})
