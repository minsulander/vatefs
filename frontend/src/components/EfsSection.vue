<template>
  <div class="efs-section">
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
  border-bottom: 1px solid #3a3e42;
}

.efs-section:last-child {
  border-bottom: none;
}

.section-header {
  background: linear-gradient(180deg, #2a2e32 0%, #252a2e 100%);
  padding: 6px 8px;
  border-bottom: 2px solid rgb(var(--v-theme-primary));
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 1px;
  color: rgb(var(--v-theme-primary));
  text-transform: uppercase;
}

.section-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
  min-height: 60px;
  transition: background 0.2s ease;
}

.section-content.drag-over {
  background: rgba(var(--v-theme-primary), 0.1);
  box-shadow: inset 0 0 8px rgba(var(--v-theme-primary), 0.3);
}

.empty-section {
  text-align: center;
  padding: 20px;
  color: #555;
  font-size: 0.8rem;
  font-style: italic;
}

.section-content::-webkit-scrollbar {
  width: 6px;
}

.section-content::-webkit-scrollbar-track {
  background: #1a1e22;
}

.section-content::-webkit-scrollbar-thumb {
  background: #3a3e42;
  border-radius: 3px;
}

.section-content::-webkit-scrollbar-thumb:hover {
  background: #4a4e52;
}
</style>
