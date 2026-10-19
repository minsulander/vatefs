<template>
    <v-app-bar color="#2b2d31" height="30" elevation="0">
        <v-btn variant="text" color="grey" to="/"
            ><v-icon>mdi-chevron-left</v-icon> RETURN TO APP</v-btn
        >
    </v-app-bar>
    <v-main>
        <v-container>
            <h1>Options</h1>

            <div class="ui-scale-option mb-4">
                <div class="ui-scale-label">
                    <span>UI scale</span>
                    <span class="ui-scale-value">{{ uiScalePercent }}%</span>
                </div>
                <v-slider
                    :model-value="uiScalePercent"
                    :min="UI_SCALE_PERCENT_MIN"
                    :max="UI_SCALE_PERCENT_MAX"
                    :step="UI_SCALE_PERCENT_STEP"
                    color="amber-darken-2"
                    track-color="grey-darken-2"
                    thumb-label
                    hide-details
                    class="ui-scale-slider"
                    @update:model-value="onUiScale"
                />
                <p class="text-caption text-grey mt-1">
                    Scales bars, menus, and dialogs. Flight strips still follow bay column width.
                </p>
            </div>

            <div class="scribble-mode-option mb-4">
                <div class="ui-scale-label">Zoomed strip scribble</div>
                <v-btn-toggle
                    :model-value="scribbleMode"
                    mandatory
                    density="comfortable"
                    color="amber-darken-2"
                    class="scribble-mode-toggle"
                    @update:model-value="onScribbleMode"
                >
                    <v-btn value="always" class="text-none" size="small">Always on</v-btn>
                    <v-btn value="toggle" class="text-none" size="small">Pen button</v-btn>
                </v-btn-toggle>
                <p class="text-caption text-grey mt-1">
                    Always on: draw immediately in zoomed mode. Pen button: tap Pen first, then scribble.
                </p>
            </div>

            <template v-if="efs.isPaperLook">
                <div class="scribble-mode-option mb-4">
                    <div class="ui-scale-label">Strip print mode</div>
                    <v-btn-toggle
                        :model-value="efs.stripPrintMode"
                        mandatory
                        density="comfortable"
                        color="amber-darken-2"
                        class="scribble-mode-toggle"
                        @update:model-value="onStripPrintMode"
                    >
                        <v-btn value="auto" class="text-none" size="small">Auto</v-btn>
                        <v-btn value="manual" class="text-none" size="small">Manual</v-btn>
                    </v-btn-toggle>
                    <p class="text-caption text-grey mt-1">
                        Auto: strips appear when eligible (default). Manual: print each strip from the printer queue.
                    </p>
                </div>

                <div class="scribble-mode-option mb-4">
                    <div class="ui-scale-label">Strip print animation(+sound)</div>
                    <v-btn-toggle
                        :model-value="efs.stripPrintSound"
                        mandatory
                        density="comfortable"
                        color="amber-darken-2"
                        class="scribble-mode-toggle"
                        @update:model-value="onStripPrintSound"
                    >
                        <v-btn value="off" class="text-none" size="small">Off</v-btn>
                        <v-btn value="short" class="text-none" size="small">Short</v-btn>
                        <v-btn value="long" class="text-none" size="small">Long</v-btn>
                    </v-btn-toggle>
                    <p class="text-caption text-grey mt-1">
                        Printer sound and print animation length when a strip appears.
                        Off: strips appear instantly. Default: Short.
                    </p>
                </div>

                <div class="scribble-mode-option mb-4">
                    <div class="ui-scale-label">VatIRIS FSP server</div>
                    <v-switch
                        color="white"
                        base-color="grey-darken-1"
                        hide-details
                        density="compact"
                        label="Allow printing from IRIS"
                        class="mt-1"
                        :model-value="efs.fspServerEnabled"
                        @update:model-value="onFspServerEnabled"
                    />
                    <p class="text-caption text-grey mt-1">
                        Off by default. When on, VatIRIS can create paper strips via
                        <code class="fsp-inline">POST /api/print/external</code>.
                    </p>
                    <div class="fsp-url-row" :class="{ 'fsp-url-row--disabled': !efs.fspServerEnabled }">
                        <code class="fsp-url-value">{{ fspUrlDisplay }}</code>
                        <v-btn
                            size="small"
                            variant="tonal"
                            class="text-none"
                            :disabled="!fspUrlDisplay"
                            @click="copyFspUrl"
                        >
                            {{ fspCopied ? 'Copied' : 'Copy' }}
                        </v-btn>
                    </div>
                    <p class="text-caption text-grey mt-1">
                        Paste into VatIRIS → Settings → FSP Server URL (enable FSP there too).
                    </p>
                    <p v-if="fspAltUrls.length" class="text-caption text-grey mt-1">
                        Other LAN addresses:
                        <button
                            v-for="u in fspAltUrls"
                            :key="u"
                            type="button"
                            class="fsp-alt-link"
                            @click="copyFspUrlValue(u)"
                        >{{ u }}</button>
                    </p>
                </div>
            </template>

            <v-switch
                color="white"
                base-color="grey-darken-1"
                hide-details
                label="DCL notification sound"
                :model-value="efs.dclSoundEnabled"
                @update:model-value="onDclSound"
            />
            <p class="text-caption text-grey ml-13" style="margin-top: -15px">
                Play the TopSky CPDLC sound on the EuroScope PC when a DCL request arrives.
            </p>

            <div class="scribble-mode-option mb-4 mt-4">
                <div class="ui-scale-label">Hoppie logon code</div>
                <div class="hoppie-code-row">
                    <input
                        v-model="hoppieDraft"
                        class="hoppie-code-input"
                        :class="{ 'hoppie-code-input--invalid': hoppieError }"
                        :type="hoppieVisible ? 'text' : 'password'"
                        autocomplete="off"
                        spellcheck="false"
                        autocapitalize="off"
                        placeholder="Leave empty to use the plugin file"
                        @focus="hoppieFocused = true"
                        @blur="onHoppieBlur"
                        @keydown.enter.prevent="saveHoppieCode"
                    />
                    <v-btn
                        size="small"
                        variant="text"
                        class="text-none"
                        @mousedown.prevent
                        @click="hoppieVisible = !hoppieVisible"
                    >
                        {{ hoppieVisible ? 'Hide' : 'Show' }}
                    </v-btn>
                    <v-btn
                        size="small"
                        variant="tonal"
                        class="text-none"
                        @mousedown.prevent
                        @click="saveHoppieCode"
                    >
                        Save
                    </v-btn>
                </div>
                <p v-if="hoppieError" class="text-caption hoppie-code-error mt-1">{{ hoppieError }}</p>
                <p class="text-caption text-grey mt-1">{{ hoppieHint }}</p>
            </div>

            <v-switch
                color="white"
                base-color="grey-darken-1"
                hide-details
                label="Coordination sounds"
                class="mt-2"
                :model-value="efs.transferSoundsEnabled"
                @update:model-value="onTransferSounds"
            />
            <p class="text-caption text-grey ml-13" style="margin-top: -15px">
                Play EuroScope sounds for transfer and XFL coordination (request, accept, refuse).
            </p>

            <v-switch
                v-if="showAppDepXcOption"
                color="white"
                base-color="grey-darken-1"
                hide-details
                label="Force display XC frequencies"
                class="mt-2"
                :model-value="efs.showAppDepXcFrequency"
                @update:model-value="onShowAppDepXcFrequency"
            />
            <p
                v-if="showAppDepXcOption"
                class="text-caption text-grey ml-13"
                style="margin-top: -15px"
            >
                ESGG and ESSA only. Always show the ideal SI and frequency on XFER, even when AFV
                does not detect the covering position monitoring that frequency.
            </p>

            <v-switch
                v-if="efs.autoParkAvailable"
                color="white"
                base-color="grey-darken-1"
                hide-details
                label="Auto PARK"
                class="mt-2"
                :model-value="efs.autoParkEnabled"
                @update:model-value="onAutoParkEnabled"
            />
            <p
                v-if="efs.autoParkAvailable"
                class="text-caption text-grey ml-13"
                style="margin-top: -15px"
            >
                Automatically set PARK when an assumed arrival is stationary at a stand
                (requires GRP stand data). In paper strip mode, Auto PARK also removes the strip.
            </p>

            <div class="scribble-mode-option mb-4 mt-2">
                <div class="ui-scale-label">Auto LOP+SSR</div>
                <v-btn-toggle
                    :model-value="efs.autoLopSsr"
                    mandatory
                    density="comfortable"
                    color="amber-darken-2"
                    class="scribble-mode-toggle"
                    @update:model-value="onAutoLopSsr"
                >
                    <v-btn value="instant" class="text-none" size="small">Instant</v-btn>
                    <v-btn value="assume" class="text-none" size="small">On assume</v-btn>
                    <v-btn value="manual" class="text-none" size="small">Manual</v-btn>
                </v-btn-toggle>
                <p class="text-caption text-grey mt-1">
                    Assign LOP DCT / preferred SID, CFL and TopSky squawk for untracked or own IFR
                    departures. Instant: on connect/spawn. On assume: when you assume.
                    Manual: when opening clearance. Instant and On assume show
                    <strong>ACK CLR</strong>.
                </p>
            </div>

            <v-switch
                color="white"
                base-color="grey-darken-1"
                hide-details
                label="RTC ASSR Simulation"
                class="mt-2"
                :model-value="efs.rtcAssrSimulation"
                @update:model-value="onRtcAssrSimulation"
            />
            <p class="text-caption text-grey ml-13" style="margin-top: -15px">
                RTC only. Departures from LOP verbal-ACC SSR airports (ESCF, ESGJ, ESGT, …): hide
                live ES ASSR until you enter a manual code (click) or double-click to generate via
                TopSky. ESSA, ESGG, arrivals, and local flights always show the EuroScope code.
                On by default.
            </p>

            <v-switch
                color="white"
                base-color="grey-darken-1"
                hide-details
                label="Contact me (C ME)"
                class="mt-2"
                :model-value="efs.contactMeEnabled"
                @update:model-value="onContactMeEnabled"
            />
            <p class="text-caption ml-13 contact-me-warning" style="margin-top: -15px">
                Only works with ES in focus, so when EFS is running on (other) networked device!
            </p>

            <h2 class="settings-section-title">VatEFS sync</h2>

            <v-switch
                color="white"
                base-color="grey-darken-1"
                hide-details
                label="Sync scribbles and strips"
                :model-value="efs.syncEnabled"
                @update:model-value="onSyncEnabled"
            />
            <p class="text-caption text-grey ml-13" style="margin-top: -15px">
                On by default. Shares freehand scribbles, bay placement, note and vehicle strips,
                and EFS-only flags (CLR read, QNH/ATIS) with other controllers. Turn off only if
                sync is causing problems.
            </p>

            <div class="scribble-mode-option mt-3 mb-2">
                <div class="ui-scale-label">Sync realm</div>
                <v-btn-toggle
                    :model-value="efs.scribbleSyncRealm"
                    mandatory
                    density="comfortable"
                    color="amber-darken-2"
                    class="scribble-mode-toggle"
                    @update:model-value="onScribbleSyncRealm"
                >
                    <v-btn value="auto" class="text-none" size="small">Auto</v-btn>
                    <v-btn value="live" class="text-none" size="small">Live</v-btn>
                    <v-btn value="sweatbox" class="text-none" size="small">Sweatbox</v-btn>
                    <v-btn value="local" class="text-none" size="small">Local</v-btn>
                </v-btn-toggle>
                <p class="text-caption text-grey mt-1">
                    Auto follows EuroScope connection (live / sweatbox / playback). Rooms are isolated per airport.
                </p>
            </div>

            <div class="d-flex align-center ga-2 mb-4" style="max-width: 28rem">
                <v-btn
                    size="small"
                    variant="tonal"
                    class="text-none"
                    @click="efs.openCidDialog(undefined, 'command')"
                >
                    Change CID
                </v-btn>
                <span class="text-caption text-grey">
                    {{ efs.vatsimCid?.trim() ? `Current: ${efs.vatsimCid.trim()}` : 'Not set' }}
                </span>
            </div>

            <h2 class="settings-section-title">CDM</h2>

            <v-switch
                color="white"
                base-color="grey-darken-1"
                hide-details
                label="Flash changed times"
                :model-value="efs.flashChangedTimes"
                @update:model-value="onFlashChangedTimes"
            />
            <p class="text-caption text-grey ml-13" style="margin-top: -15px">
                Briefly highlight TOBT, TSAT, and CTOT when their values change.
            </p>

            <v-switch
                color="white"
                base-color="grey-darken-1"
                hide-details
                label="Flash TSAT window"
                class="mt-2"
                :model-value="efs.flashTsatWindow"
                @update:model-value="onFlashTsatWindow"
            />
            <p class="text-caption text-grey ml-13" style="margin-top: -15px">
                Flash green/yellow during the last minute of the TSAT ±5 min startup window.
            </p>

            <v-switch
                color="white"
                base-color="grey-darken-1"
                hide-details
                label="Show TOBT set-by A (ATC)"
                class="mt-2"
                :model-value="efs.showTobtSetByA"
                @update:model-value="onShowTobtSetByA"
            />
            <p class="text-caption text-grey ml-13" style="margin-top: -15px">
                When on, show <strong>A</strong> next to TOBT if ATC set it. Pilot <strong>P</strong>
                always shows when applicable. Default: show A.
            </p>
        </v-container>
    </v-main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { useEfsStore } from "@/store/efs"
