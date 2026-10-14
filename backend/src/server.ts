import express from "express"
import path from "path"
import fs from "fs"
import logRequests from "morgan"
import serveStatic from "serve-static"
import { WebSocket, WebSocketServer } from "ws"
import dgram from "dgram"
import { inspect } from "util"

// Force synchronous stdout/stderr so output isn't buffered when piped
function formatArgs(args: unknown[]): string {
    return args.map(a => typeof a === "string" ? a : inspect(a)).join(" ")
}
console.log = (...args: unknown[]) => { fs.writeSync(1, formatArgs(args) + "\n") }
console.warn = (...args: unknown[]) => { fs.writeSync(2, formatArgs(args) + "\n") }
console.error = (...args: unknown[]) => { fs.writeSync(2, formatArgs(args) + "\n") }

import {
    constants,
    isClientMessage,
    isEsmsAutoCoordReplyAltitude,
    isEsmsAutoCoordSid,
    parseAltitudeToFeet,
    parseGapKey,
    resolveEssaRwyConfigId,
    computeEssaSepIndicators,
    mergeEssaSepIndicators,
    ESSA_SEP_CYCLE,
} from "@vatefs/common"
import type { EssaSepOverrides, EssaSepField } from "@vatefs/common"
import type {
    LayoutMessage,
    StripMessage,
    StripDeleteMessage,
    GapMessage,
    GapDeleteMessage,
    SectionMessage,
    RefreshMessage,
    StatusMessage,
    FeedsStatus,
    FeedStatusItem,
    DclStatusMessage,
    HoppieMessage,
    AtisUpdateMessage,
    EssaSepIndicatorsMessage,
    ConfigListMessage,
    ControllersMessage,
    ControllerInfo,
    UserSettingsMessage,
    NotifyMessage,
    DeletedStripsMessage,
    RwyFlagsMessage,
    ServerMessage,
    ClientMessage,
    AirportAtisInfo,
    UiSettings,
} from "@vatefs/common"
import { DEFAULT_UI_SETTINGS, isAutoLopSsrMode, isPaperInfoKind } from "@vatefs/common"
import type { AutoLopSsrMode, FlightStrip, Gap, Section, ScribbleStrokePayload } from "@vatefs/common"
import { store } from "./store.js"
import * as scribbleStore from "./scribble-store.js"
import {
    initScribbleSync,
    pollRemote,
    pushStripToRemote,
    pushScribbleToRemote,
    pushStripFlagsToRemote,
    deleteStripFromRemote,
    restartScribbleSyncPolling,
    getIrisSyncHealth,
    isOfflineVatsimRealm,
    onConnectionTypeChanged,
    pushEssaSepMetaToRemote,
    scheduleStripviewLayoutPush,
    resolveRealm,
} from "./vatefs-sync.js"
import type { ScribbleRealm } from "./vatefs-sync.js"
import { suggestCidFromEsPrf } from "./prf-cid.js"
import {
    flightStore,
    hasValidAssignedSquawk,
    normalizeAssignedSquawk,
    parseAircraftInfo,
    applyParsedEquipment,
    type DevSpoofFields,
} from "./flightStore.js"
import { startSpoofRepl } from "./spoof-cli.js"
import {
    blankPaperInfoKind,
    externalStripType,
    listFspServerBaseUrls,
    parseExternalRflFeet,
    pickExternalField,
    type ExternalPrintBody,
} from "./fsp-api.js"
import { setMyCallsign, setMyAirports, setIsController, setMyFrequency, setMyPositionId, setActiveRunways, setEssaAssignedRunways, staticConfig, determineMoveAction, applyConfig, parseControllerRole, setMyRole, updateOnlineController, removeOnlineController, clearOnlineControllers, getControllerCallsign, setActiveAirports, setColumnAirport, setColumnCount, rebuildMultiAirportLayout, isEssaRolesConfig, setEssaRoles, restoreEssaRolesFromSettings, isEsggRolesConfig, setEsggRoles, restoreEsggRolesFromSettings, hasEsggPositionRole, getActingControllerRole } from "./config.js"
import type { EuroscopeCommand, EssaPositionRole, EsggPositionRole } from "./config.js"
import {
    normalizeEssaRoles,
    remapBayIdsToLayout,
    remapStripsForEssaGndOnly,
    collectEssaRunwayPairs,
    essaRunwayPairsFingerprint,
} from "./essa-roles.js"
import { normalizeEsggRoles } from "./esgg-roles.js"
import type { MyselfUpdateMessage, ControllerPositionUpdateMessage, ControllerDisconnectMessage, Flight } from "./types.js"
import { loadAirports, getAirportCount, getAirportByIcao, listAirportIcaos } from "./airport-data.js"
import { loadRunways, getRunwayCount, getRunwaysByAirport } from "./runway-data.js"
import { isOnRunway } from "./runway-detection.js"
import { loadConfig, getDefaultConfigPath, scanConfigDirectory } from "./config-loader.js"
import type { ConfigFileInfo } from "./config-loader.js"
import {
    isMultiAirportConfig,
    normalizeColumnAirports,
    isAnonymousSpecialStripId,
} from "./multi-airport.js"
import { loadStands, hasStandData, airportsWithStands } from "./stand-data.js"
import {
    loadSidData,
    getSidDataHealth,
    getSidsForRunway,
    resolveSidAltitude,
    pickEseSidForRouteExit,
} from "./sid-data.js"
import { isSlowAircraft, isPropellerEngine } from "./slow-aircraft.js"
import { standRequiresStartupInsteadOfPush } from "./essa-push-stands.js"
import {
    hasForcedSidInRoute,
    hasSlowRemark,
    hasVectRemark,
    isIfrSidEligible,
    isTrackSidName,
    parseRflToFeet,
    resolveEssaHeavyPreferredDepRwy,
    resolveLopAutoDirect,
    sidsMatch,
    withSlowRemark,
    withVectRemark,
} from "@vatefs/common"
import { loadEseAirspace, getEseAirspaceHealth } from "./ese-airspace.js"
import {
    startAfvTransceiverPolling,
    stopAfvTransceiverPolling,
    getAfvHealth,
    refreshAfvTransceivers,
} from "./afv-transceivers.js"
import {
    isEssaStripVisibleForRoles,
    resolveEssaNextSi,
    resolveAppDepTransfer,
    resolveEssaXferCallsign,
    setForceIdealAppDepFrequency,
    filterEssaRunwayPlacementsForMyAor,
    essaAorLayoutKey,
    getMyEssaCoveredRunways,
} from "./essa-next-si.js"
import {
    loadEssaSidPrefs,
    resolvePreferredSid,
    resolveMapDelivery,
    resolveEssaDepInfoStrip,
    collectSidsForTmaExit,
    appDepSectorToSi,
    type AppDepSector,
} from "./essa-sid-prefs.js"
import { getEsePositionBySi } from "./ese-airspace.js"
import { resolveEsmsPreferredSid, isEkchRwy30Active, collectEsmsSidsForTmaExit } from "./esms-sid.js"
import { resolveEsggPreferredSid, collectEsggSidsForTmaExit } from "./esgg-sid.js"
import { resolveEsggDepApp, resolveEsggMapDelivery, resolveEsggMisapApp } from "./esgg-app.js"
import { loadCtrData, checkCtrAtPosition, getCtrHealth } from "./ctr-data.js"
import { mockMyselfUpdate } from "./mockPluginMessages.js"
import { loadHoppieConfig, getLogonCode, getDclAirports, fillDclTemplate, fillDclTemplateWithMarkers } from "./hoppie-config.js"
import {
    loadTopSkyAirspace,
    getAppClrTypes,
    getTopSkyAirspaceHealth,
    getTransitionAltitudeFt,
} from "./topsky-airspace.js"
import type { DclTemplateData } from "./hoppie-config.js"
import { HoppieService, checkHoppieStatus } from "./hoppie-service.js"
import { AtisService } from "./atis-service.js"
import { startAupR16Service, getAupR16Status, getAupR16StatusFresh, checkAupR16Change } from "./aup/service.js"
import type { AupR16Status } from "./aup/types.js"
import type { DclStatus } from "./hoppie-service.js"
import { ViffService } from "./viff-service.js"
import type { ViffPollResult } from "./viff-service.js"
import { loadDclSound, playDclSound, loadTransferSounds, playTransferSound } from "./sound.js"
import { loadIcaoAirports, getIcaoAirportName, getIcaoAirportInfo } from "./icao-airports.js"
import { loadIcaoAirlines } from "./icao-airlines.js"
import { loadSlowAircraft } from "./slow-aircraft.js"
import { initUserSettings, loadUserSettings, saveUserSettings, resolveUiSettings } from "./user-settings.js"
import { buildCombinedScratch } from "./scratchpad.js"

// __filename and __dirname are provided by esbuild's CJS output

// Data directory path (relative to backend root when running from src/)
let dataDir = path.resolve(__dirname, "../../data")
if (!fs.existsSync(dataDir)) dataDir = path.resolve(__dirname, "../data")
if (!fs.existsSync(dataDir)) dataDir = path.resolve(__dirname, "data")

const port = 17770
const udpInPort = 17771
const udpOutPort = 17772
const udpHost = "127.0.0.1"

// Parse command-line arguments
function parseArgs(): { config?: string; callsign?: string; airports?: string[]; recordFile?: string; mock?: boolean; viffBaseUrl?: string } {
    const args = process.argv.slice(2)
    const result: { config?: string; callsign?: string; airports?: string[]; recordFile?: string; mock?: boolean; viffBaseUrl?: string } = {}

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--config" && args[i + 1]) {
            result.config = args[++i]
        } else if (args[i] === "--callsign" && args[i + 1]) {
            result.callsign = args[++i]
        } else if (args[i] === "--airport" && args[i + 1]) {
            // Support comma-separated airports: --airport ESGG,ESSA
            result.airports = args[++i].split(",").map((a) => a.trim().toUpperCase())
        } else if (args[i] === "--record" && args[i + 1]) {
            result.recordFile = args[++i]
        } else if (args[i] === "--viff-base-url" && args[i + 1]) {
            result.viffBaseUrl = args[++i]
        } else if (args[i] === "--mock") {
            result.mock = true
        }
    }

    return result
}

const cliArgs = parseArgs()

// Configuration management
const configDir = path.join(dataDir, "config")
let availableConfigs: ConfigFileInfo[] = scanConfigDirectory(configDir)
let activeConfigFile = path.basename(cliArgs.config ?? getDefaultConfigPath(dataDir))

/**
 * One-shot airport→config pick after first primed myselfUpdate.
 * Disabled when `--config` was passed, or after the user switches manually.
 */
let configAutoSelectPending = !cliArgs.config
let configManuallySelected = false

/** EuroScope "not primed" primary frequency */
function isPrimedFrequency(frequency: number | undefined | null): boolean {
    if (frequency == null || !(frequency > 0)) return false
    return Math.abs(frequency - 199.998) > 0.001
}

/** True when we should use RTC (multiairport) — ESSR login or online ESSR positions. */
function isEssrRtcSession(callsign?: string | null): boolean {
    const self = (callsign ?? staticConfig.myCallsign ?? "").toUpperCase()
    if (self.startsWith("ESSR")) return true
    const online = staticConfig.onlineControllers
    if (!online) return false
    for (const ctrl of online.values()) {
        if (ctrl.callsign.toUpperCase().startsWith("ESSR")) return true
    }
    return false
}

/**
 * Pick layout for the current session:
 * - RTC only for ESSR (self or online ESSR positions)
 * - else ESSA if in rwyconfig, else ESGG
 */
function configFileForDiscoveredAirports(
    airports: string[],
    callsign?: string | null,
): string | undefined {
    if (isEssrRtcSession(callsign)) return "multiairport.yml"
    const set = new Set(airports.map((a) => a.toUpperCase()))
    if (set.has("ESSA")) return "essa.yml"
    if (set.has("ESGG")) return "esgg.yml"
    return undefined
}

// Load initial configuration from YAML file
const initialConfigPath = cliArgs.config ?? getDefaultConfigPath(dataDir)
try {
    const config = loadConfig(initialConfigPath)
    applyConfig(config)
} catch (err) {
    console.error(`Failed to load config: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
}

// Load airport and runway data
const airportsFile = path.join(dataDir, "airports.csv")
const runwaysFile = path.join(dataDir, "runways.csv")

if (fs.existsSync(airportsFile)) {
    loadAirports(airportsFile)
} else {
    console.warn(`Airport data file not found: ${airportsFile}`)
}

if (fs.existsSync(runwaysFile)) {
    loadRunways(runwaysFile)
} else {
    console.warn(`Runway data file not found: ${runwaysFile}`)
}

// Load ICAO airport names
const icaoAirportsFile = path.join(dataDir, "ICAO_Airports.txt")
if (fs.existsSync(icaoAirportsFile)) {
    loadIcaoAirports(icaoAirportsFile)
} else {
    console.warn(`ICAO airports file not found: ${icaoAirportsFile}`)
}

// Load slow aircraft rules
const slowAircraftFile = path.join(dataDir, "slow-aircraft.json")
if (fs.existsSync(slowAircraftFile)) {
    loadSlowAircraft(slowAircraftFile)
} else {
    console.warn(`Slow aircraft config not found: ${slowAircraftFile}`)
}

// ESSA Appendix A/B preferred + SLOW SID tables
const essaSidPrefsFile = path.join(dataDir, "essa-sid-prefs.json")
loadEssaSidPrefs(essaSidPrefsFile)

/**
 * Validate that a directory is a EuroScope install: must contain *.prf file.
 */
function isValidEuroscopeDir(dir: string): boolean {
    try {
        const entries = fs.readdirSync(dir)
        const hasPrf = entries.some((name) => name.endsWith(".prf"))
        return hasPrf
    } catch {
        return false
    }
}

/**
 * Find EuroScope directory by trying multiple locations in sequence.
 */
function findEuroscopeDir(): string | undefined {
    const home = process.env.HOME || process.env.USERPROFILE || ""
    const candidates = [
        path.join(process.env.APPDATA || "", "EuroScope"),
        path.join("C:", "Program Files (x86)", "EuroScope"),
        path.join(home, "VATSIM", "drive_c", "EUROSCOPE"),
    ]
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate) && isValidEuroscopeDir(candidate)) {
            return candidate
        }
    }
    return undefined
}

// Load EuroScope data (stands, SIDs)
// TODO: make configurable — only load data files from this EuroScope package directory
const EUROSCOPE_PACKAGE = 'ESAA'
const EUROSCOPE_DIR = findEuroscopeDir()

/** Startup parse results for status popup (updated as files load) */
const localFeedState = {
    euroscopeDir: {
        ok: !!EUROSCOPE_DIR,
        detail: EUROSCOPE_DIR ? path.resolve(EUROSCOPE_DIR) : "Not found",
    } as FeedStatusItem,
    hoppieConfig: { ok: false, detail: "Not loaded" } as FeedStatusItem,
    cdmLocal: { ok: false, detail: "Not found" } as FeedStatusItem,
}

function updateHoppieConfigFeedState(euroscopeDir: string) {
    const hoppie = loadHoppieConfig(euroscopeDir)
    const codeOk = !!hoppie.logonCode
    const tmplOk = hoppie.dclTemplates.size > 0
    if (codeOk && tmplOk) {
        localFeedState.hoppieConfig = {
            ok: true,
            detail: `Code + ${hoppie.dclTemplates.size} DCL template(s)`,
        }
    } else if (codeOk || tmplOk) {
        localFeedState.hoppieConfig = {
            ok: false,
            detail: codeOk ? "Code OK, templates missing" : "Templates OK, code missing",
        }
    } else {
        localFeedState.hoppieConfig = { ok: false, detail: "Not found" }
    }
}

if (EUROSCOPE_DIR) {
    console.log(`EuroScope directory: ${EUROSCOPE_DIR}`)
    try {
        const n = loadStands(EUROSCOPE_DIR, EUROSCOPE_PACKAGE)
        if (n <= 0) console.warn("Stand file loaded 0 stands")
    } catch (err) {
        console.warn(`Failed to load stand data: ${err instanceof Error ? err.message : err}`)
    }
    try {
        loadSidData(EUROSCOPE_DIR, EUROSCOPE_PACKAGE)
    } catch (err) {
        console.warn(`Failed to load SID data: ${err instanceof Error ? err.message : err}`)
    }
    try {
        loadEseAirspace(EUROSCOPE_DIR, EUROSCOPE_PACKAGE)
    } catch (err) {
        console.warn(`Failed to load ESE airspace: ${err instanceof Error ? err.message : err}`)
    }
    // AFV multi-freq (VATSIM Radar "Monitoring") for APP/DEP XC detection
    startAfvTransceiverPolling()
    try {
        loadIcaoAirlines(path.join(EUROSCOPE_DIR, EUROSCOPE_PACKAGE, "ICAO", "ICAO_Airlines.txt"))
    } catch (err) {
        console.warn(`Failed to load ICAO airlines: ${err instanceof Error ? err.message : err}`)
    }
    // Load Hoppie config (logon code + DCL templates)
    updateHoppieConfigFeedState(EUROSCOPE_DIR)
    try {
        loadTopSkyAirspace(EUROSCOPE_DIR)
    } catch (err) {
        console.warn(`Failed to load TopSkyAirspace: ${err instanceof Error ? err.message : err}`)
    }
    // Load DCL notification sound
    loadDclSound(EUROSCOPE_DIR)
    loadTransferSounds(EUROSCOPE_DIR)
    // Initialize user settings persistence
    initUserSettings(EUROSCOPE_DIR)
    const savedSettings = loadUserSettings()
    // Explicit `--config` wins over last-used layout (dev / forced RTC etc.)
    if (savedSettings.activeConfig && !cliArgs.config) {
        const configInfo = availableConfigs.find(c => c.file === savedSettings.activeConfig)
        if (configInfo) {
            console.log(`Restoring saved config: ${configInfo.name} (${savedSettings.activeConfig})`)
            try {
                const config = loadConfig(configInfo.fullPath)
                applyConfig(config)
                activeConfigFile = savedSettings.activeConfig
                // Keep auto-select pending: first primed myselfUpdate may switch
                // RTC→ESSA/ESGG (or to RTC when ESSR is online). Manual switch still locks.
            } catch (err) {
                console.warn(`Failed to restore saved config: ${err instanceof Error ? err.message : err}`)
            }
        }
    } else if (cliArgs.config) {
        console.log(`Keeping CLI config (${activeConfigFile}); skipping saved-config restore`)
    }
    if (savedSettings.dclMode) {
        console.log(`Restoring saved DCL mode: ${savedSettings.dclMode}`)
    }
    if (savedSettings.activeAirports && savedSettings.activeAirports.length > 0 && isMultiAirportConfig(staticConfig)) {
        setActiveAirports(savedSettings.activeAirports)
        console.log(`Restoring active airports: ${savedSettings.activeAirports.join(", ")}`)
    }
    if (savedSettings.columnCount && isMultiAirportConfig(staticConfig)) {
        setColumnCount(savedSettings.columnCount)
    }
    if (
        savedSettings.columnAirports &&
        savedSettings.columnAirports.length > 0 &&
        isMultiAirportConfig(staticConfig)
    ) {
        const count = staticConfig.columnCount ?? savedSettings.columnCount ?? savedSettings.columnAirports.length
        const active = new Set((staticConfig.activeAirports ?? []).map((a) => a.toUpperCase()))
        const restored = normalizeColumnAirports(
            savedSettings.columnAirports.map((a) => {
                if (!a) return null
                const icao = a.toUpperCase()
                return active.size === 0 || active.has(icao) ? icao : null
            }),
            count,
        )
        staticConfig.columnAirports = restored
        rebuildMultiAirportLayout()
        console.log(
            `Restoring column airports: ${restored.map((a) => a ?? "-").join(", ")}`,
        )
    }
    if (isEssaRolesConfig(staticConfig)) {
        const roles = normalizeEssaRoles(savedSettings.essaRoles)
        restoreEssaRolesFromSettings(roles, savedSettings.essaRolesManual)
        if (savedSettings.essaRolesManual) {
            console.log(`Restoring manual ESSA roles: ${(roles ?? []).join(", ")}`)
        }
    }
    if (isEsggRolesConfig(staticConfig)) {
        // ESGG roles are covering-auto only (no manual override)
        restoreEsggRolesFromSettings(undefined, false)
        if (savedSettings.esggRolesManual) {
            saveUserSettings({ esggRoles: [], esggRolesManual: false })
        }
    }
} else {
    console.warn("EuroScope directory not found (tried APPDATA, Program Files (x86), VATSIM/drive_c)")
    // Still persist UI settings under %APPDATA%\EuroScope when possible (mock/dev)
    const appdata = process.env.APPDATA
    if (appdata) {
        const fallbackDir = path.join(appdata, "EuroScope")
        initUserSettings(fallbackDir)
        console.log(`User settings fallback directory: ${fallbackDir}`)
    }
}

/** UI preferences (DCL sound, strip flashes) — defaults until loaded from disk */
let currentUiSettings: UiSettings = { ...DEFAULT_UI_SETTINGS }
/** Last EuroScope connection type (for scribble sync realm auto) */
let lastConnectionType: number | undefined
{
    const saved = loadUserSettings()
    currentUiSettings = resolveUiSettings(saved)
    setForceIdealAppDepFrequency(currentUiSettings.showAppDepXcFrequency)
}
flightStore.setAutoParkEnabledGetter(() => currentUiSettings.autoParkEnabled)
flightStore.setStripPrintModeGetter(() => currentUiSettings.stripPrintMode)

function isAutoParkAvailable(): boolean {
    return staticConfig.myAirports.some((a) => hasStandData(a))
}

// Load CTR/TIZ boundary data from LFV (async, non-fatal)
loadCtrData().catch((err) => {
    console.warn(`Failed to load CTR data: ${err instanceof Error ? err.message : err}`)
})

// Apply command-line callsign override
if (cliArgs.callsign) {
    setMyCallsign(cliArgs.callsign)
    console.log(`Callsign set to: ${cliArgs.callsign}`)
}

// Apply command-line airports or mock default
if (cliArgs.airports && cliArgs.airports.length > 0) {
    setMyAirports(cliArgs.airports)
    console.log(`Airports set to: ${cliArgs.airports.join(", ")}`)
} else if (cliArgs.mock) {
    // Default to ESGG for mock mode
    setMyAirports(["ESGG"])
    console.log(`Airports set to: ESGG (mock default)`)
}

// Recording state
let recordStream: fs.WriteStream | null = null
let recordStartTime: number | null = null

if (cliArgs.recordFile) {
    recordStream = fs.createWriteStream(cliArgs.recordFile, { flags: "a" })
    console.log(`Recording UDP messages to: ${cliArgs.recordFile}`)
}

function recordMessage(message: string) {
    if (!recordStream) return

    const now = Date.now()
    if (recordStartTime === null) {
        recordStartTime = now
    }

    const relativeTime = now - recordStartTime
    recordStream.write(`${relativeTime}\t${message}\n`)
}

/**
 * Format an EuroScope command for logging
 */
function formatEuroscopeCommand(command: EuroscopeCommand): string {
    switch (command.type) {
        case "setClearance":
            return `setClearance(${command.value})`
        case "setGroundstate":
            return `setGroundstate(${command.value})`
        case "setClearedToLand":
            return `setClearedToLand(${command.value})`
        case "setClearedForTakeoff":
            return `setClearedForTakeoff(${command.value})`
    }
}

/**
 * Execute a move rule command: send UDP to EuroScope and apply state locally.
 * Caller should reevaluateAndBroadcast after applying all commands in a move.
 */
function executeMoveCommand(command: EuroscopeCommand, callsign: string, flight: Flight) {
    switch (command.type) {
        case "setGroundstate": {
            let state = command.value
            // ESSA stand exceptions: drag-to-push_start should set STUP, not PUSH
            if (state === "PUSH" && standRequiresStartupInsteadOfPush(flight.stand, flight.engineType)) {
                state = "STUP"
            }
            sendUdp(JSON.stringify({ type: "setGroundState", callsign, state }))
            flightStore.applyOptimisticGroundstate(callsign, state)
            break
        }

        case "setClearance":
            // Plugin ToggleClearanceFlag always flips — never UDP when already at desired
            // (e.g. CD ALL → TAXI → CD ALL would otherwise turn CLR on and force TSAT)
            if (!!flight.clearance === !!command.value) {
                break
            }
            sendUdp(JSON.stringify({ type: "toggleClearanceFlag", callsign, desired: command.value }))
            flightStore.applyOptimisticClearance(callsign, command.value)
            break

        case "setClearedToLand":
            if (command.value) {
                sendUdp(JSON.stringify({ type: "setClearedToLand", callsign }))
            } else {
                // Unset cleared to land — backend-managed flag + tell plugin to clear scratchpad
                sendUdp(JSON.stringify({ type: "unsetClearedToLand", callsign }))
            }
            flight.clearedToLand = command.value
            break

        case "setClearedForTakeoff":
            console.log(`setClearedForTakeoff not yet implemented for move rules`)
            break
    }
}

/**
 * After flight state changes in mock mode, re-evaluate section rules and broadcast.
 * Handles section moves, position shifts, and gap adjustments.
 */
function reevaluateAndBroadcast(callsign: string) {
    const result = flightStore.reevaluateStrip(callsign)

    // Soft-delete (e.g. Auto PARK → delete_parked): stash in trash + remove from clients
    if (result.softDeleted) {
        const reason = result.flight?.lastDeleteRule
        const stashed = store.softDeleteCallsignToTrash(callsign, reason)
        for (const id of stashed) {
            broadcastStripDelete(id)
        }
        if (stashed.length > 0) {
            broadcastDeletedStrips()
            console.log(`Strip(s) soft-deleted to trash: ${stashed.join(", ")} (${reason ?? "rule"})`)
        }
        return
    }

    if (!result.strip) return

    // Handle section change: recompute positions in old section
    if (result.sectionChanged && result.previousSection) {
        store.recomputePositions(
            result.previousSection.bayId,
            result.previousSection.sectionId,
            false
        )
    }

    // Same-slot: pin appearance order (TAXIWAY ARR TXIN/TAXI etc.).
    // Section moves and APP-transfer sticky-top bumps: allow new pos.
    const allowPos = !!(result.sectionChanged || result.allowPositionChange)
    const applied = store.updateStripFromFlight(
        result.strip,
        allowPos ? { allowPositionChange: true } : undefined
    )

    // Broadcast shifted strips and gaps BEFORE the auto-moved strip so positions are settled
    // by the time the frontend mounts the moved strip and measures its target position
    if (allowPos && result.shiftedCallsigns && result.shiftedCallsigns.length > 0) {
        for (const shifted of result.shiftedCallsigns) {
            const shiftedStrip = flightStore.regenerateStrip(shifted)
            if (shiftedStrip) {
                const shiftedApplied = store.updateStripFromFlight(shiftedStrip, {
                    allowPositionChange: true,
                })
                broadcastStrip(shiftedApplied)
            }
        }

        // Shift gap indices to match the shifted strip positions
        const gapResult = store.shiftGapsDown(applied.bayId, applied.sectionId)
        for (const key of gapResult.deletedGapKeys) {
            const parsed = parseGapKey(key)
            if (parsed) {
                broadcastGapDelete(parsed.bayId, parsed.sectionId, parsed.index)
            }
        }
        for (const gap of gapResult.shiftedGaps) {
            broadcastGap(gap)
        }
    }

    broadcastStrip(applied, allowPos ? { autoMoved: true } : undefined)
}

flightStore.setRofRequestExpireHandler((callsign) => reevaluateAndBroadcast(callsign))
flightStore.setAutoParkCommandHandler((callsign) => {
    sendUdp(JSON.stringify({ type: "setGroundState", callsign, state: "PARK" }))
    sendUdp(JSON.stringify({ type: "release", callsign }))
    sendUdp(JSON.stringify({ type: "clearScratchpad", callsign } satisfies OutboundPluginCommand))
    sendUdp(JSON.stringify({ type: "setHs", callsign, value: "" } satisfies OutboundPluginCommand))
    sendUdp(JSON.stringify({ type: "setCoo", callsign, coo: false } satisfies OutboundPluginCommand))
    // Optimistic local ownership clear so strip updates immediately (matches PARK button)
    const flight = flightStore.getFlight(callsign)
    if (flight) {
        flight.controller = ""
        flight.controllerId = undefined
        flight.handoffTargetController = undefined
        flight.handoffTargetControllerId = undefined
        flight.hs = undefined
        flight.remarks = undefined
        flight.hp = undefined
        flight.coo = undefined
    }
    reevaluateAndBroadcast(callsign)
})

type OutboundPluginCommand =
    | { type: "setClearedToLand"; callsign: string }
    | { type: "unsetClearedToLand"; callsign: string }
    | { type: "setGroundState"; callsign: string; state: string }
    | { type: "transfer"; callsign: string; targetCallsign?: string }
    | { type: "release"; callsign: string }
    | { type: "assume"; callsign: string }
    | { type: "refuse"; callsign: string }
    | { type: "toggleClearanceFlag"; callsign: string; desired?: boolean }
    | { type: "resetSquawk"; callsign: string }
    | { type: "assignDepartureRunway"; callsign: string; runway: string }
    | { type: "assignArrivalRunway"; callsign: string; runway: string }
    | { type: "assignSid"; callsign: string; sid: string }
    | { type: "assignHeading"; callsign: string; heading: number }
    | { type: "assignDirect"; callsign: string; point: string }
    | { type: "assignCfl"; callsign: string; altitude: number }
    | { type: "createFlightPlan"; callsign: string; stripType: "vfrDep" | "vfrArr" | "cross"; origin: string; destination: string; aircraftType: string; flightRules: string }
    | { type: "goaround"; callsign: string }
    /** EFS soft G/A — strip annotation 5 (not TopSky MISAP_) */
    | { type: "setEfsGoAround"; callsign: string }
    | { type: "unsetEfsGoAround"; callsign: string }
    | { type: "rof"; callsign: string }
    /** Brittle ES .contactme — plugin SetASEL + HOME inject */
    | { type: "contactme"; callsign: string }
    | { type: "clearScratchpad"; callsign: string }
    | { type: "setScratch"; callsign: string; value: string }
    /** Set scratch then restore previous (TopSky tokens like /APPTYPE/CAT3/) */
    | { type: "setScratchTmp"; callsign: string; value: string }
    /** VCH hold short — strip annotation 4 (max 5 chars; empty clears) */
    | { type: "setHs"; callsign: string; value: string }
    /** Departure Coordination — strip annotation 6 ("DepC" or empty) */
    | { type: "setCoo"; callsign: string; coo: boolean }
    /** EuroScope COPX/XFL exit coordination — not clearance / DepC */
    | {
          type: "initiateCoordination"
          callsign: string
          altitude?: number
          point?: string
          targetController?: string
      }
    | { type: "acceptCoordination"; callsign: string }
    | { type: "refuseCoordination"; callsign: string }
    | { type: "setEobt"; callsign: string; eobt: string }
    | { type: "setTobt"; callsign: string; tobt: string; setBy?: "A" | "P" }
    | { type: "setAsrt"; callsign: string; asrt: string }
    | { type: "setTsac"; callsign: string; tsac: string }
    | { type: "setCtoc"; callsign: string; ctoc: string }
    | {
          type: "amendFlightPlan"
          callsign: string
          flightRules?: string
          aircraftType?: string
          wakeTurbulence?: string
          numberOfAircraft?: number
          equipment?: string
          surveillance?: string
          faaEquipment?: string
          origin?: string
          destination?: string
          alternate?: string
          alternate2?: string
          eobd?: string
          eobt?: string
          tas?: string
          rfl?: string | number
          eet?: string
          route?: string
          fplRemarks?: string
          supl?: string
          squawk?: string
          cfl?: string | number
      }

/**
 * Determine the callsign of the controller to hand a flight off to.
 * Based on my callsign role and the strip/flight context.
 */
function resolveXferTarget(strip: FlightStrip, flight: Flight | undefined): string | undefined {
    // Incoming TopSky ROF: always hand off to the requesting controller
    const rofFrom = flight ? flightStore.getPendingRofRequest(flight) : undefined
    if (rofFrom) return rofFrom

    // ESSA: sector / taxi-sequence next SI
    if (flight && isEssaRolesConfig(staticConfig)) {
        const essaTarget = resolveEssaXferCallsign(flight, strip, undefined)
        if (essaTarget) return essaTarget
    }

    const myRole = getActingControllerRole() ?? staticConfig.myRole ?? 'TWR'
    switch (myRole) {
        case 'DEL':
            return getControllerCallsign('GND') ?? getControllerCallsign('TWR')
        case 'GND':
            return getControllerCallsign('TWR')
        case 'TWR':
            if (flight && staticConfig.myAirports.some((a) => a.toUpperCase() === "ESGG")) {
                const online = staticConfig.onlineControllers?.values()
                const inUtflygning =
                    strip.sectionId === "ctr_dep" || strip.sectionId.endsWith("_ctr_dep")
                const arrLike =
                    strip.stripType === "arrival" || strip.stripType === "local"
                // Soft G/A or MISAP / ARR-local already in UTFLYGNING → MISAP APP
                // (appendix: 03→E, 21→W)
                if (flight.missedApproach || (inUtflygning && arrLike)) {
                    const arrRwy =
                        flight.arrRwy || staticConfig.activeRunways?.["ESGG"]?.arr?.[0]
                    const app = resolveEsggMisapApp(arrRwy, online)
                    if (app) return app.callsign
                } else if (strip.stripType === "departure") {
                    // DEP RNAV SID → APP-E/W (appendix p.4 / p.7)
                    const depRwy =
                        flight.depRwy || staticConfig.activeRunways?.["ESGG"]?.dep?.[0]
                    const app = resolveEsggDepApp(
                        depRwy,
                        flight.sid || strip.sid,
                        online,
                        "ESGG",
                        flight.route
                    )
                    if (app) return app.callsign
                }
            }
            if (flight?.missedApproach) return getControllerCallsign('APP')
            if (strip.stripType === 'arrival' || strip.stripType === 'local') return getControllerCallsign('GND')
            return getControllerCallsign('APP')
        case 'APP':
            return getControllerCallsign('CTR')
        default:
            return undefined
    }
}

function mapStripActionToPluginCommand(action: string, callsign: string): OutboundPluginCommand | null {
    switch (action) {
        case "CTL":
            return { type: "setClearedToLand", callsign }
        case "unsetCTL":
            return { type: "unsetClearedToLand", callsign }
        case "CTO":
            return { type: "setGroundState", callsign, state: "DEPA" }
        case "PUSH":
            return { type: "setGroundState", callsign, state: "PUSH" }
        case "LU":
            return { type: "setGroundState", callsign, state: "LINEUP" }
        case "TXO":
            return { type: "setGroundState", callsign, state: "TAXI" }
        case "TXI":
            return { type: "setGroundState", callsign, state: "TXIN" }
        case "RTO":
            // Rejected takeoff: undo CFTO → LINEUP; UI then offers TAXI OUT / TAXI IN
            return { type: "setGroundState", callsign, state: "LINEUP" }
        case "FRQ":
            return { type: "setGroundState", callsign, state: "ONFREQ" }
        case "STUP":
            return { type: "setGroundState", callsign, state: "STUP" }
        case "DEICE":
            return { type: "setGroundState", callsign, state: "DE-ICE" }
        case "ARR":
            return { type: "setGroundState", callsign, state: "ARR" }
        case "PARK":
            return { type: "setGroundState", callsign, state: "PARK" }
        case "NOGS":
            // Swedish clear token — plugin maps empty/NOSTATE → scratch NOSTATE
            return { type: "setGroundState", callsign, state: "NOSTATE" }
        case "XFER":
            return { type: "transfer", callsign }
        case "ASSUME":
            return { type: "assume", callsign }
        case "REFUSE":
            return { type: "refuse", callsign }
        case "toggleClearanceFlag":
            return { type: "toggleClearanceFlag", callsign }
        case "resetSquawk":
            return { type: "resetSquawk", callsign }
        case "GOA":
            return { type: "goaround", callsign }
        case "ROF":
            return { type: "rof", callsign }
        case "CONTACTME":
            return { type: "contactme", callsign }
        // WEATHER handled specially in stripAction (toggle + local weatherGiven)
        case "WEATHER":
            return null
        default:
            return null
    }
}

// ATIS polling service (declared early to avoid temporal dead zone in mock init)
let atisService: AtisService | null = null
/** Set after ATIS starts; declared early so mock init's startAtisService() can assign it. */
let getAtisHealth: () => FeedStatusItem = () => ({ ok: false, detail: "Not started" })

// Initialize store (with mock data if --mock flag is set)
if (cliArgs.mock) {
    // Apply mock myselfUpdate for callsign/frequency/runways.
    // Do not override airports when --airport was given (e.g. ESSA + mock traffic).
    setMyCallsign(cliArgs.callsign ?? mockMyselfUpdate.callsign)
    if (!cliArgs.airports?.length) {
        const mockAirports = Object.keys(mockMyselfUpdate.rwyconfig).filter((a) => getAirportByIcao(a))
        if (mockAirports.length > 0) {
            setMyAirports(mockAirports)
        }
    }
    setIsController(mockMyselfUpdate.controller)
    setMyFrequency(mockMyselfUpdate.frequency)
    setMyPositionId(mockMyselfUpdate.position ?? 'GG')

    // Extract active runways from mock rwyconfig
    if (mockMyselfUpdate.rwyconfig) {
        const activeRunways = extractActiveRunways(mockMyselfUpdate.rwyconfig as Record<string, Record<string, unknown>>)
        setActiveRunways(activeRunways)
    }

    // Set controller role from mock callsign (or CLI override)
    const mockRole = parseControllerRole(cliArgs.callsign ?? mockMyselfUpdate.callsign, staticConfig.myAirports)
    setMyRole(mockRole)
    console.log(
        `Mock data enabled (callsign: ${cliArgs.callsign ?? mockMyselfUpdate.callsign}, role: ${mockRole}, airports: ${staticConfig.myAirports.join(", ")})`,
    )

    // Start ATIS polling for mock mode
    startAtisService()
}
store.loadMockData(cliArgs.mock ?? false)

/** Must be declared before any startup path that may broadcast (realm / sync init). */
const wsClients = new Set<WebSocket>()

// Helper to send a message to a WebSocket client
function sendMessage(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message))
    }
}

// Broadcast a message to all connected clients except the sender
function broadcast(message: ServerMessage, exclude?: WebSocket) {
    wsClients.forEach((client) => {
        if (client !== exclude && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message))
        }
    })
}

/**
 * Map strip bayIds to the visible layout (ESSA CD ALL+TSAT merge / ESGG role remap).
 * Store may keep YAML bayIds; clients only see remapped layout bays.
 * Returns null when ESSA role/sequence filter hides the strip.
 */
function stripForClient(strip: FlightStrip): FlightStrip | null {
    if (isEssaRolesConfig(staticConfig)) {
        const roles = staticConfig.essaRoles ?? []
        if (roles.length > 0 && strip.stripType !== "note" && strip.stripType !== "vehicle") {
            const flight = flightStore.getFlight(strip.callsign)
            const next = flight
                ? resolveEssaNextSi(flight, strip, {
                      rofFrom: flightStore.getPendingRofRequest(flight),
                  })
                : undefined
            if (!isEssaStripVisibleForRoles(flight, strip, roles, next)) {
                return null
            }
        }

        const gndRemapped = remapStripsForEssaGndOnly(
            [strip],
            roles,
            staticConfig.sectionToBay,
        )
        const [remapped] = remapBayIdsToLayout(gndRemapped, store.getLayout())
        return remapped ?? strip
    }

    // ESGG paper: KLARERING may live on bay5 after covering remap — align bayId
    if (isEsggRolesConfig(staticConfig)) {
        const [remapped] = remapBayIdsToLayout([strip], store.getLayout())
        return remapped ?? strip
    }

    return strip
}

function gapForClient(gap: Gap): Gap {
    if (!isEssaRolesConfig(staticConfig)) return gap
    const [remapped] = remapBayIdsToLayout([gap], store.getLayout())
    return remapped ?? gap
}

// Broadcast a strip update (or delete when ESSA role filter hides it)
function broadcastStrip(
    strip: FlightStrip,
    options?: {
        exclude?: WebSocket
        autoMoved?: boolean
        cleanReprint?: boolean
        playPrintAnim?: boolean
    },
) {
    const clientStrip = stripForClient(strip)
    if (!clientStrip) {
        broadcastStripDelete(strip.id, options?.exclude)
        return
    }
    const message: StripMessage = { type: "strip", strip: clientStrip }
    if (options?.autoMoved) message.autoMoved = true
    if (options?.cleanReprint) message.cleanReprint = true
    if (options?.playPrintAnim) message.playPrintAnim = true
    broadcast(message, options?.exclude)
    // Full IRIS /order snapshot (transferred→APP omit stripKey)
    if (canPublishEssaStripview()) scheduleStripviewLayoutPush()
}

// Broadcast a strip delete
function broadcastStripDelete(stripId: string, exclude?: WebSocket) {
    const message: StripDeleteMessage = { type: "stripDelete", stripId }
    broadcast(message, exclude)
    if (canPublishEssaStripview()) scheduleStripviewLayoutPush()
}

/** Push current trash list so clients stay in sync across reconnect without opening the dialog. */
function broadcastDeletedStrips(exclude?: WebSocket) {
    const message: DeletedStripsMessage = {
        type: "deletedStrips",
        strips: store.getDeletedStripInfos(),
    }
    broadcast(message, exclude)
}

// Broadcast a gap update
function broadcastGap(gap: Gap, exclude?: WebSocket) {
    const message: GapMessage = { type: "gap", gap: gapForClient(gap) }
    broadcast(message, exclude)
}

// Broadcast a gap delete
function broadcastGapDelete(bayId: string, sectionId: string, index: number, exclude?: WebSocket) {
    let outBayId = bayId
    if (isEssaRolesConfig(staticConfig)) {
        const [remapped] = remapBayIdsToLayout([{ bayId, sectionId }], store.getLayout())
        if (remapped) outBayId = remapped.bayId
    }
    const message: GapDeleteMessage = { type: "gapDelete", bayId: outBayId, sectionId, index }
    broadcast(message, exclude)
}

// Broadcast a section update
function broadcastSection(bayId: string, section: Section, exclude?: WebSocket) {
    const message: SectionMessage = { type: "section", bayId, section }
    broadcast(message, exclude)
}

// Broadcast a refresh request to all clients
function broadcastRefresh(reason?: string) {
    const message: RefreshMessage = { type: "refresh", reason }
    broadcast(message)
    console.log(`Broadcast refresh to all clients: ${reason ?? "no reason"}`)
}

/** Last UDP from EuroScope plugin; myselfUpdate is ~every 5s while loaded */
let lastPluginUdpAt = 0
let pluginConnected = false
/** Version string pushed by the loaded plugin via myselfUpdate (not from disk). */
let reportedPluginVersion: string | undefined
const PLUGIN_STALE_MS = 15_000
let lastStatusFeedsFp = ""
/** Set after services are constructed (avoids TDZ in buildFeedsStatus). */
let getViffHealth: () => FeedStatusItem = () => ({ ok: false, detail: "Not started" })
let forceViffPoll: () => void = () => {}

function notePluginUdp() {
    lastPluginUdpAt = Date.now()
    if (!pluginConnected) {
        pluginConnected = true
        console.log("EuroScope plugin connected (UDP)")
        broadcastStatus()
    }
}

function setPluginDisconnected(reason: string) {
    if (!pluginConnected && !reportedPluginVersion) return
    pluginConnected = false
    reportedPluginVersion = undefined
    console.log(`EuroScope plugin disconnected: ${reason}`)
    broadcastStatus()
}

/** Set when DCL status vars exist (avoids TDZ in buildFeedsStatus). */
let getHoppieFeed: () => FeedStatusItem = () => ({ ok: false, detail: "Unavailable" })

function standsFeedStatus(): FeedStatusItem {
    const apts = airportsWithStands()
    if (apts.length === 0) return { ok: false, detail: "Not loaded" }
    return { ok: true, detail: `Loaded (${apts.length} airports)` }
}

/** UDP 17771 bind failure (dual ES / second VatEFS → WSAEADDRINUSE/10048). */
let udpInBound = false
let udpBindError: string | undefined
let udpRebindTimer: ReturnType<typeof setTimeout> | undefined

function pluginFeedStatus(): FeedStatusItem {
    if (udpBindError) {
        return { ok: false, detail: udpBindError }
    }
    if (cliArgs.mock || pluginConnected) {
        return { ok: true, detail: "Connected" }
    }
    return { ok: false, detail: "Not connected" }
}

function buildFeedsStatus(): FeedsStatus {
    const offline = isOfflineVatsimRealm()
    return {
        plugin: pluginFeedStatus(),
        hoppie: offline ? { ok: true, detail: "Off (sweatbox/local)" } : getHoppieFeed(),
        viff: offline ? { ok: true, detail: "Off (sweatbox/local)" } : getViffHealth(),
        atis: offline ? { ok: true, detail: "Off (sweatbox/local)" } : getAtisHealth(),
        afv: offline ? { ok: true, detail: "Off (sweatbox/local)" } : getAfvHealth(),
        irisSync: getIrisSyncHealth(),
        ctr: getCtrHealth(),
        euroscopeDir: localFeedState.euroscopeDir,
        hoppieConfig: localFeedState.hoppieConfig,
        cdmLocal: localFeedState.cdmLocal,
        stands: standsFeedStatus(),
        eseSid: getSidDataHealth(),
        eseAirspace: getEseAirspaceHealth(),
        topskyAirspace: getTopSkyAirspaceHealth(),
    }
}

function checkPluginStale() {
    if (cliArgs.mock) {
        if (!pluginConnected) {
            pluginConnected = true
            reportedPluginVersion = reportedPluginVersion || "mock"
            broadcastStatus()
        }
        maybeBroadcastStatusIfFeedsChanged()
        return
    }
    if (pluginConnected && Date.now() - lastPluginUdpAt > PLUGIN_STALE_MS) {
        setPluginDisconnected("UDP stale (plugin unloaded or ES idle)")
        return
    }
    maybeBroadcastStatusIfFeedsChanged()
}

/** Re-broadcast status when network feed health changes (ATIS/AFV/vIFF/etc.). */
function maybeBroadcastStatusIfFeedsChanged() {
    const fp = JSON.stringify({
        feeds: buildFeedsStatus(),
        pluginVersion: reportedPluginVersion,
        dcl: currentDclStatus,
    })
    if (fp === lastStatusFeedsFp) return
    lastStatusFeedsFp = fp
    broadcastStatus()
}

if (cliArgs.mock) {
    pluginConnected = true
    reportedPluginVersion = "mock"
}
setInterval(checkPluginStale, 2000)

// Send status (callsign + airports + role) to a client
function buildStatusMessage(): StatusMessage {
    const essaMode = isEssaRolesConfig(staticConfig)
    const esggMode = isEsggRolesConfig(staticConfig)
    const feeds = buildFeedsStatus()
    lastStatusFeedsFp = JSON.stringify({
        feeds,
        pluginVersion: reportedPluginVersion,
        dcl: currentDclStatus,
    })
    return {
        type: "status",
        callsign: staticConfig.myCallsign ?? "",
        airports: staticConfig.myAirports,
        role: staticConfig.myRole,
        positionId: staticConfig.myPositionId || undefined,
        pluginConnected: cliArgs.mock ? true : pluginConnected,
        feeds,
        backendVersion: constants.version,
        pluginVersion: reportedPluginVersion,
        frequency: staticConfig.myFrequency,
        isController: staticConfig.isController,
        multiAirport: isMultiAirportConfig(staticConfig) || undefined,
        activeAirports: staticConfig.activeAirports,
        esAirports: isMultiAirportConfig(staticConfig)
            ? esRwySelectAirports
            : (staticConfig.myAirports.length ? [...staticConfig.myAirports] : undefined),
        columnAirports: staticConfig.columnAirports,
        columnCount: staticConfig.columnCount,
        essaRolesMode: essaMode || undefined,
        essaRoles: essaMode ? (staticConfig.essaRoles ?? []) : undefined,
        essaRolesManual: essaMode ? !!staticConfig.essaRolesManual : undefined,
        esggRolesMode: esggMode || undefined,
        esggRoles: esggMode ? (staticConfig.esggRoles ?? []) : undefined,
        esggRolesManual: esggMode ? !!staticConfig.esggRolesManual : undefined,
        essaCoveredRunways: essaMode ? getMyEssaCoveredRunways() : undefined,
        look: staticConfig.look === 'paper' ? 'paper' : 'saab',
    }
}

let lastPendingPrintFp = ''

function broadcastPendingPrintList() {
    if (staticConfig.look !== 'paper' || currentUiSettings.stripPrintMode !== 'manual') {
        if (lastPendingPrintFp !== '[]') {
            lastPendingPrintFp = '[]'
            broadcast({ type: 'pendingPrintList', flights: [] })
        }
        return
    }
    const flights = flightStore.listPendingPrint()
    const fp = JSON.stringify(flights.map((f) => f.callsign).sort())
    if (fp === lastPendingPrintFp) return
    lastPendingPrintFp = fp
    broadcast({ type: 'pendingPrintList', flights })
}

function sendStatus(socket: WebSocket) {
    sendMessage(socket, buildStatusMessage())
}

// Broadcast status to all clients
function broadcastStatus() {
    broadcast(buildStatusMessage())
}

/**
 * Extract active runway identifiers per airport from rwyconfig.
 * Each rwyconfig entry like { "21": { arr: true, dep: true } } yields { arr: ["21"], dep: ["21"] }.
 */
function extractActiveRunways(rwyconfig: Record<string, Record<string, unknown>>): Record<string, { arr: string[]; dep: string[] }> {
    const result: Record<string, { arr: string[]; dep: string[] }> = {}
    for (const airport of Object.keys(rwyconfig)) {
        const arr: string[] = []
        const dep: string[] = []
        const airportData = rwyconfig[airport]
        for (const key of Object.keys(airportData)) {
            const val = airportData[key]
            if (typeof val === "object" && val !== null) {
                const rwy = val as { arr?: boolean; dep?: boolean }
                if (rwy.arr) arr.push(key)
                if (rwy.dep) dep.push(key)
            }
        }
        result[airport] = { arr, dep }
    }
    return result
}

/**
 * Build AirportAtisInfo array from AtisService cache + activeRunways.
 */
function buildAtisInfo(): AirportAtisInfo[] {
    const airports = staticConfig.myAirports
    const runways = staticConfig.activeRunways ?? {}
    const result: AirportAtisInfo[] = []

    for (const airport of airports) {
        const rwy = runways[airport] ?? { arr: [], dep: [] }
        if (airport === "ESSA") {
            const essa = atisService?.getEssaAtis() ?? {}
            result.push({
                airport,
                arrAtis: essa.arrLetter,
                depAtis: essa.depLetter,
                qnh: essa.qnh,
                arrRunways: rwy.arr,
                depRunways: rwy.dep,
            })
        } else {
            const atis = atisService?.getAtis(airport) ?? {}
            result.push({
                airport,
                atis: atis.letter,
                qnh: atis.qnh,
                arrRunways: rwy.arr,
                depRunways: rwy.dep,
            })
        }
    }
    return result
}

function sendAtisUpdate(socket: WebSocket) {
    const message: AtisUpdateMessage = { type: "atisUpdate", airports: buildAtisInfo() }
    sendMessage(socket, message)
}

function broadcastAtisUpdate() {
    const message: AtisUpdateMessage = { type: "atisUpdate", airports: buildAtisInfo() }
    broadcast(message)
    broadcastEssaSepIndicators()
}

/** TWR-managed SEP/DLV/DEP GAP overrides (synced; absent key = auto). */
let essaSepOverrides: EssaSepOverrides = {}

function canEditEssaSepIndicators(): boolean {
    if (!isEssaRolesConfig(staticConfig)) return false
    const roles = staticConfig.essaRoles ?? []
    return roles.some((r) => r === "TWR-E" || r === "TWR-W" || String(r).startsWith("TWR"))
}

/** TWR or GND may publish bay order + SEP snapshot for Strip TV / APP. */
function canPublishEssaStripview(): boolean {
    if (!isEssaRolesConfig(staticConfig)) return false
    const airports = (staticConfig.myAirports ?? []).map((a) => a.toUpperCase())
    if (!airports.includes("ESSA")) return false
    const roles = staticConfig.essaRoles ?? []
    return roles.some(
        (r) =>
            r === "TWR-E" ||
            r === "TWR-W" ||
            String(r).startsWith("TWR") ||
            String(r).startsWith("GND"),
    )
}

function isValidEssaSepOverride(field: EssaSepField, value: string): boolean {
    return (ESSA_SEP_CYCLE[field] as readonly (string | null)[]).some((v) => v === value)
}

/** Build ESSA SEP/DLV/DEP GAP message (roles mode + ESSA ops only). */
function buildEssaSepIndicatorsMessage(): EssaSepIndicatorsMessage | null {
    if (!isEssaRolesConfig(staticConfig)) return null
    const ops = getEssaOps()
    const arr = ops?.arr ?? []
    const dep = ops?.dep ?? []
    const sccMap = atisService?.getEssaScc() ?? new Map()
    const metar = atisService?.getMetarText("ESSA") ?? null
    const prefer = getAupR16Status().suggestConfigId
    const configId = resolveEssaRwyConfigId(arr, dep, new Date(), {
        preferConfigId: prefer,
    })
    const auto = computeEssaSepIndicators({
        configId,
        arrRunways: arr,
        depRunways: dep,
        sccByDesignator: sccMap,
        metar,
    })
    const ind = mergeEssaSepIndicators(auto, essaSepOverrides)
    const scc: Record<string, [number, number, number]> = {}
    for (const [k, v] of sccMap) scc[k] = v
    return { type: "essaSepIndicators", ...ind, scc, metar, overrides: { ...essaSepOverrides } }
}

function sendEssaSepIndicators(socket: WebSocket) {
    const message = buildEssaSepIndicatorsMessage()
    if (message) sendMessage(socket, message)
}

function broadcastEssaSepIndicators() {
    const message = buildEssaSepIndicatorsMessage()
    if (message) broadcast(message)
    // TWR → PUT …/meta { essaSep }; TWR/GND → PUT …/order
    if (message && canEditEssaSepIndicators()) {
        void pushEssaSepMetaToRemote({
            sep: message.sep,
            dlv: message.dlv,
            depGap: message.depGap,
        })
    }
    if (canPublishEssaStripview()) {
        scheduleStripviewLayoutPush()
    }
}

// Send config list to a single client
function sendConfigList(socket: WebSocket) {
    const message: ConfigListMessage = {
        type: "configList",
        configs: availableConfigs.map(c => ({ file: c.file, name: c.name })),
        activeConfig: activeConfigFile,
    }
    sendMessage(socket, message)
}

// Broadcast config list to all clients
function broadcastConfigList() {
    const message: ConfigListMessage = {
        type: "configList",
        configs: availableConfigs.map(c => ({ file: c.file, name: c.name })),
        activeConfig: activeConfigFile,
    }
    broadcast(message)
}

// Build sorted controllers list for transfer menu
function buildControllersList(): ControllerInfo[] {
    const onlineControllers = staticConfig.onlineControllers
    if (!onlineControllers) return []

    const myAirports = staticConfig.myAirports
    const myCallsign = staticConfig.myCallsign

    // Collect controllers, excluding myself
    const controllers: ControllerInfo[] = []
    for (const ctrl of onlineControllers.values()) {
        if (ctrl.callsign === myCallsign) continue
        controllers.push({
            callsign: ctrl.callsign,
            frequency: ctrl.frequency.toFixed(3),
            positionId: ctrl.positionId || undefined,
        })
    }

    // Sort: my airports first, then alphabetically
    controllers.sort((a, b) => {
        const aMatchesAirport = myAirports.some(apt => a.callsign.toUpperCase().startsWith(apt))
        const bMatchesAirport = myAirports.some(apt => b.callsign.toUpperCase().startsWith(apt))
        if (aMatchesAirport && !bMatchesAirport) return -1
        if (!aMatchesAirport && bMatchesAirport) return 1
        return a.callsign.localeCompare(b.callsign)
    })

    return controllers
}

// Send controllers list to a single client
function sendControllers(socket: WebSocket) {
    const message: ControllersMessage = {
        type: "controllers",
        controllers: buildControllersList()
    }
    sendMessage(socket, message)
}

// Broadcast controllers list to all clients
function broadcastControllers() {
    const message: ControllersMessage = {
        type: "controllers",
        controllers: buildControllersList()
    }
    broadcast(message)
}

/**
 * Switch to a different configuration file.
 * Reloads config, clears the store, re-applies section rules to existing flights,
 * and broadcasts the new layout + refreshed strips to all clients.
 */
function switchConfig(file: string, opts?: { manual?: boolean }) {
    const configInfo = availableConfigs.find(c => c.file === file)
    if (!configInfo) {
        console.error(`Config file not found: ${file}`)
        return
    }

    if (opts?.manual) {
        configManuallySelected = true
        configAutoSelectPending = false
    }

    console.log(`Switching config to: ${configInfo.name} (${file})`)

    try {
        const config = loadConfig(configInfo.fullPath)
        applyConfig(config)
        activeConfigFile = file
        saveUserSettings({ activeConfig: file })

        if (isEssaRolesConfig(staticConfig)) {
            const saved = loadUserSettings()
            const roles = normalizeEssaRoles(saved.essaRoles)
            restoreEssaRolesFromSettings(roles, saved.essaRolesManual)
        }
        if (isEsggRolesConfig(staticConfig)) {
            restoreEsggRolesFromSettings(undefined, false)
            saveUserSettings({ esggRoles: [], esggRolesManual: false })
        }

        // Sync store layout with (possibly rebuilt) multi-airport layout
        store.reprocessAllFlights()

        broadcastConfigList()
        broadcastStatus()
        broadcastEssaSepIndicators()
        broadcastRefresh(`Config switched to ${configInfo.name}`)
    } catch (err) {
        console.error(`Failed to switch config: ${err instanceof Error ? err.message : err}`)
    }
}

/**
 * First primed myselfUpdate → pick ESSA / ESGG / RTC once.
 * RTC only when self or online controllers are ESSR_*; otherwise ESSA/ESGG from rwyconfig.
 * No-op after manual switchConfig or when `--config` was used.
 * May leave a restored RTC layout if the session is not ESSR.
 */
function maybeAutoSelectConfigFromAirports(
    airports: string[],
    frequency: number | undefined,
    callsign?: string | null,
): void {
    if (!configAutoSelectPending || configManuallySelected || cliArgs.config) {
        configAutoSelectPending = false
        return
    }
    if (!isPrimedFrequency(frequency)) return
    // ESSR RTC needs callsign/online list; ESSA/ESGG need discovered airports
    const essr = isEssrRtcSession(callsign)
    if (!essr && airports.length === 0) return

    const file = configFileForDiscoveredAirports(airports, callsign)
    if (!file) return
    if (!availableConfigs.some((c) => c.file === file)) {
        console.warn(`[CONFIG] Auto-select skipped — ${file} not in config directory`)
        configAutoSelectPending = false
        return
    }

    configAutoSelectPending = false
    if (activeConfigFile === file) {
        console.log(`[CONFIG] Auto-select OK — already on ${file}`)
        return
    }
    const reason = essr
        ? "ESSR position online / logged in"
        : `airports [${airports.join(", ")}]`
    console.log(
        `[CONFIG] Auto-select ${file} (${reason}, primed ${frequency!.toFixed(3)})`,
    )
    switchConfig(file)
}

/** Airports currently ARR/DEP in EuroScope rwyselect (RTC relevance) */
let esRwySelectAirports: string[] = []

/** After connectionType 0, request a plugin refresh on the next myselfUpdate */
let pendingPluginRefreshAfterReconnect = false

/** First myselfUpdate after backend boot — request a full ES FP/CDM dump (empty store) */
let pendingColdPluginRefresh = true

/**
 * Drop user-picked airports that are no longer relevant:
 * not in ES rwyselect, not assigned to a column, and no strips.
 */
function pruneOrphanUserAirports(): boolean {
    if (!isMultiAirportConfig(staticConfig)) return false
    const es = new Set(esRwySelectAirports)
    const inColumn = new Set(
        (staticConfig.columnAirports ?? []).filter((a): a is string => !!a),
    )
    const withStrips = new Set<string>()
    for (const strip of store.getAllStrips()) {
        if (strip.airport) withStrips.add(strip.airport)
    }
    const active = staticConfig.activeAirports ?? []
    const next = active.filter(a => es.has(a) || inColumn.has(a) || withStrips.has(a))
    if (next.length === active.length) return false
    const removed = active.filter(a => !next.includes(a))
    setActiveAirports(next)
    console.log(`[MULTI] Pruned inactive airports: ${removed.join(", ")}`)
    return true
}

/**
 * Persist multi-airport column/active settings and push layout + remapped strips to clients.
 */
function applyMultiAirportViewChange(opts?: { reprocess?: boolean }) {
    saveUserSettings({
        activeAirports: staticConfig.activeAirports,
        columnAirports: staticConfig.columnAirports,
        columnCount: staticConfig.columnCount,
    })

    store.syncLayoutFromConfig()

    if (opts?.reprocess) {
        store.reprocessAllFlights()
        broadcastStatus()
        broadcastRefresh("Multi-airport active set changed")
        startAtisService()
        return
    }

    const remapped = flightStore.remapMultiAirportPlacements()
    for (const strip of remapped) {
        store.updateStripFromFlight(strip)
        broadcastStrip(strip)
    }

    broadcastStatus()
    broadcastLayout()
    startAtisService()
}

/**
 * Start (or restart) the ATIS service for the current airports.
 */
function startAtisService() {
    if (atisService) {
        atisService.stop()
        atisService = null
    }
    if (isOfflineVatsimRealm()) {
        getAtisHealth = () => ({ ok: true, detail: "Off (sweatbox/local)" })
        return
    }
    if (staticConfig.myAirports.length === 0) return

    atisService = new AtisService({
        onUpdate: () => broadcastAtisUpdate(),
    })
    getAtisHealth = () => atisService?.getHealth() ?? { ok: false, detail: "Not started" }
    atisService.start(staticConfig.myAirports)
    console.log(`ATIS polling started for: ${staticConfig.myAirports.join(", ")}`)
    ensureAupR16Service()
}

/** Current ESSA ARR/DEP runways from EuroScope rwyconfig (null when unknown). */
function getEssaOps(): { arr: string[]; dep: string[] } | null {
    const essa = staticConfig.activeRunways?.["ESSA"]
    if (!essa) return null
    return { arr: essa.arr ?? [], dep: essa.dep ?? [] }
}

/**
 * AUP R16 ("R16 utökad") polling — only when ESSA is a configured airport.
 * Broadcasts `aupR16` on change; never switches RWY config itself (see backend/src/aup/service.ts).
 */
function ensureAupR16Service() {
    if (!staticConfig.myAirports.includes("ESSA")) return
    startAupR16Service({
        getEssaOps,
        onChange: (status: AupR16Status) => broadcast({ type: "aupR16", ...status }),
    })
}

// Hoppie DCL service state
let hoppieService: HoppieService | null = null
let currentDclStatus: DclStatus = "unavailable"
let currentDclError: string | undefined
let currentDclMode: import("@vatefs/common").DclMode = loadUserSettings().dclMode ?? "manual"

getHoppieFeed = () => {
    switch (currentDclStatus) {
        case "connected":
            return { ok: true, detail: "Connected" }
        case "available":
            return { ok: true, detail: "Available" }
        case "error":
            return { ok: false, detail: currentDclError || "Error" }
        case "unavailable":
        default:
            return { ok: false, detail: "Unavailable" }
    }
}

/**
 * Determine the DCL callsign based on configured airports.
 * Returns the airport ICAO if exactly one DCL-capable airport is active, null otherwise.
 * In mock mode, returns "VATEFSTEST".
 */
function getDclCallsign(): string | null {
    if (cliArgs.mock) return "VATEFSTEST"

    const dclAirports = getDclAirports()
    const myDclAirports = staticConfig.myAirports.filter((a) => dclAirports.includes(a))

    if (myDclAirports.length === 1) return myDclAirports[0]
    return null
}

function updateDclStatus(status: DclStatus, error?: string) {
    currentDclStatus = status
    currentDclError = error
    const message: DclStatusMessage = { type: "dclStatus", status, error, dclMode: currentDclMode }
    broadcast(message)
}

function sendDclStatus(socket: WebSocket) {
    const message: DclStatusMessage = { type: "dclStatus", status: currentDclStatus, error: currentDclError, dclMode: currentDclMode }
    sendMessage(socket, message)
}

function sendUserSettings(socket: WebSocket) {
    const message: UserSettingsMessage = {
        type: "userSettings",
        settings: { ...currentUiSettings },
        autoParkAvailable: isAutoParkAvailable(),
    }
    sendMessage(socket, message)
}

function broadcastUserSettings() {
    const message: UserSettingsMessage = {
        type: "userSettings",
        settings: { ...currentUiSettings },
        autoParkAvailable: isAutoParkAvailable(),
    }
    broadcast(message)
}

/**
 * Recalculate DCL availability. Called when airports change.
 * If no service is active, set status to available/unavailable based on config
 * and Hoppie network status.
 */
function recalculateDclAvailability() {
    if (isOfflineVatsimRealm()) {
        if (hoppieService) {
            hoppieService.logout()
            hoppieService = null
        }
        updateDclStatus("unavailable")
        return
    }
    if (hoppieService) return // Don't change while connected

    const logonCode = getLogonCode()
    const callsign = getDclCallsign()

    if (!logonCode || !callsign) {
        updateDclStatus("unavailable")
        return
    }

    // Check Hoppie network status asynchronously
    checkHoppieStatus().then((online) => {
        // Re-check in case state changed while we were fetching
        if (hoppieService) return

        if (online) {
            updateDclStatus("available")
        } else {
            updateDclStatus("unavailable")
        }
    })
}

/**
 * Format current UTC time and date for CPDLC messages.
 * Returns { time: 'HHmm', date: 'DDMMYY' }
 */
function formatTimestamp(): { time: string; date: string } {
    const now = new Date()
    const hh = String(now.getUTCHours()).padStart(2, "0")
    const mm = String(now.getUTCMinutes()).padStart(2, "0")
    const dd = String(now.getUTCDate()).padStart(2, "0")
    const mo = String(now.getUTCMonth() + 1).padStart(2, "0")
    const yy = String(now.getUTCFullYear()).slice(-2)
    return { time: `${hh}${mm}`, date: `${dd}${mo}${yy}` }
}

/**
 * Build DCL template data from a flight for template filling.
 */
function buildDclTemplateData(flight: Flight, remarks: string): DclTemplateData {
    const freq = staticConfig.myFrequency
    const freqStr = freq ? freq.toFixed(3) : "---"

    // Format CFL for DCL template
    // At or below transition altitude (5000 ft): "5000 FT"
    // Above transition altitude: "FL90"
    const TRANSITION_ALTITUDE = 5000
    let cflStr = "---"
    if (flight.cfl && flight.cfl > 2) {
        if (flight.cfl <= TRANSITION_ALTITUDE) {
            cflStr = `${flight.cfl} FT`
        } else {
            cflStr = `FL${Math.round(flight.cfl / 100)}`
        }
    }

    // Get real ATIS data for the departure airport
    let atisStr = "NA"
    let qnhStr = "NA"
    if (flight.origin && atisService) {
        if (flight.origin === "ESSA") {
            const essa = atisService.getEssaAtis()
            if (essa.depLetter) atisStr = essa.depLetter
            if (essa.qnh) qnhStr = String(essa.qnh)
        } else {
            const atis = atisService.getAtis(flight.origin)
            if (atis.letter) atisStr = atis.letter
            if (atis.qnh) qnhStr = String(atis.qnh)
        }
    }

    return {
        callsign: flight.callsign,
        ades: flight.destination ?? "????",
        drwy: flight.depRwy ?? "---",
        sid: flight.sid ?? "---",
        assr: flight.squawk ?? "----",
        eobt: flight.eobt ?? "----",
        cfl: cflStr,
        freq_own: freqStr,
        freq_next: freqStr, // Same frequency for now
        atis: atisStr,
        qnh: qnhStr,
        rmk: remarks,
        ctot: flight.ctot || undefined,
        tsat: flight.tsat || undefined,
    }
}

/**
 * Check whether a flight has all required fields for an automatic DCL send.
 * Returns true if SID is valid, CFL is set, and squawk is assigned.
 */
function canAutoSendDcl(flight: Flight): boolean {
    // SID must be assigned and look like a standard SID (letters/digits, no special chars like · or spaces)
    const sidValid = !!flight.sid && /^[A-Z0-9]+$/.test(flight.sid)
    const cflValid = !!flight.cfl && flight.cfl > 2
    const squawkValid = !!flight.squawk && flight.squawk !== "0000"
    return sidValid && cflValid && squawkValid
}

/** Pending preferred-SID-after-RWY timers — cancelled when AHD/VECT starts */
const preferredSidAfterDepRwyTimers = new Map<string, ReturnType<typeof setTimeout>>()

function cancelPreferredSidAfterDepRwy(stripId: string) {
    const t = preferredSidAfterDepRwyTimers.get(stripId)
    if (t) {
        clearTimeout(t)
        preferredSidAfterDepRwyTimers.delete(stripId)
    }
}

function isVectorDeparture(flight: Flight, strip?: FlightStrip): boolean {
    if ((flight.ahdg ?? 0) > 0) return true
    if (strip?.assignedHeading) return true
    if (hasVectRemark(flight.remarks)) return true
    if (strip && hasVectRemark(strip.remarks)) return true
    return false
}

/**
 * After a manual DEP RWY assign (ADEP/rwy at FPL start), pick preferred SID for the new runway
 * and amend FPL once the runway command has been processed by the plugin.
 * Skipped for vector (AHD/VECT) departures.
 */
function schedulePreferredSidAfterDepRwy(strip: FlightStrip, flight: Flight, runway: string) {
    if (strip.clearance || !strip.canEditClearance) return
    // Vector departure: never auto-force preferred SID into FPL
    if (isVectorDeparture(flight, strip)) return
    // V / Z: no preferred SID / SLOW SID auto-assign
    if (!isIfrSidEligible(strip.flightRules)) return
    if (strip.stripType !== "departure" && strip.stripType !== "local") return

    const airport = (flight.origin || strip.adep || "").toUpperCase()
    if (airport !== "ESSA" && airport !== "ESMS" && airport !== "ESGG") return

    // Route for exit matching: drop leading SID/rwy or ADEP/rwy (about to be rewritten)
    const tokens = (flight.route || strip.route || "").trim().split(/\s+/).filter(Boolean)
    if (tokens[0]?.includes("/")) tokens.shift()
    const routeForPref = tokens.join(" ")

    const slow =
        !!strip.isSlow ||
        hasSlowRemark(flight.remarks) ||
        isSlowAircraft(flight.wakeTurbulence ?? "", flight.aircraftType ?? "", flight.engineType)

    let preferred: string | null = null
    if (airport === "ESMS") {
        const ekch30 = isEkchRwy30Active(staticConfig.activeRunways)
        preferred = resolveEsmsPreferredSid({ runway, route: routeForPref, ekch30 }).sid
    } else if (airport === "ESGG") {
        preferred = resolveEsggPreferredSid({
            runway,
            route: routeForPref,
            engineType: flight.engineType,
        }).sid
    } else {
        const essa = staticConfig.activeRunways?.["ESSA"]
        const configId = resolveEssaRwyConfigId(essa?.arr ?? [], essa?.dep ?? [])
        if (!configId) return
        preferred = resolvePreferredSid({
            airport,
            runway,
            configId,
            route: routeForPref,
            slow,
        }).sid
    }
    if (!preferred) {
        console.log(`[ASSIGN] No preferred SID for ${strip.callsign} after DEP RWY ${runway}`)
        return
    }

    const callsign = strip.callsign
    const stripId = strip.id
    const sid = preferred
    console.log(`[ASSIGN] Preferred SID ${sid} after DEP RWY ${runway} for ${callsign}`)

    cancelPreferredSidAfterDepRwy(stripId)
    const timer = setTimeout(() => {
        preferredSidAfterDepRwyTimers.delete(stripId)
        const liveStrip = store.getStrip(stripId)
        if (!liveStrip || liveStrip.clearance || !liveStrip.canEditClearance) return
        const f = flightStore.getFlight(callsign)
        if (!f) return
        // AHD/VECT may have been set after schedule — do not overwrite with preferred SID
        if (isVectorDeparture(f, liveStrip)) {
            console.log(`[ASSIGN] Skip preferred SID for ${callsign} — vector departure (AHD/VECT)`)
            return
        }

        f.depRwy = runway
        const esSid = f.sid
        const needForce = !sidsMatch(esSid, sid)
        if (needForce) {
            f.sidDisplayOverride = sid
            f.sid = sid
            sendUdp(JSON.stringify({ type: "assignSid", callsign, sid } satisfies OutboundPluginCommand))
            console.log(`[ASSIGN] Force SID ${sid} (ES had ${esSid || "(none)"}) for ${callsign}`)
        } else {
            f.sidDisplayOverride = undefined
            console.log(`[ASSIGN] ES SID ${esSid} already matches preferred — not forcing FPL`)
        }

        const sidAlt = resolveSidAltitude(airport, sid, slow || isTrackSidName(sid))
        if (sidAlt !== undefined && (!f.cfl || f.cfl <= 2)) {
            sendUdp(JSON.stringify({ type: "assignCfl", callsign, altitude: sidAlt } satisfies OutboundPluginCommand))
            f.cfl = sidAlt
            console.log(`[ASSIGN] Auto-CFL ${sidAlt} for SID ${sid} at ${airport}`)
        }

        if (needForce && isTrackSidName(sid) && isIfrSidEligible(liveStrip.flightRules)) {
            if (!hasSlowRemark(f.remarks)) {
                f.remarks = withSlowRemark(f.remarks, true) || undefined
                console.log(`[REMARKS] ${callsign}: set SLOW (track SID ${sid})`)
            }
            flightStore.markSlowRemarkManual(f)
            flightStore.holdScratchFields(f, 3000)
            const scratchValue = buildCombinedScratch(f.remarks, f.hp)
            sendUdp(JSON.stringify({ type: "setScratch", callsign, value: scratchValue } satisfies OutboundPluginCommand))
        }

        const updatedStrip = flightStore.regenerateStrip(callsign)
        if (updatedStrip) {
            store.updateStripFromFlight(updatedStrip)
            broadcastStrip(updatedStrip)
        }
    }, 300)
    preferredSidAfterDepRwyTimers.set(stripId, timer)
}

/**
 * Resolve preferred SID for ESSA/ESMS/ESGG (config / LOA / LOP), else undefined.
 */
function resolvePreferredSidForFlight(flight: Flight): string | undefined {
    const airport = (flight.origin || "").toUpperCase()
    const runway = flight.depRwy
    if (!airport || !runway) return undefined
    if (airport !== "ESSA" && airport !== "ESMS" && airport !== "ESGG") return undefined

    const tokens = (flight.route || "").trim().split(/\s+/).filter(Boolean)
    if (tokens[0]?.includes("/")) tokens.shift()
    const routeForPref = tokens.join(" ")
    const slow =
        isSlowAircraft(flight.wakeTurbulence ?? "", flight.aircraftType ?? "", flight.engineType) ||
        hasSlowRemark(flight.remarks) ||
        isTrackSidName(flight.sid)

    if (airport === "ESMS") {
        const ekch30 = isEkchRwy30Active(staticConfig.activeRunways)
        return resolveEsmsPreferredSid({ runway, route: routeForPref, ekch30 }).sid ?? undefined
    }
    if (airport === "ESGG") {
        return (
            resolveEsggPreferredSid({
                runway,
                route: routeForPref,
                engineType: flight.engineType,
            }).sid ?? undefined
        )
    }

    const essa = staticConfig.activeRunways?.["ESSA"]
    const configId = resolveEssaRwyConfigId(essa?.arr ?? [], essa?.dep ?? [])
    if (!configId) return undefined
    return (
        resolvePreferredSid({
            airport,
            runway,
            configId,
            route: routeForPref,
            slow,
        }).sid ?? undefined
    )
}

/**
 * ESE SID matching first significant route fix (any airport with SID data).
 * Used when clearing DCT at e.g. ESNU where there is no preferred-SID table.
 */
function resolveEseSidForFlight(flight: Flight): string | undefined {
    const airport = (flight.origin || "").toUpperCase()
    const runway =
        flight.depRwy ||
        (() => {
            const first = (flight.route || "").trim().split(/\s+/)[0] || ""
            const slash = first.indexOf("/")
            if (slash > 0 && /^[A-Z]{4}$/i.test(first.slice(0, slash))) {
                return first.slice(slash + 1).toUpperCase()
            }
            return undefined
        })()
    if (!airport || !runway) return undefined
    const tokens = (flight.route || "").trim().split(/\s+/).filter(Boolean)
    // Skip ADEP/rwy and ICAO speed/level groups for exit
    let exit: string | undefined
    for (const raw of tokens) {
        const u = raw.toUpperCase()
        if (!u || u === "DCT") continue
        if (u.includes("/")) continue
        if (/^\d{1,2}[LRC]?$/i.test(u)) continue
        if (/^[NKM]\d{3,4}[FASM]\d{3,4}$/i.test(u)) continue
        if (/^[A-Z]{2,3}$/.test(u) || /^[A-Z]{5}$/.test(u)) {
            exit = u
            break
        }
    }
    return pickEseSidForRouteExit(airport, runway, exit)
}

/** Pending TopSky ROF → EFS-native fallback timers (callsign → timeout). */
const topSkyRofFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>()
const TOPSKY_ROF_TIMEOUT_MS = 3500

function clearTopSkyRofFallback(callsign: string) {
    const key = callsign.toUpperCase()
    const t = topSkyRofFallbackTimers.get(key)
    if (t) {
        clearTimeout(t)
        topSkyRofFallbackTimers.delete(key)
    }
}

/**
 * ESGG paper: CTL / CTL-L on a pending APP→TWR (or CTR→TWR) inbound ARR/local
 * → ASSUME ownership so section rules place the strip on PÅ BANAN.
 * Returns true when assume was applied.
 */
function assumePendingAppInboundOnCtl(strip: {
    callsign: string
    stripType?: string
    transferPending?: string
    ownerCallsign?: string
}, flight: Flight): boolean {
    if (staticConfig.look !== "paper") return false
    if (strip.transferPending !== "in") return false
    if (strip.stripType !== "arrival" && strip.stripType !== "local") return false
    const ownerCs = (flight.controller || strip.ownerCallsign || "").trim()
    if (!ownerCs) return false
    const role = parseControllerRole(ownerCs, staticConfig.myAirports)
    if (role !== "APP" && role !== "CTR") return false

    sendUdp(
        JSON.stringify({
            type: "assume",
            callsign: strip.callsign,
        } satisfies OutboundPluginCommand),
    )
    flight.controller = staticConfig.myCallsign
    flight.controllerId = staticConfig.myPositionId
    flight.handoffTargetController = ""
    flight.handoffTargetControllerId = undefined
    flight.handoffOptimisticUntil = undefined
    flight.ownershipOptimisticUntil = Date.now() + 5000
    flightStore.clearAppTransferPinned(strip.callsign)
    console.log(
        `[ACTION] CTL ${strip.callsign}: ASSUME ${role} inbound → PÅ BANAN`,
    )
    return true
}

/**
 * ESGG paper CD/DEL: assume an unowned DEP/local when entering KLARERING
 * (CLR read / CLR correct / drag to cleared). Never called on undo — no RELEASE.
 */
function assumeCdDelKlareringDep(
    flight: Flight,
    stripType: string | undefined,
    reason: string,
): boolean {
    if (staticConfig.look !== "paper") return false
    if (!isCdOrDelRole()) return false
    if (stripType !== "departure" && stripType !== "local") return false

    const myCs = (staticConfig.myCallsign || "").toUpperCase()
    const mySi = (staticConfig.myPositionId || "").toUpperCase()
    const ownerCs = (flight.controller || "").toUpperCase()
    const ownerSi = (flight.controllerId || "").toUpperCase()
    // Already assumed by me
    if (myCs && ownerCs === myCs) return false
    if (mySi && ownerSi && ownerSi === mySi) return false
    // Someone else owns — do not steal
    if (ownerCs || ownerSi) return false

    sendUdp(
        JSON.stringify({
            type: "assume",
            callsign: flight.callsign,
        } satisfies OutboundPluginCommand),
    )
    flight.controller = staticConfig.myCallsign
    flight.controllerId = staticConfig.myPositionId
    flight.handoffTargetController = ""
    flight.handoffTargetControllerId = undefined
    flight.handoffOptimisticUntil = undefined
    flight.ownershipOptimisticUntil = Date.now() + 5000
    console.log(`[KLARERING] ${flight.callsign}: ASSUME (CD/DEL, ${reason})`)
    maybeAutoPrepOnAssume(flight.callsign)
    return true
}

/**
 * EFS-native ROF: mark pending request on the shared strip so the owner sees
 * pink ROF / ASSUME without TopSky scratch coordination.
 */
function applyEfsNativeRof(callsign: string, reason?: string) {
    const key = callsign.toUpperCase()
    const flight = flightStore.getFlight(key)
    const me = (staticConfig.myCallsign || "").trim().toUpperCase()
    if (!flight || !me) {
        flightStore.clearRofCooldown(key)
        reevaluateAndBroadcast(key)
        const notify: NotifyMessage = {
            type: "notify",
            level: "error",
            text: `ROF failed for ${key}${reason ? `: ${reason}` : ""}`,
        }
        broadcast(notify)
        return
    }
    flightStore.setRofRequest(flight, me)
    // Keep outbound pink flash on requester side
    flightStore.startRofCooldown(key, () => reevaluateAndBroadcast(key))
    reevaluateAndBroadcast(key)
    const notify: NotifyMessage = {
        type: "notify",
        level: "info",
        text: `ROF (EFS) for ${key}${reason ? ` — TopSky: ${reason}` : ""}`,
    }
    broadcast(notify)
    console.log(`[ROF] EFS-native request from ${me} for ${key}`)
}

function scheduleTopSkyRofFallback(callsign: string) {
    const key = callsign.toUpperCase()
    clearTopSkyRofFallback(key)
    const t = setTimeout(() => {
        topSkyRofFallbackTimers.delete(key)
        console.log(`[ROF] TopSky timeout for ${key} — EFS-native fallback`)
        applyEfsNativeRof(key, "no response")
    }, TOPSKY_ROF_TIMEOUT_MS)
    topSkyRofFallbackTimers.set(key, t)
}

/**
 * ESSA heavy take-off RWY (A388/A124/… → 01L/19R) — part of auto-LOP / clearance prep.
 * Runs before LOP DCT and preferred SID so SID/CFL follow the corrected DEP RWY.
 */
function applyEssaHeavyPreferredDepRwyIfNeeded(flight: Flight, logTag: string): boolean {
    if (!isIfrSidEligible(flight.flightRules)) return false
    const essa = staticConfig.activeRunways?.["ESSA"]
    const prefer = resolveEssaHeavyPreferredDepRwy({
        adep: flight.origin,
        aircraftType: flight.aircraftType,
        activeArr: essa?.arr,
        activeDep: essa?.dep,
        currentDepRwy: flight.depRwy,
    })
    if (!prefer) return false

    flight.depRwy = prefer
    sendUdp(
        JSON.stringify({
            type: "assignDepartureRunway",
            callsign: flight.callsign,
            runway: prefer,
        } satisfies OutboundPluginCommand),
    )
    console.log(
        `[${logTag}] ESSA heavy DEP ${prefer} for ${flight.callsign} (${flight.aircraftType})`,
    )
    return true
}

/**
 * LOP airport-specific auto DCT (ESMT/ESTA MIKNA·BEDOS, ESMK BEDOS, …).
 * Same cleanup as assignDirect set — clears SID/AHD; does not invent VECT.
 */
function applyLopAutoDirectIfNeeded(flight: Flight, logTag: string): boolean {
    if ((flight.direct || "").trim()) return false
    if ((flight.ahdg || 0) > 0 || hasVectRemark(flight.remarks)) return false
    if (!isIfrSidEligible(flight.flightRules)) return false

    const sug = resolveLopAutoDirect({
        adep: flight.origin || "",
        ades: flight.destination,
        route: flight.route,
        rflFeet: parseRflToFeet(flight.rfl),
        runway: flight.depRwy,
        isProp: isPropellerEngine(flight.engineType),
    })
    if (!sug || sug.mode !== "auto") return false

    const point = sug.point
    flight.direct = point
    flight.sidDisplayOverride = undefined
    flight.sid = undefined
    flight.ahdg = 0

    sendUdp(
        JSON.stringify({
            type: "assignHeading",
            callsign: flight.callsign,
            heading: 0,
        } satisfies OutboundPluginCommand),
    )

    const route = flight.route || ""
    if (hasForcedSidInRoute(route)) {
        const tokens = route.trim().split(/\s+/).filter(Boolean)
        tokens.shift()
        flight.route = tokens.join(" ")
        sendUdp(
            JSON.stringify({
                type: "assignDepartureRunway",
                callsign: flight.callsign,
                runway: "",
            } satisfies OutboundPluginCommand),
        )
        sendUdp(
            JSON.stringify({
                type: "assignSid",
                callsign: flight.callsign,
                sid: "",
            } satisfies OutboundPluginCommand),
        )
    }

    sendUdp(
        JSON.stringify({
            type: "assignDirect",
            callsign: flight.callsign,
            point,
        } satisfies OutboundPluginCommand),
    )
    console.log(`[${logTag}] LOP auto DCT ${point} for ${flight.callsign} (${sug.reason})`)
    return true
}

/**
 * Attempt to automatically assign preferred SID, CFL and squawk (DCL AUTO / new-dep setting).
 * Replicates the clearance dialog's applyPreferredSid + applyDefaultCfl + applyDefaultSquawk.
 *
 * Squawk allocate is gated on controllerAssignedSeen so reload/refresh cannot fire
 * TopSky AllocateSSR while ASSR is still unknown (FPD+radar often precede CAD).
 */
function autoAssignCflAndSquawk(flight: Flight, logTag = "DCL AUTO"): { deferredSquawk?: boolean } {
    // ESSA heavy DEP RWY (01L/19R) then airport LOP DCT, then SID force
    applyEssaHeavyPreferredDepRwyIfNeeded(flight, logTag)
    const lopDct = applyLopAutoDirectIfNeeded(flight, logTag)

    const slow =
        isSlowAircraft(flight.wakeTurbulence ?? "", flight.aircraftType ?? "", flight.engineType) ||
        hasSlowRemark(flight.remarks) ||
        isTrackSidName(flight.sid)
    const preferred = lopDct ? undefined : resolvePreferredSidForFlight(flight)

    // Force SID only when ES already has a GetSid/ESE designator that mismatches preferred.
    // Empty SID → leave for ESE prio; do not invent an assignSid.
    if (
        preferred &&
        !!flight.sid &&
        !sidsMatch(flight.sid, preferred) &&
        !isVectorDeparture(flight) &&
        !hasForcedSidInRoute(flight.route) &&
        !isTrackSidName(flight.sid) &&
        !/^VFR/i.test(flight.sid)
    ) {
        flight.sidDisplayOverride = preferred
        flight.sid = preferred
        sendUdp(
            JSON.stringify({
                type: "assignSid",
                callsign: flight.callsign,
                sid: preferred,
            } satisfies OutboundPluginCommand),
        )
        console.log(
            `[${logTag}] Force SID ${preferred} for ${flight.callsign} (ESE/GetSid mismatched)`,
        )
    }

    // After optional force, prefer live SID; else preferred for CFL when GetSid empty
    const sidForCfl = flight.sid || preferred

    // Auto-assign CFL from SID altitude if not already set
    if (sidForCfl && flight.origin && (!flight.cfl || flight.cfl <= 2)) {
        const sidAlt = resolveSidAltitude(
            flight.origin,
            sidForCfl,
            slow || isTrackSidName(sidForCfl),
        )
        if (sidAlt !== undefined) {
            sendUdp(JSON.stringify({ type: "assignCfl", callsign: flight.callsign, altitude: sidAlt }))
            console.log(`[${logTag}] Auto-assigned CFL ${sidAlt} for ${flight.callsign} (SID ${sidForCfl})`)
            if (cliArgs.mock) {
                flight.cfl = sidAlt
            }
        }
    }

    // Never invent a code (not even in --mock). Never re-allocate when ASSR already known.
    if (hasValidAssignedSquawk(flight.squawk)) {
        return {}
    }
    // Wait until EuroScope has reported assigned data at least once (Refresh CAD includes squawk).
    if (!flight.controllerAssignedSeen) {
        console.log(`[${logTag}] Deferring TopSky squawk for ${flight.callsign} — waiting for ES assigned data`)
        return { deferredSquawk: true }
    }
    if (requestTopskySquawkReset(flight.callsign)) {
        console.log(`[${logTag}] Requested TopSky squawk for ${flight.callsign}`)
        flight.squawk = undefined
    }
    return {}
}

/** True when we are CD / DEL (auto squawk+CFL prep is CD-only — not TWR covering DEL). */
function isCdOrDelRole(): boolean {
    if (staticConfig.layoutMode === "essaRoles") {
        const roles = staticConfig.essaRoles ?? []
        return roles.some((r) => r === "CD")
    }
    if (isEsggRolesConfig(staticConfig)) {
        return hasEsggPositionRole("CD")
    }
    return staticConfig.myRole === "DEL"
}

/**
 * When CD/DEL role is lost (e.g. ESSA auto-roles drop CD after another GND opens),
 * disconnect Hoppie/DCL so the session does not linger after the DCL/CDM UI disappears.
 */
function maybeAutoDisconnectDclWhenNoCdRole(reason: string) {
    if (!hoppieService) return
    if (isCdOrDelRole()) return
    console.log(`[DCL] Auto-disconnect (${reason}): CD/DEL role no longer held`)
    hoppieService.logout()
    hoppieService = null
    // Match manual logout: drop to available immediately, then recheck Hoppie reachability
    updateDclStatus("available")
    recalculateDclAvailability()
}

/**
 * ESSA CDM: after DCL WILCO/DONE, set TSAC (communicated TSAT) from the live TSAT
 * that was included in the clearance — same value controllers set via the TSAC box.
 */
function autosetTsacFromTsatOnDclConfirm(flight: Flight) {
    if (flight.origin !== "ESSA") return
    if (flight.flightRules !== "I" && flight.flightRules !== "Y") return
    const tsat = (flight.tsat ?? "").replace(/\D/g, "").slice(0, 4)
    if (!/^\d{4}$/.test(tsat)) {
        console.log(`[CDM] DCL confirm ${flight.callsign}: no TSAT to copy into TSAC`)
        return
    }
    if (flight.tsac === tsat) return
    sendUdp(JSON.stringify({
        type: "setTsac",
        callsign: flight.callsign,
        tsac: tsat,
    } satisfies OutboundPluginCommand))
    flight.tsac = tsat
    console.log(`[CDM] DCL confirm ${flight.callsign}: TSAC autoset → ${tsat} (from TSAT)`)
}

/**
 * Session-level prep memory — survives store.clear() on reconnect/AoR change so we do not
 * treat every re-ingested strip as a brand-new departure needing TopSky SSR.
 * Cleared on full ES disconnect (connectionType 0).
 */
const autoDepPrepDoneCallsigns = new Set<string>()
/** Callsigns waiting for first CAD/ASSR before DEP PREP may allocate SSR. */
const pendingAutoDepPrepCallsigns = new Set<string>()
const pendingAutoDepPrepTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Retry window while waiting for CAD after a new strip (log-only if still missing). */
const AUTO_DEP_PREP_SETTLE_MS = 2500

function clearAutoDepPrepSession() {
    for (const t of pendingAutoDepPrepTimers.values()) clearTimeout(t)
    pendingAutoDepPrepTimers.clear()
    pendingAutoDepPrepCallsigns.clear()
    autoDepPrepDoneCallsigns.clear()
}

function isTrackedByMeFlight(flight: Flight): boolean {
    const myCs = staticConfig.myCallsign
    const mySi = (staticConfig.myPositionId || "").toUpperCase()
    const ownerCs = flight.controller
    const ownerSi = (flight.controllerId || "").toUpperCase()
    const csEq = (a: string | undefined, b: string | undefined) =>
        !!a && !!b && a.toUpperCase() === b.toUpperCase()
    return csEq(ownerCs, myCs) || (!!mySi && !!ownerSi && mySi === ownerSi)
}

/** Untracked or tracked by me — never push SID/CFL/SSR onto another controller's ES ownership. */
function isAvailableForEsAssign(flight: Flight): boolean {
    const ownerCs = flight.controller
    const untracked =
        (!ownerCs || ownerCs === "") && (!flight.controllerId || flight.controllerId === "")
    return isTrackedByMeFlight(flight) || untracked
}

function autoLopSsrMode(): AutoLopSsrMode {
    return isAutoLopSsrMode(currentUiSettings.autoLopSsr)
        ? currentUiSettings.autoLopSsr
        : DEFAULT_UI_SETTINGS.autoLopSsr
}

/** Shared gates for Instant / On assume (Manual never auto-preps). */
function isAutoDepPrepEligible(strip: FlightStrip, flight: Flight): boolean {
    const mode = autoLopSsrMode()
    if (mode === "manual") return false
    if (strip.stripType !== "departure" && strip.stripType !== "local") return false
    if (!isIfrSidEligible(strip.flightRules)) return false
    const origin = (flight.origin || strip.adep || "").toUpperCase()
    if (!staticConfig.myAirports.some((a) => a.toUpperCase() === origin)) return false
    if (strip.clearance) return false
    // Instant: untracked or own; Assume: only after we own the track
    if (mode === "assume") {
        if (!isTrackedByMeFlight(flight)) return false
    } else if (!isAvailableForEsAssign(flight)) {
        return false
    }
    return true
}

function findStripForCallsign(callsign: string): FlightStrip | undefined {
    const key = callsign.toUpperCase()
    return (
        store.getStrip(key) ||
        store.getAllStrips().find((s) => s.callsign.toUpperCase() === key)
    )
}

/**
 * Run DEP PREP once CAD/ASSR state is trustworthy.
 * Returns true when prep completed (including skip because ASSR already present).
 */
function runAutoDepPrep(callsign: string, logTag = "DEP PREP"): boolean {
    const key = callsign.toUpperCase()
    const flight = flightStore.getFlight(key)
    if (!flight) return false
    if (flight.autoDepPrepDone || autoDepPrepDoneCallsigns.has(key)) {
        flight.autoDepPrepDone = true
        pendingAutoDepPrepCallsigns.delete(key)
        return true
    }

    const strip = findStripForCallsign(key)
    if (!strip || !isAutoDepPrepEligible(strip, flight)) {
        pendingAutoDepPrepCallsigns.delete(key)
        return false
    }

    // Still waiting for first CAD — keep pending; never AllocateSSR while ASSR unknown
    if (!flight.controllerAssignedSeen && !hasValidAssignedSquawk(flight.squawk)) {
        pendingAutoDepPrepCallsigns.add(key)
        return false
    }

    pendingAutoDepPrepCallsigns.delete(key)
    const existingTimer = pendingAutoDepPrepTimers.get(key)
    if (existingTimer) {
        clearTimeout(existingTimer)
        pendingAutoDepPrepTimers.delete(key)
    }

    flight.autoDepPrepDone = true
    autoDepPrepDoneCallsigns.add(key)
    console.log(
        `[${logTag}] Auto squawk/CFL for departure ${flight.callsign}` +
            (hasValidAssignedSquawk(flight.squawk)
                ? ` (ASSR ${flight.squawk} already set — skip allocate)`
                : ""),
    )
    autoAssignCflAndSquawk(flight, logTag)

    const updated = flightStore.regenerateStrip(strip.id)
    if (updated) {
        store.updateStripFromFlight(updated)
        broadcastStrip(updated)
    }
    return true
}

function scheduleDeferredAutoDepPrep(callsign: string) {
    const key = callsign.toUpperCase()
    pendingAutoDepPrepCallsigns.add(key)
    if (pendingAutoDepPrepTimers.has(key)) return
    const t = setTimeout(() => {
        pendingAutoDepPrepTimers.delete(key)
        if (!pendingAutoDepPrepCallsigns.has(key)) return
        if (runAutoDepPrep(key)) return
        // Still no CAD — do not allocate; CAD flush will retry. Avoid marking done.
        console.log(
            `[DEP PREP] Still waiting for ES assigned data for ${key} after ${AUTO_DEP_PREP_SETTLE_MS}ms`,
        )
    }, AUTO_DEP_PREP_SETTLE_MS)
    pendingAutoDepPrepTimers.set(key, t)
}

/** Flush deferred DEP PREP as soon as CAD/ASSR arrives. */
function flushDeferredAutoDepPrep(callsign: string) {
    const key = callsign.toUpperCase()
    if (!pendingAutoDepPrepCallsigns.has(key)) return
    const pending = pendingAutoDepPrepTimers.get(key)
    if (pending) {
        clearTimeout(pending)
        pendingAutoDepPrepTimers.delete(key)
    }
    runAutoDepPrep(key)
}

/**
 * Instant mode: prep on strip connect/spawn.
 * Only untracked or own-tracked flights (never another controller's assumed traffic).
 * Defers TopSky SSR until ES assigned data is seen so reload cannot re-allocate existing ASSR.
 */
function maybeAutoPrepNewDeparture(strip: FlightStrip, flight: Flight) {
    if (autoLopSsrMode() !== "instant") return
    if (!isAutoDepPrepEligible(strip, flight)) return
    const key = flight.callsign.toUpperCase()
    if (flight.autoDepPrepDone || autoDepPrepDoneCallsigns.has(key)) {
        flight.autoDepPrepDone = true
        return
    }
    // Already have ASSR or CAD — safe to run immediately
    if (flight.controllerAssignedSeen || hasValidAssignedSquawk(flight.squawk)) {
        runAutoDepPrep(key, "DEP PREP instant")
        return
    }
    // Strip appeared before CAD (common on cold start / .efs refresh / store.clear+reingest)
    console.log(`[DEP PREP] Deferring prep for ${key} until ES assigned data`)
    scheduleDeferredAutoDepPrep(key)
}

/**
 * On-assume mode: prep when this controller assumes the flight.
 * Safe to call repeatedly — autoDepPrepDone prevents re-allocate.
 */
function maybeAutoPrepOnAssume(callsign: string) {
    if (autoLopSsrMode() !== "assume") return
    const key = callsign.toUpperCase()
    const flight = flightStore.getFlight(key)
    if (!flight) return
    const strip = findStripForCallsign(key)
    if (!strip || !isAutoDepPrepEligible(strip, flight)) return
    if (flight.autoDepPrepDone || autoDepPrepDoneCallsigns.has(key)) {
        flight.autoDepPrepDone = true
        return
    }
    if (flight.controllerAssignedSeen || hasValidAssignedSquawk(flight.squawk)) {
        runAutoDepPrep(key, "DEP PREP assume")
        return
    }
    console.log(`[DEP PREP] Deferring assume-prep for ${key} until ES assigned data`)
    scheduleDeferredAutoDepPrep(key)
}

/**
 * Send a DCL clearance CPDLC (CLD / WU) to the pilot.
 * Used for REQUEST→Send, auto/semi auto-send, and controller-initiated (proactive) DCL.
 * Does NOT send the RCD RECEIVED / STANDBY FSM (that is only for pilot REQUEST ack).
 *
 * Returns true if the clearance was sent.
 */
function sendDclClearance(
    flight: Flight,
    remarks: string,
    reason: "auto" | "manual" | "proactive",
): boolean {
    if (!hoppieService) return false

    const dclAirport = staticConfig.myAirports.find((a) => a === flight.origin)
    if (!dclAirport) return false

    const templateData = buildDclTemplateData(flight, remarks)
    let markerClearance: string | undefined
    let plainClearance: string | undefined
    try {
        markerClearance = fillDclTemplateWithMarkers(dclAirport, templateData)
        plainClearance = fillDclTemplate(dclAirport, templateData)
    } catch (err) {
        console.error(
            `[DCL] Template error for ${flight.callsign}: ${err instanceof Error ? err.message : err}`,
        )
        return false
    }
    if (!markerClearance) return false

    const dclCallsign = getDclCallsign()
    const { time, date } = formatTimestamp()
    const seq = hoppieService.getNextSeq()
    const pdc = hoppieService.getNextPdc()
    const pdcStr = String(pdc).padStart(3, "0")

    hoppieService.sendMessage(
        flight.callsign,
        "cpdlc",
        `/data2/${seq}//WU/CLD ${time} ${date} ${dclCallsign} PDC ${pdcStr} ${markerClearance}`,
    )

    flight.dclStatus = "SENT"
    flight.dclSeqNumber = seq
    flight.dclPdcNumber = pdc
    flight.dclClearance = plainClearance
    flight.dclSentAt = Date.now()
    // Proactive has no REQUEST; clear request timestamp so REQUEST timeout does not apply
    if (reason === "proactive") {
        flight.dclRequestedAt = undefined
        flight.dclMessage = undefined
    }

    // ESGG paper: DCL send → CLR read (KLARERING) + ASSUME; strip shows "DCL" ink in col 4
    if (staticConfig.look === "paper") {
        flight.clearanceRead = true
        const existing = findStripForCallsign(flight.callsign)
        assumeCdDelKlareringDep(
            flight,
            existing?.stripType ?? "departure",
            "DCL send",
        )
    }

    console.log(
        `[DCL] Sent clearance to ${flight.callsign} (seq=${seq}, pdc=${pdcStr}, reason=${reason}, mode=${currentDclMode})`,
    )

    const strip = flightStore.regenerateStrip(flight.callsign)
    if (strip) {
        store.updateStripFromFlight(strip)
        broadcastStrip(strip)
    }

    return true
}

/**
 * Attempt to automatically send a DCL clearance for a flight.
 * Called after a DCL request is received (in auto/semi mode) and when
 * flight data updates in semi mode.
 *
 * Returns true if the clearance was sent automatically.
 */
function tryAutoSendDcl(flight: Flight): boolean {
    if (!hoppieService || flight.dclStatus !== "REQUEST") return false
    if (!canAutoSendDcl(flight)) return false
    return sendDclClearance(flight, "", "auto")
}

/**
 * Handle an incoming Hoppie telex (DCL request from pilot).
 * Parses: REQUEST PREDEP CLEARANCE <callsign> <actype> TO <dest> AT <airport> STAND <stand> ATIS <atis>
 */
function handleDclRequest(from: string, packet: string) {
    const match = packet.match(
        /^REQUEST PREDEP CLEARANCE\s+(\S+)\s+(\S+)\s+TO\s+(\S+)\s+AT\s+(\S+)\s+STAND\s+(\S+)\s+ATIS\s+(\S+)$/i,
    )
    if (!match) {
        console.log(`[DCL] Could not parse telex from ${from}: ${packet}`)
        return
    }

    const [, callsign, , , airport, ,] = match
    const dclCallsign = getDclCallsign()
    const { time, date } = formatTimestamp()

    // Validate: is the airport one of ours?
    if (!staticConfig.myAirports.includes(airport!)) {
        console.log(`[DCL] Request for wrong airport ${airport} (we have ${staticConfig.myAirports.join(", ")})`)
        // Send reject
        if (hoppieService) {
            const seq = hoppieService.getNextSeq()
            hoppieService.sendMessage(
                from,
                "cpdlc",
                `/data2/${seq}//NE/DEPART REQUEST STATUS . FSM ${time} ${date} ${dclCallsign} @${from}@ RCD REJECTED @REVERT TO VOICE PROCEDURES`,
            )
        }
        return
    }

    // Find the flight
    const flight = flightStore.getFlight(callsign!)
    if (!flight) {
        console.log(`[DCL] Flight ${callsign} not found in store`)
        // Send reject with "flight plan not held"
        if (hoppieService) {
            const seq = hoppieService.getNextSeq()
            hoppieService.sendMessage(
                from,
                "cpdlc",
                `/data2/${seq}//NE/FSM ${time} ${date} ${dclCallsign ?? "----"} ${from} RCD REJECTED @FLIGHT PLAN NOT HELD @REVERT TO VOICE PROCEDURES`,
            )
        }
        return
    }

    // Valid request
    console.log(`[DCL] Valid request from ${from} for ${callsign} at ${airport}`)
    flight.dclStatus = "REQUEST"
    flight.dclMessage = packet

    // Play notification sound (if enabled in user settings)
    if (currentUiSettings.dclSoundEnabled) {
        playDclSound()
    }

    // Build clearance preview
    const templateData = buildDclTemplateData(flight, "")
    let preview: string | undefined
    try {
        preview = fillDclTemplate(airport!, templateData)
    } catch (err) {
        console.error(`[DCL] Template preview error: ${err instanceof Error ? err.message : err}`)
    }
    if (preview) {
        flight.dclClearance = preview
    }

    // Send ack CPDLC
    if (hoppieService) {
        const seq = hoppieService.getNextSeq()
        hoppieService.sendMessage(
            from,
            "cpdlc",
            `/data2/${seq}//NE/DEPART REQUEST STATUS . FSM ${time} ${date} ${dclCallsign} @${from}@ RCD RECEIVED @REQUEST BEING PROCESSED @STANDBY`,
        )
    }

    // Regenerate and broadcast strip
    const strip = flightStore.regenerateStrip(callsign!)
    if (strip) {
        store.updateStripFromFlight(strip)
        broadcastStrip(strip)
    }

    // Record when the request was received (for REQUEST timeout)
    flight.dclRequestedAt = Date.now()

    // Attempt automatic DCL processing based on mode
    if (currentDclMode === "auto") {
        // AUTO mode: assign CFL + squawk if needed, then try to send
        const assignResult = autoAssignCflAndSquawk(flight)
        // If ASSR was deferred (CAD not seen yet), retry once after settle before auto-send
        if (assignResult.deferredSquawk && !cliArgs.mock) {
            setTimeout(() => {
                const f = flightStore.getFlight(callsign!)
                if (f && f.dclStatus === "REQUEST" && !hasValidAssignedSquawk(f.squawk)) {
                    autoAssignCflAndSquawk(f, "DCL AUTO")
                }
            }, AUTO_DEP_PREP_SETTLE_MS)
        }

        // In non-mock mode, assignments are processed asynchronously via the plugin roundtrip.
        // Wait a short delay to allow the plugin to process the squawk/CFL assignments
        // before attempting to auto-send.
        if (!cliArgs.mock) {
            setTimeout(() => {
                // Re-fetch the flight in case data updated during the wait
                const updatedFlight = flightStore.getFlight(callsign!)
                if (updatedFlight && updatedFlight.dclStatus === "REQUEST") {
                    if (!tryAutoSendDcl(updatedFlight)) {
                        console.log(`[DCL AUTO] Could not auto-send for ${callsign} (missing data), falling back to manual`)
                    }
                }
            }, 3000) // 3 second delay for plugin roundtrip
        } else {
            // Mock mode: data is applied synchronously
            tryAutoSendDcl(flight)
        }
    } else if (currentDclMode === "semi") {
        // SEMI mode: only auto-send if CFL and squawk are already correctly set
        if (canAutoSendDcl(flight)) {
            tryAutoSendDcl(flight)
        } else {
            console.log(`[DCL SEMI] Flight ${callsign} not ready for auto-send, waiting for manual setup`)
        }
    }
}

/**
 * Handle an incoming CPDLC response (WILCO/UNABLE).
 * Parses: /data2/<pilot_seq>/<our_seq>/N/(WILCO|UNABLE)
 */
function handleCpdlcResponse(from: string, packet: string) {
    const match = packet.match(/^\/data2\/(\d+)\/(\d+)\/\w+\/(WILCO|UNABLE)$/i)
    if (!match) return

    const [, , ourSeqStr, response] = match
    const ourSeq = parseInt(ourSeqStr!, 10)

    // Find the flight that this response is for
    const flights = flightStore.getAllFlights()
    const flight = flights.find(
        (f) => f.dclSeqNumber === ourSeq && f.callsign === from,
    )

    if (!flight) {
        console.log(`[DCL] CPDLC ${response} from ${from} but no matching flight (seq=${ourSeq})`)
        return
    }

    const dclCallsign = getDclCallsign()
    const { time, date } = formatTimestamp()

    if (response!.toUpperCase() === "WILCO" && flight.dclStatus === "SENT") {
        console.log(`[DCL] WILCO from ${from} for flight ${flight.callsign}`)
        flight.dclStatus = "DONE"
        flight.dclSentAt = undefined
        flight.dclRequestedAt = undefined

        // End fast polling since we got the response
        hoppieService?.endFastPoll()

        // Send confirmation
        if (hoppieService) {
            const seq = hoppieService.getNextSeq()
            hoppieService.sendMessage(
                from,
                "cpdlc",
                `/data2/${seq}//NE/ATC REQUEST STATUS . . FSM ${time} ${date} ${dclCallsign} @${from}@ CDA RECEIVED @CLEARANCE CONFIRMED`,
            )
        }

        // Set clearance flag via EuroScope plugin (= CLR correct on paper)
        sendUdp(JSON.stringify({ type: "toggleClearanceFlag", callsign: flight.callsign, desired: true }))
        flightStore.applyOptimisticClearance(flight.callsign, true)
        // ESGG paper CD/DEL: confirm also assumes if not already (DCL send may have)
        if (staticConfig.look === "paper") {
            const existing = findStripForCallsign(flight.callsign)
            assumeCdDelKlareringDep(
                flight,
                existing?.stripType ?? "departure",
                "DCL WILCO",
            )
        }

        // ESSA CDM: pilot roger confirms communicated TSAT → autoset TSAC from current TSAT
        autosetTsacFromTsatOnDclConfirm(flight)

        // Regenerate and broadcast strip
        const strip = flightStore.regenerateStrip(flight.callsign)
        if (strip) {
            store.updateStripFromFlight(strip)
            broadcastStrip(strip)
        }
    } else if (response!.toUpperCase() === "UNABLE") {
        console.log(`[DCL] UNABLE from ${from} for flight ${flight.callsign}`)
        flight.dclStatus = "UNABLE"
        flight.dclSentAt = undefined
        flight.dclRequestedAt = undefined

        // End fast polling since we got the response
        hoppieService?.endFastPoll()

        // Regenerate and broadcast strip
        const strip = flightStore.regenerateStrip(flight.callsign)
        if (strip) {
            store.updateStripFromFlight(strip)
            broadcastStrip(strip)
        }
    }
}

// Regenerate all strips with full section re-evaluation (e.g., when online controller roles change).
// regenerateStrip() only updates actions in place — use reprocessAllFlights so sections move too.
function reprocessAllStripsForRoleChange(reason: string) {
    store.reprocessAllFlights()
    // ESSA / ESGG auto roles may have changed — push status + remapped layout before refresh
    if (isEssaRolesConfig(staticConfig) || isEsggRolesConfig(staticConfig)) {
        maybeAutoDisconnectDclWhenNoCdRole(reason)
        broadcastStatus()
        broadcastLayout()
    }
    broadcastRefresh(reason)
}

// Send layout to a client
function sendLayout(socket: WebSocket) {
    const message: LayoutMessage = {
        type: "layout",
        layout: store.getLayout(),
    }
    sendMessage(socket, message)
    console.log("Sent layout to client")
}

// Broadcast layout to all clients (e.g., when active runways change and titles need updating)
function broadcastLayout() {
    const message: LayoutMessage = {
        type: "layout",
        layout: store.getLayout(),
    }
    broadcast(message)
}

/**
 * ESSA: refresh RWY pair headers from active RWY config + FPL-assigned runways.
 * When the header set changes, rebroadcast layout and reprocess strips.
 */
function maybeRefreshEssaRunwayHeaders(): boolean {
    if (!isEssaRolesConfig(staticConfig)) return false
    setEssaAssignedRunways(flightStore.getEssaAssignedRunways())
    const placements = filterEssaRunwayPlacementsForMyAor(
        collectEssaRunwayPairs(
            staticConfig.activeRunways,
            staticConfig.myAirports,
            staticConfig.essaAssignedRunways
        )
    )
    const fp = `${essaRunwayPairsFingerprint(placements)}#${essaAorLayoutKey()}`
    if (fp === staticConfig.essaRunwayLayoutFingerprint) return false
    console.log(
        `[ESSA] RWY headers: ${placements.map(p => p.title).join(", ") || "(none)"} (AOR ${essaAorLayoutKey()})`
    )
    broadcastLayout()
    broadcastStatus()
    store.reprocessAllFlights()
    broadcastRefresh("ESSA RWY headers changed")
    return true
}

// Send all strips to a client (ESSA role/sequence filter applied)
function sendStrips(socket: WebSocket) {
    const strips = store.getAllStrips()
    let sent = 0
    strips.forEach((strip) => {
        const clientStrip = stripForClient(strip)
        if (!clientStrip) return
        const message: StripMessage = {
            type: "strip",
            strip: clientStrip,
        }
        sendMessage(socket, message)
        sent++
    })
    console.log(`Sent ${sent} strips to client`)
    sendScribbles(socket)
}

function sendScribbles(socket: WebSocket) {
    const all = scribbleStore.snapshotAll()
    let n = 0
    for (const [stripId, strokes] of Object.entries(all)) {
        sendMessage(socket, { type: "scribbleUpdate", stripId, strokes })
        n++
    }
    if (n) console.log(`Sent ${n} scribble strip(s) to client`)
}

function broadcastScribbleUpdate(
    stripId: string,
    strokes: ScribbleStrokePayload[],
    exclude?: WebSocket,
    updatedAt?: string,
) {
    broadcast(
        { type: "scribbleUpdate", stripId, strokes, ...(updatedAt ? { updatedAt } : {}) },
        exclude,
    )
}

function applyRemoteScribble(
    syncKey: string,
    strokes: ScribbleStrokePayload[],
    meta:
        | {
              kind?: string
              paperInfoKind?: string
              airport?: string
              callsign?: string
              aircraftType?: string
              bayId?: string
              sectionId?: string
              position?: number
              bottom?: boolean
              clearanceRead?: boolean
              qnhGiven?: number | null
              atisGiven?: string | null
              noteText?: string
              std?: string
          }
        | undefined,
    updatedAt: string,
    opts?: { deleted?: boolean; applyStripMeta?: boolean },
) {
    let stripId = syncKey
    let strip = store.getStrip(syncKey)
    const applyMeta = opts?.applyStripMeta !== false
    if (opts?.deleted) {
        if (!applyMeta) {
            // Strip sync off: still clear shared ink on delete events
            scribbleStore.clearScribbles(syncKey)
            broadcastScribbleUpdate(syncKey, [], undefined, updatedAt)
            return
        }
        const local = strip || store.getStrip(syncKey)
        if (
            local &&
            (local.stripType === "note" ||
                local.stripType === "vehicle" ||
                isAnonymousSpecialStripId(local.id))
        ) {
            const deletedId = store.manualDeleteStrip(local.id)
            if (deletedId) {
                scribbleStore.clearScribbles(deletedId)
                broadcastStripDelete(deletedId)
            }
        } else {
            scribbleStore.clearScribbles(syncKey)
            broadcastScribbleUpdate(syncKey, [], undefined, updatedAt)
        }
        return
    }
    const place = {
        bayId: meta?.bayId,
        sectionId: meta?.sectionId,
        position: meta?.position,
        bottom: meta?.bottom,
    }
    if (applyMeta && !strip && meta?.kind === "note") {
        strip = store.ensureSyncedSpecialStrip({
            syncKey,
            kind: "note",
            paperInfoKind: isPaperInfoKind(meta.paperInfoKind) ? meta.paperInfoKind : undefined,
            airport: meta.airport,
            callsign: meta.callsign,
            ...place,
        })
        if (strip) {
            stripId = strip.id
            if (typeof meta.noteText === "string") {
                const withText = store.updateNoteText(strip.id, meta.noteText)
                if (withText) strip = withText
            }
            const clientStrip = stripForClient(strip)
            if (clientStrip) broadcastStrip(clientStrip)
        }
    } else if (applyMeta && !strip && meta?.kind === "vehicle") {
        strip = store.ensureSyncedSpecialStrip({
            syncKey,
            kind: "vehicle",
            airport: meta.airport,
            callsign: meta.callsign,
            ...place,
        })
        if (strip) {
            stripId = strip.id
            if (typeof meta.std === "string") {
                const withStd = store.updateVehicleStripField(strip.id, "std", meta.std)
                if (withStd) strip = withStd
            }
            const clientStrip = stripForClient(strip)
            if (clientStrip) broadcastStrip(clientStrip)
        }
    } else if (
        applyMeta &&
        !strip &&
        (meta?.kind === "vfrDep" || meta?.kind === "vfrArr" || meta?.kind === "cross")
    ) {
        strip = store.ensureSyncedSpecialStrip({
            syncKey,
            kind: meta.kind,
            airport: meta.airport,
            callsign: meta.callsign,
            aircraftType: meta.aircraftType,
            ...place,
        })
        if (strip) {
            stripId = strip.id
            const clientStrip = stripForClient(strip)
            if (clientStrip) broadcastStrip(clientStrip)
        }
    } else if (!strip) {
        // Flight strip not local yet — stash scribbles under syncKey until strip appears
        stripId = syncKey
    }

    if (applyMeta) {
        // Shared bay placement (all strip types). Flight strips are never invented — only moved if present.
        if (
            strip &&
            meta?.bayId &&
            meta?.sectionId &&
            (strip.bayId !== meta.bayId ||
                strip.sectionId !== meta.sectionId ||
                !!strip.bottom !== !!meta.bottom ||
                (typeof meta.position === "number" && strip.position !== meta.position))
        ) {
            const moved = store.moveStrip(
                strip.id,
                meta.bayId,
                meta.sectionId,
                meta.position,
                !!meta.bottom,
                { fromSync: true },
            )
            if (moved) {
                // Sticky until ES groundstate / ownership / airborne / CLR changes
                if (
                    moved.strip.stripType !== "note" &&
                    moved.strip.stripType !== "vehicle" &&
                    !isAnonymousSpecialStripId(moved.strip.id)
                ) {
                    flightStore.markManualPlacement(moved.strip.id)
                }
                broadcastStrip(moved.strip)
                strip = moved.strip
                stripId = moved.strip.id
            }
        }

        // Note / vehicle field sync (existing strips)
        if (strip?.stripType === "note" && typeof meta?.noteText === "string" && strip.noteText !== meta.noteText) {
            const withText = store.updateNoteText(strip.id, meta.noteText)
            if (withText) {
                strip = withText
                broadcastStrip(withText)
            }
        }
        if (strip?.stripType === "vehicle" && typeof meta?.std === "string" && strip.std !== meta.std) {
            const withStd = store.updateVehicleStripField(strip.id, "std", meta.std)
            if (withStd) {
                strip = withStd
                broadcastStrip(withStd)
            }
        }
        if (
            strip?.stripType === "vehicle" &&
            typeof meta?.callsign === "string" &&
            meta.callsign &&
            strip.callsign !== meta.callsign
        ) {
            const withCs = store.updateVehicleStripField(strip.id, "callsign", meta.callsign)
            if (withCs) {
                strip = withCs
                broadcastStrip(withCs)
            }
        }

        // EFS-only flight flags (CLR correct / CTL / CTO / softGA stay on EuroScope)
        if (strip && strip.stripType !== "note" && strip.stripType !== "vehicle") {
            const flight = flightStore.getFlight(strip.callsign)
            if (flight) {
                let flagsChanged = false
                if (meta?.clearanceRead !== undefined && !!flight.clearanceRead !== !!meta.clearanceRead) {
                    // Do not clear ES CLR via sync — only the local paper "read" bit
                    if (meta.clearanceRead) {
                        flight.clearanceRead = true
                        flagsChanged = true
                    } else if (!flight.clearance && !flight.clearanceReadback) {
                        flight.clearanceRead = false
                        flagsChanged = true
                    }
                }
                if (meta && "qnhGiven" in meta) {
                    const next = meta.qnhGiven == null ? undefined : meta.qnhGiven
                    if (flight.qnhGiven !== next) {
                        flight.qnhGiven = next
                        flagsChanged = true
                    }
                }
                if (meta && "atisGiven" in meta) {
                    const next =
                        meta.atisGiven == null || meta.atisGiven === ""
                            ? undefined
                            : String(meta.atisGiven).trim().toUpperCase()
                    if (flight.atisGiven !== next) {
                        flight.atisGiven = next
                        flagsChanged = true
                    }
                }
                if (flagsChanged) {
                    const updated = flightStore.regenerateStrip(strip.callsign)
                    if (updated) {
                        store.updateStripFromFlight(updated)
                        broadcastStrip(updated)
                        strip = store.getStrip(updated.id) || updated
                        stripId = strip.id
                    }
                }
            }
        }
    }

    scribbleStore.setScribbles(stripId, strokes, { remoteUpdatedAt: updatedAt })
    broadcastScribbleUpdate(stripId, strokes, undefined, updatedAt)
}

/** Sweatbox/Local: stop live-VATSIM feeds; live/playback: restore. */
let lastOnlineServicesOffline: boolean | undefined
function syncOnlineNetworkServices(_realm?: ScribbleRealm) {
    const offline = isOfflineVatsimRealm()
    if (lastOnlineServicesOffline === offline) return
    lastOnlineServicesOffline = offline
    if (offline) {
        console.log(`[REALM] Offline VATSIM services (realm=${resolveRealm(currentUiSettings)})`)
        if (hoppieService) {
            hoppieService.logout()
            hoppieService = null
        }
        updateDclStatus("unavailable")
        if (atisService) {
            atisService.stop()
            atisService = null
            getAtisHealth = () => ({ ok: true, detail: "Off (sweatbox/local)" })
        }
        stopAfvTransceiverPolling()
        try {
            viffService.stop()
        } catch {
            // viff may not be constructed yet at early init
        }
    } else {
        console.log(`[REALM] Online VATSIM services (realm=${resolveRealm(currentUiSettings)})`)
        startAfvTransceiverPolling()
        startAtisService()
        recalculateDclAvailability()
        try {
            viffService.start()
        } catch {
            // ignore if not ready
        }
    }
    broadcastStatus()
}

initScribbleSync({
    getSettings: () => currentUiSettings,
    getConnectionType: () => lastConnectionType,
    getStripById: (id) => store.getStrip(id),
    getAllStrips: () => store.getAllStrips(),
    getAirports: () => staticConfig.myAirports || [],
    onApplyRemote: applyRemoteScribble,
    onNeedVatIrisSignIn: (detail) => {
        broadcast({ type: "openVatIrisSignIn", detail })
    },
    onRealmChanged: (realm) => {
        syncOnlineNetworkServices(realm)
    },
    canPublishIrisOrder: () => canPublishEssaStripview(),
    getEssaSepIndicators: () => {
        const m = buildEssaSepIndicatorsMessage()
        return m ? { sep: m.sep, dlv: m.dlv, depGap: m.depGap } : null
    },
})
restartScribbleSyncPolling()
syncOnlineNetworkServices()

// Send all gaps to a client
function sendGaps(socket: WebSocket) {
    const gaps = store.getAllGaps()
    gaps.forEach((gap) => {
        const message: GapMessage = {
            type: "gap",
            gap: gap,
        }
        sendMessage(socket, message)
    })
    console.log(`Sent ${gaps.length} gaps to client`)
}

function sendRwyFlags(socket: WebSocket) {
    const message: RwyFlagsMessage = {
        type: "rwyFlags",
        active: store.getActiveRwyFlags(),
    }
    sendMessage(socket, message)
}

function broadcastRwyFlags(exclude?: WebSocket) {
    const message: RwyFlagsMessage = {
        type: "rwyFlags",
        active: store.getActiveRwyFlags(),
    }
    broadcast(message, exclude)
}

/** Serialize async WS handlers per socket so Ready TOBT (TOBT+REA) cannot race */
const clientMessageTail = new WeakMap<WebSocket, Promise<void>>()

function enqueueClientMessage(socket: WebSocket, text: string) {
    const prev = clientMessageTail.get(socket) ?? Promise.resolve()
    const next = prev
        .catch(() => {})
        .then(() => handleClientMessage(socket, text))
    clientMessageTail.set(socket, next)
}

// Handle incoming client messages
async function handleClientMessage(socket: WebSocket, text: string) {
    try {
        const data = JSON.parse(text)
        if (isClientMessage(data)) {
            await handleTypedMessage(socket, data)
        }
    } catch {
        // Not a JSON message, check for legacy "?" request
        if (text === "?") {
            // Legacy request: send layout, strips, and gaps
            sendLayout(socket)
            sendStrips(socket)
            sendGaps(socket)
        } else {
            // Forward to UDP (EuroScope plugin)
            sendUdp(text + "\n")
            console.log("WS -> UDP:", text)
        }
    }
}

/** Apply EFS-originated TOBT and pin local CDM so ES file poll cannot overwrite it. */
function applyEfsTobt(flight: Flight, tobt: string) {
    flight.tobt = tobt
    flight.localCdmTobt = tobt
    flight.localCdmAt = Date.now()
    if (tobt === flight.eobt) {
        flight.tobtSetBy = undefined
        flight.tobtSetByAt = undefined
    } else {
        flight.tobtSetBy = "A"
        flight.tobtSetByAt = Date.now()
    }
}

/**
 * Re-parse local data files and refresh network feeds (status popup button).
 */
async function reloadParsedAndNetworkFeeds(): Promise<void> {
    console.log("Reloading parsed files and network feeds…")

    if (fs.existsSync(airportsFile)) {
        try { loadAirports(airportsFile) } catch (err) {
            console.warn(`Reload airports.csv failed: ${err instanceof Error ? err.message : err}`)
        }
    }
    if (fs.existsSync(runwaysFile)) {
        try { loadRunways(runwaysFile) } catch (err) {
            console.warn(`Reload runways.csv failed: ${err instanceof Error ? err.message : err}`)
        }
    }
    if (fs.existsSync(icaoAirportsFile)) {
        try { loadIcaoAirports(icaoAirportsFile) } catch (err) {
            console.warn(`Reload ICAO airports failed: ${err instanceof Error ? err.message : err}`)
        }
    }

    if (EUROSCOPE_DIR) {
        localFeedState.euroscopeDir = { ok: true, detail: path.resolve(EUROSCOPE_DIR) }
        try { loadStands(EUROSCOPE_DIR, EUROSCOPE_PACKAGE) } catch (err) {
            console.warn(`Reload stands failed: ${err instanceof Error ? err.message : err}`)
        }
        try { loadSidData(EUROSCOPE_DIR, EUROSCOPE_PACKAGE) } catch (err) {
            console.warn(`Reload SID data failed: ${err instanceof Error ? err.message : err}`)
        }
        try { loadEseAirspace(EUROSCOPE_DIR, EUROSCOPE_PACKAGE) } catch (err) {
            console.warn(`Reload ESE airspace failed: ${err instanceof Error ? err.message : err}`)
        }
        try {
            updateHoppieConfigFeedState(EUROSCOPE_DIR)
        } catch (err) {
            console.warn(`Reload Hoppie config failed: ${err instanceof Error ? err.message : err}`)
            localFeedState.hoppieConfig = { ok: false, detail: "Reload failed" }
        }
        try { loadTopSkyAirspace(EUROSCOPE_DIR) } catch (err) {
            console.warn(`Reload TopSkyAirspace failed: ${err instanceof Error ? err.message : err}`)
        }
        try {
            loadIcaoAirlines(path.join(EUROSCOPE_DIR, EUROSCOPE_PACKAGE, "ICAO", "ICAO_Airlines.txt"))
        } catch (err) {
            console.warn(`Reload ICAO airlines failed: ${err instanceof Error ? err.message : err}`)
        }
        const cdmDir = findCdmDataDir()
        localFeedState.cdmLocal = cdmDir
            ? { ok: true, detail: path.resolve(cdmDir) }
            : { ok: false, detail: "Not found" }
        if (cdmDir) pollLocalCdmDataFiles()
    } else {
        localFeedState.euroscopeDir = { ok: false, detail: "Not found" }
        localFeedState.hoppieConfig = { ok: false, detail: "Not loaded" }
        localFeedState.cdmLocal = { ok: false, detail: "Not found" }
    }

    await Promise.allSettled([
        refreshAfvTransceivers(),
        loadCtrData(),
    ])
    startAtisService()
    forceViffPoll()
    recalculateDclAvailability()
    broadcastStatus()
    broadcastUserSettings()
    console.log("Feed reload complete")
}

// Handle typed client messages
async function handleTypedMessage(socket: WebSocket, message: ClientMessage) {
    switch (message.type) {
        case "request":
            if (message.request === "layout") {
                sendLayout(socket)
            } else if (message.request === "strips") {
                sendStrips(socket)
                sendGaps(socket)
            } else if (message.request === "refresh") {
                sendUdp(JSON.stringify({ type: "refresh" }))
                // Top-bar reload: pull scribble sync immediately (SSE is primary; this is a catch-up)
                void pollRemote()
            }
            break

        case "reloadFeeds":
            await reloadParsedAndNetworkFeeds()
            void pollRemote()
            break

        case "reorderStrips": {
            // Freeze client visual order into store + flightStore (MAN sort / sticky drag prep)
            const reordered = store.reorderTopStrips(
                message.bayId,
                message.sectionId,
                message.stripIds,
            )
            for (const strip of reordered) {
                broadcastStrip(strip, { exclude: socket })
                // Same-bay order must push every position — peers apply sticky placement
                void pushStripToRemote(strip.id)
            }
            break
        }

        case "moveStrip": {
            // Get the strip before moving to capture source section
            const stripBefore = store.getStrip(message.stripId)
            const fromBayId = stripBefore?.bayId
            const fromSectionId = stripBefore?.sectionId
            const fromBottom = !!stripBefore?.bottom
            const wasIncomingTransfer =
                staticConfig.look === "paper" && stripBefore?.transferPending === "in"

            const result = store.moveStrip(
                message.stripId,
                message.targetBayId,
                message.targetSectionId,
                message.position,
                message.isBottom,
            )
            if (!result) {
                // Revert optimistic client move (e.g. other-owned strip)
                if (stripBefore) {
                    const clientStrip = stripForClient(stripBefore)
                    if (clientStrip) {
                        sendMessage(socket, { type: "strip", strip: clientStrip })
                    }
                }
                break
            }
            {
                // Broadcast the moved strip
                broadcastStrip(result.strip, { exclude: socket })
                // Push full zone order so same-section reorders land correctly on peers
                const zones: Array<{ bayId: string; sectionId: string; bottom: boolean }> = [
                    {
                        bayId: result.strip.bayId,
                        sectionId: result.strip.sectionId,
                        bottom: !!result.strip.bottom,
                    },
                ]
                if (
                    fromBayId &&
                    fromSectionId &&
                    (fromBayId !== result.strip.bayId ||
                        fromSectionId !== result.strip.sectionId ||
                        fromBottom !== !!result.strip.bottom)
                ) {
                    zones.push({ bayId: fromBayId, sectionId: fromSectionId, bottom: fromBottom })
                }
                for (const z of zones) {
                    for (const s of store.getStripsForSection(z.bayId, z.sectionId, z.bottom)) {
                        void pushStripToRemote(s.id)
                    }
                }

                // Broadcast affected gaps
                result.affectedGaps.forEach((gap) => {
                    broadcastGap(gap, socket)
                })

                // Broadcast deleted gaps
                result.deletedGapKeys.forEach((key) => {
                    const parsed = parseGapKey(key)
                    if (parsed) {
                        broadcastGapDelete(parsed.bayId, parsed.sectionId, parsed.index, socket)
                    }
                })

                const flight = flightStore.getFlight(result.strip.callsign)
                let stateChanged = false

                // ESGG paper: drag out of pin tray (or into another section) = ASSUME,
                // except APP→TWR ARR → INBOUND = REFUSE,
                // and GND→TWR DEP/local → PÅ TAXI = REFUSE.
                // UTFLYGNING / above PÅ BANAN from pending inbound = ASSUME (not refuse).
                const fromTaxi =
                    !!fromSectionId &&
                    (fromSectionId === "taxi" || fromSectionId.endsWith("_taxi"))
                const inTaxi =
                    message.targetSectionId === "taxi" ||
                    message.targetSectionId.endsWith("_taxi")
                const toCtrArr =
                    message.targetSectionId === "ctr_arr" ||
                    message.targetSectionId.endsWith("_ctr_arr")
                const toInbound =
                    message.targetSectionId === "inbound" ||
                    message.targetSectionId.endsWith("_inbound")
                const arrOrLocalStrip =
                    result.strip.stripType === "arrival" ||
                    result.strip.stripType === "local" ||
                    stripBefore?.stripType === "arrival" ||
                    stripBefore?.stripType === "local"
                const depOrLocalStrip =
                    result.strip.stripType === "departure" ||
                    result.strip.stripType === "local" ||
                    stripBefore?.stripType === "departure" ||
                    stripBefore?.stripType === "local"
                // APP / GND→TWR pin is in CTR ARR — do not treat PÅ TAXI pin as that pin
                const leftPinTray =
                    wasIncomingTransfer && fromBottom && !message.isBottom && !fromTaxi
                const leftSectionWhileIncoming =
                    wasIncomingTransfer &&
                    !!fromSectionId &&
                    fromSectionId !== message.targetSectionId &&
                    !fromTaxi
                // TWR: accept GND→TWR DEP by dragging PÅ TAXI → sequence bay
                const assumeViaTaxiToSequence =
                    wasIncomingTransfer &&
                    fromTaxi &&
                    toCtrArr &&
                    depOrLocalStrip
                const targetUtflygning =
                    message.targetSectionId === "ctr_dep" ||
                    message.targetSectionId.endsWith("_ctr_dep")
                // Pending APP→TWR: only REFUSE is drag back to INBOUND
                const refuseViaInbound =
                    staticConfig.look === "paper" &&
                    wasIncomingTransfer &&
                    (leftSectionWhileIncoming || leftPinTray) &&
                    toInbound &&
                    arrOrLocalStrip
                // TWR: pending GND→TWR DEP/local dragged back to PÅ TAXI → REFUSE
                const refuseViaTaxi =
                    staticConfig.look === "paper" &&
                    wasIncomingTransfer &&
                    leftSectionWhileIncoming &&
                    inTaxi &&
                    depOrLocalStrip
                // PÅ TAXI pin exit (same section or leave taxi) → set GS + ASSUME if inbound
                // ARR/local → TXIN; DEP → TAXI (GS deferred until GND pulls off pin)
                const leftGndTaxiPin =
                    staticConfig.look === "paper" &&
                    fromTaxi &&
                    fromBottom &&
                    !message.isBottom &&
                    (arrOrLocalStrip || depOrLocalStrip) &&
                    flightStore.isGndTaxiPinned(result.strip.callsign)
                const fromAbovePush = fromSectionId === "above_push"
                const toPushStart =
                    message.targetSectionId === "push_start" ||
                    message.targetSectionId.endsWith("_push_start")
                // CD→GND pin exit: drag to non-pinned (main above_push or START-UP) = ASSUME
                const leftAbovePushPin =
                    staticConfig.look === "paper" &&
                    depOrLocalStrip &&
                    flightStore.isAbovePushPinned(result.strip.callsign) &&
                    ((fromAbovePush && fromBottom && !message.isBottom) ||
                        (fromAbovePush && fromSectionId !== message.targetSectionId) ||
                        (wasIncomingTransfer && fromAbovePush && toPushStart))

                if (flight && (refuseViaTaxi || refuseViaInbound)) {
                    sendUdp(
                        JSON.stringify({
                            type: "refuse",
                            callsign: result.strip.callsign,
                        } satisfies OutboundPluginCommand),
                    )
                    flight.handoffTargetController = ""
                    flight.handoffTargetControllerId = undefined
                    flight.handoffOptimisticUntil = undefined
                    flightStore.markAppTransferDragReleased(result.strip.callsign)
                    flightStore.clearAppTransferPinned(result.strip.callsign)
                    stateChanged = true
                    const refuseReason = refuseViaInbound
                        ? "ARR drag back to INBOUND"
                        : "DEP/local drag back to PÅ TAXI"
                    console.log(
                        `[MOVE] ${result.strip.callsign}: REFUSE (${refuseReason})`,
                    )
                } else if (flight && leftAbovePushPin) {
                    flightStore.markAbovePushDragReleased(result.strip.callsign)
                    flightStore.clearAbovePushPinned(result.strip.callsign)
                    sendUdp(
                        JSON.stringify({
                            type: "assume",
                            callsign: result.strip.callsign,
                        } satisfies OutboundPluginCommand),
                    )
                    flight.controller = staticConfig.myCallsign
                    flight.controllerId = staticConfig.myPositionId
                    flight.handoffTargetController = ""
                    flight.handoffTargetControllerId = undefined
                    flight.handoffOptimisticUntil = undefined
                    flight.ownershipOptimisticUntil = Date.now() + 5000
                    maybeAutoPrepOnAssume(flight.callsign)
                    stateChanged = true
                    console.log(
                        `[MOVE] ${result.strip.callsign}: ASSUME (drag out of CD→GND pin / to START-UP)`,
                    )
                } else if (flight && leftGndTaxiPin) {
                    // Manual drag out of pin — keep moveStrip placement (do not force top)
                    flightStore.markGndTaxiDragReleased(result.strip.callsign)
                    flightStore.clearGndTaxiPinned(result.strip.callsign)
                    const pinExitGs =
                        result.strip.stripType === "departure" ||
                        stripBefore?.stripType === "departure"
                            ? "TAXI"
                            : "TXIN"
                    if ((flight.groundstate || "").toUpperCase() !== pinExitGs) {
                        sendUdp(
                            JSON.stringify({
                                type: "setGroundState",
                                callsign: result.strip.callsign,
                                state: pinExitGs,
                            } satisfies OutboundPluginCommand),
                        )
                        flightStore.applyOptimisticGroundstate(result.strip.callsign, pinExitGs)
                    }
                    if (wasIncomingTransfer) {
                        sendUdp(
                            JSON.stringify({
                                type: "assume",
                                callsign: result.strip.callsign,
                            } satisfies OutboundPluginCommand),
                        )
                        flight.controller = staticConfig.myCallsign
                        flight.controllerId = staticConfig.myPositionId
                        flight.handoffTargetController = ""
                        flight.handoffTargetControllerId = undefined
                        flight.handoffOptimisticUntil = undefined
                        flight.ownershipOptimisticUntil = Date.now() + 5000
                        maybeAutoPrepOnAssume(flight.callsign)
                    }
                    stateChanged = true
                    console.log(
                        `[MOVE] ${result.strip.callsign}: ${pinExitGs} (drag out of PÅ TAXI pin)`,
                    )
                } else if (
                    flight &&
                    (leftPinTray || leftSectionWhileIncoming || assumeViaTaxiToSequence)
                ) {
                    sendUdp(
                        JSON.stringify({
                            type: "assume",
                            callsign: result.strip.callsign,
                        } satisfies OutboundPluginCommand),
                    )
                    flight.controller = staticConfig.myCallsign
                    flight.controllerId = staticConfig.myPositionId
                    flight.handoffTargetController = ""
                    flight.handoffTargetControllerId = undefined
                    flight.handoffOptimisticUntil = undefined
                    flight.ownershipOptimisticUntil = Date.now() + 5000
                    maybeAutoPrepOnAssume(flight.callsign)
                    if (assumeViaTaxiToSequence && message.isBottom) {
                        // Accept into pin tray — stay pinned until drag to main / runway
                        flightStore.clearAppTransferPinned(result.strip.callsign)
                        // Re-enter pin session as assumed so hold keeps sequence placement
                    } else {
                        flightStore.markAppTransferDragReleased(result.strip.callsign)
                        flightStore.clearAppTransferPinned(result.strip.callsign)
                    }
                    stateChanged = true
                    console.log(
                        `[MOVE] ${result.strip.callsign}: ASSUME (${
                            assumeViaTaxiToSequence
                                ? "taxi→sequence bay"
                                : "drag out of transfer pin"
                        })`,
                    )
                }

                // Evaluate move rules if section changed
                if (fromSectionId && fromSectionId !== message.targetSectionId) {
                    console.log(
                        `Strip ${message.stripId} dragged from ${fromSectionId} to ${message.targetSectionId} (bottom: ${message.isBottom})`,
                    )

                    if (flight) {
                        const fromCtrArr =
                            fromSectionId === "ctr_arr" || fromSectionId.endsWith("_ctr_arr")
                        const fromRunwayEarly =
                            fromSectionId === "runway" || fromSectionId.includes("runway")
                        const myRoleForGnd =
                            getActingControllerRole() ?? staticConfig.myRole
                        const iAmGndForTaxi = isEsggRolesConfig(staticConfig)
                            ? hasEsggPositionRole("GND")
                            : myRoleForGnd === "GND"
                        const gndCsForTaxi = getControllerCallsign("GND")
                        // Assumed DEP/local from seq/RWY → PÅ TAXI: XFER to GND (no GS yet)
                        const willXferDepToGnd =
                            staticConfig.look === "paper" &&
                            (fromCtrArr || fromRunwayEarly) &&
                            inTaxi &&
                            depOrLocalStrip &&
                            !!gndCsForTaxi &&
                            !iAmGndForTaxi &&
                            (myRoleForGnd === "TWR" ||
                                myRoleForGnd === "APP" ||
                                myRoleForGnd === "CTR")

                        // CD-only (not covering GND): drop on START-UP / above-push → XFER if GND online
                        const toPushOrAbove =
                            message.targetSectionId === "push_start" ||
                            message.targetSectionId === "above_push"
                        const willCdXferToGnd =
                            isEsggRolesConfig(staticConfig) &&
                            hasEsggPositionRole("CD") &&
                            !hasEsggPositionRole("GND") &&
                            toPushOrAbove &&
                            depOrLocalStrip &&
                            !!getControllerCallsign("GND")

                        // ESGG paper: ARR/local → UTFLYGNING is soft G/A — never set DEPA,
                        // and never unset CTL (common-rules runway_to_ctr_dep_clear_ctl).
                        const softGoaFromRunway =
                            staticConfig.look === "paper" &&
                            targetUtflygning &&
                            arrOrLocalStrip &&
                            (fromSectionId === "runway" || fromSectionId.includes("runway"))
                        const skipDepaForSoftGoa =
                            staticConfig.look === "paper" &&
                            targetUtflygning &&
                            arrOrLocalStrip

                        const moveAction = determineMoveAction(flight, fromSectionId, message.targetSectionId, staticConfig)
                        if (moveAction) {
                            let cmds =
                                willXferDepToGnd || willCdXferToGnd
                                    ? moveAction.commands.filter((c) => c.type !== "setGroundstate")
                                    : moveAction.commands
                            if (skipDepaForSoftGoa) {
                                cmds = cmds.filter(
                                    (c) =>
                                        !(
                                            c.type === "setGroundstate" &&
                                            String(c.value).toUpperCase() === "DEPA"
                                        ),
                                )
                            }
                            if (softGoaFromRunway) {
                                cmds = cmds.filter(
                                    (c) =>
                                        !(
                                            c.type === "setClearedToLand" &&
                                            c.value === false
                                        ),
                                )
                            }
                            if (cmds.length) {
                                const cmdLog = cmds.map(formatEuroscopeCommand).join(" + ")
                                console.log(
                                    `[MOVE ACTION] ${result.strip.callsign}: ${cmdLog} (rule: ${moveAction.ruleId})`,
                                )
                                for (const cmd of cmds) {
                                    executeMoveCommand(cmd, result.strip.callsign, flight)
                                }
                                stateChanged = true
                            } else if (willXferDepToGnd || skipDepaForSoftGoa || softGoaFromRunway) {
                                console.log(
                                    `[MOVE ACTION] ${result.strip.callsign}: skip (${
                                        softGoaFromRunway
                                            ? "ARR soft G/A keep CTL"
                                            : skipDepaForSoftGoa
                                              ? "ARR soft G/A"
                                              : "DEP→GND XFER"
                                    })`,
                                )
                            }
                        }

                        // ESGG paper: PÅ BANAN → rwy seq (DEP/local) must re-set TXO (TAXI).
                        // Without this, LINEUP/DEPA section rules snap the strip straight back.
                        const toCtrArrForTxo =
                            message.targetSectionId === "ctr_arr" ||
                            message.targetSectionId.endsWith("_ctr_arr")
                        const fromRunwayForTxo =
                            fromSectionId === "runway" || fromSectionId.includes("runway")
                        const depOrLocalForTxo =
                            result.strip.stripType === "departure" ||
                            result.strip.stripType === "local" ||
                            stripBefore?.stripType === "departure" ||
                            stripBefore?.stripType === "local"
                        const txoAlreadyByRule = moveAction?.commands.some(
                            (c) => c.type === "setGroundstate" && c.value === "TAXI",
                        )
                        const gsUpper = (flight.groundstate || "").toUpperCase()
                        if (
                            staticConfig.look === "paper" &&
                            fromRunwayForTxo &&
                            toCtrArrForTxo &&
                            depOrLocalForTxo &&
                            !txoAlreadyByRule &&
                            gsUpper !== "TAXI" &&
                            gsUpper !== "TXIN"
                        ) {
                            executeMoveCommand(
                                { type: "setGroundstate", value: "TAXI" },
                                result.strip.callsign,
                                flight,
                            )
                            if (flight.clearedToLand) {
                                executeMoveCommand(
                                    { type: "setClearedToLand", value: false },
                                    result.strip.callsign,
                                    flight,
                                )
                            }
                            stateChanged = true
                            console.log(
                                `[MOVE] ${result.strip.callsign}: TXO (drag DEP/local PÅ BANAN → rwy seq)`,
                            )
                        }

                        // ESGG paper CD-only: drop on START-UP or above-push →
                        // GND online: READY+XFER + pin stick-top of above_push;
                        // else set S/P (PUSH/STUP).
                        if (
                            isEsggRolesConfig(staticConfig) &&
                            hasEsggPositionRole("CD") &&
                            !hasEsggPositionRole("GND") &&
                            toPushOrAbove &&
                            depOrLocalStrip
                        ) {
                            const gndCs =
                                getControllerCallsign("GND") ??
                                resolveXferTarget(result.strip, flight)
                            if (gndCs) {
                                sendUdp(
                                    JSON.stringify({
                                        type: "setGroundState",
                                        callsign: result.strip.callsign,
                                        state: "DE-ICE",
                                    } satisfies OutboundPluginCommand),
                                )
                                sendUdp(
                                    JSON.stringify({
                                        type: "transfer",
                                        callsign: result.strip.callsign,
                                        targetCallsign: gndCs,
                                    } satisfies OutboundPluginCommand),
                                )
                                flight.groundstate = "DE-ICE"
                                flight.handoffTargetController = gndCs
                                flight.handoffOptimisticUntil = Date.now() + 3000
                                flightStore.startAbovePushPin(result.strip.callsign)
                                const pinned = flightStore.pinAbovePushTray(
                                    result.strip.callsign,
                                )
                                if (pinned) {
                                    const applied = store.updateStripFromFlight(pinned.strip, {
                                        allowPositionChange: true,
                                    })
                                    result.strip = applied
                                    for (const shifted of pinned.shiftedCallsigns) {
                                        const shiftedStrip = flightStore.regenerateStrip(shifted)
                                        if (shiftedStrip) {
                                            broadcastStrip(
                                                store.updateStripFromFlight(shiftedStrip, {
                                                    allowPositionChange: true,
                                                }),
                                            )
                                        }
                                    }
                                    broadcastStrip(applied, { exclude: socket })
                                }
                                stateChanged = true
                                console.log(
                                    `[MOVE] ${result.strip.callsign}: CD→GND READY+XFER + pin above S/P → ${gndCs}`,
                                )
                            } else {
                                // No GND online — set S/P (covering GND ourselves)
                                let spState = "PUSH"
                                if (
                                    standRequiresStartupInsteadOfPush(
                                        flight.stand,
                                        flight.engineType,
                                    )
                                ) {
                                    spState = "STUP"
                                }
                                executeMoveCommand(
                                    { type: "setGroundstate", value: spState },
                                    result.strip.callsign,
                                    flight,
                                )
                                stateChanged = true
                                console.log(
                                    `[MOVE] ${result.strip.callsign}: S/P ${spState} (CD drop START-UP, no GND)`,
                                )
                            }
                        }

                        // ESGG paper: ARR/local under PÅ BANAN → set CTL (cleared to land / T&G / low app)
                        const toPabanan =
                            message.targetSectionId === "runway" ||
                            message.targetSectionId.includes("runway")
                        const arrOrLocal =
                            result.strip.stripType === "arrival" ||
                            result.strip.stripType === "local" ||
                            stripBefore?.stripType === "arrival" ||
                            stripBefore?.stripType === "local"
                        const ctlAlreadyByRule = moveAction?.commands.some(
                            (c) => c.type === "setClearedToLand" && c.value === true,
                        )
                        if (
                            staticConfig.look === "paper" &&
                            toPabanan &&
                            arrOrLocal &&
                            !ctlAlreadyByRule &&
                            !flight.clearedToLand
                        ) {
                            sendUdp(
                                JSON.stringify({
                                    type: "setClearedToLand",
                                    callsign: result.strip.callsign,
                                } satisfies OutboundPluginCommand),
                            )
                            flight.clearedToLand = true
                            stateChanged = true
                            console.log(
                                `[MOVE] ${result.strip.callsign}: CTL (drag ARR/local to PÅ BANAN)`,
                            )
                        }
                        // Drag back to PÅ BANAN clears EFS soft G/A only (not TopSky MISAP_)
                        if (
                            staticConfig.look === "paper" &&
                            toPabanan &&
                            arrOrLocal &&
                            flight.efsGoAround
                        ) {
                            sendUdp(
                                JSON.stringify({
                                    type: "unsetEfsGoAround",
                                    callsign: result.strip.callsign,
                                } satisfies OutboundPluginCommand),
                            )
                            flightStore.clearSoftMissedApproach(result.strip.callsign)
                            stateChanged = true
                        }

                        // ESGG paper: PÅ BANAN→UTFLYGNING ARR = soft G/A only (no auto XFER).
                        // XFER via diagonal scribble / drop on pin tray (below).
                        const ifrStrip = isIfrSidEligible(
                            result.strip.flightRules || flight.flightRules,
                        )
                        const softGoAroundArr = softGoaFromRunway

                        // Moving out of any RUNWAY section clears the cleared-to-land flag,
                        // unless a move rule already sent setClearedToLand (avoid double UDP send).
                        // Soft G/A to UTFLYGNING keeps CTL if it was already set.
                        // Paper: PÅ BANAN → PÅ TAXI keeps CTL + ATA (vacate after landing).
                        // Ignore filtered-out unset-CTL commands from common-rules.
                        const keepCtlVacateToTaxi =
                            staticConfig.look === "paper" && inTaxi
                        const clearedToLandHandledByRule = moveAction?.commands.some(
                            (c) =>
                                c.type === "setClearedToLand" &&
                                !(softGoAroundArr && c.value === false) &&
                                !(keepCtlVacateToTaxi && c.value === false),
                        )
                        if (
                            !clearedToLandHandledByRule &&
                            !softGoAroundArr &&
                            !keepCtlVacateToTaxi &&
                            fromSectionId.includes('runway') &&
                            !message.targetSectionId.includes('runway') &&
                            flight.clearedToLand
                        ) {
                            console.log(`[MOVE] Clearing clearedToLand for ${result.strip.callsign} (left runway section)`)
                            sendUdp(JSON.stringify({ type: "unsetClearedToLand", callsign: result.strip.callsign }))
                            flight.clearedToLand = false
                            stateChanged = true
                        }

                        if (softGoAroundArr) {
                            flightStore.applySoftMissedApproach(result.strip.callsign)
                            sendUdp(
                                JSON.stringify({
                                    type: "setEfsGoAround",
                                    callsign: result.strip.callsign,
                                } satisfies OutboundPluginCommand),
                            )
                            stateChanged = true
                            console.log(
                                `[MOVE] ${result.strip.callsign}: soft G/A EFSGA (PÅ BANAN→UTFLYGNING, no auto XFER)`,
                            )
                        }
                        // Pin-tray drop only → XFER APP (ARR G/A or airborne DEP). Not main-stack enter.
                        const utflygningXfer =
                            staticConfig.look === "paper" &&
                            targetUtflygning &&
                            ifrStrip &&
                            !!message.isBottom &&
                            ((arrOrLocalStrip &&
                                (!!flight.missedApproach ||
                                    !!flight.efsGoAround ||
                                    softGoAroundArr)) ||
                                (result.strip.stripType === "departure" && !!flight.airborne))
                        if (utflygningXfer && flight) {
                            const appCs = resolveXferTarget(result.strip, flight)
                            if (appCs) {
                                flightStore.startUtflygningPin(result.strip.callsign)
                                sendUdp(
                                    JSON.stringify({
                                        type: "transfer",
                                        callsign: result.strip.callsign,
                                        targetCallsign: appCs,
                                    } satisfies OutboundPluginCommand),
                                )
                                flight.handoffTargetController = appCs
                                flight.handoffOptimisticUntil = Date.now() + 3000
                                const pinned = flightStore.pinUtflygningTray(result.strip.callsign)
                                if (pinned) {
                                    const applied = store.updateStripFromFlight(pinned.strip, {
                                        allowPositionChange: true,
                                    })
                                    result.strip = applied
                                    for (const shifted of pinned.shiftedCallsigns) {
                                        const shiftedStrip = flightStore.regenerateStrip(shifted)
                                        if (shiftedStrip) {
                                            broadcastStrip(
                                                store.updateStripFromFlight(shiftedStrip, {
                                                    allowPositionChange: true,
                                                }),
                                            )
                                        }
                                    }
                                    broadcastStrip(applied, { exclude: socket })
                                }
                                stateChanged = true
                                console.log(
                                    `[MOVE] ${result.strip.callsign}: pin UTFLYGNING + XFER → ${appCs}`,
                                )
                            }
                        }

                        // ESGG paper: GND DEP/local PÅ TAXI → sequence bay → XFER to TWR.
                        // Drop on main (non-pinned) stack still auto-pins + transfers.
                        const iAmGndOnly = isEsggRolesConfig(staticConfig)
                            ? hasEsggPositionRole("GND") && !hasEsggPositionRole("TWR")
                            : staticConfig.myRole === "GND"
                        if (
                            staticConfig.look === "paper" &&
                            fromTaxi &&
                            toCtrArr &&
                            depOrLocalStrip &&
                            iAmGndOnly
                        ) {
                            const twrCs =
                                resolveXferTarget(result.strip, flight) ??
                                getControllerCallsign("TWR")
                            if (twrCs) {
                                sendUdp(
                                    JSON.stringify({
                                        type: "transfer",
                                        callsign: result.strip.callsign,
                                        targetCallsign: twrCs,
                                    } satisfies OutboundPluginCommand),
                                )
                                flight.handoffTargetController = twrCs
                                flight.handoffOptimisticUntil = Date.now() + 3000
                                // Always pin (even if dropped on non-pinned main stack)
                                const pinned = flightStore.pinRwySequenceTray(
                                    result.strip.callsign,
                                )
                                if (pinned) {
                                    const applied = store.updateStripFromFlight(pinned.strip, {
                                        allowPositionChange: true,
                                    })
                                    result.strip = applied
                                    for (const shifted of pinned.shiftedCallsigns) {
                                        const shiftedStrip = flightStore.regenerateStrip(shifted)
                                        if (shiftedStrip) {
                                            broadcastStrip(
                                                store.updateStripFromFlight(shiftedStrip, {
                                                    allowPositionChange: true,
                                                }),
                                            )
                                        }
                                    }
                                    broadcastStrip(applied, { exclude: socket })
                                }
                                stateChanged = true
                                console.log(
                                    `[MOVE] ${result.strip.callsign}: auto-pin sequence bay + XFER → ${twrCs}`,
                                )
                            }
                        }

                        // ESGG paper: assumed strip from rwy seq / PÅ BANAN / UTFLYGNING → INBOUND
                        // → XFER to suitable APP (ARR/local by arr RWY side; DEP by SID/RWY).
                        // Pending inbound dragged back to INBOUND is REFUSE (handled above).
                        const fromUtflygningBay =
                            fromSectionId === "ctr_dep" || fromSectionId.endsWith("_ctr_dep")
                        const fromTowerFlowBay =
                            fromCtrArr || fromRunwayEarly || fromUtflygningBay
                        const assumedByMeForAppXfer =
                            !!staticConfig.myCallsign &&
                            (flight.controller || "").toUpperCase() ===
                                staticConfig.myCallsign.toUpperCase()
                        if (
                            staticConfig.look === "paper" &&
                            toInbound &&
                            fromTowerFlowBay &&
                            assumedByMeForAppXfer &&
                            !wasIncomingTransfer &&
                            (arrOrLocalStrip || result.strip.stripType === "departure") &&
                            (myRoleForGnd === "TWR" ||
                                myRoleForGnd === "APP" ||
                                myRoleForGnd === "CTR")
                        ) {
                            const online = staticConfig.onlineControllers?.values()
                            let appCs: string | undefined
                            if (arrOrLocalStrip) {
                                const arrRwy =
                                    flight.arrRwy ||
                                    staticConfig.activeRunways?.["ESGG"]?.arr?.[0]
                                appCs = resolveEsggMisapApp(arrRwy, online)?.callsign
                            } else {
                                const depRwy =
                                    flight.depRwy ||
                                    staticConfig.activeRunways?.["ESGG"]?.dep?.[0]
                                appCs = resolveEsggDepApp(
                                    depRwy,
                                    flight.sid || result.strip.sid,
                                    online,
                                    "ESGG",
                                    flight.route,
                                )?.callsign
                            }
                            appCs = appCs ?? getControllerCallsign("APP")
                            const myCs = (staticConfig.myCallsign || "").toUpperCase()
                            if (appCs && appCs.toUpperCase() !== myCs) {
                                sendUdp(
                                    JSON.stringify({
                                        type: "transfer",
                                        callsign: result.strip.callsign,
                                        targetCallsign: appCs,
                                    } satisfies OutboundPluginCommand),
                                )
                                flight.handoffTargetController = appCs
                                flight.handoffOptimisticUntil = Date.now() + 3000
                                if (flight.clearedToLand) {
                                    sendUdp(
                                        JSON.stringify({
                                            type: "unsetClearedToLand",
                                            callsign: result.strip.callsign,
                                        } satisfies OutboundPluginCommand),
                                    )
                                    flight.clearedToLand = false
                                }
                                stateChanged = true
                                console.log(
                                    `[MOVE] ${result.strip.callsign}: XFER → ${appCs} (drag to INBOUND from ${fromSectionId})`,
                                )
                            }
                        }

                        // ESGG paper: PÅ BANAN / rwy-seq → PÅ TAXI
                        // ARR/local: GND online → pin + XFER (TXIN on pin-exit). Solo → TXIN.
                        // DEP/local: GND online → pin + XFER (TAXI on pin-exit). Solo → TAXI.
                        const fromRunway =
                            fromSectionId === "runway" || fromSectionId.includes("runway")
                        const fromSeqOrRwy = fromCtrArr || fromRunway
                        if (
                            staticConfig.look === "paper" &&
                            fromSeqOrRwy &&
                            inTaxi &&
                            (arrOrLocalStrip || depOrLocalStrip)
                        ) {
                            const gndCs = gndCsForTaxi
                            const myRole = myRoleForGnd
                            const iAmGnd = iAmGndForTaxi
                            // DEP (and outbound local from sequence) → TAXI; ARR vacate → TXIN
                            const soloGs =
                                result.strip.stripType === "departure" ||
                                (result.strip.stripType === "local" &&
                                    fromCtrArr &&
                                    !flight.clearedToLand)
                                    ? "TAXI"
                                    : "TXIN"
                            if (
                                gndCs &&
                                !iAmGnd &&
                                (myRole === "TWR" || myRole === "APP" || myRole === "CTR")
                            ) {
                                flightStore.startGndTaxiPin(result.strip.callsign)
                                sendUdp(
                                    JSON.stringify({
                                        type: "transfer",
                                        callsign: result.strip.callsign,
                                        targetCallsign: gndCs,
                                    } satisfies OutboundPluginCommand),
                                )
                                flight.handoffTargetController = gndCs
                                flight.handoffOptimisticUntil = Date.now() + 3000
                                stateChanged = true
                                console.log(
                                    `[MOVE] ${result.strip.callsign}: pin PÅ TAXI + XFER → ${gndCs} (no GS yet)`,
                                )
                            } else if (!gndCs || iAmGnd) {
                                // Solo TWR (covering GND) or already GND: set GS immediately
                                if ((flight.groundstate || "").toUpperCase() !== soloGs) {
                                    sendUdp(
                                        JSON.stringify({
                                            type: "setGroundState",
                                            callsign: result.strip.callsign,
                                            state: soloGs,
                                        } satisfies OutboundPluginCommand),
                                    )
                                    flightStore.applyOptimisticGroundstate(
                                        result.strip.callsign,
                                        soloGs,
                                    )
                                    stateChanged = true
                                    console.log(
                                        `[MOVE] ${result.strip.callsign}: ${soloGs} (PÅ TAXI, no GND handoff)`,
                                    )
                                }
                                flightStore.clearGndTaxiPinned(result.strip.callsign)
                            }
                        }
                    }
                } else {
                    console.log(`Strip ${message.stripId} dragged within ${message.targetSectionId} (bottom: ${message.isBottom})`)
                    // ESGG paper: drop to UTFLYGNING pin tray → diagonal XFER to APP
                    if (
                        flight &&
                        staticConfig.look === "paper" &&
                        targetUtflygning &&
                        message.isBottom &&
                        !fromBottom &&
                        isIfrSidEligible(result.strip.flightRules || flight.flightRules)
                    ) {
                        const arrLike =
                            result.strip.stripType === "arrival" ||
                            result.strip.stripType === "local"
                        const depAirborne =
                            result.strip.stripType === "departure" && !!flight.airborne
                        if (arrLike && !flight.missedApproach) {
                            flightStore.applySoftMissedApproach(result.strip.callsign)
                            sendUdp(
                                JSON.stringify({
                                    type: "setEfsGoAround",
                                    callsign: result.strip.callsign,
                                } satisfies OutboundPluginCommand),
                            )
                        }
                        if (arrLike || depAirborne) {
                            const appCs = resolveXferTarget(result.strip, flight)
                            if (appCs) {
                                flightStore.startUtflygningPin(result.strip.callsign)
                                sendUdp(
                                    JSON.stringify({
                                        type: "transfer",
                                        callsign: result.strip.callsign,
                                        targetCallsign: appCs,
                                    } satisfies OutboundPluginCommand),
                                )
                                flight.handoffTargetController = appCs
                                flight.handoffOptimisticUntil = Date.now() + 3000
                                const pinned = flightStore.pinUtflygningTray(result.strip.callsign)
                                if (pinned) {
                                    const applied = store.updateStripFromFlight(pinned.strip, {
                                        allowPositionChange: true,
                                    })
                                    result.strip = applied
                                    for (const shifted of pinned.shiftedCallsigns) {
                                        const shiftedStrip = flightStore.regenerateStrip(shifted)
                                        if (shiftedStrip) {
                                            broadcastStrip(
                                                store.updateStripFromFlight(shiftedStrip, {
                                                    allowPositionChange: true,
                                                }),
                                            )
                                        }
                                    }
                                    broadcastStrip(applied, { exclude: socket })
                                }
                                stateChanged = true
                                console.log(
                                    `[MOVE] ${result.strip.callsign}: UTFLYGNING pin-tray + XFER → ${appCs}`,
                                )
                            }
                        }
                    }
                }

                if (stateChanged && flight) {
                    reevaluateAndBroadcast(result.strip.callsign)
                }
            }
            break
        }

        case "setGap": {
            const result = store.setGap(message.bayId, message.sectionId, message.index, message.gapSize)
            if (result.deleted) {
                broadcastGapDelete(message.bayId, message.sectionId, message.index, socket)
                console.log(`Gap deleted at ${message.sectionId}[${message.index}]`)
            } else if (result.gap) {
                broadcastGap(result.gap, socket)
                console.log(`Gap set at ${message.sectionId}[${message.index}] = ${message.gapSize}px`)
            }
            break
        }

        case "setRwyFlag": {
            const result = store.setRwyFlag(message.flagId, message.active)
            if (result.changed) {
                broadcastRwyFlags(socket)
                console.log(`[RWY FLAG] ${result.flagId} → ${result.active ? "on" : "off"}`)
            }
            break
        }

        case "setEssaSepIndicators": {
            if (!canEditEssaSepIndicators()) {
                console.log("[ESSA SEP] reject setEssaSepIndicators — TWR role required")
                break
            }
            let changed = false
            const fields: EssaSepField[] = ["sep", "dlv", "depGap"]
            for (const field of fields) {
                if (!(field in message)) continue
                const raw = message[field]
                if (raw === null) {
                    if (essaSepOverrides[field] !== undefined) {
                        delete essaSepOverrides[field]
                        changed = true
                    }
                    continue
                }
                if (typeof raw !== "string" || !isValidEssaSepOverride(field, raw)) continue
                if (essaSepOverrides[field] !== raw) {
                    essaSepOverrides[field] = raw
                    changed = true
                }
            }
            if (changed) {
                broadcastEssaSepIndicators()
                console.log(`[ESSA SEP] overrides → ${JSON.stringify(essaSepOverrides)}`)
            }
            break
        }

        case "setSectionHeight": {
            const result = store.setSectionHeight(message.bayId, message.sectionId, message.height)
            if (result && result.changed) {
                broadcastSection(message.bayId, result.section, socket)
                console.log(`Section ${message.sectionId} height set to ${result.section.height}px`)
            }
            break
        }

        case "stripAction": {
            const strip = store.getStrip(message.stripId)
            if (strip) {
                console.log(`[ACTION] ${message.action} on ${message.stripId} (${strip.callsign})`)
                const flight = flightStore.getFlight(strip.callsign)

                // READY is a compound action: set DE-ICE groundstate + transfer
                if (message.action === "READY") {
                    const targetCallsign = resolveXferTarget(strip, flight)
                    sendUdp(JSON.stringify({ type: "setGroundState", callsign: strip.callsign, state: "DE-ICE" }))
                    sendUdp(JSON.stringify({ type: "transfer", callsign: strip.callsign, targetCallsign } satisfies OutboundPluginCommand))
                    if (flight && targetCallsign) {
                        flight.handoffTargetController = targetCallsign
                        flight.handoffOptimisticUntil = Date.now() + 3000
                    }
                // XFER: initiate handoff to the appropriate next controller
                } else if (message.action === "XFER") {
                    const targetCallsign = resolveXferTarget(strip, flight)
                    sendUdp(JSON.stringify({ type: "transfer", callsign: strip.callsign, targetCallsign } satisfies OutboundPluginCommand))
                    // Optimistic: show pending outbound transfer immediately
                    if (flight && targetCallsign) {
                        flight.handoffTargetController = targetCallsign
                        flight.handoffOptimisticUntil = Date.now() + 3000
                        // Clear incoming ROF once we hand off to the requester
                        if (flight.rofRequestFrom) flightStore.clearRofRequest(flight)
                        // ESGG paper: XFER from UTFLYGNING / soft G/A → pin bottom tray
                        const inUtflygning =
                            staticConfig.look === "paper" &&
                            (strip.sectionId === "ctr_dep" ||
                                strip.sectionId.endsWith("_ctr_dep") ||
                                !!flight.missedApproach)
                        if (inUtflygning) {
                            // Ensure strip is in ctr_dep before pin (soft G/A may still be on runway)
                            if (
                                flight.missedApproach &&
                                strip.sectionId !== "ctr_dep" &&
                                !strip.sectionId.endsWith("_ctr_dep")
                            ) {
                                // Section rules will move on reevaluate; start pin session now
                                flightStore.startUtflygningPin(strip.callsign)
                            } else {
                                flightStore.startUtflygningPin(strip.callsign)
                                const pinned = flightStore.pinUtflygningTray(strip.callsign)
                                if (pinned) {
                                    const applied = store.updateStripFromFlight(pinned.strip, {
                                        allowPositionChange: true,
                                    })
                                    for (const shifted of pinned.shiftedCallsigns) {
                                        const shiftedStrip = flightStore.regenerateStrip(shifted)
                                        if (shiftedStrip) {
                                            broadcastStrip(
                                                store.updateStripFromFlight(shiftedStrip, {
                                                    allowPositionChange: true,
                                                }),
                                            )
                                        }
                                    }
                                    broadcastStrip(applied)
                                }
                            }
                        }
                    }
                // PARK (TERM): PARK + release + clear scratchpad + clear HS + clear EST
                } else if (message.action === "PARK") {
                    const parkFlight = flightStore.getFlight(strip.callsign)
                    sendUdp(JSON.stringify({ type: "setGroundState", callsign: strip.callsign, state: "PARK" }))
                    sendUdp(JSON.stringify({ type: "release", callsign: strip.callsign }))
                    sendUdp(
                        JSON.stringify({
                            type: "clearScratchpad",
                            callsign: strip.callsign,
                        } satisfies OutboundPluginCommand),
                    )
                    sendUdp(
                        JSON.stringify({
                            type: "setHs",
                            callsign: strip.callsign,
                            value: "",
                        } satisfies OutboundPluginCommand),
                    )
                    sendUdp(
                        JSON.stringify({
                            type: "setCoo",
                            callsign: strip.callsign,
                            coo: false,
                        } satisfies OutboundPluginCommand),
                    )
                    if (parkFlight) {
                        parkFlight.suppressParkDelete = undefined
                        parkFlight.hs = undefined
                        parkFlight.coo = undefined
                        // Scratch-derived strip fields (remarks/HP live in scratch)
                        parkFlight.remarks = undefined
                        parkFlight.hp = undefined
                    }
                // CTL_GS: set ARR groundstate + set cleared-to-land (from ground state menu)
                } else if (message.action === "CTL_GS") {
                    sendUdp(JSON.stringify({ type: "setGroundState", callsign: strip.callsign, state: "ARR" }))
                    sendUdp(JSON.stringify({ type: "setClearedToLand", callsign: strip.callsign } satisfies OutboundPluginCommand))
                // ROF: try TopSky first; on failure/timeout → EFS-native (set pending ROF on strip)
                } else if (message.action === "ROF") {
                    sendUdp(JSON.stringify({ type: "rof", callsign: strip.callsign } satisfies OutboundPluginCommand))
                    flightStore.startRofCooldown(strip.callsign, () => reevaluateAndBroadcast(strip.callsign))
                    scheduleTopSkyRofFallback(strip.callsign)
                    reevaluateAndBroadcast(strip.callsign)
                } else if (message.action === "toggleClearanceFlag") {
                    const clrFlight = flightStore.getFlight(strip.callsign)
                    const desired = !(clrFlight?.clearance ?? false)
                    sendUdp(JSON.stringify({ type: "toggleClearanceFlag", callsign: strip.callsign, desired } satisfies OutboundPluginCommand))
                    if (clrFlight) {
                        flightStore.applyOptimisticClearance(strip.callsign, desired)
                        // CD/DEL: voice CLR on → ASSUME (undo does not RELEASE)
                        if (desired) {
                            assumeCdDelKlareringDep(clrFlight, strip.stripType, "voice CLR")
                        }
                    }
                } else if (message.action === "toggleClearanceRead") {
                    // Paper FPS col 4 (CLR read).
                    // In CLEARED (or ES CLR set): unsetting also clears CLR correct + ES CLR → strip moves.
                    // Otherwise: local toggle; unchecking also clears col 5 local mark.
                    // Undo never RELEASE — ownership stays if already assumed.
                    if (flight) {
                        const inCleared =
                            strip.sectionId === "cleared" || strip.sectionId.endsWith("_cleared")
                        if (flight.clearance || inCleared) {
                            // Always UDP (same as toggleClearanceFlag) — --mock must not block ES sync
                            sendUdp(
                                JSON.stringify({
                                    type: "toggleClearanceFlag",
                                    callsign: strip.callsign,
                                    desired: false,
                                } satisfies OutboundPluginCommand),
                            )
                            flightStore.applyOptimisticClearance(strip.callsign, false)
                            flight.clearanceRead = false
                        } else {
                            const turningOn = !flight.clearanceRead
                            flight.clearanceRead = !flight.clearanceRead
                            if (!flight.clearanceRead) flight.clearanceReadback = false
                            if (turningOn) {
                                assumeCdDelKlareringDep(flight, strip.stripType, "CLR read")
                            }
                        }
                        reevaluateAndBroadcast(strip.callsign)
                        void pushStripToRemote(strip.id)
                    }
                } else if (message.action === "toggleClearanceReadback") {
                    // Paper FPS col 5 (CLR correct) — sets/clears EuroScope CLR flag.
                    // Checking 5 also checks 4. ES CLR on shows both as checked.
                    if (flight) {
                        const desired = !(flight.clearance || flight.clearanceReadback)
                        // Always UDP — do not gate on !mock (inbound ES→EFS still works under --mock)
                        sendUdp(
                            JSON.stringify({
                                type: "toggleClearanceFlag",
                                callsign: strip.callsign,
                                desired,
                            } satisfies OutboundPluginCommand),
                        )
                        flightStore.applyOptimisticClearance(strip.callsign, desired)
                        // Voice CLR correct clears pending DCL state (same as toggleClearanceFlag)
                        if (desired && flight.dclStatus) {
                            console.log(`[DCL] Clearing DCL state for ${strip.callsign} (CLR correct)`)
                            flight.dclStatus = undefined
                            flight.dclMessage = undefined
                            flight.dclClearance = undefined
                            flight.dclSeqNumber = undefined
                            flight.dclPdcNumber = undefined
                            flight.dclSentAt = undefined
                            flight.dclRequestedAt = undefined
                        }
                        // CD/DEL: CLR correct on → ASSUME (undo does not RELEASE)
                        if (desired) {
                            assumeCdDelKlareringDep(flight, strip.stripType, "CLR correct")
                        }
                        reevaluateAndBroadcast(strip.callsign)
                    }
                // GOA: MISAP_ + MAP heading/CFL (ESSA Appendix A or ESGG H020/H200 + A030)
                } else if (message.action === "GOA") {
                    sendUdp(JSON.stringify({ type: "goaround", callsign: strip.callsign } satisfies OutboundPluginCommand))
                    const goaFlight = flightStore.getFlight(strip.callsign)
                    if (goaFlight) {
                        // Optimistic: clear ATA / CTL immediately (plugin also sends MISAP_)
                        goaFlight.ata = undefined
                        goaFlight.clearedToLand = false
                        goaFlight.missedApproach = true
                        let heading: number | undefined
                        let altitudeFt: number | undefined
                        let logExtra = ""
                        if (isEssaRolesConfig(staticConfig)) {
                            const essa = staticConfig.activeRunways?.["ESSA"]
                            const configId =
                                resolveEssaRwyConfigId(essa?.arr ?? [], essa?.dep ?? []) ?? "1"
                            const map = resolveMapDelivery(configId, goaFlight.arrRwy)
                            heading = map.heading
                            altitudeFt = map.altitudeFt
                            logExtra =
                                map.heading != null
                                    ? `ESSA ${configId} arr=${goaFlight.arrRwy ?? "?"} → ${map.sector}`
                                    : `ESSA ${configId} arr=${goaFlight.arrRwy ?? "?"} ≠ config ARR — MISAP only`
                        } else if (staticConfig.myAirports.some((a) => a.toUpperCase() === "ESGG")) {
                            const arrRwy =
                                goaFlight.arrRwy ||
                                staticConfig.activeRunways?.["ESGG"]?.arr?.[0]
                            const map = resolveEsggMapDelivery(arrRwy)
                            heading = map.heading
                            altitudeFt = map.altitudeFt
                            logExtra = `ESGG arr=${arrRwy ?? "?"} → APP-${map.appSide}`
                        }
                        if (heading != null && heading > 0) {
                            sendUdp(
                                JSON.stringify({
                                    type: "assignHeading",
                                    callsign: strip.callsign,
                                    heading,
                                } satisfies OutboundPluginCommand)
                            )
                        }
                        if (altitudeFt != null && altitudeFt > 0) {
                            sendUdp(
                                JSON.stringify({
                                    type: "assignCfl",
                                    callsign: strip.callsign,
                                    altitude: altitudeFt,
                                } satisfies OutboundPluginCommand)
                            )
                        }
                        if (logExtra) {
                            console.log(
                                heading != null
                                    ? `[GOA] ${strip.callsign} ${logExtra}: H${String(heading).padStart(3, "0")}/${altitudeFt ?? "?"}FT`
                                    : `[GOA] ${strip.callsign} ${logExtra}`
                            )
                        }
                        reevaluateAndBroadcast(strip.callsign)
                    }
                } else if (message.action === "resetSquawk") {
                    // TopSky AllocateSSR only — never invent a code (incl. --mock).
                    // Clear until EuroScope reports the assigned squawk.
                    const sqFlight = flightStore.getFlight(strip.callsign)
                    if (requestTopskySquawkReset(strip.callsign)) {
                        if (sqFlight) sqFlight.squawk = undefined
                        reevaluateAndBroadcast(strip.callsign)
                    }
                // ESGG paper soft G/A (col-3 arrow scribble / equivalent) — EFSGA ann, not TopSky MISAP_
                } else if (message.action === "softGA") {
                    if (staticConfig.look === "paper" && flight) {
                        // Keep CTL if already set — soft G/A must not clear it
                        flightStore.applySoftMissedApproach(strip.callsign)
                        sendUdp(
                            JSON.stringify({
                                type: "setEfsGoAround",
                                callsign: strip.callsign,
                            } satisfies OutboundPluginCommand),
                        )
                        console.log(`[ACTION] softGA ${strip.callsign} (EFSGA, keep CTL, no TopSky MISAP_)`)
                        reevaluateAndBroadcast(strip.callsign)
                    }
                } else if (message.action === "WEATHER") {
                    // TopSky WEATHER manual alert (MALRT) — pulse WX_; UI via weatherGiven.
                    // TopSky often consumes WX_ immediately (scratch empty) — keep local flag.
                    if (flight) {
                        if (flight.weatherGiven) {
                            // Toggle off: pulse WX_ again so TopSky clears MALRT if scratch already empty
                            flight.weatherGiven = false
                            flight.weatherGivenHoldOffUntil = Date.now() + 2500
                            flight.scratchFieldsHoldUntil = Date.now() + 2500
                            sendUdp(
                                JSON.stringify({
                                    type: "setScratch",
                                    callsign: strip.callsign,
                                    value: "WX_",
                                } satisfies OutboundPluginCommand),
                            )
                            console.log(`[ACTION] WEATHER off ${strip.callsign} (pulse WX_)`)
                        } else {
                            flight.weatherGiven = true
                            flight.weatherGivenHoldOffUntil = undefined
                            flight.scratchFieldsHoldUntil = Date.now() + 2500
                            sendUdp(
                                JSON.stringify({
                                    type: "setScratch",
                                    callsign: strip.callsign,
                                    value: "WX_",
                                } satisfies OutboundPluginCommand),
                            )
                            console.log(`[ACTION] WEATHER on ${strip.callsign} (WX_)`)
                        }
                        reevaluateAndBroadcast(strip.callsign)
                    }
                } else {
                    const pluginCommand = mapStripActionToPluginCommand(message.action, strip.callsign)
                    if (pluginCommand) {
                        sendUdp(JSON.stringify(pluginCommand))
                    }
                    // CTL on a missed-approach flight: clear TopSky MISAP_ and/or EFS soft G/A
                    if (message.action === "CTL") {
                        const maFlight = flightStore.getFlight(strip.callsign)
                        if (maFlight?.missedApproach && !maFlight.efsGoAround) {
                            sendUdp(JSON.stringify({ type: "clearScratchpad", callsign: strip.callsign } satisfies OutboundPluginCommand))
                        }
                        if (maFlight?.efsGoAround) {
                            sendUdp(
                                JSON.stringify({
                                    type: "unsetEfsGoAround",
                                    callsign: strip.callsign,
                                } satisfies OutboundPluginCommand),
                            )
                            flightStore.clearSoftMissedApproach(strip.callsign)
                        }
                    }
                }

                // HP clears on CFTO; HS clears on LINE UP or CFTO (match EFS 0.0.17).
                // RTO undoes CFTO → LINEUP: clear HS and HP (same as leaving takeoff).
                if (flight && (message.action === "LU" || message.action === "CTO" || message.action === "RTO")) {
                    const clearHp = message.action === "CTO" || message.action === "RTO"
                    const clearHs = true
                    if (clearHp && flight.hp) {
                        flight.hp = undefined
                        const scratchValue = buildCombinedScratch(flight.remarks, undefined)
                        sendUdp(
                            JSON.stringify({
                                type: "setScratch",
                                callsign: strip.callsign,
                                value: scratchValue,
                            } satisfies OutboundPluginCommand),
                        )
                    }
                    if (clearHs && flight.hs) {
                        flight.hs = undefined
                        sendUdp(
                            JSON.stringify({
                                type: "setHs",
                                callsign: strip.callsign,
                                value: "",
                            } satisfies OutboundPluginCommand),
                        )
                    }
                }

                // RTO: clear ATD so green ATD/CFTO cues drop with LINEUP (CFTO flag is DEPA-only)
                if (flight && message.action === "RTO" && flight.atd) {
                    flight.atd = undefined
                    console.log(`[ATD] ${strip.callsign} cleared on RTO`)
                }

                // Optimistic GS for live mode (hold against runway ARR echo after TXI/TXO/…)
                const optimisticGs: Record<string, string> = {
                    PUSH: "PUSH",
                    LU: "LINEUP",
                    RTO: "LINEUP",
                    CTO: "DEPA",
                    TXO: "TAXI",
                    TXI: "TXIN",
                    PARK: "PARK",
                    FRQ: "ONFREQ",
                    STUP: "STUP",
                    DEICE: "DE-ICE",
                    READY: "DE-ICE",
                    ARR: "ARR",
                    CTL_GS: "ARR",
                    NOGS: "",
                }
                if (flight && !cliArgs.mock && message.action in optimisticGs) {
                    flightStore.applyOptimisticGroundstate(strip.callsign, optimisticGs[message.action]!)
                    if (message.action === "CTL_GS") {
                        flight.clearedToLand = true
                        flight.missedApproach = false
                    }
                    reevaluateAndBroadcast(strip.callsign)
                }
                // Paper CTL checkbox / scribble L — optimistic so section rules move immediately.
                // Pending APP/CTR→TWR inbound: ASSUME first so runway_cleared_to_land → PÅ BANAN.
                if (flight && !cliArgs.mock && (message.action === "CTL" || message.action === "unsetCTL")) {
                    flight.clearedToLand = message.action === "CTL"
                    if (message.action === "CTL") {
                        flight.missedApproach = false
                        flight.efsGoAround = false
                        assumePendingAppInboundOnCtl(strip, flight)
                    }
                    reevaluateAndBroadcast(strip.callsign)
                }

                // When toggling clearance flag (user pressed OK for voice clearance), clear DCL state
                if (message.action === "toggleClearanceFlag") {
                    if (flight && flight.dclStatus) {
                        console.log(`[DCL] Clearing DCL state for ${strip.callsign} (voice clearance)`)
                        flight.dclStatus = undefined
                        flight.dclMessage = undefined
                        flight.dclClearance = undefined
                        flight.dclSeqNumber = undefined
                        flight.dclPdcNumber = undefined
                        flight.dclSentAt = undefined
                        flight.dclRequestedAt = undefined
                    }
                }

                // In mock mode, apply actions locally since there's no ES plugin roundtrip
                if (cliArgs.mock && flight) {
                    switch (message.action) {
                        case "toggleClearanceFlag":
                            // Optimistic clearance already applied above
                            break
                        case "ASSUME":
                            flight.controller = staticConfig.myCallsign
                            flight.controllerId = staticConfig.myPositionId
                            flight.handoffTargetController = ""
                            flight.ownershipOptimisticUntil = Date.now() + 5000
                            if (
                                staticConfig.look === "paper" &&
                                flightStore.isGndTaxiPinned(strip.callsign) &&
                                (strip.sectionId === "taxi" || strip.sectionId.endsWith("_taxi"))
                            ) {
                                const pinExitGs =
                                    strip.stripType === "departure" ? "TAXI" : "TXIN"
                                flight.groundstate = pinExitGs
                                flightStore.releaseGndTaxiPinToMainTop(strip.callsign)
                            }
                            maybeAutoPrepOnAssume(flight.callsign)
                            break
                        case "REFUSE":
                            flight.handoffTargetController = ""
                            flight.handoffTargetControllerId = undefined
                            break
                        case "resetSquawk":
                            // Already applied above when the UDP request was accepted
                            break
                        case "PUSH":
                            flight.groundstate = "PUSH"
                            break
                        case "LU":
                            flight.groundstate = "LINEUP"
                            flight.hs = undefined
                            break
                        case "RTO":
                            // Undo CFTO → LINEUP (UI then offers TAXI OUT / TAXI IN); clear ATD
                            flight.groundstate = "LINEUP"
                            flight.hs = undefined
                            flight.hp = undefined
                            flight.atd = undefined
                            break
                        case "CTO":
                            flight.groundstate = "DEPA"
                            flight.hs = undefined
                            flight.hp = undefined
                            break
                        case "TXO":
                            flight.groundstate = "TAXI"
                            break
                        case "TXI":
                            flight.groundstate = "TXIN"
                            break
                        case "PARK":
                            flight.groundstate = "PARK"
                            flight.suppressParkDelete = undefined
                            flight.hs = undefined
                            flight.remarks = undefined
                            flight.hp = undefined
                            flight.coo = undefined
                            break
                        case "CTL":
                            flight.clearedToLand = true
                            flight.missedApproach = false
                            flight.efsGoAround = false
                            assumePendingAppInboundOnCtl(strip, flight)
                            break
                        case "unsetCTL":
                            flight.clearedToLand = false
                            break
                        case "softGA":
                            flightStore.applySoftMissedApproach(strip.callsign)
                            break
                        case "GOA": {
                            flight.clearedToLand = false
                            flight.missedApproach = true
                            flight.ata = undefined
                            if (isEssaRolesConfig(staticConfig)) {
                                const essa = staticConfig.activeRunways?.["ESSA"]
                                const configId =
                                    resolveEssaRwyConfigId(essa?.arr ?? [], essa?.dep ?? []) ?? "1"
                                const map = resolveMapDelivery(configId, flight.arrRwy)
                                if (map.heading != null && map.heading > 0) flight.ahdg = map.heading
                                if (map.altitudeFt != null && map.altitudeFt > 0) flight.cfl = map.altitudeFt
                            } else if (staticConfig.myAirports.some((a) => a.toUpperCase() === "ESGG")) {
                                const arrRwy =
                                    flight.arrRwy || staticConfig.activeRunways?.["ESGG"]?.arr?.[0]
                                const map = resolveEsggMapDelivery(arrRwy)
                                if (map.heading != null && map.heading > 0) flight.ahdg = map.heading
                                if (map.altitudeFt > 0) flight.cfl = map.altitudeFt
                            }
                            break
                        }
                        case "XFER": {
                            const target = resolveXferTarget(strip, flight)
                            flight.handoffTargetController = target || ""
                            if (target) flight.handoffOptimisticUntil = Date.now() + 3000
                            break
                        }
                        case "READY": {
                            flight.groundstate = "DE-ICE"
                            const readyTarget = resolveXferTarget(strip, flight)
                            flight.handoffTargetController = readyTarget || ""
                            if (readyTarget) flight.handoffOptimisticUntil = Date.now() + 3000
                            break
                        }
                        case "FRQ":
                            flight.groundstate = "ONFREQ"
                            break
                        case "STUP":
                            flight.groundstate = "STUP"
                            break
                        case "DEICE":
                            flight.groundstate = "DE-ICE"
                            break
                        case "ARR":
                            flight.groundstate = "ARR"
                            break
                        case "CTL_GS":
                            flight.groundstate = "ARR"
                            flight.clearedToLand = true
                            flight.missedApproach = false
                            break
                        case "NOGS":
                            flight.groundstate = ""
                            flight.groundstateClearedUntil = Date.now() + 3000
                            break
                    }

                    reevaluateAndBroadcast(strip.callsign)
                } else if (
                    message.action === "toggleClearanceFlag" ||
                    message.action === "ASSUME" ||
                    message.action === "REFUSE" ||
                    message.action === "XFER" ||
                    message.action === "READY" ||
                    message.action === "DEICE"
                ) {
                    // Non-mock optimistic updates: apply local state immediately without waiting for plugin round-trip
                    if (message.action === "ASSUME" && flight) {
                        // Optimistic until ES ownership echo confirms StartTracking
                        flight.controller = staticConfig.myCallsign
                        flight.controllerId = staticConfig.myPositionId
                        flight.handoffTargetController = ""
                        flight.handoffOptimisticUntil = undefined
                        flight.ownershipOptimisticUntil = Date.now() + 5000
                        maybeAutoPrepOnAssume(flight.callsign)
                        // ESGG paper: ASSUME while above-push CD→GND pinned → unpin
                        if (
                            staticConfig.look === "paper" &&
                            flightStore.isAbovePushPinned(strip.callsign)
                        ) {
                            flightStore.clearAbovePushPinned(strip.callsign)
                        }
                        // ESGG paper: ASSUME while PÅ TAXI pinned → set GS + unpin to top of main
                        if (
                            staticConfig.look === "paper" &&
                            flightStore.isGndTaxiPinned(strip.callsign) &&
                            (strip.sectionId === "taxi" || strip.sectionId.endsWith("_taxi"))
                        ) {
                            const pinExitGs =
                                strip.stripType === "departure" ? "TAXI" : "TXIN"
                            if ((flight.groundstate || "").toUpperCase() !== pinExitGs) {
                                sendUdp(
                                    JSON.stringify({
                                        type: "setGroundState",
                                        callsign: strip.callsign,
                                        state: pinExitGs,
                                    } satisfies OutboundPluginCommand),
                                )
                                flightStore.applyOptimisticGroundstate(strip.callsign, pinExitGs)
                            }
                            const released = flightStore.releaseGndTaxiPinToMainTop(strip.callsign)
                            if (released.didUnpin) {
                                const updated = flightStore.regenerateStrip(strip.callsign)
                                if (updated) {
                                    store.updateStripFromFlight(updated, {
                                        allowPositionChange: true,
                                    })
                                }
                                for (const shifted of released.shiftedCallsigns) {
                                    const shiftedStrip = flightStore.regenerateStrip(shifted)
                                    if (shiftedStrip) {
                                        store.updateStripFromFlight(shiftedStrip, {
                                            allowPositionChange: true,
                                        })
                                    }
                                }
                            }
                        }
                    } else if (message.action === "REFUSE" && flight) {
                        flight.handoffTargetController = ""
                        flight.handoffTargetControllerId = undefined
                        flight.handoffOptimisticUntil = undefined
                    } else if ((message.action === "READY" || message.action === "DEICE") && flight) {
                        flight.groundstate = "DE-ICE"
                    }
                    // toggleClearanceFlag: optimistic clearance already applied above
                    reevaluateAndBroadcast(strip.callsign)
                }
            } else {
                console.log(`[ACTION] ${message.action} on unknown strip ${message.stripId}`)
            }
            break
        }

        case "stripAssign": {
            const strip = store.getStrip(message.stripId)
            if (strip) {
                console.log(`[ASSIGN] ${message.assignType} = "${message.value}" on ${strip.callsign}`)
                let pluginCommand: OutboundPluginCommand | null = null
                let mockCflAuto: number | undefined
                switch (message.assignType) {
                    case "assignDepartureRunway":
                        pluginCommand = { type: "assignDepartureRunway", callsign: strip.callsign, runway: message.value }
                        break
                    case "assignArrivalRunway":
                        pluginCommand = { type: "assignArrivalRunway", callsign: strip.callsign, runway: message.value }
                        break
                    case "assignSid":
                        pluginCommand = { type: "assignSid", callsign: strip.callsign, sid: message.value }
                        if (message.value) {
                            const flightForSid = flightStore.getFlight(strip.callsign)
                            // Real SID replaces DCT
                            if (flightForSid?.direct) {
                                flightForSid.direct = undefined
                                sendUdp(JSON.stringify({
                                    type: "assignDirect",
                                    callsign: strip.callsign,
                                    point: "",
                                } satisfies OutboundPluginCommand))
                            }
                            // Keep custom CFL when already assigned (cfl > 2); same guard as preferred-SID path
                            const hasCustomCfl =
                                flightForSid?.cfl != null && flightForSid.cfl > 2
                            if (!hasCustomCfl) {
                                const slow =
                                    !!strip.isSlow ||
                                    hasSlowRemark(strip.remarks) ||
                                    isTrackSidName(message.value)
                                const sidAlt = resolveSidAltitude(strip.adep, message.value, slow)
                                if (sidAlt !== undefined) {
                                    sendUdp(JSON.stringify({ type: "assignCfl", callsign: strip.callsign, altitude: sidAlt }))
                                    console.log(`[ASSIGN] Auto-CFL ${sidAlt} for SID ${message.value} at ${strip.adep}`)
                                    mockCflAuto = sidAlt
                                }
                            }
                        }
                        break
                    case "assignHeading":
                        pluginCommand = { type: "assignHeading", callsign: strip.callsign, heading: parseInt(message.value, 10) || 0 }
                        break
                    case "assignDirect": {
                        // Empty = clear immediately. Non-empty DCT is sent AFTER SID/route
                        // cleanup below so AmendFlightPlan does not wipe the FLEG update.
                        const point = (message.value || "").trim().toUpperCase()
                        if (!point) {
                            pluginCommand = { type: "assignDirect", callsign: strip.callsign, point: "" }
                        }
                        break
                    }
                    case "assignCfl":
                        pluginCommand = { type: "assignCfl", callsign: strip.callsign, altitude: parseInt(message.value, 10) || 0 }
                        break
                    case "assignAppClr": {
                        // CA / VA / CAT2 / CAT3 / OS / custom APPCLR — TopSky CFL menu approach keys
                        const app = (message.value || "").trim().toUpperCase()
                        if (!app || app.length > 4) break
                        const flightApp = flightStore.getFlight(strip.callsign)
                        if (app === "CA") {
                            if (flightApp) {
                                flightApp.approachType = undefined
                                flightApp.cfl = 1
                            }
                            pluginCommand = { type: "assignCfl", callsign: strip.callsign, altitude: 1 }
                        } else if (app === "VA") {
                            if (flightApp) {
                                flightApp.approachType = undefined
                                flightApp.cfl = 2
                            }
                            pluginCommand = { type: "assignCfl", callsign: strip.callsign, altitude: 2 }
                        } else {
                            const cflAlt = app === "OS" ? 2 : 1
                            if (flightApp) {
                                flightApp.approachType = app
                                flightApp.cfl = cflAlt
                            }
                            // Match TopSky: /CAT3/ then /APPTYPE/CAT3/ (transient scratch)
                            if (app === "CAT2" || app === "CAT3" || app === "OS") {
                                sendUdp(JSON.stringify({
                                    type: "setScratchTmp",
                                    callsign: strip.callsign,
                                    value: `/${app}/`,
                                } satisfies OutboundPluginCommand))
                            }
                            sendUdp(JSON.stringify({
                                type: "setScratchTmp",
                                callsign: strip.callsign,
                                value: `/APPTYPE/${app}/`,
                            } satisfies OutboundPluginCommand))
                            pluginCommand = { type: "assignCfl", callsign: strip.callsign, altitude: cflAlt }
                        }
                        break
                    }
                }
                if (pluginCommand) {
                    sendUdp(JSON.stringify(pluginCommand))
                }

                // Persist controller SID choice for strip display (overrides first-FPL-point fallback)
                const flightForAssign = flightStore.getFlight(strip.callsign)
                if (flightForAssign && message.assignType === "assignCfl") {
                    const feet = parseInt(message.value, 10) || 0
                    flightForAssign.cfl = feet
                    if (feet === 0 || feet > 2) flightForAssign.approachType = undefined
                    else if (feet === 1 || feet === 2) {
                        // Plain CA/VA from altitude list path — clear typed APPCLR
                        if (message.value === "1" || message.value === "2") {
                            flightForAssign.approachType = undefined
                        }
                    }
                }
                if (flightForAssign && message.assignType === "assignSid") {
                    const newSid = message.value || undefined
                    flightForAssign.sidDisplayOverride = newSid
                    flightForAssign.sid = newSid
                    if (mockCflAuto !== undefined) flightForAssign.cfl = mockCflAuto
                    // Track / SLOW SID → ensure SLOW remarks; re-push scratch after AmendFlightPlan
                    // (ES often clears scratch during route amend, wiping a prior setScratch)
                    // V / Z: never auto-add SLOW flag from SID
                    if (
                        message.value &&
                        isTrackSidName(message.value) &&
                        isIfrSidEligible(strip.flightRules)
                    ) {
                        if (!hasSlowRemark(flightForAssign.remarks)) {
                            flightForAssign.remarks = withSlowRemark(flightForAssign.remarks, true) || undefined
                            console.log(`[REMARKS] ${strip.callsign}: set SLOW (track SID ${message.value})`)
                        }
                        flightStore.markSlowRemarkManual(flightForAssign)
                        flightStore.holdScratchFields(flightForAssign, 3000)
                        const pushSlowScratch = () => {
                            const f = flightStore.getFlight(strip.callsign)
                            if (!f || !hasSlowRemark(f.remarks)) return
                            flightStore.holdScratchFields(f, 2000)
                            const scratchValue = buildCombinedScratch(f.remarks, f.hp)
                            sendUdp(JSON.stringify({
                                type: "setScratch",
                                callsign: strip.callsign,
                                value: scratchValue,
                            } satisfies OutboundPluginCommand))
                        }
                        pushSlowScratch()
                        setTimeout(pushSlowScratch, 300)
                        setTimeout(pushSlowScratch, 900)
                    }
                }
                if (flightForAssign && message.assignType === "assignDepartureRunway") {
                    // Runway change clears SID in ES — drop override too
                    flightForAssign.sidDisplayOverride = undefined
                    flightForAssign.depRwy = message.value || undefined
                    // Re-select preferred SID for the new DEP RWY (after plugin amends ADEP/rwy)
                    if (message.value) {
                        schedulePreferredSidAfterDepRwy(strip, flightForAssign, message.value)
                    }
                }
                if (flightForAssign && message.assignType === "assignArrivalRunway") {
                    flightForAssign.arrRwy = message.value || undefined
                }
                if (flightForAssign && message.assignType === "assignHeading") {
                    const rawHdg = (message.value || "").trim().toUpperCase()
                    // TopSky AHD special: LLZ → scratch /LLZ/ (no numeric heading, no VECT)
                    if (rawHdg === "LLZ") {
                        flightForAssign.llz = true
                        flightForAssign.ahdg = 0
                        flightForAssign.direct = undefined
                        sendUdp(JSON.stringify({
                            type: "assignDirect",
                            callsign: strip.callsign,
                            point: "",
                        } satisfies OutboundPluginCommand))
                        flightStore.holdScratchFields(flightForAssign, 3000)
                        sendUdp(JSON.stringify({
                            type: "setScratch",
                            callsign: strip.callsign,
                            value: "/LLZ/",
                        } satisfies OutboundPluginCommand))
                        console.log(`[ASSIGN] AHD LLZ on ${strip.callsign}`)
                    } else {
                        const hdg = parseInt(message.value, 10) || 0
                        const hadLlz = !!flightForAssign.llz
                        flightForAssign.llz = false
                        flightForAssign.ahdg = hdg
                        // VECT + SID wipe: IFR DEP/local on ground only — never ARR / airborne
                        const vectCapable =
                            (strip.stripType === "departure" || strip.stripType === "local") &&
                            isIfrSidEligible(strip.flightRules || flightForAssign.flightRules)
                        const autoVect = vectCapable && flightForAssign.airborne !== true
                        if (hdg > 0) {
                            cancelPreferredSidAfterDepRwy(strip.id)
                            flightForAssign.direct = undefined
                            sendUdp(JSON.stringify({
                                type: "assignDirect",
                                callsign: strip.callsign,
                                point: "",
                            } satisfies OutboundPluginCommand))
                            if (autoVect) {
                                flightForAssign.sidDisplayOverride = undefined
                                flightForAssign.sid = undefined
                                if (!hasVectRemark(flightForAssign.remarks)) {
                                    flightForAssign.remarks = withVectRemark(flightForAssign.remarks, true) || undefined
                                    console.log(`[REMARKS] ${strip.callsign}: set VECT (AHD ${String(hdg).padStart(3, "0")})`)
                                }
                                flightStore.holdScratchFields(flightForAssign, 3000)
                                const scratchValue = buildCombinedScratch(flightForAssign.remarks, flightForAssign.hp)
                                sendUdp(JSON.stringify({
                                    type: "setScratch",
                                    callsign: strip.callsign,
                                    value: scratchValue,
                                } satisfies OutboundPluginCommand))
                                const route = flightForAssign.route || ""
                                if (hasForcedSidInRoute(route)) {
                                    const tokens = route.trim().split(/\s+/).filter(Boolean)
                                    tokens.shift()
                                    flightForAssign.route = tokens.join(" ")
                                    sendUdp(JSON.stringify({
                                        type: "assignDepartureRunway",
                                        callsign: strip.callsign,
                                        runway: "",
                                    } satisfies OutboundPluginCommand))
                                    console.log(`[ASSIGN] AHD: dropped forced SID from FPL for ${strip.callsign}`)
                                }
                            } else if (hadLlz) {
                                // Leaving LLZ for a numeric ARR heading — restore remarks scratch
                                flightStore.holdScratchFields(flightForAssign, 3000)
                                sendUdp(JSON.stringify({
                                    type: "setScratch",
                                    callsign: strip.callsign,
                                    value: buildCombinedScratch(flightForAssign.remarks, flightForAssign.hp),
                                } satisfies OutboundPluginCommand))
                            }
                        } else {
                            let restoreScratch = hadLlz
                            if (vectCapable && hasVectRemark(flightForAssign.remarks)) {
                                flightForAssign.remarks = withVectRemark(flightForAssign.remarks, false) || undefined
                                console.log(`[REMARKS] ${strip.callsign}: clear VECT (AHD cleared)`)
                                restoreScratch = true
                            }
                            // SID was wiped when AHD/VECT started — restore ESE preferred for strip
                            if (vectCapable) {
                                flightForAssign.sidDisplayOverride = undefined
                                const preferred =
                                    resolvePreferredSidForFlight(flightForAssign) ||
                                    resolveEseSidForFlight(flightForAssign)
                                if (preferred) {
                                    flightForAssign.sid = preferred
                                    console.log(
                                        `[ASSIGN] AHD cleared — restore ESE SID ${preferred} for ${strip.callsign}`,
                                    )
                                } else {
                                    flightForAssign.sid = undefined
                                }
                            }
                            if (restoreScratch) {
                                flightStore.holdScratchFields(flightForAssign, 3000)
                                sendUdp(JSON.stringify({
                                    type: "setScratch",
                                    callsign: strip.callsign,
                                    value: buildCombinedScratch(flightForAssign.remarks, flightForAssign.hp),
                                } satisfies OutboundPluginCommand))
                            } else if (vectCapable) {
                                // Still pin briefly so a stale .VECT echo cannot resurrect VECT
                                flightStore.holdScratchFields(flightForAssign, 3000)
                            }
                        }
                    }
                }
                if (flightForAssign && message.assignType === "assignDirect") {
                    const point = (message.value || "").trim().toUpperCase()
                    flightForAssign.direct = point || undefined
                    if (point) {
                        cancelPreferredSidAfterDepRwy(strip.id)
                        // FPR/DCT: clear SID and AHD (no VECT — following filed route)
                        flightForAssign.sidDisplayOverride = undefined
                        flightForAssign.sid = undefined
                        flightForAssign.ahdg = 0
                        flightForAssign.llz = false
                        if (hasVectRemark(flightForAssign.remarks)) {
                            flightForAssign.remarks = withVectRemark(flightForAssign.remarks, false) || undefined
                            console.log(`[REMARKS] ${strip.callsign}: clear VECT (DCT ${point})`)
                            flightStore.holdScratchFields(flightForAssign, 3000)
                            const scratchValue = buildCombinedScratch(flightForAssign.remarks, flightForAssign.hp)
                            sendUdp(JSON.stringify({
                                type: "setScratch",
                                callsign: strip.callsign,
                                value: scratchValue,
                            } satisfies OutboundPluginCommand))
                        }
                        sendUdp(JSON.stringify({
                            type: "assignHeading",
                            callsign: strip.callsign,
                            heading: 0,
                        } satisfies OutboundPluginCommand))
                        // Drop forced SID/rwy prefix — never inject ADEP/rwy.
                        // ADEP/rwy alone is runway-only (not a SID) — leave it for DCT.
                        const route = flightForAssign.route || ""
                        const hadForcedSid = hasForcedSidInRoute(route)
                        if (hadForcedSid) {
                            const tokens = route.trim().split(/\s+/).filter(Boolean)
                            tokens.shift()
                            flightForAssign.route = tokens.join(" ")
                            sendUdp(JSON.stringify({
                                type: "assignDepartureRunway",
                                callsign: strip.callsign,
                                runway: "",
                            } satisfies OutboundPluginCommand))
                            // Also clear SID via assignSid (drops SID/rwy; ADEP/rwy left alone)
                            sendUdp(JSON.stringify({
                                type: "assignSid",
                                callsign: strip.callsign,
                                sid: "",
                            } satisfies OutboundPluginCommand))
                            console.log(`[ASSIGN] DCT: dropped forced SID from FPL for ${strip.callsign}`)
                        } else {
                            console.log(`[ASSIGN] DCT: FPL unchanged (no forced SID) for ${strip.callsign}`)
                        }
                        // DCT last — SetDirectToPointName + scratch flash updates FLEG
                        sendUdp(JSON.stringify({
                            type: "assignDirect",
                            callsign: strip.callsign,
                            point,
                        } satisfies OutboundPluginCommand))
                        console.log(`[ASSIGN] DCT ${point} for ${strip.callsign}`)
                    } else {
                        // Cleared DCT — restore ESE SID for strip display (not forced into FPL).
                        // ESSA/ESMS/ESGG use preferred tables; other ES airports use ESE exit match
                        // (e.g. ESNU/32 + DEDIT → DEDIT2L).
                        flightForAssign.sidDisplayOverride = undefined
                        const preferred =
                            resolvePreferredSidForFlight(flightForAssign) ||
                            resolveEseSidForFlight(flightForAssign)
                        if (preferred) {
                            flightForAssign.sid = preferred
                            console.log(
                                `[ASSIGN] DCT cleared — restore ESE SID ${preferred} for ${strip.callsign}`,
                            )
                        }
                    }
                }

                // In mock mode, apply assignments locally since there's no ES plugin roundtrip
                if (cliArgs.mock) {
                    const flight = flightStore.getFlight(strip.callsign)
                    if (flight) {
                        switch (message.assignType) {
                            case "assignDepartureRunway":
                                flight.depRwy = message.value || undefined
                                break
                            case "assignArrivalRunway":
                                flight.arrRwy = message.value || undefined
                                break
                            case "assignSid":
                                flight.sid = message.value || undefined
                                if (mockCflAuto !== undefined) {
                                    flight.cfl = mockCflAuto
                                }
                                break
                            case "assignHeading":
                                flight.ahdg = parseInt(message.value, 10) || 0
                                if ((flight.ahdg || 0) > 0) flight.direct = undefined
                                break
                            case "assignDirect":
                                flight.direct = (message.value || "").trim().toUpperCase() || undefined
                                if (flight.direct) {
                                    flight.sid = undefined
                                    flight.sidDisplayOverride = undefined
                                    flight.ahdg = 0
                                } else {
                                    flight.sidDisplayOverride = undefined
                                    const preferred =
                                        resolvePreferredSidForFlight(flight) ||
                                        resolveEseSidForFlight(flight)
                                    if (preferred) flight.sid = preferred
                                }
                                break
                            case "assignCfl": {
                                const feet = parseInt(message.value, 10) || 0
                                flight.cfl = feet
                                if (feet === 0 || feet > 2) flight.approachType = undefined
                                break
                            }
                            case "assignAppClr": {
                                // Already applied on flightApp above; ensure mock has values
                                const app = (message.value || "").trim().toUpperCase()
                                if (app === "CA") {
                                    flight.cfl = 1
                                    flight.approachType = undefined
                                } else if (app === "VA") {
                                    flight.cfl = 2
                                    flight.approachType = undefined
                                } else if (app) {
                                    flight.approachType = app
                                    flight.cfl = app === "OS" ? 2 : 1
                                }
                                break
                            }
                        }

                        // Update DCL clearance preview if there's an active DCL request
                        if (flight.dclStatus === "REQUEST" && flight.origin) {
                            const templateData = buildDclTemplateData(flight, "")
                            try {
                                const preview = fillDclTemplate(flight.origin, templateData)
                                if (preview) {
                                    flight.dclClearance = preview
                                }
                            } catch (err) {
                                console.error(`[DCL] Template preview error: ${err instanceof Error ? err.message : err}`)
                            }
                        }

                        const updatedStrip = flightStore.regenerateStrip(strip.callsign)
                        if (updatedStrip) {
                            store.updateStripFromFlight(updatedStrip)
                            broadcastStrip(updatedStrip)
                        }
                    }
                } else if (
                    message.assignType === "assignSid" ||
                    message.assignType === "assignHeading" ||
                    message.assignType === "assignDirect" ||
                    message.assignType === "assignDepartureRunway" ||
                    message.assignType === "assignArrivalRunway" ||
                    message.assignType === "assignCfl" ||
                    message.assignType === "assignAppClr"
                ) {
                    // Optimistic strip SID/RWY/CFL/AHD display before EuroScope roundtrip
                    const updatedStrip = flightStore.regenerateStrip(strip.callsign)
                    if (updatedStrip) {
                        store.updateStripFromFlight(updatedStrip)
                        broadcastStrip(updatedStrip)
                    }
                }
            } else {
                console.log(`[ASSIGN] ${message.assignType} on unknown strip ${message.stripId}`)
            }
            break
        }

        case "deleteStrip": {
            // Push while strip still in store (need airport / syncKey)
            const before = store.getStrip(message.stripId)
            if (before) void deleteStripFromRemote(before.id)
            const deletedId = store.manualDeleteStrip(message.stripId)
            if (deletedId) {
                broadcastStripDelete(deletedId, socket)
                broadcastDeletedStrips()
                console.log(`[DELETE] Strip ${message.stripId} manually deleted`)
            } else {
                console.log(`[DELETE] Strip ${message.stripId} not found`)
            }
            break
        }

        case "listDeletedStrips": {
            sendMessage(socket, {
                type: "deletedStrips",
                strips: store.getDeletedStripInfos(),
            })
            break
        }

        case "restoreStrip": {
            const result = store.restoreDeletedStrip(message.stripId)
            if (result) {
                const { strip: restored, clearedPark } = result
                // Sync cleared PARK to EuroScope so delete_parked doesn't fire again
                if (clearedPark) {
                    sendUdp(JSON.stringify({
                        type: "setGroundState",
                        callsign: restored.callsign,
                        state: "NOSTATE",
                    } satisfies OutboundPluginCommand))
                }
                broadcastStrip(restored)
                for (const s of store.getStripsForSection(restored.bayId, restored.sectionId, false)) {
                    if (s.id !== restored.id) broadcastStrip(s)
                }
                sendMessage(socket, {
                    type: "deletedStrips",
                    strips: store.getDeletedStripInfos(),
                })
                console.log(
                    `[TRASH] Restored strip ${message.stripId}` +
                        (clearedPark ? " (cleared PARK)" : "")
                )
            } else {
                console.log(`[TRASH] Strip ${message.stripId} not found in trash`)
                sendMessage(socket, {
                    type: "notify",
                    level: "error",
                    text: `Could not restore ${message.stripId}`,
                })
            }
            break
        }

        case "releaseStrip": {
            const strip = store.getStrip(message.stripId)
            if (!strip) {
                console.log(`[RELEASE] Strip ${message.stripId} not found`)
                break
            }

            // Send release command to plugin
            sendUdp(JSON.stringify({ type: "release", callsign: strip.callsign } satisfies OutboundPluginCommand))
            console.log(`[RELEASE] Released ${strip.callsign}`)

            // Clear controller field on flight
            const flight = flightStore.getFlight(strip.callsign)
            if (flight) {
                flight.controller = undefined
                flight.controllerId = undefined
                flight.ownershipOptimisticUntil = undefined
                const updatedStrip = flightStore.regenerateStrip(strip.callsign)
                if (updatedStrip) {
                    store.updateStripFromFlight(updatedStrip)
                    broadcastStrip(updatedStrip)
                }
            }
            break
        }

        case "manualTransfer": {
            const strip = store.getStrip(message.stripId)
            if (!strip) {
                console.log(`[TRANSFER] Strip ${message.stripId} not found`)
                break
            }

            // Send transfer command to plugin with target callsign
            sendUdp(JSON.stringify({
                type: "transfer",
                callsign: strip.callsign,
                targetCallsign: message.targetCallsign
            } satisfies OutboundPluginCommand))
            console.log(`[TRANSFER] Transferred ${strip.callsign} to ${message.targetCallsign}`)

            // Optimistic pending outbound transfer
            const flight = flightStore.getFlight(strip.callsign)
            if (flight) {
                flight.handoffTargetController = message.targetCallsign
                flight.handoffOptimisticUntil = Date.now() + 3000
                reevaluateAndBroadcast(strip.callsign)
            }
            break
        }

        case "dclAction": {
            if (message.action === "login") {
                if (isOfflineVatsimRealm()) {
                    updateDclStatus("unavailable")
                    break
                }
                const logonCode = getLogonCode()
                const callsign = getDclCallsign()

                if (!logonCode || !callsign) {
                    updateDclStatus("error", "No logon code or DCL airport available")
                    break
                }

                // Clean up existing service
                if (hoppieService) {
                    hoppieService.logout()
                    hoppieService = null
                }

                hoppieService = new HoppieService(logonCode, callsign, {
                    onMessage: (from, type, packet) => {
                        console.log(`[HOPPIE] Received: ${from} ${type} ${packet}`)
                        const msg: HoppieMessage = { type: "hoppieMessage", from, messageType: type, packet }
                        broadcast(msg)

                        // Route to DCL handlers
                        if (type === "telex") {
                            handleDclRequest(from, packet)
                        } else if (type === "cpdlc") {
                            handleCpdlcResponse(from, packet)
                        }
                    },
                    onStatusChange: (status, error) => {
                        updateDclStatus(status, error)
                    },
                })

                await hoppieService.login()
            } else if (message.action === "logout") {
                if (hoppieService) {
                    hoppieService.logout()
                    hoppieService = null
                }
                updateDclStatus("available")
            }
            break
        }

        case "dclReject": {
            const strip = store.getStrip(message.stripId)
            if (!strip) break

            const flight = flightStore.getFlight(strip.callsign)
            if (!flight || !flight.dclStatus) break

            console.log(`[DCL] Rejecting DCL for ${strip.callsign}`)
            flight.dclStatus = "REJECTED"
            flight.dclRequestedAt = undefined

            // Send reject CPDLC
            if (hoppieService) {
                const dclCallsign = getDclCallsign()
                const { time, date } = formatTimestamp()
                const seq = hoppieService.getNextSeq()
                hoppieService.sendMessage(
                    strip.callsign,
                    "cpdlc",
                    `/data2/${seq}//NE/DEPART REQUEST STATUS . FSM ${time} ${date} ${dclCallsign} @${strip.callsign}@ RCD REJECTED @REVERT TO VOICE PROCEDURES`,
                )
            }

            // Regenerate and broadcast strip
            const rejStrip = flightStore.regenerateStrip(strip.callsign)
            if (rejStrip) {
                store.updateStripFromFlight(rejStrip)
                broadcastStrip(rejStrip)
            }
            break
        }

        case "dclSend": {
            const strip = store.getStrip(message.stripId)
            if (!strip) break

            const flight = flightStore.getFlight(strip.callsign)
            if (!flight) break

            // Proactive = controller-initiated (no prior REQUEST). Same CLD CPDLC as
            // REQUEST→Send; never sends RCD RECEIVED / STANDBY (that is handleDclRequest only).
            const reason =
                message.proactive && flight.dclStatus !== "REQUEST" ? "proactive" : "manual"
            if (!sendDclClearance(flight, message.remarks, reason)) {
                console.log(`[DCL] Could not send clearance for ${strip.callsign} (reason=${reason})`)
            }
            break
        }

        case "dclSetMode": {
            console.log(`[DCL] Mode changed to: ${message.mode}`)
            currentDclMode = message.mode
            saveUserSettings({ dclMode: message.mode })
            // Broadcast updated DCL status with new mode to all clients
            const modeMsg: DclStatusMessage = { type: "dclStatus", status: currentDclStatus, error: currentDclError, dclMode: currentDclMode }
            broadcast(modeMsg)
            break
        }

        case "updateUserSettings": {
            const update: Partial<UiSettings> = {}
            const incoming = message.settings
            if (typeof incoming.dclSoundEnabled === "boolean") {
                currentUiSettings.dclSoundEnabled = incoming.dclSoundEnabled
                update.dclSoundEnabled = incoming.dclSoundEnabled
            }
            if (typeof incoming.flashChangedTimes === "boolean") {
                currentUiSettings.flashChangedTimes = incoming.flashChangedTimes
                update.flashChangedTimes = incoming.flashChangedTimes
            }
            if (typeof incoming.flashTsatWindow === "boolean") {
                currentUiSettings.flashTsatWindow = incoming.flashTsatWindow
                update.flashTsatWindow = incoming.flashTsatWindow
            }
            if (typeof incoming.showStripOwnership === "boolean") {
                currentUiSettings.showStripOwnership = incoming.showStripOwnership
                update.showStripOwnership = incoming.showStripOwnership
            }
            if (typeof incoming.dimOtherOwnedStrips === "boolean") {
                currentUiSettings.dimOtherOwnedStrips = incoming.dimOtherOwnedStrips
                update.dimOtherOwnedStrips = incoming.dimOtherOwnedStrips
            }
            if (typeof incoming.transferSoundsEnabled === "boolean") {
                currentUiSettings.transferSoundsEnabled = incoming.transferSoundsEnabled
                update.transferSoundsEnabled = incoming.transferSoundsEnabled
            }
            if (typeof incoming.showAppDepXcFrequency === "boolean") {
                currentUiSettings.showAppDepXcFrequency = incoming.showAppDepXcFrequency
                update.showAppDepXcFrequency = incoming.showAppDepXcFrequency
                setForceIdealAppDepFrequency(incoming.showAppDepXcFrequency)
            }
            if (typeof incoming.autoParkEnabled === "boolean") {
                currentUiSettings.autoParkEnabled = incoming.autoParkEnabled
                update.autoParkEnabled = incoming.autoParkEnabled
            }
            if (isAutoLopSsrMode(incoming.autoLopSsr)) {
                currentUiSettings.autoLopSsr = incoming.autoLopSsr
                update.autoLopSsr = incoming.autoLopSsr
            }
            if (typeof incoming.rtcAssrSimulation === "boolean") {
                currentUiSettings.rtcAssrSimulation = incoming.rtcAssrSimulation
                update.rtcAssrSimulation = incoming.rtcAssrSimulation
            }
            if (typeof incoming.contactMeEnabled === "boolean") {
                currentUiSettings.contactMeEnabled = incoming.contactMeEnabled
                update.contactMeEnabled = incoming.contactMeEnabled
            }
            if (typeof incoming.showTobtSetByA === "boolean") {
                currentUiSettings.showTobtSetByA = incoming.showTobtSetByA
                update.showTobtSetByA = incoming.showTobtSetByA
            }
            if (
                incoming.stripPrintSound === "off" ||
                incoming.stripPrintSound === "short" ||
                incoming.stripPrintSound === "long"
            ) {
                currentUiSettings.stripPrintSound = incoming.stripPrintSound
                update.stripPrintSound = incoming.stripPrintSound
            }
            if (incoming.stripPrintMode === "auto" || incoming.stripPrintMode === "manual") {
                currentUiSettings.stripPrintMode = incoming.stripPrintMode
                update.stripPrintMode = incoming.stripPrintMode
            }
            if (typeof incoming.fspServerEnabled === "boolean") {
                currentUiSettings.fspServerEnabled = incoming.fspServerEnabled
                update.fspServerEnabled = incoming.fspServerEnabled
            }
            if (typeof incoming.scribbleSyncEnabled === "boolean") {
                currentUiSettings.scribbleSyncEnabled = incoming.scribbleSyncEnabled
                update.scribbleSyncEnabled = incoming.scribbleSyncEnabled
            }
            if (typeof incoming.stripSyncEnabled === "boolean") {
                currentUiSettings.stripSyncEnabled = incoming.stripSyncEnabled
                update.stripSyncEnabled = incoming.stripSyncEnabled
            }
            if (typeof incoming.scribbleSyncUrl === "string") {
                // Persisted for migration only — UI no longer edits; env / VatIRIS default wins in client
                currentUiSettings.scribbleSyncUrl = incoming.scribbleSyncUrl.trim()
                update.scribbleSyncUrl = currentUiSettings.scribbleSyncUrl
            }
            if (typeof incoming.vatsimCid === "string") {
                const cid = incoming.vatsimCid.trim()
                if (cid === "" || /^\d{4,10}$/.test(cid)) {
                    currentUiSettings.vatsimCid = cid
                    update.vatsimCid = cid
                }
            }
            if (
                incoming.scribbleSyncRealm === "auto" ||
                incoming.scribbleSyncRealm === "live" ||
                incoming.scribbleSyncRealm === "sweatbox" ||
                incoming.scribbleSyncRealm === "playback" ||
                incoming.scribbleSyncRealm === "local"
            ) {
                currentUiSettings.scribbleSyncRealm = incoming.scribbleSyncRealm
                update.scribbleSyncRealm = incoming.scribbleSyncRealm
            }
            if (Object.keys(update).length > 0) {
                saveUserSettings(update)
                console.log(`[SETTINGS] Updated: ${JSON.stringify(update)}`)
                broadcastUserSettings()
                if (
                    typeof update.scribbleSyncEnabled === "boolean" ||
                    typeof update.stripSyncEnabled === "boolean" ||
                    typeof update.scribbleSyncUrl === "string" ||
                    typeof update.vatsimCid === "string" ||
                    typeof update.scribbleSyncRealm === "string"
                ) {
                    const wantsSync =
                        currentUiSettings.scribbleSyncEnabled || currentUiSettings.stripSyncEnabled
                    if (wantsSync && !/^\d{4,10}$/.test(currentUiSettings.vatsimCid.trim())) {
                        const suggested = suggestCidFromEsPrf(EUROSCOPE_DIR)
                        broadcast({
                            type: "openCidDialog",
                            suggestedCid: suggested,
                            reason: "missing",
                        })
                    }
                    restartScribbleSyncPolling()
                    syncOnlineNetworkServices()
                }
                if (typeof update.showAppDepXcFrequency === "boolean") {
                    // Refresh XFER SI/freq on strips (ideal vs covering)
                    store.reprocessAllFlights()
                    broadcastRefresh("APP/DEP XC frequency setting changed")
                }
                if (update.autoParkEnabled === true) {
                    flightStore.applyAutoParkToEligibleFlights()
                    store.reprocessAllFlights()
                    broadcastRefresh("Auto PARK enabled")
                }
                if (update.stripPrintMode === "auto" && staticConfig.look === "paper") {
                    // Create all previously gated strips
                    store.reprocessAllFlights()
                    broadcastRefresh("Strip print mode: auto")
                    lastPendingPrintFp = ""
                    broadcastPendingPrintList()
                } else if (update.stripPrintMode === "manual") {
                    lastPendingPrintFp = ""
                    broadcastPendingPrintList()
                }
            }
            break
        }

        case "listPendingPrint": {
            sendMessage(socket, {
                type: "pendingPrintList",
                flights: flightStore.listPendingPrint(),
            })
            break
        }

        case "printStrip": {
            if (staticConfig.look !== "paper") {
                sendMessage(socket, {
                    type: "notify",
                    level: "error",
                    text: "Strip print is only available in paper-look config",
                })
                break
            }
            void (async () => {
                const result = await flightStore.printStrip(message.callsign)
                if (result.softDeleted) {
                    console.log(`[PRINT] ${message.callsign} soft-deleted by rules`)
                    lastPendingPrintFp = ""
                    broadcastPendingPrintList()
                } else if (result.strip) {
                    const applied = applyPrintStripResult(result)
                    if (applied) {
                        console.log(
                            `[PRINT] Strip printed for ${message.callsign} -> ${applied.sectionId}`,
                        )
                    }
                } else {
                    sendMessage(socket, {
                        type: "notify",
                        level: "info",
                        text: `No FPL found for ${message.callsign.toUpperCase()}`,
                    })
                    lastPendingPrintFp = ""
                    broadcastPendingPrintList()
                }
            })()
            break
        }

        case "switchConfig": {
            console.log(`[CONFIG] Client requested config switch to: ${message.file}`)
            switchConfig(message.file, { manual: true })
            break
        }

        case "setEssaRoles": {
            if (!isEssaRolesConfig(staticConfig)) break
            const roles = (normalizeEssaRoles(message.roles) ?? []) as EssaPositionRole[]
            if (setEssaRoles(roles, message.manual)) {
                saveUserSettings({
                    essaRoles: message.manual ? roles : [],
                    essaRolesManual: message.manual,
                })
                console.log(
                    `[ESSA] Roles ${message.manual ? "manual" : "auto"}: ${(staticConfig.essaRoles ?? []).join(", ")}`
                )
                maybeAutoDisconnectDclWhenNoCdRole("ESSA roles changed")
                store.reprocessAllFlights()
                broadcastStatus()
                broadcastLayout()
                broadcastEssaSepIndicators()
                broadcastRefresh("ESSA roles changed")
            }
            break
        }

        case "setEsggRoles": {
            // Legacy: ESGG roles are auto-only from covering; clear any persisted manual
            if (!isEsggRolesConfig(staticConfig)) break
            if (setEsggRoles([], false)) {
                saveUserSettings({ esggRoles: [], esggRolesManual: false })
                console.log(
                    `[ESGG] Roles (auto covering): ${(staticConfig.esggRoles ?? []).join(", ")}`,
                )
                maybeAutoDisconnectDclWhenNoCdRole("ESGG roles changed")
                store.reprocessAllFlights()
                broadcastStatus()
                broadcastLayout()
                broadcastRefresh("ESGG roles changed")
            }
            break
        }

        case "setColumnAirport": {
            if (setColumnAirport(message.columnIndex, message.airport)) {
                console.log(`[MULTI] Column ${message.columnIndex} -> ${message.airport ?? "(empty)"}`)
                const pruned = pruneOrphanUserAirports()
                applyMultiAirportViewChange({ reprocess: pruned })
            }
            break
        }

        case "addActiveAirport": {
            const icao = message.airport?.toUpperCase()
            if (icao && getAirportByIcao(icao)) {
                const current = staticConfig.activeAirports ?? []
                if (!current.includes(icao)) {
                    setActiveAirports([...current, icao])
                    console.log(`[MULTI] Added active airport ${icao}`)
                    applyMultiAirportViewChange({ reprocess: true })
                }
            }
            break
        }

        case "removeActiveAirport": {
            const icao = message.airport?.toUpperCase()
            if (icao) {
                const current = staticConfig.activeAirports ?? []
                setActiveAirports(current.filter(a => a !== icao))
                console.log(`[MULTI] Removed active airport ${icao}`)
                applyMultiAirportViewChange({ reprocess: true })
            }
            break
        }

        case "setColumnCount": {
            if (setColumnCount(message.count)) {
                console.log(`[MULTI] Column count -> ${message.count}`)
                applyMultiAirportViewChange({ reprocess: false })
            }
            break
        }

        case "createStrip": {
            if (message.stripType === "note") {
                const strip = store.createNoteStrip(
                    message.targetBayId,
                    message.targetSectionId,
                    message.position,
                    message.isBottom,
                    message.airport,
                    message.paperInfoKind,
                )
                if (strip) {
                    console.log(
                        `[CREATE] Note strip ${strip.id} created` +
                            (strip.paperInfoKind ? ` (${strip.paperInfoKind})` : "") +
                            ` -> ${strip.sectionId}`
                    )
                    // Top-insert may have shifted peers — push their new positions first
                    if (message.position === undefined && !message.isBottom) {
                        for (const peer of store.getStripsForSection(strip.bayId, strip.sectionId, false)) {
                            if (peer.id !== strip.id) broadcastStrip(peer)
                        }
                    }
                    broadcastStrip(strip)
                    // Paper empty/info: announce create so peers materialize before first scribble
                    // (flight strips are never create-synced — they come from EuroScope)
                    void pushStripToRemote(strip.id)
                }
            } else if (message.stripType === "vehicle") {
                const strip = store.createVehicleStrip(
                    message.targetBayId,
                    message.targetSectionId,
                    message.position,
                    message.isBottom,
                    message.airport,
                    message.callsign,
                )
                if (strip) {
                    console.log(
                        `[CREATE] Vehicle strip ${strip.id} (${strip.callsign}) -> ${strip.sectionId}`,
                    )
                    broadcastStrip(strip)
                    void pushStripToRemote(strip.id)
                }
            } else {
                // VFR DEP / VFR ARR / CROSS — callsign optional (blank → synthetic id)
                const cs = (message.callsign ?? "").trim().toUpperCase()
                const result = flightStore.createSpecialStrip(
                    message.stripType,
                    cs,
                    message.aircraftType,
                    message.airport,
                    message.targetBayId,
                    message.targetSectionId,
                    message.position,
                    message.isBottom,
                )
                if (result) {
                    const created = store.updateStripFromFlight(result.strip, {
                        allowPositionChange: true,
                    })
                    broadcastStrip(created)
                    console.log(
                        `[CREATE] ${message.stripType} strip for ${cs || created.id} -> ${created.sectionId}`,
                    )

                    // EuroScope FPL only when a real callsign was entered
                    if (cs) {
                        if (message.stripType === "vfrDep") {
                            sendUdp(JSON.stringify({
                                type: "createFlightPlan",
                                callsign: cs,
                                stripType: "vfrDep",
                                origin: result.strip.adep,
                                destination: result.strip.ades,
                                aircraftType: result.strip.aircraftType || "UNKN",
                                flightRules: "V",
                            } satisfies OutboundPluginCommand))
                        } else if (message.stripType === "vfrArr") {
                            sendUdp(JSON.stringify({
                                type: "createFlightPlan",
                                callsign: cs,
                                stripType: "vfrArr",
                                origin: result.strip.adep,
                                destination: result.strip.ades,
                                aircraftType: result.strip.aircraftType || "UNKN",
                                flightRules: "V",
                            } satisfies OutboundPluginCommand))
                        } else if (message.stripType === "cross" && !result.strip.hasMatchingFlight) {
                            sendUdp(JSON.stringify({
                                type: "createFlightPlan",
                                callsign: cs,
                                stripType: "cross",
                                origin: "ZZZZ",
                                destination: "ZZZZ",
                                aircraftType: result.strip.aircraftType || "UNKN",
                                flightRules: "I",
                            } satisfies OutboundPluginCommand))
                        }
                    } else {
                        // Anonymous strips won't appear from EuroScope — create-sync like notes
                        void pushStripToRemote(created.id)
                    }

                    // Broadcast shifted strips (from add-from-top)
                    if (result.shiftedCallsigns && result.shiftedCallsigns.length > 0) {
                        for (const shiftedId of result.shiftedCallsigns) {
                            const shifted = flightStore.regenerateStrip(shiftedId)
                            if (shifted) {
                                const applied = store.updateStripFromFlight(shifted, {
                                    allowPositionChange: true,
                                })
                                broadcastStrip(applied)
                            }
                        }
                    }
                }
            }
            break
        }

        case "updateRemarks": {
            const remarkStrip = store.getStrip(message.stripId)
            if (remarkStrip) {
                const flight = flightStore.getFlight(remarkStrip.callsign)
                if (flight) {
                    // Strip trailing " /HP" if pasted into RMK; keep HP via rebuild
                    let text = message.text.trim()
                    let hpFromText: string | undefined
                    const split = text.match(/^(.*?)\s+\/([A-Z0-9]+)\s*$/i)
                    if (split) {
                        text = split[1]!.trim()
                        hpFromText = split[2]!.trim().toUpperCase()
                    }
                    const prevSlow = hasSlowRemark(flight.remarks)
                    const nextRemarks = text || undefined
                    const nextSlow = hasSlowRemark(nextRemarks)
                    flightStore.markAutoSlowDismissed(flight, flight.remarks, nextRemarks)
                    flight.remarks = nextRemarks
                    if (hpFromText) flight.hp = hpFromText
                    flightStore.markSlowRemarkManual(flight)
                    // Hold across AmendFlightPlan / ES scratch clears so SLOW does not flash off
                    flightStore.holdScratchFields(flight, 3000)
                    const scratchValue = buildCombinedScratch(flight.remarks, flight.hp)
                    sendUdp(JSON.stringify({ type: "setScratch", callsign: remarkStrip.callsign, value: scratchValue } satisfies OutboundPluginCommand))
                    // Clearing SLOW: re-sync CFL to non-slow climb (fixes 3.0 stuck after SLOW off)
                    if (prevSlow && !nextSlow && flight.origin && (!flight.cfl || flight.cfl === 3000)) {
                        const preferred = resolvePreferredSidForFlight(flight)
                        const sidForCfl = preferred || flight.sid
                        if (sidForCfl) {
                            const sidAlt = resolveSidAltitude(flight.origin, sidForCfl, false)
                            if (sidAlt !== undefined) {
                                sendUdp(JSON.stringify({
                                    type: "assignCfl",
                                    callsign: flight.callsign,
                                    altitude: sidAlt,
                                } satisfies OutboundPluginCommand))
                                flight.cfl = sidAlt
                                console.log(`[REMARKS] ${flight.callsign}: SLOW cleared → CFL ${sidAlt}`)
                            }
                        }
                    }
                    const updatedStrip = flightStore.regenerateStrip(remarkStrip.callsign)
                    if (updatedStrip) {
                        store.updateStripFromFlight(updatedStrip)
                        broadcastStrip(updatedStrip)
                    }
                    console.log(`[REMARKS] ${remarkStrip.callsign}: "${flight.remarks ?? ""}" hp=${flight.hp ?? "-"} scratch="${scratchValue}"`)
                }
            }
            break
        }

        case "updateHp": {
            const hpStrip = store.getStrip(message.stripId)
            if (!hpStrip) break
            if (!staticConfig.isController) break
            const flight = flightStore.getFlight(hpStrip.callsign)
            if (!flight) break
            // Scratchpad holding point — /TEXT (keeps remarks)
            const text = (message.text ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
            flight.hp = text || undefined
            flightStore.holdScratchFields(flight, 3000)
            const scratchValue = buildCombinedScratch(flight.remarks, flight.hp)
            sendUdp(JSON.stringify({ type: "setScratch", callsign: hpStrip.callsign, value: scratchValue } satisfies OutboundPluginCommand))
            const updatedStrip = flightStore.regenerateStrip(hpStrip.callsign)
            if (updatedStrip) {
                store.updateStripFromFlight(updatedStrip)
                broadcastStrip(updatedStrip)
            }
            console.log(`[HP] ${hpStrip.callsign}: "${text}" scratch="${scratchValue}"`)
            break
        }

        case "updateHs": {
            const hsStrip = store.getStrip(message.stripId)
            if (!hsStrip) break
            if (!staticConfig.isController) break
            const flight = flightStore.getFlight(hsStrip.callsign)
            if (!flight) break
            // VCH hold short — annotation 4, max 5 chars
            const text = (message.text ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5)
            flight.hs = text || undefined
            sendUdp(JSON.stringify({ type: "setHs", callsign: hsStrip.callsign, value: text } satisfies OutboundPluginCommand))
            const updatedStrip = flightStore.regenerateStrip(hsStrip.callsign)
            if (updatedStrip) {
                store.updateStripFromFlight(updatedStrip)
                broadcastStrip(updatedStrip)
            }
            console.log(`[HS] ${hsStrip.callsign}: "${text}" (VCH)`)
            break
        }

        case "setCoo": {
            const cooStrip = store.getStrip(message.stripId)
            if (!cooStrip) break
            if (!staticConfig.isController) break
            const flight = flightStore.getFlight(cooStrip.callsign)
            if (!flight) break
            flight.coo = message.coo ? true : undefined
            // DepC checkmark clears amber XFL refuse highlight
            if (message.coo) flight.exitCoordRefused = undefined
            // Strip annotation 6 (DepC) — syncs via ES to other EFS; not scratchpad
            sendUdp(JSON.stringify({
                type: "setCoo",
                callsign: cooStrip.callsign,
                coo: !!message.coo,
            } satisfies OutboundPluginCommand))
            const updatedStrip = flightStore.regenerateStrip(cooStrip.callsign)
            if (updatedStrip) {
                store.updateStripFromFlight(updatedStrip)
                broadcastStrip(updatedStrip)
            }
            console.log(`[DepC] ${cooStrip.callsign}: ${message.coo ? "on" : "off"} (ann 6)`)
            break
        }

        case "initiateXflCoordination": {
            // COPX/XFL exit coordination only — never sets clearance flag / DepC / DEP.
            // XFL coordination: plugin tries empty-point first, then LOP point (message.point).
            const xflStrip = store.getStrip(message.stripId)
            if (!xflStrip) break
            if (!staticConfig.isController) break
            const flight = flightStore.getFlight(xflStrip.callsign)
            const altitude =
                typeof message.altitudeFeet === "number" && message.altitudeFeet > 0
                    ? Math.round(message.altitudeFeet)
                    : flight?.xfl && flight.xfl > 0
                      ? flight.xfl
                      : undefined
            // LOP DCT fallback only (e.g. MIKNA) — not ESE COPX
            const point = (message.point || "").trim().toUpperCase() || undefined
            const targetController = (message.targetController || "").trim() || undefined
            if (altitude == null) {
                console.log(`[XFL-COORD] ${xflStrip.callsign}: refused — no XFL altitude`)
                break
            }
            // New Initiate clears amber refuse (plugin also sends exitCoordRefused:false).
            if (flight) flight.exitCoordRefused = undefined
            sendUdp(
                JSON.stringify({
                    type: "initiateCoordination",
                    callsign: xflStrip.callsign,
                    altitude,
                    point,
                    targetController,
                } satisfies OutboundPluginCommand),
            )
            if (currentUiSettings.transferSoundsEnabled) {
                playTransferSound("request")
            }
            console.log(
                `[XFL-COORD] ${xflStrip.callsign}: try empty-point then LOP=${point ?? "(none)"} XFL=${altitude}ft target=${targetController ?? "(auto)"}`,
            )
            break
        }

        case "acceptCoordination": {
            const accStrip = store.getStrip(message.stripId)
            if (!accStrip) break
            if (!staticConfig.isController) break
            // Capture pending ACC level before Accept clears pink fields
            const pendingAlt = accStrip.exitCoordAltitude
            // Accept clears amber refuse (plugin echoes exitCoordRefused:false).
            {
                const flight = flightStore.getFlight(accStrip.callsign)
                if (flight) flight.exitCoordRefused = undefined
            }
            sendUdp(
                JSON.stringify({
                    type: "acceptCoordination",
                    callsign: accStrip.callsign,
                } satisfies OutboundPluginCommand),
            )
            // ESMS special: Accept of ACC's 4000 counter on eligible SID → DepC.
            // Exception to normal "inbound AcceptCoordination never sets EST".
            const esmsAutoDepC =
                isIfrSidEligible(accStrip.flightRules) &&
                (accStrip.stripType === "departure" || accStrip.stripType === "local") &&
                isEsmsAutoCoordSid(accStrip.adep, accStrip.sid, accStrip.runway) &&
                isEsmsAutoCoordReplyAltitude(pendingAlt)
            if (esmsAutoDepC) {
                const flight = flightStore.getFlight(accStrip.callsign)
                if (flight) {
                    flight.coo = true
                    flight.exitCoordRefused = undefined
                    flight.exitCoordPending = undefined
                    flight.exitCoordPoint = undefined
                    flight.exitCoordAltitude = undefined
                }
                sendUdp(
                    JSON.stringify({
                        type: "setCoo",
                        callsign: accStrip.callsign,
                        coo: true,
                    } satisfies OutboundPluginCommand),
                )
                const updatedStrip = flightStore.regenerateStrip(accStrip.callsign)
                if (updatedStrip) {
                    store.updateStripFromFlight(updatedStrip)
                    broadcastStrip(updatedStrip)
                }
                console.log(
                    `[XFL-COORD] ${accStrip.callsign}: ESMS auto DepC on Accept of ${pendingAlt}ft`,
                )
            } else {
                // Accept sound: plugin echoes exitCoordAccepted → flightStore transferSound
                console.log(`[XFL-COORD] ${accStrip.callsign}: accept ACC counter-proposal`)
            }
            break
        }

        case "refuseCoordination": {
            const refStrip = store.getStrip(message.stripId)
            if (!refStrip) break
            if (!staticConfig.isController) break
            sendUdp(
                JSON.stringify({
                    type: "refuseCoordination",
                    callsign: refStrip.callsign,
                } satisfies OutboundPluginCommand),
            )
            if (currentUiSettings.transferSoundsEnabled) {
                playTransferSound("refuse")
            }
            console.log(`[XFL-COORD] ${refStrip.callsign}: refuse ACC counter-proposal`)
            break
        }

        case "amendFlightPlan": {
            const strip = store.getStrip(message.stripId)
            if (!strip) break
            if (!staticConfig.isController) break
            const callsign = strip.callsign
            const {
                type: _t,
                stripId: _id,
                ...fields
            } = message

            // Normalize levels to feet for the plugin when possible
            const cmd: OutboundPluginCommand = {
                type: "amendFlightPlan",
                callsign,
                ...fields,
            }
            if (fields.rfl !== undefined) {
                const feet = parseAltitudeToFeet(fields.rfl)
                if (feet != null) cmd.rfl = feet
            }
            if (fields.cfl !== undefined) {
                const feet = parseAltitudeToFeet(fields.cfl)
                if (feet != null) cmd.cfl = feet
            }
            if (fields.squawk !== undefined) {
                const sq = String(fields.squawk).replace(/^A/i, "").trim()
                const n = normalizeAssignedSquawk(sq)
                if (n !== undefined) cmd.squawk = n
                else delete (cmd as { squawk?: string }).squawk
            }
            sendUdp(JSON.stringify(cmd))

            // Optimistic local patch until ES echoes FPD/CAD
            const flight = flightStore.getFlight(callsign)
            if (flight) {
                if (fields.flightRules !== undefined) flight.flightRules = fields.flightRules || undefined
                if (fields.aircraftType !== undefined) flight.aircraftType = fields.aircraftType || undefined
                if (fields.wakeTurbulence !== undefined) flight.wakeTurbulence = fields.wakeTurbulence || undefined
                if (fields.origin !== undefined) flight.origin = fields.origin || undefined
                if (fields.destination !== undefined) flight.destination = fields.destination || undefined
                if (fields.alternate !== undefined) flight.alternate = fields.alternate || undefined
                if (fields.eobt !== undefined) flight.eobt = fields.eobt || undefined
                if (fields.eobd !== undefined) flight.eobd = fields.eobd || undefined
                if (fields.tas !== undefined) flight.tas = fields.tas || undefined
                if (fields.route !== undefined) flight.route = fields.route || undefined
                if (fields.fplRemarks !== undefined) flight.fplRemarks = fields.fplRemarks || undefined
                if (fields.eet !== undefined) flight.filedEet = fields.eet || undefined
                if (typeof cmd.rfl === "number") flight.rfl = cmd.rfl
                if (typeof cmd.cfl === "number") flight.cfl = cmd.cfl
                if (fields.faaEquipment !== undefined) {
                    const type = fields.aircraftType || flight.aircraftType || "ZZZZ"
                    const letter = String(fields.faaEquipment).trim().toUpperCase().slice(0, 1)
                    applyParsedEquipment(
                        flight,
                        parseAircraftInfo(`${type}/${letter}`, letter, flight.rvsm),
                        `${type}/${letter}`,
                    )
                } else if (fields.equipment !== undefined || fields.surveillance !== undefined) {
                    if (fields.equipment !== undefined) flight.equipment = fields.equipment || undefined
                    if (fields.surveillance !== undefined) flight.surveillance = fields.surveillance || undefined
                    flight.faaEquipment = undefined
                    flight.equipmentDisplay = undefined
                }
                if (cmd.squawk !== undefined) {
                    flight.squawk = cmd.squawk || undefined
                }
                if (fields.supl !== undefined) {
                    const em = String(fields.supl).match(/\bE\/(\d{4})\b/i)
                    if (em) flight.endurance = em[1]
                    const cm = String(fields.supl).match(/\bC\/([^\n/]+?)(?=\s+[A-Z]\/|$)/i)
                    if (cm) flight.pilotName = cm[1].trim()
                }
                const updated = flightStore.regenerateStrip(callsign)
                if (updated) {
                    store.updateStripFromFlight(updated)
                    broadcastStrip(updated)
                }
            }
            console.log(`[FPL] amendFlightPlan ${callsign}`)
            break
        }

        case "scribbleSet": {
            const strokes = scribbleStore.setScribbles(message.stripId, message.strokes)
            broadcastScribbleUpdate(message.stripId, strokes, socket)
            break
        }

        case "scribbleSyncPush": {
            void pushScribbleToRemote(message.stripId)
            break
        }

        case "setVatsimCid": {
            const cid = String(message.cid || "").trim()
            if (cid !== "" && !/^\d{4,10}$/.test(cid)) {
                sendMessage(socket, {
                    type: "notify",
                    text: "VATSIM CID must be 4–10 digits",
                    level: "error",
                })
                break
            }
            currentUiSettings.vatsimCid = cid
            saveUserSettings({ vatsimCid: cid })
            broadcastUserSettings()
            restartScribbleSyncPolling()
            break
        }

        case "requestCidSuggest": {
            const suggested = suggestCidFromEsPrf(EUROSCOPE_DIR)
            sendMessage(socket, { type: "cidSuggest", suggestedCid: suggested })
            break
        }

        case "updateNote": {
            const updatedStrip = store.updateNoteText(message.stripId, message.text)
            if (updatedStrip) {
                // Echo to all clients (including sender) so note text stays canonical
                // even if local optimistic updates race with strip insertions/re-renders.
                broadcastStrip(updatedStrip)
                void pushStripToRemote(updatedStrip.id)
                console.log(`[NOTE] Updated note ${message.stripId}: "${message.text.substring(0, 30)}"`)
            }
            break
        }

        case "updateVehicleStrip": {
            const updatedStrip = store.updateVehicleStripField(message.stripId, message.field, message.text)
            if (updatedStrip) {
                broadcastStrip(updatedStrip)
                void pushStripToRemote(updatedStrip.id)
                console.log(`[VEHICLE] ${message.stripId} ${message.field}="${message.text.substring(0, 40)}"`)
            }
            break
        }

        case "viffRea": {
            const reaStrip = store.getStrip(message.stripId)
            if (!reaStrip) break
            if (reaStrip.stripType !== "departure") break
            if (reaStrip.flightRules !== "I" && reaStrip.flightRules !== "Y") break
            const ok = await viffService.setRea(reaStrip.callsign, message.set)
            if (ok) {
                const flight = flightStore.getFlight(reaStrip.callsign)
                if (flight) {
                    flight.cdmSts = message.set ? "REA" : undefined
                    const updated = flightStore.regenerateStrip(reaStrip.callsign)
                    if (updated) {
                        store.updateStripFromFlight(updated)
                        broadcastStrip(updated)
                    }
                }
                viffService.pollSoon()
            }
            break
        }

        case "viffUpdateEobt": {
            const eobtStrip = store.getStrip(message.stripId)
            if (!eobtStrip) break
            const eobt = message.eobt.trim()
            if (!/^\d{4}$/.test(eobt)) {
                console.log(`[VIFF] Invalid EOBT "${message.eobt}" for ${eobtStrip.callsign}`)
                break
            }
            const flight = flightStore.getFlight(eobtStrip.callsign)
            if (!flight) break
            // ES-first (works without vIFF); network DPI is best-effort
            sendUdp(JSON.stringify({
                type: "setEobt",
                callsign: eobtStrip.callsign,
                eobt,
            } satisfies OutboundPluginCommand))
            flight.eobt = eobt
            if (flight.cdmSts?.startsWith("FLS")) {
                flight.cdmSts = undefined
            }
            const updated = flightStore.regenerateStrip(eobtStrip.callsign)
            if (updated) {
                store.updateStripFromFlight(updated)
                broadcastStrip(updated)
            }
            console.log(`[EOBT] ${eobtStrip.callsign} → ${eobt}`)
            const ok = await viffService.updateEobt(eobtStrip.callsign, eobt)
            if (!ok) {
                console.warn(`[VIFF] EOBT network sync failed for ${eobtStrip.callsign} (ES already updated)`)
            } else {
                viffService.pollSoon()
            }
            break
        }

        case "viffUpdateTobt": {
            const tobtStrip = store.getStrip(message.stripId)
            if (!tobtStrip) break
            if (tobtStrip.stripType !== "departure") break
            if (tobtStrip.adep !== "ESSA") break
            if (tobtStrip.flightRules !== "I" && tobtStrip.flightRules !== "Y") break
            const tobt = message.tobt.trim()
            if (!/^\d{4}$/.test(tobt)) {
                console.log(`[VIFF] Invalid TOBT "${message.tobt}" for ${tobtStrip.callsign}`)
                break
            }
            const flight = flightStore.getFlight(tobtStrip.callsign)
            if (!flight) break
            const taxi = flight.taxiMinutes && flight.taxiMinutes > 0 ? flight.taxiMinutes : 15
            const setBy = tobt === flight.eobt ? undefined : "A" as const
            // ES-first: annotation via plugin (instant ES + cdmLocalUpdate echo), then vIFF
            sendUdp(JSON.stringify({
                type: "setTobt",
                callsign: tobtStrip.callsign,
                tobt,
                setBy,
            } satisfies OutboundPluginCommand))
            applyEfsTobt(flight, tobt)
            const updated = flightStore.regenerateStrip(tobtStrip.callsign)
            if (updated) {
                store.updateStripFromFlight(updated)
                broadcastStrip(updated)
            }
            console.log(`[CDM] TOBT via ES ${tobtStrip.callsign} → ${tobt}`)
            // Network catch-up (CDM master may also sync; this keeps vIFF aligned)
            const ok = await viffService.updateTobt(
                tobtStrip.callsign,
                tobt,
                taxi,
                flight.cdmSts ?? "",
            )
            if (!ok) {
                console.warn(`[VIFF] TOBT network sync failed for ${tobtStrip.callsign} (ES already updated)`)
            }
            viffService.pollSoon()
            break
        }

        case "viffReadyTobt": {
            // Ready TOBT: always TOBT=now (UTC HHMM), then always REA.
            // Never gated on CTOT / TOBT≠EOBT; client `tobt` is ignored (Ready means now).
            const readyStrip = store.getStrip(message.stripId)
            if (!readyStrip) break
            if (readyStrip.stripType !== "departure") break
            if (readyStrip.adep !== "ESSA") break
            if (readyStrip.flightRules !== "I" && readyStrip.flightRules !== "Y") break
            const flight = flightStore.getFlight(readyStrip.callsign)
            if (!flight) break
            const now = new Date()
            const tobt =
                String(now.getUTCHours()).padStart(2, "0") +
                String(now.getUTCMinutes()).padStart(2, "0")
            const taxi = flight.taxiMinutes && flight.taxiMinutes > 0 ? flight.taxiMinutes : 15
            // ES-first TOBT=now, then always REA on network (CTOT irrelevant)
            sendUdp(JSON.stringify({
                type: "setTobt",
                callsign: readyStrip.callsign,
                tobt,
                setBy: "A",
            } satisfies OutboundPluginCommand))
            applyEfsTobt(flight, tobt)
            console.log(`[CDM] Ready TOBT via ES ${readyStrip.callsign} → ${tobt}`)
            const tobtOk = await viffService.updateTobt(
                readyStrip.callsign,
                tobt,
                taxi,
                "",
            )
            if (!tobtOk) {
                console.warn(`[VIFF] Ready TOBT network sync failed for ${readyStrip.callsign} (ES already updated)`)
            }
            const reaOk = await viffService.setRea(readyStrip.callsign, true)
            if (reaOk) {
                flight.cdmSts = "REA"
                console.log(`[VIFF] Ready REA set ${readyStrip.callsign} (CTOT=${flight.ctot ?? "none"})`)
            } else {
                console.error(`[VIFF] Ready REA failed for ${readyStrip.callsign}`)
            }
            const updated = flightStore.regenerateStrip(readyStrip.callsign)
            if (updated) {
                store.updateStripFromFlight(updated)
                broadcastStrip(updated)
            }
            viffService.pollSoon()
            break
        }

        case "viffToggleReadyStartup": {
            // CDM Ready Startup / TOGGLEASRTREA: toggle ASRT + REA
            const rsStrip = store.getStrip(message.stripId)
            if (!rsStrip) break
            if (rsStrip.stripType !== "departure") break
            if (rsStrip.flightRules !== "I" && rsStrip.flightRules !== "Y") break
            if (!staticConfig.isController) break
            const flight = flightStore.getFlight(rsStrip.callsign)
            if (!flight) break
            const enable = !flight.asrt
            const now = new Date()
            const asrt = enable
                ? String(now.getUTCHours()).padStart(2, "0") + String(now.getUTCMinutes()).padStart(2, "0")
                : ""
            sendUdp(JSON.stringify({
                type: "setAsrt",
                callsign: rsStrip.callsign,
                asrt,
            } satisfies OutboundPluginCommand))
            flight.asrt = enable ? asrt : undefined
            const reaOk = await viffService.setRea(rsStrip.callsign, enable)
            if (reaOk) {
                flight.cdmSts = enable ? "REA" : (flight.cdmSts === "REA" ? undefined : flight.cdmSts)
            } else {
                console.error(`[VIFF] Ready Startup REA ${enable ? "set" : "clear"} failed for ${rsStrip.callsign}`)
            }
            console.log(`[CDM] Ready Startup ${enable ? "ON" : "OFF"} ${rsStrip.callsign}${enable ? ` ASRT=${asrt}` : ""}`)
            const updated = flightStore.regenerateStrip(rsStrip.callsign)
            if (updated) {
                store.updateStripFromFlight(updated)
                broadcastStrip(updated)
            }
            viffService.pollSoon()
            break
        }

        case "setTsac": {
            const tsacStrip = store.getStrip(message.stripId)
            if (!tsacStrip) break
            if (tsacStrip.stripType !== "departure") break
            if (tsacStrip.flightRules !== "I" && tsacStrip.flightRules !== "Y") break
            if (!staticConfig.isController) break
            const flight = flightStore.getFlight(tsacStrip.callsign)
            if (!flight) break
            const raw = (message.tsac ?? "").trim()
            const tsac = raw === "" ? "" : raw
            if (tsac !== "" && !/^\d{4}$/.test(tsac)) {
                console.log(`[CDM] Invalid TSAC "${message.tsac}" for ${tsacStrip.callsign}`)
                break
            }
            sendUdp(JSON.stringify({
                type: "setTsac",
                callsign: tsacStrip.callsign,
                tsac,
            } satisfies OutboundPluginCommand))
            flight.tsac = tsac || undefined
            const updated = flightStore.regenerateStrip(tsacStrip.callsign)
            if (updated) {
                store.updateStripFromFlight(updated)
                broadcastStrip(updated)
            }
            console.log(`[CDM] TSAC ${tsacStrip.callsign} → ${tsac || "(clear)"}`)
            break
        }

        case "setCtoc": {
            const ctocStrip = store.getStrip(message.stripId)
            if (!ctocStrip) break
            if (ctocStrip.stripType !== "departure") break
            if (ctocStrip.flightRules !== "I" && ctocStrip.flightRules !== "Y") break
            if (!staticConfig.isController) break
            const flight = flightStore.getFlight(ctocStrip.callsign)
            if (!flight) break
            const raw = (message.ctoc ?? "").trim()
            const ctoc = raw === "" ? "" : raw
            if (ctoc !== "" && !/^\d{4}$/.test(ctoc)) {
                console.log(`[CDM] Invalid CTOC "${message.ctoc}" for ${ctocStrip.callsign}`)
                break
            }
            sendUdp(JSON.stringify({
                type: "setCtoc",
                callsign: ctocStrip.callsign,
                ctoc,
            } satisfies OutboundPluginCommand))
            flight.ctoc = ctoc || undefined
            const updated = flightStore.regenerateStrip(ctocStrip.callsign)
            if (updated) {
                store.updateStripFromFlight(updated)
                broadcastStrip(updated)
            }
            console.log(`[CDM] CTOC ${ctocStrip.callsign} → ${ctoc || "(clear)"}`)
            break
        }

        case "setAtd": {
            // EFS-only ATD (UTC HHmm) — used by SAAB DEP dialog; does not touch CDM/vIFF
            const atdStrip = store.getStrip(message.stripId)
            if (!atdStrip) break
            if (atdStrip.stripType === "arrival" || atdStrip.stripType === "note") break
            if (!staticConfig.isController) break
            const flight = flightStore.getFlight(atdStrip.callsign)
            if (!flight) break
            const raw = (message.atd ?? "").trim().replace(/\D/g, "").slice(0, 4)
            const atd = raw === "" ? "" : raw
            if (atd !== "") {
                if (!/^\d{4}$/.test(atd)) {
                    console.log(`[ATD] Invalid ATD "${message.atd}" for ${atdStrip.callsign}`)
                    break
                }
                const h = Number(atd.slice(0, 2))
                const m = Number(atd.slice(2))
                if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) {
                    console.log(`[ATD] Invalid ATD "${atd}" for ${atdStrip.callsign}`)
                    break
                }
            }
            flight.atd = atd || undefined
            const updated = flightStore.regenerateStrip(atdStrip.callsign)
            if (updated) {
                store.updateStripFromFlight(updated)
                broadcastStrip(updated)
            }
            console.log(`[ATD] ${atdStrip.callsign} → ${atd || "(clear)"}`)
            break
        }

        case "setQnhGiven": {
            const qnhStrip = store.getStrip(message.stripId)
            if (!qnhStrip) break
            if (!staticConfig.isController) break
            const flight = flightStore.getFlight(qnhStrip.callsign)
            if (!flight) break
            const qnh = message.qnh
            if (qnh != null && (!Number.isFinite(qnh) || qnh < 900 || qnh > 1100)) {
                console.log(`[QNH] Invalid QNH ${qnh} for ${qnhStrip.callsign}`)
                break
            }
            flight.qnhGiven = qnh ?? undefined
            if (qnh == null) {
                flight.atisGiven = undefined
            } else if (message.atis !== undefined) {
                const letter = (message.atis || "").trim().toUpperCase()
                flight.atisGiven = letter || undefined
            }
            const updated = flightStore.regenerateStrip(qnhStrip.callsign)
            if (updated) {
                store.updateStripFromFlight(updated)
                broadcastStrip(updated)
                void pushStripFlagsToRemote(updated.id)
            }
            console.log(
                `[QNH] ${qnhStrip.callsign} given → ${qnh ?? "(clear)"}` +
                    (flight.atisGiven ? ` ATIS ${flight.atisGiven}` : ""),
            )
            break
        }

    }
}

const wsServer = new WebSocketServer({ noServer: true })
wsServer.on("connection", (socket) => {
    console.log("Client connected")
    wsClients.add(socket)

    // Send initial state immediately on connect
    sendLayout(socket)
    sendStrips(socket)
    sendGaps(socket)
    sendRwyFlags(socket)
    sendStatus(socket)
    sendDclStatus(socket)
    sendUserSettings(socket)
    sendAtisUpdate(socket)
    sendEssaSepIndicators(socket)
    sendConfigList(socket)
    sendControllers(socket)
    // Trash survives store.clear(); push so reconnect restores the list without opening the dialog
    sendMessage(socket, {
        type: "deletedStrips",
        strips: store.getDeletedStripInfos(),
    })
    sendMessage(socket, { type: "aupR16", ...getAupR16Status() })
    if (staticConfig.look === "paper" && currentUiSettings.stripPrintMode === "manual") {
        sendMessage(socket, {
            type: "pendingPrintList",
            flights: flightStore.listPendingPrint(),
        })
    }

    socket.on("message", (message) => {
        const text = message.toString("utf8").trim()
        enqueueClientMessage(socket, text)
    })

    socket.on("close", () => {
        console.log("Client disconnected")
        wsClients.delete(socket)
    })
})

const app = express()
app.use(logRequests("dev"))
app.use(express.json({ limit: "64kb" }))

/** CORS for VatIRIS → VatEFS FSP print API (browser cross-origin). */
app.use((req, res, next) => {
    if (!req.path.startsWith("/api/print") && !req.path.startsWith("/api/fsp")) {
        next()
        return
    }
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
    if (req.method === "OPTIONS") {
        res.sendStatus(204)
        return
    }
    next()
})

function isLocalDevRequest(req: express.Request): boolean {
    const ip = req.socket.remoteAddress || ""
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1"
}

function applyDevSpoofAndBroadcast(callsign: string, fields: DevSpoofFields) {
    if (!flightStore.getFlight(callsign)) {
        return { error: `Flight not found: ${callsign}` as const }
    }
    const strip = flightStore.applyDevSpoof(callsign, fields)
    if (strip) {
        const applied = store.updateStripFromFlight(strip)
        broadcastStrip(applied ?? strip)
    }
    const snap = flightStore.getDevSpoofSnapshot(callsign)
    return snap ?? { error: `Flight not found: ${callsign}` as const }
}

// REST API endpoints
app.get("/api/flights", (req, res) => {
    const flights = flightStore.getAllFlights()
    res.json(flights)
})

/** Dev: read CDM spoof snapshot (localhost only). */
app.get("/api/dev/spoof/:callsign", (req, res) => {
    if (!isLocalDevRequest(req)) {
        res.status(403).json({ error: "Localhost only" })
        return
    }
    const snap = flightStore.getDevSpoofSnapshot(String(req.params.callsign || ""))
    if (!snap) {
        res.status(404).json({ error: "Flight not found" })
        return
    }
    res.json(snap)
})

/** Dev: set/clear CTOT/TOBT/… (localhost only). Body: { callsign, ctot?, tobt?, clearAll?, … }. */
app.post("/api/dev/spoof", (req, res) => {
    if (!isLocalDevRequest(req)) {
        res.status(403).json({ error: "Localhost only" })
        return
    }
    const body = req.body as DevSpoofFields & { callsign?: string }
    const callsign = String(body.callsign || "").trim().toUpperCase()
    if (!callsign) {
        res.status(400).json({ error: "Missing callsign" })
        return
    }
    const { callsign: _cs, ...fields } = body
    const result = applyDevSpoofAndBroadcast(callsign, fields)
    if ("error" in result) {
        res.status(404).json(result)
        return
    }
    console.log(`[spoof] ${callsign} via API`)
    res.json(result)
})

app.get("/api/flight/:callsign", async (req, res) => {
    const callsign = String(req.params.callsign || "").trim().toUpperCase()
    const flight = flightStore.getFlight(callsign)
    if (!flight) {
        res.status(404).json({ error: "Flight not found" })
        return
    }
    // Fill EQUIP/SUR from VATSIM aircraft string when EuroScope has not sent aircraftInfo yet
    if (!flight.equipment || !flight.surveillance) {
        try {
            const { lookupVatsimPilot } = await import("./vatsim-flights.js")
            const pilot = await lookupVatsimPilot(callsign)
            const ac = pilot?.flight_plan?.aircraft
            if (ac) {
                applyParsedEquipment(flight, parseAircraftInfo(ac, flight.capabilities, flight.rvsm), ac)
            }
        } catch {
            // ignore network errors — return flight as-is
        }
    }
    res.json(flight)
})

/**
 * Apply a printStrip result to the bay store and broadcast (WS + HTTP FSP).
 * Re-printing: trash the present strip, clear scribbles/flags, place a fresh strip + anim.
 */
function applyPrintStripResult(
    result: {
        strip?: import("@vatefs/common").FlightStrip
        softDeleted?: boolean
        shiftedCallsigns?: string[]
        freshReprint?: boolean
        cleanReprint?: boolean
    },
    options?: { playPrintAnim?: boolean },
): import("@vatefs/common").FlightStrip | undefined {
    if (result.softDeleted || !result.strip) return undefined

    const freshReprint = !!result.freshReprint || !!store.getStrip(result.strip.id)
    if (freshReprint) {
        const deletedIds = store.softDeleteCallsignToTrash(
            result.strip.callsign,
            "strip_reprint",
        )
        for (const id of deletedIds) {
            scribbleStore.clearScribbles(id)
            broadcastStripDelete(id)
            broadcastScribbleUpdate(id, [])
        }
        if (deletedIds.length > 0) broadcastDeletedStrips()
    }

    const applied = store.updateStripFromFlight(result.strip, { allowPositionChange: true })
    if (result.shiftedCallsigns) {
        for (const shifted of result.shiftedCallsigns) {
            const shiftedStrip = flightStore.regenerateStrip(shifted)
            if (shiftedStrip) {
                broadcastStrip(
                    store.updateStripFromFlight(shiftedStrip, { allowPositionChange: true }),
                )
            }
        }
    }

    const broadcastOpts: { playPrintAnim?: boolean; cleanReprint?: boolean } = {}
    if (freshReprint) {
        broadcastOpts.playPrintAnim = true
        broadcastOpts.cleanReprint = true
    } else if (options?.playPrintAnim) {
        broadcastOpts.playPrintAnim = true
    }
    broadcastStrip(
        applied,
        broadcastOpts.playPrintAnim || broadcastOpts.cleanReprint ? broadcastOpts : undefined,
    )
    if (freshReprint && applied && staticConfig.look === "paper") {
        scribbleStore.clearScribbles(applied.id)
        broadcastScribbleUpdate(applied.id, [])
        void pushStripToRemote(applied.id)
    }
    lastPendingPrintFp = ""
    broadcastPendingPrintList()
    return applied
}

/**
 * VatFSP discovery for VatIRIS settings — copy a URL into IRIS FSP Server URL.
 * GET /api/fsp  (also /api/printer/status for VatFSP-shaped probes)
 */
app.get("/api/fsp", (_req, res) => {
    const urls = listFspServerBaseUrls(port)
    const enabled = !!currentUiSettings.fspServerEnabled && staticConfig.look === "paper"
    res.json({
        service: "vatefs",
        version: constants.version,
        paperLook: staticConfig.look === "paper",
        enabled,
        port,
        urls,
        /** Prefer first LAN URL for IRIS */
        fspUrl: urls[0],
        printPath: "/api/print/external",
    })
})

app.get("/api/printer/status", (_req, res) => {
    const enabled = !!currentUiSettings.fspServerEnabled && staticConfig.look === "paper"
    res.json({
        connected: enabled,
        deviceInfo: enabled
            ? `VatEFS paper strips (${staticConfig.look === "paper" ? "paper" : "saab"})`
            : "VatEFS FSP server disabled",
        service: "vatefs",
        enabled,
        fspUrl: listFspServerBaseUrls(port)[0],
    })
})

/**
 * VatFSP / VatIRIS integration: print a paper strip into EFS.
 * Same contract as https://github.com/maxlk96/vatfsp VATIRIS_INTEGRATION_API.md
 * POST /api/print/external
 */
app.post("/api/print/external", async (req, res) => {
    try {
        if (staticConfig.look !== "paper") {
            res.status(400).json({
                error: "Paper look required",
                details: "Switch VatEFS to an ESGG/paper config to accept IRIS strip prints",
            })
            return
        }
        if (!currentUiSettings.fspServerEnabled) {
            res.status(403).json({
                error: "FSP server disabled",
                details: "Enable “VatIRIS FSP server” in VatEFS Options to allow printing from IRIS",
            })
            return
        }

        const body = (req.body ?? {}) as ExternalPrintBody
        const callsign = pickExternalField(body, "callsign")?.toUpperCase()
        const stripType = externalStripType(body)

        // Blank strip (no callsign) → paper empty DEP/ARR holder
        if (!callsign) {
            const kind = blankPaperInfoKind(body)
            const airport = staticConfig.myAirports[0]
            const strip = store.createNoteStrip(
                undefined,
                undefined,
                undefined,
                undefined,
                airport,
                kind,
            )
            if (!strip) {
                res.status(500).json({
                    error: "Failed to print blank strip",
                    details: "No bay layout available",
                })
                return
            }
            for (const peer of store.getStripsForSection(strip.bayId, strip.sectionId, false)) {
                if (peer.id !== strip.id) broadcastStrip(peer)
            }
            broadcastStrip(strip, { playPrintAnim: true })
            void pushStripToRemote(strip.id)
            console.log(`[FSP] Blank ${stripType} strip printed (${kind}) -> ${strip.sectionId}`)
            res.json({
                success: true,
                message: "Blank flight strip printed successfully",
                callsign: null,
                type: stripType,
                blank: true,
            })
            return
        }

        const fr = pickExternalField(body, "flightRules", "flightType")?.toUpperCase()
        const overlay = {
            origin: pickExternalField(body, "departure", "origin", "adep")?.toUpperCase(),
            destination: pickExternalField(body, "arrival", "destination", "ades")?.toUpperCase(),
            aircraftType: pickExternalField(body, "aircraft", "aircraftType")?.toUpperCase(),
            wakeTurbulence: pickExternalField(body, "wtc", "wakeTurbulence")?.toUpperCase(),
            flightRules:
                fr === "I" || fr === "V" || fr === "Y" || fr === "Z" ? fr : undefined,
            route: pickExternalField(body, "route"),
            eobt: pickExternalField(body, "eobt", "departureTime", "std"),
            ctot: pickExternalField(body, "ctot", "ctotTime", "ctot_time"),
            squawk: pickExternalField(body, "transponder", "squawk"),
            sid: pickExternalField(body, "sid")?.toUpperCase(),
            tas: pickExternalField(body, "tas", "speed"),
            rflFeet: parseExternalRflFeet(
                pickExternalField(body, "rfl", "cruiseAltitude", "altitude"),
            ),
            stripKind: stripType,
        }

        const result = await flightStore.printStripFromExternal(callsign, overlay)
        const applied = applyPrintStripResult(result, { playPrintAnim: true })
        if (!applied) {
            res.status(404).json({
                error: "Failed to print flight strip",
                details: result.softDeleted
                    ? `Strip for ${callsign} was soft-deleted by rules`
                    : `Could not place strip for ${callsign} (no section / layout)`,
                callsign,
            })
            return
        }
        console.log(`[FSP] Strip printed for ${callsign} -> ${applied.sectionId}`)
        res.json({
            success: true,
            message: `Flight strip for ${callsign} printed successfully`,
            callsign,
            type: stripType,
            blank: false,
            sectionId: applied.sectionId,
        })
    } catch (err) {
        console.error("[FSP] print/external failed:", err)
        res.status(500).json({
            error: "Failed to print flight strip",
            details: err instanceof Error ? err.message : String(err),
            callsign: typeof req.body?.callsign === "string" ? req.body.callsign : undefined,
        })
    }
})

/** Local flight store first, then VATSIM network FPL (for paper print callsign entry). */
app.get("/api/print-flight/:callsign", async (req, res) => {
    const cs = String(req.params.callsign || "").trim().toUpperCase()
    if (!cs) {
        res.status(400).json({ error: "Missing callsign" })
        return
    }
    const local = flightStore.getFlight(cs)
    if (local && local.origin && local.destination) {
        res.json({
            source: "local",
            callsign: local.callsign,
            origin: local.origin,
            destination: local.destination,
            aircraftType: local.aircraftType,
            eobt: local.eobt,
            ctot: local.ctot,
            squawk: local.squawk,
        })
        return
    }
    try {
        const { lookupVatsimPilot } = await import("./vatsim-flights.js")
        const pilot = await lookupVatsimPilot(cs)
        const fp = pilot?.flight_plan
        if (!pilot || !fp?.departure || !fp?.arrival) {
            res.status(404).json({ error: "Flight not found" })
            return
        }
        res.json({
            source: "vatsim",
            callsign: pilot.callsign,
            origin: fp.departure.toUpperCase(),
            destination: fp.arrival.toUpperCase(),
            aircraftType: (fp.aircraft_short || fp.aircraft || "").toUpperCase() || undefined,
            eobt: fp.deptime,
            squawk: fp.assigned_transponder || pilot.transponder,
        })
    } catch (err) {
        res.status(502).json({
            error: err instanceof Error ? err.message : "VATSIM lookup failed",
        })
    }
})

app.get("/api/config", (req, res) => {
    res.json(staticConfig)
})

app.get("/api/roles", (req, res) => {
    const rolesByAirport = staticConfig.myRolesByAirport
        ? Object.fromEntries(staticConfig.myRolesByAirport)
        : null
    const onlineControllers = staticConfig.onlineControllers
        ? Object.fromEntries([...staticConfig.onlineControllers.values()].map(c => [c.callsign, { role: c.role, frequency: c.frequency }]))
        : null
    res.json({
        myCallsign: staticConfig.myCallsign,
        myRole: staticConfig.myRole,
        myAirports: staticConfig.myAirports,
        myRolesByAirport: rolesByAirport,
        onlineControllers,
    })
})

app.get("/api/strips", (req, res) => {
    const strips = store.getAllStrips()
    res.json(strips)
})

app.get("/api/strip/:callsign", (req, res) => {
    const strip = store.getStrip(req.params.callsign)
    if (strip) {
        res.json(strip)
    } else {
        res.status(404).json({ error: "Strip not found" })
    }
})

app.get("/api/onrunway", (req, res) => {
    const lat = parseFloat(req.query.lat as string)
    const lon = parseFloat(req.query.lon as string)
    const alt = parseFloat(req.query.alt as string)
    const airport = req.query.airport as string
    const runway = req.query.runway as string | undefined

    if (isNaN(lat) || isNaN(lon) || isNaN(alt) || !airport) {
        res.status(400).json({
            error: "Missing or invalid parameters",
            usage: "/api/onrunway?lat=<lat>&lon=<lon>&alt=<alt>&airport=<ICAO>&runway=<optional>",
        })
        return
    }

    const result = isOnRunway(lat, lon, alt, airport, runway)
    res.json(result)
})

app.get("/api/runways", (req, res) => {
    const airport = req.query.airport as string
    if (!airport) {
        res.status(400).json({ error: "Missing parameters", usage: "/api/runways?airport=ESGG" })
        return
    }
    const runways = getRunwaysByAirport(airport)
    // Extract unique runway identifiers (both ends)
    const identifiers = new Set<string>()
    for (const rwy of runways) {
        if (rwy.le_ident) identifiers.add(rwy.le_ident)
        if (rwy.he_ident) identifiers.add(rwy.he_ident)
    }
    res.json([...identifiers].sort())
})

app.get("/api/appclr", (req, res) => {
    const airport = typeof req.query.airport === "string" ? req.query.airport : ""
    const runway = typeof req.query.runway === "string" ? req.query.runway : ""
    if (!airport) {
        res.status(400).json({ error: "Missing parameters", usage: "/api/appclr?airport=ESSA&runway=01L" })
        return
    }
    res.json({ types: getAppClrTypes(airport, runway || undefined) })
})

/** Transition altitude (ft) from TopSkyAirspace.txt for CFL menu / FPL PEL·CFL. */
app.get("/api/transition-altitude", (req, res) => {
    const airport = typeof req.query.airport === "string" ? req.query.airport : ""
    res.json({ feet: getTransitionAltitudeFt(airport || null), airport: airport || null })
})

app.get("/api/sids", (req, res) => {
    const airport = req.query.airport as string
    const runway = req.query.runway as string

    if (!airport || !runway) {
        res.status(400).json({ error: "Missing parameters", usage: "/api/sids?airport=ESGG&runway=21" })
        return
    }

    res.json(getSidsForRunway(airport, runway))
})

app.get("/api/sidalt", (req, res) => {
    const airport = req.query.airport as string
    const sid = req.query.sid as string
    const slow = req.query.slow === "1" || req.query.slow === "true"

    if (!airport || !sid) {
        res.status(400).json({ error: "Missing parameters", usage: "/api/sidalt?airport=ESGG&sid=LABAN4J" })
        return
    }

    // COPX match, else Swedish TMA default (ESSA/ESGG 5000, ESMS 4000, SLOW 3000)
    const altitude = resolveSidAltitude(airport, sid, slow)
    res.json({ altitude: altitude ?? null })
})

/**
 * Preferred SID:
 * - ESSA: config-aware (+ SLOW track/HAPZI when slow=1). Query: airport, runway, config, route?, slow=
 * - ESMS: LOA K/L (or G/H when EKCH RWY 30 active in ES). Query: airport, runway, route?
 */
/**
 * ESSA G/A · MAP strip frequency for the given runway config.
 * Same APP delivery resolution as strip XFER: ESE OWNER chain + AFV XC / force-ideal.
 * Query: config=<id> (e.g. 1, 15A)
 */
app.get("/api/essa-map-freq", (req, res) => {
    const configId = String(req.query.config || "").trim()
    if (!configId) {
        res.status(400).json({
            error: "Missing parameters",
            usage: "/api/essa-map-freq?config=1",
        })
        return
    }
    const delivery = resolveMapDelivery(configId)
    const transfer = resolveAppDepTransfer(delivery.sector)
    if (transfer && transfer.displayFrequency > 0) {
        res.json({
            frequency: transfer.displayFrequency.toFixed(3),
            sector: delivery.sector,
            callsign: transfer.transferCallsign,
            xc: transfer.xc,
        })
        return
    }
    // Nobody online covering the sector — fall back to ESE published freq for ideal SI
    const idealSi = appDepSectorToSi(delivery.sector)
    const eseFreq = getEsePositionBySi(idealSi)?.frequency
    res.json({
        frequency: eseFreq && eseFreq > 0 ? eseFreq.toFixed(3) : null,
        sector: delivery.sector,
        callsign: null,
        xc: false,
    })
})

/** Resolve live (or ESE / default) frequency + covering login for an APP/DEP sector. */
function resolveSectorDisplay(
    sector: AppDepSector,
    fallback: string
): { frequency: string; callsign: string | null } {
    const transfer = resolveAppDepTransfer(sector)
    if (transfer && transfer.displayFrequency > 0) {
        return {
            frequency: transfer.displayFrequency.toFixed(3),
            callsign: transfer.transferCallsign || null,
        }
    }
    const eseFreq = getEsePositionBySi(appDepSectorToSi(sector))?.frequency
    return {
        frequency: eseFreq && eseFreq > 0 ? eseFreq.toFixed(3) : fallback,
        callsign: null,
    }
}

/**
 * ESSA DEP RWY info strip (VatIRIS-style): runway, turn, hold phraseology,
 * east / LÅGFART exit groups with live transfer freqs.
 * Query: config=<id>
 */
app.get("/api/essa-dep-info", (req, res) => {
    const configId = String(req.query.config || "").trim()
    if (!configId) {
        res.status(400).json({
            error: "Missing parameters",
            usage: "/api/essa-dep-info?config=1",
        })
        return
    }
    const info = resolveEssaDepInfoStrip(configId)
    if (!info) {
        res.status(404).json({ error: `Unknown ESSA config: ${configId}` })
        return
    }
    const primary = resolveSectorDisplay(info.primarySector, info.primaryDefaultFreq)
    res.json({
        ...info,
        primaryFreq: primary.frequency,
        primaryCallsign: primary.callsign,
        rows: info.rows.map((row) => {
            const resolved = resolveSectorDisplay(row.sector, row.defaultFreq)
            return {
                ...row,
                frequency: resolved.frequency,
                callsign: resolved.callsign,
            }
        }),
    })
})

app.get("/api/preferred-sid", (req, res) => {
    const airport = ((req.query.airport as string) || "").toUpperCase()
    const runway = req.query.runway as string
    const configId = req.query.config as string
    const route = (req.query.route as string) || undefined
    const slow = req.query.slow === "1" || req.query.slow === "true"
    /** Explicit TMA exit (strip display); used for exitSids when route has no exit token */
    const exitParam = ((req.query.exit as string) || "").trim().toUpperCase() || undefined

    if (!airport || !runway) {
        res.status(400).json({
            error: "Missing parameters",
            usage: "/api/preferred-sid?airport=ESSA&runway=19L&config=9A&route=DCT%20RESNA&slow=0",
        })
        return
    }

    if (airport === "ESMS") {
        const ekch30 = isEkchRwy30Active(staticConfig.activeRunways)
        const result = resolveEsmsPreferredSid({ runway, route, ekch30 })
        const tmaExit = exitParam || result.exit
        const exitSids = tmaExit
            ? collectEsmsSidsForTmaExit({ runway, tmaExit, ekch30 })
            : []
        res.json({ ...result, ekch30, exitSids })
        return
    }

    if (airport === "ESGG") {
        const callsign = ((req.query.callsign as string) || "").trim().toUpperCase()
        const flight = callsign ? flightStore.getFlight(callsign) : undefined
        const engineType =
            (req.query.engineType as string) || flight?.engineType || undefined
        const propParam = req.query.prop
        const prop =
            propParam === "1" || propParam === "true"
                ? true
                : propParam === "0" || propParam === "false"
                  ? false
                  : undefined
        const result = resolveEsggPreferredSid({
            runway,
            route,
            engineType,
            prop,
        })
        const tmaExit = exitParam || result.exit
        const exitSids = tmaExit
            ? collectEsggSidsForTmaExit({ runway, tmaExit, engineType, prop })
            : []
        res.json({
            ...result,
            prop: prop ?? isPropellerEngine(engineType),
            exitSids,
        })
        return
    }

    // Exit highlighting can use strip RWY + exit without a resolved ESSA config
    // (manual DEP RWY may differ from the selected combination).
    if (!configId) {
        if (exitParam) {
            res.json({
                sid: null,
                sortGroup: [],
                exit: exitParam,
                exitSids: collectSidsForTmaExit({
                    airport,
                    runway,
                    configId: "",
                    tmaExit: exitParam,
                }),
            })
            return
        }
        res.status(400).json({
            error: "Missing parameters",
            usage: "/api/preferred-sid?airport=ESSA&runway=19L&config=9A&route=DCT%20RESNA&slow=0",
        })
        return
    }

    const result = resolvePreferredSid({ airport, runway, configId, route, slow })
    const tmaExit = exitParam || result.exit
    const exitSids = tmaExit
        ? collectSidsForTmaExit({ airport, runway, configId, tmaExit })
        : []
    res.json({ ...result, exitSids })
})

app.get("/api/withinctr", (req, res) => {
    const lat = parseFloat(req.query.lat as string)
    const lon = parseFloat(req.query.lon as string)
    const alt = parseFloat(req.query.alt as string)

    if (isNaN(lat) || isNaN(lon) || isNaN(alt)) {
        res.status(400).json({
            error: "Missing or invalid parameters",
            usage: "/api/withinctr?lat=<lat>&lon=<lon>&alt=<altMsl>",
        })
        return
    }

    const result = checkCtrAtPosition(lat, lon, alt)
    if (result) {
        res.json(result)
    } else {
        res.json({ airport: null, within: false, message: "No CTR/TIZ zone found at this position" })
    }
})

app.get("/api/airports", (req, res) => {
    const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "ES"
    const airports = listAirportIcaos(prefix).map((icao) => {
        const info = getIcaoAirportInfo(icao)
        return { icao, name: info?.name ?? null, country: info?.country ?? null }
    })
    res.json({ airports })
})

app.get("/api/airport-name", (req, res) => {
    const icao = (req.query.icao as string ?? "").toUpperCase()
    if (!icao) {
        res.status(400).json({ error: "Missing icao parameter" })
        return
    }
    const info = getIcaoAirportInfo(icao)
    res.json({ name: info?.name ?? getIcaoAirportName(icao) ?? null, country: info?.country ?? null })
})

/**
 * AUP R16 status (LFV daily use plan, cached ~1 h like VatIRIS).
 * { active, topAltitudeFt, from, to, suggestConfigId } — active = R16/ESR16 active now AND upper limit > 1600 ft.
 * suggestConfigId ('9C' | '15C' | null) is only a hint for clients in AUTO RWY mode; manual config locks are client-side.
 */
function handleAupR16(req: express.Request, res: express.Response) {
    ensureAupR16Service()
    getAupR16StatusFresh(getEssaOps())
        .then((status) => res.json(status))
        .catch((err) => {
            console.warn("aup r16 status failed:", err)
            res.status(502).json({ error: "AUP unavailable" })
        })
}
app.get("/api/aup/r16", handleAupR16)

app.get("/api/dcl/status", (req, res) => {
    res.json({ status: currentDclStatus, error: currentDclError })
})

/**
 * Check whether a pilot callsign is online on Hoppie (for proactive DCL from CLR).
 * Only meaningful when Hoppie/DCL is connected. Optionally returns a clearance preview.
 */
app.get("/api/hoppie/online/:callsign", async (req, res) => {
    const callsign = String(req.params.callsign ?? "")
        .trim()
        .toUpperCase()
    if (!callsign) {
        res.status(400).json({ error: "Missing callsign", online: false })
        return
    }
    if (!hoppieService?.isConnected()) {
        res.json({ online: false })
        return
    }

    try {
        const online = await hoppieService.checkCallsignOnline(callsign)
        let clearancePreview: string | undefined
        if (online) {
            const flight = flightStore.getFlight(callsign)
            const dclAirport = flight
                ? staticConfig.myAirports.find((a) => a === flight.origin)
                : undefined
            if (flight && dclAirport) {
                try {
                    clearancePreview = fillDclTemplate(dclAirport, buildDclTemplateData(flight, ""))
                } catch (err) {
                    console.warn(
                        `[DCL] Preview error for ${callsign}: ${err instanceof Error ? err.message : err}`,
                    )
                }
            }
        }
        res.json({ online, clearancePreview })
    } catch (err) {
        console.warn(
            `[HOPPIE] Online API failed for ${callsign}: ${err instanceof Error ? err.message : err}`,
        )
        res.json({ online: false })
    }
})

let publicDir = path.resolve(__dirname, "../public")
if (!fs.existsSync(publicDir)) publicDir = path.resolve(__dirname, "public")
app.use(serveStatic(publicDir))
app.get("/*splat", (req, res) => res.sendFile(publicDir + "/index.html"))
const server = app.listen(port, "0.0.0.0", () => {
    console.log(`EFS backend ${constants.version} listening at http://0.0.0.0:${port}`)
    startSpoofRepl({
        apply: (callsign, fields) => {
            const result = applyDevSpoofAndBroadcast(callsign, fields)
            return result
        },
        show: (callsign) => flightStore.getDevSpoofSnapshot(callsign),
    })
})
server.on("upgrade", (request, socket, head) => {
    wsServer.handleUpgrade(request, socket, head, (socket) => {
        wsServer.emit("connection", socket, request)
    })
})

// UDP socket for sending
let lastUdpString = ""
const udpOut = dgram.createSocket("udp4")
function sendUdp(udpString: string) {
    udpOut.send(udpString, udpOutPort, udpHost, (err, bytes) => {
        if (err) console.log("udp err", err, "bytes", bytes)
    })
    lastUdpString = udpString
}

/**
 * Ask the EuroScope plugin to run TopSky SSR allocation (AllocateSSR).
 * Never invents a code here — wait for the flight-plan squawk update from ES.
 * Debounced so CLR open + click, or double-click on empty ASSR, cannot fire twice.
 */
const lastTopskySquawkResetAt = new Map<string, number>()
const TOPSKY_SQUAWK_RESET_DEBOUNCE_MS = 1500

function requestTopskySquawkReset(callsign: string): boolean {
    const key = callsign.toUpperCase()
    const now = Date.now()
    const prev = lastTopskySquawkResetAt.get(key) ?? 0
    if (now - prev < TOPSKY_SQUAWK_RESET_DEBOUNCE_MS) {
        console.log(`[resetSquawk] debounced TopSky allocate for ${key}`)
        return false
    }
    lastTopskySquawkResetAt.set(key, now)
    sendUdp(JSON.stringify({ type: "resetSquawk", callsign: key } satisfies OutboundPluginCommand))
    return true
}

// UDP socket for receiving
const udpIn = dgram.createSocket("udp4")
udpIn.on("message", (msg, rinfo) => {
    const text = msg.toString("utf8").trim()

    // Record the message if recording is enabled
    recordMessage(text)
    try {
        const data = JSON.parse(text)
        // connectionType 0 = logged off — do not treat as plugin-alive heartbeat
        if (!(data.type === "connectionTypeUpdate" && data.connectionType === 0)) {
            notePluginUdp()
        }

        // Plugin ROF send result — success clears fallback; failure → EFS-native ROF
        if (data.type === "rofResult") {
            const callsign = typeof data.callsign === "string" ? data.callsign.toUpperCase() : ""
            const ok = data.ok === true
            const error = typeof data.error === "string" ? data.error : "Failed to send ROF"
            if (!callsign) return
            if (ok) {
                clearTopSkyRofFallback(callsign)
                console.log(`[ROF] sent ok for ${callsign}`)
                // Clear /ROF/… left on the scratch vehicle (TopSky often does not)
                const vehicle = typeof data.vehicle === "string" ? data.vehicle.toUpperCase() : ""
                if (vehicle) {
                    setTimeout(() => {
                        sendUdp(JSON.stringify({ type: "clearScratchpad", callsign: vehicle } satisfies OutboundPluginCommand))
                        console.log(`[ROF] Cleared scratchpad on vehicle ${vehicle}`)
                    }, 800)
                }
                return
            }
            console.log(`[ROF] TopSky failed for ${callsign}: ${error} — EFS-native fallback`)
            clearTopSkyRofFallback(callsign)
            applyEfsNativeRof(callsign, error)
            return
        }

        // Handle connectionTypeUpdate - connection type 0 means logged off
        if (data.type === "connectionTypeUpdate") {
            const ct = typeof data.connectionType === "number" ? data.connectionType : undefined
            if (ct !== undefined) lastConnectionType = ct
            if (ct !== undefined && ct !== 0) {
                onConnectionTypeChanged()
                syncOnlineNetworkServices()
            }
            if (ct === 0) {
                console.log("Connection lost (connectionType 0), clearing stores")
                store.clear()
                for (const id of Object.keys(scribbleStore.snapshotAll())) {
                    scribbleStore.clearScribbles(id)
                }
                clearAutoDepPrepSession()
                setMyCallsign("")
                setMyAirports([])
                setIsController(false)
                setMyFrequency(undefined)
                setMyPositionId(undefined)
                clearOnlineControllers()
                pendingPluginRefreshAfterReconnect = true
                pluginConnected = false
                lastPluginUdpAt = 0
                reportedPluginVersion = undefined
                broadcastStatus()
                broadcastRefresh("Connection lost")

                // Disconnect Hoppie and reset DCL status
                if (hoppieService) {
                    hoppieService.logout()
                    hoppieService = null
                }
                updateDclStatus("unavailable")

                // Stop ATIS polling
                if (atisService) {
                    atisService.stop()
                    atisService = null
                }
                return
            }
        }

        if (data.type === "efsCidCommand") {
            const suggested = suggestCidFromEsPrf(EUROSCOPE_DIR)
            broadcast({
                type: "openCidDialog",
                suggestedCid: suggested,
                reason: "command",
            })
            return
        }

        // Handle controllerPositionUpdate - track online controllers at our airports
        if (data.type === "controllerPositionUpdate") {
            const msg = data as ControllerPositionUpdateMessage
            if (msg.me) {
                // Capture our SI from existing plugin messages (position is already sent)
                if (msg.position) {
                    const prevSi = staticConfig.myPositionId
                    setMyPositionId(msg.position)
                    if (msg.position !== prevSi) {
                        reprocessAllStripsForRoleChange("My position SI updated")
                    }
                }
                // Ensure self is never left in onlineControllers after a position switch
                if (removeOnlineController(msg.callsign)) {
                    const rolesLog = staticConfig.myRolesByAirport
                        ? [...staticConfig.myRolesByAirport.entries()].map(([a, r]) => `${a}:[${r.join(',')}]`).join(' ')
                        : 'unknown'
                    console.log(`Removed self from online controllers - effective roles: ${rolesLog}`)
                    reprocessAllStripsForRoleChange("Removed self from online controllers")
                }
                return
            }
            if (msg.controller) {
                const changed = updateOnlineController(
                    msg.callsign,
                    msg.frequency,
                    staticConfig.myAirports,
                    msg.position,
                )
                // Always broadcast controllers list when a controller connects (even if roles didn't change)
                broadcastControllers()
                if (changed) {
                    const rolesLog = staticConfig.myRolesByAirport
                        ? [...staticConfig.myRolesByAirport.entries()]
                              .map(([a, r]) => `${a}:[${r.join(",")}]`)
                              .join(" ")
                        : "unknown"
                    console.log(`Online controllers changed - effective roles: ${rolesLog}`)
                    reprocessAllStripsForRoleChange("Online controllers changed")
                } else if (isEssaRolesConfig(staticConfig)) {
                    // TWR AOR columns can change without physical ESSA roles changing
                    maybeRefreshEssaRunwayHeaders()
                }
            } else {
                // Non-controller update (or logoff path): drop ghost so covering refreshes
                const changed = removeOnlineController(msg.callsign)
                broadcastControllers()
                if (changed) {
                    reprocessAllStripsForRoleChange(`Controller offline: ${msg.callsign}`)
                }
            }
            return
        }

        // Handle controllerDisconnect - remove from online controller tracking
        if (data.type === "controllerDisconnect") {
            const msg = data as ControllerDisconnectMessage
            const changed = removeOnlineController(msg.callsign)
            // Always broadcast controllers list when a controller disconnects
            broadcastControllers()
            if (changed) {
                const rolesLog = staticConfig.myRolesByAirport
                    ? [...staticConfig.myRolesByAirport.entries()].map(([a, r]) => `${a}:[${r.join(',')}]`).join(' ')
                    : 'unknown'
                console.log(`Controller disconnected: ${msg.callsign} - effective roles: ${rolesLog}`)
                reprocessAllStripsForRoleChange(`Controller disconnected: ${msg.callsign}`)
            } else if (isEssaRolesConfig(staticConfig)) {
                maybeRefreshEssaRunwayHeaders()
            }
            return
        }

        // Handle myselfUpdate to set our callsign and discover airports
        if (data.type === "myselfUpdate") {
            const msg = data as MyselfUpdateMessage
            const previousCallsign = staticConfig.myCallsign
            const callsignChanged = previousCallsign !== msg.callsign
            const esggRolesAtStart = (staticConfig.esggRoles ?? []).join(",")
            const esggLayoutAtStart = (staticConfig.esggLayoutRoles ?? []).join(",")

            // Plugin reports its own compiled version — only trust UDP, never a DLL on disk
            if (typeof msg.pluginVersion === "string" && msg.pluginVersion.trim()) {
                const v = msg.pluginVersion.trim()
                if (reportedPluginVersion !== v) {
                    console.log(`EuroScope plugin version: ${v}`)
                }
                reportedPluginVersion = v
            }

            if (callsignChanged) {
                // Drop previous (and current) self from onlineControllers to avoid ghost roles
                if (previousCallsign) {
                    removeOnlineController(previousCallsign)
                }
                setMyCallsign(msg.callsign)
                removeOnlineController(msg.callsign)
                console.log(`My callsign set to: ${msg.callsign}`)
            }

            setIsController(msg.controller)

            // Parse controller role from callsign (only when not in mock mode, which sets it at startup).
            // Re-run when role differs even if callsign unchanged (first primed update / config load).
            if (!cliArgs.mock && msg.callsign) {
                const role = parseControllerRole(msg.callsign, staticConfig.myAirports)
                if (callsignChanged || role !== staticConfig.myRole) {
                    setMyRole(role)
                    console.log(`Controller role: ${role}`)
                }
            }

            // Detect primary frequency / AoR change (same callsign, different freq)
            const previousFrequency = staticConfig.myFrequency
            const frequencyChanged =
                msg.frequency != null &&
                previousFrequency != null &&
                Math.abs(previousFrequency - msg.frequency) > 0.001

            if (msg.frequency) {
                setMyFrequency(msg.frequency)
                if (frequencyChanged) {
                    console.log(`My frequency changed: ${previousFrequency!.toFixed(3)} -> ${msg.frequency.toFixed(3)} (AoR)`)
                }
            }

            if (typeof msg.position === "string") {
                setMyPositionId(msg.position)
            }

            // Extract airports from rwyconfig.
            // Plugin sets airport-level arr/dep via IsElementActive (ES "active" flag),
            // and runway-level arr/dep via runway IsElementActive (selected RWY).
            if (msg.rwyconfig) {
                const rwyconfig = msg.rwyconfig as Record<string, Record<string, unknown>>

                /** ES airport active flag only (boolean arr/dep) — not runway selection. */
                const fromAirportFlags: string[] = []
                for (const airport of Object.keys(rwyconfig)) {
                    const airportData = rwyconfig[airport]
                    if (!airportData) continue
                    if (airportData.arr === true || airportData.dep === true) {
                        fromAirportFlags.push(airport)
                    }
                }

                /** Runway-selected airports (fallback for single-airport configs). */
                const fromRunwayFlags: string[] = []
                for (const airport of Object.keys(rwyconfig)) {
                    const airportData = rwyconfig[airport]
                    if (!airportData) continue
                    for (const key of Object.keys(airportData)) {
                        if (key === "arr" || key === "dep") continue
                        const val = airportData[key]
                        if (
                            typeof val === "object" &&
                            val !== null &&
                            ((val as { arr?: boolean; dep?: boolean }).arr ||
                                (val as { arr?: boolean; dep?: boolean }).dep)
                        ) {
                            fromRunwayFlags.push(airport)
                            break
                        }
                    }
                }

                if (isMultiAirportConfig(staticConfig)) {
                    // RTC: only ES-active airports (airport-level flag). A selected RWY alone
                    // must not put e.g. ESGG on the top bar when the airport is not active.
                    const fromEs = [
                        ...new Set(
                            fromAirportFlags
                                .filter((a) => getAirportByIcao(a))
                                .map((a) => a.toUpperCase()),
                        ),
                    ]
                    const prevEsKey = esRwySelectAirports.join(",")
                    esRwySelectAirports = fromEs
                    const esChanged = fromEs.join(",") !== prevEsKey
                    const current = staticConfig.activeAirports ?? []
                    const added = fromEs.filter((a) => !current.includes(a))
                    let changed = false
                    if (added.length > 0) {
                        setActiveAirports([...current, ...added])
                        console.log(`[MULTI] Active airports from ES active flag: +${added.join(", ")}`)
                        changed = true
                    }
                    // Drop stale saved airports (e.g. ESGG from runway-only discovery)
                    if (pruneOrphanUserAirports()) changed = true
                    if (changed) {
                        applyMultiAirportViewChange({ reprocess: true })
                    } else if (esChanged) {
                        broadcastStatus()
                    }
                } else {
                    const discovered =
                        fromAirportFlags.length > 0 ? fromAirportFlags : fromRunwayFlags
                    const knownAirports = discovered.filter((a) => getAirportByIcao(a))
                    if (knownAirports.length > 0) {
                        const previousAirports = [...staticConfig.myAirports].sort()
                        const nextAirports = [...knownAirports].sort()
                        const airportsChanged =
                            JSON.stringify(previousAirports) !== JSON.stringify(nextAirports)

                        setMyAirports(knownAirports)
                        if (airportsChanged) {
                            console.log(`Airports discovered from rwyconfig: ${knownAirports.join(", ")}`)
                        }

                        if (airportsChanged && previousAirports.length > 0) {
                            console.log(`Airports changed, clearing store`)
                            store.clear()
                            broadcastRefresh(`Airports changed to ${knownAirports.join(", ")}`)
                            broadcastUserSettings()
                        }
                    }
                }

                // Extract active runways per airport (runway-level selection)
                const previousRunways = JSON.stringify(staticConfig.activeRunways ?? {})
                const activeRunways = extractActiveRunways(rwyconfig)
                setActiveRunways(activeRunways)
                const runwaysChanged = JSON.stringify(activeRunways) !== previousRunways

                // Re-broadcast layout + ATIS (includes arr/dep runways for ESSA RWY label)
                if (runwaysChanged) {
                    console.log(`Active runways changed: ${JSON.stringify(activeRunways)}`)
                    if (!maybeRefreshEssaRunwayHeaders()) {
                        broadcastLayout()
                    }
                    broadcastAtisUpdate()
                    // ARR/DEP changed → R16 suggestConfigId may change
                    checkAupR16Change()
                }

                // Start ATIS polling if not already running
                if (!atisService) {
                    startAtisService()
                }
                ensureAupR16Service()
            }

            // First primed session: ESSR→RTC, ESSA→essa.yml, else ESGG→esgg.yml
            maybeAutoSelectConfigFromAirports(
                staticConfig.activeAirports?.length
                    ? staticConfig.activeAirports
                    : staticConfig.myAirports,
                msg.frequency ?? staticConfig.myFrequency,
                msg.callsign ?? staticConfig.myCallsign,
            )

            // Broadcast updated status to all clients
            broadcastStatus()

            // ESGG: staffed GND/CD drives bay remap (KLARERING → bay5); covering for rules
            const esggRolesNow = (staticConfig.esggRoles ?? []).join(",")
            const esggLayoutNow = (staticConfig.esggLayoutRoles ?? []).join(",")
            if (
                isEsggRolesConfig(staticConfig) &&
                (esggRolesNow !== esggRolesAtStart || esggLayoutNow !== esggLayoutAtStart)
            ) {
                console.log(
                    `[ESGG] Covering: ${esggRolesNow || "(none)"} | layout staffed: ${esggLayoutNow || "(none)"}`,
                )
                maybeAutoDisconnectDclWhenNoCdRole("ESGG covering roles from myselfUpdate")
                store.reprocessAllFlights()
                broadcastLayout()
                broadcastRefresh("ESGG covering/layout roles updated")
            }

            // Recalculate DCL availability when airports change
            recalculateDclAvailability()

            // If callsign or primary frequency (AoR) changed, clear store and tell clients to refresh
            if ((callsignChanged && previousCallsign) || frequencyChanged) {
                if (callsignChanged && previousCallsign) {
                    console.log(`Callsign changed from ${previousCallsign} to ${msg.callsign}, clearing store`)
                } else {
                    console.log(`Frequency/AoR changed, clearing store`)
                }
                store.clear()
                broadcastRefresh(
                    callsignChanged && previousCallsign
                        ? `Callsign changed to ${msg.callsign}`
                        : `Frequency changed to ${msg.frequency?.toFixed(3)}`,
                )
            }

            // After cold start, reconnect, callsign, or AoR frequency change, dump FPs + CDM
            // from the plugin. ES only pushes clearance/CDM on status changes, not on connect.
            if (
                pendingColdPluginRefresh ||
                pendingPluginRefreshAfterReconnect ||
                (callsignChanged && previousCallsign) ||
                frequencyChanged
            ) {
                pendingColdPluginRefresh = false
                pendingPluginRefreshAfterReconnect = false
                console.log("Requesting plugin refresh (cold start / reconnect / callsign / frequency)")
                sendUdp(JSON.stringify({ type: "refresh" }))
            }

            // Forward to clients
            wsClients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(text)
                }
            })
            return
        }

        // Try to process as plugin message
        const result = store.tryProcessPluginMessage(data)

        if (result) {
            // Clear consumed TopSky ROF scratch (/LAM/ROF/… or outbound /ROF/…)
            if (result.clearScratchpadCallsign) {
                const cs = result.clearScratchpadCallsign
                const delay = result.clearScratchpadDelayMs ?? 0
                const clear = () => {
                    sendUdp(JSON.stringify({ type: "clearScratchpad", callsign: cs } satisfies OutboundPluginCommand))
                    console.log(`[ROF] Cleared scratchpad on ${cs}`)
                }
                if (delay > 0) setTimeout(clear, delay)
                else clear()
            }
            // Plugin message was processed - only broadcast/log if there was an actual change
            if (result.transferSound && currentUiSettings.transferSoundsEnabled) {
                playTransferSound(result.transferSound)
            }
            if (result.deletedStripIds && result.deletedStripIds.length > 0) {
                for (const id of result.deletedStripIds) {
                    broadcastStripDelete(id)
                }
                if (result.softDeleted) broadcastDeletedStrips()
                console.log(
                    result.cleanReprint
                        ? `Strips soft-deleted to trash (G/A reprint): ${result.deletedStripIds.join(", ")}`
                        : result.softDeleted
                          ? `Strips soft-deleted: ${result.deletedStripIds.join(", ")}`
                          : `Strips removed: ${result.deletedStripIds.join(", ")}`,
                )
            } else if (result.deleteStripId && !result.strips?.length) {
                broadcastStripDelete(result.deleteStripId)
                if (result.softDeleted) {
                    broadcastDeletedStrips()
                    console.log(`Strip ${result.deleteStripId} soft-deleted → trash`)
                } else {
                    console.log(`Strip ${result.deleteStripId} removed`)
                }
            }

            // G/A APP-assume: clear EFSGA / CTL in EuroScope for the clean reprint
            {
                const goaCs =
                    result.strip?.callsign ??
                    result.strips?.[0]?.callsign ??
                    (typeof result.deleteStripId === "string" ? result.deleteStripId : undefined)
                if (goaCs && result.unsetEfsGoAround) {
                    sendUdp(
                        JSON.stringify({
                            type: "unsetEfsGoAround",
                            callsign: goaCs,
                        } satisfies OutboundPluginCommand),
                    )
                }
                if (goaCs && result.unsetClearedToLand) {
                    sendUdp(
                        JSON.stringify({
                            type: "unsetClearedToLand",
                            callsign: goaCs,
                        } satisfies OutboundPluginCommand),
                    )
                }
            }

            if (result.strips && result.strips.length > 0) {
                if (result.shiftedStrips && result.shiftedStrips.length > 0) {
                    for (const shiftedStrip of result.shiftedStrips) {
                        broadcastStrip(shiftedStrip)
                    }
                }
                if (result.deletedGapKeys && result.deletedGapKeys.length > 0) {
                    for (const key of result.deletedGapKeys) {
                        const parsed = parseGapKey(key)
                        if (parsed) {
                            broadcastGapDelete(parsed.bayId, parsed.sectionId, parsed.index)
                        }
                    }
                }
                if (result.shiftedGaps && result.shiftedGaps.length > 0) {
                    for (const shiftedGap of result.shiftedGaps) {
                        broadcastGap(shiftedGap)
                    }
                }
                for (const strip of result.strips) {
                    // Multi-airport: per-strip autoMoved (single-airport path sets this on result.sectionChanged)
                    const u = result.multiUpdates?.find((mu) => mu.strip?.id === strip.id)
                    const autoMoved =
                        !!u &&
                        !u.isNew &&
                        !u.restored &&
                        !!(u.sectionChanged || u.allowPositionChange)
                    const opts: { autoMoved?: boolean; cleanReprint?: boolean } = {}
                    if (autoMoved) opts.autoMoved = true
                    if (result.cleanReprint) opts.cleanReprint = true
                    broadcastStrip(
                        strip,
                        opts.autoMoved || opts.cleanReprint ? opts : undefined,
                    )
                    // Paper G/A clean reprint: clear synced ink for this strip id
                    if (result.cleanReprint && staticConfig.look === "paper") {
                        scribbleStore.clearScribbles(strip.id)
                        broadcastScribbleUpdate(strip.id, [])
                        void pushStripToRemote(strip.id)
                    }
                }
                console.log(`Strips updated: ${result.strips.map(s => s.id).join(", ")}`)
                if (result.multiUpdates) {
                    for (const u of result.multiUpdates) {
                        if (u.isNew && u.strip) {
                            const f = flightStore.getFlight(u.strip.callsign)
                            if (f) maybeAutoPrepNewDeparture(u.strip, f)
                        }
                    }
                }
                if (result.setScratchValue !== undefined && result.strip) {
                    sendUdp(JSON.stringify({
                        type: "setScratch",
                        callsign: result.strip.callsign,
                        value: result.setScratchValue
                    } satisfies OutboundPluginCommand))
                }
                if (result.clearHs && result.strip) {
                    sendUdp(JSON.stringify({
                        type: "setHs",
                        callsign: result.strip.callsign,
                        value: "",
                    } satisfies OutboundPluginCommand))
                }
            } else if (result.strip) {
                // Auto-move: section changed on an existing strip that wasn't just restored
                const autoMoved = result.sectionChanged && !result.isNew && !result.restored

                // Broadcast shifted strips and gaps BEFORE the main strip so positions
                // are settled by the time the frontend mounts the moved strip
                if (result.shiftedStrips && result.shiftedStrips.length > 0) {
                    for (const shiftedStrip of result.shiftedStrips) {
                        broadcastStrip(shiftedStrip)
                    }
                    console.log(`  Shifted ${result.shiftedStrips.length} strips in ${result.strip.sectionId}`)
                }
                if (result.deletedGapKeys && result.deletedGapKeys.length > 0) {
                    for (const key of result.deletedGapKeys) {
                        const parsed = parseGapKey(key)
                        if (parsed) {
                            broadcastGapDelete(parsed.bayId, parsed.sectionId, parsed.index)
                        }
                    }
                }
                if (result.shiftedGaps && result.shiftedGaps.length > 0) {
                    for (const shiftedGap of result.shiftedGaps) {
                        broadcastGap(shiftedGap)
                    }
                }

                broadcastStrip(result.strip, autoMoved ? { autoMoved: true } : undefined)

                // Log based on what kind of change occurred
                if (result.restored) {
                    console.log(`Strip ${result.strip.callsign} restored -> ${result.strip.sectionId}`)
                } else if (result.isNew) {
                    console.log(`Strip ${result.strip.callsign} created -> ${result.strip.sectionId}`)
                    const newFlight = flightStore.getFlight(result.strip.callsign)
                    if (newFlight) maybeAutoPrepNewDeparture(result.strip, newFlight)
                } else if (result.sectionChanged) {
                    console.log(`Strip ${result.strip.callsign} moved -> ${result.strip.sectionId}`)
                } else {
                    console.log(`Strip ${result.strip.callsign} updated [${(data as { type: string }).type}]`)
                }
                // ES ownership → me (handoff accept / StartTracking): On-assume mode prep
                if (!result.isNew && result.strip.isAssumed) {
                    maybeAutoPrepOnAssume(result.strip.callsign)
                }

                if (result.setScratchValue !== undefined) {
                    sendUdp(JSON.stringify({
                        type: "setScratch",
                        callsign: result.strip.callsign,
                        value: result.setScratchValue
                    } satisfies OutboundPluginCommand))
                }
                if (result.clearHs) {
                    sendUdp(JSON.stringify({
                        type: "setHs",
                        callsign: result.strip.callsign,
                        value: "",
                    } satisfies OutboundPluginCommand))
                }
                // Update DCL clearance preview when flight data changes (non-mock mode)
                {
                    const flight = flightStore.getFlight(result.strip.callsign)
                    if (flight && flight.dclStatus === "REQUEST" && flight.origin) {
                        const templateData = buildDclTemplateData(flight, "")
                        let preview: string | undefined
                        try {
                            preview = fillDclTemplate(flight.origin, templateData)
                        } catch (err) {
                            console.error(`[DCL] Template preview error: ${err instanceof Error ? err.message : err}`)
                        }
                        if (preview && preview !== flight.dclClearance) {
                            flight.dclClearance = preview
                            // Re-broadcast strip with updated preview
                            const updatedStrip = flightStore.regenerateStrip(result.strip.id)
                            if (updatedStrip) {
                                store.updateStripFromFlight(updatedStrip)
                                broadcastStrip(updatedStrip)
                            }
                        }
                    }
                }

                // SEMI/AUTO mode: check if a pending DCL request can now be auto-sent
                if (currentDclMode !== "manual" && hoppieService) {
                    const flight = flightStore.getFlight(result.strip.callsign)
                    if (flight && flight.dclStatus === "REQUEST") {
                        tryAutoSendDcl(flight)
                    }
                }
            }

            // CAD (incl. Refresh bulk) may arrive after strip create — finish deferred DEP PREP.
            // Also runs when CAD has no strip yet (ASSR stored; strip create will see it).
            if (data.type === "controllerAssignedDataUpdate" && typeof data.callsign === "string") {
                flushDeferredAutoDepPrep(data.callsign)
            }

            // ESSA: add RWY headers for FPL-assigned runways not already in RWY config
            if (result.strip || (result.strips && result.strips.length > 0)) {
                maybeRefreshEssaRunwayHeaders()
            }

            // Paper manual print: keep pending queue in sync (eligible flights without strips)
            if (staticConfig.look === "paper" && currentUiSettings.stripPrintMode === "manual") {
                broadcastPendingPrintList()
            }
            // If result is empty (no strip, no delete), nothing changed - don't log
        } else {
            // Not a flight-related plugin message, forward raw JSON to clients
            // (e.g., controllerPositionUpdate, myselfUpdate)
            // wsClients.forEach((client) => {
            //     if (client.readyState === WebSocket.OPEN) {
            //         client.send(text)
            //     }
            // })
        }
    } catch (err) {
        console.error("Failed to parse UDP message as JSON:", err)
        console.error("Raw message:", msg.toString("utf8"))
    }
})
function scheduleUdpRebind(delayMs = 5000) {
    if (udpRebindTimer) return
    udpRebindTimer = setTimeout(() => {
        udpRebindTimer = undefined
        if (udpInBound) return
        try {
            udpIn.bind(udpInPort)
        } catch (e) {
            console.error(`[UDP] Rebind ${udpInPort} failed:`, e)
            scheduleUdpRebind(delayMs)
        }
    }, delayMs)
}

function noteUdpBound() {
    const wasError = !!udpBindError
    udpInBound = true
    udpBindError = undefined
    if (udpRebindTimer) {
        clearTimeout(udpRebindTimer)
        udpRebindTimer = undefined
    }
    console.log(`UDP listener bound to port ${udpInPort}`)
    if (wasError) broadcastStatus()
}

function noteUdpBindConflict() {
    udpInBound = false
    const detail =
        `UDP ${udpInPort} in use (another VatEFS/ES?) - retrying; EFS↔plugin half-duplex until free`
    if (udpBindError !== detail) {
        udpBindError = detail
        console.error(
            `[UDP] Port ${udpInPort} already in use (WSAEADDRINUSE/10048). ` +
                `Another VatEFS / EuroScope bridge may be running - EFS↔plugin will be half-dead until the port is free.`,
        )
        broadcastStatus()
    }
    scheduleUdpRebind(5000)
}

udpIn.on("listening", () => {
    noteUdpBound()
})
udpIn.on("error", (err: NodeJS.ErrnoException) => {
    const code = err.code || ""
    if (code === "EADDRINUSE" || code === "10048") {
        noteUdpBindConflict()
        return
    }
    console.error("UDP receive error:", err)
})
try {
    udpIn.bind(udpInPort)
} catch (e) {
    console.error(`[UDP] Initial bind ${udpInPort} failed:`, e)
    noteUdpBindConflict()
}

// DCL timeout check - cancel clearances that haven't received WILCO/UNABLE within 10 minutes,
// and auto-reject DCL requests that haven't been handled within 10 minutes.
const DCL_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const DCL_CHECK_INTERVAL_MS = 30 * 1000 // Check every 30 seconds

function checkDclTimeouts() {
    if (!hoppieService) return

    const now = Date.now()
    const flights = flightStore.getAllFlights()
    const dclCallsign = getDclCallsign()

    for (const flight of flights) {
        // Timeout: clearance sent but no WILCO/UNABLE received
        if (flight.dclStatus === "SENT" && flight.dclSentAt && flight.dclSeqNumber !== undefined) {
            const elapsed = now - flight.dclSentAt
            if (elapsed >= DCL_TIMEOUT_MS) {
                console.log(`[DCL] Timeout for ${flight.callsign} (sent ${Math.round(elapsed / 1000)}s ago)`)

                const { time, date } = formatTimestamp()
                const seq = hoppieService.getNextSeq()

                hoppieService.sendMessage(
                    flight.callsign,
                    "cpdlc",
                    `/data2/${seq}/${flight.dclSeqNumber}/NE/ATC REQUEST STATUS . . FSM ${time} ${date} ${dclCallsign ?? "----"} @${flight.callsign}@ ACK NOT RECEIVED @CLEARANCE CANCELLED @REVERT TO VOICE PROCEDURES`,
                )

                // Reset DCL state
                flight.dclStatus = undefined
                flight.dclMessage = undefined
                flight.dclClearance = undefined
                flight.dclSeqNumber = undefined
                flight.dclPdcNumber = undefined
                flight.dclSentAt = undefined
                flight.dclRequestedAt = undefined

                // End fast polling since we're giving up
                hoppieService.endFastPoll()

                // Regenerate and broadcast strip
                const strip = flightStore.regenerateStrip(flight.callsign)
                if (strip) {
                    store.updateStripFromFlight(strip)
                    broadcastStrip(strip)
                }
            }
        }

        // Timeout: DCL request received but controller didn't act within 10 minutes
        if (flight.dclStatus === "REQUEST" && flight.dclRequestedAt) {
            const elapsed = now - flight.dclRequestedAt
            if (elapsed >= DCL_TIMEOUT_MS) {
                console.log(`[DCL] Request timeout for ${flight.callsign} (requested ${Math.round(elapsed / 1000)}s ago)`)

                const { time, date } = formatTimestamp()
                const seq = hoppieService.getNextSeq()

                hoppieService.sendMessage(
                    flight.callsign,
                    "cpdlc",
                    `/data2/${seq}//NE/DEPART REQUEST STATUS . FSM ${time} ${date} ${dclCallsign ?? "----"} @${flight.callsign}@ RCD REJECTED @CONTROLLER TIMEOUT @REVERT TO VOICE PROCEDURES`,
                )

                // Reset DCL state
                flight.dclStatus = "REJECTED"
                flight.dclRequestedAt = undefined

                // Regenerate and broadcast strip
                const strip = flightStore.regenerateStrip(flight.callsign)
                if (strip) {
                    store.updateStripFromFlight(strip)
                    broadcastStrip(strip)
                }
            }
        }
    }
}

setInterval(checkDclTimeouts, DCL_CHECK_INTERVAL_MS)

// Calculate initial DCL availability (must be after hoppieService is declared)
recalculateDclAvailability()

// ─── vIFF / CDM via Vatiris proxy ───────────────────────────────────────────

function isDepartingIfrStrip(strip: FlightStrip): boolean {
    return strip.stripType === "departure" && isIfrSidEligible(strip.flightRules)
}

function applyViffPoll(result: ViffPollResult) {
    const ctotByCs = new Map<string, { ctot: string; reason?: string }>()
    for (const entry of result.restricted) {
        ctotByCs.set(entry.callsign.toUpperCase(), {
            ctot: entry.ctot,
            reason: entry.mostPenalisingRegulation,
        })
    }
    const stsByCs = new Map<string, string>()
    for (const entry of result.statuses) {
        stsByCs.set(entry.callsign.toUpperCase(), entry.cdmSts)
    }
    const cdmByCs = new Map<string, ViffPollResult["cdm"][number]>()
    for (const entry of result.cdm) {
        cdmByCs.set(entry.callsign.toUpperCase(), entry)
    }

    for (const strip of store.getAllStrips()) {
        const flight = flightStore.getFlight(strip.callsign)
        if (!flight) continue

        const cs = strip.callsign.toUpperCase()
        let changed = false

        if (isDepartingIfrStrip(strip)) {
            const ctotEntry = ctotByCs.get(cs)
            const cdmEntry = cdmByCs.get(cs)
            // Prefer network restricted CTOT; fall back to CDM airport CTOT
            const newCtot = ctotEntry?.ctot ?? cdmEntry?.ctot
            const newReason = ctotEntry?.reason
            const newSts = stsByCs.get(cs) ?? cdmEntry?.cdmSts
            // TOBT/TSAT/TTOT from CDM airport feed (ESSA), but prefer recent local CDM_data from ES
            const LOCAL_CDM_PREFER_MS = 120_000
            const localFresh = flight.localCdmAt != null && (Date.now() - flight.localCdmAt) < LOCAL_CDM_PREFER_MS
            let newTobt = cdmEntry?.tobt
            let newTsat = cdmEntry?.tsat
            let newTtot = cdmEntry?.ttot
            if (localFresh) {
                if (flight.localCdmTobt !== undefined) newTobt = flight.localCdmTobt
                if (flight.localCdmTsat !== undefined) newTsat = flight.localCdmTsat
                if (flight.localCdmTtot !== undefined) newTtot = flight.localCdmTtot
            } else if (flight.localCdmAt != null) {
                // Local pin expired — fall back to HTTP
                flight.localCdmTobt = undefined
                flight.localCdmTsat = undefined
                flight.localCdmTtot = undefined
                flight.localCdmAt = undefined
            }
            // HTTP caught up to local ES values — drop the pin
            if (
                flight.localCdmAt != null &&
                cdmEntry &&
                cdmEntry.tobt === flight.localCdmTobt &&
                cdmEntry.tsat === flight.localCdmTsat &&
                (flight.localCdmTtot === undefined || cdmEntry.ttot === flight.localCdmTtot)
            ) {
                flight.localCdmTobt = undefined
                flight.localCdmTsat = undefined
                flight.localCdmTtot = undefined
                flight.localCdmAt = undefined
            }
            const newTobtSetBy = cdmEntry?.tobtSetBy
            const newTaxi = cdmEntry?.taxiMinutes

            const stsUpper = newSts?.trim().toUpperCase()
            const isSlc = stsUpper === "SLC" || stsUpper === "SCL"
            const CTOT_SLC_GRACE_MS = 180_000
            // CTOT cancelled (network SLC): latch so strip shows SCL in the CTOT slot
            if (newCtot) {
                if (flight.ctot !== newCtot || flight.ctotCancelled || flight.ctotClearedAt) {
                    flight.ctot = newCtot
                    flight.ctotCancelled = undefined
                    flight.ctotClearedAt = undefined
                    changed = true
                }
            } else if (flight.ctot && localFresh) {
                // Keep recent local ES CTOT while local CDM pin is fresh
            } else if (flight.ctot) {
                flight.ctot = undefined
                if (isSlc) {
                    flight.ctotCancelled = true
                    flight.ctotClearedAt = undefined
                } else {
                    flight.ctotCancelled = undefined
                    flight.ctotClearedAt = Date.now()
                }
                changed = true
            } else if (
                isSlc &&
                !flight.ctotCancelled &&
                flight.ctotClearedAt != null &&
                Date.now() - flight.ctotClearedAt < CTOT_SLC_GRACE_MS
            ) {
                flight.ctotCancelled = true
                flight.ctotClearedAt = undefined
                changed = true
            } else if (flight.ctotCancelled && !isSlc) {
                flight.ctotCancelled = undefined
                flight.ctotClearedAt = undefined
                changed = true
            } else if (
                flight.ctotClearedAt != null &&
                Date.now() - flight.ctotClearedAt >= CTOT_SLC_GRACE_MS
            ) {
                flight.ctotClearedAt = undefined
                changed = true
            }
            if (flight.ctotReason !== newReason) {
                flight.ctotReason = newReason
                changed = true
            }
            if (flight.cdmSts !== newSts) {
                flight.cdmSts = newSts
                changed = true
            }
            // Do not clear TOBT/TSAT/TTOT when HTTP omits the flight
            if (newTobt !== undefined && flight.tobt !== newTobt) {
                flight.tobt = newTobt
                changed = true
            }
            if (newTsat !== undefined && flight.tsat !== newTsat) {
                flight.tsat = newTsat
                changed = true
            }
            if (newTtot !== undefined && flight.ttot !== newTtot) {
                flight.ttot = newTtot
                changed = true
            }
            // Sync set-by:
            // - TOBT==EOBT → clear
            // - API explicit P/A → take it
            // - API silent → keep existing (EFS/ES optimistic A must not vanish on poll)
            if (cdmEntry) {
                const tobtForSetBy = newTobt ?? flight.tobt
                const eobtForSetBy = flight.eobt
                if (tobtForSetBy && eobtForSetBy && tobtForSetBy === eobtForSetBy) {
                    if (flight.tobtSetBy !== undefined) {
                        flight.tobtSetBy = undefined
                        flight.tobtSetByAt = undefined
                        changed = true
                    }
                } else if (newTobtSetBy !== undefined && flight.tobtSetBy !== newTobtSetBy) {
                    flight.tobtSetBy = newTobtSetBy
                    flight.tobtSetByAt = newTobtSetBy === "A" ? Date.now() : undefined
                    changed = true
                }
            }
            if (newTaxi != null && flight.taxiMinutes !== newTaxi) {
                flight.taxiMinutes = newTaxi
                changed = true
            }
        } else if (
            flight.ctot ||
            flight.ctotCancelled ||
            flight.cdmSts ||
            flight.ctotReason ||
            flight.tobt ||
            flight.tsat ||
            flight.ttot ||
            flight.tobtSetBy
        ) {
            flight.ctot = undefined
            flight.ctotCancelled = undefined
            flight.ctotClearedAt = undefined
            flight.cdmSts = undefined
            flight.ctotReason = undefined
            flight.tobt = undefined
            flight.tsat = undefined
            flight.ttot = undefined
            flight.tobtSetBy = undefined
            flight.localCdmTobt = undefined
            flight.localCdmTsat = undefined
            flight.localCdmTtot = undefined
            flight.localCdmAt = undefined
            changed = true
        }

        if (changed) {
            const updated = flightStore.regenerateStrip(strip.callsign)
            if (updated) {
                store.updateStripFromFlight(updated)
                broadcastStrip(updated)
            }
        }
    }
}

const viffService = new ViffService(
    applyViffPoll,
    () => staticConfig.myAirports,
    cliArgs.viffBaseUrl,
)
getViffHealth = () => viffService.getHealth()
forceViffPoll = () => viffService.forcePoll()
if (!isOfflineVatsimRealm()) {
    viffService.start()
}
// Align AFV/ATIS/Hoppie/VIFF with realm now that all services exist
lastOnlineServicesOffline = undefined
syncOnlineNetworkServices()

// ─── Local CDM_data_*.txt (written by CDM plugin next to CDM.dll) ───────────
// VatEFS.dll may load from Program Files and miss these files; poll them here too.
const CDM_DATA_POLL_MS = 1000
let lastCdmDataSnapshot = new Map<string, string>()

function findCdmDataDir(): string | undefined {
    if (!EUROSCOPE_DIR) return undefined
    const plugins = path.join(EUROSCOPE_DIR, EUROSCOPE_PACKAGE, "Plugins")
    if (!fs.existsSync(plugins)) return undefined
    try {
        const has = fs.readdirSync(plugins).some((f) => /^CDM_data_.*\.txt$/i.test(f))
        return has ? plugins : undefined
    } catch {
        return undefined
    }
}

function readCdmFileStable(filePath: string): string | undefined {
    try {
        const s1 = fs.statSync(filePath)
        const c1 = fs.readFileSync(filePath, "utf8")
        const s2 = fs.statSync(filePath)
        if (s1.size !== s2.size || s1.mtimeMs !== s2.mtimeMs) return undefined
        const c2 = fs.readFileSync(filePath, "utf8")
        if (c1 !== c2) return undefined
        return c1
    } catch {
        return undefined
    }
}

function normalizeCdmHhmmField(raw: string): string | undefined {
    const digits = raw.replace(/\D/g, "")
    if (digits.length !== 3 && digits.length !== 4 && digits.length !== 6) return undefined
    const normalized = digits.length === 3 ? digits.padStart(4, "0") : digits.slice(0, 4)
    const h = Number(normalized.slice(0, 2))
    const m = Number(normalized.slice(2, 4))
    if (h > 23 || m > 59) return undefined
    return normalized
}

function pollLocalCdmDataFiles() {
    const dir = findCdmDataDir()
    if (!dir) return

    let files: string[]
    try {
        files = fs.readdirSync(dir).filter((f) => /^CDM_data_.*\.txt$/i.test(f))
    } catch {
        return
    }

    const snapshot = new Map<string, string>()
    const flights: import("./types.js").CdmLocalFlightUpdate[] = []
    let readOk = true

    for (const file of files) {
        const content = readCdmFileStable(path.join(dir, file))
        if (content === undefined) {
            readOk = false
            break
        }
        const airportMatch = file.match(/^CDM_data_(.+)\.txt$/i)
        const airport = airportMatch?.[1]?.toUpperCase()

        for (const line of content.split(/\r?\n/)) {
            if (!line.trim()) continue
            const fields = line.split(",")
            if (fields.length < 5) continue
            const callsign = fields[0].trim().toUpperCase()
            if (!/^[A-Z0-9]{2,8}$/.test(callsign)) continue
            const tobt = normalizeCdmHhmmField(fields[1] || "")
            const tsat = normalizeCdmHhmmField(fields[2] || "")
            const ttot = normalizeCdmHhmmField(fields[3] || "")
            const ctot = normalizeCdmHhmmField(fields[4] || "")
            if (!tobt && !tsat) continue
            let reason = (fields[5] || "").trim()
            if (reason === "flowRestriction") reason = ""

            const key = `${tobt || ""}|${tsat || ""}|${ttot || ""}|${ctot || ""}|${reason}`
            snapshot.set(callsign, key)
            if (lastCdmDataSnapshot.get(callsign) === key) continue

            flights.push({
                callsign,
                airport,
                tobt,
                tsat,
                ttot,
                ctot,
                ctotReason: reason || undefined,
                // setBy comes from ES strip annotation via plugin — omit here
            })
        }
    }

    if (!readOk) return
    lastCdmDataSnapshot = snapshot
    if (flights.length === 0) return

    const result = store.tryProcessPluginMessage({ type: "cdmLocalUpdate", flights })
    if (result?.strips) {
        for (const strip of result.strips) {
            broadcastStrip(strip)
            console.log(`[CDM] Local file update ${strip.callsign} TOBT=${strip.tobt || "-"} TSAT=${strip.tsat || "-"} TTOT=${strip.ttot || "-"}`)
        }
    }
}

const cdmDataDir = findCdmDataDir()
if (cdmDataDir) {
    console.log(`CDM_data directory: ${cdmDataDir}`)
    localFeedState.cdmLocal = { ok: true, detail: path.resolve(cdmDataDir) }
    setInterval(pollLocalCdmDataFiles, CDM_DATA_POLL_MS)
    pollLocalCdmDataFiles()
} else {
    console.warn("CDM_data directory not found under EuroScope package Plugins")
    localFeedState.cdmLocal = { ok: false, detail: "Not found" }
}
