<template>
  <div class="efs-top-bar-host" :style="{ height: topBarHeight + 'px' }">
    <v-app-bar color="#2b2d31" :height="topBarHeight" elevation="0" class="efs-top-bar text-body-2 text-grey">
      <!-- Refresh button -->
      <v-btn variant="text" icon="mdi-refresh" size="small" class="text-grey" @click="efs.refresh()" title="Refresh"></v-btn>
      <v-btn variant="text" icon="mdi-cog" size="small" class="text-grey" to="/settings" title="Settings"></v-btn>
      <!-- Callsign -->
      <span class="text-grey ml-1">{{ efs.myCallsign || 'NOT CONNECTED' }}</span>
      <!-- ESSA runway combination (Appendix A/B) — click to select, hover for VatIRIS quickref -->
      <button
        v-if="efs.essaRolesMode"
        ref="essaRwyBtnEl"
        type="button"
        class="essa-rwy-btn ml-3"
        :title="essaRwyLabel || 'Select RWY config'"
        @click="essaRwyDialog = true"
        @mouseenter="onEssaRwyHoverEnter"
        @mouseleave="onEssaRwyHoverLeave"
      >
        {{ essaRwyLabel || 'RWY: —' }}
      </button>
      <Teleport to="body">
        <div
          v-if="essaRwyQuickrefVisible && essaRwyQuickrefUrl"
          class="essa-rwy-quickref"
          :style="{ top: essaRwyQuickrefStyle.top, left: essaRwyQuickrefStyle.left }"
        >
          <img
            :src="essaRwyQuickrefUrl"
            :alt="essaRwyLabel || 'RWY quickref'"
            class="essa-rwy-quickref-img"
            :style="{
              maxWidth: essaRwyQuickrefStyle.maxWidth,
              maxHeight: essaRwyQuickrefStyle.maxHeight,
            }"
          />
        </div>
      </Teleport>
      <v-dialog v-model="essaRwyDialog" max-width="440" scrim content-class="essa-rwy-dialog-wrap">
        <div class="essa-rwy-menu" @click.stop>
          <div class="essa-rwy-header">RWY CONFIG</div>
          <div v-if="essaRwyEsHint" class="essa-rwy-es">ES: {{ essaRwyEsHint }}</div>
          <div class="essa-rwy-list essa-rwy-list-cols">
            <button
              v-for="row in essaRwyOptions"
              :key="row.id"
              type="button"
              class="essa-rwy-item"
              :class="{
                selected: row.id === draftEssaRwyId,
                'es-match': row.matchesEs,
                'auto-pref': row.autoPreferred,
              }"
              @click="draftEssaRwyId = row.id"
            >
              <span class="essa-rwy-id">{{ row.id }}</span>
              <span class="essa-rwy-detail">{{ row.pdfName }}</span>
              <span v-if="row.autoPreferred" class="essa-rwy-auto-tag">AUTO</span>
            </button>
          </div>
          <div class="essa-rwy-actions">
            <button type="button" class="essa-rwy-action" @click="onEssaRwyAuto">AUTO</button>
            <button type="button" class="essa-rwy-action" @click="essaRwyDialog = false">CANCEL</button>
            <button type="button" class="essa-rwy-action essa-rwy-action-ok" @click="onEssaRwyOk">OK</button>
          </div>
        </div>
      </v-dialog>
      <!-- ESSA roles -->
      <button
        v-if="efs.essaRolesMode"
        type="button"
        class="essa-roles-btn ml-3"
        title="ESSA roles (click to change)"
        @click="essaRolesDialog = true"
      >
        Roles: {{ essaRolesLabel }}
      </button>
      <v-dialog v-model="essaRolesDialog" max-width="360" scrim>
        <v-card bg-color="#2b2d31" class="essa-roles-dialog text-grey">
          <v-card-title class="text-body-1 py-2">Roles</v-card-title>
          <v-card-text class="pt-0">
            <div class="essa-role-rows">
              <div class="essa-role-row">
                <label v-for="role in essaTwrRoles" :key="role" class="essa-role-option">
                  <input v-model="draftEssaRoles" type="checkbox" :value="role" />
                  <span>{{ role }}</span>
                </label>
              </div>
              <div class="essa-role-row">
                <label v-for="role in essaGndRoles" :key="role" class="essa-role-option">
                  <input v-model="draftEssaRoles" type="checkbox" :value="role" />
                  <span>{{ role }}</span>
                </label>
              </div>
              <div class="essa-role-row">
                <label v-for="role in essaCdRoles" :key="role" class="essa-role-option">
                  <input v-model="draftEssaRoles" type="checkbox" :value="role" />
                  <span>{{ role }}</span>
                </label>
              </div>
            </div>
          </v-card-text>
          <v-card-actions class="px-4 pb-3">
            <v-btn size="small" variant="text" class="text-grey" @click="onEssaRolesAuto">Auto</v-btn>
            <v-spacer />
            <v-btn size="small" variant="text" class="text-grey" @click="essaRolesDialog = false">Cancel</v-btn>
            <v-btn size="small" color="success" variant="flat" @click="onEssaRolesOk">OK</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
      <!-- ATIS / airports (hidden in ESSA mode — RWY config indicator covers runways) -->
      <template v-if="!efs.essaRolesMode">
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
      </template>
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
      <!-- ESSA mode: ATIS letters + QNH left of config selector -->
      <span
        v-if="efs.essaRolesMode && essaAtisBar"
        class="essa-atis-bar mr-2"
        :title="essaAtisBar.title"
      >
        <span v-if="essaAtisBar.arrAtis" class="text-amber">{{ essaAtisBar.arrAtis }}</span>
        <span v-if="essaAtisBar.depAtis" class="text-cyan ml-1">{{ essaAtisBar.depAtis }}</span>
        <span v-if="essaAtisBar.atis && !essaAtisBar.arrAtis && !essaAtisBar.depAtis" class="text-amber">{{ essaAtisBar.atis }}</span>
        <span v-if="essaAtisBar.qnh" class="text-grey ml-1">{{ essaAtisBar.qnh }}</span>
      </span>
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
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import { useEfsStore } from "../store/efs"
import type { ConfigInfo, DclMode } from "@vatefs/common"
import {
  ESSA_RWY_COMBINATIONS,
  formatEssaRwyConfigLabel,
  formatEssaRwyPdfName,
  findMatchingEssaRwyConfigs,
  resolveEssaRwyConfigId,
  essaRwyQuickrefImageUrl,
} from "@vatefs/common"
import { useEfsScaleValue } from "@/composables/useEfsUiScale"

