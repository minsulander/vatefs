import type { Flight } from "./types.js"

/**
 * CD ALL → TSAT → PUSH → TAXI: whether manual/sync sticky must yield to CLR / GS.
 * Cleared IFR stuck in CD ALL has no PUSH key; PUSH GS stuck in TSAT never reaches push bay.
 */
export function isDepBayFlowStickyInvalid(
    flight: Pick<Flight, "clearance" | "clearanceReadback" | "groundstate">,
    sectionId: string,
    look: string | undefined,
): boolean {
    const sec = sectionId || ""
    const isPending = sec === "pending_dep" || sec.endsWith("_pending_dep")
    const isClearedSec = sec === "cleared" || sec.endsWith("_cleared")
    const isPushSec = sec === "push_start" || sec.endsWith("_push_start")
    const isTaxiSec =
        sec === "taxi" ||
        sec.endsWith("_taxi") ||
        sec === "twy" ||
        sec.endsWith("_twy") ||
        sec === "taxi_dep" ||
        sec === "taxi_arr" ||
        sec.endsWith("_taxi_dep") ||
        sec.endsWith("_taxi_arr")
    if (!isPending && !isClearedSec && !isPushSec && !isTaxiSec) return false

    const gs = (flight.groundstate || "").toUpperCase()
    const hasClearance =
        look === "paper"
            ? !!(flight.clearance || flight.clearanceReadback)
            : !!flight.clearance

    if (gs === "PUSH" || gs === "STUP") return !isPushSec
    if (gs === "TAXI" || gs === "TXIN") return isPending || isClearedSec || isPushSec
    if (gs === "LINEUP" || gs === "DEPA") {
        return isPending || isClearedSec || isPushSec || isTaxiSec
    }

    if (isPending && hasClearance) return true
    if (isClearedSec && !hasClearance) return true
    if (isPushSec) return true
    return false
}
