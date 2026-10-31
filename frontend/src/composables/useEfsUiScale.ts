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
  const strip = el.querySelector('.top-airport-strip') as HTMLElement | null
  const prevStripFlex = strip?.style.flex
  const prevStripOverflow = strip?.style.overflow
  const prevStripMin = strip?.style.minWidth
  el.style.width = 'max-content'
  el.style.maxWidth = 'none'
  el.style.overflow = 'visible'
  // 1fr columns collapse under max-content; force content-sized tracks
  if (isBottom) {
    el.style.gridTemplateColumns = 'max-content max-content max-content'
  }
  // Airport strip scrolls in real layout — measure chrome without its full width
  // dominating the fit ratio (otherwise 30+ ICAOs crush the menubar).
  if (strip) {
    strip.style.flex = '0 0 auto'
    strip.style.overflow = 'visible'
    strip.style.minWidth = '0'
    // Cap credited strip width so fit stays about essential controls
    const cap = Math.max(160, Math.floor((document.documentElement.clientWidth || 1280) * 0.35))
    void el.offsetWidth
    const full = el.scrollWidth
    const stripW = strip.scrollWidth
    const other = Math.max(0, full - stripW)
    el.style.width = prevWidth
    el.style.maxWidth = prevMax
    el.style.overflow = prevOverflow
    el.style.gridTemplateColumns = prevGrid
    strip.style.flex = prevStripFlex ?? ''
    strip.style.overflow = prevStripOverflow ?? ''
    strip.style.minWidth = prevStripMin ?? ''
    return other + Math.min(stripW, cap)
  }
  void el.offsetWidth
  const need = el.scrollWidth
  el.style.width = prevWidth
  el.style.maxWidth = prevMax
  el.style.overflow = prevOverflow
  el.style.gridTemplateColumns = prevGrid
  return need
}

/** Floor so overflow never collapses the menubar to “tiny until UI-scale poke”. */
const CHROME_FIT_MIN = 0.72

/**
 * If top/bottom bar content overflows the window width, compress --efs-chrome-scale
 * (fonts, padding, icon sizes via chrome) until it fits.
 * Airport strip may scroll (see .top-airport-strip); do not let one huge strip
 * squash chrome below CHROME_FIT_MIN.
 */
function fitChromeToWidth(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const bars = [
    document.querySelector('.efs-top-bar') as HTMLElement | null,
    document.querySelector('.efs-bottom-bar') as HTMLElement | null,
  ].filter((el): el is HTMLElement => !!el)
  if (bars.length === 0) return

  // Viewport not ready yet (first paint / move) — keep base scale, retry next frame
  const vw = document.documentElement.clientWidth || window.innerWidth
  if (vw < 80) {
    scheduleChromeFit()
    return
  }

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
      if (avail < 80) continue
      const need = measureBarNeed(el)
      if (avail > 0 && need > avail + 1) {
        worst = Math.min(worst, avail / need)
      }
    }
    if (worst >= 0.999) break
    fit = Math.min(1, Math.max(CHROME_FIT_MIN, fit * worst * 0.98))
    if (fit <= CHROME_FIT_MIN + 0.001) break
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
    // First paint: set base scale only; deferred fits avoid measuring before layout
    // (first open / window move used to leave a tiny menubar until UI-scale poke).
    applyEfsScale()

    const onResize = () => applyEfsScale()
    const onVis = () => {
      if (document.visibilityState === 'visible') applyEfsScale()
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    window.addEventListener('pageshow', onResize)
    document.addEventListener('visibilitychange', onVis)

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
    // Bars may mount a tick later; settle fits after fonts/layout
    requestAnimationFrame(observeBars)
    const settleTimers = [100, 350, 800].map((ms) =>
      setTimeout(() => {
        observeBars()
        applyEfsScale()
      }, ms),
    )

    removeListeners = () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      window.removeEventListener('pageshow', onResize)
      document.removeEventListener('visibilitychange', onVis)
      mutObs?.disconnect()
      if (mutTimer) clearTimeout(mutTimer)
      for (const t of settleTimers) clearTimeout(t)
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
