import { ref, watch, onMounted, onUnmounted } from 'vue'

const STORAGE_KEY = 'efs/uiScalePercent'
const REF_WIDTH = 1280
const SCALE_MIN = 0.5
const SCALE_MAX = 2.5
const PERCENT_MIN = 50
const PERCENT_MAX = 200
const PERCENT_STEP = 5
const PERCENT_DEFAULT = 100

const uiScalePercent = ref(loadPercent())
const efsScale = ref(computeEfsScale(uiScalePercent.value))
let started = false
let removeListeners: (() => void) | null = null

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

function computeEfsScale(percent: number): number {
  const width = typeof window !== 'undefined' ? window.innerWidth : REF_WIDTH
  const viewportFactor = width / REF_WIDTH
  const multiplier = percent / 100
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, viewportFactor * multiplier))
}

function applyEfsScale(): void {
  const scale = computeEfsScale(uiScalePercent.value)
  efsScale.value = scale
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--efs-scale', String(scale))
}

export function getUiScalePercent(): number {
  return uiScalePercent.value
}

export function setUiScalePercent(percent: number): void {
  const next = clampPercent(percent)
  uiScalePercent.value = next
  try {
    localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    /* ignore quota / private mode */
  }
  applyEfsScale()
}

/** Reactive percent for Settings binding. */
export function useUiScalePercent() {
  return uiScalePercent
}

/** Reactive computed scale (viewport × multiplier, clamped). */
export function useEfsScaleValue() {
  return efsScale
}

/** Scale a design px size; optional CSS-px floor for touch targets. */
export function scalePx(designPx: number, minPx = 0): number {
  return Math.max(minPx, Math.round(designPx * efsScale.value))
}

/**
 * Mount once from App: keeps --efs-scale on <html> from viewport width × user %.
 */
export function useEfsUiScale() {
  onMounted(() => {
    if (started) {
      applyEfsScale()
      return
    }
    started = true
    applyEfsScale()

    const onResize = () => applyEfsScale()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    removeListeners = () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      removeListeners = null
      started = false
    }
  })

  onUnmounted(() => {
    removeListeners?.()
  })

  watch(uiScalePercent, () => applyEfsScale())

  return {
    uiScalePercent,
    setUiScalePercent,
    applyEfsScale,
  }
}

export const UI_SCALE_PERCENT_MIN = PERCENT_MIN
export const UI_SCALE_PERCENT_MAX = PERCENT_MAX
export const UI_SCALE_PERCENT_STEP = PERCENT_STEP
export const UI_SCALE_PERCENT_DEFAULT = PERCENT_DEFAULT

// Apply as soon as the module loads so first paint has a correct --efs-scale.
if (typeof document !== 'undefined') {
  applyEfsScale()
}
