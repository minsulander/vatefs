/** Only one strip right-click menu open at a time (across all FlightStrip instances). */

type CloseFn = () => void

let activeClose: CloseFn | null = null

/** Close any other open strip context menu, then register this closer as active. */
export function claimStripContextMenu(close: CloseFn) {
  if (activeClose && activeClose !== close) {
    activeClose()
  }
  activeClose = close
}

/** Clear active registration when this menu closes. */
export function releaseStripContextMenu(close: CloseFn) {
  if (activeClose === close) activeClose = null
}
