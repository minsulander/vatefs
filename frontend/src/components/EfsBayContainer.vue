<template>
  <div class="efs-bay-container">
    <v-row no-gutters class="fill-height">
      <v-col
        v-for="bay in bays"
        :key="bay.id"
        cols="3"
        class="bay-column"
      >
        <EfsBay :bay="bay" />
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useEfsStore } from '@/store/efs'
import EfsBay from './EfsBay.vue'

const store = useEfsStore()
const bays = computed(() => store.getBays)
</script>

<style scoped>
.efs-bay-container {
  height: 100vh;
  overflow: hidden;
  background: #0f1315;
}

.fill-height {
  height: 100%;
}

.bay-column {
  height: 100%;
  overflow: hidden;
}
</style>
