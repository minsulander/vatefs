<template>
  <div
    class="ws-overflow-host"
    :class="{ 'ws-overflow-host--scroll': allowScroll }"
    :data-ws-overflow-section="sourceSectionId"
    :data-ws-overflow-bay="sourceBayId"
    @dragover.prevent="onDragOver"
    @drop.prevent="onDrop"
  >
    <FlightStrip
      v-for="strip in strips"
      :key="strip.id"
      :strip="strip"
      :section-id="sourceSectionId"
      :bay-id="sourceBayId"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { FlightStrip as FlightStripData } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import FlightStrip from './FlightStrip.vue'

const props = defineProps<{
  stripIds: string[]
  sourceSectionId: string
  sourceBayId: string
  allowScroll?: boolean
}>()

const store = useEfsStore()

const strips = computed(() => {
  void store.stripsVersion
  const out: FlightStripData[] = []
  for (const id of props.stripIds) {
    const s = store.strips.get(id)
    if (s) out.push(s)
  }
  return out
})

function onDragOver(e: DragEvent) {
  if (!e.dataTransfer) return
  if (e.dataTransfer.types.includes('application/x-efs-section')) return
  e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/efs-create')
    ? 'copy'
    : 'move'
}

function onDrop(e: DragEvent) {
  if (e.dataTransfer?.types.includes('application/x-efs-section')) return
  try {
    const data = JSON.parse(e.dataTransfer?.getData('application/json') || '{}') as {
      stripId?: string
      type?: string
    }
    if (!data?.stripId || data.type === 'infoStrip') return
    if (!store.strips.has(data.stripId)) return
    // Append into the originating section (overflow is display-only)
    const topCount = store.getTopStrips(props.sourceBayId, props.sourceSectionId).length
    store.moveStripToSection(data.stripId, props.sourceBayId, props.sourceSectionId, topCount)
  } catch {
    // ignore malformed drag payloads
  }
}
</script>

<style scoped>
.ws-overflow-host {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  padding: 2px 0;
  overflow: hidden;
}

.ws-overflow-host--scroll {
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}

.ws-overflow-host--scroll::-webkit-scrollbar {
  width: 6px;
  background: transparent;
}
.ws-overflow-host--scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}
</style>
