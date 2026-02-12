## Support multiple controllers at same airport

EFS covers operations for flights controlled by DEL (delivery), GND (ground) and TWR (tower) controllers.
On VATSIM, there's the top-down philosophy, which means that if DEL is not online, GND takes DEL's responsibilities,
if GND is not online, TWR takes over GND's responsibilities, and if TWR is not online, APP or ACC takes over..
So, below, when TWR is mentioned, it should be considered as "active controller above GND or DEL".

So far, we've only considered a single TWR controller at the airport. Let's add some functionality for cooperation
between TWR/GND/DEL. First of all, we need to know:
- Is the current user (from updateMyself messages) a DEL, GND or other controller?
- What other relevant controllers are online at the airport? (should be available throught controllerUpdate messages,
but maybe it will be enough to just look at the "nextController" callsign of flights)

In general, DEL has responsibility for handing out clearances up until the point where flights are ready for pushback.
GND controls all ground movements (pushback, taxi out, taxi in, park).
TWR controls the runways and control zone (line-up, takeoff, landings, handoff to/from controllers above).

A delivery controller at the airport will have a callsign that starts with the airport ICAO and ends with DEL,
e.g. ESSA_DEL or ESSA__DEL or ESSA_X_DEL. For ground, it's GND, so ESSA_W_GND or ESSA_N_GND or ESSA__E_GND or ESSA_E__GND.
In our context, TWR is any callsign not matching the above.

Let's implement som rules:
- If I'm DEL, instead of the PUSH action, there should be a READY action which sets groundstate=DE-ICE and initiates a transfer
  to the next controller (next frequency should also be shown, just like XFER). No subsequent actions should be shown
  (taxi, lineup, takeoff etc).
- If I'm GND, I should expect handover from DEL for aircraft in the READY (groundstate=DE-ICE) state, and be able to ASSUME them.
- If I'm GND, instead of the LU/CTO actions, I should see XFER to TWR frequency. If TWR is not online, I should still get
  XFER but that frees the track instead of handover.
- If I'm GND or DEL, I shouldn't see the CTL action or any other action on airborne aircraft.
- If I'm DEL, I shouldn't see taxi actions.
- If I'm GND or TWR, I shouldn't see CLNC or ASSUME of pending departures if DEL is online.
- If I'm TWR, I shouldn't see TXI if GND is online, I should see XFER to ground frequency instead.
- If I'm TWR, I shouldn't see PUSH or TXO.. but that should already be covered since the flights won't be assumed.

So to summarize, we need authorization for actions (both buttons and move actions) based on wether we're DEL, GND or TWR+.
And a few new XFER rules and the new READY action.
For --mock mode, all of the above can be bypassed (we can assume TWR+).

This is probably gonna require quite a few changes. Plan your work, make a TODO-list, and feel free to ask questions.
