Let's implement configuration from files. I like YAML, so let's use that to specify and load configuration.

Basically, take what's in @backend/src/static-config.ts and put in @data/config/ESGG.yml.
Make everything that has an id use yaml object keys instead, so something like:

airports:
    - ESGG
radarRange: 25 # nm
layout:
    bays:
        bay1:
            sections:
                - inbound:
                    title: INBOUND
# ...

sectionRules:
    ctr_dep_airborne:
        sectionId: ctr_dep
        bayId: bay2

# etc...

Let's leave myCallsign out of the config. That should come from ES myselfUpdate, but possibly be overriden with the --callsign parameter.. 

The backend should load ESGG.yml by default, but we should be able to provide another config file on the command line.
