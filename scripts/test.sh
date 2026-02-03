to_backend() {
    echo "$1" | nc -4u -w0 localhost 17771
}

## Random other aircraft (shouldn't be visible)
to_backend '{ "type": "flightPlanDataUpdate", "callsign": "RYR123", "origin": "ESOK", "destination": "GCLP" }'

## Multiple departures (sort by incoming sequence)
to_backend '{ "type": "flightPlanDataUpdate", "callsign": "012", "origin": "ESGG", "destination": "ESSA" }'
to_backend '{ "type": "flightPlanDataUpdate", "callsign": "023", "origin": "ESGG", "destination": "ESNU" }'

## Departure sequence
# Initially in PENDING CLR
to_backend '{ "type": "flightPlanDataUpdate", "callsign": "SAS123", "origin": "ESGG", "destination": "ESSA" }'
# Clearance given -> CLEARED
to_backend '{ "type": "controllerAssignedDataUpdate", "callsign": "SAS123", "clearance": true }'
# State update (no change)
to_backend '{ "type": "controllerAssignedDataUpdate", "callsign": "SAS123", "groundstate": "ONFREQ" }'
# Startup -> START&PUSH
to_backend '{ "type": "controllerAssignedDataUpdate", "callsign": "SAS123", "groundstate": "DE-ICE" }'
# Push -> START&PUSH
to_backend '{ "type": "controllerAssignedDataUpdate", "callsign": "SAS123", "groundstate": "PUSH" }'
# Taxi -> TAXI
to_backend '{ "type": "controllerAssignedDataUpdate", "callsign": "SAS123", "groundstate": "TAXI" }'
# Controller TWR assigned (no change but should be there at some point)
to_backend '{ "type": "controllerAssignedDataUpdate", "callsign": "SAS123", "controller": "ESGG_TWR" }'
# Lineup -> RUNWAY
to_backend '{ "type": "controllerAssignedDataUpdate", "callsign": "SAS123", "groundstate": "LINEUP" }'
# # Cleared takeoff (green triangle)
to_backend '{ "type": "controllerAssignedDataUpdate", "callsign": "SAS123", "groundstate": "DEPA" }'
# # Airborne -> CTR DEP
# to_backend '{ "type": "radarTargetPositionUpdate", "callsign": "SAS123", "altitude": "900" }'
# # Outside CTR but no change until transferred
# to_backend '{ "type": "radarTargetPositionUpdate", "callsign": "SAS123", "altitude": "2000" }'
# # Transferred to E_APP -> delete
# to_backend '{ "type": "controllerAssignedDataUpdate", "callsign": "SAS123", "controller": "ESGG_E_APP" }'

# ## Arrival sequence
# # Initially INBOUND
# to_backend '{ "type": "flightPlanDataUpdate", "callsign": "SAS456", "origin": "ESSA", "destination": "ESGG" }'
# # Assumed by me -> CTR ARR (TODO assumed or laterally&vertically inside CTR)
# to_backend '{ "type": "controllerAssignedDataUpdate", "callsign": "SAS456", "controller": "ESGG_TWR" }'
# # Cleared to land -> RUNWAY
# to_backend '{ "type": "controllerAssignedDataUpdate", "callsign": "SAS456", "clearedToLand": true }'
# # Taxi in -> TAXI
# to_backend '{ "type": "controllerAssignedDataUpdate", "callsign": "SAS456", "groundstate": "TXIN" }'
# # Park -> delete
# to_backend '{ "type": "controllerAssignedDataUpdate", "callsign": "SAS456", "groundstate": "PARK" }'
