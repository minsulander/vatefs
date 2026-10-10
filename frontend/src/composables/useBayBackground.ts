import { computed, ref } from 'vue'

const STORAGE_KEY = 'efs/bayBgBrightness'
/** Darkest bay bg — matches top/bottom bar */
const DARK_RGB = { r: 0x00, g: 0x00, b: 0x00 }
/** Max brt — cold grey, a bit brighter than previous #767882 */
const LIGHT_RGB = { r: 0x84, g: 0x86, b: 0x90 }
const PERCENT_MIN = 0
const PERCENT_MAX = 100
export const BAY_BG_BRIGHTNESS_DEFAULT = 50
const PERCENT_DEFAULT = BAY_BG_BRIGHTNESS_DEFAULT

const brightness = ref(loadPercent())

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

/** Single linear scale: 0 = #000000 … 100 = #848690 */
export function bayBgColorFromBrightness(percent: number): string {
  const t = clampPercent(percent) / 100
  const r = mixChannel(DARK_RGB.r, LIGHT_RGB.r, t)
  const g = mixChannel(DARK_RGB.g, LIGHT_RGB.g, t)
  const b = mixChannel(DARK_RGB.b, LIGHT_RGB.b, t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function applyBayBg(): void {
  if (typeof document === 'undefined') return
  const color = bayBgColorFromBrightness(brightness.value)
  document.documentElement.style.setProperty('--efs-bay-bg', color)
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

/** Call once from App mount so CSS var is ready before first paint of bays. */
export function startBayBackground(): void {
  applyBayBg()
}

export function useBayBgBrightness() {
  return brightness
}

export function useBayBgColor() {
  return computed(() => bayBgColorFromBrightness(brightness.value))
}