import { isAutoLopSsrMode, isValidHoppieLogonCode } from "@vatefs/common"
import {
    useUiScalePercent,
    setUiScalePercent,
    UI_SCALE_PERCENT_MIN,
    UI_SCALE_PERCENT_MAX,
    UI_SCALE_PERCENT_STEP,
} from "@/composables/useEfsUiScale"
import {
    useStripScribbleMode,
    setStripScribbleMode,
    type StripScribbleMode,
} from "@/composables/useStripScribbleMode"
import { isStripPrintSound } from "@/composables/useStripPrintSound"

function isStripPrintMode(value: unknown): value is "auto" | "manual" {
    return value === "auto" || value === "manual"
}

const efs = useEfsStore()
const uiScalePercent = useUiScalePercent()
const scribbleMode = useStripScribbleMode()

const hoppieDraft = ref("")
const hoppieVisible = ref(false)
const hoppieFocused = ref(false)
const hoppieError = ref("")

watch(
    () => efs.hoppieLogonCode,
    (code) => {
        if (!hoppieFocused.value) hoppieDraft.value = code
    },
    { immediate: true },
)

const hoppieHint = computed(() => {
    if (efs.hoppieLogonCode) {
        return "This code overrides ESAA/Plugins/TopSkyCPDLChoppieCode.txt. Clear the field and save to use the file again. An open Hoppie session reconnects when the code changes."
    }
    if (efs.hoppieFileCodePresent) {
        return "Using the code from ESAA/Plugins/TopSkyCPDLChoppieCode.txt. Type a code here to override it."
    }
    return "ESAA/Plugins/TopSkyCPDLChoppieCode.txt is empty or missing. Enter your Hoppie logon code. Letters and digits, under 40 characters."
})

