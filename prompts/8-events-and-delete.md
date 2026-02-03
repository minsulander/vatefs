Let's add some more event handling for the automatic sequence, and deleting strips.
For the departure sequence, we need to determine when a flight is airborne. 
For now we're only going to use altitude for this (in the future we're also going to add lateral geo).
Add a config variable for field elevation (default 500ft).
I've added the "radarTargetPositionUpdate" message type to the plugin.
When receiving a "radarTargetPositionUpdate", if the altitude is > 300 ft above field elevation, set the airborne flag.
That should automatically move a departure strip to the CTR DEP section according to the current rule.

Now we also need delete rules. Strips matching delete rules should become invisible to the user, but maybe not deleted entirely,
since they might be deleted due to a state that is later changed by the user.. So let's put them in a "deleted" state somewhere
in the store.

For departures, strips should be deleted when they're outside the CTR laterally and vertically, but let's only consider
altitude at this time, using "radarTargetPositionUpdate" and altitude > 1500 ft above field elevation. There should also
be a condition that they're transferred/freed, i.e. "not_myself".

For arrivals it's simpler, strips should be deleted when their groundstate is set to "PARK". Here is a typical case where a
user might select "PARK" by mistake, and change it to "TXIN" right away, hence the importance of not completely deleting the
data immediately.

...

In general, when strips are moved to a section automatically, they should be added from the top. But this should be configurable in the section, wether to add from top (default) or bottom (or, in the future, according to a sort field like ETA or EOBT, but let's do that later). Let's implement that behavior. Gaps should also be shifted down. E.g. if there is a gap at position 0, that should be moved down so there is a gap between the newly inserted strip and the existing one.

...

Strips that are cleared for takeoff (e.g. in the RUNWAY section with ground state=DEPA) should show a "cleared for takeoff triangle" - a green triangle pointing upwards, in the right side of the strip (in lieu of the default action button, as there should be no default action for flights taking off in the runway section). 
