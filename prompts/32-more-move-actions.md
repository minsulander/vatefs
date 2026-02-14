## More move actions

First, let's implement a general rule (might not be a rule in config but rather in code):
When I manually move a strip from one section to another, the strip should never be automatically
moved back to the section I moved it from.

Next, let's add some move actions for "undo" operations:
- Moving from CLEARED to PENDING DEP -> unset clearance flag
- Moving from PUSH&START to CLEARED -> groundstate=ONFREQ
- Moving from TAXI to PUSH&START -> groundstate=PUSH
- Moving from RUNWAY to TAXI -> groundstate=TAXI for departures, TXIN for arrivals/locals
- Moving from RUNWAY to CTR ARR -> unset cleared to land
Apply changes to both the config layout files.
