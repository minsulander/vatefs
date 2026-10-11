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

/** Zoom pen ink — paper: blue/red kulspetspenna; SAAB: always black. */
export type ScribbleInk = 'blue' | 'red' | 'black'

export const SCRIBBLE_INK_HEX: Record<ScribbleInk, string> = {
  blue: '#1565c0',
  red: '#c62828',
  black: '#1a1a1a',
}

/**
 * Paper hotspot tags:
 * - clr-read / clr-correct — clearance checkboxes (flags on zoom close)
 * - cto — cleared-for-takeoff / CFTO (CTO action on zoom close)
 * - ctl — cleared-to-land (CTL action on zoom close)
 * - goa — go-around arrow in ARR col 3 bottom (softGA on zoom close)
 * - atd — ink in ATD sub-cell (hide auto ATD when >1 stroke)
 * - xfer-refuse — diagonal / in leftmost col (refuse inbound transfer on zoom close)
 * - xfer-app — diagonal / in leftmost col (UTFLYGNING / G/A → APP transfer on zoom close)
 */
export type PaperScribbleTag =
  | 'clr-read'
  | 'clr-correct'
  | 'cto'
  | 'ctl'
  | 'goa'
  | 'atd'
  | 'xfer-refuse'
  | 'xfer-app'
/** @deprecated alias — prefer PaperScribbleTag */
export type ClrScribbleTag = Extract<PaperScribbleTag, 'clr-read' | 'clr-correct'>

export interface ScribbleStroke {
  points: string
  color: ScribbleInk
  /** When set, stroke lives in a paper hotspot (CLR / CTO / ATD). */
  tag?: PaperScribbleTag
}

export interface ScribbleRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

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
  // Paper FPS strips use .paper-grid / .paper-flight (no SAAB .strip-grid)
  if (!bands.some((b) => b.band === 'body')) {
    add('.paper-grid', 'body')
    add('.paper-flight', 'body')
  }
  // Note / vehicle strips have no .strip-grid — scribble fills the body area
  if (!bands.some((b) => b.band === 'body')) {
    add('.note-content', 'body')
    add('.vehicle-body', 'body')
    add('.paper-info-body', 'body')
  }
  add('.strip-expander-bottom', 'bottom')
  return bands
}

const strokesById = reactive<Record<string, Array<string | ScribbleStroke>>>({})

function coerceTag(raw: unknown): PaperScribbleTag | undefined {
  return raw === 'clr-read' ||
    raw === 'clr-correct' ||
    raw === 'cto' ||
    raw === 'ctl' ||
    raw === 'goa' ||
    raw === 'atd' ||
    raw === 'xfer-refuse' ||
    raw === 'xfer-app'
    ? raw
    : undefined
}

function coerceStroke(raw: unknown): ScribbleStroke | null {
  if (typeof raw === 'string') return { points: raw, color: 'blue' }
  if (raw && typeof raw === 'object' && 'points' in raw) {
    const points = (raw as { points: unknown }).points
    if (typeof points !== 'string' || !points) return null
    const c = (raw as { color?: unknown }).color
    const color: ScribbleInk =
      c === 'red' ? 'red' : c === 'black' ? 'black' : 'blue'
    const tag = coerceTag((raw as { tag?: unknown }).tag)
    return tag ? { points, color, tag } : { points, color }
  }
  return null
}

function serializeStroke(s: ScribbleStroke): ScribbleStroke {
  return s.tag
    ? { points: s.points, color: s.color, tag: s.tag }
    : { points: s.points, color: s.color }
}

/** Parse "x,y x,y …" into point list. */
export function parseStrokePoints(points: string): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = []
  for (const token of points.trim().split(/\s+/)) {
    const [xs, ys] = token.split(',')
    const x = Number(xs)
    const y = Number(ys)
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y })
  }
  return out
}

