<template>
    <v-app theme="dark">
        <router-view />
    </v-app>
</template>

<script lang="ts" setup>
import { watch } from "vue"
import { useEfsStore } from "./store/efs"
import { useEfsUiScale } from "./composables/useEfsUiScale"
import { setBayBgRtcPalette, startBayBackground } from "./composables/useBayBackground"

const efs = useEfsStore()
useEfsUiScale()
startBayBackground()
// ESSA keeps cold grey bay bg; RTC uses warm grey palette
watch(
  () => efs.multiAirport,
  (rtc) => setBayBgRtcPalette(!!rtc),
  { immediate: true },
)
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

/* Drag clone styling — outline (not border) so layout width/height stay correct */
.drag-clone {
    outline: 2px solid #0088aa !important;
    outline-offset: -2px;
    -webkit-touch-callout: none !important;
    user-select: none !important;
    -webkit-user-select: none !important;
}

/* Prevent text selection and callout on touch devices globally for strips */
.flight-strip,
.flight-strip * {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
}
</style>
