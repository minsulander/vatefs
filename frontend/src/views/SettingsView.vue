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
                label="Flash changed times"
                class="mt-2"
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
                Flash green/yellow during the last minute of the TSAT ±5 startup window.
            </p>

            <v-switch
                color="white"
                base-color="grey-darken-1"
                hide-details
                label="Show strip ownership"
                class="mt-2"
                :model-value="efs.showStripOwnership"
                @update:model-value="onShowStripOwnership"
            />
            <p class="text-caption text-grey ml-13" style="margin-top: -15px">
                Show the tracking controller SI on strips.
            </p>

            <div v-if="efs.showStripOwnership" class="ownership-suboption">
                <v-switch
                    color="white"
                    base-color="grey-darken-1"
                    hide-details
                    density="compact"
                    label="Dim other-owned strips"
                    class="mt-1"
                    :model-value="efs.dimOtherOwnedStrips"
                    @update:model-value="onDimOtherOwnedStrips"
                />
                <p class="text-caption text-grey ownership-suboption-hint">
                    Dim strips assumed by other positions.
                </p>

                <v-switch
                    color="white"
                    base-color="grey-darken-1"
                    hide-details
                    density="compact"
                    label="Transfer sounds"
                    class="mt-1"
                    :model-value="efs.transferSoundsEnabled"
                    @update:model-value="onTransferSounds"
                />
                <p class="text-caption text-grey ownership-suboption-hint">
                    Play EuroScope handoff sounds for transfer request, accept, and refuse.
                </p>
            </div>

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
                Always show the ideal SI and frequency on XFER, even when AFV does not detect the
                covering position monitoring that frequency.
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
                (requires GRP stand data).
            </p>
        </v-container>
    </v-main>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useEfsStore } from "@/store/efs"
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

function onShowStripOwnership(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ showStripOwnership: value })
}

function onDimOtherOwnedStrips(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ dimOtherOwnedStrips: value })
}

function onShowAppDepXcFrequency(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ showAppDepXcFrequency: value })
}

function onAutoParkEnabled(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ autoParkEnabled: value })
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

.ownership-suboption {
    margin-left: 2rem;
}

.ownership-suboption-hint {
    margin-top: -10px;
    margin-left: 2.75rem; /* align under compact switch label */
}

.ownership-suboption :deep(.v-switch) {
    font-size: 0.875rem;
}

.ownership-suboption :deep(.v-label) {
    font-size: 0.875rem;
    opacity: 0.9;
}
</style>
