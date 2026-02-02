Let's start working on data management in the backend.

Take a look at the @euroscope-plugin/, see how the plugin sends messages such as "flightPlanDataUpdate" and "controllerAssignedDataUpdate". Right now, the backend just forwards these to the frontend, but we're gonna implement a "flight" store in the backend. The backend builds these flight records, and via configurable rules about which flight states, depending on origin/arrival airports, who's controlling the flight etc, maps them into flight strips. There are also going to be configurable rules about which bay&secton a strip goes into, depending mainly on the flight's groundstate (for starters, these rules are probably going to be extended later).

So let's start with the basics and use the mock data. Model the mock data as euroscope plugin messages instead, let the backend build flight objects in its store, map those to strips based on configurable rules. Right now those rules can be the following:
- Flights with groundstate="ARR" end up in the "ARRIVALS" section.
- Flights with no groundstate or groundstate="PUSH" at our airport end up in the "PENDING DEP" section.
- Flights that don't match any of the above but have origin/destination at our airport go into the "SAFEGUARD" section.
Of course this is going to be expanded later.

"Our airport" also needs to be configurable. Let's mock it to be "ESGG" for now.
The static configuration can be put in a mock JSON object for now. At a later stage the backend is going to read it from a file, or possibly download it from some central server.

Feel free to ask me questions if you need clarification.
