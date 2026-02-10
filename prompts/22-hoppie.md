## DCL/Hoppie backend functionality

We're going to start working on the ability to send clearances via DCL (data-link clearance)
over the Hoppie network.

Have a read in the hoppie documentation:
- Docs: http://hoppie.nl/acars/system/tech.html
- CPDLC: http://hoppie.nl/acars/system/cpdlc.html

First, we need to get the user's Hoppie logon code.
It's available in the Euroscope directory, under ESAA/Plugins/TopSkyCPDLChoppieCode.txt.
That file will either contain the user's Hoppe logon code, which should be ~24 characters,
or it will contain something like the following message:
```
Enter hoppie code here
Get it here: http://www.hoppie.nl/acars/system/register.html - 

--  make sure to delete all the text here and enter the hoppie code. The code is the only thing to enter in this file!  ---
```
In case the file doesn't contain a valid hoppie code (if we strip whitespace from the content of the file it should
be < 40 characters and contain only digits, upper and lower case letters), then the user doesn't have a valid logon code
and all of the DCL functionality should be disabled.

Second, we need to get the EuroScope package DCL configuration.
It's available in the Euroscope directory, under ESAA/Plugins/TopSkyCPDLC.txt.
Have a look at the file, in my local case it's @/Users/main/VATSIM/drive_c/EUROSCOPE/ESAA/Plugins/TopSkyCPDLC.txt.
There, at the top, you'll see that there are two airports that have DCL, ESGG and ESSA, with a
template for clearance delivery. We need to store that in the backend somewhere.

Moving to the frontend, the top bar should have a DCL button. When ESGG xor ESSA (so not both) are among our airports,
the DCL button should be shown, initially grey. Clicking the button starts the backend DCL service and logs in.
Once we've successfully logged in, the button should be green, if unsuccessful, it should turn red. 
When logged in, clicking the button logs out.

In the backend, we "login" by sending a type=ping message to the Hoppie network with, expecting a response that just says
"ok". Once logged in, as stated in the docs, we should send a type=poll message every 45-75 (randomly spaced) seconds,
checking for messages. Incoming messages should be placed in a queue, output to console log and forwarded via websocket 
to the frontend. Let's leave further message handling until later - for now let's focus on login/logout and establishing
the connection.

Our hoppie messages should use callsign=ESGG or ESSA if we're logged (on Euroscope) as an active controller of one of
those airports. For testing, let's make it so that with --mock, we'll use the callsign VATEFSTEST.

This is a large change. Plan your work, make a TODO-list, and finish off with updating CLAUDE.md.

...

There's also a status endpoint for the Hoppie network: https://www.hoppie.nl/acars/system/status.html
Check it out, and let's also use that in the backend when we check for DCL availability.
