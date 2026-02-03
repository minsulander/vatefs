When manually dragging&dropping a strip, the backend should be able to send a command to euroscope to update the ground state. Examples:
- Move strip from PENDING CLR to CLEARED -> set clearance flag
- Move strip from CLEARED to START&PUSH -> set groundstate PUSH
- Move strip from START&PUSH to TAXI -> set groundstate TAXI
- Move strip from TAXI to RUNWAY -> set groundstate LINEUP
- Move strip from INBOUND or CTR ARR to RUNWAY -> set clearedToLand=true
- Move arrival strip from RUNWAY to TAXI -> set groundstate TXIN
Let's implement a placeholder for these actions in the backend. We'll finish the euroscope plugin implementation at a later
stage and start with just the rules and console logs (similar to the current (manual) strip actions). 
Some of the rules above we might be able to deduce from the current sectionRules?
Maybe we need to add separate rules... figure out something smart.
