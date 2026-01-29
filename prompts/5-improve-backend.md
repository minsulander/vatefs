@backend/src/store.ts broadcasts config after changes like moveStrip and setGap... that's not right.
The 1:many relation between Section and FlightStrip is duplicated.
In the data model (@common/src/types.ts) Section.stripIds, Section.bottomIds should be removed 
(since FlightStrip already contains sectionId and position, add bottom: bool).
Section.gaps should be replaced with Gap being its own root data object.
In the backend, making changes to a strip should only broadcast that strip.
Making a change to a gap should only broadcast that gap, etc.
Deleteing a gap needs its own message too I guess. Same with strip, although only the backend can delete strips.
Adapt frontend store to follow same pattern.
