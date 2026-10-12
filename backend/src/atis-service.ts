/**
 * VATSIM ATIS + VatIRIS METAR polling service.
 * ATIS letter/QNH from VATSIM Data API; QNH falls back to VatIRIS METAR
 * (same source VatIRIS uses when no ATIS/WX is online).
 */

const VATSIM_DATA_URL = "https://data.vatsim.net/v3/vatsim-data.json"
/** VatIRIS METAR proxy — same endpoint as VatIRIS metar store */
const VATIRIS_METAR_URL = "https://api.vatiris.se/metar"

interface VatsimAtisEntry {
    cid: number
    callsign: string
    text_atis: string[] | null
    frequency: string
}

interface VatsimDataResponse {
    atis: VatsimAtisEntry[]
}

/** ATIS-sourced fields only (letter + optional QNH from ATIS text) */
interface AtisOnlyCache {
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
 * Extract QNH from ATIS text (QNH 1013) or METAR (Q1013).
 */
function extractQnhFromText(text: string): number | undefined {
    const atisMatch = text.match(/QNH\s+(\d{3,4})/i)
    if (atisMatch) {
        const val = parseInt(atisMatch[1]!, 10)
        if (val >= 900 && val <= 1100) return val
    }
    const metarMatch = text.match(/\bQ(\d{4})\b/)
    if (metarMatch) {
        const val = parseInt(metarMatch[1]!, 10)
        if (val >= 900 && val <= 1100) return val
    }
    return undefined
}

function extractQnh(textLines: string[]): number | undefined {
    return extractQnhFromText(textLines.join(" "))
}

export class AtisService {
    private airports: string[] = []
    private pollTimer: ReturnType<typeof setTimeout> | null = null
    /** ATIS-only fields (letter + QNH parsed from ATIS) */
    private atisCache = new Map<string, AtisOnlyCache>()
    private essaAtisCache: { arrLetter?: string; depLetter?: string; qnh?: number } = {}
    /** Latest METAR QNH from VatIRIS (fallback when ATIS has no QNH) */
    private metarQnh = new Map<string, number>()
    private onUpdate: () => void
    private pollIntervalMs: number
    private lastFetchOk = false
    private lastMetarOk = false
    private started = false

    constructor(options: { onUpdate: () => void; pollIntervalMs?: number }) {
        this.onUpdate = options.onUpdate
        this.pollIntervalMs = options.pollIntervalMs ?? 60_000
    }

    /** Health for Connection status popup */
    getHealth(): { ok: boolean; detail: string } {
        if (!this.started) return { ok: false, detail: "Not started" }
        if (this.lastFetchOk && this.lastMetarOk) return { ok: true, detail: "Connected" }
        if (this.lastFetchOk) return { ok: true, detail: "ATIS ok (METAR fallback pending)" }
        if (this.lastMetarOk) return { ok: true, detail: "METAR ok (no ATIS)" }
        return { ok: false, detail: "Fetch failed" }
    }

    /**
     * Start polling for the given airports. Fetches immediately, then schedules.
     */
    start(airports: string[]): void {
        this.airports = airports.map((a) => a.toUpperCase())
        this.started = true
        this.poll()
    }

    /**
     * Stop polling.
     */
    stop(): void {
        this.started = false
        this.lastFetchOk = false
        this.lastMetarOk = false
        if (this.pollTimer) {
            clearTimeout(this.pollTimer)
            this.pollTimer = null
        }
    }

    /**
     * Merged ATIS (+ METAR QNH fallback) for a single-ATIS airport.
     */
    getAtis(airport: string): { letter?: string; qnh?: number } {
        const key = airport.toUpperCase()
        const atis = this.atisCache.get(key)
        const metar = this.metarQnh.get(key)
        return {
            letter: atis?.letter,
            qnh: atis?.qnh ?? metar,
        }
    }

    /**
     * ESSA split ATIS + METAR QNH fallback.
     */
    getEssaAtis(): { arrLetter?: string; depLetter?: string; qnh?: number } {
        const qnh = this.essaAtisCache.qnh ?? this.metarQnh.get("ESSA")
        return {
            arrLetter: this.essaAtisCache.arrLetter,
            depLetter: this.essaAtisCache.depLetter,
            qnh,
        }
    }

