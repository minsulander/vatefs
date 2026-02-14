Let's make some frontend improvements:

- In the clearance dialog, show destination airport at the top. The ICAO code, and then also the
  full name. I've added a file @data/ICAO_Airports.txt for this. Make the backend read this file,
  with a REST endpoint to lookup the full name for a certain ICAO code.

- In the clearance dialog, make the CFL, AHDG, SID dropdowns highlight the currently selected value and scroll so it's visible
  and in the middle

- In the clearance dialog, indicate SLOW aircraft for all flights with wakeTurbulence="L" and aircraftType != "P180"
  or wakeTurbulence="M" and aircraftType is one of ["ATP", "AT43", "AT45", "AT72", "AT75", "AT76", "B190", "C212", "D328", "DH8A", "DH8B", "DH8C", "E120", "F27", "F50", "JS31", "JS32", "JS41", "S100", "SF34", "SH33", "SH36", "SW4", "T100"].
  Perhaps we should put this in a config file somewhere..

- Highlight (make the button yellow) the TXI action button for arrivals that have left the runway

- Highlight the PARK action button for arrivals that have reached their stand (use same geographical check that we use
  for setting stand number for departures)

- Highlight the XFER action button for departures that have left the control zone (CTR/TIZ)

...

- In the clearance dialog, also show the departure airport if "my airports" is more than one

- In the flight strip, show "my airport" only if "my airports" is more than one, otherwise just show
  origin (for arrivals) and destination (for departures)

- In the flight strip, if there is no action button, let's make an empty space there so that strips
  with/without actions align better

- The cleared for takeoff and cleared to land green triangles - let's show them where EOBT/ETA is
  otherwise shown.

- For the ASSUME action, we need to adjust the font so that it's a bit more condensed horizontally.
  It doesn't quite fit within the button as it is right now.

- In the strip, where we now show SID and CFL for departures, show STAR for arrivals (and not CFL)

- In the clearance dialog header, right-aligned, show rules (I/V), aircraft type, weight category and stand number
  (like in the strip)

- Clicking on the destination airport in the clearance window reveals the flight full route (like in the flight plan dialog)
