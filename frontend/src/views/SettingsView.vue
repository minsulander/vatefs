<template>
    <v-app-bar color="#2b2d31" height="30" elevation="0">
        <v-btn variant="text" color="grey" to="/"
            ><v-icon>mdi-chevron-left</v-icon> RETURN TO APP</v-btn
        >
    </v-app-bar>
    <v-main>
        <v-container>
            <h1>Options</h1>
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
                    Play TopSky Coord sounds for transfer request, accept, and refuse.
                </p>
            </div>
        </v-container>
    </v-main>
</template>

<script setup lang="ts">
import { useEfsStore } from "@/store/efs"

const efs = useEfsStore()

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
</script>

<style scoped>
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
