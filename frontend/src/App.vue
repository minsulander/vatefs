<template>
    <v-app theme="dark">
        <router-view />
    </v-app>
</template>

<script lang="ts" setup>
import { useEfsStore } from "./store/efs"

const efs = useEfsStore()

</script>

<style>
/* Global styles for touch drag-and-drop */
body.touch-dragging {
    overflow: hidden !important;
    touch-action: none !important;
    user-select: none !important;
    -webkit-user-select: none !important;
    -webkit-touch-callout: none !important;
}

body.touch-dragging * {
    cursor: grabbing !important;
    -webkit-touch-callout: none !important;
}

/* Drag clone styling */
.drag-clone {
    border: 2px solid #0088aa !important;
    background: #f0ebe0 !important;
    -webkit-touch-callout: none !important;
    user-select: none !important;
    -webkit-user-select: none !important;
}

/* Section highlight during drag */
.section-content.drag-over {
    background: rgba(0, 136, 170, 0.15) !important;
    outline: 2px dashed #0088aa;
    outline-offset: -2px;
}

/* Prevent text selection and callout on touch devices globally for strips */
.flight-strip,
.flight-strip * {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
}
</style>
