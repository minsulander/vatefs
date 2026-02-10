Let's implement the missing API calls in plugin.cpp ReceiveUdpMessages().

For changing runway and SID, there's a bit of convention used regarding the flight's route.

If, for example, I have KLM74L with the following route: VADIN DCT ABINO DCT ATTUS DCT EEL
And the current active runway set (known from myselfUpdate) is 21, VADIN3J will be default.
If I change runway to 03, we should insert a term at the start of the route, so it reads: ESGG/03 VADIN ...
The default SID will then be VADIN3M.
If I then change the SID to VFR·ASPE, we should change the first term of the route so it reads: VFR·ASPE/03 VADIN ...
And if I change the runway back to 21, it'll read: VFR·ASPE/21 VADIN ...
If I from the beginning changed only SID, it still adds the runway, so e.g: TOPLA3J/21 VADIN ...
So, essentially, SID/runway if I specified a SID other than default, or ESGG/runway if I haven't changed the SID.
Where ESGG is the departure airport.

So according to @euroscope-plugin/external/include/EuroScopePlugIn.h, we should use CFlightPlanData.GetRoute(), potentially
remove the first element if it matches the pattern <SID>/<rwy> or <departure airport>/<rwy> OR a SID specified by the
pilot when filing, such as VADIN3M (always 5 letters, 1 digit, 1 letter). Then set the new route using SetRoute(), and then
(I think) we need to call AmendFlightPlan().

That's for runway and SID.

For heading it's more straightforward, use CFlightPlanControllerAssignedData.SetAssignedHeading().

For CFL, use CFlightPlanControllerAssignedData.SetClearedAltitude().

When changing SID, the backend should look up the altitude (using the getSidAltitude function we made earlier) and automatically adjust the CFL (using the assignCfl plugin message).

...

We have a slight problem: the VFR SIDs use a weird character in between the VFR and the name.. somewhere there's a charset issue.
I see this in the EuroScope log:   [00:00:00] EFS: assignSid: KLM74L -> VFRÂ·HALL
  [00:00:00] EFS: assignSid: new route: VFRÂ·HALL/03 VADIN DCT ABINO DCT ATTUS DCT EEL

We need to compensate for the character set issue somehow - either directly in the EuroScope plugin, or in the messaging, or in the
parsing from the ESE file. EuroScope has to understand it as if it read it from the ESE file itself though..

...

New problem: ES doesn't always send SID using GetSid() - specifically for the VFR "SIDs". Let's first add the "route" (using GetRoute()) field to flight and flight plan update messaging so we can inspect it (using the /api/flight/<callsign> endpoint).

OK so it seems like setting the VFR SIDs works fine, it updates correctly in EuroScope. But then it doesn't update back... Ah, OK it's the
charset issue again. Seeing this in the EuroScope log:
  [00:13:26] EFS: SetJsonIfValidUtf8: Invalid UTF-8 string in key route
  [00:13:26] EFS: SetJsonIfValidUtf8: Invalid UTF-8 string in key sid

Let's make sure the weird characters in the VFR SIDs don't mess up sending flightplans route and sid.

...

When opening up the clearance dialog, the default CFL for the default SID should be set if no CFL is set.

Let's update the condition for the OK button in the clearance dialog being disabled. It should be disabled if:
- the flight is assumed by someone other than me (controller=not myself)
- I'm not a controller (myself.controller=false)

But it should NOT be disabled if:
- the flight is free/not assumed (controller="")
- the flight is assumed by me
