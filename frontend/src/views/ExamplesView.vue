<script setup lang="ts">
import ExampleStrips from '@/components/ExampleStrips.vue'
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <ExampleStrips @close="router.push('/')" />
</template>
