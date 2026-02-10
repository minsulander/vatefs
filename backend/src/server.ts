import express from "express"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import logRequests from "morgan"
import serveStatic from "serve-static"
import { WebSocket, WebSocketServer } from "ws"
import dgram from "dgram"

import { constants, isClientMessage, parseGapKey } from "@vatefs/common"
import type {
    LayoutMessage,
    StripMessage,
    StripDeleteMessage,
    GapMessage,
    GapDeleteMessage,
    SectionMessage,
    RefreshMessage,
    StatusMessage,
    DclStatusMessage,
    HoppieMessage,
    AtisUpdateMessage,
    ServerMessage,
    ClientMessage,
    AirportAtisInfo,
} from "@vatefs/common"
import type { FlightStrip, Gap, Section } from "@vatefs/common"
import { store } from "./store.js"
import { flightStore } from "./flightStore.js"
import { setMyCallsign, setMyAirports, setIsController, setMyFrequency, setActiveRunways, staticConfig, determineMoveAction, applyConfig } from "./config.js"
import type { EuroscopeCommand } from "./config.js"
import type { MyselfUpdateMessage } from "./types.js"
import { loadAirports, getAirportCount } from "./airport-data.js"
import { loadRunways, getRunwayCount, getRunwaysByAirport } from "./runway-data.js"
import { isOnRunway } from "./runway-detection.js"
import { loadConfig, getDefaultConfigPath } from "./config-loader.js"
import { loadStands } from "./stand-data.js"
import { loadSidData, getSidsForRunway, getSidAltitude } from "./sid-data.js"
import { loadCtrData, checkCtrAtPosition } from "./ctr-data.js"
import { mockMyselfUpdate } from "./mockPluginMessages.js"
import { loadHoppieConfig, getLogonCode, getDclAirports, fillDclTemplate, fillDclTemplateWithMarkers } from "./hoppie-config.js"
import type { DclTemplateData } from "./hoppie-config.js"
import { HoppieService, checkHoppieStatus } from "./hoppie-service.js"
import { AtisService } from "./atis-service.js"
import type { DclStatus } from "./hoppie-service.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Data directory path (relative to backend root when running from src/)
const dataDir = path.resolve(__dirname, "../../data")

const port = 17770
const udpInPort = 17771
const udpOutPort = 17772
const udpHost = "127.0.0.1"

// Parse command-line arguments
function parseArgs(): { config?: string; callsign?: string; airports?: string[]; recordFile?: string; mock?: boolean } {
    const args = process.argv.slice(2)
    const result: { config?: string; callsign?: string; airports?: string[]; recordFile?: string; mock?: boolean } = {}

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
        } else if (args[i] === "--mock") {
            result.mock = true
        }
    }

    return result
}

const cliArgs = parseArgs()

