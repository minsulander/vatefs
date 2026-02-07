We're gonna implement some stepping stones and data gathering for future functionality.

A user's EuroScope files can be in any location, but most commonly $APPDATA/EuroScope.
This will need to be configurable and/or discovered in the future but can be set as a constant default for now.

## Stand numbers and locations

End goal: show stand numbers on departures, set based on their initial location.

Take a look at $APPDATA/EuroScope/ESAA/Plugins/GRpluginStands.txt
and the documentation in $APPDATA/EuroScope/ESAA/Ground Radar plugin for EuroScope - Developer Guide.pdf

You'll see that some stands have a polygon of coordinates, some stands only a single coordinate.

The backend needs to read the stands file at startup, build a list of stands and their coordinates,
then have a lookup-function that finds a stand number for a given location (lat/lon). This function
will be used for setting flight.stand, if unset and if the aircraft is stationary. For stands with
a polygon it should be set if the latlon is within the polygin, for stands without a polygon we could
simply find the closest one and make sure it's within some reasonable distance, say 100 meters.

Implement this all the way to populating strip.stand.

## SID options and coordinated altitudes

End goal: user-selectable SID and automatically setting CFL based on coordinated SID altitude

The backend needs to find the latest .ese file in $APPDATA/EuroScope/ and parse out SIDs and their coordinated
initial altitudes. You can grep the file on e.g. 'SID:ESGG:21' to find SIDs for runway 21. Then you'll find
the initial altitude by mathing 'COPX:ESGG' lines that contain one of the first waypoints in the SID, that
way finding that for e.g. ESGG rwy 21 sid LABAN4J the altitude is 5000 ft since GG604 is in the SID and is
a coordinated point with 5000 ft set.

Implement the backend part of this, ending up in API endpoints /api/sids?airport=..&runway=.. and /api/sidalt?airport=..&sid=..

We'll implement the frontend part of this later.

## CTR boundaries from LFV data

End goal: the rules for CTR ARR and CTR DEP sections actually check the control zone (CTR) boundaries.

Right now we have a hardcoded altitude somewhere that is considered "within/outside the CTR".
Let's get some real data [here](https://daim.lfv.se/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typename=mais:CTR&outputFormat=application/json&srsName=EPSG:3857) for controlled airports and [here](https://daim.lfv.se/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typename=mais:TIZ&outputFormat=application/json&srsName=EPSG:3857) for AFIS airports.

The backend should fetch the data on startup and extract the data necessary. In that GeoJSON data you'll find
the CTR boundaries for each airport (identified by the POSITIONINDICATOR property) and the upper boundary
(in feet MSL) in the UPPER property.

In case the LFV servers are down or whatever, and this data is not available, let's keep the current 
functionality as a fallback.

Implement this all the way to being included in the rules. 
Let's also add an endpoint, similar to the onrunway one, for testing: /api/withininctr?lat=...&lon=...&alt=...

...

To support "observer mode" let's use our new shiny stand data to automatically set groundstate=PARK (internally, not sent to ES plugin) for uncontrolled arrivals (controller="") when they are geographically at their stand and stationary.
