In the action rules, where we match against myRole, we should consider the vatsim top-down structure..
To do that, we need to know about other controllers, as we already do (gndOnline etc) but let's revisit it.
Basically, we shouldn't need delOnline and gndOnline specifically stated as we have now if we instead consider myRoles as
an array. The way it works with the top-down structure is that, for example if I'm logged in as TWR and nobody else is online
my roles would be [DEL, GND, TWR], if GND logs on, I would have [TWR] and the GND controller would have [DEL, GND] etc.
The top-down (reverse) order is DEL, GND, TWR, APP, CTR.
For CTR, we don't match airport name like we do for DEL, GND, TWR, APP..
For example, ESOS_1_CTR controls ESSA, so if ESSA*_TWR is online, I would have [APP, CTR].
If we do it this way and consider myRoles as an array of my top-down roles... role matching in the rules should be easier
and we shouldn't have to state delOnline, gndOnline etc...
Note that the myRoles array is per airport, e.g. if I'm logged in as ESGG_E_APP I'm covering ESGG, ESGT and ESIB.
If ESGG_TWR is then online, my roles would be only APP for ESGG but [DEL, GND, TWR, APP] for ESGT and ESIB.
Let's revise the rules system in relation to roles based on the above.