// Load configuration from YAML file
const configFile = cliArgs.config ?? getDefaultConfigPath(dataDir)
try {
    const config = loadConfig(configFile)
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

/**
 * Validate that a directory is a EuroScope install: must contain ESAA subdir and ESAA*.prf file.
 */
function isValidEuroscopeDir(dir: string): boolean {
    try {
        const esaaPath = path.join(dir, "ESAA")
        if (!fs.existsSync(esaaPath) || !fs.statSync(esaaPath).isDirectory()) {
            return false
        }
        const entries = fs.readdirSync(dir)
        const hasPrf = entries.some((name) => name.startsWith("ESAA") && name.endsWith(".prf"))
        return hasPrf
    } catch {
        return false
    }
}

/**
 * Find EuroScope directory by trying multiple locations in sequence.
 * Valid directory must contain ESAA subdir and at least one ESAA*.prf file.
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
const EUROSCOPE_DIR = findEuroscopeDir()
if (EUROSCOPE_DIR) {
    console.log(`EuroScope directory: ${EUROSCOPE_DIR}`)
    try {
        loadStands(EUROSCOPE_DIR)
    } catch (err) {
        console.warn(`Failed to load stand data: ${err instanceof Error ? err.message : err}`)
    }
    try {
        loadSidData(EUROSCOPE_DIR)
    } catch (err) {
        console.warn(`Failed to load SID data: ${err instanceof Error ? err.message : err}`)
    }
    // Load Hoppie config (logon code + DCL templates)
    loadHoppieConfig(EUROSCOPE_DIR)
} else {
    console.warn("EuroScope directory not found (tried APPDATA, Program Files (x86), VATSIM/drive_c)")
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

type OutboundPluginCommand =
    | { type: "setClearedToLand"; callsign: string }
    | { type: "setGroundState"; callsign: string; state: string }
    | { type: "transfer"; callsign: string }
    | { type: "assume"; callsign: string }
    | { type: "toggleClearanceFlag"; callsign: string }
    | { type: "resetSquawk"; callsign: string }
    | { type: "assignDepartureRunway"; callsign: string; runway: string }
    | { type: "assignSid"; callsign: string; sid: string }
    | { type: "assignHeading"; callsign: string; heading: number }
    | { type: "assignCfl"; callsign: string; altitude: number }

function mapStripActionToPluginCommand(action: string, callsign: string): OutboundPluginCommand | null {
    switch (action) {
        case "CTL":
            return { type: "setClearedToLand", callsign }
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
        case "PARK":
            return { type: "setGroundState", callsign, state: "PARK" }
        case "XFER":
            return { type: "transfer", callsign }
        case "ASSUME":
            return { type: "assume", callsign }
        case "toggleClearanceFlag":
            return { type: "toggleClearanceFlag", callsign }
        case "resetSquawk":
            return { type: "resetSquawk", callsign }
        default:
            return null
    }
}

// ATIS polling service (declared early to avoid temporal dead zone in mock init)
let atisService: AtisService | null = null

// Initialize store (with mock data if --mock flag is set)
if (cliArgs.mock) {
    // Apply mock myselfUpdate to set callsign and airports
    setMyCallsign(mockMyselfUpdate.callsign)
    const mockAirports = Object.keys(mockMyselfUpdate.rwyconfig)
    if (mockAirports.length > 0) {
        setMyAirports(mockAirports)
    }
    setIsController(mockMyselfUpdate.controller)
    setMyFrequency(mockMyselfUpdate.frequency)

    // Extract active runways from mock rwyconfig
    if (mockMyselfUpdate.rwyconfig) {
        const activeRunways = extractActiveRunways(mockMyselfUpdate.rwyconfig as Record<string, Record<string, unknown>>)
        setActiveRunways(activeRunways)
    }

    console.log(`Mock data enabled (callsign: ${mockMyselfUpdate.callsign}, airports: ${mockAirports.join(", ")})`)

    // Start ATIS polling for mock mode
    startAtisService()
}
store.loadMockData(cliArgs.mock ?? false)

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

// Broadcast a strip update
function broadcastStrip(strip: FlightStrip, exclude?: WebSocket) {
    const message: StripMessage = { type: "strip", strip }
    broadcast(message, exclude)
}

// Broadcast a strip delete
function broadcastStripDelete(stripId: string, exclude?: WebSocket) {
    const message: StripDeleteMessage = { type: "stripDelete", stripId }
    broadcast(message, exclude)
}

// Broadcast a gap update
function broadcastGap(gap: Gap, exclude?: WebSocket) {
    const message: GapMessage = { type: "gap", gap }
    broadcast(message, exclude)
}

// Broadcast a gap delete
function broadcastGapDelete(bayId: string, sectionId: string, index: number, exclude?: WebSocket) {
    const message: GapDeleteMessage = { type: "gapDelete", bayId, sectionId, index }
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

// Send status (callsign + airports) to a client
function sendStatus(socket: WebSocket) {
    const message: StatusMessage = {
        type: "status",
        callsign: staticConfig.myCallsign ?? "",
        airports: staticConfig.myAirports,
    }
    sendMessage(socket, message)
}

// Broadcast status to all clients
function broadcastStatus() {
    const message: StatusMessage = {
        type: "status",
        callsign: staticConfig.myCallsign ?? "",
        airports: staticConfig.myAirports,
    }
    broadcast(message)
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
        if (airport === "ESSA" && atisService) {
            const essa = atisService.getEssaAtis()
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
}

/**
 * Start (or restart) the ATIS service for the current airports.
 */
function startAtisService() {
    if (atisService) {
        atisService.stop()
    }
    if (staticConfig.myAirports.length === 0) return

    atisService = new AtisService({
        onUpdate: () => broadcastAtisUpdate(),
    })
    atisService.start(staticConfig.myAirports)
    console.log(`ATIS polling started for: ${staticConfig.myAirports.join(", ")}`)
}

// Hoppie DCL service state
let hoppieService: HoppieService | null = null
let currentDclStatus: DclStatus = "unavailable"
let currentDclError: string | undefined

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
    const message: DclStatusMessage = { type: "dclStatus", status, error }
    broadcast(message)
}

