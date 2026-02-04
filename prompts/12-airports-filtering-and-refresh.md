Let's work on airport filtering and data management.
I've added @data/airports.csv with information we need on Swedish airports. I've also added @data/runways.csv which we are gonna need later.

Let's make the following changes:
- in EfsStaticConfig, rename ourAirport to myAirports, make it an array
- filter the creation of strips (based on flights) on the following conditions: (origin is in myAirports OR destination is in myAirports OR alternate is in myAirports) AND the radar track is within 25nm (configurable constant) of any of myAirports center (so here we need to get lat/lon from radar target and calculate (e.g. haversine formula) distance to the airport lat/lon from airports.csv)
- as a consequence of the above, flights which have not received a radar target will be ignored, which is what we want for now
- EfsStaticConfig.fieldElevation should be replaced with a lookup function using the nearest (based on distance) airport field elevation from the airports.csv file
- Prep for looking up data from runways.csv in the same manner as airports.csv is implemented. We're gonna need it later for determining flights that enter or leave the runway geographically.

For reference: In the future, we're going to support multiple airports, either with separate bays/sections (separated by section rules) or a combined mode, where strips will share sections and have some kind of indicator for which airport they belong to. But that's in the future, for now we're gonna keep to the single-airport use case but adapt the data structure for the future.

Since these changes are quite substantial, plan accordingly and make a TODO list.

Finish off by updating CLAUDE.md with any relevant changes.

...

Update the mock data (npm start -- --mock) so that we get some strips, i.e. add some radarTargetPositionUpdate messages within  range from ESGG.

...

Let's implement some refresh functionality. The frontend store should have a refresh() method, clearing all its data and requesting it again from the backend. Next, we need a way for the backend to force a frontend refresh, e.g. when we restart the backend, change configuration, or when we reconnect as another callsign (at potentially some other airport) in EuroScope.

...

Add a refresh icon button on first left in the top bar. Also, where the top bar now says 'ESXX_TWR', my callsign should be shown. To the right of the callsign, add airport(s) that are not part of the callsign, e.g. if my callsign is 'ESGG_TWR' and the airport is 'ESGG' don't show it, but if my callsign is 'ESGG_E_APP' and airports is 'ESGG, ESGT, ESIB' show 'ESGG_E_APP ESGT ESIB'. If my callsign is 'ESOS_1_CTR' and airports is 'ESSA, ESSB, ESOW' show all of them, if my callsign were 'ESSA_E_APP' show only 'ESSB ESOW'. Add messaging between the backend and frontend as necessary.