    private schedulePoll(): void {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer)
        }
        this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs)
    }

    private async poll(): Promise<void> {
        let changed = false
        try {
            changed = (await this.pollVatsimAtis()) || changed
        } catch (err) {
            this.lastFetchOk = false
            console.warn(`[ATIS] Error fetching VATSIM data: ${err instanceof Error ? err.message : err}`)
        }

        try {
            changed = (await this.pollMetarQnh()) || changed
        } catch (err) {
            this.lastMetarOk = false
            console.warn(`[ATIS] Error fetching VatIRIS METAR: ${err instanceof Error ? err.message : err}`)
        }

        if (changed) {
            this.onUpdate()
        }

        this.schedulePoll()
    }

    private async pollVatsimAtis(): Promise<boolean> {
        const response = await fetch(VATSIM_DATA_URL)
        if (!response.ok) {
            console.warn(`[ATIS] Failed to fetch VATSIM data: ${response.status}`)
            this.lastFetchOk = false
            return false
        }

        const data = (await response.json()) as VatsimDataResponse
        if (!data.atis) {
            this.lastFetchOk = false
            return false
        }

        this.lastFetchOk = true
        let changed = false
        for (const airport of this.airports) {
            if (airport === "ESSA") {
                changed = this.processEssa(data.atis) || changed
            } else {
                changed = this.processAirport(airport, data.atis) || changed
            }
        }
        return changed
    }

    /**
     * Pull newest METAR QNH from VatIRIS API (same as VatIRIS metar store).
     * Used when no ATIS is online or ATIS text has no QNH.
     */
    private async pollMetarQnh(): Promise<boolean> {
        if (this.airports.length === 0) return false
        const ids = this.airports.join(",")
        const url = `${VATIRIS_METAR_URL}?ids=${encodeURIComponent(ids)}&hours=1`
        const response = await fetch(url)
        if (!response.ok) {
            console.warn(`[ATIS] VatIRIS METAR failed: ${response.status}`)
            this.lastMetarOk = false
            return false
        }

        const text = await response.text()
        this.lastMetarOk = true

        // Newest observation is first per ICAO in the response
        const seen = new Set<string>()
        const next = new Map<string, number>()
        for (const section of text.split(/\n+/)) {
            const line = section.trim()
            const m = line.match(/^METAR\s+(\w{4})\b/i)
            if (!m?.[1]) continue
            const icao = m[1].toUpperCase()
            if (seen.has(icao)) continue
            seen.add(icao)
            const qnh = extractQnhFromText(line)
            if (qnh != null) next.set(icao, qnh)
        }

        let changed = false
        for (const airport of this.airports) {
            const q = next.get(airport)
            const prev = this.metarQnh.get(airport)
            if (q != null) {
                if (prev !== q) {
                    this.metarQnh.set(airport, q)
                    changed = true
                }
            } else if (prev != null) {
                this.metarQnh.delete(airport)
                changed = true
            }
        }
        if (changed) {
            console.log(
                `[ATIS] METAR QNH: ${[...this.metarQnh.entries()].map(([a, q]) => `${a}=${q}`).join(" ")}`,
            )
        }
        return changed
    }

    private processAirport(airport: string, atisList: VatsimAtisEntry[]): boolean {
        const callsign = `${airport}_ATIS`
        const entry = atisList.find((a) => a.callsign === callsign)

        const prev = this.atisCache.get(airport)
        if (!entry || !entry.text_atis) {
            // Clear ATIS letter/QNH — METAR QNH still available via getAtis()
            if (prev && (prev.letter != null || prev.qnh != null)) {
                this.atisCache.delete(airport)
                return true
            }
            return false
        }

        const letter = extractAtisCode(airport, entry.text_atis)
        const qnh = extractQnh(entry.text_atis)

        const changed = prev?.letter !== letter || prev?.qnh !== qnh
        if (changed) {
            this.atisCache.set(airport, { letter, qnh })
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

        const prev = this.essaAtisCache
        const changed =
            prev.arrLetter !== arrLetter ||
            prev.depLetter !== depLetter ||
            prev.qnh !== qnh

        if (changed) {
            this.essaAtisCache = { arrLetter, depLetter, qnh }
            // Also update the main cache for getAtis() fallback
            if (depLetter || arrLetter || qnh != null) {
                this.atisCache.set("ESSA", { letter: depLetter ?? arrLetter, qnh })
            } else {
                this.atisCache.delete("ESSA")
            }
        }
        return changed
    }
}
