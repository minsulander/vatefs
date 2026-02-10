const HOPPIE_URL = "http://www.hoppie.nl/acars/system/connect.html"
const HOPPIE_STATUS_URL = "https://www.hoppie.nl/acars/system/status.html"
const HTTP_TIMEOUT = 15000
const POLL_MIN_MS = 45000
const POLL_MAX_MS = 75000
const FAST_POLL_MIN_MS = 20000
const FAST_POLL_MAX_MS = 25000
const FAST_POLL_DURATION_MS = 5 * 60 * 1000 // 5 minutes

export type DclStatus = "available" | "connected" | "error" | "unavailable"

export interface HoppieParsedMessage {
    from: string
    type: string
    packet: string
}

export class HoppieService {
    private logonCode: string
    private callsign: string
    private pollTimer: ReturnType<typeof setTimeout> | null = null
    private connected = false
    private messageSeq = 0
    private pdcCounter = 0
    private onMessage: (from: string, type: string, packet: string) => void
    private onStatusChange: (status: DclStatus, error?: string) => void
    private fastPollUntil: number = 0 // timestamp when fast polling expires

    constructor(
        logonCode: string,
        callsign: string,
        callbacks: {
            onMessage: (from: string, type: string, packet: string) => void
            onStatusChange: (status: DclStatus, error?: string) => void
        },
    ) {
        this.logonCode = logonCode
        this.callsign = callsign
        this.onMessage = callbacks.onMessage
        this.onStatusChange = callbacks.onStatusChange
    }

    async login(): Promise<boolean> {
        try {
            const response = await this.sendRequest("SERVER", "ping", "")
            if (response.startsWith("ok")) {
                this.connected = true
                this.onStatusChange("connected")
                // Poll immediately to pick up any pending messages
                this.poll()
                console.log(`[HOPPIE] Logged in as ${this.callsign}`)
                return true
            } else {
                this.connected = false
                const error = `Unexpected response: ${response}`
                this.onStatusChange("error", error)
                console.error(`[HOPPIE] Login failed: ${error}`)
                return false
            }
        } catch (err) {
            this.connected = false
            const error = err instanceof Error ? err.message : String(err)
            this.onStatusChange("error", error)
            console.error(`[HOPPIE] Login error: ${error}`)
            return false
        }
    }

