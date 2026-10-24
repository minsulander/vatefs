/**
 * Session-local runway section divider timers.
 * Left-half: count up from 00:00. Right-half MM:SS entry: count down.
 * Survives EfsSection remounts; keyed by workspace instance or bay:section.
 */

import { ref } from 'vue'

export type RunwayTimerMode = 'up' | 'down'

export type RunwayTimerState = {
  running: boolean
  mode: RunwayTimerMode
  /**
   * Up: elapsed at startedAt.
   * Down: remaining at startedAt.
   * Stopped: frozen display value.
   */
  baseMs: number
  /** performance.now() when running started */
  startedAt: number | null
}

const timers = new Map<string, RunwayTimerState>()
/** performance.now() until which the header flashes orange after countdown end */
const flashUntilByKey = new Map<string, number>()

const FLASH_MS = 3000

/** Bumps so Vue computed labels refresh while any timer/flash runs */
export const runwayTimerTick = ref(0)

let tickInterval: ReturnType<typeof setInterval> | null = null
let audioCtx: AudioContext | null = null

/** Resume/create AudioContext on user gesture so the done-alarm can play later. */
export function unlockRunwayTimerAudio(): void {
  try {
    if (!audioCtx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      audioCtx = new AC()
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  } catch {
    // ignore
  }
}

function playAlarmTone(
  ctx: AudioContext,
  dest: AudioNode,
  startAt: number,
  freq: number,
  dur: number,
  peak: number,
  type: OscillatorType,
) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02)
  gain.gain.setValueAtTime(peak, startAt + Math.max(0.04, dur * 0.55))
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur)
  osc.connect(gain)
  gain.connect(dest)
  osc.start(startAt)
  osc.stop(startAt + dur + 0.04)
}

/** Soft chime when countdown hits 00:00 (descending triangle pair ×2). */
export function playRunwayCountdownBeep(): void {
  unlockRunwayTimerAudio()
  const ctx = audioCtx
  if (!ctx) return
  try {
    const now = ctx.currentTime
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.32, now)
    master.connect(ctx.destination)
    for (let i = 0; i < 2; i++) {
      const t0 = now + i * 0.42
      playAlarmTone(ctx, master, t0, 784, 0.22, 0.28, 'triangle') // G5
      playAlarmTone(ctx, master, t0 + 0.18, 587, 0.28, 0.26, 'triangle') // D5
    }
  } catch {
    // ignore
  }
}

function startFlash(key: string) {
  flashUntilByKey.set(key, performance.now() + FLASH_MS)
}

export function isRunwayTimerFlashing(key: string): boolean {
  void runwayTimerTick.value
  const until = flashUntilByKey.get(key)
  if (until == null) return false
  if (performance.now() >= until) {
    flashUntilByKey.delete(key)
    return false
  }
  return true
}

function anyActiveWork(): boolean {
  for (const t of timers.values()) {
    if (t.running) return true
  }
  const now = performance.now()
  for (const [k, until] of flashUntilByKey) {
    if (now < until) return true
    flashUntilByKey.delete(k)
  }
  return false
}

function syncFinishedCountdowns() {
  for (const [key, t] of timers) {
    if (!t.running || t.mode !== 'down' || t.startedAt == null) continue
    const remaining = t.baseMs - (performance.now() - t.startedAt)
    if (remaining <= 0) {
      t.running = false
      t.baseMs = 0
      t.startedAt = null
      startFlash(key)
      playRunwayCountdownBeep()
    }
  }
}

function ensureTick() {
  if (anyActiveWork() && tickInterval == null) {
    tickInterval = setInterval(() => {
      syncFinishedCountdowns()
      runwayTimerTick.value++
      if (!anyActiveWork() && tickInterval != null) {
        clearInterval(tickInterval)
        tickInterval = null
      }
    }, 100)
  } else if (!anyActiveWork() && tickInterval != null) {
    clearInterval(tickInterval)
    tickInterval = null
  }
}

export function runwayTimerKey(
  bayId: string,
  sectionId: string,
  workspaceInstanceId?: string | null,
): string {
  if (workspaceInstanceId) return `ws:${workspaceInstanceId}`
  return `${bayId}:${sectionId}`
}

function getOrCreate(key: string): RunwayTimerState {
  let t = timers.get(key)
  if (!t) {
    t = { running: false, mode: 'up', baseMs: 0, startedAt: null }
    timers.set(key, t)
  }
  return t
}

/** Display value in ms (elapsed for up, remaining for down). */
export function getRunwayTimerDisplayMs(key: string): number {
  const t = timers.get(key)
  if (!t) return 0
  if (!t.running || t.startedAt == null) return Math.max(0, t.baseMs)
  const delta = performance.now() - t.startedAt
  if (t.mode === 'down') return Math.max(0, t.baseMs - delta)
  return Math.max(0, t.baseMs + delta)
}

/** @deprecated use getRunwayTimerDisplayMs */
export function getRunwayTimerElapsedMs(key: string): number {
  return getRunwayTimerDisplayMs(key)
}

