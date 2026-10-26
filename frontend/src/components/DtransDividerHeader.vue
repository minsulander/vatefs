<template>
  <div
    class="dtrans-hdr"
    :class="{ 'is-offline': !online }"
    role="group"
    :aria-label="ariaLabel"
  >
    <div class="dtrans-segments" ref="segmentsEl">
      <div
        v-for="seg in segments"
        :key="seg.id"
        class="dtrans-seg"
        :class="{ 'is-offline': !seg.online }"
      >
        <span class="dtrans-seg-label">
          <span class="dtrans-seg-role">{{ seg.id }}</span>
          <span v-if="seg.frequency" class="dtrans-seg-freq">{{ seg.frequency }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { useDtransTargets } from '@/composables/useDtransTargets'
import {
  dtransZoneIndexFromX,
  type DtransTargetId,
  type DtransVariantId,
} from '@/workspace/dtrans'

const props = defineProps<{
  variant: DtransVariantId
}>()

const variantRef = toRef(props, 'variant')
const { segmentIds, targetFor } = useDtransTargets(variantRef)
const segmentsEl = ref<HTMLElement | null>(null)

const segments = computed(() =>
  segmentIds.value.map((id) => {
    const t = targetFor(id)
    return {
      id,
      online: !!t?.online && !!t.callsign,
      frequency: t?.frequency ?? null,
      callsign: t?.callsign ?? null,
    }
  }),
)

const online = computed(() => segments.value.some((s) => s.online))
const ariaLabel = computed(() => `Direct transfer ${props.variant}`)

function zoneIndexAtClientX(clientX: number): number {
  const el = segmentsEl.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  return dtransZoneIndexFromX(clientX, rect.left, rect.width, segmentIds.value.length)
}

function resolveAtClientX(clientX: number): {
  id: DtransTargetId
  callsign: string | null
  online: boolean
} | null {
  const ids = segmentIds.value
  if (!ids.length) return null
  const idx = zoneIndexAtClientX(clientX)
  const id = ids[idx]!
  const t = targetFor(id)
  return {
    id,
    callsign: t?.callsign ?? null,
    online: !!t?.online && !!t.callsign,
  }
}

defineExpose({ zoneIndexAtClientX, resolveAtClientX, segmentIds })
</script>

<style scoped>
.dtrans-hdr {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  width: 100%;
  min-width: 0;
  height: 100%;
  background: transparent;
  color: #e8f5e9;
  box-sizing: border-box;
}

.dtrans-segments {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: stretch;
}

.dtrans-seg {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 calc(4px * var(--bay-scale, 1));
  box-sizing: border-box;
}
.dtrans-seg.is-offline {
  opacity: 0.42;
}

.dtrans-seg-label {
  display: inline-flex;
  flex-direction: row;
  align-items: baseline;
  gap: calc(8px * var(--bay-scale, 1));
  min-width: 0;
}

/* Role matches .section-title; frequency lighter so they read apart */
.dtrans-seg-role,
.dtrans-seg-freq {
  font-size: calc(14px * var(--bay-scale, 1));
  line-height: 1;
  text-transform: uppercase;
  font-family: 'Segoe UI', 'Arial', sans-serif;
  white-space: nowrap;
}
.dtrans-seg-role {
  font-weight: 700;
  letter-spacing: calc(0.8px * var(--bay-scale, 1));
}
.dtrans-seg-freq {
  font-weight: 400;
  letter-spacing: calc(0.4px * var(--bay-scale, 1));
  font-variant-numeric: tabular-nums;
  opacity: 0.92;
}
</style>
