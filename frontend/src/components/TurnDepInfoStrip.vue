<template>
  <InfoStrip v-if="visible && variant" :strip-id="kind" tone="green" @close="dismiss">
    <div class="turn-dep" :class="turnClass">
      <span
        v-if="variant.turn === 'LEFT'"
        class="turn-dep-cfg"
        :title="`RWY config ${variant.configId}`"
      >{{ variant.configId }}</span>
      <div v-if="variant.turn === 'BOTH'" class="turn-dep-arrows" aria-hidden="true">
        <DepTurnArrow class="turn-dep-arrow" turn="LEFT" />
        <DepTurnArrow class="turn-dep-arrow" turn="RIGHT" />
      </div>
      <DepTurnArrow v-else class="turn-dep-arrow" :turn="variant.turn" />
      <div class="turn-dep-title">{{ variant.title }}</div>
    </div>
  </InfoStrip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import InfoStrip from './InfoStrip.vue'
import DepTurnArrow from './DepTurnArrow.vue'
import { useTurnDepInfoStrip } from '@/composables/useInfoStrips'

const { variant, visible, dismiss, kind } = useTurnDepInfoStrip()

const turnClass = computed(() => {
  const t = variant.value?.turn
  if (t === 'LEFT') return 'lt'
  if (t === 'RIGHT') return 'rt'
  return 'mixed'
})
</script>

<style scoped>
.turn-dep {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: 100%;
  gap: calc(12px * var(--strip-scale, 1));
  padding: calc(1px * var(--strip-scale, 1)) 0 calc(1px * var(--strip-scale, 1)) calc(6px * var(--strip-scale, 1));
  box-sizing: border-box;
}

.turn-dep-cfg {
  position: absolute;
  left: calc(3px * var(--strip-scale, 1));
  bottom: calc(1px * var(--strip-scale, 1));
  z-index: 2;
  font-size: calc(10px * var(--strip-scale, 1));
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  color: #fff;
  pointer-events: none;
  user-select: none;
}

.turn-dep-arrows {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: calc(4px * var(--strip-scale, 1));
  flex: 0 0 auto;
}

/* Tall box; width scaled with tip-extended viewBox (44 vs 40) so stem/arm unchanged */
.turn-dep-arrow {
  flex: 0 0 calc(33px * var(--strip-scale, 1));
  width: calc(33px * var(--strip-scale, 1));
  height: calc(44px * var(--strip-scale, 1));
  margin: calc(2px * var(--strip-scale, 1)) 0;
  color: #f0f0f0;
  filter: drop-shadow(1px 1px 1px rgba(0, 0, 0, 0.35));
  align-self: center;
}

.turn-dep-arrows .turn-dep-arrow {
  flex: 0 0 calc(28px * var(--strip-scale, 1));
  width: calc(28px * var(--strip-scale, 1));
  height: calc(40px * var(--strip-scale, 1));
}

.turn-dep-title {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  padding-right: calc(2px * var(--strip-scale, 1));
  font-size: calc(26px * var(--strip-scale, 1));
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  color: #f0f0f0;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.35);
}

.turn-dep.mixed .turn-dep-title {
  font-size: calc(22px * var(--strip-scale, 1));
}
</style>
