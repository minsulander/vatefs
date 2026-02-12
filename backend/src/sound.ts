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

let dclSoundPath: string | null = null

/**
 * Load the DCL notification sound file path from EuroScope directory.
 * Expected location: ESAA/Plugins/TopSkySoundCPDLC.wav
 */
export function loadDclSound(euroscopeDir: string) {
    const soundFile = path.join(euroscopeDir, "ESAA", "Plugins", "TopSkySoundCPDLC.wav")
    if (fs.existsSync(soundFile)) {
        dclSoundPath = soundFile
        console.log(`DCL sound loaded: ${soundFile}`)
    } else {
        dclSoundPath = null
        console.log(`DCL sound file not found: ${soundFile}`)
    }
}

/**
 * Play the DCL notification sound (fire and forget).
 * Does nothing if the sound file was not found.
 */
export function playDclSound() {
    if (!dclSoundPath) return

    const player = getWavPlayer()
    if (!player) return

    player.play({ path: dclSoundPath }).catch((err: Error) => {
        console.warn(`Failed to play DCL sound: ${err.message}`)
    })
}
