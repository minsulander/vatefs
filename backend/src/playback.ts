#!/usr/bin/env npx tsx
/**
 * Playback script for recorded UDP messages
 *
 * Usage: npx tsx playback.ts ./messages.file
 *
 * Reads a recording file created by the backend's --record option
 * and replays the messages with the same timing.
 */

import fs from "fs"
import dgram from "dgram"

const DEFAULT_UDP_PORT = 17771
const DEFAULT_UDP_HOST = "127.0.0.1"

function parseArgs(): { file: string; port: number; host: string; speed: number } {
    const args = process.argv.slice(2)
    let file = ""
    let port = DEFAULT_UDP_PORT
    let host = DEFAULT_UDP_HOST
    let speed = 1.0

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--port' && args[i + 1]) {
            port = parseInt(args[++i], 10)
        } else if (args[i] === '--host' && args[i + 1]) {
            host = args[++i]
        } else if (args[i] === '--speed' && args[i + 1]) {
            speed = parseFloat(args[++i])
        } else if (!args[i].startsWith('-')) {
            file = args[i]
        }
    }

    return { file, port, host, speed }
}

interface RecordedMessage {
    relativeTime: number
    message: string
}

function loadRecording(filePath: string): RecordedMessage[] {
    const content = fs.readFileSync(filePath, "utf8")
    const lines = content.split("\n").filter(line => line.trim())

    return lines.map(line => {
        const tabIndex = line.indexOf("\t")
        if (tabIndex === -1) {
            throw new Error(`Invalid recording format: ${line}`)
        }
        const relativeTime = parseInt(line.substring(0, tabIndex), 10)
        const message = line.substring(tabIndex + 1)
        return { relativeTime, message }
    })
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function playback(
    messages: RecordedMessage[],
    udpSocket: dgram.Socket,
    host: string,
    port: number,
    speed: number
): Promise<void> {
    console.log(`Playing back ${messages.length} messages at ${speed}x speed...`)

    let lastTime = 0

    for (let i = 0; i < messages.length; i++) {
        const { relativeTime, message } = messages[i]

        // Wait for the appropriate time (adjusted by speed)
        const delay = (relativeTime - lastTime) / speed
        if (delay > 0) {
            await sleep(delay)
        }
        lastTime = relativeTime

        // Send the message
        udpSocket.send(message + "\n", port, host, (err) => {
            if (err) {
                console.error(`Error sending message ${i + 1}:`, err)
            }
        })

        // Log progress
        const elapsed = (relativeTime / 1000).toFixed(1)
        console.log(`[${elapsed}s] Message ${i + 1}/${messages.length}: ${message.substring(0, 60)}${message.length > 60 ? '...' : ''}`)
    }

    console.log("Playback complete!")
}

async function main() {
    const { file, port, host, speed } = parseArgs()

    if (!file) {
        console.error("Usage: npx tsx playback.ts <recording-file> [--port 17771] [--host 127.0.0.1] [--speed 1.0]")
        console.error("")
        console.error("Options:")
        console.error("  --port <port>   UDP port to send to (default: 17771)")
        console.error("  --host <host>   UDP host to send to (default: 127.0.0.1)")
        console.error("  --speed <n>     Playback speed multiplier (default: 1.0)")
        process.exit(1)
    }

    if (!fs.existsSync(file)) {
        console.error(`File not found: ${file}`)
        process.exit(1)
    }

    console.log(`Loading recording from: ${file}`)
    const messages = loadRecording(file)
    console.log(`Loaded ${messages.length} messages`)

    if (messages.length === 0) {
        console.log("No messages to play back")
        process.exit(0)
    }

    const totalDuration = messages[messages.length - 1].relativeTime / 1000
    console.log(`Recording duration: ${totalDuration.toFixed(1)} seconds`)
    console.log(`Sending to: ${host}:${port}`)

    const udpSocket = dgram.createSocket("udp4")

    try {
        await playback(messages, udpSocket, host, port, speed)
    } finally {
        udpSocket.close()
    }
}

main().catch(err => {
    console.error("Error:", err)
    process.exit(1)
})
