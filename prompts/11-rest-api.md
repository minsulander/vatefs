EfsConfig vs EfsStaticConfig is a bit confusing. Looks like what's now called EfsConfig and config could be called EfsLayout and layout instead. Let's rename it to avoid confusion.
  
...

We're gonna need a REST API for debugging, inspecting what's in the backend store, configuration etc.
Let's start with flights: I want to be able to GET /api/flights and /api/flight/<callsign> and get a JSON
representation of what's in the store.

...

Then, following the same pattern as before, let's make REST endpoints: 
/api/config, /api/strips, /aip/strip/<callsign>
