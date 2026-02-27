import fs from "fs"
import path from "path"

let logonCode: string | null = null
const dclTemplates = new Map<string, string>()

/**
 * Load Hoppie configuration from EuroScope directory.
 * Reads logon code from TopSkyCPDLChoppieCode.txt and DCL templates from TopSkyCPDLC.txt.
 */
export function loadHoppieConfig(euroscopeDir: string): { logonCode: string | null; dclTemplates: Map<string, string> } {
    const pluginsDir = path.join(euroscopeDir, "ESAA", "Plugins")

    // Load logon code
    const codeFile = path.join(pluginsDir, "TopSkyCPDLChoppieCode.txt")
    if (fs.existsSync(codeFile)) {
        const raw = fs.readFileSync(codeFile, "utf-8").trim()
        if (raw.length < 40 && /^[a-zA-Z0-9]+$/.test(raw)) {
            logonCode = raw
            console.log(`Hoppie logon code loaded (${raw.length} chars)`)
        } else {
            logonCode = null
            console.log("Hoppie logon code file does not contain a valid code")
        }
    } else {
        logonCode = null
        console.log(`Hoppie logon code file not found: ${codeFile}`)
    }

    // Load DCL templates from TopSkyCPDLC.txt
    const cpdlcFile = path.join(pluginsDir, "TopSkyCPDLC.txt")
    dclTemplates.clear()
    if (fs.existsSync(cpdlcFile)) {
        const content = fs.readFileSync(cpdlcFile, "utf-8")
        const lines = content.split("\n")
        let inDclSection = false

        for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed === "[DCL]") {
                inDclSection = true
                continue
            }
            if (trimmed.startsWith("[") && trimmed !== "[DCL]") {
                inDclSection = false
                continue
            }
            if (inDclSection && trimmed.startsWith("DCL:")) {
                // Format: DCL:<airport>:SID:<template>
                const parts = trimmed.split(":")
                if (parts.length >= 4) {
                    const airport = parts[1]
                    const template = parts.slice(3).join(":")
                    dclTemplates.set(airport, template)
                }
            }
        }

        if (dclTemplates.size > 0) {
            console.log(`DCL templates loaded for: ${[...dclTemplates.keys()].join(", ")}`)
        }
    } else {
        console.log(`TopSkyCPDLC.txt not found: ${cpdlcFile}`)
    }

    return { logonCode, dclTemplates }
}

/**
 * Get airports that have DCL templates configured.
 */
export function getDclAirports(): string[] {
    return [...dclTemplates.keys()]
}

/**
 * Get the Hoppie logon code, or null if not available/valid.
 */
export function getLogonCode(): string | null {
    return logonCode
}

/**
 * Get the DCL template for a specific airport.
 */
export function getDclTemplate(airport: string): string | undefined {
    return dclTemplates.get(airport)
}

/**
 * Data needed to fill a DCL template
 */
export interface DclTemplateData {
    callsign: string
    ades: string
    drwy: string
    sid: string
    assr: string
    eobt: string
    cfl: string
    freq_own: string
    freq_next: string
    atis: string
    qnh: string
    rmk: string
}

/**
 * Apply substitutions to a DCL template string and validate no tokens remain.
 * Throws if any unrecognised <...> token is left after substitution.
 */
function applyDclSubstitutions(template: string, substitutions: [RegExp, string][]): string {
    let result = template
    for (const [pattern, replacement] of substitutions) {
        result = result.replace(pattern, replacement)
    }
    const remaining = result.match(/<[^>]+>/i)
    if (remaining) {
        throw new Error(`Unknown DCL template token: ${remaining[0]}`)
    }
    return result
}

/**
 * Fill a DCL template with plain values (for dialog preview).
 * Replaces <ades>, <drwy>, etc. with actual values.
 */
export function fillDclTemplate(airport: string, data: DclTemplateData): string | undefined {
    const template = dclTemplates.get(airport)
    if (!template) return undefined

    return applyDclSubstitutions(template, [
        [/<callsign>/gi, data.callsign],
        [/<cr\/lf>/gi, "\n"],
        [/<ades>/gi, data.ades],
        [/<drwy>/gi, data.drwy],
        [/<sid>/gi, data.sid],
        [/<assr>/gi, data.assr],
        [/<eobt>/gi, data.eobt],
        [/<cfl>/gi, data.cfl],
        [/<freq_own>/gi, data.freq_own],
        [/<freq_next>/gi, data.freq_next],
        [/<atis>/gi, `ATIS ${data.atis}`],
        [/<qnh>/gi, `QNH ${data.qnh}`],
        [/ ?<rmk>/gi, data.rmk ? ` ${data.rmk}` : ""],
    ])
}

/**
 * Fill a DCL template with @value@ markers (for CPDLC send).
 * The @ signs delimit values in the Hoppie CPDLC protocol.
 */
export function fillDclTemplateWithMarkers(airport: string, data: DclTemplateData): string | undefined {
    const template = dclTemplates.get(airport)
    if (!template) return undefined

    return applyDclSubstitutions(template, [
        [/<callsign>/gi, `@${data.callsign}@`],
        [/<cr\/lf>/gi, "\n"],
        [/<ades>/gi, `@${data.ades}@`],
        [/<drwy>/gi, `@${data.drwy}@`],
        [/<sid>/gi, `@${data.sid}@`],
        [/<assr>/gi, `@${data.assr}@`],
        [/<eobt>/gi, `@${data.eobt}@`],
        [/<cfl>/gi, `@${data.cfl}@`],
        [/<freq_own>/gi, `@${data.freq_own}@`],
        [/<freq_next>/gi, `@${data.freq_next}@`],
        [/<atis>/gi, `ATIS @${data.atis}@`],
        [/<qnh>/gi, `@QNH ${data.qnh}@`],
        [/ ?<rmk>/gi, data.rmk ? ` @${data.rmk}@` : ""],
    ])
}
