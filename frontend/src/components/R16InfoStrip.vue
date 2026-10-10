<template>
  <InfoStrip v-if="visible && variant" :strip-id="kind" tone="yellow" @close="dismiss">
    <div class="r16" :title="tooltip">
      <span class="r16-text">R16 utökad ↑</span>
    </div>
  </InfoStrip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import InfoStrip from './InfoStrip.vue'
import { useR16InfoStrip } from '@/composables/useInfoStrips'

const { variant, visible, dismiss, kind } = useR16InfoStrip()

function hhmmZ(iso: string | null): string {
  if (!iso) return '?'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '?'
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`
}

/** Hover hint: ceiling + active window (+ suggested RWY config when AUTO). */
const tooltip = computed(() => {
  const v = variant.value
  if (!v) return undefined
  let t = `R16 up to ${v.topAltitudeFt} ft, ${hhmmZ(v.from)}-${hhmmZ(v.to)}`
  if (v.suggestConfigId) t += ` · RWY ${v.suggestConfigId}`
  return t
})
</script>

<style scoped>
.r16 {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0 calc(8px * var(--strip-scale, 1));
  box-sizing: border-box;
}

.r16-text {
  font-size: calc(22px * var(--strip-scale, 1));
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #000;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
