/**
 * Login-callsign → layout file (startup + when the login callsign changes).
 * Prefix includes the underscore so ESSA_ does not match ESSR_.
 */
const CONFIG_BY_CALLSIGN_PREFIX: ReadonlyArray<readonly [string, string]> = [
    ["ESSA_", "essa.yml"],
    ["ESGG_", "paper.yml"],
    ["ESMS", "paper.yml"],
    ["ESSB", "paper.yml"],
    ["ESPA", "paper.yml"],
    ["ESSR_", "multiairport.yml"],
    ["ESOS_", "multiairport.yml"],
    ["ESMM_", "multiairport.yml"],
]

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
    for (const [prefix, file] of CONFIG_BY_CALLSIGN_PREFIX) {
        if (cs.startsWith(prefix)) return { file }
    }
    return undefined
}
