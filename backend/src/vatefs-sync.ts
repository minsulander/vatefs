/**
 * Remote scribble / strip sync client (VatIRIS / closed-beta compatible REST API).
 *
 * Primary: push on event → WebSocket fanout (SSE is legacy; CF tunnels buffer it).
 * Safety: 15s poll + top-bar reload.
 */

import type { FeedStatusItem, FlightStrip, ScribbleStrokePayload, UiSettings } from "@vatefs/common"
import WebSocket from "ws"
import * as scribbleStore from "./scribble-store.js"
import { anonymousSpecialStripKind } from "./multi-airport.js"

export type ScribbleRealm = "live" | "sweatbox" | "playback" | "local"

const DEFAULT_SYNC_BASE_URL = "https://backend.vatiris.se"

export interface StripSyncMeta {
    kind: string
    paperInfoKind?: string
    airport?: string
    callsign?: string
    /** Anonymous VFR/CROSS recreate */
    aircraftType?: string
    adep?: string
    ades?: string
    flightRules?: string
    /** Bay placement — synced for note/vehicle create and all strip drags */
    bayId?: string
    sectionId?: string
    position?: number
    bottom?: boolean
    /** EFS-only flags (not EuroScope-native) */
    clearanceRead?: boolean
    qnhGiven?: number | null
    atisGiven?: string | null
    noteText?: string
    std?: string
}

type ApplyRemoteFn = (
    stripId: string,
    strokes: ScribbleStrokePayload[],
    meta: StripSyncMeta | undefined,
    updatedAt: string,
    opts?: { deleted?: boolean; applyStripMeta?: boolean },
) => void

let getSettings: () => UiSettings = () => ({}) as UiSettings
let getConnectionType: () => number | undefined = () => undefined
let getStripById: (id: string) => FlightStrip | undefined = () => undefined
let getAirports: () => string[] = () => []
let onApplyRemote: ApplyRemoteFn = () => {}
let onNeedVatIrisSignIn: (detail?: string) => void = () => {}
let onRealmChanged: (realm: ScribbleRealm) => void = () => {}

let pollTimer: ReturnType<typeof setInterval> | undefined
let sinceByRoom = new Map<string, string>()

/** Active live WebSockets keyed by realm/airport */
const streams = new Map<string, { ws: WebSocket; gen: number }>()
let streamGen = 0
let streamRestartTimer: ReturnType<typeof setTimeout> | undefined

let irisSyncHealth: FeedStatusItem = { ok: true, detail: "Off" }
let lastAuthOrNetworkError: string | undefined
let signInPromptedForCid = ""
let lastResolvedRealm: ScribbleRealm | undefined
let anyWsOpen = false
let lastPollOk = false

export function initScribbleSync(opts: {
    getSettings: () => UiSettings
    getConnectionType: () => number | undefined
    getStripById: (id: string) => FlightStrip | undefined
    getAirports: () => string[]
    onApplyRemote: ApplyRemoteFn
    onNeedVatIrisSignIn?: (detail?: string) => void
    onRealmChanged?: (realm: ScribbleRealm) => void
}) {
    getSettings = opts.getSettings
    getConnectionType = opts.getConnectionType
    getStripById = opts.getStripById
    getAirports = opts.getAirports
    onApplyRemote = opts.onApplyRemote
    if (opts.onNeedVatIrisSignIn) onNeedVatIrisSignIn = opts.onNeedVatIrisSignIn
    if (opts.onRealmChanged) onRealmChanged = opts.onRealmChanged
}

export function resolveRealm(settings: UiSettings): ScribbleRealm {
    if (settings.scribbleSyncRealm && settings.scribbleSyncRealm !== "auto") {
        return settings.scribbleSyncRealm
    }
    // EuroScope: 1=DIRECT, 4=PLAYBACK, 6=SWEATBOX
    const ct = getConnectionType()
    if (ct === 6) return "sweatbox"
    if (ct === 4) return "playback"
    if (ct === 3 || ct === 5) return "local"
    return "live"
}

