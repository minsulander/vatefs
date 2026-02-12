## More DCL improvements

We're gonna add some edge cases to the DCL messaging flow.

1. If an aircraft requests clearance via DCL, where we're missing a flightplan, we should respond something similar to:
```
/data2/1//NE/FSM 2059 260211 ---- DLH5MR RCD REJECTED @FLIGHT PLAN NOT HELD @REVERT TO VOICE PROCEDURES
```

2. If we've sent a clearance via DCL, but received no WILCO/UNABLE response for 10 minutes, we should send something like this:
```
/data2/24/21/NE/ATC REQUEST STATUS . . FSM 1920 260211 EDDM @DLH1KT@ ACK NOT RECEIVED @CLEARANCE CANCELLED @REVERT TO VOICE PROCEDURES
```

In both cases, that's the end of the conversation.

Next, we need more measures to make the user aware of an incoming DCL clearance request. Let's do it in two ways:

1. In the frontend, make the yellow button flash when dclStatus=REQUEST and the DCL flow is waiting for user input.

2. In the backend, we're gonna play a sound. There's a wav file in the euroscope directory `ESAA/Plugins/TopSkySoundCPDLC.wav`
   which should be played when a request is received. We're gonna need functionality for node to play WAV files for this.
   There are a bunch of npm packages for this. If you need to, do a little research of which works best. Our target platform
   is Windows, we don't need cross-platform functionality, but if it's easily achieved it would be preferred as I'm also
   developing on a mac.

