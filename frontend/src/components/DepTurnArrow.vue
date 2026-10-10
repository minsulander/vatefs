<template>
  <!--
    Smooth DEP-style path. Tip is longer sideways; viewBox only grows on the
    tip side so stem/arm stay the same size when CSS width is scaled to match.
  -->
  <svg
    class="dep-turn-arrow"
    :class="turn === 'LEFT' ? 'left' : 'right'"
    :viewBox="turn === 'LEFT' ? '-10 -4 44 39' : '-6 -4 44 39'"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <path
      v-if="turn === 'LEFT'"
      fill="currentColor"
      d="M24 34 H17.5 V18 Q17.5 9.5 12 9.5 H2 V17 L-10 5.75 L2 -4 V1 H12 Q24 1 24 18 Z"
    />
    <path
      v-else
      fill="currentColor"
      d="M4 34 H10.5 V18 Q10.5 9.5 16 9.5 H26 V17 L38 5.75 L26 -4 V1 H16 Q4 1 4 18 Z"
    />
  </svg>
</template>

<script setup lang="ts">
defineProps<{
  turn: 'LEFT' | 'RIGHT'
}>()
</script>

<style scoped>
.dep-turn-arrow {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
</style>
