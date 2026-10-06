<template>
  <div style="height: 25px">
    <v-app-bar color="#2b2d31" height="25" elevation="0" class="efs-top-bar text-body-2 text-grey">
      <!-- Refresh button -->
      <v-btn variant="text" icon="mdi-refresh" size="small" class="text-grey" @click="efs.refresh()" title="Refresh"></v-btn>
      <v-btn variant="text" icon="mdi-cog" size="small" class="text-grey" to="/settings" title="Settings"></v-btn>
      <!-- Callsign -->
      <span class="text-grey ml-1">{{ efs.myCallsign || 'NOT CONNECTED' }}</span>
      <!-- ATIS / airports (MULTIAPT: open columns always; idle ICAOs only with traffic, clickable for swap) -->
      <span
        v-for="info in atisDisplayItems"
        :key="info.airport"
        class="ml-3 airport-atis"
        :class="{
          'airport-atis--idle': info.idle,
          'airport-atis--open': !info.idle && efs.multiAirport,
          'airport-atis--selected': efs.pendingIdleSwap === info.airport,
          'airport-atis--new': info.newlyActive,
        }"
        :title="airportTitle(info)"
        @click.stop="onAirportClick(info)"
      >
        <span class="airport-icao" :class="info.idle ? 'text-grey' : 'text-grey-darken-1'">{{ info.airport }}</span>
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
      <!-- Fallback: show airports without ATIS data (non-MULTIAPT) -->
      <span v-if="atisDisplayItems.length === 0 && efs.displayAirports.length > 0" class="text-grey-darken-1 ml-2">
        {{ efs.displayAirports.join(' ') }}
      </span>
      <span v-if="efs.multiAirport && efs.pendingIdleSwap" class="idle-hint ml-2">
        → click a column for {{ efs.pendingIdleSwap }}
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
      <v-menu v-if="efs.dclStatus !== 'unavailable'" offset-y>
        <template v-slot:activator="{ props }">
          <v-btn
            variant="text"
            size="small"
            class="dcl-mode-btn text-grey"
            v-bind="props"
            :title="`DCL mode: ${efs.dclMode.toUpperCase()}`"
          >
            {{ efs.dclMode.toUpperCase() }}
            <v-icon end size="x-small">mdi-chevron-down</v-icon>
          </v-btn>
        </template>
        <v-list density="compact" bg-color="#2b2d31" class="text-grey">
          <v-list-item
            v-for="mode in dclModes"
            :key="mode.value"
            :active="mode.value === efs.dclMode"
            @click="efs.dclSetMode(mode.value)"
          >
            <v-list-item-title>{{ mode.label }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
      <v-spacer />
      <!-- Config selector -->
      <v-menu
        v-if="efs.availableConfigs.length > 1"
        v-model="configMenuOpen"
        offset-y
        :close-on-content-click="false"
      >
        <template v-slot:activator="{ props }">
          <v-btn variant="text" size="small" class="text-grey" v-bind="props" title="Switch configuration">
            {{ activeConfigName }}
            <v-icon end size="x-small">mdi-chevron-down</v-icon>
          </v-btn>
        </template>
        <v-list density="compact" bg-color="#2b2d31" class="text-grey config-menu">
          <v-list-item
            v-for="config in efs.availableConfigs"
            :key="config.file"
            :active="config.file === efs.activeConfig"
            @click="onConfigClick(config.file)"
          >
            <v-list-item-title>{{ config.name }}</v-list-item-title>
            <template v-if="isRtcConfig(config)" #append>
              <div class="column-count-ctrl" @click.stop>
                <v-btn
                  variant="text"
                  icon="mdi-minus"
                  size="x-small"
                  class="text-grey"
                  :disabled="!efs.multiAirport || config.file !== efs.activeConfig || efs.columnCount <= 2"
                  title="Fewer columns"
                  @click="efs.adjustColumnCount(-1)"
                />
                <span class="column-count-label" :title="`${efs.columnCount} columns`">{{ efs.columnCount }}</span>
                <v-btn
                  variant="text"
                  icon="mdi-plus"
                  size="x-small"
                  class="text-grey"
                  :disabled="!efs.multiAirport || config.file !== efs.activeConfig || efs.columnCount >= 6"
                  title="More columns"
                  @click="efs.adjustColumnCount(1)"
                />
              </div>
            </template>
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
import type { ConfigInfo, DclMode } from "@vatefs/common"

const efs = useEfsStore()
const fullscreen = ref(window.innerHeight == screen.height)
const isStandalone = ('standalone' in navigator && (navigator as any).standalone) || window.matchMedia('(display-mode: standalone)').matches
const configMenuOpen = ref(false)

const dclModes: { label: string; value: DclMode }[] = [
  { label: 'MANUAL', value: 'manual' },
  { label: 'SEMI', value: 'semi' },
  { label: 'AUTO', value: 'auto' },
]

interface AtisDisplayItem {
  airport: string
  split: boolean
  idle: boolean
  newlyActive?: boolean
  atis?: string
  arrAtis?: string
  depAtis?: string
  runways?: string
  arrRunways?: string
  depRunways?: string
  qnh?: string
}

function buildAtisItem(airport: string, idle: boolean): AtisDisplayItem {
  const info = efs.atisInfo.find(a => a.airport === airport)
  const qnh = info?.qnh ? String(info.qnh) : undefined
  const newlyActive = efs.isNewlyActiveAirport(airport)

  if (info && (info.arrAtis || info.depAtis)) {
    return {
      airport,
      idle,
      newlyActive,
      split: true,
      arrAtis: info.arrAtis,
      depAtis: info.depAtis,
      arrRunways: info.arrRunways.join('/'),
      depRunways: info.depRunways.join('/'),
      qnh,
    }
  }

  const allRunways = info
    ? [...new Set([...info.depRunways, ...info.arrRunways])]
    : []
  return {
    airport,
    idle,
    newlyActive,
    split: false,
    atis: info?.atis,
    runways: allRunways.length ? allRunways.join('/') : undefined,
    qnh,
  }
}

const atisDisplayItems = computed((): AtisDisplayItem[] => {
  if (efs.multiAirport) {
    const active = new Set(efs.activeAirports)
    const open = efs.columnAirports.filter(
      (a): a is string => !!a && active.has(a),
    )
    const visible = new Set(open)
    const idle = efs.activeAirports.filter(
      a => !visible.has(a) && efs.airportHasTraffic(a),
    )
    const newborn = efs.newlyActiveAirports.filter(
      a => active.has(a) && !visible.has(a) && !idle.includes(a),
    )
    return [
      ...newborn.map(a => buildAtisItem(a, true)),
      ...idle.map(a => buildAtisItem(a, true)),
      ...open.map(a => buildAtisItem(a, false)),
    ]
  }

  return efs.atisInfo.map((info) => buildAtisItem(info.airport, false))
})

const activeConfigName = computed(() => {
  const active = efs.availableConfigs.find(c => c.file === efs.activeConfig)
  return active?.name ?? efs.activeConfig
})

function isRtcConfig(config: ConfigInfo): boolean {
  return config.name === 'RTC' || config.file.toLowerCase().includes('multiairport')
}

function onConfigClick(file: string) {
  const config = efs.availableConfigs.find(c => c.file === file)
  if (!config) return
  if (file !== efs.activeConfig) {
    efs.switchConfig(file)
  }
  // Stay open on RTC so column buttons remain usable
  if (!isRtcConfig(config)) {
    configMenuOpen.value = false
  }
}

const dclTooltip = computed(() => {
  switch (efs.dclStatus) {
    case 'available': return 'Click to connect DCL'
    case 'connected': return 'DCL connected - click to disconnect'
    case 'error': return `DCL error: ${efs.dclError ?? 'unknown'} - click to retry`
    default: return 'DCL unavailable'
  }
})

function airportTitle(info: AtisDisplayItem): string | undefined {
  if (!efs.multiAirport) return undefined
  if (info.newlyActive) return `${info.airport} newly active`
  if (info.idle) {
    if (efs.pendingIdleSwap === info.airport) return `Click a column to open ${info.airport}`
    return `Select ${info.airport}, then click a column`
  }
  return `Highlight ${info.airport} column`
}

function onAirportClick(info: AtisDisplayItem) {
  if (!efs.multiAirport) return
  if (info.idle) {
    efs.selectIdleForSwap(info.airport)
    return
  }
  efs.flashColumnForAirport(info.airport)
}

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

<style scoped>
.dcl-mode-btn {
  min-width: 0 !important;
  padding: 0 4px !important;
  margin-left: -4px !important;
  font-size: 10px !important;
  letter-spacing: 0.5px;
}

.airport-atis--idle,
.airport-atis--open {
  cursor: pointer;
  padding: 0 4px;
  border-radius: 2px;
  border: 1px solid transparent;
}

.airport-atis--idle:hover,
.airport-atis--open:hover {
  background: rgba(255, 255, 255, 0.08);
}

.airport-atis--selected {
  background: rgba(144, 202, 249, 0.2) !important;
  border-color: #90caf9 !important;
}

.airport-atis--selected .airport-icao {
  color: #fff !important;
}

.airport-atis--new {
  animation: airport-new-blink 0.55s ease-in-out 6;
  border-color: #81c784 !important;
  background: rgba(129, 199, 132, 0.18);
}

.airport-atis--new .airport-icao {
  color: #e8f5e9 !important;
  font-weight: 700;
}

@keyframes airport-new-blink {
  0%, 100% {
    background: rgba(129, 199, 132, 0.12);
    box-shadow: none;
  }
  50% {
    background: rgba(129, 199, 132, 0.4);
    box-shadow: 0 0 8px rgba(129, 199, 132, 0.55);
  }
}

.idle-hint {
  color: #aaa;
  font-size: 11px;
}

.column-count-ctrl {
  display: inline-flex;
  align-items: center;
  gap: 0;
  margin-left: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 3px;
  height: 22px;
  padding: 0 2px;
}

.column-count-label {
  min-width: 14px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: #ccc;
  letter-spacing: 0.04em;
}

.config-menu {
  min-width: 160px;
}
</style>
