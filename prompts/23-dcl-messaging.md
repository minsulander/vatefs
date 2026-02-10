## DCL messaging

Now let's move on to implementing DCL messages.

When a pilot requests clearance, we'll receive a message like this:

```
REQUEST PREDEP CLEARANCE BCS98 A306 TO EDDH AT ESGG STAND 5 ATIS NA
```

We then need to validate that we have the flight, it's at the correct airport, and set its "dclStatus"
to REQUEST (if validation passes) or INVALID (if validation fails).

Let's (for now) indicate the DCL status by changing color of the CLNC button. Yellow for REQUEST, and
red for INVALID, UNABLE or REJECTED. Green for SENT (see below).

We'll also need to add the request message content to the strip so we can show it in the clearance dialog.

If the request is valid, we'll respond to the callsign (BCS98 in this example) on the Hoppie network with a type=cpdlc message:
```
/data2/34//NE/DEPART REQUEST STATUS . FSM 1300 260210 EGNX @BCS98@ RCD RECEIVED @REQUEST BEING PROCESSED @STANDBY
```
where 34 is a message sequence number, 1300 is the current UTC time (HHmm) and 260210 is the date.

If the request is invalid, we'll respond:
```
/data2/38//NE/DEPART REQUEST STATUS . FSM 1304 260210 EGNX @BCS98@ RCD REJECTED @REVERT TO VOICE PROCEDURES
```

The clearance dialog should show the current DCL status and latest DCL message, if any.

If a DCL request is successful, the user is expected to open up the clearance dialog, set the SID, CFL etc
as usual, and review the request message, and pending DCL clearance, which is constructed from the
DCL template from TopSkyCPDLC.txt. So we need to add a dclClearance field to the strip as well as the status and last message.

For ESGG it would read something like:
```
CLRD TO EDDH OFF 21 VIA VADIN3J SQUAWK 2052 EOBT 1135 REQUEST START-UP AND PUSH-BACK FROM 118.505
```
To be able to fill this out we need:
- a text field in the clearance dialog where one can add remarks, which fills the `<rmk>` bit of the template.
- add functionality to the ES plugin to add my frequency, available through CController.GetPrimaryFrequency(), to "updateMyself". For --mock mode we'll just use 118.505
- ATIS and QNH (for ESSA), let's worry about the backend fetching of that later, hardcode it to ATIS A and QNH 1013 in the backend for now.

There should now be two buttons in the clearance dialog: Reject and Send, in addition to the Cancel and OK.
Send should not be enabled until we have a valid clearance, i.e. the SID, CFL and Squawk fields are filled out correctly.
The SID must also be a valid IFR SID (5 letters, 1 number, 1 letter).

Clicking reject sends a reject message, same as if request is invalid, and sets dcl status to REJECTED.

Clicking send, the backend sends the clearance to the pilot via hoppie type=cpdlc:
```
/data2/2//WU/ESGG PDC 001 . . . . . CLD 1314 260210 ESGG PDC 001 @BCX98@ CLRD TO @EDDG@ OFF @21@ VIA @VADIN3J@ SQUAWK @2052@ EOBT @1135@ REQUEST START-UP AND PUSH-BACK FROM @118.505@ @GOOD EVENING@
```
Where /2/ is message sequence number, 1314 utc time, 260210 date.
/WU means we're expecting a wilco/unable response from the pilot.

So see how the backend needs to fill out the template with @ signs. The clearance dialog should show the filled-in values (between the @ signs) in bold font.

Once the message is sent, dclStatus=SENT.

If the pilot responds unable, dclStatus=UNABLE.

If the pilot responds wilco, we receive:
```
/data2/1/17/N/WILCO
```
The backend will automatically respond:
```
/data2/18//NE/ATC REQUEST STATUS . . FSM 2054 260209 ESGG @BCS98@ CDA RECEIVED @CLEARANCE CONFIRMED
```
Then we'll set dclStatus=DONE and set the clearance flag (as if we pressed OK, via tha ES plugin).

If, during this process, the user presses OK in the clearance dialog, that means the clearance was handled via voice,
and we'll clear dclStatus, last message and clearance.

If, during the process, the user presses Reject, we'll send reject, set the status to REJECTED, and even if we get a wilco
we won't go further in the DCL process.

Pressing Cancel does the same as without DCL (clearing the clearance flag if it was set, otherwise just close the dialog).

Ok, that's quite a few things. Plan, make a TODO-list, update CLAUDE.md when done. My plan is to test this manually with
some manual messaging on the Hoppie network.
