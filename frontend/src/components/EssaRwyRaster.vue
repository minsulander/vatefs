<template>
  <svg
    class="essa-rwy-raster"
    viewBox="0 0 80 90"
    aria-hidden="true"
  >
    <!--
      Geographic ESSA north-up from AIP THR lat/lon (local metres → viewBox):
        01L (59.6373N 17.9132E) → 19R (59.6664N 17.9238E)  long west strip ~010°
        01R (59.6264N 17.9507E) → 19L (59.6485N 17.9587E)  shorter east, staggered south
        08  (59.6584N 17.9361E) → 26  (59.6639N 17.9792E)  northern crosswind ~076°
    -->
    <g class="rwy-pair" :class="{ hot: hotId === '01L_19R' }">
      <line class="rwy-bar" x1="3.4" y1="64.1" x2="15.3" y2="3.3" />
    </g>
    <g class="rwy-pair" :class="{ hot: hotId === '01R_19L' }">
      <line class="rwy-bar" x1="45.6" y1="86.8" x2="54.6" y2="40.7" />
    </g>
    <g class="rwy-pair" :class="{ hot: hotId === '08_26' }">
      <line class="rwy-bar" x1="29.2" y1="19.9" x2="77.5" y2="8.5" />
    </g>
    <!-- AVSTÄNGD: black X at midpoint of the closed runway -->
    <g v-if="closed && closedX" class="rwy-closed-x" :transform="closedX.transform">
      <line x1="-10" y1="-10" x2="10" y2="10" />
      <line x1="10" y1="-10" x2="-10" y2="10" />
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ESSA_PHYSICAL_RWY_PAIRS, essaRunwaySectionId } from '@vatefs/common'

/** ViewBox endpoints matching the runway lines above */
const RWY_ENDS: Record<string, { x1: number; y1: number; x2: number; y2: number }> = {
  '01L_19R': { x1: 3.4, y1: 64.1, x2: 15.3, y2: 3.3 },
  '01R_19L': { x1: 45.6, y1: 86.8, x2: 54.6, y2: 40.7 },
  '08_26': { x1: 29.2, y1: 19.9, x2: 77.5, y2: 8.5 },
}

const props = defineProps<{
  /** Home section id (e.g. runway_01L_19R) or pair id (01L_19R) */
  sectionId?: string
  /** Fallback label e.g. 01L/19R */
  label?: string
  /** Closed (AVSTÄNGD) strip — draw X on the hot runway centre */
  closed?: boolean
}>()

const hotId = computed(() => {
  const sid = (props.sectionId || '').trim()
  for (const pair of ESSA_PHYSICAL_RWY_PAIRS) {
    if (sid === pair.id || sid === essaRunwaySectionId(pair)) return pair.id
  }
  const lab = (props.label || '').trim().toUpperCase().replace(/\s+/g, '')
  for (const pair of ESSA_PHYSICAL_RWY_PAIRS) {
    if (pair.label.replace(/\s+/g, '') === lab) return pair.id
    if (lab === pair.ends[0] || lab === pair.ends[1]) return pair.id
  }
  return null
})

const closedX = computed(() => {
  const id = hotId.value
  if (!id) return null
  const e = RWY_ENDS[id]
  if (!e) return null
  const cx = (e.x1 + e.x2) / 2
  const cy = (e.y1 + e.y2) / 2
  return { transform: `translate(${cx} ${cy})` }
})
</script>

<style scoped>
.essa-rwy-raster {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}

.rwy-bar {
  fill: none;
  stroke: rgba(255, 255, 255, 0.45);
  stroke-width: 5.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.rwy-pair.hot .rwy-bar {
  stroke: #f5d76a;
  stroke-width: 6.5;
  filter: drop-shadow(0 0 1.5px rgba(255, 220, 80, 0.85));
}

.rwy-closed-x line {
  stroke: #0a0a0a;
  stroke-width: 5.2;
  stroke-linecap: square;
  stroke-linejoin: miter;
}
</style>