/** Sweatbox / Local — not live VATSIM; disable Hoppie/VIFF/ATIS/AFV. */
export function isOfflineVatsimRealm(settings?: UiSettings): boolean {
    const r = resolveRealm(settings ?? getSettings())
    return r === "sweatbox" || r === "local"
}

export function getIrisSyncHealth(): FeedStatusItem {
    return irisSyncHealth
}

function syncTogglesOn(s: UiSettings): boolean {
    return !!(s.scribbleSyncEnabled || s.stripSyncEnabled)
}

function validCid(s: UiSettings): boolean {
    return /^\d{4,10}$/.test((s.vatsimCid || "").trim())
}

function effectiveSyncBaseUrl(): string {
    const env = (process.env.VATEFS_SYNC_URL || "").trim().replace(/\/+$/, "")
    if (env) return env
    return DEFAULT_SYNC_BASE_URL
}

function refreshHealth() {
    const s = getSettings()
    if (!syncTogglesOn(s)) {
        irisSyncHealth = { ok: true, detail: "Off" }
        return
    }
    if (!validCid(s)) {
        irisSyncHealth = { ok: false, detail: "CID required" }
        return
    }
    if (lastAuthOrNetworkError) {
        irisSyncHealth = { ok: false, detail: lastAuthOrNetworkError }
        return
    }
    const realm = resolveRealm(s)
    if (anyWsOpen || lastPollOk) {
        irisSyncHealth = { ok: true, detail: `Connected (${realm})` }
    } else {
        irisSyncHealth = { ok: true, detail: `Connecting (${realm})…` }
    }
}

function noteAuthFailure(status: number, errorMsg?: string) {
    if (status === 401 || status === 403) {
        lastAuthOrNetworkError = "Sign in to VatIRIS"
        const s = getSettings()
        const cid = s.vatsimCid.trim()
        if (cid && signInPromptedForCid !== cid) {
            signInPromptedForCid = cid
            onNeedVatIrisSignIn(errorMsg || lastAuthOrNetworkError)
        }
    } else if (status === 0) {
        lastAuthOrNetworkError = "Unreachable"
        const s = getSettings()
        const cid = s.vatsimCid.trim()
        if (cid && syncTogglesOn(s) && signInPromptedForCid !== cid) {
            signInPromptedForCid = cid
            onNeedVatIrisSignIn("Sync server unreachable — sign in to VatIRIS once, then return")
        }
    } else if (status === 429) {
        // rate limit — don't treat as auth failure
    } else if (!lastAuthOrNetworkError) {
        lastAuthOrNetworkError = errorMsg ? String(errorMsg).slice(0, 80) : `HTTP ${status}`
    }
    refreshHealth()
}

function noteSuccess() {
    if (lastAuthOrNetworkError) lastAuthOrNetworkError = undefined
    refreshHealth()
}

function syncKeyForStrip(strip: FlightStrip): string {
    return strip.syncKey || strip.id
}

/**
 * Strip meta on PUT:
 * - note/vehicle: create-on-receive + placement + text fields
 * - anonymous VFR/CROSS (empty callsign): create-on-receive via strip id key
 * - flight: placement + EFS-only flags (ES-native CLR/CTL/CTO/G/A stay on EuroScope)
 */
function stripMeta(strip: FlightStrip): StripSyncMeta {
    const placement = {
        airport: strip.airport,
        callsign: strip.callsign || undefined,
        bayId: strip.bayId,
        sectionId: strip.sectionId,
        position: strip.position,
        bottom: !!strip.bottom,
    }
    if (strip.stripType === "note") {
        return {
            kind: "note",
            paperInfoKind: strip.paperInfoKind,
            noteText: strip.noteText ?? "",
            ...placement,
        }
    }
    if (strip.stripType === "vehicle") {
        return {
            kind: "vehicle",
            std: strip.std ?? "",
            ...placement,
        }
    }
    const anonKind = anonymousSpecialStripKind(strip.syncKey || strip.id)
    if (anonKind) {
        return {
            kind: anonKind,
            aircraftType: strip.aircraftType || undefined,
            adep: strip.adep || undefined,
            ades: strip.ades || undefined,
            flightRules: strip.flightRules || undefined,
            ...placement,
        }
    }
    const meta: StripSyncMeta = {
        kind: "flight",
        ...placement,
        // Paper CLR-read bit (col 4). CLR correct / CTL / CTO / G/A stay on EuroScope.
        clearanceRead: !!(strip.clearanceRead || strip.clearance || strip.clearanceReadback),
    }
    // Only send QNH/ATIS when set — omit on bare moves so peers don't wipe each other.
    // Clears go through setQnhGiven → push with explicit null (see pushStripFlagsToRemote).
    if (strip.qnhGiven != null) meta.qnhGiven = strip.qnhGiven
    if (strip.atisGiven) meta.atisGiven = strip.atisGiven
    return meta
}