const efs = useEfsStore()
const efsScale = useEfsScaleValue()
const topBarHeight = computed(() => Math.max(28, Math.round(28 * efsScale.value)))
const fullscreen = ref(window.innerHeight == screen.height)
const isStandalone = ('standalone' in navigator && (navigator as any).standalone) || window.matchMedia('(display-mode: standalone)').matches
const configMenuOpen = ref(false)

/** Display / picker order: CD → GND-* → TWR-E, TWR-W */
const ESSA_ROLE_ORDER = ['CD', 'GND-E', 'GND-N', 'GND-W', 'TWR-E', 'TWR-W'] as const
const essaCdRoles = ['CD'] as const
const essaGndRoles = ['GND-E', 'GND-N', 'GND-W'] as const
const essaTwrRoles = ['TWR-E', 'TWR-W'] as const
const essaRolesDialog = ref(false)
const draftEssaRoles = ref<string[]>([])
const essaRwyDialog = ref(false)
const draftEssaRwyId = ref<string | null>(null)
/** Minute tick so night/day letter auto-switch updates without ES change */
const essaRwyNowTick = ref(Date.now())
let essaRwyTickTimer: ReturnType<typeof setInterval> | null = null
const essaRwyBtnEl = ref<HTMLButtonElement | null>(null)
const essaRwyQuickrefVisible = ref(false)
const essaRwyQuickrefPos = ref({ top: 0, left: 0 })
let essaRwyHoverShowTimer: ReturnType<typeof setTimeout> | null = null

