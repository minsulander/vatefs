/**
 * Sound playback for notification alerts.
 * Uses node-wav-player which supports Windows (PowerShell), macOS (afplay), and Linux (aplay).
 */

import fs from "fs"
import path from "path"

interface WavPlayer {
    play: (params: { path: string; sync?: boolean; loop?: boolean }) => Promise<void>
    stop: () => void
}

export type TransferSoundKind = "request" | "accept" | "refuse"

// Lazy-loaded wav player instance
let wavPlayer: WavPlayer | null = null

function getWavPlayer(): WavPlayer | null {
    if (wavPlayer) return wavPlayer
    try {
        // Dynamic import of CJS module - esbuild will bundle this
        wavPlayer = require("node-wav-player") as WavPlayer
        return wavPlayer
    } catch {
        return null
    }
}

function playWav(soundPath: string | null, label: string) {
    if (!soundPath) return

    const player = getWavPlayer()
    if (!player) return

    player.play({ path: soundPath }).catch((err: Error) => {
        console.warn(`Failed to play ${label} sound: ${err.message}`)
    })
}

function resolvePluginSound(euroscopeDir: string, fileName: string): string | null {
    const soundFile = path.join(euroscopeDir, "ESAA", "Plugins", fileName)
    if (fs.existsSync(soundFile)) return soundFile
    return null
}

let dclSoundPath: string | null = null
let transferRequestSoundPath: string | null = null
let transferAcceptSoundPath: string | null = null
let transferRefuseSoundPath: string | null = null

/**
 * Load the DCL notification sound file path from EuroScope directory.
 * Expected location: ESAA/Plugins/TopSkySoundCPDLC.wav
 */
export function loadDclSound(euroscopeDir: string) {
    dclSoundPath = resolvePluginSound(euroscopeDir, "TopSkySoundCPDLC.wav")
    if (dclSoundPath) {
        console.log(`DCL sound loaded: ${dclSoundPath}`)
    } else {
        console.log(`DCL sound file not found: ${path.join(euroscopeDir, "ESAA", "Plugins", "TopSkySoundCPDLC.wav")}`)
    }
}

/**
 * Load TopSky coordination sounds used for transfer alerts.
 * - request: TopSkySoundCoord.wav
 * - accept:  TopSkySoundCoordACP.wav
 * - refuse:  TopSkySoundCoordRJC.wav
 */
export function loadTransferSounds(euroscopeDir: string) {
    transferRequestSoundPath = resolvePluginSound(euroscopeDir, "TopSkySoundCoord.wav")
    transferAcceptSoundPath = resolvePluginSound(euroscopeDir, "TopSkySoundCoordACP.wav")
    transferRefuseSoundPath = resolvePluginSound(euroscopeDir, "TopSkySoundCoordRJC.wav")

    const loaded = [
        transferRequestSoundPath && "request",
        transferAcceptSoundPath && "accept",
        transferRefuseSoundPath && "refuse",
    ].filter(Boolean)

    if (loaded.length > 0) {
        console.log(`Transfer sounds loaded: ${loaded.join(", ")}`)
    } else {
        console.log("Transfer sound files not found in ESAA/Plugins (TopSkySoundCoord*.wav)")
    }
}

/**
 * Play the DCL notification sound (fire and forget).
 * Does nothing if the sound file was not found.
 */
export function playDclSound() {
    playWav(dclSoundPath, "DCL")
}

/**
 * Play a transfer-related sound (inbound request / accept / refuse).
 */
export function playTransferSound(kind: TransferSoundKind) {
    switch (kind) {
        case "request":
            playWav(transferRequestSoundPath, "transfer request")
            break
        case "accept":
            playWav(transferAcceptSoundPath, "transfer accept")
            break
        case "refuse":
            playWav(transferRefuseSoundPath, "transfer refuse")
            break
    }
}
