<template>
  <v-dialog :model-value="store.vatIrisSignInOpen" max-width="440" persistent @update:model-value="onOpen">
    <v-card class="vatiris-dialog-card">
      <v-card-title class="text-h6">Sign in to VatIRIS</v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-2">
          VatEFS sync could not authenticate. Sign in to VatIRIS once in your browser, then return here.
        </p>
        <p v-if="store.vatIrisSignInDetail" class="text-caption text-grey">
          {{ store.vatIrisSignInDetail }}
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" class="text-none" @click="store.closeVatIrisSignIn()">Later</v-btn>
        <v-btn color="amber-darken-2" variant="flat" class="text-none" @click="openVatIris">
          Open VatIRIS
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { useEfsStore } from '@/store/efs'

const store = useEfsStore()
const VATIRIS_URL = 'https://vatiris.se'

function onOpen(v: boolean) {
  if (!v) store.closeVatIrisSignIn()
}

function openVatIris() {
  const w = window as Window & { electron?: { openExternal?: (url: string) => void } }
  if (w.electron?.openExternal) {
    w.electron.openExternal(VATIRIS_URL)
  } else {
    window.open(VATIRIS_URL, '_blank', 'noopener,noreferrer')
  }
  store.closeVatIrisSignIn()
}
</script>

<style scoped>
.vatiris-dialog-card {
  background: #2b2d31;
}
</style>