export function strokeCentroid(points: string): { x: number; y: number } | null {
  const pts = parseStrokePoints(points)
  if (!pts.length) return null
  let sx = 0
  let sy = 0
  for (const p of pts) {
    sx += p.x
    sy += p.y
  }
  return { x: sx / pts.length, y: sy / pts.length }
}

export function pointInRect(x: number, y: number, r: ScribbleRect): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
}

/** Fraction of stroke points inside rect (0–1). Empty stroke → 0. */
export function fractionOfPointsInRect(points: string, r: ScribbleRect): number {
  const pts = parseStrokePoints(points)
  if (!pts.length) return 0
  let n = 0
  for (const p of pts) {
    if (pointInRect(p.x, p.y, r)) n++
  }
  return n / pts.length
}

/**
 * Loose “checkmark in box” test: mostly inside the rect, or centroid inside
 * with at least some points in the box. Location wins over shape.
 */
export function strokeMatchesClrBox(points: string, r: ScribbleRect, minFraction = 0.5): boolean {
  const frac = fractionOfPointsInRect(points, r)
  if (frac >= minFraction) return true
  const c = strokeCentroid(points)
  if (c && pointInRect(c.x, c.y, r) && frac >= 0.25) return true
  return false
}

/**
 * Rising diagonal (/) in a column: bottom-left ↔ top-right (either draw direction).
 * Used on paper leftmost col to refuse an inbound transfer.
 */
export function strokeMatchesRisingDiagonal(
  points: string,
  r: ScribbleRect,
  minFraction = 0.4,
): boolean {
  const pts = parseStrokePoints(points)
  if (pts.length < 2) return false
  if (fractionOfPointsInRect(points, r) < minFraction) return false
  const start = pts[0]!
  const end = pts[pts.length - 1]!
  const w = r.x1 - r.x0
  const h = r.y1 - r.y0
  if (w <= 0 || h <= 0) return false
  const dx = end.x - start.x
  const dy = end.y - start.y
  // Rising / : dx and dy opposite signs (y grows downward)
  if (dx * dy >= 0) return false
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx < w * 0.18) return false
  if (ady < h * 0.18) return false
  // Not a flat dash or pure vertical
  if (adx < ady * 0.3) return false
  if (ady < adx * 0.22) return false
  return true
}

function strokeBBox(pts: Array<{ x: number; y: number }>): {
  x0: number
  y0: number
  x1: number
  y1: number
} | null {
  if (!pts.length) return null
  let x0 = pts[0]!.x
  let y0 = pts[0]!.y
  let x1 = x0
  let y1 = y0
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x0, y0, x1, y1 }
}

/** CLR check ✓ — valley then up-right (matches generated M4 13.5 L10 19.5 L20.5 5.5). */
function matchesCheckmarkShape(points: string): boolean {
  const pts = parseStrokePoints(points)
  if (pts.length < 4) return false
  let valleyI = 0
  for (let i = 1; i < pts.length; i++) {
    if (pts[i]!.y > pts[valleyI]!.y) valleyI = i
  }
  // Valley near the middle of the stroke, not at the ends
  if (valleyI < pts.length * 0.12 || valleyI > pts.length * 0.88) return false
  const start = pts[0]!
  const end = pts[pts.length - 1]!
  const valley = pts[valleyI]!
  const bb = strokeBBox(pts)!
  const w = bb.x1 - bb.x0
  const h = bb.y1 - bb.y0
  if (w < 12 || h < 12) return false
  // Start left of valley, end right of valley, end above valley
  if (start.x > valley.x - w * 0.05) return false
  if (end.x < valley.x + w * 0.08) return false
  if (end.y > valley.y - h * 0.2) return false
  return true
}

/** CFTO dash — short mostly-horizontal stroke. */
function matchesHorizontalDashShape(points: string): boolean {
  const pts = parseStrokePoints(points)
  if (pts.length < 2) return false
  const bb = strokeBBox(pts)!
  const w = bb.x1 - bb.x0
  const h = bb.y1 - bb.y0
  return w >= 10 && w > h * 1.6
}

