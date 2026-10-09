import { ref } from 'vue'

const STORAGE_KEY = 'efs/zoomStripScalePercent'
const PERCENT_MIN = 50
const PERCENT_MAX = 200
const PERCENT_STEP = 5
const PERCENT_DEFAULT = 100

function clampPercent(n: number): number {
  const stepped = Math.round(n / PERCENT_STEP) * PERCENT_STEP
  return Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, stepped))
}

function loadPercent(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null) return PERCENT_DEFAULT
    const n = Number(raw)
    if (!Number.isFinite(n)) return PERCENT_DEFAULT
    return clampPercent(n)
  } catch {
    return PERCENT_DEFAULT
  }
}

const zoomStripScalePercent = ref(loadPercent())

export function getZoomStripScalePercent(): number {
  return zoomStripScalePercent.value
}

export function setZoomStripScalePercent(percent: number): void {
  const next = clampPercent(percent)
  zoomStripScalePercent.value = next
  try {
    localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    /* ignore quota / private mode */
  }
}

/** Reactive percent for zoomed-strip size (independent of UI scale). */
export function useZoomStripScalePercent() {
  return zoomStripScalePercent
}

export const ZOOM_STRIP_SCALE_PERCENT_MIN = PERCENT_MIN
export const ZOOM_STRIP_SCALE_PERCENT_MAX = PERCENT_MAX
export const ZOOM_STRIP_SCALE_PERCENT_STEP = PERCENT_STEP
export const ZOOM_STRIP_SCALE_PERCENT_DEFAULT = PERCENT_DEFAULT
