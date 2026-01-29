import type { EfsConfig, FlightStrip } from "@vatefs/common"

export const mockConfig: EfsConfig = {
    bays: [
        {
            id: 'bay1',
            sections: [
                { id: 'arrivals', title: 'ARRIVALS' },
                { id: 'rwy16r34l', title: 'RUNWAY 16R/34L' }
            ]
        },
        {
            id: 'bay2',
            sections: [
                { id: 'pending_dep', title: 'PENDING DEP' },
                { id: 'rwy16l34r', title: 'RUNWAY 16L/34R' }
            ]
        },
        {
            id: 'bay3',
            sections: [
                { id: 'airborne', title: 'AIRBORNE' },
                { id: 'taxi_arr', title: 'TAXI ARR' }
            ]
        },
        {
            id: 'bay4',
            sections: [
                { id: 'transit', title: 'TRANSIT' },
                { id: 'safeguard', title: 'SAFEGUARD' },
                { id: 'vfr', title: 'VFR' },
                { id: 'taxi_dep', title: 'TAXI DEP' }
            ]
        }
    ]
}

export const mockStrips: FlightStrip[] = [
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
        position: 0,
        bottom: false
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
        position: 1,
        bottom: false
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
        position: 2,
        bottom: false
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
        position: 3,
        bottom: false
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
        position: 0,
        bottom: false
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
        position: 1,
        bottom: false
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
        position: 2,
        bottom: false
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
        position: 0,
        bottom: false
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
        position: 0,
        bottom: false
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
        position: 0,
        bottom: false
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
        position: 1,
        bottom: false
    }
]