/** CTL L — vertical stem then rightward foot. */
function matchesLShape(points: string): boolean {
  const pts = parseStrokePoints(points)
  if (pts.length < 4) return false
  const bb = strokeBBox(pts)!
  const w = bb.x1 - bb.x0
  const h = bb.y1 - bb.y0
  if (h < 14) return false
  const midI = Math.floor(pts.length * 0.55)
  const a = pts[0]!
  const m = pts[midI]!
  const e = pts[pts.length - 1]!
  const stemDy = m.y - a.y
  const footDx = e.x - m.x
  const footDy = Math.abs(e.y - m.y)
  // Stem goes down; foot goes right and is flatter than the stem
  if (stemDy < h * 0.3) return false
  if (footDx < Math.max(8, w * 0.22)) return false
  if (footDy > Math.abs(footDx) * 1.15) return false
  return true
}

/** G/A — shallow U (ends similar height, middle deeper). */
function matchesGoAroundUShape(points: string): boolean {
  const pts = parseStrokePoints(points)
  if (pts.length < 5) return false
  const start = pts[0]!
  const end = pts[pts.length - 1]!
  const bb = strokeBBox(pts)!
  const w = bb.x1 - bb.x0
  const h = bb.y1 - bb.y0
  if (w < 16 || end.x - start.x < w * 0.45) return false
  // Ends at similar height
  if (Math.abs(end.y - start.y) > Math.max(18, h * 0.55)) return false
  // Middle of stroke deeper than the ends (higher y)
  const mid = pts[Math.floor(pts.length / 2)]!
  const endAvgY = (start.y + end.y) / 2
  if (mid.y < endAvgY + Math.max(6, h * 0.18)) return false
  return true
}

/** Rising / without hotspot rect (shape only) — lenient for freehand. */
function matchesRisingDiagonalShape(points: string): boolean {
  const pts = parseStrokePoints(points)
  if (pts.length < 2) return false
  const start = pts[0]!
  const end = pts[pts.length - 1]!
  const dx = end.x - start.x
  const dy = end.y - start.y
  // Rising / : dx and dy opposite signs (either draw direction)
  if (dx * dy >= 0) return false
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  const len = Math.hypot(adx, ady)
  if (len < 24) return false
  if (adx < len * 0.22) return false
  if (ady < len * 0.22) return false
  // Reject near-horizontal / near-vertical
  if (adx < ady * 0.3) return false
  if (ady < adx * 0.22) return false
  return true
}

/**
 * Freehand ink roughly matches the computer-generated mark for this hotspot tag.
 * Location tagging still applies; flag set is gated on this.
 */
export function strokeRoughlyMatchesPaperMark(
  tag: PaperScribbleTag,
  points: string,
): boolean {
  switch (tag) {
    case 'clr-read':
    case 'clr-correct':
      return matchesCheckmarkShape(points)
    case 'cto':
      return matchesHorizontalDashShape(points)
    case 'ctl':
      return matchesLShape(points)
    case 'goa':
      return matchesGoAroundUShape(points)
    case 'xfer-refuse':
    case 'xfer-app':
      return matchesRisingDiagonalShape(points)
    case 'atd':
      return true
    default:
      return false
  }
}

/** True when a tagged stroke for this hotspot also matches the generated shape. */
export function hasShapeMatchedPaperScribble(
  stripId: string,
  tag: PaperScribbleTag,
): boolean {
  return getStripScribbles(stripId).some(
    (s) => s.tag === tag && strokeRoughlyMatchesPaperMark(tag, s.points),
  )
}

export function getStripScribbles(stripId: string): ScribbleStroke[] {
  const raw = strokesById[stripId] ?? []
  return raw.map(coerceStroke).filter((s): s is ScribbleStroke => !!s)
}

export function setStripScribbles(stripId: string, strokes: ScribbleStroke[]) {
  if (strokes.length === 0) delete strokesById[stripId]
  else strokesById[stripId] = strokes.map(serializeStroke)
}

