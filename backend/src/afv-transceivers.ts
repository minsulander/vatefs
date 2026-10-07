/**
 * Poll VATSIM AFV transceiver data (same source as VATSIM Radar "Monitoring" freqs).
 * Used to detect when a covering APP is cross-coupled onto an offline DEP frequency.
 */

const TRANSCEIVERS_URL = "https://data.vatsim.net/v3/transceivers-data.json"
const DEFAULT_POLL_MS = 30_000

interface AfvTransceiver {
    id: number
    frequency: number // Hz
    latDeg?: number
    lonDeg?: number
    heightMslM?: number
    heightAglM?: number
}

interface AfvStation {
    callsign: string
    transceivers: AfvTransceiver[]
}

/** callsign → set of frequency strings at 3 decimal places (e.g. "124.105") */
let freqsByCallsign: Map<string, Set<string>> = new Map()
let pollTimer: ReturnType<typeof setInterval> | undefined
let inFlight = false

export function formatFreqMhz(hzOrMhz: number): string {
    // Values > 1000 are treated as Hz (AFV); else already MHz
    const mhz = hzOrMhz > 1000 ? hzOrMhz / 1_000_000 : hzOrMhz
    return parseFloat(mhz.toFixed(3)).toFixed(3)
}

export function normalizeFreqKey(freq: number | string | undefined): string | undefined {
    if (freq === undefined || freq === null || freq === "") return undefined
    const n = typeof freq === "number" ? freq : parseFloat(freq)
    if (isNaN(n) || n <= 0 || n >= 199) return undefined
    return formatFreqMhz(n)
}

export function getFrequenciesForCallsign(callsign: string | undefined): string[] {
    if (!callsign) return []
    const set = freqsByCallsign.get(callsign.toUpperCase())
    return set ? [...set] : []
}

/** True if AFV lists `freqMhz` among the controller's active transceivers. */
export function controllerMonitorsFrequency(
    callsign: string | undefined,
    freqMhz: number | string | undefined
): boolean {
    const key = normalizeFreqKey(freqMhz)
    if (!callsign || !key) return false
    const set = freqsByCallsign.get(callsign.toUpperCase())
    return !!set?.has(key)
}

export function applyTransceiverSnapshot(stations: AfvStation[]): void {
    const next = new Map<string, Set<string>>()
    for (const st of stations) {
        if (!st?.callsign || !Array.isArray(st.transceivers)) continue
        const set = new Set<string>()
        for (const t of st.transceivers) {
            if (typeof t?.frequency !== "number") continue
            const key = formatFreqMhz(t.frequency)
            const n = parseFloat(key)
            // Same VHF band filter as VATSIM Radar controller UI
            if (n >= 117 && n <= 137) set.add(key)
        }
        if (set.size > 0) next.set(st.callsign.toUpperCase(), set)
    }
    freqsByCallsign = next
}

export async function refreshAfvTransceivers(): Promise<boolean> {
    if (inFlight) return false
    inFlight = true
    try {
        const res = await fetch(TRANSCEIVERS_URL, {
            signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) {
            console.warn(`AFV transceivers HTTP ${res.status}`)
            return false
        }
        const data = (await res.json()) as AfvStation[]
        if (!Array.isArray(data)) {
            console.warn("AFV transceivers: unexpected payload")
            return false
        }
        applyTransceiverSnapshot(data)
        return true
    } catch (e) {
        console.warn("AFV transceivers fetch failed:", e instanceof Error ? e.message : e)
        return false
    } finally {
        inFlight = false
    }
}

export function startAfvTransceiverPolling(intervalMs = DEFAULT_POLL_MS): void {
    stopAfvTransceiverPolling()
    void refreshAfvTransceivers()
    pollTimer = setInterval(() => {
        void refreshAfvTransceivers()
    }, intervalMs)
    if (typeof pollTimer === "object" && "unref" in pollTimer) {
        pollTimer.unref()
    }
}

export function stopAfvTransceiverPolling(): void {
    if (pollTimer !== undefined) {
        clearInterval(pollTimer)
        pollTimer = undefined
    }
}

/** Test helper */
export function __setAfvFrequenciesForTest(map: Record<string, string[]>): void {
    freqsByCallsign = new Map(
        Object.entries(map).map(([cs, freqs]) => [
            cs.toUpperCase(),
            new Set(freqs.map((f) => normalizeFreqKey(f)!).filter(Boolean)),
        ])
    )
}
