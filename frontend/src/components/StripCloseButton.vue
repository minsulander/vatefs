<template>
  <button
    type="button"
    class="strip-close-btn"
    title="Close"
    draggable="false"
    @click.stop="$emit('click', $event)"
    @pointerdown.stop
    @touchstart.stop
    @dragstart.prevent
  >
    <svg class="strip-close-x" viewBox="0 0 12 12" aria-hidden="true">
      <!-- Geometric X nearly to the corners (not a typographic ×) -->
      <path d="M0.75 0.75 L11.25 11.25 M11.25 0.75 L0.75 11.25" />
    </svg>
  </button>
</template>

<script setup lang="ts">
defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<style scoped>
.strip-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: calc(14px * var(--strip-scale, 1));
  height: calc(14px * var(--strip-scale, 1));
  margin: 0;
  padding: 0;
  border: 1px solid #b0b0b0;
  border-radius: 1px;
  background: #e0e0e0;
  color: #222;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  flex-shrink: 0;
}

.strip-close-btn:hover {
  background: #d0d0d0;
  border-color: #888;
}

.strip-close-x {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.strip-close-x path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: square;
  stroke-linejoin: miter;
}
</style>
