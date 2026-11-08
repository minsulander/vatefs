<template>
    <EfsBayContainer v-if="efs.connected"/>
    <NotConnected v-else/>
    <!--
      Zoom/scribble overlay is owned here (not by bay FlightStrip) so automove
      and other section remounts do not close an open zoom — only explicit close.
    -->
    <StripZoomOverlay
      v-if="zoomStrip && zoomSession"
      :model-value="true"
      :strip="zoomStrip"
      :bay-id="zoomSession.bayId"
      :section-id="zoomSession.sectionId"
      :anchor-rect="zoomSession.anchorRect"
      @update:model-value="onZoomModel"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import EfsBayContainer from '@/components/EfsBayContainer.vue'
import StripZoomOverlay from '@/components/StripZoomOverlay.vue'
import { useEfsStore } from '@/store/efs'
import NotConnected from '@/components/NotConnected.vue'

const efs = useEfsStore()

const zoomSession = computed(() => efs.stripZoomSession)
const zoomStrip = computed(() => {
    // strips is a Map — depend on stripsVersion so live field updates reach the overlay
    void efs.stripsVersion
    const id = efs.stripZoomSession?.stripId
    if (!id) return null
    return efs.strips.get(id) ?? null
})

function onZoomModel(open: boolean) {
    if (!open) efs.closeStripZoom()
}
</script>