function saveHoppieCode() {
    const trimmed = hoppieDraft.value.trim()
    hoppieDraft.value = trimmed
    if (trimmed !== "" && !isValidHoppieLogonCode(trimmed)) {
        hoppieError.value = "Use letters and digits only, shorter than 40 characters."
        return
    }
    hoppieError.value = ""
    if (trimmed === efs.hoppieLogonCode) return
    efs.updateUserSettings({ hoppieLogonCode: trimmed })
}

function onHoppieBlur() {
    hoppieFocused.value = false
    saveHoppieCode()
}

/** Prefer backend-reported LAN URL; fall back to this page's origin. */
const fspUrl = ref("")
const fspUrls = ref<string[]>([])
const fspCopied = ref(false)
let fspCopiedTimer: ReturnType<typeof setTimeout> | undefined

const fspUrlDisplay = computed(
    () => fspUrl.value || (typeof window !== "undefined" ? window.location.origin : ""),
)
const fspAltUrls = computed(() =>
    fspUrls.value.filter((u) => u !== fspUrlDisplay.value).slice(0, 4),
)

async function loadFspInfo() {
    try {
        const res = await fetch("/api/fsp")
        if (!res.ok) return
        const data = (await res.json()) as { fspUrl?: string; urls?: string[] }
        if (typeof data.fspUrl === "string" && data.fspUrl) fspUrl.value = data.fspUrl
        if (Array.isArray(data.urls)) fspUrls.value = data.urls.filter((u) => typeof u === "string")
    } catch {
        /* keep origin fallback */
    }
}

