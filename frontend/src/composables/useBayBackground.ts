import { computed, ref } from 'vue'

const STORAGE_KEY = 'efs/bayBgBrightness'
/** Darkest bay bg — matches top/bottom bar */
const DARK_RGB = { r: 0x00, g: 0x00, b: 0x00 }
/** Max brt — ESSA / default: cold grey (original) */
const LIGHT_RGB_DEFAULT = { r: 0x84, g: 0x86, b: 0x90 }
/** Max brt — RTC: warm grey (less blue) */
const LIGHT_RGB_RTC = { r: 0x8c, g: 0x88, b: 0x82 }
const PERCENT_MIN = 0
const PERCENT_MAX = 100
export const BAY_BG_BRIGHTNESS_DEFAULT = 50
const PERCENT_DEFAULT = BAY_BG_BRIGHTNESS_DEFAULT

const brightness = ref(loadPercent())
/** When true, use warm RTC grey scale; otherwise ESSA/default cold grey */
const rtcPalette = ref(false)

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return PERCENT_DEFAULT
  return Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, Math.round(n)))
}

function loadPercent(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null) return PERCENT_DEFAULT
    return clampPercent(Number(raw))
  } catch {
    return PERCENT_DEFAULT
  }
}

function mixChannel(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t)
}

/** Single linear scale: 0 = #000000 … 100 = palette light grey */
export function bayBgColorFromBrightness(percent: number, warmRtc = false): string {
  const light = warmRtc ? LIGHT_RGB_RTC : LIGHT_RGB_DEFAULT
  const t = clampPercent(percent) / 100
  const r = mixChannel(DARK_RGB.r, light.r, t)
  const g = mixChannel(DARK_RGB.g, light.g, t)
  const b = mixChannel(DARK_RGB.b, light.b, t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/**
 * SAAB inter-bay gutter: binary, not a grade.
 * Brighter than default → near strip grey; default/darker → near menu-bar black.
 */
export function bayGutterColorFromBrightness(percent: number): string {
  if (clampPercent(percent) > BAY_BG_BRIGHTNESS_DEFAULT) return '#ebebeb'
  return '#232428'
}

function applyBayBg(): void {
  if (typeof document === 'undefined') return
  const color = bayBgColorFromBrightness(brightness.value, rtcPalette.value)
  document.documentElement.style.setProperty('--efs-bay-bg', color)
  document.documentElement.style.setProperty(
    '--efs-bay-gutter-color',
    bayGutterColorFromBrightness(brightness.value),
  )
}

export function setBayBgBrightness(percent: number): void {
  const next = clampPercent(percent)
  brightness.value = next
  try {
    localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    /* ignore */
  }
  applyBayBg()
}

/** Switch bay bg palette: RTC warm grey vs ESSA/default cold grey. */
export function setBayBgRtcPalette(enabled: boolean): void {
  if (rtcPalette.value === enabled) return
  rtcPalette.value = enabled
  applyBayBg()
}

/** Call once from App mount so CSS var is ready before first paint of bays. */
export function startBayBackground(): void {
  applyBayBg()
}

export function useBayBgBrightness() {
  return brightness
}

export function useBayBgColor() {
  return computed(() => bayBgColorFromBrightness(brightness.value, rtcPalette.value))
}
