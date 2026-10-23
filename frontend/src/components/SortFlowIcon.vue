<template>
  <!-- Line = where new strips land (flat side); default ▼ = newestTop; flip for newestBottom -->
  <svg
    class="sort-flow-icon"
    :class="{ 'is-bottom': sortFlow === 'newestBottom' }"
    viewBox="0 0 10 13"
    aria-hidden="true"
  >
    <path
      class="sort-flow-icon-line"
      d="M0 1 H10"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="butt"
    />
    <path d="M5 12.5 L0 4 L10 4 Z" />
  </svg>
</template>

<script setup lang="ts">
import type { SortFlow } from '@/workspace'

defineProps<{
  sortFlow: SortFlow
}>()
</script>

<style scoped>
.sort-flow-icon {
  display: block;
  height: auto;
  aspect-ratio: 10 / 13;
  fill: currentColor;
  overflow: visible;
}

.sort-flow-icon.is-bottom {
  transform: rotate(180deg);
}
</style>
