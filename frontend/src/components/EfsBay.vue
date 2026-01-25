<template>
  <div class="efs-bay">
    <EfsSection
      v-for="section in bay.sections"
      :key="section.id"
      :section="section"
      :bay-id="bay.id"
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
  background: #1a1e22;
  border-right: 2px solid #3a3e42;
}

.efs-bay:last-child {
  border-right: none;
}
</style>
