We're gonna take the first steps towards a functional backend. We already have a websocket connection established between 
the frontend store and backend, and we have useful mock data in the frontend store populating the views. So let's move the
frontend mock data to the backend, and start drafting the first version of the websocket API.

The backend should send JSON messages, distinguished by a "type" field. So let's make the backend send the configuration
(currently bays and sections) when a client connects, and then send the mock flights, but not all right away, space the
messages with a random delay of say 300-500 milliseconds. Let's call that message type "flight" and it's up to the frontend
to decide that the data should populate the flight strips. In the future we might have flight data that goes into other views,
not only the strips. In the future, the backend will "push" flight data to the frontend whenever changes occur. 
But we might also want to implement a refresh function, so let's also implement "request" messages for the frontend 
to request config and flight updates from the backend.

Shared (between backend and frontend) code, e.g. for the data transfer models, go in the @common project.

End result: no mock data in frontend, mock data in backend, first draft of websocket API sending data from backend to frontend.
