## Multiple runways support

At ESSA there are 3 runways. Most of the time, we use 1 runway for arrivals, and 1 runway for departures.
Sometimes, 1 runway is used for both arrivals and departures.
Sometimes, even though e.g. 19R is the designated arrival runway and 08 the departure runway,
an aircraft might need to depart from 19R.
Sometimes, even though e.g. 19R is the departure runway, an aircraft will arrive at runway 19R.
Sometimes, even though e.g. 01L is the arrival runway, 08 is the departure runway, an aircraft will arrive
at the third runway (01R).
So we need to be able to make exceptions (which will be indicated by the flights arrRwy or depRwy field)
but *primarily* designated one runway for departures, and one for arrivals.

I've made a new config file @data/config/dualrwy4bays.yml, where we want two runway sections, one for
the arrival runway and one for the departure runway. 

Let's update the rules and functionality to support having these two separate sections. We can consider
"departure runway" the exception to "normal rules", e.g. for any aircraft operating on the third runway,
the fallback will be to consider it being on the arrival runway.

We'll also use templating in the section header titles, e.g. showing "RUNWAY 26" for the arrival runway
and "RUNWAY 19R" for the departure runway, depending on what we have selected. Note also that the
user might change the runway configuration, which will be evident in the "updateMyself" message.

...

Let's make it possible to switch configuration/layout from the frontend.
I've added the "name" field to the .yml config files. Add a dropdown in the top bar where we can select configuration.
Implement the required messaging between the frontend and backend, and make the backend reload the configuration and
re-apply section rules to place strips properly when config/layout changes.
