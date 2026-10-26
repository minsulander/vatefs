/**
 * Shared D-trans drop → park + manualTransfer.
 * Flight strips use pointer/touch drag (not HTML5), so the section's
 * @drop handlers never run — callers must invoke this from the strip drop path.
 */

import { useEfsStore } from '@/store/efs'
import {
  dtransZoneIndexFromX,
  isDtransVariantId,
  segmentsForDtransVariant,
  type DtransTargetId,
  type DtransTargetResolve,
} from './dtrans'

/** Latest resolves from mounted D-trans headers (useDtransTargets). */
const targetCache = new Map<DtransTargetId, DtransTargetResolve>()

export function rememberDtransTargets(list: Iterable<DtransTargetResolve>) {
  for (const t of list) {
    if (t?.id) targetCache.set(t.id, t)
  }
}

export function cachedDtransTarget(id: DtransTargetId): DtransTargetResolve | undefined {
  return targetCache.get(id)
}

async function fetchDtransTarget(id: DtransTargetId): Promise<DtransTargetResolve | undefined> {
  try {
    const res = await fetch(`/api/essa-dtrans-target?id=${encodeURIComponent(id)}`)
    if (!res.ok) return undefined
    const data = (await res.json()) as DtransTargetResolve
    if (data?.id) {
      targetCache.set(data.id, data)
      return data
    }
  } catch {
    /* ignore */
  }
  return undefined
}

export function dtransTargetIdAtPoint(
  sectionEl: Element,
  clientX: number,
): DtransTargetId | null {
  const raw = sectionEl.getAttribute('data-dtrans')
  if (!isDtransVariantId(raw)) return null
  const ids = segmentsForDtransVariant(raw)
  if (!ids.length) return null
  const rect = sectionEl.getBoundingClientRect()
  const idx = dtransZoneIndexFromX(clientX, rect.left, rect.width, ids.length)
  return ids[idx] ?? null
}

function runTransfer(
  stripId: string,
  bayId: string,
  sectionId: string,
  target: DtransTargetResolve,
) {
  if (!target.online || !target.callsign) return
  const store = useEfsStore()
  store.moveStripToSection(stripId, bayId, sectionId, 0)
  store.manualTransfer(stripId, target.callsign)
}

/**
 * If `sectionEl` is a D-trans divider, park + transfer (or no-op when offline).
 * Returns true when the drop was handled as D-trans (caller must not normal-move).
 */
export function tryApplyDtransStripDrop(opts: {
  stripId: string
  bayId: string
  sectionId: string
  sectionEl: Element
  clientX: number
}): boolean {
  const targetId = dtransTargetIdAtPoint(opts.sectionEl, opts.clientX)
  if (!targetId) return false

  const cached = cachedDtransTarget(targetId)
  if (cached) {
    runTransfer(opts.stripId, opts.bayId, opts.sectionId, cached)
    return true
  }

  void fetchDtransTarget(targetId).then((t) => {
    if (t) runTransfer(opts.stripId, opts.bayId, opts.sectionId, t)
  })
  return true
}
