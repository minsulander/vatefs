import express from "express"
import path from "path"
import logRequests from "morgan"
import serveStatic from "serve-static"
import { WebSocket, WebSocketServer } from "ws"
import dgram from "dgram"

import { constants, isClientMessage } from "@vatefs/common"
import type { ConfigMessage, FlightMessage, ServerMessage } from "@vatefs/common"
import { mockConfig, mockFlights } from "./mockData.js"

const __dirname = path.dirname(__filename)

const port = 17770
const udpInPort = 17771
const udpOutPort = 17772
const udpHost = "127.0.0.1"

// Helper to send a message to a WebSocket client
function sendMessage(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message))
    }
}

// Send config to a client
function sendConfig(socket: WebSocket) {
    const message: ConfigMessage = {
        type: 'config',
        config: mockConfig
    }
    sendMessage(socket, message)
    console.log("Sent config to client")
}

// Send flights to a client with random delays
function sendFlightsWithDelay(socket: WebSocket) {
    let delay = 0
    mockFlights.forEach((flight, index) => {
        delay += 10 + Math.random() * 100
        setTimeout(() => {
            const message: FlightMessage = {
                type: 'flight',
                flight: flight
            }
            sendMessage(socket, message)
            console.log(`Sent flight ${index + 1}/${mockFlights.length}: ${flight.callsign}`)
        }, delay)
    })
}

// Handle incoming client messages
function handleClientMessage(socket: WebSocket, text: string) {
    try {
        const data = JSON.parse(text)
        if (isClientMessage(data)) {
            if (data.request === 'config') {
                sendConfig(socket)
            } else if (data.request === 'flights') {
                sendFlightsWithDelay(socket)
            }
        }
    } catch {
        // Not a JSON message, check for legacy "?" request
        if (text === '?') {
            // Legacy request: send config and flights
            sendConfig(socket)
            sendFlightsWithDelay(socket)
        } else {
            // Forward to UDP (EuroScope plugin)
            sendUdp(text + "\n")
            console.log("WS -> UDP:", text)
        }
    }
}

const wsServer = new WebSocketServer({ noServer: true })
const wsClients = new Set<WebSocket>()
wsServer.on("connection", (socket) => {
    console.log("Client connected")
    wsClients.add(socket)

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
