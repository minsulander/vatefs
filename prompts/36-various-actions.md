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

...

 In the plugin, when we run ".efs start" and the plugin responds "Backend started" we also want to include instructions on how to            connect the frontend. Something like "EFS accessible at http://192.168.1.81:17770/", so the plugin also needs to figure out the IP
  address of the local machine.

...

I've added a bash script and Wix installer files in @scripts/ - make the installer also include a firewall rule to open efs.exe for incoming traffic
from outside, so it's possible to connect an iPad to EFS right after installation.

...

The auto DCL template for ESSA reads: `<callsign> CLRD TO <ades> OFF <drwy> VIA <sid> ALT <cfl><cr/lf>SQUAWK <assr> NEXT FREQ <freq_own> <atis><cr/lf><qnh><cr/lf>MONITOR <freq_own> AND REPORT READY<cr/lf><rmk>`

Still saw this auto DCL message sent today: `/data2/4//WU/CLD 1815 270226 ESSA PDC 001 <CALLSIGN> CLRD TO @ENGM@ OFF @19R@ VIA @ARS6G@ ALT @A050@<CR/LF>SQUAWK @1217@ NEXT FREQ @121.705@ ATIS @L@<CR/LF>@QNH 1007@<CR/LF>MONITOR @121.705@ AND REPORT READY<CR/LF>`

That doesn't work... take a look at the auto dcl template code again and see what's missing.
`<callsign>` and `<cr/lf>` should never make it into the final message.. and in case the template changes in the future `<blah>` shouldn't make it to
the message either... rather throw an error.

Here's a correct example: `/data2/8//WU/CLD 1348 260226 ESSA PDC 003 @DLH24@ CLRD TO @EKCH@ OFF @19R@ VIA @PETEV2G@ ALT @5000 FT@ SQUAWK     @0277@ NEXT FREQ @118.505@ ATIS @X@ @QNH 1006@ MONITOR @118.505@ AND REPORT READY @INFORMATION N Q1006@`

