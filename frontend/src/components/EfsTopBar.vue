<template>
  <div style="height: 25px; background: deeppink;">
    <v-app-bar color="#2b2d31" height="25" elevation="0" class="efs-top-bar text-body-2 text-grey">
      <!-- Refresh button -->
      <v-btn variant="text" icon="mdi-refresh" size="small" class="text-grey" @click="efs.refresh()" title="Refresh"></v-btn>
      <!-- Callsign -->
      <span class="text-grey ml-1">{{ efs.myCallsign || 'NOT CONNECTED' }}</span>
      <!-- ATIS per airport -->
      <span v-for="info in atisDisplayItems" :key="info.airport" class="ml-3">
        <span class="text-grey-darken-1">{{ info.airport }}</span>
        <template v-if="info.split">
          <span class="text-amber ml-1" v-if="info.arrAtis">{{ info.arrAtis }}</span>
          <span class="text-grey-darken-2 ml-1" v-if="info.arrRunways">{{ info.arrRunways }}</span>
          <span class="text-cyan ml-1" v-if="info.depAtis">{{ info.depAtis }}</span>
          <span class="text-grey-darken-2 ml-1" v-if="info.depRunways">{{ info.depRunways }}</span>
        </template>
        <template v-else>
          <span class="text-amber ml-1" v-if="info.atis">{{ info.atis }}</span>
          <span class="text-grey-darken-2 ml-1" v-if="info.runways">{{ info.runways }}</span>
        </template>
        <span class="text-grey ml-1" v-if="info.qnh">{{ info.qnh }}</span>
      </span>
      <!-- Fallback: show airports without ATIS data -->
      <span v-if="atisDisplayItems.length === 0 && efs.displayAirports.length > 0" class="text-grey-darken-1 ml-2">
        {{ efs.displayAirports.join(' ') }}
      </span>
      <v-btn
        v-if="efs.dclStatus !== 'unavailable'"
        variant="text"
        size="small"
        class="ml-2"
        :class="{
          'text-grey': efs.dclStatus === 'available',
          'text-green': efs.dclStatus === 'connected',
          'text-red': efs.dclStatus === 'error'
        }"
        :title="dclTooltip"
        @click="onDclClick"
      >
        DCL
      </v-btn>
      <v-spacer />
      <!-- Config selector -->
      <v-menu v-if="efs.availableConfigs.length > 1" offset-y>
        <template v-slot:activator="{ props }">
          <v-btn variant="text" size="small" class="text-grey" v-bind="props" title="Switch configuration">
            {{ activeConfigName }}
            <v-icon end size="x-small">mdi-chevron-down</v-icon>
          </v-btn>
        </template>
        <v-list density="compact" bg-color="#2b2d31" class="text-grey">
          <v-list-item
            v-for="config in efs.availableConfigs"
            :key="config.file"
            :active="config.file === efs.activeConfig"
            @click="efs.switchConfig(config.file)"
          >
            <v-list-item-title>{{ config.name }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
      <v-btn v-if="!fullscreen && !isStandalone" variant="text" icon="mdi-fullscreen" class="text-grey"
        @click="requestFullScreen"></v-btn>
      <v-btn v-if="fullscreen && !isStandalone" variant="text" icon="mdi-fullscreen-exit" class="text-grey"
        @click="exitFullScreen"></v-btn>
      <clock class="mx-2" />
    </v-app-bar>
  </div>
</template>

<script setup lang="ts">
import Clock from './Clock.vue'
import { ref, computed, onMounted } from "vue"
import { useEfsStore } from "../store/efs"

const efs = useEfsStore()
const fullscreen = ref(window.innerHeight == screen.height)
const isStandalone = ('standalone' in navigator && (navigator as any).standalone) || window.matchMedia('(display-mode: standalone)').matches

interface AtisDisplayItem {
  airport: string
  split: boolean
  atis?: string
  arrAtis?: string
  depAtis?: string
  runways?: string       // combined arr+dep runways for non-split
  arrRunways?: string    // arrival runways for split
  depRunways?: string    // departure runways for split
  qnh?: string
}

const atisDisplayItems = computed((): AtisDisplayItem[] => {
  return efs.atisInfo.map((info) => {
    const isSplit = !!(info.arrAtis || info.depAtis)
    const qnh = info.qnh ? String(info.qnh) : undefined

    if (isSplit) {
      return {
        airport: info.airport,
        split: true,
        arrAtis: info.arrAtis,
        depAtis: info.depAtis,
        arrRunways: info.arrRunways.join('/'),
        depRunways: info.depRunways.join('/'),
        qnh,
      }
    }

    // Combine runways: show dep runways (they typically match arr for single-runway ops)
    const allRunways = [...new Set([...info.depRunways, ...info.arrRunways])]
    return {
      airport: info.airport,
      split: false,
      atis: info.atis,
      runways: allRunways.join('/'),
      qnh,
    }
  })
})

const activeConfigName = computed(() => {
  const active = efs.availableConfigs.find(c => c.file === efs.activeConfig)
  return active?.name ?? efs.activeConfig
})

const dclTooltip = computed(() => {
  switch (efs.dclStatus) {
    case 'available': return 'Click to connect DCL'
    case 'connected': return 'DCL connected - click to disconnect'
    case 'error': return `DCL error: ${efs.dclError ?? 'unknown'} - click to retry`
    default: return 'DCL unavailable'
  }
})

function onDclClick() {
  if (efs.dclStatus === 'connected') {
    efs.dclLogout()
  } else {
    efs.dclLogin()
  }
}

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