function sortEssaRolesDisplay(roles: string[]): string[] {
  const order = new Map(ESSA_ROLE_ORDER.map((r, i) => [r, i]))
  return [...roles].sort((a, b) => (order.get(a as typeof ESSA_ROLE_ORDER[number]) ?? 99) - (order.get(b as typeof ESSA_ROLE_ORDER[number]) ?? 99))
}

const essaRolesLabel = computed(() => {
  const roles = sortEssaRolesDisplay(efs.essaRoles)
  return roles.length > 0 ? roles.join(', ') : '(none)'
})

/** Active ESSA ARR/DEP from EuroScope (via ATIS/rwyconfig) */
const essaEsRunways = computed(() => {
  const info = efs.atisInfo.find(a => a.airport === 'ESSA') ?? efs.atisInfo[0]
  if (!info) return { arr: [] as string[], dep: [] as string[] }
  return { arr: info.arrRunways ?? [], dep: info.depRunways ?? [] }
})

// When ES runway selection changes, drop manual config and follow ES
watch(
  essaEsRunways,
  ({ arr, dep }) => {
    efs.syncEssaRwyConfigFromEs(arr, dep)
  },
  { deep: true },
)

const essaRwyEsHint = computed(() => {
  const { arr, dep } = essaEsRunways.value
  if (arr.length === 0 && dep.length === 0) return null
  return `ARR ${arr.join('/') || '?'} / DEP ${dep.join('/') || '?'}`
})

/** Config Auto would pick from ES ARR/DEP (+ day/night) — independent of manual draft */
const essaRwyAutoId = computed(() => {
  void essaRwyNowTick.value
  const { arr, dep } = essaEsRunways.value
  return resolveEssaRwyConfigId(arr, dep, new Date(essaRwyNowTick.value))
})

const essaRwyOptions = computed(() => {
  const { arr, dep } = essaEsRunways.value
  const matching = new Set(findMatchingEssaRwyConfigs(arr, dep).map(c => c.id))
  const autoId = essaRwyAutoId.value
  // Document order — do not float selected/ES match to the top
  return ESSA_RWY_COMBINATIONS.map(c => ({
    id: c.id,
    pdfName: formatEssaRwyPdfName(c),
    matchesEs: matching.has(c.id),
    autoPreferred: autoId != null && c.id === autoId,
  }))
})

/** Resolved ESSA config id (manual override or ES + night/day auto) */
const essaRwyConfigIdResolved = computed(() => {
  void essaRwyNowTick.value
  if (efs.essaRwyConfigManual && efs.essaRwyConfigId) return efs.essaRwyConfigId
  const { arr, dep } = essaEsRunways.value
  return resolveEssaRwyConfigId(arr, dep, new Date(essaRwyNowTick.value))
})

/** ESSA RWY config indicator from Appendix A/B + ES runways (+ manual / night auto) */
const essaRwyLabel = computed(() => {
  const { arr, dep } = essaEsRunways.value
  if (arr.length === 0 && dep.length === 0 && !efs.essaRwyConfigManual) return null
  return formatEssaRwyConfigLabel(arr, dep, {
    configId: efs.essaRwyConfigManual ? efs.essaRwyConfigId : undefined,
    now: new Date(essaRwyNowTick.value),
  })
})

/** VatIRIS TWR quickref PNG for the active config */
const essaRwyQuickrefUrl = computed(() => {
  const id = essaRwyConfigIdResolved.value
  return id ? essaRwyQuickrefImageUrl(id, 'TWR') : null
})

const essaRwyQuickrefStyle = computed(() => {
  const { top, left } = essaRwyQuickrefPos.value
  return {
    top: `${top}px`,
    left: `${left}px`,
    maxWidth: `calc(100vw - ${left}px - 4px)`,
    maxHeight: `calc(100vh - ${top}px - 4px)`,
  }
})

