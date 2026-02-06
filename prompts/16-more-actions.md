Let's add the TXO action (sets groundstate TAXI) on strips with the PUSH state, and when moving departures to the TAXI section. I've also implemented the "transfer" UDP message in the euroscope plugin so let's wire up the XFER action with that.

Add the TXI action (sets groundstate TXIN) on arrivals with ARR or no groundstate which are not airborne and not on runway.

In FlightStrip.vue, I've added a span that prints ---- when squawk is not set. Let's make that clickable, and
wire it up to sending the 'resetSquawk' message to the ES plugin.

On initial connection, the backend receives some flights before the "updateMyself" message. Let's inhibit deleting flights by the "delete_beyond_range" rule until we have airports set.

We should not show the ASSUME button when we're in observer mode - that is when "updateMyself" has controller=false. With mock data (--mock) let's fake that we are controller=true.

The clickable ---- for resetSquawk should only be clickable if I'm controller=true and the flight is either controlled by me (controller=my callsign) or free (controller is empty).

