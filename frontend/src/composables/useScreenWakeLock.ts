/**
 * Keep the device awake while VatEFS is visible (Wake Lock API).
 * Always on when supported; silently no-ops on unsupported browsers.
 */

import { onMounted, onUnmounted, ref, watch } from 'vue'

let wakeLock: WakeLockSentinel | null = null
const held = ref(false)

async function requestWakeLock(): Promise<void> {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    if (document.visibilityState !== 'visible') return
    try {
        wakeLock = await navigator.wakeLock.request('screen')
        held.value = true
        wakeLock.addEventListener('release', () => {
            held.value = false
            wakeLock = null
        })
    } catch {
        // Permission denied / unsupported in this context — leave unlocked
        held.value = false
        wakeLock = null
    }
}

async function releaseWakeLock(): Promise<void> {
    try {
        await wakeLock?.release()
    } catch {
        /* ignore */
    }
    wakeLock = null
    held.value = false
}

function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
        void requestWakeLock()
    }
}

/** Request wake lock for the app lifetime; re-acquire when the tab becomes visible again. */
export function useScreenWakeLock() {
    onMounted(() => {
        void requestWakeLock()
        document.addEventListener('visibilitychange', onVisibilityChange)
    })
    onUnmounted(() => {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        void releaseWakeLock()
    })
    watch(
        () => document.visibilityState,
        (v) => {
            if (v === 'visible') void requestWakeLock()
        },
    )
    return { wakeLockHeld: held }
}