    logout(): void {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer)
            this.pollTimer = null
        }
        this.connected = false
        console.log(`[HOPPIE] Logged out (${this.callsign})`)
    }

    isConnected(): boolean {
        return this.connected
    }

    getNextSeq(): number {
        return ++this.messageSeq
    }

    getNextPdc(): number {
        return ++this.pdcCounter
    }

    async sendMessage(to: string, type: string, packet: string): Promise<string> {
        console.log(`[HOPPIE] Sending ${type} to ${to}: ${packet}`)
        const result = await this.sendRequest(to, type, packet)

        // Enable fast polling for messages expecting a response (WILCO/UNABLE)
        if (type === "cpdlc" && /\/(WU|AN|R)\//.test(packet)) {
            this.fastPollUntil = Date.now() + FAST_POLL_DURATION_MS
            console.log(`[HOPPIE] Fast polling enabled for 5 minutes (expecting response)`)
            // Reschedule with shorter interval
            this.schedulePoll()
        }

        return result
    }

    /**
     * End fast polling mode (called when expected response is received).
     */
    endFastPoll(): void {
        if (this.fastPollUntil > 0) {
            this.fastPollUntil = 0
            console.log(`[HOPPIE] Fast polling ended (response received)`)
        }
    }

    private async sendRequest(to: string, type: string, packet: string): Promise<string> {
        const params = new URLSearchParams({
            logon: this.logonCode,
            from: this.callsign,
            to,
            type,
            packet,
        })

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT)

        try {
            const response = await fetch(HOPPIE_URL, {
                method: "POST",
                body: params,
                signal: controller.signal,
            })
            const text = await response.text()
            return text.trim()
        } finally {
            clearTimeout(timeout)
        }
    }

    private async poll(): Promise<void> {
        if (!this.connected) return

        try {
            const response = await this.sendRequest(this.callsign, "poll", "")

            if (response.startsWith("ok")) {
                const messages = this.parseMessages(response)
                for (const msg of messages) {
                    console.log(`[HOPPIE] Message from ${msg.from} (${msg.type}): ${msg.packet}`)
                    this.onMessage(msg.from, msg.type, msg.packet)
                }
            } else if (response.startsWith("error")) {
                console.error(`[HOPPIE] Poll error: ${response}`)
                this.connected = false
                this.onStatusChange("error", response)
                return
            }
        } catch (err) {
            console.error(`[HOPPIE] Poll failed: ${err instanceof Error ? err.message : err}`)
            // Don't disconnect on transient errors, keep polling
        }

        if (this.connected) {
            this.schedulePoll()
        }
    }

    private schedulePoll(): void {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer)
        }
        // Use fast polling if active and not expired
        const useFast = this.fastPollUntil > Date.now()
        if (!useFast && this.fastPollUntil > 0) {
            // Fast poll period expired
            this.fastPollUntil = 0
            console.log(`[HOPPIE] Fast polling expired (5 min timeout)`)
        }
        const minMs = useFast ? FAST_POLL_MIN_MS : POLL_MIN_MS
        const maxMs = useFast ? FAST_POLL_MAX_MS : POLL_MAX_MS
        const interval = minMs + Math.random() * (maxMs - minMs)
        this.pollTimer = setTimeout(() => this.poll(), interval)
    }

    /**
     * Parse poll response. Format: "ok {FROM TYPE {PACKET}} {FROM2 TYPE2 {PACKET2}}"
     * The "ok" prefix is followed by zero or more message blocks.
     */
    private parseMessages(response: string): HoppieParsedMessage[] {
        const messages: HoppieParsedMessage[] = []

        // Strip leading "ok" and whitespace
        let remaining = response.replace(/^ok\s*/, "")
        if (!remaining) return messages

        // Parse each {FROM TYPE {PACKET}} block
        while (remaining.length > 0) {
            remaining = remaining.trimStart()
            if (!remaining.startsWith("{")) break

            // Find the matching closing brace for the outer block
            let depth = 0
            let end = -1
            for (let i = 0; i < remaining.length; i++) {
                if (remaining[i] === "{") depth++
                if (remaining[i] === "}") {
                    depth--
                    if (depth === 0) {
                        end = i
                        break
                    }
                }
            }

            if (end === -1) break

            // Extract block content (without outer braces)
            const block = remaining.substring(1, end).trim()
            remaining = remaining.substring(end + 1)

            // Parse: FROM TYPE {PACKET}
            const firstSpace = block.indexOf(" ")
            if (firstSpace === -1) continue

            const from = block.substring(0, firstSpace)
            const rest = block.substring(firstSpace + 1).trim()

            const secondSpace = rest.indexOf(" ")
            if (secondSpace === -1) continue

            const type = rest.substring(0, secondSpace)
            let packet = rest.substring(secondSpace + 1).trim()

            // Remove surrounding braces from packet if present
            if (packet.startsWith("{") && packet.endsWith("}")) {
                packet = packet.substring(1, packet.length - 1).trim()
            }

            messages.push({ from, type, packet })
        }

        return messages
    }
}

/**
 * Check if the Hoppie ACARS network is operational.
 * Returns true if the status endpoint reports "operational", false otherwise.
 */
export async function checkHoppieStatus(): Promise<boolean> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT)

    try {
        const response = await fetch(HOPPIE_STATUS_URL, { signal: controller.signal })
        const data = await response.json()
        const operational = data.status_code === "operational"
        if (!operational) {
            console.log(`[HOPPIE] Network not operational: status_code=${data.status_code}, message=${data.message}`)
        }
        return operational
    } catch (err) {
        console.warn(`[HOPPIE] Status check failed: ${err instanceof Error ? err.message : err}`)
        return false
    } finally {
        clearTimeout(timeout)
    }
}
