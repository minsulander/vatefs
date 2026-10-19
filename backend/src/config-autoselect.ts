/**
 * Login-callsign → layout file, used once at EFS startup.
 * Prefix includes the underscore so ESSA_ does not match ESSR_.
 */
const CONFIG_BY_CALLSIGN_PREFIX: ReadonlyArray<readonly [string, string]> = [
    ["ESSA_", "essa.yml"],
    ["ESGG_", "esgg.yml"],
    ["ESSR_", "multiairport.yml"],
    ["ESOS_", "multiairport.yml"],
    ["ESMM_", "multiairport.yml"],
]

/** ESMS*TWR and ESMS*GND use the fixed 3-bay layout. Other ESMS positions do not. */
function isEsmsTowerOrGround(callsign: string): boolean {
    return callsign.startsWith("ESMS") && (callsign.endsWith("TWR") || callsign.endsWith("GND"))
}

/** Config file for a login callsign, or undefined when this position should not auto-select. */
export function configFileForLoginCallsign(callsign: string | null | undefined): string | undefined {
    const cs = (callsign ?? "").trim().toUpperCase()
    if (!cs) return undefined
    if (isEsmsTowerOrGround(cs)) return "singlerwy3bays.yml"
    for (const [prefix, file] of CONFIG_BY_CALLSIGN_PREFIX) {
        if (cs.startsWith(prefix)) return file
    }
    return undefined
}