function baseUrl(): string | undefined {
    const s = getSettings()
    if (!syncTogglesOn(s)) return undefined
    if (!validCid(s)) return undefined
    return effectiveSyncBaseUrl()
}

async function fetchJson(
    url: string,
    init: RequestInit & { cid: string },
): Promise<{ ok: boolean; status: number; json?: any }> {
    try {
        const res = await fetch(url, {
            ...init,
            headers: {
                "Content-Type": "application/json",
                "X-Vatsim-Cid": init.cid,
                ...(init.headers || {}),
            },
        })
        const json = await res.json().catch(() => undefined)
        return { ok: res.ok, status: res.status, json }
    } catch (err) {
        console.warn(`[vatefs-sync] fetch failed: ${err instanceof Error ? err.message : err}`)
        return { ok: false, status: 0 }
    }
}

type PutBody = {
    strokes?: ScribbleStrokePayload[]
    strip?: StripSyncMeta
}

async function putRemote(
    stripId: string,
    body: PutBody,
): Promise<boolean> {
    const base = baseUrl()
    const settings = getSettings()
    if (!base) return false
    const strip = getStripById(stripId)
    if (!strip) return false
    // Key by syncKey/id — never require callsign (anonymous VFR/CROSS use vfrdep:uuid etc.)
    const apt = (strip.airport || getAirports()[0] || "").toUpperCase()
    if (!apt) return false
    if (body.strokes === undefined && body.strip === undefined) return false
    const realm = resolveRealm(settings)
    const key = encodeURIComponent(syncKeyForStrip(strip))
    const url = `${base}/efs/sync/${realm}/${apt}/${key}`
    const cid = settings.vatsimCid.trim()
    let result = await fetchJson(url, {
        method: "PUT",
        cid,
        body: JSON.stringify(body),
    })
    if (result.status === 429) {
        await new Promise((r) => setTimeout(r, 250))
        result = await fetchJson(url, {
            method: "PUT",
            cid,
            body: JSON.stringify(body),
        })
    }
    if (!result.ok) {
        console.warn(`[vatefs-sync] PUT ${url} → ${result.status}`, result.json?.error || "")
        noteAuthFailure(result.status, result.json?.error)
        return false
    }
    noteSuccess()
    if (result.json?.updatedAt && body.strokes) {
        scribbleStore.setScribbles(stripId, body.strokes, { remoteUpdatedAt: result.json.updatedAt })
    } else if (result.json?.updatedAt) {
        scribbleStore.setScribbles(stripId, scribbleStore.getScribbles(stripId), {
            remoteUpdatedAt: result.json.updatedAt,
        })
    }
    return true
}

/**
 * Push ESSA SEP/DLV/DEP GAP airport meta (scribble-sync path).
 * Caller must gate on TWR/GND + essaRoles mode.
 * Dual-write with pushEssaStripviewLayoutToRemote until IRIS merges routes.
 */
let lastPushedEssaSepJson = ""

