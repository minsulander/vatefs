/**
 * Remote EFS sync client for VatIRIS — single allowed write set:
 *   …/:stripKey · …/order · …/meta · optional …/heartbeat · …/ws?cid=
 *
 * No /sep, /strips/, or PUT /efs/:airport/:view.
 * Does NOT publish EuroScope/ops status (IRIS esdata joins by callsign).
 *
 * Primary: push on event → WebSocket fanout. Safety: 15s poll + top-bar reload.
 */

import type { FeedStatusItem, FlightStrip, ScribbleStrokePayload, UiSettings } from "@vatefs/common"
import WebSocket from "ws"
import * as scribbleStore from "./scribble-store.js"
import {
    buildEssaIrisOrder,
    buildStripEfsFields,
    formatIrisSep,
    irisStripKey,
    normalizeAtd,
    type IrisOrderPayload,
    type StripEfsFields,
} from "./iris-efs-order.js"

export type ScribbleRealm = "live" | "sweatbox" | "playback" | "local"

const DEFAULT_SYNC_BASE_URL = "https://backend.vatiris.se"

/** Remote apply meta — EFS-only fields (alias of StripEfsFields + legacy optional keys). */
export type StripSyncMeta = StripEfsFields & {
    airport?: string
    bottom?: boolean
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
let getAllStrips: () => FlightStrip[] = () => []
let getAirports: () => string[] = () => []
let onApplyRemote: ApplyRemoteFn = () => {}
let onNeedVatIrisSignIn: (detail?: string) => void = () => {}
let onRealmChanged: (realm: ScribbleRealm) => void = () => {}
/** True when this session may publish ESSA order/SEP/heartbeat (TWR/GND). */
let canPublishIrisOrder: () => boolean = () => false
let getEssaSepIndicators: () => {
    sep: string
    dlv: string
    depGap: string
    essaConfig?: string | null
} | null = () => null

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
    getAllStrips?: () => FlightStrip[]
    getAirports: () => string[]
    onApplyRemote: ApplyRemoteFn
    onNeedVatIrisSignIn?: (detail?: string) => void
    onRealmChanged?: (realm: ScribbleRealm) => void
    canPublishIrisOrder?: () => boolean
    getEssaSepIndicators?: () => {
        sep: string
        dlv: string
        depGap: string
        essaConfig?: string | null
    } | null
}) {
    getSettings = opts.getSettings
    getConnectionType = opts.getConnectionType
    getStripById = opts.getStripById
    if (opts.getAllStrips) getAllStrips = opts.getAllStrips
    getAirports = opts.getAirports
    onApplyRemote = opts.onApplyRemote
    if (opts.onNeedVatIrisSignIn) onNeedVatIrisSignIn = opts.onNeedVatIrisSignIn
    if (opts.onRealmChanged) onRealmChanged = opts.onRealmChanged
    if (opts.canPublishIrisOrder) canPublishIrisOrder = opts.canPublishIrisOrder
    if (opts.getEssaSepIndicators) getEssaSepIndicators = opts.getEssaSepIndicators
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
    return !!s.syncEnabled
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
    return irisStripKey(strip)
}

