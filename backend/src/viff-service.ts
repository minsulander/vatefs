/**
 * vIFF / CDM client via Vatiris proxy.
 * Secret API key lives on Vatiris; VatEFS calls https://backend.vatiris.se/cdm/*
 */

const DEFAULT_BASE_URL = "https://backend.vatiris.se/cdm"
const POLL_INTERVAL_MS = 25_000
const HTTP_TIMEOUT_MS = 15_000

export interface ViffRestrictedEntry {
    callsign: string
    ctot: string
    mostPenalisingRegulation?: string
}

export interface ViffStatusEntry {
    callsign: string
    cdmSts: string
}

export interface ViffPollResult {
    restricted: ViffRestrictedEntry[]
    statuses: ViffStatusEntry[]
}

type PollCallback = (result: ViffPollResult) => void

export class ViffService {
    private baseUrl: string
    private pollTimer: ReturnType<typeof setInterval> | null = null
    private onPoll: PollCallback
    private polling = false

    constructor(onPoll: PollCallback, baseUrl?: string) {
        this.onPoll = onPoll
        this.baseUrl = (baseUrl || process.env.VIFF_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")
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

    private async pollOnce(): Promise<void> {
        if (this.polling) return
        this.polling = true
        try {
            const [restricted, statuses] = await Promise.all([
                this.fetchRestricted(),
                this.fetchAllStatus(),
            ])
            this.onPoll({ restricted, statuses })
        } catch (err) {
            console.error(`[VIFF] Poll error:`, err instanceof Error ? err.message : err)
        } finally {
            this.polling = false
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
            const ctot = String((item as any).ctot ?? "").trim()
            if (!callsign || ctot.length < 4) continue
            out.push({
                callsign,
                ctot: ctot.slice(0, 4),
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
