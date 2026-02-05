We're gonna make an "on runway" section rule. In @data/runways.csv we have all the data we need to determine if an aircraft (radar target) is geographically on a runway. With the airport elevation from @data/airports.csv and the radar target altitude we can also determine if an aircraft is on the ground or low enough to be considered "on the runway".

Make a lookup function, isOnRunway(lat, lon, alt, airport, runway), that takes the airport runway(s) (for e.g. ESSA there are multiple runways), draws a line between the two ends of the runway, adds the runway width, plus a buffer (configurable, constant for now) of say 20ft, checks wether the given lat/lon is within the runway surface + buffer space, and also wether alt < field elevation + 300ft (configurable, constant). The runway argument should be optional, if unspecified checks all runways.

Expose the function as a REST endpoint for testing.

If you need to add some library for the geographical stuff that's fine.

Then let's use that function to make a new section rule which places a strip in the RUNWAY section if it's on the runway (should override all other rules, so highest priority).