/** EFS-only strip body for PUT …/strips/:stripKey (no ES status). */
function stripMeta(strip: FlightStrip, opts?: { includeQnhAtisClear?: boolean }): StripSyncMeta {
    return buildStripEfsFields(strip, opts)
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

async function putWithRetry(
    url: string,
    cid: string,
    body: string,
): Promise<{ ok: boolean; status: number; json?: any }> {
    let result = await fetchJson(url, { method: "PUT", cid, body })
    if (result.status === 429) {
        await new Promise((r) => setTimeout(r, 250))
        result = await fetchJson(url, { method: "PUT", cid, body })
    }
    return result
}

async function putRemote(stripId: string, body: PutBody): Promise<boolean> {
    const base = baseUrl()
    const settings = getSettings()
    if (!base) return false
    const strip = getStripById(stripId)
    if (!strip) return false
    const apt = (strip.airport || getAirports()[0] || "").toUpperCase()
    if (!apt) return false
    if (body.strokes === undefined && body.strip === undefined) return false
    const realm = resolveRealm(settings)
    const key = encodeURIComponent(syncKeyForStrip(strip))
    // IRIS single write set: bare /:stripKey only
    const url = `${base}/efs/sync/${realm}/${apt}/${key}`
    const cid = settings.vatsimCid.trim()
    const result = await putWithRetry(url, cid, JSON.stringify(body))
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
 * Airport meta — IRIS single write set: PUT …/meta
 * `{ essaSep, essaConfig? }` (bare SEP values; bankonfig id e.g. "9A").
 */
let lastPushedSepJson = ""

export async function pushEssaSepMetaToRemote(
    indicators: {
        sep: string
        dlv: string
        depGap: string
        essaConfig?: string | null
    },
    opts?: { force?: boolean },
): Promise<boolean> {
    const settings = getSettings()
    if (!syncTogglesOn(settings) || !validCid(settings)) return false
    const airports = getAirports().map((a) => a.toUpperCase())
    if (!airports.includes("ESSA")) return false
    const bare = formatIrisSep(indicators)
    const metaBody: {
        essaSep: { sep: string; dlv: string; depGap: string }
        essaConfig?: string
    } = { essaSep: bare }
    const cfg = (indicators.essaConfig || "").trim()
    if (cfg) metaBody.essaConfig = cfg
    const metaJson = JSON.stringify(metaBody)
    if (!opts?.force && metaJson === lastPushedSepJson) return true
    const base = baseUrl()
    if (!base) return false
    const realm = resolveRealm(settings)
    const url = `${base}/efs/sync/${realm}/ESSA/meta`
    const result = await putWithRetry(url, settings.vatsimCid.trim(), metaJson)
    if (!result.ok) {
        console.warn(`[vatefs-sync] PUT ${url} → ${result.status}`, result.json?.error || "")
        noteAuthFailure(result.status, result.json?.error)
        return false
    }
    lastPushedSepJson = metaJson
    noteSuccess()
    return true
}

/** Refresh meta (SEP + bankonfig) so IRIS TTL stays warm. */
export async function refreshEssaMetaToRemote(force = false): Promise<boolean> {
    const ind = getEssaSepIndicators()
    if (!ind) return false
    return pushEssaSepMetaToRemote(ind, { force })
}

/** Order revision + debounce / heartbeat for locked IRIS contract. */
let orderRevision = 0
let lastPushedOrderEntriesJson = ""
let orderDebounceTimer: ReturnType<typeof setTimeout> | undefined
let heartbeatTimer: ReturnType<typeof setInterval> | undefined

/** Optional heartbeat — any write also refreshes IRIS 5 min TTL; keep ≤2 min when quiet. */
const HEARTBEAT_MS = 90_000

export function peekEssaOrderPayload(revision = orderRevision + 1): IrisOrderPayload {
    return buildEssaIrisOrder(getAllStrips(), revision, "ESSA")
}

export async function pushIrisOrderToRemote(
    payload?: IrisOrderPayload,
    opts?: { force?: boolean; airport?: string },
): Promise<boolean> {
    const settings = getSettings()
    if (!syncTogglesOn(settings) || !validCid(settings)) return false
    if (!canPublishIrisOrder()) return false
    const airport = (opts?.airport || "ESSA").toUpperCase()
    if (!getAirports().map((a) => a.toUpperCase()).includes(airport)) return false
    const entriesJson = JSON.stringify(
        (payload ?? peekEssaOrderPayload(orderRevision + 1)).entries,
    )
    // Skip if bay order unchanged (unless force — e.g. sync start)
    if (!opts?.force && !payload && entriesJson === lastPushedOrderEntriesJson) return true
    orderRevision += 1
    const body = payload ?? buildEssaIrisOrder(getAllStrips(), orderRevision, "ESSA")
    const json = JSON.stringify(body)
    const base = baseUrl()
    if (!base) return false
    const realm = resolveRealm(settings)
    const url = `${base}/efs/sync/${realm}/${airport}/order`
    const result = await putWithRetry(url, settings.vatsimCid.trim(), json)
    if (!result.ok) {
        console.warn(`[vatefs-sync] PUT ${url} → ${result.status}`, result.json?.error || "")
        noteAuthFailure(result.status, result.json?.error)
        return false
    }
    lastPushedOrderEntriesJson = JSON.stringify(body.entries)
    noteSuccess()
    return true
}

export function scheduleIrisOrderPush(delayMs = 150) {
    if (orderDebounceTimer) clearTimeout(orderDebounceTimer)
    orderDebounceTimer = setTimeout(() => {
        orderDebounceTimer = undefined
        void pushIrisOrderToRemote(undefined, { force: false })
    }, delayMs)
}

/** Alias used by server wiring. */
export const scheduleStripviewLayoutPush = scheduleIrisOrderPush

export async function pushIrisHeartbeat(airport = "ESSA"): Promise<boolean> {
    const settings = getSettings()
    if (!syncTogglesOn(settings) || !validCid(settings)) return false
    if (!canPublishIrisOrder()) return false
    const apt = airport.toUpperCase()
    if (!getAirports().map((a) => a.toUpperCase()).includes(apt)) return false
    const base = baseUrl()
    if (!base) return false
    const realm = resolveRealm(settings)
    const url = `${base}/efs/sync/${realm}/${apt}/heartbeat`
    const result = await putWithRetry(url, settings.vatsimCid.trim(), "{}")
    if (!result.ok) {
        // 404 while IRIS rolls out — don't treat as auth
        if (result.status !== 404) {
            console.warn(`[vatefs-sync] PUT ${url} → ${result.status}`, result.json?.error || "")
            noteAuthFailure(result.status, result.json?.error)
        }
        return false
    }
    noteSuccess()
    return true
}

function startIrisHeartbeat() {
    if (heartbeatTimer) return
    heartbeatTimer = setInterval(() => {
        // Meta write refreshes TTL and keeps essaConfig current; heartbeat is optional backup
        void refreshEssaMetaToRemote(true)
        void pushIrisHeartbeat("ESSA")
    }, HEARTBEAT_MS)
}

function stopIrisHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = undefined
    }
    if (orderDebounceTimer) {
        clearTimeout(orderDebounceTimer)
        orderDebounceTimer = undefined
    }
}

