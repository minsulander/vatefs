<template>
  <div class="efs-section" :data-section-id="section.id">
    <div class="section-header">
      <span class="section-title">{{ section.title }}</span>
    </div>
    <div
      class="section-content"
      :class="{ 'drag-over': isDragOver }"
      @dragover.prevent="onDragOver"
      @dragenter="onDragEnter"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <FlightStrip
        v-for="strip in strips"
        :key="strip.id"
        :strip="strip"
        :section-id="section.id"
        :bay-id="bayId"
      />
      <div v-if="strips.length === 0" class="empty-section">
        Empty
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Section } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import FlightStrip from './FlightStrip.vue'

const props = defineProps<{
  section: Section
  bayId: string
}>()

const store = useEfsStore()
const isDragOver = ref(false)

const strips = computed(() => store.getStripsBySection(props.bayId, props.section.id))

function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function onDragEnter() {
  isDragOver.value = true
}

function onDragLeave(event: DragEvent) {
  const target = event.currentTarget as HTMLElement
  const relatedTarget = event.relatedTarget as HTMLElement
  if (!target.contains(relatedTarget)) {
    isDragOver.value = false
  }
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  isDragOver.value = false

  if (!event.dataTransfer) return

  try {
    const data = JSON.parse(event.dataTransfer.getData('application/json'))
    const { stripId } = data

    // Calculate drop position
    const sectionContent = event.currentTarget as HTMLElement
    const stripElements = Array.from(sectionContent.querySelectorAll('.flight-strip'))

    let position = stripElements.length

    for (let i = 0; i < stripElements.length; i++) {
      const element = stripElements[i]
      if (!element) continue

      const rect = element.getBoundingClientRect()
      const midpoint = rect.top + rect.height / 2

      if (event.clientY < midpoint) {
        position = i
        break
      }
    }

    store.moveStripToSection(stripId, props.bayId, props.section.id, position)
  } catch (error) {
    console.error('Error handling drop:', error)
  }
}
</script>

<style scoped>
.efs-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border-bottom: 1px solid #2a2e32;
}

.efs-section:last-child {
  border-bottom: none;
}

.section-header {
  background: #1a1d20;
  padding: 4px 8px;
  border-bottom: 1px solid #3a3e42;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: #8a9199;
  text-transform: uppercase;
  font-family: 'Segoe UI', 'Arial', sans-serif;
}

.section-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 2px 0;
  min-height: 50px;
  background: #12151a;
  transition: background 0.2s ease;
}

.section-content.drag-over {
  background: rgba(0, 150, 180, 0.1);
  box-shadow: inset 0 0 10px rgba(0, 150, 180, 0.2);
}

.empty-section {
  text-align: center;
  padding: 15px;
  color: #3a3e42;
  font-size: 0.75rem;
  font-style: normal;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.section-content::-webkit-scrollbar {
  width: 5px;
}

.section-content::-webkit-scrollbar-track {
  background: #12151a;
}

.section-content::-webkit-scrollbar-thumb {
  background: #2a2e32;
  border-radius: 2px;
}

.section-content::-webkit-scrollbar-thumb:hover {
  background: #3a3e42;
}
</style>
