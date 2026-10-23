<template>
  <InfoStrip v-if="visible && variant" :strip-id="kind" tone="yellow" @close="dismiss">
    <div class="r16" :title="tooltip">
      <div class="r16-cfg" title="RWY configs 9C / 15C" aria-hidden="true">
        <span>9C</span>
        <span>15C</span>
      </div>
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
  let t = `R16 up to ${v.topAltitudeFt} ft, ${hhmmZ(v.from)}-${hhmmZ(v.to)} · 9C / 15C`
  if (v.suggestConfigId) t += ` · suggest ${v.suggestConfigId}`
  return t
})
</script>

<style scoped>
.r16 {
  position: relative;
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

.r16-cfg {
  position: absolute;
  top: calc(1px * var(--strip-scale, 1));
  left: calc(3px * var(--strip-scale, 1));
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: calc(1px * var(--strip-scale, 1));
  font-size: calc(10px * var(--strip-scale, 1));
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  color: #fff;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.55), 0 1px 1px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  user-select: none;
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
