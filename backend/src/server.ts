import express from "express"
import path from "path"
import fs from "fs"
import logRequests from "morgan"
import serveStatic from "serve-static"
import { WebSocket, WebSocketServer } from "ws"
import dgram from "dgram"

import { constants, isClientMessage, parseGapKey } from "@vatefs/common"
import type { ConfigMessage, StripMessage, StripDeleteMessage, GapMessage, GapDeleteMessage, SectionMessage, ServerMessage, ClientMessage } from "@vatefs/common"
import type { FlightStrip, Gap, Section } from "@vatefs/common"
import { store } from "./store.js"
import { flightStore } from "./flightStore.js"
import { setMyCallsign, staticConfig, determineMoveAction } from "./config.js"
import type { EuroscopeCommand } from "./config.js"
import type { MyselfUpdateMessage } from "./types.js"

const __dirname = path.dirname(__filename)

const port = 17770
const udpInPort = 17771
const udpOutPort = 17772
const udpHost = "127.0.0.1"

// Parse command-line arguments
function parseArgs(): { airport?: string; callsign?: string; recordFile?: string; mock?: boolean } {
    const args = process.argv.slice(2)
    const result: { airport?: string; callsign?: string; recordFile?: string; mock?: boolean } = {}

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--airport' && args[i + 1]) {
            result.airport = args[++i]
        } else if (args[i] === '--callsign' && args[i + 1]) {
            result.callsign = args[++i]
        } else if (args[i] === '--record' && args[i + 1]) {
            result.recordFile = args[++i]
        } else if (args[i] === '--mock') {
            result.mock = true
        }
    }

    return result
}

const cliArgs = parseArgs()

// Apply command-line config overrides
if (cliArgs.airport) {
    staticConfig.ourAirport = cliArgs.airport
    console.log(`Airport set to: ${cliArgs.airport}`)
}
if (cliArgs.callsign) {
    staticConfig.myCallsign = cliArgs.callsign
    console.log(`Callsign set to: ${cliArgs.callsign}`)
}

// Recording state
let recordStream: fs.WriteStream | null = null
let recordStartTime: number | null = null

if (cliArgs.recordFile) {
    recordStream = fs.createWriteStream(cliArgs.recordFile, { flags: 'a' })
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
        case 'setClearance':
            return `setClearance(${command.value})`
        case 'setGroundstate':
            return `setGroundstate(${command.value})`
        case 'setClearedToLand':
            return `setClearedToLand(${command.value})`
        case 'setClearedForTakeoff':
            return `setClearedForTakeoff(${command.value})`
    }
}

// Initialize store (with mock data if --mock flag is set)
store.loadMockData(cliArgs.mock ?? false)
if (cliArgs.mock) {
    console.log('Mock data enabled')
}

// Helper to send a message to a WebSocket client
function sendMessage(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message))
    }
}

// Broadcast a message to all connected clients except the sender
function broadcast(message: ServerMessage, exclude?: WebSocket) {
    wsClients.forEach(client => {
        if (client !== exclude && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message))
        }
    })
}

// Broadcast a strip update
function broadcastStrip(strip: FlightStrip, exclude?: WebSocket) {
    const message: StripMessage = { type: 'strip', strip }
    broadcast(message, exclude)
}

// Broadcast a strip delete
function broadcastStripDelete(stripId: string, exclude?: WebSocket) {
    const message: StripDeleteMessage = { type: 'stripDelete', stripId }
    broadcast(message, exclude)
}

// Broadcast a gap update
function broadcastGap(gap: Gap, exclude?: WebSocket) {
    const message: GapMessage = { type: 'gap', gap }
    broadcast(message, exclude)
}

// Broadcast a gap delete
function broadcastGapDelete(bayId: string, sectionId: string, index: number, exclude?: WebSocket) {
    const message: GapDeleteMessage = { type: 'gapDelete', bayId, sectionId, index }
    broadcast(message, exclude)
}

// Broadcast a section update
function broadcastSection(bayId: string, section: Section, exclude?: WebSocket) {
    const message: SectionMessage = { type: 'section', bayId, section }
    broadcast(message, exclude)
}

// Send config to a client
function sendConfig(socket: WebSocket) {
    const message: ConfigMessage = {
        type: 'config',
        config: store.getConfig()
    }
    sendMessage(socket, message)
    console.log("Sent config to client")
}

