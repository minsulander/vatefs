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
const efsChromeScale = ref(computeChromeScale(uiScalePercent.value))
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

/** Top/bottom bar chrome: follows UI % strongly; mild viewport so iPad≠PC extremes. */
function computeChromeScale(percent: number): number {
  const width = typeof window !== 'undefined' ? window.innerWidth : REF_WIDTH
  const viewportFactor = width / REF_WIDTH
  // Soften viewport (√) so 60% on a wide PC stays usable and 100% on ~12" isn't huge
  let softViewport = Math.sqrt(Math.min(1.6, Math.max(0.55, viewportFactor)))
  // Extra squeeze below ~1200px before content-fit pass
  if (width < 1200) {
    softViewport *= Math.max(0.72, width / 1200)
  }
  const scale = softViewport * (percent / 100)
  return Math.min(1.85, Math.max(0.48, scale))
}

/** Base chrome before overflow-fit compression */
let baseChromeScale = 1
let chromeFitRaf = 0

function updateBarHeights(chrome: number): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--efs-top-bar-h', `${Math.round(28 * chrome)}px`)
  root.style.setProperty('--efs-bottom-bar-h', `${Math.round(40 * chrome)}px`)
}

/** Intrinsic content width of a chrome bar (ignores flex/grid shrinking). */
function measureBarNeed(el: HTMLElement): number {
  const prevWidth = el.style.width
  const prevMax = el.style.maxWidth
  const prevOverflow = el.style.overflow
  const prevGrid = el.style.gridTemplateColumns
  const isBottom = el.classList.contains('efs-bottom-bar')
  el.style.width = 'max-content'
  el.style.maxWidth = 'none'
  el.style.overflow = 'visible'
  // 1fr columns collapse under max-content; force content-sized tracks
  if (isBottom) {
    el.style.gridTemplateColumns = 'max-content max-content max-content'
  }
  void el.offsetWidth
  const need = el.scrollWidth
  el.style.width = prevWidth
  el.style.maxWidth = prevMax
  el.style.overflow = prevOverflow
  el.style.gridTemplateColumns = prevGrid
  return need
}

/**
 * If top/bottom bar content overflows the window width, compress --efs-chrome-scale
 * (fonts, padding, icon sizes via chrome) until it fits.
 */
function fitChromeToWidth(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const bars = [
    document.querySelector('.efs-top-bar') as HTMLElement | null,
    document.querySelector('.efs-bottom-bar') as HTMLElement | null,
  ].filter((el): el is HTMLElement => !!el)
  if (bars.length === 0) return

  // Measure against uncompressed chrome, then refine (non-linear bits / subpixel)
  let fit = 1
  for (let pass = 0; pass < 3; pass++) {
    const chromeTry = baseChromeScale * fit
    root.style.setProperty('--efs-chrome-scale', String(chromeTry))
    root.style.setProperty('--efs-chrome-fit', String(fit))
    updateBarHeights(chromeTry)

    let worst = 1
    for (const el of bars) {
      const avail =
        el.parentElement?.clientWidth ||
        document.documentElement.clientWidth ||
        el.clientWidth
      const need = measureBarNeed(el)
      if (avail > 0 && need > avail + 1) {
        worst = Math.min(worst, avail / need)
      }
    }
    if (worst >= 0.999) break
    fit = Math.min(1, Math.max(0.42, fit * worst * 0.98))
  }

  const chrome = baseChromeScale * fit
  efsChromeScale.value = chrome
  root.style.setProperty('--efs-chrome-scale', String(chrome))
  root.style.setProperty('--efs-chrome-fit', String(fit))
  updateBarHeights(chrome)
}

function scheduleChromeFit(): void {
  if (typeof window === 'undefined') return
  if (chromeFitRaf) cancelAnimationFrame(chromeFitRaf)
  chromeFitRaf = requestAnimationFrame(() => {
    chromeFitRaf = requestAnimationFrame(() => {
      chromeFitRaf = 0
      fitChromeToWidth()
    })
  })
}

function applyEfsScale(): void {
  const scale = computeEfsScale(uiScalePercent.value)
  baseChromeScale = computeChromeScale(uiScalePercent.value)
  efsScale.value = scale
  efsChromeScale.value = baseChromeScale
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--efs-scale', String(scale))
  root.style.setProperty('--efs-chrome-scale', String(baseChromeScale))
  root.style.setProperty('--efs-chrome-fit', '1')
  updateBarHeights(baseChromeScale)
  scheduleChromeFit()
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

/** Reactive chrome scale for top/bottom bars (UI % + softened viewport). */
export function useEfsChromeScaleValue() {
  return efsChromeScale
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

    // Re-fit when bar content changes (ATIS, callsign, etc.)
    let mutTimer: ReturnType<typeof setTimeout> | null = null
    const mutObs =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            if (mutTimer) clearTimeout(mutTimer)
            mutTimer = setTimeout(() => {
              mutTimer = null
              scheduleChromeFit()
            }, 80)
          })
        : null
    const observeBars = () => {
      if (!mutObs) return
      for (const sel of ['.efs-top-bar', '.efs-bottom-bar']) {
        const el = document.querySelector(sel)
        if (el) mutObs.observe(el, { childList: true, subtree: true, characterData: true })
      }
    }
    observeBars()
    // Bars may mount a tick later
    requestAnimationFrame(observeBars)

    removeListeners = () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      mutObs?.disconnect()
      if (mutTimer) clearTimeout(mutTimer)
      if (chromeFitRaf) cancelAnimationFrame(chromeFitRaf)
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
