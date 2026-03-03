## Fix transfers

We've "forgotten" to implement the "flightPlanFlightStripPushed" message from the plugin, which have resulted in transfers not appearing to work and ASSUME button not showing up until we manually refresh...

The message is sent with "sender" and "target" controller callsigns, like this (from the plugin debug log):
```
[18:15:03] EFS: FlightPlanFlightStripPushed SAS7228 sender ESOS_3_CTR target ESSA_TWR
```

That message needs to update the flight, setting the handoffTargetController appropriately. Hopefully that will fix all cases
where users have reported "transfers aren't syncing"..

...

 I'm using the backend log for feedback from users and would like a bit more granularity.. e.g. "flightStripPushed" doesn't log anything, I          see a lot of "Strip SAS123 updated" but would like more traceability to the code. Look through backend logging in general and try to improve
  where things are logged for a better chance to trace misbehavior to code.                                                                         