export function pushStripScribble(
  stripId: string,
  points: string,
  color: ScribbleInk = 'blue',
  tag?: PaperScribbleTag,
) {
  const prev = getStripScribbles(stripId)
  const stroke: ScribbleStroke = tag ? { points, color, tag } : { points, color }
  strokesById[stripId] = [...prev, stroke]
}

export function undoStripScribble(stripId: string) {
  const prev = getStripScribbles(stripId)
  if (!prev.length) return
  if (prev.length === 1) delete strokesById[stripId]
  else strokesById[stripId] = prev.slice(0, -1).map(serializeStroke)
}

export function clearStripScribbles(stripId: string) {
  delete strokesById[stripId]
}

export function hasClrScribble(stripId: string, tag: PaperScribbleTag): boolean {
  return getStripScribbles(stripId).some((s) => s.tag === tag)
}

export function getClrScribbleTags(stripId: string): {
  read: boolean
  correct: boolean
  cto: boolean
  ctl: boolean
  goa: boolean
  xferRefuse: boolean
  xferApp: boolean
} {
  let read = false
  let correct = false
  let cto = false
  let ctl = false
  let goa = false
  let xferRefuse = false
  let xferApp = false
  for (const s of getStripScribbles(stripId)) {
    if (s.tag === 'clr-read') read = true
    if (s.tag === 'clr-correct') correct = true
    if (s.tag === 'cto') cto = true
    if (s.tag === 'ctl') ctl = true
    if (s.tag === 'goa') goa = true
    if (s.tag === 'xfer-refuse') xferRefuse = true
    if (s.tag === 'xfer-app') xferApp = true
  }
  return { read, correct, cto, ctl, goa, xferRefuse, xferApp }
}

/**
 * Synthetic rising / in leftmost paper column (e.g. drop to UTFLYGNING pin tray).
 * Body-band coords: bottom-left → top-right across full col 1, with padding from borders.
 * Col 1 ≈ 0–205 in 0–1000 strip X; body Y = 200–800.
 */
export function pushRisingDiagonalLeftCol(
  stripId: string,
  color: ScribbleInk = 'blue',
  tag: PaperScribbleTag = 'xfer-app',
) {
  if (hasClrScribble(stripId, tag)) return
  // Wider across col 1 (~0–205); keep vertical padding from body edges
  pushStripScribble(stripId, '22,772 198,228', color, tag)
}

export function countTaggedScribbles(stripId: string, tag: PaperScribbleTag): number {
  return getStripScribbles(stripId).filter((s) => s.tag === tag).length
}

export function removeClrScribbles(stripId: string, tag: PaperScribbleTag) {
  const next = getStripScribbles(stripId).filter((s) => s.tag !== tag)
  setStripScribbles(stripId, next)
}

/** Reactive strokes for a strip (bay + zoom share this). */
export function useStripScribbles(stripId: Ref<string> | string) {
  const strokes = computed(() => getStripScribbles(unref(stripId)))
  const hasScribbles = computed(() => strokes.value.length > 0)
  const hasClrReadScribble = computed(() =>
    strokes.value.some((s) => s.tag === 'clr-read'),
  )
  const hasClrCorrectScribble = computed(() =>
    strokes.value.some((s) => s.tag === 'clr-correct'),
  )
  const hasCtoScribble = computed(() => strokes.value.some((s) => s.tag === 'cto'))
  const hasCtlScribble = computed(() => strokes.value.some((s) => s.tag === 'ctl'))
  const hasGoaScribble = computed(() => strokes.value.some((s) => s.tag === 'goa'))
  const atdScribbleCount = computed(
    () => strokes.value.filter((s) => s.tag === 'atd').length,
  )
  return {
    strokes,
    hasScribbles,
    hasClrReadScribble,
    hasClrCorrectScribble,
    hasCtoScribble,
    hasCtlScribble,
    hasGoaScribble,
    atdScribbleCount,
  }
}
