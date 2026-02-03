<template>
    <div class="not-connected">
        <v-container class="text-grey">
            <h1 class="font-weight-thin">Not Connected</h1>
            <p class="mb-5">Please start the EFS server to use the application.</p>
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