async function copyFspUrlValue(url: string) {
    if (!url) return
    try {
        await navigator.clipboard.writeText(url)
        fspCopied.value = true
        if (fspCopiedTimer) clearTimeout(fspCopiedTimer)
        fspCopiedTimer = setTimeout(() => {
            fspCopied.value = false
        }, 1600)
    } catch {
        /* ignore */
    }
}

function copyFspUrl() {
    void copyFspUrlValue(fspUrlDisplay.value)
}

onMounted(() => {
    void loadFspInfo()
})

function onUiScale(value: number | number[]) {
    const n = Array.isArray(value) ? value[0] : value
    if (typeof n !== "number" || !Number.isFinite(n)) return
    setUiScalePercent(n)
}

function onScribbleMode(value: unknown) {
    if (value === "always" || value === "toggle") {
        setStripScribbleMode(value as StripScribbleMode)
    }
}

const showAppDepXcOption = computed(() =>
    efs.myAirports.some((a) => {
        const u = a.toUpperCase()
        return u === "ESSA" || u === "ESGG"
    }),
)

function onStripPrintMode(value: unknown) {
    if (!isStripPrintMode(value)) return
    efs.updateUserSettings({ stripPrintMode: value })
}

function onStripPrintSound(value: unknown) {
    if (!isStripPrintSound(value)) return
    efs.updateUserSettings({ stripPrintSound: value })
}

