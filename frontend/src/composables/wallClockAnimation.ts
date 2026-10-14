/**
 * Background-safe animation helpers.
 *
 * Browsers pause requestAnimationFrame and WAAPI while the tab is hidden.
 * These helpers advance on wall clock (setTimeout / setInterval) so fly/print/FLIP
 * still complete and strips are never left opacity-0 forever.
 */

/** Double-rAF when painting; wall-clock fallback so hidden tabs still proceed. */
export function afterLayoutSettle(cb: () => void, fallbackMs = 32): () => void {
  let done = false
  const run = () => {
    if (done) return
    done = true
    clearTimeout(fallbackTimer)
    cb()
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(run)
  })
  const fallbackTimer = window.setTimeout(run, fallbackMs)

  return () => {
    done = true
    clearTimeout(fallbackTimer)
  }
}

export type WallClockAnimHandle = {
  /** Stop driving without invoking onFinish. */
  cancel: () => void
}

/**
 * Drive a WAAPI Animation on wall clock so it progresses (and finishes) in
 * background tabs. Pauses the native timeline and sets currentTime from
 * performance.now(); hard-finishes at duration even if timers are throttled.
 */
export function driveAnimationWallClock(
  anim: Animation,
  durationMs: number,
  onFinish: () => void,
): WallClockAnimHandle {
  const start = performance.now()
  let finished = false
  const duration = Math.max(0, durationMs)

  const cleanupTimers = () => {
    clearInterval(tickTimer)
    clearTimeout(deadlineTimer)
    document.removeEventListener('visibilitychange', onVisibility)
  }

  const finish = () => {
    if (finished) return
    finished = true
    cleanupTimers()
    try {
      anim.onfinish = null
    } catch {
      /* ignore */
    }
    try {
      // Snap to end. For fill:forwards/both, commit computed values to inline styles
      // before cancel (otherwise cancel reverts — e.g. print translateX(0)).
      // Skip commit for fill:none (FLIP) so we don't leave a sticky transform.
      anim.currentTime = duration
      const fill = anim.effect?.getTiming().fill
      if (fill === 'forwards' || fill === 'both') {
        anim.commitStyles?.()
      }
      anim.cancel()
    } catch {
      /* ignore */
    }
    onFinish()
  }

  const sync = () => {
    if (finished) return
    const elapsed = performance.now() - start
    try {
      if (anim.playState === 'running') anim.pause()
      anim.currentTime = Math.min(elapsed, duration)
    } catch {
      /* ignore */
    }
    if (elapsed >= duration) finish()
  }

  try {
    anim.pause()
    anim.currentTime = 0
  } catch {
    /* ignore */
  }

  // Native finish may still fire if the tab stays focused the whole time
  anim.onfinish = () => finish()

  // ~60fps while focused; throttled (~1s) in background but still advances
  const tickTimer = window.setInterval(sync, 16)
  // Hard deadline — setTimeout is also throttled in bg, but fires once duration elapsed
  const deadlineTimer = window.setTimeout(sync, duration + 48)

  const onVisibility = () => {
    // Re-sync elapsed when returning to foreground (avoids a jump from frozen WAAPI)
    sync()
  }
  document.addEventListener('visibilitychange', onVisibility)

  // Kick once immediately
  sync()

  return {
    cancel: () => {
      if (finished) return
      finished = true
      cleanupTimers()
      try {
        anim.onfinish = null
        anim.cancel()
      } catch {
        /* ignore */
      }
    },
  }
}
