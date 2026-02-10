/**
 * VATSIM ATIS data polling service.
 * Fetches ATIS information from the VATSIM Data API and extracts
 * ATIS letter codes and QNH values for configured airports.
 */

const VATSIM_DATA_URL = "https://data.vatsim.net/v3/vatsim-data.json"

interface VatsimAtisEntry {
    cid: number
    callsign: string
    text_atis: string[] | null
    frequency: string
}

interface VatsimDataResponse {
    atis: VatsimAtisEntry[]
}

interface AtisCache {
    letter?: string
    qnh?: number
}

/**
 * Extract the ATIS letter code from ATIS text.
 * Uses a cascade of regex patterns ported from vatscout.
 */
function extractAtisCode(icao: string, textLines: string[]): string | undefined {
    const text = textLines.join(" ")

    const patterns = [
        new RegExp(`${icao}( ARR| DEP|) ATIS( INFO| INFORMATION|) (\\w)\\b`),
        new RegExp(`${icao} INFORMATION (\\w)\\b`),
        /(ATIS|ARRIVAL|DEPARTURE|ARR|DEP|ARR AND DEP) (INFORMATION|INFO) (\w)\b/,
        /THIS IS \w+ INFORMATION (\w)\b/,
        /INFORMATION (\w) OUT([ .]|$)/,
        /END OF INFORMATION (\w)\w* ?\.?$/,
        /ADV\w+ YOU HAVE INF\w+ (\w)\b/,
        /ACK\w+ RECEIPT OF INF\w+ (\w)\b/,
        /^\w+ INFORMATION (\w)\b/,
        /^\w+ \w+ INFORMATION (\w)\b/,
        /^\w+ ATIS (\w) TIME/,
    ]

    for (const pattern of patterns) {
        const match = text.match(pattern)
        if (match) {
            // The letter is always in the last capture group
            const letter = match[match.length - 1]
            if (letter && /^[A-Z]$/i.test(letter)) {
                return letter.toUpperCase()
            }
        }
    }
    return undefined
}

/**
 * Extract QNH from ATIS text.
 */
function extractQnh(textLines: string[]): number | undefined {
    const text = textLines.join(" ")
    const match = text.match(/QNH\s+(\d{3,4})/i)
    if (match) {
        const val = parseInt(match[1]!, 10)
        // Sanity check: QNH should be between 900 and 1100 hPa
        if (val >= 900 && val <= 1100) {
            return val
        }
    }
    return undefined
}

export class AtisService {
    private airports: string[] = []
    private pollTimer: ReturnType<typeof setTimeout> | null = null
    private cache = new Map<string, AtisCache>()
    private essaCache: { arrLetter?: string; depLetter?: string; qnh?: number } = {}
    private onUpdate: () => void
    private pollIntervalMs: number

    constructor(options: { onUpdate: () => void; pollIntervalMs?: number }) {
        this.onUpdate = options.onUpdate
        this.pollIntervalMs = options.pollIntervalMs ?? 60_000
    }

    /**
     * Start polling for the given airports. Fetches immediately, then schedules.
     */
    start(airports: string[]): void {
        this.airports = airports
        this.poll()
    }

    /**
     * Stop polling.
     */
    stop(): void {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer)
            this.pollTimer = null
        }
    }

    /**
     * Get cached ATIS data for a single-ATIS airport.
     */
    getAtis(airport: string): { letter?: string; qnh?: number } {
        return this.cache.get(airport) ?? {}
    }

    /**
     * Get cached ATIS data for ESSA (split arrival/departure ATIS).
     */
    getEssaAtis(): { arrLetter?: string; depLetter?: string; qnh?: number } {
        return { ...this.essaCache }
    }

    private schedulePoll(): void {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer)
        }
        this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs)
    }

    private async poll(): Promise<void> {
        try {
            const response = await fetch(VATSIM_DATA_URL)
            if (!response.ok) {
                console.warn(`[ATIS] Failed to fetch VATSIM data: ${response.status}`)
                this.schedulePoll()
                return
            }

            const data = (await response.json()) as VatsimDataResponse
            if (!data.atis) {
                this.schedulePoll()
                return
            }

            let changed = false

            for (const airport of this.airports) {
                if (airport === "ESSA") {
                    changed = this.processEssa(data.atis) || changed
                } else {
                    changed = this.processAirport(airport, data.atis) || changed
                }
            }

            if (changed) {
                this.onUpdate()
            }
        } catch (err) {
            console.warn(`[ATIS] Error fetching VATSIM data: ${err instanceof Error ? err.message : err}`)
        }

        this.schedulePoll()
    }

    private processAirport(airport: string, atisList: VatsimAtisEntry[]): boolean {
        const callsign = `${airport}_ATIS`
        const entry = atisList.find((a) => a.callsign === callsign)

        const prev = this.cache.get(airport)
        if (!entry || !entry.text_atis) {
            if (prev) {
                this.cache.delete(airport)
                return true
            }
            return false
        }

        const letter = extractAtisCode(airport, entry.text_atis)
        const qnh = extractQnh(entry.text_atis)

        const changed = prev?.letter !== letter || prev?.qnh !== qnh
        if (changed) {
            this.cache.set(airport, { letter, qnh })
        }
        return changed
    }

    private processEssa(atisList: VatsimAtisEntry[]): boolean {
        const depEntry = atisList.find((a) => a.callsign === "ESSA_D_ATIS")
        const arrEntry = atisList.find((a) => a.callsign === "ESSA_A_ATIS")

        // Also check for combined ESSA_ATIS as fallback
        const combinedEntry = atisList.find((a) => a.callsign === "ESSA_ATIS")

        let depLetter: string | undefined
        let arrLetter: string | undefined
        let qnh: number | undefined

        if (depEntry?.text_atis) {
            depLetter = extractAtisCode("ESSA", depEntry.text_atis)
            qnh = extractQnh(depEntry.text_atis)
        }
        if (arrEntry?.text_atis) {
            arrLetter = extractAtisCode("ESSA", arrEntry.text_atis)
            qnh = qnh ?? extractQnh(arrEntry.text_atis)
        }

        // Fallback to combined ATIS
        if (!depLetter && !arrLetter && combinedEntry?.text_atis) {
            const letter = extractAtisCode("ESSA", combinedEntry.text_atis)
            depLetter = letter
            arrLetter = letter
            qnh = extractQnh(combinedEntry.text_atis)
        }

        const prev = this.essaCache
        const changed =
            prev.arrLetter !== arrLetter ||
            prev.depLetter !== depLetter ||
            prev.qnh !== qnh

        if (changed) {
            this.essaCache = { arrLetter, depLetter, qnh }
            // Also update the main cache for getAtis() fallback
            this.cache.set("ESSA", { letter: depLetter ?? arrLetter, qnh })
        }
        return changed
    }
}
