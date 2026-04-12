<template>
  <div ref="bayEl" class="efs-bay" :data-bay-id="bay.id">
    <EfsSection
      v-for="(section, index) in bay.sections"
      :key="section.id"
      :section="section"
      :bay-id="bay.id"
      :is-first-section="index === 0"
      :is-last-section="index === bay.sections.length - 1"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import type { Bay } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import EfsSection from './EfsSection.vue'

const props = defineProps<{
  bay: Bay
}>()

const store = useEfsStore()
const bayEl = ref<HTMLElement | null>(null)

// After first render, lock all non-last sections to their actual pixel heights
// so they don't shift when strip content changes.
onMounted(() => {
  nextTick(() => {
    if (!bayEl.value) return
    const sections = props.bay.sections
    const sectionEls = bayEl.value.querySelectorAll('.efs-section')
    for (let i = 0; i < sections.length - 1; i++) {
      const section = sections[i]
      const el = sectionEls[i]
      if (section && !section.height && el) {
        const height = el.getBoundingClientRect().height
        store.setSectionHeight(props.bay.id, section.id, height, false)
      }
    }
  })
})
</script>

<style scoped>
.efs-bay {
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>