/** @deprecated no-op — layout PUT /efs/:airport/:view retired */
export function setStripviewLayoutProvider(
    _provider: (() => { airport: string; view: string; body: unknown } | null) | null,
) {
    // Order publish uses getAllStrips + canPublishIrisOrder from initScribbleSync
}

/** Push strip including explicit QNH/ATIS clear (null). */
export async function pushStripFlagsToRemote(stripId: string): Promise<boolean> {
    const settings = getSettings()
    if (!settings.syncEnabled) return false
    const strip = getStripById(stripId)
    if (!strip) return false
    const body: PutBody = {
        strip: stripMeta(strip, { includeQnhAtisClear: true }),
        strokes: scribbleStore.getScribbles(stripId),
    }
    const ok = await putRemote(stripId, body)
    if (ok) scheduleIrisOrderPush()
    return ok
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
    if (!settings.syncEnabled) return
    const localId = findLocalStripId(syncKey, apt) || syncKey
    const prevRemote = scribbleStore.getRemoteUpdatedAt(localId)
    if (!payload.deleted && prevRemote && payload.updatedAt && payload.updatedAt <= prevRemote) {
        return
    }
    const strokes = scribbleStore.normalizeStrokes(payload.strokes)
    onApplyRemote(localId, strokes, payload.strip, payload.updatedAt, {
        deleted: !!payload.deleted,
        applyStripMeta: true,
    })
    const roomRealm = resolveRealm(getSettings())
    const room = `${roomRealm}/${apt}`
    const prev = sinceByRoom.get(room)
    if (!prev || payload.updatedAt > prev) sinceByRoom.set(room, payload.updatedAt)
}

/** Last pushed `cfto|atd` per strip. Empty atd is the cleared value. */
const lastCftoAtdSig = new Map<string, string>()

function cftoAtdSignature(strip: Pick<FlightStrip, "clearedForTakeoff" | "atd">): string {
    return `${!!strip.clearedForTakeoff}|${normalizeAtd(strip.atd) ?? ""}`
}

/**
 * PUT the strip body when EFS cfto/atd changes, without waiting for a scribble.
 * The first observation of `false|` is skipped so startup does not PUT every strip.
 * Inbound sync must not apply these fields back onto the flight.
 */
