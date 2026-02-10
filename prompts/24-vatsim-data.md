## ATIS information from the VATSIM Data API

In order to get the current ATIS and QNH to fill out the departure clearance template (and also for display in the frontend),
we're going to use the VATSIM data API. The backend needs to poll periodically (configurable, default 1 minute interval), the
endpoint https://data.vatsim.net/v3/vatsim-data.json.

For each airport except ESSA, if there's an ATIS online, there will be an atis with callsign e.g. `ESGG_ATIS`.
For ESSA, there are separate departure and arrival ATISes, `ESSA_A_ATIS`, `ESSA_D_ATIS`.

We need to extract the ATIS letter. Unfortunately we can't rely on the `atis_code` field in the VATSIM data, so we're
gonna parse the `text_atis` field (an array which we can just join by space) instead. Luckily, there's code for that
[here](https://github.com/minsulander/vatscout/blob/main/src/common.ts) which works. We're also going to extract the
QNH, which is just the number inbetween `QNH` and `HPA` in the text.

For filling out the departure clearance at ESSA, we're naturally gonna use the `ESSA_D_ATIS` as a source of information,
for other airports it's the `<icao code>_ATIS`. Update the DCL clearance generation, where we previously hardcoded
ATIS and QNH to use this information. If the information is missing, the DCL process needs to fail gracefully.

If the ATIS is not available (can't reach the VATSIM API, can't parse), in the departure clearance
we'll fill out `ATIS NA` and `QNH NA`.

In the frontend top bar, let's show ATIS, active runway (from myself.rwyconfig) and QNH for each airport that 
have the info, e.g. `ESGG Q 21 997`. For ESSA, split it up in arrival and departure info, e.g. `ESSA C 26 J 19R 1011`.
