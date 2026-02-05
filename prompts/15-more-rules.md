We need a general delete rule that deletes strips for aircraft that are beyond the radarRange, in case some state was missing and no other rule deleted the strip. Let's implement that.

We also need a "manual delete" function, which should be accessible through the context menu on a strip. So let's implement a manual delete function (and message to the backend), and a simple dropdown menu for the strip which now has one menu entry: delete.

...

Let's remove "airport" from the config and consider it a state instead. It should be discovered by the "updateMyself" message. In that message, there will be e.g. rwyconfig.ESSA.arr = true or rwyconfig.ESGG.dep = true, for any airport in rwyconfig that has either arr or dep set, we should set it as "my airport" in the state.

We also need to be able to set airport for mock data or offline scenarios, so with the --mock argument set, use ESGG. For offline (no updateMyself messages), we should be able to set airport(s) using --airport argument.

...

The backend outputs a lot of messages like "Strip SAS2901 updated" and "Shifted 3 strips" even though there was no apparent change. Let's make sure that those console logs (and messages to the frontend) are only sent if there's an actual change to the data.

Also saw a bunch of messages like "Section pending_clr height set to 314.345223px", even though I wasn't touching the browser. Let's make sure resize messages aren't sent from the frontend unless we move more than say 3px.

...

Getting repeated messages "No section found for flight SAS62J". That's for an arrival that's parked at the gate, but
there's no controller online to set PARK state... so it's correct that this flight should not have a strip. Let's
avoid the repeated message by creating a deleted strip. So, we want the backend to output the log message once,
then publish a deleted strip (if that means first publishing a strip and then deleting it that's fine).

...

I accidentally moved the push_start section to bay 3 without updating the "bayId" property in the config, resulting in no strip as the strip had sectionId=push_start and bayId=4. If we assume section id:s are unique, we shouldn't need to specify bayId in strips as that is given by the section. We also shouldn't need to specify bayId in the config sectionRules as we already have specified the bay/section structure above it. Implement the necessary functionality looking up bayId from the bay/section structure and modify both the config and strip messaging so that sectionId is the only thing specified, and the bay/section relation is specified in one place (the layout).
