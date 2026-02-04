/**
 * Static configuration for the EFS backend.
 * This contains the airport layout, section rules, action rules, delete rules, and move rules.
 *
 * Note: In a production system, this configuration would be loaded from a file
 * or database, but for now it's hardcoded for ESGG (Gothenburg).
 */

import type { EfsStaticConfig } from "./config-types.js"

/**
 * Static configuration - will be loaded from file or server later
 */
export const staticConfig: EfsStaticConfig = {
    myAirports: ['ESGG'],
    myCallsign: 'ESGG_TWR', // Mock - will be updated from myselfUpdate
    radarRangeNm: 25, // Default radar range for strip filtering

    layout: {
        bays: [
            {
                id: 'bay1',
                sections: [
                    { id: 'inbound', title: 'INBOUND' }
                ]
            },
            {
                id: 'bay2',
                sections: [
                    { id: 'ctr_arr', title: 'CTR ARR' },
                    { id: 'runway', title: 'RUNWAY' },
                    { id: 'ctr_dep', title: 'CTR DEP' }
                ]
            },
            {
                id: 'bay3',
                sections: [
                    { id: 'taxi', title: 'TAXI' }
                ]
            },
            {
                id: 'bay4',
                sections: [
                    { id: 'pending_clr', title: 'PENDING CLR' },
                    { id: 'cleared', title: 'CLEARED' },
                    { id: 'start_push', title: 'START&PUSH' }
                ]
            }
        ]
    },

    sectionRules: [
        // === ARRIVAL FLOW ===

        // CTR DEP: Airborne departures (groundstate DEPA + airborne flag)
        {
            id: 'ctr_dep_airborne',
            sectionId: 'ctr_dep',
            bayId: 'bay2',
            direction: 'departure',
            groundstates: ['DEPA'],
            airborne: true,
            priority: 100
        },

        // RUNWAY: Cleared to land arrivals
        {
            id: 'runway_cleared_to_land',
            sectionId: 'runway',
            bayId: 'bay2',
            direction: 'arrival',
            clearedToLand: true,
            groundstates: ['', 'NSTS', 'ARR'],
            priority: 95
        },

        // RUNWAY: Lineup and departure roll
        {
            id: 'runway_lineup',
            sectionId: 'runway',
            bayId: 'bay2',
            groundstates: ['LINEUP'],
            priority: 90
        },
        {
            id: 'runway_depa',
            sectionId: 'runway',
            bayId: 'bay2',
            groundstates: ['DEPA'],
            airborne: false, // Still on runway, not yet airborne
            priority: 90
        },

        // CTR ARR: Arrivals assumed by me
        {
            id: 'ctr_arr_assumed',
            sectionId: 'ctr_arr',
            bayId: 'bay2',
            direction: 'arrival',
            controller: 'myself',
            groundstates: ['', 'NSTS', 'ARR'],
            priority: 80
        },

        // INBOUND: Arrivals not yet assumed (ARR groundstate or just arriving)
        {
            id: 'inbound_arr_groundstate',
            sectionId: 'inbound',
            bayId: 'bay1',
            direction: 'arrival',
            groundstates: ['ARR'],
            controller: 'not_myself',
            priority: 70
        },
        {
            id: 'inbound_no_groundstate',
            sectionId: 'inbound',
            bayId: 'bay1',
            direction: 'arrival',
            groundstates: [''],
            controller: 'not_myself',
            priority: 70
        },

        // === DEPARTURE FLOW ===

        // START&PUSH: Departures with DE-ICE or PUSH
        {
            id: 'start_push_deice',
            sectionId: 'start_push',
            bayId: 'bay4',
            direction: 'departure',
            groundstates: ['DE-ICE'],
            priority: 60
        },
        {
            id: 'start_push_push',
            sectionId: 'start_push',
            bayId: 'bay4',
            direction: 'departure',
            groundstates: ['PUSH'],
            priority: 60
        },

        // CLEARED: Departures with clearance flag
        {
            id: 'cleared',
            sectionId: 'cleared',
            bayId: 'bay4',
            direction: 'departure',
            clearance: true,
            groundstates: ['', 'ONFREQ', 'NSTS'], // Not yet pushing
            priority: 50
        },

        // PENDING CLR: Departures without clearance (no groundstate or ONFREQ)
        {
            id: 'pending_clr',
            sectionId: 'pending_clr',
            bayId: 'bay4',
            direction: 'departure',
            groundstates: ['', 'ONFREQ', 'NSTS'],
            clearance: false,
            priority: 40
        },

        // === TAXI ===

        // TAXI: Departures taxiing (after pushback, before lineup)
        {
            id: 'taxi_dep',
            sectionId: 'taxi',
            bayId: 'bay3',
            direction: 'departure',
            groundstates: ['TAXI'],
            priority: 30
        },

        // TAXI: Arrivals taxiing in (after vacating runway)
        {
            id: 'taxi_arr',
            sectionId: 'taxi',
            bayId: 'bay3',
            direction: 'arrival',
            groundstates: ['TXIN'],
            priority: 30
        },

        // === FALLBACKS ===

        // Catch-all for arrivals at our airport
        {
            id: 'fallback_arrival',
            sectionId: 'inbound',
            bayId: 'bay1',
            direction: 'arrival',
            priority: 5
        },

        // Catch-all for departures at our airport
        {
            id: 'fallback_departure',
            sectionId: 'pending_clr',
            bayId: 'bay4',
            direction: 'departure',
            priority: 5
        }
    ],

    actionRules: [
        // INBOUND arrivals: ASSUME to take control
        {
            id: 'assume_inbound',
            action: 'ASSUME',
            sectionId: 'inbound',
            direction: 'arrival',
            controller: 'not_myself',
            priority: 100
        },

        // CTR ARR arrivals: CTL (cleared to land)
        {
            id: 'ctl_ctr_arr',
            action: 'CTL',
            sectionId: 'ctr_arr',
            direction: 'arrival',
            controller: 'myself',
            clearedToLand: false, // Only if not already cleared
            priority: 90
        },

        // RUNWAY lineup: CTO (cleared for takeoff)
        {
            id: 'cto_lineup',
            action: 'CTO',
            sectionId: 'runway',
            direction: 'departure',
            groundstates: ['LINEUP'],
            priority: 90
        },

        // CTR DEP airborne: XFER (transfer to next controller)
        {
            id: 'xfer_ctr_dep',
            action: 'XFER',
            sectionId: 'ctr_dep',
            direction: 'departure',
            airborne: true,
            priority: 80
        },

        // CLEARED departures: PUSH (approve startup/pushback)
        {
            id: 'push_cleared',
            action: 'PUSH',
            sectionId: 'cleared',
            direction: 'departure',
            clearance: true,
            groundstates: ['', 'ONFREQ', 'STUP', 'NSTS'],
            priority: 70
        }
    ],

    deleteRules: [
        // Departures: Delete when high enough and transferred/freed
        // Altitude > field elevation + 1500ft AND not controlled by me
        {
            id: 'delete_dep_high_transferred',
            direction: 'departure',
            controller: 'not_myself',
            minAltitudeAboveField: 1500,
            priority: 100
        },

        // Arrivals: Delete when parked
        {
            id: 'delete_arr_parked',
            direction: 'arrival',
            groundstates: ['PARK'],
            priority: 100
        }
    ],

    moveRules: [
        // === DEPARTURE FLOW ===

        // PENDING CLR -> CLEARED: Set clearance flag
        {
            id: 'move_pending_to_cleared',
            fromSectionId: 'pending_clr',
            toSectionId: 'cleared',
            direction: 'departure',
            command: { type: 'setClearance', value: true }
        },

        // CLEARED -> START&PUSH: Set groundstate to PUSH
        {
            id: 'move_cleared_to_push',
            fromSectionId: 'cleared',
            toSectionId: 'start_push',
            direction: 'departure',
            command: { type: 'setGroundstate', value: 'PUSH' }
        },

        // START&PUSH -> TAXI: Set groundstate to TAXI
        {
            id: 'move_push_to_taxi',
            fromSectionId: 'start_push',
            toSectionId: 'taxi',
            direction: 'departure',
            command: { type: 'setGroundstate', value: 'TAXI' }
        },

        // TAXI -> RUNWAY: Set groundstate to LINEUP
        {
            id: 'move_taxi_to_runway',
            fromSectionId: 'taxi',
            toSectionId: 'runway',
            direction: 'departure',
            command: { type: 'setGroundstate', value: 'LINEUP' }
        },

        // === ARRIVAL FLOW ===

        // INBOUND -> RUNWAY: Set cleared to land
        {
            id: 'move_inbound_to_runway',
            fromSectionId: 'inbound',
            toSectionId: 'runway',
            direction: 'arrival',
            command: { type: 'setClearedToLand', value: true }
        },

        // CTR ARR -> RUNWAY: Set cleared to land
        {
            id: 'move_ctr_arr_to_runway',
            fromSectionId: 'ctr_arr',
            toSectionId: 'runway',
            direction: 'arrival',
            command: { type: 'setClearedToLand', value: true }
        },

        // RUNWAY -> TAXI (arrival): Set groundstate to TXIN
        {
            id: 'move_runway_to_taxi_arr',
            fromSectionId: 'runway',
            toSectionId: 'taxi',
            direction: 'arrival',
            command: { type: 'setGroundstate', value: 'TXIN' }
        }
    ]
}

/**
 * Update my callsign (called when myselfUpdate is received)
 */
export function setMyCallsign(callsign: string) {
    staticConfig.myCallsign = callsign
}
