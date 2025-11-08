import express from "express"
import path from "path"
import logRequests from "morgan"
import serveStatic from "serve-static"
import { WebSocket, WebSocketServer } from "ws"
import dgram from "dgram"
import os from "os"
import fs from "fs"

const __dirname = path.dirname(__filename)

const port = 17770
const udpInPort = 17771
const udpOutPort = 17772
const udpHost = "localhost"

const wsServer = new WebSocketServer({ noServer: true })
const wsClients = new Set<WebSocket>()
wsServer.on("connection", (socket) => {
    console.log("socket connected")
    wsClients.add(socket)
    socket.on("message", (message) => {
        const text = message.toString()
        console.log("<<", text)
    })
    socket.on("close", () => {
        wsClients.delete(socket)
    })
})

const app = express()
app.use(logRequests("dev"))
app.use(serveStatic(path.resolve(__dirname, "../public")))
app.get("/*splat", (req, res) => res.sendFile(path.resolve(__dirname, "../public") + "/index.html"))
const server = app.listen(port, () => console.log(`EFS backend listening at http://localhost:${port}`))
server.on("upgrade", (request, socket, head) => {
    wsServer.handleUpgrade(request, socket, head, (socket) => {
        wsServer.emit("connection", socket, request)
    })
})

// UDP socket for sending
let lastUdpString = ""
// Continuously send udp state string to fgcom-mumble at 10Hz (just like radio GUI)
const udp = dgram.createSocket("udp4")
function sendUdp() {
    const udpString = "blah"
    udp.send(udpString, udpOutPort, udpHost, (err, bytes) => {
        if (err) console.log("udp err", err, "bytes", bytes)
    })
    lastUdpString = udpString
}
sendUdp()
setInterval(sendUdp, 1000)

// UDP socket for receiving
const udpIn = dgram.createSocket("udp4")
udpIn.on("message", (msg, rinfo) => {
    try {
        const jsonString = msg.toString("utf8").trim()
        // Parse to validate it's valid JSON
        const jsonObject = JSON.parse(jsonString)
        // Forward to all connected WebSocket clients
        const message = JSON.stringify(jsonObject)
        wsClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message)
            }
        })
        console.log("UDP -> WS:", jsonString)
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

