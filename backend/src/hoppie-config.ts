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
