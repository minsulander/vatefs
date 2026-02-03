<template>
    <EfsBayContainer v-if="efs.connected"/>
    <NotConnected v-else/>
</template>

<script setup lang="ts">
import EfsBayContainer from '@/components/EfsBayContainer.vue'
import { useEfsStore } from '@/store/efs'
import NotConnected from '@/components/NotConnected.vue'

const efs = useEfsStore()
</script>