export async function pushEssaSepMetaToRemote(indicators: {
    sep: string
    dlv: string
    depGap: string
}): Promise<boolean> {
    const settings = getSettings()
    if (!syncTogglesOn(settings) || !validCid(settings)) return false
    const airports = getAirports().map((a) => a.toUpperCase())
    if (!airports.includes("ESSA")) return false
    const payload = {
        essaSep: {
            sep: indicators.sep ?? "",
            dlv: indicators.dlv ?? "",
            depGap: indicators.depGap ?? "",
        },
    }
    const json = JSON.stringify(payload)
    if (json === lastPushedEssaSepJson) return true
    const base = baseUrl()
    if (!base) return false
    const realm = resolveRealm(settings)
    const url = `${base}/efs/sync/${realm}/ESSA/meta`
    const cid = settings.vatsimCid.trim()
    let result = await fetchJson(url, {
        method: "PUT",
        cid,
        body: json,
    })
    if (result.status === 429) {
        await new Promise((r) => setTimeout(r, 250))
        result = await fetchJson(url, {
            method: "PUT",
            cid,
            body: json,
        })
    }
    if (!result.ok) {
        console.warn(`[vatefs-sync] PUT ${url} → ${result.status}`, result.json?.error || "")
        noteAuthFailure(result.status, result.json?.error)
        return false
    }
    lastPushedEssaSepJson = json
    noteSuccess()
    return true
}

/**
 * Strip TV / APP bay mirror: PUT /efs/:airport/:view with ordered callsigns + SEP.
 * EFS-owned order only — no ES-native status. 5 min TTL on IRIS → keepalive required.
 */
let lastPushedStripviewJson = ""
let stripviewKeepaliveTimer: ReturnType<typeof setInterval> | undefined
let stripviewLayoutProvider: (() => { airport: string; view: string; body: unknown } | null) | null =
    null

const STRIPVIEW_KEEPALIVE_MS = 2 * 60 * 1000

export function setStripviewLayoutProvider(
    provider: (() => { airport: string; view: string; body: unknown } | null) | null,
) {
    stripviewLayoutProvider = provider
}

export async function pushEssaStripviewLayoutToRemote(
    body: unknown,
    opts?: { airport?: string; view?: string; force?: boolean },
): Promise<boolean> {
    const settings = getSettings()
    if (!syncTogglesOn(settings) || !validCid(settings)) return false
    const airports = getAirports().map((a) => a.toUpperCase())
    const airport = (opts?.airport || "ESSA").toUpperCase()
    if (!airports.includes(airport)) return false
    const view = (opts?.view || "DEP").toUpperCase()
    const json = JSON.stringify(body)
    if (!opts?.force && json === lastPushedStripviewJson) return true
    const base = baseUrl()
    if (!base) return false
    // VatIRIS efs-sync/stripview: PUT /efs/:airport/:view (no realm in path)
    const url = `${base}/efs/${airport}/${view}`
    const cid = settings.vatsimCid.trim()
    let result = await fetchJson(url, {
        method: "PUT",
        cid,
        body: json,
    })
    if (result.status === 429) {
        await new Promise((r) => setTimeout(r, 250))
        result = await fetchJson(url, {
            method: "PUT",
            cid,
            body: json,
        })
    }
    if (!result.ok) {
        console.warn(`[vatefs-sync] PUT ${url} → ${result.status}`, result.json?.error || "")
        // 404 = route not mounted yet on older IRIS — not an auth failure
        if (result.status !== 404) {
            noteAuthFailure(result.status, result.json?.error)
        }
        return false
    }
    lastPushedStripviewJson = json
    noteSuccess()
    return true
}

/** Debounced Strip TV layout publish (order + SEP). */
let stripviewDebounceTimer: ReturnType<typeof setTimeout> | undefined

export function scheduleStripviewLayoutPush(delayMs = 150) {
    if (stripviewDebounceTimer) clearTimeout(stripviewDebounceTimer)
    stripviewDebounceTimer = setTimeout(() => {
        stripviewDebounceTimer = undefined
        void flushStripviewLayoutPush(false)
    }, delayMs)
}

export async function flushStripviewLayoutPush(force: boolean): Promise<boolean> {
    if (!stripviewLayoutProvider) return false
    const snap = stripviewLayoutProvider()
    if (!snap) return false
    return pushEssaStripviewLayoutToRemote(snap.body, {
        airport: snap.airport,
        view: snap.view,
        force,
    })
}

