import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { FlightStrip, EfsConfig, Bay, StripType, FlightRules, WakeCategory } from "@/types/efs"

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
            socket.send("?")
            connected.value = true
        }
        socket.onopen = () => {
            console.log("socket opened")
            if (socket) socket.send("?")
            connected.value = true
        }
        socket.onclose = () => {
            console.log("socket closed")
            connected.value = false
        }
        socket.onmessage = (message: MessageEvent) => {
            const data = JSON.parse(message.data)
            console.log("received", data)
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
        position?: number,
        gapBefore?: number
    ) {
        const strip = strips.value.get(stripId)
        if (!strip) return

        const oldBayId = strip.bayId
        const oldSectionId = strip.sectionId
        const isSameSection = oldBayId === targetBayId && oldSectionId === targetSectionId

        // Remove from old section (both top and bottom lists)
        const oldBay = config.value.bays.find(b => b.id === oldBayId)
        const oldSection = oldBay?.sections.find(s => s.id === oldSectionId)
        if (oldSection) {
            oldSection.stripIds = oldSection.stripIds.filter(id => id !== stripId)
            oldSection.bottomStripIds = oldSection.bottomStripIds.filter(id => id !== stripId)
        }

        // Update strip
        strip.bayId = targetBayId
        strip.sectionId = targetSectionId

        // Reset gap when moving to different section
        if (!isSameSection) {
            strip.gapBefore = undefined
        } else if (gapBefore !== undefined) {
            strip.gapBefore = gapBefore
        }

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
        strip.gapBefore = undefined // Reset gap for bottom strips

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

        // Recompute positions
        recomputePositions(targetBayId, targetSectionId)
        if (oldBayId !== targetBayId || oldSectionId !== targetSectionId) {
            recomputePositions(oldBayId, oldSectionId)
        }
    }

    function setStripGap(stripId: string, gapBefore: number | undefined) {
        const strip = strips.value.get(stripId)
        if (strip) {
            strip.gapBefore = gapBefore
        }
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

    function initializeMockData() {
        // Configure bays and sections
        config.value = {
            bays: [
                {
                    id: 'bay1',
                    sections: [
                        { id: 'arrivals', title: 'ARRIVALS', stripIds: [], bottomStripIds: [] },
                        { id: 'rwy16r34l', title: 'RUNWAY 16R/34L', stripIds: [], bottomStripIds: [] }
                    ]
                },
                {
                    id: 'bay2',
                    sections: [
                        { id: 'pending_dep', title: 'PENDING DEP', stripIds: [], bottomStripIds: [] },
                        { id: 'rwy16l34r', title: 'RUNWAY 16L/34R', stripIds: [], bottomStripIds: [] }
                    ]
                },
                {
                    id: 'bay3',
                    sections: [
                        { id: 'airborne', title: 'AIRBORNE', stripIds: [], bottomStripIds: [] },
                        { id: 'taxi_arr', title: 'TAXI ARR', stripIds: [], bottomStripIds: [] }
                    ]
                },
                {
                    id: 'bay4',
                    sections: [
                        { id: 'transit', title: 'TRANSIT', stripIds: [], bottomStripIds: [] },
                        { id: 'safeguard', title: 'SAFEGUARD', stripIds: [], bottomStripIds: [] },
                        { id: 'vfr', title: 'VFR', stripIds: [], bottomStripIds: [] },
                        { id: 'taxi_dep', title: 'TAXI DEP', stripIds: [], bottomStripIds: [] }
                    ]
                }
            ]
        }

        // Create mock flight strips with proper EuroScope-compatible fields
        const mockStrips: FlightStrip[] = [
            // Arrivals
            {
                id: 'strip1',
                callsign: 'SAS911',
                aircraftType: 'A320',
                wakeTurbulence: 'M',
                flightRules: 'I',
                adep: 'ENGM',
                ades: 'ESSA',
                route: 'RIXON DCT LOKAL',
                rfl: 'FL180',
                squawk: '1234',
                eta: '1920',
                stand: '42',
                runway: '01R',
                stripType: 'arrival',
                bayId: 'bay1',
                sectionId: 'arrivals',
                position: 0
            },
            {
                id: 'strip2',
                callsign: 'DLH432',
                aircraftType: 'A321',
                wakeTurbulence: 'M',
                flightRules: 'I',
                adep: 'EDDF',
                ades: 'ESSA',
                route: 'BEKTO DCT ROSAL',
                rfl: 'FL360',
                squawk: '2341',
                eta: '1945',
                stand: '55',
                stripType: 'arrival',
                bayId: 'bay1',
                sectionId: 'arrivals',
                position: 1
            },
            {
                id: 'strip3',
                callsign: 'KLM1142',
                aircraftType: 'B738',
                wakeTurbulence: 'M',
                flightRules: 'I',
                adep: 'EHAM',
                ades: 'ESSA',
                route: 'BALAD DCT LOKAL',
                rfl: 'FL340',
                squawk: '5612',
                eta: '1955',
                stand: '61',
                stripType: 'arrival',
                bayId: 'bay1',
                sectionId: 'arrivals',
                position: 2
            },
            {
                id: 'strip9',
                callsign: 'THY18A',
                aircraftType: 'B77W',
                wakeTurbulence: 'H',
                flightRules: 'I',
                adep: 'LTFM',
                ades: 'ESSA',
                route: 'VENGA DCT RIDAR',
                rfl: 'FL390',
                squawk: '3012',
                eta: '2005',
                stand: '73',
                clearedAltitude: 'FL120',
                stripType: 'arrival',
                bayId: 'bay1',
                sectionId: 'arrivals',
                position: 3
            },
            // Departures
            {
                id: 'strip4',
                callsign: 'SAS462',
                aircraftType: 'A320',
                wakeTurbulence: 'M',
                flightRules: 'I',
                adep: 'ESSA',
                ades: 'EGLL',
                sid: 'VINGA2J',
                route: 'VINGA M852 LASAT',
                rfl: 'FL360',
                squawk: '1567',
                eobt: '2015',
                stand: '22A',
                stripType: 'departure',
                bayId: 'bay2',
                sectionId: 'pending_dep',
                position: 0
            },
            {
                id: 'strip5',
                callsign: 'NAX254',
                aircraftType: 'B738',
                wakeTurbulence: 'M',
                flightRules: 'I',
                adep: 'ESSA',
                ades: 'LIRF',
                sid: 'MAKEP2J',
                route: 'MAKEP Y352 EVLAN',
                rfl: 'FL380',
                squawk: '2234',
                eobt: '2030',
                stand: '18',
                stripType: 'departure',
                bayId: 'bay2',
                sectionId: 'pending_dep',
                position: 1
            },
            {
                id: 'strip10',
                callsign: 'BAW791G',
                aircraftType: 'A320',
                wakeTurbulence: 'M',
                flightRules: 'I',
                adep: 'ESSA',
                ades: 'EGLL',
                sid: 'DETNA3J',
                route: 'DETNA DCT AAL P615 ABIN',
                rfl: 'FL340',
                squawk: '6071',
                eobt: '1115',
                stand: '22A',
                clearedAltitude: 'A050',
                stripType: 'departure',
                bayId: 'bay2',
                sectionId: 'pending_dep',
                position: 2
            },
            // Airborne
            {
                id: 'strip6',
                callsign: 'BRA841',
                aircraftType: 'A319',
                wakeTurbulence: 'M',
                flightRules: 'I',
                adep: 'ESSA',
                ades: 'ESSB',
                route: 'DCT',
                rfl: 'FL120',
                squawk: '3421',
                atd: '1955',
                stripType: 'departure',
                bayId: 'bay3',
                sectionId: 'airborne',
                position: 0
            },
            // Transit
            {
                id: 'strip7',
                callsign: 'RYR8245',
                aircraftType: 'B738',
                wakeTurbulence: 'M',
                flightRules: 'I',
                adep: 'EPWA',
                ades: 'ENGM',
                route: 'RIXON DCT SOMAX',
                rfl: 'FL380',
                squawk: '4523',
                clearedAltitude: 'FL380',
                stripType: 'arrival',
                bayId: 'bay4',
                sectionId: 'transit',
                position: 0
            },
            // VFR
            {
                id: 'strip8',
                callsign: 'SEGXI',
                aircraftType: 'C172',
                wakeTurbulence: 'L',
                flightRules: 'V',
                adep: 'ESSA',
                ades: 'ESSA',
                route: 'LOCAL',
                squawk: '7000',
                remarks: 'SKOL TGL',
                stripType: 'vfr',
                bayId: 'bay4',
                sectionId: 'vfr',
                position: 0
            },
            // Local IFR
            {
                id: 'strip11',
                callsign: 'CBN21',
                aircraftType: 'BE20',
                wakeTurbulence: 'L',
                flightRules: 'I',
                adep: 'ESSA',
                ades: 'ESSA',
                squawk: '2726',
                clearedAltitude: 'A050',
                assignedHeading: '285',
                remarks: 'REQ 2 ILS CLBN LLZ',
                stripType: 'local',
                bayId: 'bay4',
                sectionId: 'vfr',
                position: 1
            }
        ]

        // Add strips to map and sections
        mockStrips.forEach(strip => {
            strips.value.set(strip.id, strip)
            const bay = config.value.bays.find(b => b.id === strip.bayId)
            const section = bay?.sections.find(s => s.id === strip.sectionId)
            if (section) {
                section.stripIds.push(strip.id)
            }
        })
    }

    // init
    initializeMockData()

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
        setStripGap,
        setSectionHeight
    }
})
