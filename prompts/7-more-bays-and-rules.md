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

...

Let's focus on the strip "default action". Depending on a set of rules, the backend will provide a default action for the strip, e.g. "CTL" as in "cleared to land", "ASSUME", "CTO" as in "cleared for takeoff". Some strips will not have a default action. The default action text should be shown in the button instead of the right chevron. The button should also be grey. When the user pushes the button, it should send a message to the backend specifying which action was taken, replacing the auto-strip-moving functionality we have in the frontend now. Let's stop there for now and just let the backend print a console log message as a placeholder, which we will later extend with a call to the euroscope plugin via UDP.