function onEssaRwyHoverEnter() {
  if (!essaRwyQuickrefUrl.value || !essaRwyBtnEl.value) return
  if (essaRwyHoverShowTimer) clearTimeout(essaRwyHoverShowTimer)
  essaRwyHoverShowTimer = setTimeout(() => {
    essaRwyHoverShowTimer = null
    if (!essaRwyBtnEl.value || !essaRwyQuickrefUrl.value) return
    const rect = essaRwyBtnEl.value.getBoundingClientRect()
    // Top-left of image anchored at the config text
    essaRwyQuickrefPos.value = { top: rect.top, left: rect.left }
    essaRwyQuickrefVisible.value = true
  }, 500)
}

function onEssaRwyHoverLeave() {
  if (essaRwyHoverShowTimer) {
    clearTimeout(essaRwyHoverShowTimer)
    essaRwyHoverShowTimer = null
  }
  essaRwyQuickrefVisible.value = false
}

watch(essaRolesDialog, (open) => {
  if (open) {
    draftEssaRoles.value = [...efs.essaRoles]
  }
})

watch(essaRwyDialog, (open) => {
  if (open) {
    if (essaRwyHoverShowTimer) {
      clearTimeout(essaRwyHoverShowTimer)
      essaRwyHoverShowTimer = null
    }
    essaRwyQuickrefVisible.value = false
    const { arr, dep } = essaEsRunways.value
    draftEssaRwyId.value =
      efs.essaRwyConfigManual && efs.essaRwyConfigId
        ? efs.essaRwyConfigId
        : resolveEssaRwyConfigId(arr, dep, new Date(essaRwyNowTick.value))
  }
})

function onEssaRolesOk() {
  efs.setEssaRoles([...draftEssaRoles.value], true)
  essaRolesDialog.value = false
}

function onEssaRolesAuto() {
  efs.setEssaRoles([], false)
  essaRolesDialog.value = false
}

function onEssaRwyOk() {
  if (draftEssaRwyId.value) {
    efs.setEssaRwyConfig(draftEssaRwyId.value, true)
  }
  essaRwyDialog.value = false
}

function onEssaRwyAuto() {
  efs.setEssaRwyConfig(null, false)
  essaRwyDialog.value = false
}

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

/** ESSA ATIS letters + QNH for the right-side bar (left of config selector) */
const essaAtisBar = computed(() => {
  if (!efs.essaRolesMode) return null
  const info = efs.atisInfo.find(a => a.airport === 'ESSA')
  if (!info) return null
  const arrAtis = info.arrAtis
  const depAtis = info.depAtis
  const atis = info.atis
  const qnh = info.qnh != null ? String(info.qnh) : undefined
  if (!arrAtis && !depAtis && !atis && !qnh) return null
  const parts: string[] = []
  if (arrAtis) parts.push(`ARR ATIS ${arrAtis}`)
  if (depAtis) parts.push(`DEP ATIS ${depAtis}`)
  if (atis && !arrAtis && !depAtis) parts.push(`ATIS ${atis}`)
  if (qnh) parts.push(`QNH ${qnh}`)
  return { arrAtis, depAtis, atis, qnh, title: parts.join(' · ') }
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
  essaRwyTickTimer = setInterval(() => {
    essaRwyNowTick.value = Date.now()
  }, 60_000)
})

onUnmounted(() => {
  if (essaRwyTickTimer) {
    clearInterval(essaRwyTickTimer)
    essaRwyTickTimer = null
  }
  if (essaRwyHoverShowTimer) {
    clearTimeout(essaRwyHoverShowTimer)
    essaRwyHoverShowTimer = null
  }
})
</script>

<style scoped>
.efs-top-bar-host {
  flex-shrink: 0;
}

