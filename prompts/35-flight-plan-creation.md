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

...

Ok so now I have this flight, SEGBY that starts out at ESGG with no flight plan.
I click VFR DEP, fill out C172. It shows up, a flight plan is created.
In the clearance dialog, RWY shows --, but it should show 21 as I have runway 21
selected as the departure runway. If I click and select runway 21, I can see in
EuroScope that it selects 21 and updates the flightplan route to "ESGG/21" but
I don't see that updated in the strip or clearance dialog.

In euroscope, the flight has been assigned squawk 7334 automatically, but the
clearance dialog just shows ----. If I click the squawk field, i see that resetSquawk
is fired, the squawk is updated to 7337 in EuroScope, but I don't see that in the strip
or clearance dialog.

It's weird because resetSquawk works for other aircraft that already have a flightplan...

The clearance dialog should show default departure runway.
Maybe assignDepartureRunway needs to send the new route back?
Maybe resetSquawk needs to check the assigned squawk code and send it back?

...

Ok so it seems that euroscope gets weird when we don't fill out the flight plan correctly.
The flightPlanDataUpdate message never gets across.
If I open up the flightplan and manually set the destination to ZZZZ it seems to be sent and things start working.
Let's make sure the destination is set to ZZZZ. 
Let's make sure EOBT is set (CFlightPlanData.SetEstimatedDepartureTime) to the current UTC time.
Also seems like euroscope doesn't get the aircraft type (it's empty when I open the flight plan dialog in euroscope),
but that might be a result of it thinking the flightplan is incomplete...

...

Hmm.. for a VFR DEP, the destination still isn't set. The strip shows ???? and euroscope flight plan dialog shows empty. However, if        I do the same thing again (click VFR DEP, fill out the callsign and aircraft type), destination is set to ZZZZ and the                      flightPlanDataUpdate is communicated. So maybe we need to do this in two steps? Also, the aircraft type is never filled out in the          euroscope plugin - maybe we need to fill out a full aircrafttype/wtc/equipment line like "PC24/M-VGDW/C" (not sure of all the data          needed there but we could start with assuming light wtc, so if I enter C172 fill it out as C172/L-VGDW/C for example.   