function sendDclStatus(socket: WebSocket) {
    const message: DclStatusMessage = { type: "dclStatus", status: currentDclStatus, error: currentDclError }
    sendMessage(socket, message)
}

/**
 * Recalculate DCL availability. Called when airports change.
 * If no service is active, set status to available/unavailable based on config
 * and Hoppie network status.
 */
function recalculateDclAvailability() {
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
function buildDclTemplateData(flight: import("./types.js").Flight, remarks: string): DclTemplateData {
    const freq = staticConfig.myFrequency
    const freqStr = freq ? freq.toFixed(3) : "---"

    // Format CFL for template (e.g., "5000" -> "A050", or "FL060")
    let cflStr = "---"
    if (flight.cfl && flight.cfl > 2) {
        if (flight.cfl >= 10000) {
            cflStr = `FL${Math.round(flight.cfl / 100)}`
        } else {
            cflStr = `A${String(Math.round(flight.cfl / 100)).padStart(3, "0")}`
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
    }
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

    // Valid request
    console.log(`[DCL] Valid request from ${from} for ${callsign} at ${airport}`)
    flight.dclStatus = "REQUEST"
    flight.dclMessage = packet

    // Build clearance preview
    const templateData = buildDclTemplateData(flight, "")
    const preview = fillDclTemplate(airport!, templateData)
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

        // Send confirmation
        if (hoppieService) {
            const seq = hoppieService.getNextSeq()
            hoppieService.sendMessage(
                from,
                "cpdlc",
                `/data2/${seq}//NE/ATC REQUEST STATUS . . FSM ${time} ${date} ${dclCallsign} @${from}@ CDA RECEIVED @CLEARANCE CONFIRMED`,
            )
        }

        // Set clearance flag via EuroScope plugin
        sendUdp(JSON.stringify({ type: "toggleClearanceFlag", callsign: flight.callsign }))

        // Regenerate and broadcast strip
        const strip = flightStore.regenerateStrip(flight.callsign)
        if (strip) {
            store.updateStripFromFlight(strip)
            broadcastStrip(strip)
        }
    } else if (response!.toUpperCase() === "UNABLE") {
        console.log(`[DCL] UNABLE from ${from} for flight ${flight.callsign}`)
        flight.dclStatus = "UNABLE"

        // Regenerate and broadcast strip
        const strip = flightStore.regenerateStrip(flight.callsign)
        if (strip) {
            store.updateStripFromFlight(strip)
            broadcastStrip(strip)
        }
    }
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

// Send all strips to a client
function sendStrips(socket: WebSocket) {
    const strips = store.getAllStrips()
    strips.forEach((strip) => {
        const message: StripMessage = {
            type: "strip",
            strip: strip,
        }
        sendMessage(socket, message)
    })
    console.log(`Sent ${strips.length} strips to client`)
}

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

// Handle incoming client messages
function handleClientMessage(socket: WebSocket, text: string) {
    try {
        const data = JSON.parse(text)
        if (isClientMessage(data)) {
            handleTypedMessage(socket, data)
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
            }
            break

        case "moveStrip": {
            // Get the strip before moving to capture source section
            const stripBefore = store.getStrip(message.stripId)
            const fromSectionId = stripBefore?.sectionId

            const result = store.moveStrip(
                message.stripId,
                message.targetBayId,
                message.targetSectionId,
                message.position,
                message.isBottom,
            )
            if (result) {
                // Broadcast the moved strip
                broadcastStrip(result.strip, socket)

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

                // Evaluate move rules if section changed
                if (fromSectionId && fromSectionId !== message.targetSectionId) {
                    console.log(
                        `Strip ${message.stripId} dragged from ${fromSectionId} to ${message.targetSectionId} (bottom: ${message.isBottom})`,
                    )

                    const flight = flightStore.getFlight(result.strip.callsign)
                    if (flight) {
                        const moveAction = determineMoveAction(flight, fromSectionId, message.targetSectionId, staticConfig)
                        if (moveAction) {
                            console.log(
                                `[MOVE ACTION] ${result.strip.callsign}: ${formatEuroscopeCommand(moveAction.command)} (rule: ${moveAction.ruleId})`,
                            )
                            if (moveAction.command.type === "setGroundstate") {
                                sendUdp(
                                    JSON.stringify({
                                        type: "setGroundState",
                                        callsign: result.strip.callsign,
                                        state: moveAction.command.value,
                                    }),
                                )
                            } else if (moveAction.command.type === "setClearedToLand") {
                                sendUdp(JSON.stringify({ type: "setClearedToLand", callsign: result.strip.callsign }))
                            } else {
                                console.log("Unimplemented move command")
                            }
                        }
                    }
                } else {
                    console.log(`Strip ${message.stripId} dragged within ${message.targetSectionId} (bottom: ${message.isBottom})`)
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
                const pluginCommand = mapStripActionToPluginCommand(message.action, strip.callsign)
                if (pluginCommand) {
                    sendUdp(JSON.stringify(pluginCommand))
                }

                const flight = flightStore.getFlight(strip.callsign)

                // When toggling clearance flag (user pressed OK for voice clearance), clear DCL state
                if (message.action === "toggleClearanceFlag") {
                    if (flight && flight.dclStatus) {
                        console.log(`[DCL] Clearing DCL state for ${strip.callsign} (voice clearance)`)
                        flight.dclStatus = undefined
                        flight.dclMessage = undefined
                        flight.dclClearance = undefined
                        flight.dclSeqNumber = undefined
                        flight.dclPdcNumber = undefined
                    }
                }

                // In mock mode, apply actions locally since there's no ES plugin roundtrip
                if (cliArgs.mock && flight) {
                    switch (message.action) {
                        case "toggleClearanceFlag":
                            flight.clearance = !flight.clearance
                            break
                        case "ASSUME":
                            flight.controller = staticConfig.myCallsign
                            break
                        case "resetSquawk": {
                            const sq = String(Math.floor(2000 + Math.random() * 5777)).padStart(4, "0")
                            flight.squawk = sq
                            break
                        }
                        case "PUSH":
                            flight.groundstate = "PUSH"
                            break
                        case "LU":
                            flight.groundstate = "LINEUP"
                            break
                        case "CTO":
                            flight.groundstate = "DEPA"
                            break
                        case "TXO":
                            flight.groundstate = "TAXI"
                            break
                        case "TXI":
                            flight.groundstate = "TXIN"
                            break
                        case "PARK":
                            flight.groundstate = "PARK"
                            break
                        case "CTL":
                            flight.clearedToLand = true
                            break
                        case "XFER":
                            flight.controller = ""
                            flight.handoffTargetController = ""
                            break
                    }

                    const updatedStrip = flightStore.regenerateStrip(strip.callsign)
                    if (updatedStrip) {
                        store.updateStripFromFlight(updatedStrip)
                        broadcastStrip(updatedStrip)
                    }
                } else if (message.action === "toggleClearanceFlag") {
                    // Non-mock: still need to broadcast DCL state clear
                    const updatedStrip = flightStore.regenerateStrip(strip.callsign)
                    if (updatedStrip) {
                        store.updateStripFromFlight(updatedStrip)
                        broadcastStrip(updatedStrip)
                    }
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
                    case "assignSid":
                        if (message.value) {
                            pluginCommand = { type: "assignSid", callsign: strip.callsign, sid: message.value }
                            const sidAlt = getSidAltitude(strip.adep, message.value)
                            if (sidAlt !== undefined) {
                                sendUdp(JSON.stringify({ type: "assignCfl", callsign: strip.callsign, altitude: sidAlt }))
                                console.log(`[ASSIGN] Auto-CFL ${sidAlt} for SID ${message.value} at ${strip.adep}`)
                                mockCflAuto = sidAlt
                            }
                        }
                        break
                    case "assignHeading":
                        pluginCommand = { type: "assignHeading", callsign: strip.callsign, heading: parseInt(message.value, 10) || 0 }
                        break
                    case "assignCfl":
                        pluginCommand = { type: "assignCfl", callsign: strip.callsign, altitude: parseInt(message.value, 10) || 0 }
                        break
                }
                if (pluginCommand) {
                    sendUdp(JSON.stringify(pluginCommand))
                }

                // In mock mode, apply assignments locally since there's no ES plugin roundtrip
                if (cliArgs.mock) {
                    const flight = flightStore.getFlight(strip.callsign)
                    if (flight) {
                        switch (message.assignType) {
                            case "assignDepartureRunway":
                                flight.depRwy = message.value
                                break
                            case "assignSid":
                                flight.sid = message.value || undefined
                                if (mockCflAuto !== undefined) {
                                    flight.cfl = mockCflAuto
                                }
                                break
                            case "assignHeading":
                                flight.ahdg = parseInt(message.value, 10) || 0
                                break
                            case "assignCfl":
                                flight.cfl = parseInt(message.value, 10) || 0
                                break
                        }

                        // Update DCL clearance preview if there's an active DCL request
                        if (flight.dclStatus === "REQUEST" && flight.origin) {
                            const templateData = buildDclTemplateData(flight, "")
                            const preview = fillDclTemplate(flight.origin, templateData)
                            if (preview) {
                                flight.dclClearance = preview
                            }
                        }

                        const updatedStrip = flightStore.regenerateStrip(strip.callsign)
                        if (updatedStrip) {
                            store.updateStripFromFlight(updatedStrip)
                            broadcastStrip(updatedStrip)
                        }
                    }
                }
            } else {
                console.log(`[ASSIGN] ${message.assignType} on unknown strip ${message.stripId}`)
            }
            break
        }

        case "deleteStrip": {
            const deletedId = store.manualDeleteStrip(message.stripId)
            if (deletedId) {
                broadcastStripDelete(deletedId, socket)
                console.log(`[DELETE] Strip ${message.stripId} manually deleted`)
            } else {
                console.log(`[DELETE] Strip ${message.stripId} not found`)
            }
            break
        }

        case "dclAction": {
            if (message.action === "login") {
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

            // Determine the airport for the template
            const dclAirport = staticConfig.myAirports.find(
                (a) => a === flight.origin,
            )
            if (!dclAirport) {
                console.log(`[DCL] No DCL airport found for ${strip.callsign}`)
                break
            }

            // Build template data
            const templateData = buildDclTemplateData(flight, message.remarks)

            // Fill template with @ markers for CPDLC
            const markerClearance = fillDclTemplateWithMarkers(dclAirport, templateData)
            if (!markerClearance) {
                console.log(`[DCL] No template found for ${dclAirport}`)
                break
            }

            // Fill template with plain values for preview
            const plainClearance = fillDclTemplate(dclAirport, templateData)

            // Send CPDLC
            if (hoppieService) {
                const dclCallsign = getDclCallsign()
                const { time, date } = formatTimestamp()
                const seq = hoppieService.getNextSeq()
                const pdc = hoppieService.getNextPdc()
                const pdcStr = String(pdc).padStart(3, "0")

                hoppieService.sendMessage(
                    strip.callsign,
                    "cpdlc",
                    `/data2/${seq}//WU/${dclCallsign} PDC ${pdcStr} . . . . . CLD ${time} ${date} ${dclCallsign} PDC ${pdcStr} @${strip.callsign}@ ${markerClearance}`,
                )

                flight.dclStatus = "SENT"
                flight.dclSeqNumber = seq
                flight.dclPdcNumber = pdc
                flight.dclClearance = plainClearance

                console.log(`[DCL] Sent clearance to ${strip.callsign} (seq=${seq}, pdc=${pdcStr})`)
            }

            // Regenerate and broadcast strip
            const sendStrip = flightStore.regenerateStrip(strip.callsign)
            if (sendStrip) {
                store.updateStripFromFlight(sendStrip)
                broadcastStrip(sendStrip)
            }
            break
        }
    }
}

const wsServer = new WebSocketServer({ noServer: true })
const wsClients = new Set<WebSocket>()
wsServer.on("connection", (socket) => {
    console.log("Client connected")
    wsClients.add(socket)

    // Send initial state immediately on connect
    sendLayout(socket)
    sendStrips(socket)
    sendGaps(socket)
    sendStatus(socket)
    sendDclStatus(socket)
    sendAtisUpdate(socket)

    socket.on("message", (message) => {
        const text = message.toString("utf8").trim()
        handleClientMessage(socket, text)
    })

    socket.on("close", () => {
        console.log("Client disconnected")
        wsClients.delete(socket)
    })
})

const app = express()
app.use(logRequests("dev"))

// REST API endpoints
app.get("/api/flights", (req, res) => {
    const flights = flightStore.getAllFlights()
    res.json(flights)
})

app.get("/api/flight/:callsign", (req, res) => {
    const flight = flightStore.getFlight(req.params.callsign)
    if (flight) {
        res.json(flight)
    } else {
        res.status(404).json({ error: "Flight not found" })
    }
})

app.get("/api/config", (req, res) => {
    res.json(staticConfig)
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

    if (!airport || !sid) {
        res.status(400).json({ error: "Missing parameters", usage: "/api/sidalt?airport=ESGG&sid=LABAN4J" })
        return
    }

    const altitude = getSidAltitude(airport, sid)
    res.json({ altitude: altitude ?? null })
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

app.get("/api/dcl/status", (req, res) => {
    res.json({ status: currentDclStatus, error: currentDclError })
})

app.use(serveStatic(path.resolve(__dirname, "../public")))
app.get("/*splat", (req, res) => res.sendFile(path.resolve(__dirname, "../public") + "/index.html"))
const server = app.listen(port, () => console.log(`EFS backend ${constants.version} listening at http://127.0.0.1:${port}`))
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

// UDP socket for receiving
const udpIn = dgram.createSocket("udp4")
udpIn.on("message", (msg, rinfo) => {
    const text = msg.toString("utf8").trim()

    // Record the message if recording is enabled
    recordMessage(text)
    try {
        const data = JSON.parse(text)

        // Handle connectionTypeUpdate - connection type 0 means logged off
        if (data.type === "connectionTypeUpdate" && data.connectionType === 0) {
            console.log("Connection lost (connectionType 0), clearing stores")
            store.clear()
            setMyCallsign("")
            setMyAirports([])
            setIsController(false)
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

        // Handle myselfUpdate to set our callsign and discover airports
        if (data.type === "myselfUpdate") {
            const msg = data as MyselfUpdateMessage
            const previousCallsign = staticConfig.myCallsign
            const callsignChanged = previousCallsign !== msg.callsign

            if (callsignChanged) {
                setMyCallsign(msg.callsign)
                console.log(`My callsign set to: ${msg.callsign}`)
            }

            setIsController(msg.controller)

            // Store frequency
            if (msg.frequency) {
                setMyFrequency(msg.frequency)
            }

            // Extract airports from rwyconfig - any airport with arr or dep set
            // Checks both airport-level flags and runway-level flags
            if (msg.rwyconfig) {
                const discoveredAirports: string[] = []
                // Check airport-level flags first
                for (const airport of Object.keys(msg.rwyconfig)) {
                    const airportData = msg.rwyconfig[airport]
                    if (airportData.arr || airportData.dep) {
                        discoveredAirports.push(airport)
                    }
                }
                // Fall back to checking runway-level flags
                if (discoveredAirports.length == 0) {
                    for (const airport of Object.keys(msg.rwyconfig)) {
                        const airportData = msg.rwyconfig[airport]
                        for (const key of Object.keys(airportData)) {
                            const val = airportData[key]
                            if (typeof val === "object" && val !== null && (val.arr || val.dep)) {
                                discoveredAirports.push(airport)
                                break
                            }
                        }
                    }
                }
                if (discoveredAirports.length > 0) {
                    const previousAirports = [...staticConfig.myAirports]
                    const airportsChanged = JSON.stringify(previousAirports.sort()) !== JSON.stringify(discoveredAirports.sort())

                    setMyAirports(discoveredAirports)
                    if (airportsChanged) console.log(`Airports discovered from rwyconfig: ${discoveredAirports.join(", ")}`)

                    // If airports changed, we need to refresh
                    if (airportsChanged && previousAirports.length > 0) {
                        console.log(`Airports changed, clearing store`)
                        store.clear()
                        broadcastRefresh(`Airports changed to ${discoveredAirports.join(", ")}`)
                    }
                }

                // Extract active runways per airport
                const activeRunways = extractActiveRunways(msg.rwyconfig as Record<string, Record<string, unknown>>)
                setActiveRunways(activeRunways)

                // Start/restart ATIS polling
                startAtisService()
            }

            // Broadcast updated status to all clients
            broadcastStatus()

            // Recalculate DCL availability when airports change
            recalculateDclAvailability()

            // If callsign changed, clear store and tell clients to refresh
            if (callsignChanged && previousCallsign) {
                console.log(`Callsign changed from ${previousCallsign} to ${msg.callsign}, clearing store`)
                store.clear()
                broadcastRefresh(`Callsign changed to ${msg.callsign}`)
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
            // Plugin message was processed - only broadcast/log if there was an actual change
            if (result.deleteStripId) {
                broadcastStripDelete(result.deleteStripId)
                if (result.softDeleted) {
                    console.log(`Strip ${result.deleteStripId} soft-deleted`)
                } else {
                    console.log(`Strip ${result.deleteStripId} disconnected`)
                }
            } else if (result.strip) {
                broadcastStrip(result.strip)

                // Log based on what kind of change occurred
                if (result.restored) {
                    console.log(`Strip ${result.strip.callsign} restored -> ${result.strip.sectionId}`)
                } else if (result.isNew) {
                    console.log(`Strip ${result.strip.callsign} created -> ${result.strip.sectionId}`)
                } else if (result.sectionChanged) {
                    console.log(`Strip ${result.strip.callsign} moved -> ${result.strip.sectionId}`)
                } else {
                    console.log(`Strip ${result.strip.callsign} updated`)
                }

                // Broadcast shifted strips (from add-from-top) - only happens for new strips
                if (result.shiftedStrips && result.shiftedStrips.length > 0) {
                    for (const shiftedStrip of result.shiftedStrips) {
                        broadcastStrip(shiftedStrip)
                    }
                    console.log(`  Shifted ${result.shiftedStrips.length} strips in ${result.strip.sectionId}`)
                }

                // Broadcast gap deletes first, then shifted gaps (from add-from-top)
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
udpIn.on("error", (err) => {
    console.error("UDP receive error:", err)
})
udpIn.bind(udpInPort, () => {
    console.log(`UDP listener bound to port ${udpInPort}`)
})

// Calculate initial DCL availability (must be after hoppieService is declared)
recalculateDclAvailability()
