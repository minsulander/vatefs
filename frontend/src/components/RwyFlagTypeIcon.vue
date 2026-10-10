<template>
  <!-- Vehicle occupied -->
  <svg v-if="kind === 'rwyOccupied'" class="rwy-flag-svg" viewBox="0 0 40 28" fill="none">
    <rect x="2" y="10" width="28" height="10" rx="1.5" fill="#f5f5f5" stroke="#222" stroke-width="1.2" />
    <path d="M18 10 V6.5 H30 L36 12 V20 H30" fill="#f5f5f5" stroke="#222" stroke-width="1.2" stroke-linejoin="round" />
    <rect x="20" y="7" width="8" height="5" rx="0.5" fill="#c8d8e8" stroke="#222" stroke-width="0.8" />
    <circle cx="10" cy="21" r="3.2" fill="#333" stroke="#111" stroke-width="0.8" />
    <circle cx="10" cy="21" r="1.4" fill="#888" />
    <circle cx="30" cy="21" r="3.2" fill="#333" stroke="#111" stroke-width="0.8" />
    <circle cx="30" cy="21" r="1.4" fill="#888" />
  </svg>
  <!-- Closed / AVSTÄNGD — supplied cone artwork -->
  <img
    v-else
    class="rwy-flag-cone-img"
    :src="coneSrc"
    alt=""
    draggable="false"
  />
</template>

<script setup lang="ts">
import type { RwyFlagKind } from '@/composables/useRunwayFlagStrips'
import coneSrc from '@/assets/rwy-flag-cone.png'

defineProps<{
  kind: RwyFlagKind
}>()
</script>

<style scoped>
.rwy-flag-svg {
  width: 100%;
  height: 100%;
  display: block;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
}

.rwy-flag-cone-img {
  width: 100%;
  height: 100%;
  max-width: calc(42px * var(--strip-scale, 1));
  max-height: calc(48px * var(--strip-scale, 1));
  object-fit: contain;
  object-position: center;
  display: block;
  pointer-events: none;
  user-select: none;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
}
</style>
