We need to make the backend server a little smarter with finding the euroscope directory. It should try multiple locations in sequence, let's start with these three:
1. $APPDATA/EuroScope (like now)
2. C:\Program Files (x86)\EuroScope
3. $HOME/VATSIM/drive_c/EUROSCOPE

The proof for finding the correct directory is that it contains a subdirectory ESAA and at least one file matching ESAA*.prf

...

Let's continue implementing the clearance dialog.
First, separate it out into its own component file.

Then, the RWY field needs to be clickable, allowing us to reassign runway (with a dropdown). 
If we do reassign runway, it clears the SID field.

The SID field is clickable, showing a dropdown of valid SIDs for the chosen runway.

The HDG field shows a dropdown of headings between 005 and 360 with 5 degree intervals, zero-padded.

The CFL field also has a dropdown.
The dropdown shows A05 for 500 ft A10 for 1000 ft etc every 500 ft up to the
Transition Altitude (5000 ft hardcoded for now), then 060, 070 etc upto 510,
so 1000ft intervals for flight levels.

Changes made to the RWY, SID, HDG or CFL fields immediately send a message to the backend, which
in turn sends a corresponding message to the ES plugin. Types:
- RWY: "assignDepartureRunway"
- SID: "assignSid"
- HDG: "assignHeading"
- CFL: "assignCfl"
Let's implement the user interaction and messaging for now, leaving placeholders in the ES plugin. 
We'll implement the full plugin functionality later.

As this contains multiple steps, make a TODO list and plan before executing.

...

Let's add another dialog, the Flightplan (FPL) dialog. Showing the full flightplan for a flight.
Here's an [image of the flightplan dialog in EuroScope](https://www.euroscope.hu/images/1/16/FlightplanSettings.jpg) for inspiration. It should be available as the first option in the strip context menu. For now, it's read-only showing the information we have.

Let's also add a confirmation dialog "Delete strip for flight SAS123?" with Cancel/DELETE response
to the Delete context menu action, to avoid accidental deletes.
