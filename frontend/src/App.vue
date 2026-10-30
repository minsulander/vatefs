<template>
    <v-app theme="dark">
        <div v-if="bannerVisible && updateInfo" class="efs-update-banner" role="status">
            <span>{{ updateBannerText }}</span>
            <a class="efs-update-link" :href="updateInfo.htmlUrl" target="_blank" rel="noopener">
                Open release
            </a>
            <button type="button" class="efs-update-dismiss" @click="dismissBanner">Dismiss</button>
        </div>
        <router-view />
        <CidDialog />
        <VatIrisSignInDialog />
    </v-app>
</template>

<script lang="ts" setup>
import { computed, watch } from "vue"
import { useEfsStore } from "./store/efs"
import { useEfsUiScale } from "./composables/useEfsUiScale"
import { useScreenWakeLock } from "./composables/useScreenWakeLock"
import { useAppUpdateCheck } from "./composables/useAppUpdateCheck"
import { setBayBgRtcPalette, startBayBackground } from "./composables/useBayBackground"
import CidDialog from "./components/CidDialog.vue"
import VatIrisSignInDialog from "./components/VatIrisSignInDialog.vue"

const efs = useEfsStore()
useEfsUiScale()
useScreenWakeLock()
const { updateInfo, bannerVisible, dismissBanner } = useAppUpdateCheck()
startBayBackground()

const updateBannerText = computed(() => {
  const info = updateInfo.value
  if (!info) return ''
  const dllHint = 'Unload the plugin or close EuroScope before installing the update.'
  const outdated: string[] = []
  if (info.appOutdated) outdated.push(`App ${info.currentAppVersion} is outdated`)
  if (info.pluginOutdated && info.currentPluginVersion) {
    outdated.push(`ES plugin ${info.currentPluginVersion} is outdated`)
  }
  return `${outdated.join('. ')}. VatEFS ${info.latestVersion} is available. ${dllHint}`
})
// ESSA keeps cold grey bay bg; RTC uses warm grey palette
watch(
  () => efs.multiAirport,
  (rtc) => setBayBgRtcPalette(!!rtc),
  { immediate: true },
)

/** Once after settings load: prompt for VATSIM CID if unset (sync auth). */
let cidPromptedOnce = false
watch(
  () => [efs.userSettingsLoaded, efs.vatsimCid] as const,
  ([loaded, cid]) => {
    if (!loaded || cidPromptedOnce) return
    if ((cid || '').trim()) {
      cidPromptedOnce = true
      return
    }
    cidPromptedOnce = true
    efs.openCidDialog(undefined, 'missing')
  },
)
</script>

<style>
.efs-update-banner {
    position: relative;
    z-index: 3000;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    padding: 8px 12px;
    background: #3a3420;
    color: #f5e6b8;
    font: 600 13px/1.35 system-ui, "Segoe UI", sans-serif;
    border-bottom: 1px solid #6a5a28;
}
.efs-update-link {
    color: #ffe08a;
    font-weight: 700;
    text-decoration: underline;
}
.efs-update-dismiss {
    margin-left: auto;
    appearance: none;
    border: 1px solid #8a7a40;
    background: transparent;
    color: #f5e6b8;
    padding: 2px 10px;
    cursor: pointer;
    font: inherit;
}

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

/*
 * Apple Pencil / stylus: allow click synthesis on interactive controls.
 * Global touch-action:none (while dragging) and strip user-select rules otherwise
 * make pen taps unreliable compared to finger touchend handlers.
 */
.flight-strip button,
.flight-strip input,
.flight-strip textarea,
.flight-strip a,
.efs-popup-menu button,
.efs-popup-chip,
.action-button {
    touch-action: manipulation;
}
</style>