function startStripviewKeepalive() {
    if (stripviewKeepaliveTimer) return
    stripviewKeepaliveTimer = setInterval(() => {
        void flushStripviewLayoutPush(true)
    }, STRIPVIEW_KEEPALIVE_MS)
}

function stopStripviewKeepalive() {
    if (stripviewKeepaliveTimer) {
        clearInterval(stripviewKeepaliveTimer)
        stripviewKeepaliveTimer = undefined
    }
    if (stripviewDebounceTimer) {
        clearTimeout(stripviewDebounceTimer)
        stripviewDebounceTimer = undefined
    }
}

/** Push strip including explicit QNH/ATIS clear (null). Requires strip sync. */
export async function pushStripFlagsToRemote(stripId: string): Promise<boolean> {
    const settings = getSettings()
    if (!settings.stripSyncEnabled) return false
    const strip = getStripById(stripId)
    if (!strip) return false
    const body: PutBody = {
        strip: {
            ...stripMeta(strip),
            qnhGiven: strip.qnhGiven ?? null,
            atisGiven: strip.atisGiven ?? null,
        },
    }
    if (settings.scribbleSyncEnabled) {
        body.strokes = scribbleStore.getScribbles(stripId)
    }
    return putRemote(stripId, body)
}

function applyRemotePayload(
    apt: string,
    syncKey: string,
    payload: {
        strokes: unknown[]
        strip?: StripSyncMeta
        updatedAt: string
        deleted?: boolean
    },
) {
    const settings = getSettings()
    const localId = findLocalStripId(syncKey, apt) || syncKey
    const prevRemote = scribbleStore.getRemoteUpdatedAt(localId)
    if (!payload.deleted && prevRemote && payload.updatedAt && payload.updatedAt <= prevRemote) {
        return
    }
    const strokes = scribbleStore.normalizeStrokes(payload.strokes)
    const applyStripMeta = !!settings.stripSyncEnabled
    onApplyRemote(localId, strokes, payload.strip, payload.updatedAt, {
        deleted: !!payload.deleted,
        applyStripMeta,
    })
    const roomRealm = resolveRealm(getSettings())
    const room = `${roomRealm}/${apt}`
    const prev = sinceByRoom.get(room)
    if (!prev || payload.updatedAt > prev) sinceByRoom.set(room, payload.updatedAt)
}

/** Placement / create / reorder push — requires strip sync. */
export async function pushStripToRemote(stripId: string): Promise<boolean> {
    const settings = getSettings()
    if (!settings.stripSyncEnabled) return false
    const strip = getStripById(stripId)
    if (!strip) return false
    const body: PutBody = { strip: stripMeta(strip) }
    if (settings.scribbleSyncEnabled) {
        body.strokes = scribbleStore.getScribbles(stripId)
    }
    return putRemote(stripId, body)
}

/** Zoom-close / stroke push — requires scribble sync. */
export async function pushScribbleToRemote(stripId: string): Promise<boolean> {
    const settings = getSettings()
    if (!settings.scribbleSyncEnabled) return false
    const strip = getStripById(stripId)
    if (!strip) return false
    const body: PutBody = { strokes: scribbleStore.getScribbles(stripId) }
    if (settings.stripSyncEnabled) {
        body.strip = stripMeta(strip)
    }
    return putRemote(stripId, body)
}

/** Push a remote delete (note/vehicle remove, or clear shared ink record). */
export async function deleteStripFromRemote(stripId: string): Promise<boolean> {
    const settings = getSettings()
    // Deletes of note/vehicle need strip sync; ink-clear alone needs scribble sync
    if (!settings.stripSyncEnabled && !settings.scribbleSyncEnabled) return false
    const base = baseUrl()
    if (!base) return false
    const strip = getStripById(stripId)
    const apt = (strip?.airport || getAirports()[0] || "").toUpperCase()
    if (!apt) return false
    const realm = resolveRealm(settings)
    const key = encodeURIComponent(strip ? syncKeyForStrip(strip) : stripId)
    const url = `${base}/efs/sync/${realm}/${apt}/${key}`
    const result = await fetchJson(url, {
        method: "DELETE",
        cid: settings.vatsimCid.trim(),
    })
    if (!result.ok) {
        console.warn(`[vatefs-sync] DELETE ${url} → ${result.status}`, result.json?.error || "")
        noteAuthFailure(result.status, result.json?.error)
        return false
    }
    noteSuccess()
    return true
}

