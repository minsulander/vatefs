import express from "express"
import path from "path"
import logRequests from "morgan"
import serveStatic from "serve-static"
import { WebSocket, WebSocketServer } from "ws"
import dgram from "dgram"

import { constants, isClientMessage } from "@vatefs/common"
import type { ConfigMessage, StripMessage, ServerMessage, ClientMessage } from "@vatefs/common"
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
    strips.forEach((strip, index) => {
        const message: StripMessage = {
            type: 'strip',
            strip: strip
        }
        sendMessage(socket, message)
    })
    console.log(`Sent ${strips.length} strips to client`)
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
            // Legacy request: send config and strips
            sendConfig(socket)
            sendStrips(socket)
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
            }
            break

        case 'moveStrip': {
            const success = store.moveStrip(
                message.stripId,
                message.targetBayId,
                message.targetSectionId,
                message.position,
                message.isBottom
            )
            if (success) {
                // Broadcast updated config to all clients (including sender for consistency)
                const configMsg: ConfigMessage = {
                    type: 'config',
                    config: store.getConfig()
                }
                broadcast(configMsg, socket)
                console.log(`Strip ${message.stripId} moved to ${message.targetSectionId} (bottom: ${message.isBottom})`)
            }
            break
        }

        case 'setGap': {
            store.setGap(message.bayId, message.sectionId, message.index, message.gapSize)
            // Broadcast updated config
            const configMsg: ConfigMessage = {
                type: 'config',
                config: store.getConfig()
            }
            broadcast(configMsg, socket) // Don't send back to sender (they already have the update)
            console.log(`Gap set at ${message.sectionId}[${message.index}] = ${message.gapSize}px`)
            break
        }

        case 'setSectionHeight': {
            store.setSectionHeight(message.bayId, message.sectionId, message.height)
            // Broadcast updated config
            const configMsg: ConfigMessage = {
                type: 'config',
                config: store.getConfig()
            }
            broadcast(configMsg, socket) // Don't send back to sender
            console.log(`Section ${message.sectionId} height set to ${message.height}px`)
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