.efs-top-bar {
  font-size: calc(13px * var(--efs-scale, 1));
}
.essa-atis-bar {
  font-size: calc(13px * var(--efs-scale, 1));
  font-weight: 600;
  letter-spacing: 0.3px;
  white-space: nowrap;
  user-select: none;
}
.dcl-mode-btn {
  min-width: 0 !important;
  padding: 0 calc(4px * var(--efs-scale, 1)) !important;
  margin-left: calc(-4px * var(--efs-scale, 1)) !important;
  font-size: calc(11px * var(--efs-scale, 1)) !important;
  letter-spacing: 0.5px;
}

.airport-atis--idle,
.airport-atis--open {
  cursor: pointer;
  padding: 0 calc(4px * var(--efs-scale, 1));
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
  font-size: calc(12px * var(--efs-scale, 1));
}

.column-count-ctrl {
  display: inline-flex;
  align-items: center;
  gap: 0;
  margin-left: calc(8px * var(--efs-scale, 1));
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 3px;
  height: max(28px, calc(22px * var(--efs-scale, 1)));
  padding: 0 calc(2px * var(--efs-scale, 1));
}

.column-count-label {
  min-width: calc(14px * var(--efs-scale, 1));
  text-align: center;
  font-size: calc(13px * var(--efs-scale, 1));
  font-weight: 600;
  color: #ccc;
  letter-spacing: 0.04em;
}

.config-menu {
  min-width: calc(160px * var(--efs-scale, 1));
}

.essa-roles-btn {
  background: transparent;
  border: none;
  color: #9e9e9e;
  cursor: pointer;
  font: inherit;
  padding: 0 calc(4px * var(--efs-scale, 1));
}

.essa-roles-btn:hover {
  color: #ccc;
}

.essa-rwy-btn {
  background: transparent;
  border: none;
  color: #ccc;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.02em;
  padding: 0 calc(4px * var(--efs-scale, 1));
  white-space: nowrap;
}

.essa-rwy-btn:hover {
  color: #fff;
}

/* VatIRIS quickref — top-left at config text; does not block UI underneath */
.essa-rwy-quickref {
  position: fixed;
  z-index: 2000;
  pointer-events: none;
  line-height: 0;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.55);
}

.essa-rwy-quickref-img {
  display: block;
  width: auto;
  height: auto;
  object-fit: contain;
  background: #1a1a1a;
}

/* RWY config — same visual language as DEP ROUTE */
.essa-rwy-menu {
  --rwy-strip-white: #ebebeb;
  width: 100%;
  background: #d8d8d8;
  border: 1px solid #888;
  border-radius: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  color: #000;
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: hidden;
}

.essa-rwy-header {
  padding: calc(6px * var(--efs-scale, 1)) calc(8px * var(--efs-scale, 1)) calc(2px * var(--efs-scale, 1));
  font-size: calc(9px * var(--efs-scale, 1));
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #000;
  text-transform: uppercase;
  text-align: center;
  background: #c0c0c0;
}

.essa-rwy-es {
  padding: 0 calc(8px * var(--efs-scale, 1)) calc(6px * var(--efs-scale, 1));
  font-size: calc(11px * var(--efs-scale, 1));
  font-weight: 800;
  letter-spacing: 0.3px;
  color: #000;
  text-align: center;
  text-transform: uppercase;
  background: #c0c0c0;
  border-bottom: 2px solid #555;
}

.essa-rwy-list {
  display: flex;
  flex-direction: column;
  background: #d8d8d8;
  overflow: visible;
  max-height: none;
}

.essa-rwy-list-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.essa-rwy-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: calc(6px * var(--efs-scale, 1));
  width: 100%;
  margin: 0;
  padding: calc(5px * var(--efs-scale, 1)) calc(8px * var(--efs-scale, 1));
  border: none;
  border-radius: 0;
  border-bottom: 1px solid #888;
  appearance: none;
  -webkit-appearance: none;
  background: #d8d8d8;
  color: #000;
  font-size: calc(10px * var(--efs-scale, 1));
  font-weight: 700;
  letter-spacing: 0.2px;
  text-transform: uppercase;
  text-align: left;
  cursor: pointer;
  line-height: 1.15;
  min-height: max(28px, calc(28px * var(--efs-scale, 1)));
}