function findLocalStripId(syncKey: string, airport: string): string | undefined {
    const direct = getStripById(syncKey)
    if (direct) return direct.id
    void airport
    return undefined
}

export async function pollRemote(): Promise<void> {
    const base = baseUrl()
    const settings = getSettings()
    if (!base) {
        lastPollOk = false
        refreshHealth()
        return
    }
    const realm = resolveRealm(settings)
    notifyRealmIfChanged(realm)
    const cid = settings.vatsimCid.trim()
    let anyOk = false
    await Promise.all(
        getAirports().map(async (airport) => {
            const apt = airport.toUpperCase()
            const room = `${realm}/${apt}`
            const since = sinceByRoom.get(room)
            const q = since ? `?since=${encodeURIComponent(since)}` : ""
            const url = `${base}/efs/sync/${realm}/${apt}${q}`
            const result = await fetchJson(url, { method: "GET", cid })
            if (!result.ok || !result.json?.strips) {
                noteAuthFailure(result.status, result.json?.error)
                return
            }
            anyOk = true
            if (typeof result.json.updatedAt === "string" && result.json.updatedAt) {
                sinceByRoom.set(room, result.json.updatedAt)
            }
            const strips = result.json.strips as Record<
                string,
                { strokes: unknown[]; strip?: StripSyncMeta; updatedAt: string }
            >
            for (const [syncKey, payload] of Object.entries(strips)) {
                applyRemotePayload(apt, syncKey, payload)
            }
        }),
    )
    if (anyOk) {
        lastPollOk = true
        noteSuccess()
    }
    refreshHealth()
}

function notifyRealmIfChanged(realm: ScribbleRealm) {
    if (lastResolvedRealm !== realm) {
        lastResolvedRealm = realm
        onRealmChanged(realm)
    }
}

function httpBaseToWsUrl(base: string, pathWithQuery: string): string {
    const u = new URL(pathWithQuery, base.endsWith("/") ? base : `${base}/`)
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
    return u.toString()
}

function handleLiveMessage(apt: string, raw: WebSocket.RawData) {
    try {
        const msg = JSON.parse(String(raw)) as {
            type?: string
            stripKey?: string
            strokes?: unknown[]
            strip?: StripSyncMeta
            updatedAt?: string
            deleted?: boolean
        }
        if (msg.type === "hello") return
        if (!msg.stripKey || typeof msg.updatedAt !== "string") return
        applyRemotePayload(apt, msg.stripKey, {
            strokes: msg.strokes ?? [],
            strip: msg.strip,
            updatedAt: msg.updatedAt,
            deleted: !!msg.deleted,
        })
    } catch {
        // ignore malformed
    }
}

function recomputeAnyWsOpen() {
    anyWsOpen = false
    for (const [, s] of streams) {
        if (s.ws.readyState === WebSocket.OPEN) {
            anyWsOpen = true
            break
        }
    }
    refreshHealth()
}

function openRoomWs(realm: string, apt: string, cid: string, base: string, gen: number) {
    const room = `${realm}/${apt}`
    const url = httpBaseToWsUrl(
        base,
        `/efs/sync/${realm}/${apt}/ws?cid=${encodeURIComponent(cid)}`,
    )
    let intentionalClose = false
    const ws = new WebSocket(url, {
        headers: { "X-Vatsim-Cid": cid },
    })
    streams.set(room, { ws, gen })

    ws.on("open", () => {
        console.log(`[vatefs-sync] WS connected ${room}`)
        noteSuccess()
        recomputeAnyWsOpen()
    })
    ws.on("message", (data) => handleLiveMessage(apt, data))
    ws.on("error", (err) => {
        console.warn(`[vatefs-sync] WS ${room}: ${err instanceof Error ? err.message : err}`)
        noteAuthFailure(0, err instanceof Error ? err.message : String(err))
    })
    ws.on("close", (code) => {
        const cur = streams.get(room)
        if (cur?.gen === gen) streams.delete(room)
        recomputeAnyWsOpen()
        if (code === 1008 || code === 4401 || code === 4403) {
            noteAuthFailure(403, "Sign in to VatIRIS")
        }
        if (!intentionalClose && baseUrl()) scheduleStreamRestart()
    })

    // Allow stopLiveStreams to mark intentional close via property
    ;(ws as WebSocket & { __efsIntentionalClose?: () => void }).__efsIntentionalClose = () => {
        intentionalClose = true
    }
}

