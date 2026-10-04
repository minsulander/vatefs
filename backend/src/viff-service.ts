/**
 * vIFF / CDM client via Vatiris proxy.
 * Secret API key lives on Vatiris; VatEFS calls https://backend.vatiris.se/cdm/*
 *
 * Network-wide: CTOT (restricted) + status/REA/FLS (allStatus) + DPI.
 * CDM airport times (TOBT/TSAT): only for supported airports currently online
 * in myAirports — today ESSA only via /ifps/depAirport.
 */

const DEFAULT_BASE_URL = "https://backend.vatiris.se/cdm"
/** Background poll — keep modest to avoid hammering Vatiris; local CDM_data_*.txt is the fast path */
const POLL_INTERVAL_MS = 10_000
/** After ATC TOBT/REA write, re-poll soon so TSAT/status catch up */
const POST_WRITE_POLL_DELAY_MS = 1_500
const HTTP_TIMEOUT_MS = 15_000

/** Airports where full CDM (TOBT/TSAT) is available in VatEFS */
const CDM_SUPPORTED_AIRPORTS = new Set(["ESSA"])

export interface ViffRestrictedEntry {
    callsign: string
    ctot: string
    mostPenalisingRegulation?: string
}

export interface ViffStatusEntry {
    callsign: string
    cdmSts: string
}

export interface ViffCdmEntry {
    callsign: string
    airport: string
    tobt?: string
    tsat?: string
    ctot?: string
    cdmSts?: string
    taxiMinutes?: number
    tobtSetBy?: 'P' | 'A'
}

export interface ViffPollResult {
    restricted: ViffRestrictedEntry[]
    statuses: ViffStatusEntry[]
    cdm: ViffCdmEntry[]
}

type PollCallback = (result: ViffPollResult) => void

function normalizeHhmm(raw: unknown): string | undefined {
    if (raw == null) return undefined
    const digits = String(raw).replace(/\D/g, "")
    if (digits.length < 3) return undefined
    if (digits.length === 3) return digits.padStart(4, "0")
    return digits.slice(0, 4)
}

/**
 * TOBT set-by (P/A) — CDM shows blank unless explicitly set by pilot or ATC.
 * Never invent "A" just because TOBT ≠ EOBT (common in realMode when EOBT moves).
 */
function parseTobtSetBy(
    item: any,
    cdmData: any,
    eobt: string | undefined,
    tobt: string | undefined,
): 'P' | 'A' | undefined {
    if (!tobt || (eobt && tobt === eobt)) return undefined

    // Explicit setBy from CDM/vIFF (often "P"/"A", "PILOT"/"ATC", or 1-char)
    const setByRaw = String(
        cdmData?.setBy ?? item?.setBy ?? cdmData?.tobtSetBy ?? item?.tobtSetBy ?? "",
    ).trim().toUpperCase()
    if (setByRaw === "P" || setByRaw.startsWith("PILOT") || setByRaw.includes("VDGS")) return "P"
    if (setByRaw === "A" || setByRaw.startsWith("ATC")) return "A"

    const typeRaw = String(cdmData?.reqTobtType ?? item?.reqTobtType ?? "").trim().toUpperCase()
    if (typeRaw === "P" || typeRaw.startsWith("PILOT") || typeRaw.includes("VDGS")) return "P"
    if (typeRaw === "A" || typeRaw.startsWith("ATC")) return "A"

    // History lines e.g. "Requested TOBT: 0956 by ATC"
    const history = String(item?.history ?? cdmData?.history ?? "")
    const matches = [...history.matchAll(/TOBT:\s*\d{4}\s+by\s+(ATC|PILOT|Pilot)/gi)]
    if (matches.length > 0) {
        const who = matches[matches.length - 1][1].toUpperCase()
        return who.startsWith("P") ? "P" : "A"
    }

    // Unknown / unconfirmed — blank (same as CDM TOBT-SET-BY)
    return undefined
}

export class ViffService {
    private baseUrl: string
    private pollTimer: ReturnType<typeof setInterval> | null = null
    private postWriteTimer: ReturnType<typeof setTimeout> | null = null
    private onPoll: PollCallback
    private getMyAirports: () => string[]
    private polling = false
    private lastLoggedCdmAirports = ""