.essa-rwy-auto-tag {
  margin-left: auto;
  flex-shrink: 0;
  font-size: calc(8px * var(--efs-scale, 1));
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #1a3a6e;
  background: rgba(26, 58, 110, 0.12);
  border: 1px solid #1a3a6e;
  padding: calc(1px * var(--efs-scale, 1)) calc(4px * var(--efs-scale, 1));
  line-height: 1.2;
}

.essa-rwy-item:hover .essa-rwy-auto-tag {
  color: var(--rwy-strip-white);
  background: rgba(235, 235, 235, 0.15);
  border-color: var(--rwy-strip-white);
}

.essa-rwy-item.selected .essa-rwy-auto-tag {
  color: #1a3a6e;
  background: rgba(26, 58, 110, 0.1);
  border-color: #1a3a6e;
}

.essa-rwy-list-cols .essa-rwy-item:nth-child(odd) {
  border-right: 1px solid #888;
}

.essa-rwy-list-cols .essa-rwy-item:nth-last-child(-n + 2) {
  border-bottom: none;
}

.essa-rwy-id {
  font-weight: 800;
  min-width: 2.2em;
  flex-shrink: 0;
}

.essa-rwy-detail {
  font-weight: 600;
  opacity: 0.9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.essa-rwy-item.es-match {
  background: #b8d4a8;
  color: #000;
  box-shadow: inset 0 0 0 1px #7a9a6a;
}

.essa-rwy-item.selected {
  background: var(--rwy-strip-white);
  color: #1a3a6e;
  box-shadow: inset 0 0 0 2px #1a3a6e;
}

.essa-rwy-item.es-match.selected {
  background: #b8d4a8;
  color: #1a3a6e;
  box-shadow: inset 0 0 0 2px #1a3a6e;
}

.essa-rwy-item:hover {
  background: #1a3a6e;
  color: var(--rwy-strip-white);
  box-shadow: inset 0 0 0 2px #000;
  position: relative;
  z-index: 1;
}

.essa-rwy-actions {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  border-top: 3px solid #333;
  background: #a8a8a8;
}

.essa-rwy-action {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: calc(10px * var(--efs-scale, 1)) calc(6px * var(--efs-scale, 1));
  border: none;
  border-right: 1px solid #777;
  border-radius: 0;
  appearance: none;
  -webkit-appearance: none;
  background: #a8a8a8;
  color: #000;
  font-size: calc(11px * var(--efs-scale, 1));
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  line-height: 1.1;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
  min-height: max(32px, calc(32px * var(--efs-scale, 1)));
}

.essa-rwy-action:last-child {
  border-right: none;
}

.essa-rwy-action:hover,
.essa-rwy-action-ok:hover {
  background: #1a3a6e;
  color: var(--rwy-strip-white);
  box-shadow: inset 0 0 0 2px #000;
}

.essa-role-rows {
  display: flex;
  flex-direction: column;
  gap: calc(10px * var(--efs-scale, 1));
}

.essa-role-row {
  display: flex;
  flex-wrap: wrap;
  gap: calc(8px * var(--efs-scale, 1)) calc(16px * var(--efs-scale, 1));
}

.essa-role-option {
  display: flex;
  align-items: center;
  gap: calc(8px * var(--efs-scale, 1));
  cursor: pointer;
  user-select: none;
  font-size: calc(13px * var(--efs-scale, 1));
  min-height: max(28px, calc(28px * var(--efs-scale, 1)));
}
</style>

<style>
/* Teleported dialog chrome — content-class is outside scoped tree */
.essa-rwy-dialog-wrap {
  box-shadow: none !important;
  background: transparent !important;
  overflow: visible !important;
}
</style>
