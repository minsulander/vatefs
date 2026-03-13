## Prevent strips from "jumping around"

When running online with the EuroScope plugin in the loop etc, the experience is that when strips auto-move,
they "jump around" at the top. Looks like it's a result of two interactions between the frontend and backend
with some latency. Basically this should be really simple. When a new strip enters a section
as a result of an auto move rule, it should always be inserted at the top. It should be one interaction.
It's not reproducible with mock data.

Have a look at the code and see if you can find the cause.