    constructor(onPoll: PollCallback, getMyAirports: () => string[], baseUrl?: string) {
        this.onPoll = onPoll
        this.getMyAirports = getMyAirports
        this.baseUrl = (baseUrl || process.env.VIFF_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")
    }

    /** Schedule a near-term poll (coalesced) after a write that should change TSAT/status. */
    pollSoon(): void {
        if (this.postWriteTimer) clearTimeout(this.postWriteTimer)
        this.postWriteTimer = setTimeout(() => {
            this.postWriteTimer = null
            void this.pollOnce()
        }, POST_WRITE_POLL_DELAY_MS)
    }

    private activeCdmAirports(): string[] {
        const airports = this.getMyAirports()
            .map((a) => a.toUpperCase())
            .filter((a) => CDM_SUPPORTED_AIRPORTS.has(a))
        const key = airports.join(",")
        if (key !== this.lastLoggedCdmAirports) {
            this.lastLoggedCdmAirports = key
            console.log(`[VIFF] CDM airports: ${key || "(none)"}`)
        }
        return airports
    }

    start(): void {
        if (this.pollTimer) return
        console.log(`[VIFF] Starting poller → ${this.baseUrl}`)
        void this.pollOnce()
        this.pollTimer = setInterval(() => void this.pollOnce(), POLL_INTERVAL_MS)
    }

    stop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer)
            this.pollTimer = null
        }
        if (this.postWriteTimer) {
            clearTimeout(this.postWriteTimer)
            this.postWriteTimer = null
        }
        console.log("[VIFF] Poller stopped")
    }

    async sendDpi(callsign: string, value: string): Promise<boolean> {
        const url = new URL(`${this.baseUrl}/ifps/dpi`)
        url.searchParams.set("callsign", callsign)
        url.searchParams.set("value", value)
        try {
            const res = await fetch(url.toString(), {
                method: "POST",
                signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
            })
            if (!res.ok) {
                const body = await res.text().catch(() => "")
                console.error(`[VIFF] DPI failed ${res.status} for ${callsign} ${value}: ${body}`)
                return false
            }
            console.log(`[VIFF] DPI sent ${callsign} ${value}`)
            return true
        } catch (err) {
            console.error(`[VIFF] DPI error for ${callsign} ${value}:`, err instanceof Error ? err.message : err)
            return false
        }
    }

    async setRea(callsign: string, set: boolean): Promise<boolean> {
        return this.sendDpi(callsign, set ? "REA/1" : "REA/0")
    }

    async updateEobt(callsign: string, eobt: string): Promise<boolean> {
        return this.sendDpi(callsign, `EOBT/${eobt}`)
    }

    /**
     * Set TOBT via CDM endpoint; fall back to DPI TOBT/… if the endpoint rejects.
     * Defaults: taxi 15 min; omit empty cdmSts (some proxies reject blank).
     */
    async updateTobt(
        callsign: string,
        tobt: string,
        taxiMinutes = 15,
        cdmSts = "",
    ): Promise<boolean> {
        const url = new URL(`${this.baseUrl}/ifps/cdm`)
        url.searchParams.set("callsign", callsign)
        url.searchParams.set("taxi", String(taxiMinutes))
        url.searchParams.set("tobt", tobt)
        if (cdmSts) url.searchParams.set("cdmSts", cdmSts)
        try {
            const res = await fetch(url.toString(), {
                method: "POST",
                signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
            })
            if (res.ok) {
                console.log(`[VIFF] TOBT set ${callsign} → ${tobt} (taxi ${taxiMinutes})`)
                return true
            }
            const body = await res.text().catch(() => "")
            console.warn(`[VIFF] setTOBT HTTP ${res.status} for ${callsign}: ${body} — trying DPI`)
        } catch (err) {
            console.warn(`[VIFF] setTOBT error for ${callsign}:`, err instanceof Error ? err.message : err, "— trying DPI")
        }
        // DPI fallbacks used by vIFF proxies (same pattern as EOBT/REA)
        if (await this.sendDpi(callsign, `TOBT/${tobt}`)) return true
        return this.sendDpi(callsign, `T/OBT/${tobt}`)
    }

    private async pollOnce(): Promise<void> {
        if (this.polling) return
        this.polling = true
        try {
            const [restricted, statuses, cdm] = await Promise.all([
                this.fetchRestricted(),
                this.fetchAllStatus(),
                this.fetchCdmFlights(),
            ])
            this.onPoll({ restricted, statuses, cdm })
        } catch (err) {
            console.error(`[VIFF] Poll error:`, err instanceof Error ? err.message : err)
        } finally {
            this.polling = false
        }
    }

    private async fetchCdmFlights(): Promise<ViffCdmEntry[]> {
        const airports = this.activeCdmAirports()
        if (airports.length === 0) return []
        const lists = await Promise.all(airports.map((ap) => this.fetchDepAirport(ap)))
        return lists.flat()
    }

    private async fetchDepAirport(airport: string): Promise<ViffCdmEntry[]> {
        const url = new URL(`${this.baseUrl}/ifps/depAirport`)
        url.searchParams.set("airport", airport)
        try {
            const res = await fetch(url.toString(), { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
            if (!res.ok) {
                console.warn(`[VIFF] depAirport ${airport} HTTP ${res.status}`)
                return []
            }
            const data = await res.json()
            if (!Array.isArray(data)) return []
            const out: ViffCdmEntry[] = []
            for (const item of data) {
                if (!item || typeof item !== "object") continue
                const callsign = String((item as any).callsign ?? "").trim()
                if (!callsign) continue
                const cdmData = (item as any).cdmData && typeof (item as any).cdmData === "object"
                    ? (item as any).cdmData
                    : {}
                const eobt = normalizeHhmm((item as any).eobt)
                const tobt = normalizeHhmm((item as any).tobt) ?? normalizeHhmm(cdmData.tobt)
                // TSAT may be top-level (like TOBT) or nested under cdmData
                const tsat = normalizeHhmm((item as any).tsat) ?? normalizeHhmm(cdmData.tsat)
                const ctot = normalizeHhmm((item as any).ctot) ?? normalizeHhmm(cdmData.ctot)
                const cdmSts = String((item as any).cdmSts ?? "").trim() || undefined
                const taxiRaw = (item as any).taxi
                const taxiMinutes = typeof taxiRaw === "number" && taxiRaw > 0
                    ? taxiRaw
                    : (typeof taxiRaw === "string" && /^\d+$/.test(taxiRaw) ? Number(taxiRaw) : undefined)
                const tobtSetBy = parseTobtSetBy(item, cdmData, eobt, tobt)
                out.push({
                    callsign,
                    airport,
                    tobt,
                    tsat,
                    ctot,
                    cdmSts,
                    taxiMinutes,
                    tobtSetBy,
                })
            }
            return out
        } catch (err) {
            console.warn(`[VIFF] depAirport ${airport} error:`, err instanceof Error ? err.message : err)
            return []
        }
    }

    private async fetchRestricted(): Promise<ViffRestrictedEntry[]> {
        const url = `${this.baseUrl}/etfms/restricted`
        const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
        if (!res.ok) {
            console.warn(`[VIFF] restricted HTTP ${res.status}`)
            return []
        }
        const data = await res.json()
        if (!Array.isArray(data)) return []
        const out: ViffRestrictedEntry[] = []
        for (const item of data) {
            if (!item || typeof item !== "object") continue
            const callsign = String((item as any).callsign ?? "").trim()
            const ctot = normalizeHhmm((item as any).ctot)
            if (!callsign || !ctot) continue
            out.push({
                callsign,
                ctot,
                mostPenalisingRegulation: (item as any).mostPenalisingRegulation
                    ? String((item as any).mostPenalisingRegulation)
                    : undefined,
            })
        }
        return out
    }

    private async fetchAllStatus(): Promise<ViffStatusEntry[]> {
        const url = `${this.baseUrl}/ifps/allStatus`
        const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
        if (!res.ok) {
            console.warn(`[VIFF] allStatus HTTP ${res.status}`)
            return []
        }
        const data = await res.json()
        if (!Array.isArray(data)) return []
        const out: ViffStatusEntry[] = []
        for (const item of data) {
            if (!item || typeof item !== "object") continue
            const callsign = String((item as any).callsign ?? "").trim()
            const cdmSts = String((item as any).cdmSts ?? "").trim()
            if (!callsign || !cdmSts) continue
            out.push({ callsign, cdmSts })
        }
        return out
    }
}
