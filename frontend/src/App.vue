<template>
    <v-app>
        behold, tis an app
        <router-view />
    </v-app>
</template>

<script lang="ts" setup>
import { useEfsStore } from "./store/efs"

const efs = useEfsStore()

</script>
