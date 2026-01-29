<template>
  <div class="efs-bay" :data-bay-id="bay.id">
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
import type { Bay } from '@/types/efs'
import EfsSection from './EfsSection.vue'

defineProps<{
  bay: Bay
}>()
</script>

<style scoped>
.efs-bay {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0d1014;
  border-right: 1px solid #2a2e32;
}

.efs-bay:last-child {
  border-right: none;
}
</style>
