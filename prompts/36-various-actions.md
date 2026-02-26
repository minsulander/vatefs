## Implementation of various actions

Here are a few various implementations and improvements:

- On strips for airborne aircraft with clearedToLand=true, we need a "GOA" button, with a "GOAROUND" action, 
  sending a type="goaround" message to the plugin that sets the scratchpad to "MISAP_" (same as running command .efs scratch SAS123 MISAP_).

- New move action: moving an aircraft with clearedToLand=true from RUNWAY to CTR DEP section should clear the clearedToLand flag
  (unsetClearedToLand plugin message).

- For departures, add a "Clearance" option to the context menu, which opens the clearance dialog, so we can revise the clearance in hindsight.

- No need for "delete strip" confirmation dialog when deleting a note strip.

- When I'm logged on as APP or CTR (my callsign ends in APP or CTR, except if it ends in R_APP or R_CTR (which are remote tower positions)),
  let's not show the XFER button for outbound departures (in CTR DEP), as we will keep them beyond the scope of the EFS application.
  