function onFspServerEnabled(value: boolean | null) {
    if (typeof value !== 'boolean') return
    efs.updateUserSettings({ fspServerEnabled: value })
}

function onDclSound(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ dclSoundEnabled: value })
}

function onTransferSounds(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ transferSoundsEnabled: value })
}

function onFlashChangedTimes(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ flashChangedTimes: value })
}

function onFlashTsatWindow(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ flashTsatWindow: value })
}

function onShowAppDepXcFrequency(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ showAppDepXcFrequency: value })
}

function onAutoParkEnabled(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ autoParkEnabled: value })
}

function onAutoLopSsr(value: unknown) {
    if (!isAutoLopSsrMode(value)) return
    efs.updateUserSettings({ autoLopSsr: value })
}

function onRtcAssrSimulation(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ rtcAssrSimulation: value })
}

function onContactMeEnabled(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ contactMeEnabled: value })
}

function onShowTobtSetByA(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ showTobtSetByA: value })
}

function onSyncEnabled(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ syncEnabled: value })
}

function onScribbleSyncRealm(value: unknown) {
    if (
        value === "auto" ||
        value === "live" ||
        value === "sweatbox" ||
        value === "playback" ||
        value === "local"
    ) {
        efs.updateUserSettings({ scribbleSyncRealm: value })
    }
}
</script>

<style scoped>
.ui-scale-option {
    max-width: 28rem;
}

.ui-scale-label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 0.95rem;
    margin-bottom: 0.25rem;
}

.ui-scale-value {
    color: #b0b4ba;
    font-variant-numeric: tabular-nums;
}

.ui-scale-slider {
    margin-inline: 4px;
}

.scribble-mode-option {
    max-width: 28rem;
}

.scribble-mode-toggle {
    margin-top: 0.25rem;
}

.settings-section-title {
    margin: 1.5rem 0 0.75rem;
    font-size: 1.1rem;
    font-weight: 600;
    color: #c4c8ce;
}

.contact-me-warning {
    max-width: 36rem;
    padding: 0.35rem 0.55rem;
    border-radius: 4px;
    font-weight: 600;
    color: #1a1a1a;
    background: #fddf5f;
}

.fsp-url-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.65rem;
    flex-wrap: wrap;
}

.fsp-url-row--disabled {
    opacity: 0.55;
}

.fsp-url-value {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.35rem 0.55rem;
    border-radius: 4px;
    background: #1e2024;
    border: 1px solid #4a4d55;
    color: #f0c040;
    font-size: 0.85rem;
    word-break: break-all;
}

.fsp-inline {
    color: #b0b4ba;
    font-size: 0.9em;
}

.hoppie-code-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.35rem;
}

.hoppie-code-input {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    padding: 0.4rem 0.55rem;
    border-radius: 4px;
    background: #1e2024;
    border: 1px solid #4a4d55;
    color: #f0f2f5;
    font: inherit;
    font-size: 0.9rem;
    letter-spacing: 0.04em;
    outline: none;
}

.hoppie-code-input:focus {
    border-color: #f0c040;
}

.hoppie-code-input--invalid {
    border-color: #ef5350;
}

.hoppie-code-error {
    color: #ef9a9a;
}

.fsp-alt-link {
    display: inline;
    margin-left: 0.35rem;
    padding: 0;
    border: none;
    background: none;
    color: #93c5fd;
    font: inherit;
    font-size: inherit;
    text-decoration: underline;
    cursor: pointer;
}
</style>
