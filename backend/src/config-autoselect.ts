/**
 * Login-callsign → layout file (startup + when the login callsign changes).
 * Prefix includes the underscore so ESSA_ does not match ESSR_.
 */
const CONFIG_BY_CALLSIGN_PREFIX: ReadonlyArray<readonly [string, string]> = [
    ["ESSA_", "essa.yml"],
    ["ESGG_", "esgg.yml"],
    ["ESSR_", "multiairport.yml"],
    ["ESOS_", "multiairport.yml"],
    ["ESMM_", "multiairport.yml"],
]

/** ESMS*TWR and ESMS*GND use the packed 3-bay OTHER profile. Other ESMS positions do not. */
function isEsmsTowerOrGround(callsign: string): boolean {
    return callsign.startsWith("ESMS") && (callsign.endsWith("TWR") || callsign.endsWith("GND"))
}

export interface AutoselectConfig {
    file: string
    /** OTHER profile when file is saab.yml */
    saabLayoutId?: string
}

/** Config file (+ optional OTHER layout) for a login callsign, or undefined when this position should not auto-select. */
export function configFileForLoginCallsign(callsign: string | null | undefined): string | undefined {
    return configForLoginCallsign(callsign)?.file
}

export function configForLoginCallsign(callsign: string | null | undefined): AutoselectConfig | undefined {
    const cs = (callsign ?? "").trim().toUpperCase()
    if (!cs) return undefined
    if (isEsmsTowerOrGround(cs)) return { file: "saab.yml", saabLayoutId: "1rwy3" }
    for (const [prefix, file] of CONFIG_BY_CALLSIGN_PREFIX) {
        if (cs.startsWith(prefix)) return { file }
    }
    return undefined
}
