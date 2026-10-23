<template>
  <InfoStrip v-if="visible && variant" :strip-id="kind" tone="green" @close="dismiss">
    <div class="sid19l">
      <span class="sid19l-cfg" :title="`RWY config ${variant.configId}`">{{ variant.configId }}</span>
      <div class="sid19l-title">{{ variant.title }}</div>
      <div class="sid19l-mode" :class="variant.mode.toLowerCase()">{{ modeLabel }}</div>
    </div>
  </InfoStrip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import InfoStrip from './InfoStrip.vue'
import { useSid19LInfoStrip } from '@/composables/useInfoStrips'

const { variant, visible, dismiss, kind } = useSid19LInfoStrip()

const modeLabel = computed(() => {
  const m = variant.value?.mode
  if (m === 'Q') return 'Q'
  if (m === 'E') return 'E'
  return 'MIX'
})
</script>

<style scoped>
.sid19l {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: 100%;
  gap: calc(10px * var(--strip-scale, 1));
  padding: 0 calc(8px * var(--strip-scale, 1));
  box-sizing: border-box;
}

.sid19l-cfg {
  position: absolute;
  top: calc(1px * var(--strip-scale, 1));
  left: calc(3px * var(--strip-scale, 1));
  z-index: 2;
  font-size: calc(10px * var(--strip-scale, 1));
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  color: #fff;
  pointer-events: none;
  user-select: none;
}

.sid19l-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: calc(18px * var(--strip-scale, 1));
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #f0f0f0;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.35);
}

.sid19l-mode {
  flex: 0 0 auto;
  min-width: calc(44px * var(--strip-scale, 1));
  padding: calc(5px * var(--strip-scale, 1)) calc(10px * var(--strip-scale, 1));
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 2px;
  font-size: calc(16px * var(--strip-scale, 1));
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #f0f0f0;
  text-align: center;
  line-height: 1;
  text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.35);
}

.sid19l-mode.mix {
  background: rgba(0, 0, 0, 0.2);
}
</style>
