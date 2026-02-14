## Auto DCL

We're gonna implement three modes for DCL (data-link departure clearance) handling:
Manual (the current implementation), fully automatic, and semi-automatic mode.

In the frontend, to the right of the DCL button, we'll have a mode selection dropdown
with 3 choices: MANUAL, AUTO, SEMI

In automatic mode, when a DCL request is received, the backend will perform the same
actions as we do when opening the clearance dialog (set CFL, set squawk). If successful,
it automatically issues the clearance.

In semi-automatic mode, the backend will not automatically set CFL and squawk, but if
the user has already done so (by opening the clearance dialog, adjusting and closing it again),
that is, the CFL and squawk is already correctly set, then it automatically issues the clearance.

In both modes, if a clearance cannot be sent automatically, it'll work the same as with manual mode,
i.e. the user can open up the clearance dialog, make adjustments and decide wether to reject or send a clearance.

For all modes, there also needs to be a 10 minute timeout where, if the user didn't reject or send
a clearance as response to a clearance request, it's automatically rejected with a message
similar to the "FLIGHT PLAN NOT HELD" but instead "CONTROLLER TIMEOUT".
