import { nextTick } from 'vue'

/**
 * Focus (+ select) a popup/dialog text input after v-menu / v-dialog mounts.
 * Retries briefly — nextTick alone often races Vuetify teleport.
 */
export function focusPopupInput(
  getEl: () => HTMLInputElement | null | undefined,
  opts?: { select?: boolean; attempts?: number },
): void {
  const select = opts?.select !== false
  const maxAttempts = opts?.attempts ?? 16

  const tryFocus = (attempt: number) => {
    const el = getEl()
    if (el) {
      try {
        el.focus({ preventScroll: true })
        if (select) el.select()
      } catch {
        // ignore
      }
      if (document.activeElement === el) return
    }
    if (attempt >= maxAttempts) return
    // Mix rAF + short timeouts so both menu and dialog transitions are covered
    if (attempt % 3 === 2) {
      window.setTimeout(() => tryFocus(attempt + 1), 40)
    } else {
      requestAnimationFrame(() => tryFocus(attempt + 1))
    }
  }

  nextTick(() => tryFocus(0))
}
