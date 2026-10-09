<template>
    <div class="not-connected">
        <v-container class="text-grey">
            <h1 class="font-weight-thin not-connected-title">Not Connected</h1>
            <p class="mb-5 not-connected-copy">Please start the EFS server to use the application.</p>
            <v-btn @click="connect">Retry Connection</v-btn>
        </v-container>
    </div>
</template>

<script setup lang="ts">
import { useEfsStore } from '@/store/efs'

const efs = useEfsStore()

function connect() {
    efs.connect()
}
</script>

<style scoped>
.not-connected {
  --s: var(--efs-scale, 1);
  padding: calc(16px * var(--s));
}

.not-connected-title {
  font-size: calc(2rem * var(--s));
}

.not-connected-copy {
  font-size: calc(1rem * var(--s));
}
</style>