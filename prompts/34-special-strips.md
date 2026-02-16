## Special strips and strip creation

In the frontend, the bottom bar should contain "tiny strips" that we can either click on or drag out to a section
to create new strips. These should be, from left to right (centered in the bottom bar):

- VFR DEP - looks like a small departure strip (blue ribbon) - clicking or dragging to a section opens up a
  strip creation dialog, where we can enter callsign and aircraft type. Clicking OK in that dialog creates
  a new strip (where we moved it or according to the default rule for departing aircraft) with the specified
  callsign, aircraft type, VFR, with our airport as origin, and ZZZZ as destination. If we cover multiple airports
  we also need to have a drop-down selection for origin. Later, we're gonna actually create a flight plan if
  there's no flight matching the callsign, but we'll leave that to later. So, for now, a strip with no matching
  flight is OK, although that should be indicated by a greyed-out callsign. The strip creation dialog should 
  indicate whether a matching flight was found or not, so we know what's up before clicking OK or Cancel.

- VFR ARR - same as above but yellow ribbon, destination instead of origin.

- CROSS - crossing aircraft (purple ribbon), creates a new strip with a new direction (cross), where neither origin or destination
  is our airport. This opens up a dialog where we just enter callsign. Same as above, if there's no matching
  callsign, we'll show it as greyed-out in the strip, we'll add flight plan creation functionality later.

- NOTE - this creates a special type of strip (grey ribbon) we can use to place notes on the strip board. The strip basically
  just contains an editable text field that we can click to change the text. After clicking or dragging it out on
  the board, the text field should be focused so we can type right away. Clicking on the text of an existing note
  strip lets us edit the text in place.

The functionality above needs to work both on desktop and touch.
Have a look and the types, messaging, and rules to support the new 'cross' direction of flight.
Plan the work, make a TODO-list. Finish off with updating CLAUDE.md to reflect major changes.

