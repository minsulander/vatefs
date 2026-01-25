import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { FlightStrip, EfsConfig, Bay } from "@/types/efs"

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

        // Remove from old section
        const oldBay = config.value.bays.find(b => b.id === oldBayId)
        const oldSection = oldBay?.sections.find(s => s.id === oldSectionId)
        if (oldSection) {
            oldSection.stripIds = oldSection.stripIds.filter(id => id !== stripId)
        }

        // Update strip
        strip.bayId = targetBayId
        strip.sectionId = targetSectionId

        // Add to new section
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
        if (oldBayId !== targetBayId || oldSectionId !== targetSectionId) {
            recomputePositions(oldBayId, oldSectionId)
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
                        { id: 'arrivals', title: 'ARRIVALS', stripIds: [] },
                        { id: 'rwy34r34l', title: 'RUNWAY 34R/34L', stripIds: [] }
                    ]
                },
                {
                    id: 'bay2',
                    sections: [
                        { id: 'pending_dep', title: 'PENDING DEP', stripIds: [] },
                        { id: 'rwy34l34r', title: 'RUNWAY 34L/34R', stripIds: [] }
                    ]
                },
                {
                    id: 'bay3',
                    sections: [
                        { id: 'airborne', title: 'AIRBORNE', stripIds: [] },
                        { id: 'taxi_arr', title: 'TAXI ARR', stripIds: [] }
                    ]
                },
                {
                    id: 'bay4',
                    sections: [
                        { id: 'transit', title: 'TRANSIT', stripIds: [] },
                        { id: 'safeguard', title: 'SAFEGUARD', stripIds: [] },
                        { id: 'vfr', title: 'VFR', stripIds: [] },
                        { id: 'taxi_dep', title: 'TAXI DEP', stripIds: [] }
                    ]
                }
            ]
        }

        // Create mock flight strips
        const mockStrips: FlightStrip[] = [
            {
                id: 'strip1',
                callsign: 'SAS911',
                aircraftType: 'A320',
                origin: 'ENGM',
                destination: 'ESSA',
                altitude: 'FL180',
                speed: '250',
                departureTime: '1845',
                arrivalTime: '1920',
                route: 'RIXON DCT LOKAL',
                squawk: '1234',
                bayId: 'bay1',
                sectionId: 'arrivals',
                position: 0
            },
            {
                id: 'strip2',
                callsign: 'DLH432',
                aircraftType: 'A321',
                origin: 'EDDF',
                destination: 'ESSA',
                altitude: 'FL360',
                speed: '450',
                departureTime: '1730',
                arrivalTime: '1945',
                route: 'BEKTO DCT ROSAL',
                squawk: '2341',
                bayId: 'bay1',
                sectionId: 'arrivals',
                position: 1
            },
            {
                id: 'strip3',
                callsign: 'KLM1142',
                aircraftType: 'B738',
                origin: 'EHAM',
                destination: 'ESSA',
                altitude: 'FL340',
                speed: '440',
                departureTime: '1815',
                arrivalTime: '1955',
                route: 'BALAD DCT LOKAL',
                squawk: '5612',
                bayId: 'bay1',
                sectionId: 'arrivals',
                position: 2
            },
            {
                id: 'strip4',
                callsign: 'SAS462',
                aircraftType: 'A320',
                origin: 'ESSA',
                destination: 'EGLL',
                altitude: 'FL360',
                speed: '450',
                departureTime: '2015',
                route: 'REFSO DCT RIXON',
                squawk: '1567',
                bayId: 'bay2',
                sectionId: 'pending_dep',
                position: 0
            },
            {
                id: 'strip5',
                callsign: 'NAX254',
                aircraftType: 'B738',
                origin: 'ESSA',
                destination: 'LIRF',
                altitude: 'FL380',
                speed: '460',
                departureTime: '2030',
                route: 'REFSO DCT OSNAK',
                squawk: '2234',
                bayId: 'bay2',
                sectionId: 'pending_dep',
                position: 1
            },
            {
                id: 'strip6',
                callsign: 'BRA841',
                aircraftType: 'A319',
                origin: 'ESSA',
                destination: 'ESSB',
                altitude: 'FL120',
                speed: '280',
                departureTime: '1955',
                route: 'DCT',
                squawk: '3421',
                bayId: 'bay3',
                sectionId: 'airborne',
                position: 0
            },
            {
                id: 'strip7',
                callsign: 'RYR8245',
                aircraftType: 'B738',
                origin: 'EPWA',
                destination: 'ENGM',
                altitude: 'FL380',
                speed: '470',
                route: 'RIXON DCT SOMAX',
                squawk: '4523',
                bayId: 'bay4',
                sectionId: 'transit',
                position: 0
            },
            {
                id: 'strip8',
                callsign: 'SE-ABC',
                aircraftType: 'C172',
                origin: 'ESSB',
                destination: 'ESSB',
                altitude: '2500',
                speed: '100',
                route: 'LOCAL',
                squawk: '7000',
                bayId: 'bay4',
                sectionId: 'vfr',
                position: 0
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
        moveStripToSection,
        moveStripToNextSection
    }
})
