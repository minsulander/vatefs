/**
 * Lookup live VATSIM pilots / flight plans for manual strip print.
 */

const VATSIM_DATA_URL = "https://data.vatsim.net/v3/vatsim-data.json"
const CACHE_TTL_MS = 15_000

export interface VatsimFlightPlan {
    flight_rules?: string
    aircraft?: string
    aircraft_short?: string
    departure?: string
    arrival?: string
    alternate?: string
    cruise_tas?: string
    altitude?: string
    deptime?: string
    enroute_time?: string
    route?: string
    remarks?: string
    assigned_transponder?: string
}

export interface VatsimPilot {
    callsign: string
    latitude?: number
    longitude?: number
    altitude?: number
    groundspeed?: number
    transponder?: string
    flight_plan?: VatsimFlightPlan | null
}

interface VatsimDataResponse {
    pilots?: VatsimPilot[]
}

let cache: { at: number; byCallsign: Map<string, VatsimPilot> } | null = null
let inflight: Promise<Map<string, VatsimPilot>> | null = null

async function loadPilotMap(): Promise<Map<string, VatsimPilot>> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
        return cache.byCallsign
    }
    if (inflight) return inflight

    inflight = (async () => {
        try {
            const res = await fetch(VATSIM_DATA_URL, {
                headers: { Accept: "application/json" },
            })
            if (!res.ok) throw new Error(`VATSIM data HTTP ${res.status}`)
            const data = (await res.json()) as VatsimDataResponse
            const byCallsign = new Map<string, VatsimPilot>()
            for (const p of data.pilots ?? []) {
                if (!p?.callsign) continue
                byCallsign.set(p.callsign.toUpperCase(), p)
            }
            cache = { at: Date.now(), byCallsign }
            return byCallsign
        } finally {
            inflight = null
        }
    })()

    return inflight
}

/** Find a VATSIM pilot by callsign (case-insensitive). */
export async function lookupVatsimPilot(callsign: string): Promise<VatsimPilot | undefined> {
    const cs = callsign.trim().toUpperCase()
    if (!cs) return undefined
    try {
        const map = await loadPilotMap()
        return map.get(cs)
    } catch (err) {
        console.error(
            `[VATSIM] Pilot lookup failed: ${err instanceof Error ? err.message : err}`
        )
        return undefined
    }
}

/** Parse VATSIM cruise altitude (e.g. F350, A050, 35000) to feet. */
export function parseVatsimAltitude(raw: string | undefined): number | undefined {
    if (!raw) return undefined
    const s = String(raw).trim().toUpperCase()
    if (!s) return undefined
    if (/^\d{3,5}$/.test(s)) {
        const n = parseInt(s, 10)
        // 3-digit often means flight level
        return s.length <= 3 ? n * 100 : n
    }
    const m = s.match(/^([FA])(\d{3})$/)
    if (m) {
        const n = parseInt(m[2]!, 10)
        return m[1] === "F" ? n * 100 : n * 100
    }
    return undefined
}

/** Normalize deptime / EOBT to HHmm when possible. */
export function normalizeVatsimDeptime(raw: string | undefined): string | undefined {
    if (!raw) return undefined
    const digits = String(raw).replace(/\D/g, "")
    if (digits.length >= 4) return digits.slice(-4)
    if (digits.length === 3) return `0${digits}`
    return undefined
}