export function isRunwayTimerRunning(key: string): boolean {
  return timers.get(key)?.running === true
}

export function getRunwayTimerMode(key: string): RunwayTimerMode {
  return timers.get(key)?.mode ?? 'up'
}

/** Format ms as MM:SS (caps at 99:59 for the header). */
export function formatRunwayTimerMmSs(ms: number): string {
  const totalSec = Math.min(99 * 60 + 59, Math.floor(Math.max(0, ms) / 1000))
  const mm = Math.floor(totalSec / 60)
  const ss = totalSec % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/**
 * Parse countdown duration → milliseconds.
 * - 1–2 digits → whole minutes (`2` → 2:00, `25` → 25:00)
 * - Decimal minutes: `2.5` / `2,5` → 2 min 30 sec
 * - `MM:SS` (e.g. `2:30`, `00:20` → 20 sec)
 * - Seconds without colon need two leading zeros: `0020` → 20 sec
 * - 3 digits → M:SS (`230` → 2:30); 4 digits MMSS (`1230` → 12:30)
 */
export function parseRunwayTimerMmSs(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, '')
  if (!s) return null

  const toMs = (totalSec: number): number | null => {
    if (!Number.isFinite(totalSec) || totalSec < 0) return null
    const sec = Math.round(totalSec)
    if (sec > 99 * 60 + 59) return null
    return sec * 1000
  }

  // Decimal minutes: 2.5 / 2,5
  if (/^\d+[.,]\d+$/.test(s)) {
    const mins = Number(s.replace(',', '.'))
    if (!Number.isFinite(mins) || mins < 0 || mins > 99.999) return null
    return toMs(mins * 60)
  }

  if (s.includes(':')) {
    const parts = s.split(':')
    if (parts.length !== 2) return null
    if (!/^\d{1,2}$/.test(parts[0]!) || !/^\d{1,2}$/.test(parts[1]!)) return null
    const mm = Number(parts[0])
    const ss = Number(parts[1])
    if (!Number.isFinite(mm) || !Number.isFinite(ss) || mm > 99 || ss > 59) return null
    return toMs(mm * 60 + ss)
  }

  if (!/^\d+$/.test(s)) return null

  // 1–2 digits → whole minutes
  if (s.length <= 2) {
    const mm = Number(s)
    if (mm > 99) return null
    return toMs(mm * 60)
  }

  // 00SS → seconds only
  if (s.length === 4 && s.startsWith('00')) {
    const ss = Number(s.slice(2))
    if (ss > 59) return null
    return toMs(ss)
  }

  // 3 digits → M:SS
  if (s.length === 3) {
    const mm = Number(s[0])
    const ss = Number(s.slice(1))
    if (ss > 59) return null
    return toMs(mm * 60 + ss)
  }

  // 4 digits → MMSS
  if (s.length === 4) {
    const mm = Number(s.slice(0, 2))
    const ss = Number(s.slice(2))
    if (mm > 99 || ss > 59) return null
    return toMs(mm * 60 + ss)
  }

  return null
}

const MAX_MS = 99 * 60 * 1000 + 59 * 1000

/** Stop and clear to 00:00 (also clears end flash). */
export function runwayTimerReset(key: string): void {
  const t = getOrCreate(key)
  t.running = false
  t.baseMs = 0
  t.startedAt = null
  t.mode = 'up'
  flashUntilByKey.delete(key)
  runwayTimerTick.value++
  ensureTick()
}

/** Left-half: start count-up from 00:00, or reset if already running. */
export function runwayTimerLeftClick(key: string): void {
  const t = getOrCreate(key)
  if (t.running) {
    runwayTimerReset(key)
    return
  }
  unlockRunwayTimerAudio()
  t.mode = 'up'
  t.baseMs = 0
  t.startedAt = performance.now()
  t.running = true
  runwayTimerTick.value++
  ensureTick()
}

/** Right-half MM:SS entry: count down from the entered duration. */
export function runwayTimerStartCountdown(key: string, ms: number): void {
  unlockRunwayTimerAudio()
  const t = getOrCreate(key)
  const clamped = Math.max(0, Math.min(MAX_MS, Math.floor(ms)))
  t.mode = 'down'
  t.baseMs = clamped
  t.startedAt = performance.now()
  t.running = clamped > 0
  if (clamped <= 0) {
    t.startedAt = null
    startFlash(key)
    playRunwayCountdownBeep()
  }
  runwayTimerTick.value++
  ensureTick()
}

/** @deprecated use runwayTimerStartCountdown */
export function runwayTimerStartFromMs(key: string, ms: number): void {
  runwayTimerStartCountdown(key, ms)
}

export function runwayTimerStop(key: string): void {
  const t = timers.get(key)
  if (!t || !t.running) return
  t.baseMs = getRunwayTimerDisplayMs(key)
  t.running = false
  t.startedAt = null
  runwayTimerTick.value++
  ensureTick()
}