export function pushStripCftoAtdIfChanged(strip: FlightStrip): void {
    if (strip.stripType === "note" || strip.stripType === "vehicle") return
    if (!canPublishIrisOrder()) return
    const settings = getSettings()
    if (!syncTogglesOn(settings) || !validCid(settings)) return
    const sig = cftoAtdSignature(strip)
    const prev = lastCftoAtdSig.get(strip.id)
    if (prev === sig) return
    lastCftoAtdSig.set(strip.id, sig)
    if (prev === undefined && sig === "false|") return
    void pushStripToRemote(strip.id)
}

export function forgetStripCftoAtd(stripId: string): void {
    lastCftoAtdSig.delete(stripId)
}

/** Placement / create / reorder push. */
export async function pushStripToRemote(stripId: string): Promise<boolean> {
    const settings = getSettings()
    if (!settings.syncEnabled) return false
    const strip = getStripById(stripId)
    if (!strip) return false
    const body: PutBody = {
        strip: stripMeta(strip),
        strokes: scribbleStore.getScribbles(stripId),
    }
    const ok = await putRemote(stripId, body)
    if (ok) scheduleIrisOrderPush()
    return ok
}

/** Zoom-close / stroke push. */
export async function pushScribbleToRemote(stripId: string): Promise<boolean> {
    const settings = getSettings()
    if (!settings.syncEnabled) return false
    const strip = getStripById(stripId)
    if (!strip) return false
    const body: PutBody = {
        strokes: scribbleStore.getScribbles(stripId),
        strip: stripMeta(strip),
    }
    return putRemote(stripId, body)
}

/** Push a remote delete (note/vehicle remove, or clear shared ink record). */
export async function deleteStripFromRemote(stripId: string): Promise<boolean> {
    const settings = getSettings()
    if (!settings.syncEnabled) return false
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
    scheduleIrisOrderPush()
    return true
}

function findLocalStripId(syncKey: string, airport: string): string | undefined {
    const direct = getStripById(syncKey)
    if (direct) return direct.id
    const key = syncKey.toUpperCase()
    const apt = airport.toUpperCase()
    for (const s of getAllStrips()) {
        if (irisStripKey(s) === key) {
            if (!apt || !(s.airport || "") || (s.airport || "").toUpperCase() === apt) {
                return s.id
            }
        }
    }
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
            /** snapshot on connect */
            strips?: Record<
                string,
                { strokes?: unknown[]; strip?: StripSyncMeta; updatedAt?: string }
            >
        }
        if (msg.type === "hello" || msg.type === "heartbeat" || msg.type === "order") return
        if (msg.type === "meta") return // SEP is TWR-owned; peers don't apply airport meta locally yet
        if (msg.type === "snapshot" && msg.strips && typeof msg.strips === "object") {
            for (const [syncKey, row] of Object.entries(msg.strips)) {
                if (!row?.updatedAt) continue
                applyRemotePayload(apt, syncKey, {
                    strokes: row.strokes ?? [],
                    strip: row.strip,
                    updatedAt: row.updatedAt,
                })
            }
            return
        }
        // IRIS: strip / stripDeleted; legacy scribble still accepted from older sync hosts
        const isUpsert =
            msg.type === "strip" || msg.type === "scribble" || msg.type === undefined
        const isDelete = msg.type === "stripDeleted" || !!msg.deleted
        if (!msg.stripKey || typeof msg.updatedAt !== "string") return
        if (!isUpsert && !isDelete) return
        applyRemotePayload(apt, msg.stripKey, {
            strokes: msg.strokes ?? [],
            strip: msg.strip,
            updatedAt: msg.updatedAt,
            deleted: isDelete,
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
    startIrisHeartbeat()
    pollTimer = setInterval(() => {
        void pollRemote()
        startLiveStreams()
    }, intervalMs)
    void pollRemote()
    void pushIrisOrderToRemote(undefined, { force: true })
    void refreshEssaMetaToRemote(true)
    void pushIrisHeartbeat("ESSA")
    for (const strip of getAllStrips()) pushStripCftoAtdIfChanged(strip)
}

export function stopScribbleSyncPolling() {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = undefined
    stopLiveStreams()
    stopIrisHeartbeat()
    lastPollOk = false
    lastPushedOrderEntriesJson = ""
    lastPushedSepJson = ""
    lastCftoAtdSig.clear()
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