// Send all strips to a client
function sendStrips(socket: WebSocket) {
    const strips = store.getAllStrips()
    strips.forEach((strip) => {
        const message: StripMessage = {
            type: 'strip',
            strip: strip
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
            type: 'gap',
            gap: gap
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
        if (text === '?') {
            // Legacy request: send config, strips, and gaps
            sendConfig(socket)
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
function handleTypedMessage(socket: WebSocket, message: ClientMessage) {
    switch (message.type) {
        case 'request':
            if (message.request === 'config') {
                sendConfig(socket)
            } else if (message.request === 'strips') {
                sendStrips(socket)
                sendGaps(socket)
            }
            break

        case 'moveStrip': {
            // Get the strip before moving to capture source section
            const stripBefore = store.getStrip(message.stripId)
            const fromSectionId = stripBefore?.sectionId

            const result = store.moveStrip(
                message.stripId,
                message.targetBayId,
                message.targetSectionId,
                message.position,
                message.isBottom
            )
            if (result) {
                // Broadcast the moved strip
                broadcastStrip(result.strip, socket)

                // Broadcast affected gaps
                result.affectedGaps.forEach(gap => {
                    broadcastGap(gap, socket)
                })

                // Broadcast deleted gaps
                result.deletedGapKeys.forEach(key => {
                    const parsed = parseGapKey(key)
                    if (parsed) {
                        broadcastGapDelete(parsed.bayId, parsed.sectionId, parsed.index, socket)
                    }
                })

                // Evaluate move rules if section changed
                if (fromSectionId && fromSectionId !== message.targetSectionId) {
                    console.log(`Strip ${message.stripId} dragged from ${fromSectionId} to ${message.targetSectionId} (bottom: ${message.isBottom})`)

                    const flight = flightStore.getFlight(result.strip.callsign)
                    if (flight) {
                        const moveAction = determineMoveAction(
                            flight,
                            fromSectionId,
                            message.targetSectionId,
                            staticConfig
                        )
                        if (moveAction) {
                            console.log(`[MOVE ACTION] ${result.strip.callsign}: ${formatEuroscopeCommand(moveAction.command)} (rule: ${moveAction.ruleId})`)
                            // TODO: Send command to EuroScope plugin via UDP
                            // sendUdp(JSON.stringify({ type: 'command', callsign: result.strip.callsign, command: moveAction.command }))
                        }
                    }
                } else {
                    console.log(`Strip ${message.stripId} dragged within ${message.targetSectionId} (bottom: ${message.isBottom})`)
                }
            }
            break
        }

        case 'setGap': {
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

        case 'setSectionHeight': {
            const section = store.setSectionHeight(message.bayId, message.sectionId, message.height)
            if (section) {
                broadcastSection(message.bayId, section, socket)
                console.log(`Section ${message.sectionId} height set to ${message.height}px`)
            }
            break
        }

        case 'stripAction': {
            const strip = store.getStrip(message.stripId)
            if (strip) {
                // TODO: Send action to EuroScope plugin via UDP
                console.log(`[ACTION] ${message.action} on ${message.stripId} (${strip.callsign})`)
                console.log(`  Flight: ${strip.adep} -> ${strip.ades}`)
                console.log(`  Current section: ${strip.sectionId}`)

                // Placeholder for future UDP message to plugin
                // sendUdp(JSON.stringify({ type: 'action', callsign: strip.callsign, action: message.action }))
            } else {
                console.log(`[ACTION] ${message.action} on unknown strip ${message.stripId}`)
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
    sendConfig(socket)
    sendStrips(socket)
    sendGaps(socket)

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
    console.log("UDP:", text)

    // Record the message if recording is enabled
    recordMessage(text)
    try {
        const data = JSON.parse(text)

        // Handle myselfUpdate to set our callsign
        if (data.type === 'myselfUpdate') {
            const msg = data as MyselfUpdateMessage
            setMyCallsign(msg.callsign)
            console.log(`My callsign set to: ${msg.callsign}`)
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
            // Plugin message was processed
            if (result.deleteStripId) {
                broadcastStripDelete(result.deleteStripId)
                if (result.softDeleted) {
                    console.log(`UDP: Flight ${result.deleteStripId} soft-deleted`)
                } else {
                    console.log(`UDP: Flight ${result.deleteStripId} disconnected`)
                }
            } else if (result.strip) {
                broadcastStrip(result.strip)
                if (result.restored) {
                    console.log(`UDP: Strip ${result.strip.callsign} restored and in ${result.strip.sectionId}`)
                } else if (result.sectionChanged) {
                    console.log(`UDP: Strip ${result.strip.callsign} moved to ${result.strip.sectionId}`)
                } else {
                    console.log(`UDP: Strip ${result.strip.callsign} updated`)
                }

                // Broadcast shifted strips (from add-from-top)
                if (result.shiftedStrips && result.shiftedStrips.length > 0) {
                    for (const shiftedStrip of result.shiftedStrips) {
                        broadcastStrip(shiftedStrip)
                    }
                    console.log(`UDP: Shifted ${result.shiftedStrips.length} strips in ${result.strip.sectionId}`)
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
                    console.log(`UDP: Shifted ${result.shiftedGaps.length} gaps in ${result.strip.sectionId}`)
                }
            }
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
