<template>
  <div style="height: 25px; background: deeppink;">
    <v-app-bar color="#2b2d31" height="25" elevation="0" class="efs-top-bar text-body-2 text-grey">
      <!-- Refresh button -->
      <v-btn variant="text" icon="mdi-refresh" size="small" class="text-grey" @click="efs.refresh()" title="Refresh"></v-btn>
      <!-- Callsign and airports -->
      <span class="text-grey ml-1">{{ efs.myCallsign || 'NOT CONNECTED' }}</span>
      <span v-if="efs.displayAirports.length > 0" class="text-grey-darken-1 ml-2">
        {{ efs.displayAirports.join(' ') }}
      </span>
      <v-spacer />
      <v-btn v-if="!fullscreen" variant="text" icon="mdi-fullscreen" class="text-grey"
        @click="requestFullScreen"></v-btn>
      <v-btn v-if="fullscreen" variant="text" icon="mdi-fullscreen-exit" class="text-grey"
        @click="exitFullScreen"></v-btn>
      <clock class="mx-2" />
    </v-app-bar>
  </div>
</template>

<script setup lang="ts">
import Clock from './Clock.vue'
import { ref, onMounted } from "vue"
import { useEfsStore } from "../store/efs"

const efs = useEfsStore()
const fullscreen = ref(window.innerHeight == screen.height)

function requestFullScreen() {
  const element = document.body as any
  var requestMethod =
    element.requestFullScreen ||
    element.webkitRequestFullScreen ||
    element.mozRequestFullScreen ||
    element.msRequestFullScreen

  if (requestMethod) {
    requestMethod.call(element)
    fullscreen.value = true
  }
}

function exitFullScreen() {
  if (document.exitFullscreen) {
    document.exitFullscreen()
  } else if ((document as any).webkitExitFullscreen) {
    ; (document as any).webkitExitFullscreen()
  } else if ((document as any).mozCancelFullScreen) {
    ; (document as any).mozCancelFullScreen()
  } else if ((document as any).msExitFullscreen) {
    ; (document as any).msExitFullscreen()
  }
  fullscreen.value = false
}

onMounted(() => {
  window.addEventListener("resize", () => {
    fullscreen.value = !!document.fullscreenElement
  })
})
</script>