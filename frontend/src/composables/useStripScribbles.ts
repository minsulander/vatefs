import { computed, reactive, type Ref, unref } from 'vue'

/** Normalized scribble space — full strip including expander bands. */
export const SCRIBBLE_VIEWBOX_FULL = '0 0 1000 1000'
export const SCRIBBLE_VB = 1000

/** Canonical Y bands (seamless across open expanders). */
export const SCRIBBLE_TOP_Y0 = 0
export const SCRIBBLE_TOP_Y1 = 200
export const SCRIBBLE_BODY_Y0 = 200
export const SCRIBBLE_BODY_Y1 = 800
export const SCRIBBLE_BOT_Y0 = 800
export const SCRIBBLE_BOT_Y1 = 1000

/** Same design width as FlightStrip --strip-scale (400px → scale 1). */
export const SCRIBBLE_STRIP_REF_WIDTH_PX = 400
/** Screen-px stroke at strip-scale 1; scales with bay/zoom strip width. */
export const SCRIBBLE_STROKE_AT_REF_PX = 1.5

export type ScribbleBand = 'top' | 'body' | 'bottom'

export interface ScribbleBandScreen {
  band: ScribbleBand
  left: number
  top: number
  width: number
  height: number
}

/** CSS-pixel stroke width for non-scaling-stroke, matched to strip scale. */
export function scribbleStrokeWidthCss(stripScaleOrWidthPx: number, isWidth = false): number {
  const scale = isWidth
    ? stripScaleOrWidthPx / SCRIBBLE_STRIP_REF_WIDTH_PX
    : stripScaleOrWidthPx
  return Math.max(0.75, SCRIBBLE_STROKE_AT_REF_PX * scale)
}

/** viewBox for currently visible bands (full-strip SVG). Prefer per-band viewBoxes for display. */
export function scribbleViewBox(topOpen: boolean, bottomOpen: boolean): string {
  const y0 = topOpen ? SCRIBBLE_TOP_Y0 : SCRIBBLE_BODY_Y0
  const y1 = bottomOpen ? SCRIBBLE_BOT_Y1 : SCRIBBLE_BODY_Y1
  return `0 ${y0} ${SCRIBBLE_VB} ${y1 - y0}`
}

function bandCanonicalY(band: ScribbleBand): { y0: number; y1: number } {
  if (band === 'top') return { y0: SCRIBBLE_TOP_Y0, y1: SCRIBBLE_TOP_Y1 }
  if (band === 'bottom') return { y0: SCRIBBLE_BOT_Y0, y1: SCRIBBLE_BOT_Y1 }
  return { y0: SCRIBBLE_BODY_Y0, y1: SCRIBBLE_BODY_Y1 }
}

/** Per-band viewBox so ink aligns with each expander/body regardless of height ratios. */
export function scribbleBandViewBox(band: ScribbleBand): string {
  const { y0, y1 } = bandCanonicalY(band)
  return `0 ${y0} ${SCRIBBLE_VB} ${y1 - y0}`
}

/** Map a client point through visible band rects into canonical scribble space. */
export function clientToScribble(
  clientX: number,
  clientY: number,
  bands: ScribbleBandScreen[],
): { x: number; y: number } | null {
  if (bands.length === 0) return null
  // Prefer the band containing the point; else nearest band (for edge drags)
  let hit = bands.find(
    (b) =>
      clientX >= b.left &&
      clientX <= b.left + b.width &&
      clientY >= b.top &&
      clientY <= b.top + b.height,
  )
  if (!hit) {
    let best = Infinity
    for (const b of bands) {
      const cx = Math.min(Math.max(clientX, b.left), b.left + b.width)
      const cy = Math.min(Math.max(clientY, b.top), b.top + b.height)
      const d = (clientX - cx) ** 2 + (clientY - cy) ** 2
      if (d < best) {
        best = d
        hit = b
      }
    }
  }
  if (!hit || hit.width <= 0 || hit.height <= 0) return null
  const { y0, y1 } = bandCanonicalY(hit.band)
  const x = ((clientX - hit.left) / hit.width) * SCRIBBLE_VB
  const y = y0 + ((clientY - hit.top) / hit.height) * (y1 - y0)
  return {
    x: Math.min(SCRIBBLE_VB, Math.max(0, x)),
    y: Math.min(SCRIBBLE_VB, Math.max(0, y)),
  }
}

/** Measure top / body / bottom band screen rects under a strip root. */
export function measureScribbleBands(root: HTMLElement): ScribbleBandScreen[] {
  const bands: ScribbleBandScreen[] = []
  const add = (sel: string, band: ScribbleBand) => {
    const el = root.querySelector(sel)
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    bands.push({
      band,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
    })
  }
  add('.strip-expander-top', 'top')
  add('.strip-grid', 'body')
  // Note strips have no .strip-grid — scribble fills the note body
  if (!bands.some((b) => b.band === 'body')) {
    add('.note-content', 'body')
  }
  add('.strip-expander-bottom', 'bottom')
  return bands
}

const strokesById = reactive<Record<string, string[]>>({})

function coercePoints(raw: unknown): string | null {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object' && 'points' in raw && typeof (raw as { points: unknown }).points === 'string') {
    // Migrate old per-zone strokes into unified space (treat as body-band ink)
    return (raw as { points: string }).points
  }
  return null
}

export function getStripScribbles(stripId: string): string[] {
  const raw = strokesById[stripId] ?? []
  return raw.map(coercePoints).filter((p): p is string => !!p)
}

export function setStripScribbles(stripId: string, strokes: string[]) {
  if (strokes.length === 0) delete strokesById[stripId]
  else strokesById[stripId] = [...strokes]
}

export function pushStripScribble(stripId: string, points: string) {
  const prev = getStripScribbles(stripId)
  strokesById[stripId] = [...prev, points]
}

export function undoStripScribble(stripId: string) {
  const prev = getStripScribbles(stripId)
  if (!prev.length) return
  if (prev.length === 1) delete strokesById[stripId]
  else strokesById[stripId] = prev.slice(0, -1)
}

export function clearStripScribbles(stripId: string) {
  delete strokesById[stripId]
}

/** Reactive strokes for a strip (bay + zoom share this). */
export function useStripScribbles(stripId: Ref<string> | string) {
  const strokes = computed(() => getStripScribbles(unref(stripId)))
  const hasScribbles = computed(() => strokes.value.length > 0)
  return { strokes, hasScribbles }
}
