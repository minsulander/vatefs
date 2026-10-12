import { useEfsStore } from '@/store/efs'

export type RtcAirportListOption = {
  icao: string
  arr: number
  dep: number
  total: number
  /** In an RTC column or has active ES flag — not dimmed */
  isActive: boolean
  /** Assigned to a visible RTC column */
  inColumn: boolean
  /** EuroScope rwyselect / active ES flag */
  hasEsFlag: boolean
  /** Column accent when inColumn; else null */
  accent: string | null
  /** Sort tier 0–3 (see buildRtcAirportList) */
  priority: number
}

/**
 * RTC airport list membership + sort (column picker & strip-creation dialog):
 * 1. Selected in an RTC column
 * 2. Active ES flag with traffic
 * 3. Active ES flag without traffic
 * 4. No ES flag (traffic shown; dimmed)
 */
export function buildRtcAirportList(opts?: {
  /** When set, mark airports taken in another column (picker swap hint) */
  excludeColumnIndex?: number
}): Array<RtcAirportListOption & { taken: boolean }> {
  const store = useEfsStore()
  const es = new Set(store.esAirports)
  const columns = store.columnAirports
  const inColumnSet = new Set(columns.filter((a): a is string => !!a))

  const membership = new Set<string>([
    ...store.airportOptions.map((a) => a.icao),
    ...store.activeAirports,
    ...inColumnSet,
    ...es,
  ])

  return [...membership]
    .map((icao) => {
      const inColumn = inColumnSet.has(icao)
      const hasEsFlag = es.has(icao)
      const counts = store.airportTrafficCounts(icao)
      const { arr, dep } = counts
      const total = arr + dep
      // Dim only when neither in a column nor ES-flagged
      const isActive = inColumn || hasEsFlag
      let priority: number
      if (inColumn) priority = 0
      else if (hasEsFlag && total > 0) priority = 1
      else if (hasEsFlag) priority = 2
      else priority = 3

      const colIdx = columns.findIndex((a) => a === icao)
      const accent = colIdx >= 0 ? store.columnColor(colIdx) : null

      const taken =
        opts?.excludeColumnIndex !== undefined &&
        columns.some((a, i) => a === icao && i !== opts.excludeColumnIndex)

      return {
        icao,
        arr,
        dep,
        total,
        isActive,
        inColumn,
        hasEsFlag,
        accent,
        priority,
        taken,
      }
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      // Among column airports: keep left-to-right column order
      if (a.priority === 0) {
        const ai = columns.findIndex((x) => x === a.icao)
        const bi = columns.findIndex((x) => x === b.icao)
        if (ai !== bi) return ai - bi
      }
      if (b.total !== a.total) return b.total - a.total
      if (b.dep !== a.dep) return b.dep - a.dep
      if (b.arr !== a.arr) return b.arr - a.arr
      return a.icao.localeCompare(b.icao)
    })
}
