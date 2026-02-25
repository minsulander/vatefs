## Flight plan creation

Our ".efs apl" command that we previously implemented in the ES plugin seems to have worked somewhat.

Let's now hook up the strip creation and flight plan creation.

- When I create a new VFR DEP, if no flight plan is found, a flight plan should be created
  similar to the ".efs apl" command, with the origin and aircraft type set to what I selected 
  in the dialog. If there is already a flightplan, the origin, flight rules, aircraft type
  should be amended if they differ.

- When I create a new VFR ARR, same thing, but let's set the destination and atyp, leaving
  the origin ZZZZ if there's no flightplan.

- For CROSS strips, also create a flightplan if there is none, setting both origin and
  destination to ZZZZ.

Implement messaging and the required functionality in the euroscope plugin.
