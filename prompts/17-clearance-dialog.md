 For departures under "PENDING DEP", let's add an action button CLNC, which brings up a modal dialog that is the DEP CLEARANCE window,
 showing callsign in the header, with fields stacked vertically: RWY (=depRwy), SID, AHDG (directTo if set or hdg), CFL, ASSR (=squawk), 
 with OK and Cancel buttons. Pressing OK or Cancel sends a { "type": "toggleClearanceFlag", "callsign": "SAS123" } if 
 flight clearance=true/false respectively.                                                                                                 

 The CLNC button should actually be available before the flight is assumed, so for an unassumed flight, show CNLC and ASSUME vertically stacked.

 In the clearance dialog, the ASSR field should be clickable, invoking a "resetSquawk" message to the ES plugin, updating the squawk code. 

 Oh, in the clearance dialog, the OK button should be disabled if flight.clearance == false and unassumed. If no squawk code is set
  (squawk=""), "----" should be shown and clickable so that one can set a squawk code.
  