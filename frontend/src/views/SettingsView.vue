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
                Play EuroScope sounds for transfer request, accept, and refuse.
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
import { computed } from "vue"
import { useEfsStore } from "@/store/efs"
import { isAutoLopSsrMode } from "@vatefs/common"
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

function onShowTobtSetByA(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ showTobtSetByA: value })
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
</style>
