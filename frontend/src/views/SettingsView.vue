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

function onFlashChangedTimes(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ flashChangedTimes: value })
}

function onFlashTsatWindow(value: boolean | null) {
    if (typeof value !== "boolean") return
    efs.updateUserSettings({ flashTsatWindow: value })
}
</script>
