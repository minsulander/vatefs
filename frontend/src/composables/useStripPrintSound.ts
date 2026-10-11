import type { StripPrintSound } from '@vatefs/common'
import printShortUrl from '@/assets/print_short.mp3'
import printLongUrl from '@/assets/print_long.mp3'

const urls: Record<Exclude<StripPrintSound, 'off'>, string> = {
    short: printShortUrl,
    long: printLongUrl,
}

/** Fallback lengths when Audio.duration is not yet available (measured from assets). */
export const STRIP_PRINT_SOUND_MS: Record<'short' | 'long', number> = {
    short: 1306,
    long: 3213,
}

/** Prefetched Audio elements — one per clip so rapid adds can overlap. */
const cache = new Map<string, HTMLAudioElement>()

function getAudio(mode: 'short' | 'long'): HTMLAudioElement {
    let audio = cache.get(mode)
    if (!audio) {
        audio = new Audio(urls[mode])
        audio.preload = 'auto'
        cache.set(mode, audio)
    }
    return audio
}

/** Duration in ms for the active print sound / matching print animation. 0 when off. */
export function getStripPrintDurationMs(mode: StripPrintSound): number {
    if (mode === 'off') return 0
    const base = getAudio(mode)
    const d = base.duration
    if (Number.isFinite(d) && d > 0) return Math.round(d * 1000)
    return STRIP_PRINT_SOUND_MS[mode]
}

/**
 * Play the configured print sound for a newly added strip.
 * Returns the duration (ms) to sync the print animation; 0 when off (no anim).
 */
export function playStripPrintSound(mode: StripPrintSound): number {
    if (mode === 'off') return 0
    try {
        const base = getAudio(mode)
        const clip = base.cloneNode(true) as HTMLAudioElement
        void clip.play().catch(() => {
            // Autoplay may be blocked until a user gesture; ignore quietly.
        })
        const d = clip.duration
        if (Number.isFinite(d) && d > 0) return Math.round(d * 1000)
        return STRIP_PRINT_SOUND_MS[mode]
    } catch {
        return STRIP_PRINT_SOUND_MS[mode]
    }
}

export function isStripPrintSound(value: unknown): value is StripPrintSound {
    return value === 'off' || value === 'short' || value === 'long'
}
