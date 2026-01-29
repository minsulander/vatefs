import express from "express"
import path from "path"
import logRequests from "morgan"
import serveStatic from "serve-static"
import { WebSocket, WebSocketServer } from "ws"
import dgram from "dgram"

import { constants, isClientMessage } from "@vatefs/common"
import type { ConfigMessage, StripMessage, StripDeleteMessage, GapMessage, GapDeleteMessage, SectionMessage, ServerMessage, ClientMessage } from "@vatefs/common"
import type { FlightStrip, Gap, Section } from "@vatefs/common"
import { store } from "./store.js"

const __dirname = path.dirname(__filename)

const port = 17770
const udpInPort = 17771
const udpOutPort = 17772
const udpHost = "127.0.0.1"

// Initialize store with mock data
store.loadMockData()

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

// Helper to parse gap key (bayId:sectionId:index)
function parseGapKey(key: string): { bayId: string, sectionId: string, index: number } | null {
    const parts = key.split(':')
    if (parts.length !== 3) return null
    const index = parseInt(parts[2], 10)
    if (isNaN(index)) return null
    return { bayId: parts[0], sectionId: parts[1], index }
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

                console.log(`Strip ${message.stripId} moved to ${message.targetSectionId} (bottom: ${message.isBottom})`)
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
    try {
        const message = msg.toString("utf8").trim()
        wsClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message)
            }
        })
        console.log("UDP -> WS:", message)
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
