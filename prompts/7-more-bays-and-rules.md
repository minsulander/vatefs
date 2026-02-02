Now let's flesh out our default configuration/layout and mock data a bit.

From left to right, sections from top to bottom:
Bay 1: single section "INBOUND"
Bay 2: sections "CTR ARR", "RUNWAY", "CTR DEP"
Bay 3: single section "TAXI"
Bay 4: sections "PENDING CLR", "CLEARED", "START&PUSH"

"INBOUND" section will have all arrivals (groundstate "ARR" or destination=our airport) which are not assumed (controller != myself).
"CTR ARR" will have arrivals which are assumed or transfered to me (will need to add transfer state to the plugin).
"RUNWAY" will have all flights with groundstate="LINE-UP" or groundstate="DEPA" or "cleared to land" which is a state the backend will have to handle by itself for now, so add that as a boolean flag.
"CTR DEP" will have flights with groundstate="DEPA" and an "airborne" flag (which we're also going to add as a boolean flag for now).
"PENDING CLR" will have departures (origin = our airport, no groundstate or groundstate="ONFREQ").
"CLEARED" will have departures that have received clearance (clearance=true from controllerAssignedDataUpdate message).
"START&PUSH" will have departures with groundstate "DE-ICE" or "PUSH".