function scheduleStreamRestart() {
    if (streamRestartTimer) return
    streamRestartTimer = setTimeout(() => {
        streamRestartTimer = undefined
        startLiveStreams()
    }, 2_000)
}

function stopLiveStreams() {
    if (streamRestartTimer) {
        clearTimeout(streamRestartTimer)
        streamRestartTimer = undefined
    }
    for (const [, s] of streams) {
        ;(s.ws as WebSocket & { __efsIntentionalClose?: () => void }).__efsIntentionalClose?.()
        try {
            s.ws.close()
        } catch {
            // ignore
        }
    }
    streams.clear()
    anyWsOpen = false
    refreshHealth()
}

function startLiveStreams() {
    const base = baseUrl()
    const settings = getSettings()
    if (!base) {
        stopLiveStreams()
        return
    }
    const realm = resolveRealm(settings)
    notifyRealmIfChanged(realm)
    const cid = settings.vatsimCid.trim()
    const wanted = new Set(getAirports().map((a) => `${realm}/${a.toUpperCase()}`))

    for (const [room, s] of streams) {
        if (!wanted.has(room)) {
            ;(s.ws as WebSocket & { __efsIntentionalClose?: () => void }).__efsIntentionalClose?.()
            try {
                s.ws.close()
            } catch {
                // ignore
            }
            streams.delete(room)
        }
    }

    for (const airport of getAirports()) {
        const apt = airport.toUpperCase()
        const room = `${realm}/${apt}`
        const existing = streams.get(room)
        if (existing && existing.ws.readyState === WebSocket.OPEN) continue
        if (existing && existing.ws.readyState === WebSocket.CONNECTING) continue
        if (existing) {
            ;(existing.ws as WebSocket & { __efsIntentionalClose?: () => void }).__efsIntentionalClose?.()
            try {
                existing.ws.close()
            } catch {
                // ignore
            }
            streams.delete(room)
        }
        const gen = ++streamGen
        openRoomWs(realm, apt, cid, base, gen)
    }
    recomputeAnyWsOpen()
}

/** Keep WebSocket live; 15s poll is safety only (reload button also calls pollRemote). */
export function startScribbleSyncPolling(intervalMs = 15_000) {
    stopScribbleSyncPolling()
    refreshHealth()
    startLiveStreams()
    startStripviewKeepalive()
    pollTimer = setInterval(() => {
        void pollRemote()
        startLiveStreams()
    }, intervalMs)
    void pollRemote()
    void flushStripviewLayoutPush(true)
}

export function stopScribbleSyncPolling() {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = undefined
    stopLiveStreams()
    stopStripviewKeepalive()
    lastPollOk = false
    lastPushedStripviewJson = ""
    refreshHealth()
}

export function restartScribbleSyncPolling() {
    const s = getSettings()
    // Reset once-prompt when CID cleared so a new CID can prompt again
    if (!validCid(s)) signInPromptedForCid = ""
    if (syncTogglesOn(s) && validCid(s)) {
        startScribbleSyncPolling()
    } else {
        stopScribbleSyncPolling()
    }
    // Still notify realm for online-service gating even when sync off
    notifyRealmIfChanged(resolveRealm(s))
    refreshHealth()
}

/** Call when ES connection type changes so Auto realm + online services update. */
export function onConnectionTypeChanged() {
    const s = getSettings()
    notifyRealmIfChanged(resolveRealm(s))
    if (syncTogglesOn(s) && validCid(s)) {
        startLiveStreams()
        void pollRemote()
    }
    refreshHealth()
}
