<template>
  <InfoStrip
    v-if="visible"
    :strip-id="kind"
    :tone="tone"
    :overflow-visible="large"
    @close="dismiss"
  >
    <div class="text-info" :class="{ 'text-info--lg': large }" :title="tooltip || flatText">
      <div class="text-info-stack">
        <span v-for="(line, i) in lines" :key="i" class="text-info-label">{{ line }}</span>
      </div>
    </div>
  </InfoStrip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import InfoStrip from './InfoStrip.vue'

const props = withDefaults(
  defineProps<{
    kind: string
    text: string
    visible: boolean
    tone?: 'default' | 'green' | 'yellow'
    tooltip?: string
    /** Double base font size (Speciell VFR / LVP). */
    large?: boolean
  }>(),
  { tone: 'default', large: false },
)

const emit = defineEmits<{
  close: []
}>()

const lines = computed(() =>
  props.text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean),
)

const flatText = computed(() => lines.value.join(' · '))

function dismiss() {
  emit('close')
}
</script>

<style scoped>
.text-info {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0 calc(8px * var(--strip-scale, 1));
  box-sizing: border-box;
}
.text-info-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  line-height: 1.05;
}
.text-info-label {
  font-size: calc(18px * var(--strip-scale, 1));
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #000;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.text-info--lg {
  overflow: visible;
}
.text-info--lg .text-info-stack {
  overflow: visible;
  line-height: 1;
}
.text-info--lg .text-info-label {
  font-size: calc(36px * var(--strip-scale, 1));
  overflow: visible;
  line-height: 1;
}
</style>
