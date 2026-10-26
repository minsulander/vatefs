import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import { useEfsStore } from '@/store/efs'
import {
  segmentsForDtransVariant,
  type DtransTargetId,
  type DtransTargetResolve,
  type DtransVariantId,
} from '@/workspace/dtrans'
import { rememberDtransTargets } from '@/workspace/dtransDrop'

const FREQ_POLL_MS = 30_000

/**
 * Live AFV XC / covering callsign for a D-trans variant's segments.
 */
export function useDtransTargets(variant: Ref<DtransVariantId | undefined>) {
  const store = useEfsStore()
  const targets = ref<Map<DtransTargetId, DtransTargetResolve>>(new Map())
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const segmentIds = computed(() =>
    variant.value ? segmentsForDtransVariant(variant.value) : [],
  )

  async function refresh() {
    const ids = segmentIds.value
    if (!ids.length) {
      targets.value = new Map()
      return
    }
    try {
      const res = await fetch(`/api/essa-dtrans-target?ids=${encodeURIComponent(ids.join(','))}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as {
        targets?: DtransTargetResolve[]
      } & Partial<DtransTargetResolve>
      const next = new Map<DtransTargetId, DtransTargetResolve>()
      const list = Array.isArray(data.targets)
        ? data.targets
        : data.id
          ? [data as DtransTargetResolve]
          : []
      for (const t of list) {
        if (t?.id) next.set(t.id, t)
      }
      targets.value = next
      rememberDtransTargets(next.values())
    } catch {
      /* keep previous */
    }
  }

  function startPoll() {
    stopPoll()
    pollTimer = setInterval(() => {
      void refresh()
    }, FREQ_POLL_MS)
  }

  function stopPoll() {
    if (pollTimer != null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  watch(
    () =>
      [
        variant.value,
        store.controllers.length,
        store.showAppDepXcFrequency,
        store.controllers.map((c) => `${c.callsign}:${c.frequency}`).join('|'),
      ] as const,
    ([v]) => {
      if (v) {
        void refresh()
        startPoll()
      } else {
        stopPoll()
        targets.value = new Map()
      }
    },
    { immediate: true },
  )

  onUnmounted(() => stopPoll())

  function targetFor(id: DtransTargetId): DtransTargetResolve | undefined {
    return targets.value.get(id)
  }

  return { segmentIds, targets, refresh, targetFor }
}
