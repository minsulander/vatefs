## Local flights handling

We need to be able to handle "local" flights. Those flights have both origin and destination set to one of "my airports"
(commonly same airport for e.g. VFR flights in the traffic pattern), and as a consequence they can't be considered
a departure or arrival with our current rule engine.

I'm thinking the best way to handle this should be to introduce a new FlightDirection "local" in the rule engine, so that
we can specify move and action rules etc based on that. Some rules, like the ground state based ones like for push&start,
taxi, would be the same for departures and local, but some, like placement in ctr_arr or ctr_dep sections, won't work and
the user will have to manually move the strip between the ctr_dep and ctr_arr sections for flights in the traffic pattern.

Have a look at the rule engine etc and see what you think about the "local" direction above, or if you have a better idea
how to handle local flights.
