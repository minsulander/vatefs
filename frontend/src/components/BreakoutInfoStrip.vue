<template>
  <InfoStrip v-if="visible && variant" :strip-id="kind" @close="dismiss">
    <div class="breakout">
      <div class="breakout-icon" aria-hidden="true">
        <div class="breakout-planes" :class="{ mirrored: variant.mirror }">
          <v-icon class="breakout-plane plane-up" icon="mdi-airplane" />
          <v-icon class="breakout-plane plane-ne" icon="mdi-airplane" />
        </div>
        <span class="breakout-notch" />
      </div>
      <div class="breakout-rwy">{{ variant.runway }}</div>
      <div class="breakout-text">
        <div class="breakout-line">
          BREAKOUT! C/S, TURN {{ variant.turn }} IMMEDIATELY
        </div>
        <div class="breakout-line">
          HEADING {{ variant.heading }} AND CLIMB TO {{ variant.climbFt }} FEET
        </div>
      </div>
    </div>
  </InfoStrip>
</template>

<script setup lang="ts">
import InfoStrip from './InfoStrip.vue'
import { useBreakoutInfoStrip } from '@/composables/useInfoStrips'

const { variant, visible, dismiss, kind } = useBreakoutInfoStrip()
</script>

<style scoped>
.breakout {
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: 100%;
  gap: 0;
}

.breakout-icon {
  position: relative;
  flex: 0 0 auto;
  width: var(--strip-body-h, 50px);
  height: 100%;
  background: #39b54a;
  overflow: visible;
}

.breakout-planes {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.breakout-planes.mirrored {
  transform: scaleX(-1);
}

/* mdi-airplane defaults nose ~NE; rotate from that */
.breakout-plane {
  position: absolute;
  color: #1a1a1a !important;
  opacity: 1;
  width: calc(27px * var(--strip-scale, 1)) !important;
  height: calc(27px * var(--strip-scale, 1)) !important;
  font-size: calc(27px * var(--strip-scale, 1)) !important;
}

/* Bottom-left, pointing straight north */
.plane-up {
  left: calc(0px * var(--strip-scale, 1));
  bottom: calc(-2px * var(--strip-scale, 1));
  transform: rotate(-45deg);
}

/* Top-right, pointing 45° (northeast) */
.plane-ne {
  right: calc(1.5px * var(--strip-scale, 1));
  top: calc(1.5px * var(--strip-scale, 1));
  transform: rotate(0deg);
}

/* Small triangular tip on the right of the green block */
.breakout-notch {
  position: absolute;
  right: calc(-5px * var(--strip-scale, 1));
  top: 50%;
  transform: translateY(-50%);
  width: 0;
  height: 0;
  border-top: calc(5px * var(--strip-scale, 1)) solid transparent;
  border-bottom: calc(5px * var(--strip-scale, 1)) solid transparent;
  border-left: calc(5px * var(--strip-scale, 1)) solid #39b54a;
  z-index: 1;
  pointer-events: none;
}

.breakout-rwy {
  flex: 0 0 auto;
  padding: 0 calc(10px * var(--strip-scale, 1)) 0 calc(12px * var(--strip-scale, 1));
  font-size: calc(28px * var(--strip-scale, 1));
  font-weight: 700;
  color: #000;
  letter-spacing: 0.02em;
  line-height: 1;
}

.breakout-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: calc(2px * var(--strip-scale, 1));
  padding-right: calc(6px * var(--strip-scale, 1));
}

.breakout-line {
  font-size: calc(11px * var(--strip-scale, 1));
  font-weight: 700;
  color: #111;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
