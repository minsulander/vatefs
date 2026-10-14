<template>
  <v-dialog
    :model-value="store.cidDialogOpen"
    max-width="340"
    persistent
    content-class="cid-dialog-wrapper"
    @update:model-value="onOpen"
  >
    <div class="efs-popup-menu efs-popup-menu--wide cid-dialog" @click.stop>
      <div class="efs-popup-header">VATSIM CID</div>
      <div class="efs-popup-subheader cid-subheader">
        {{
          store.cidDialogReason === 'missing'
            ? 'Required for VatEFS sync'
            : 'Sync authentication'
        }}
      </div>

      <div class="efs-popup-list cid-body">
        <p class="cid-hint">
          {{
            store.cidDialogReason === 'missing'
              ? 'Enter your VATSIM CID (sent as X-Vatsim-Cid).'
              : 'Enter your VATSIM CID for VatEFS sync.'
          }}
        </p>
        <div class="efs-popup-item clnc-field-row cid-field">
          <span class="clnc-field-label">CID</span>
          <input
            ref="cidInputEl"
            v-model="cid"
            class="cid-input"
            :class="{ invalid: !!error }"
            type="text"
            inputmode="numeric"
            maxlength="10"
            placeholder="e.g. 1234567"
            spellcheck="false"
            autocomplete="off"
            @input="error = ''"
            @keydown.enter.prevent="submit"
            @keydown.escape.prevent="store.closeCidDialog()"
          />
        </div>
        <p v-if="error" class="cid-error">{{ error }}</p>
        <p v-if="store.cidDialogSuggested" class="cid-suggest">
          Suggested from ES*.prf:
          <button type="button" class="cid-suggest-btn" @click="cid = store.cidDialogSuggested || ''">
            {{ store.cidDialogSuggested }}
          </button>
        </p>
      </div>

      <div class="clnc-actions clnc-actions-2">
        <button type="button" class="efs-popup-footer clnc-action" @click="store.closeCidDialog()">
          Cancel
        </button>
        <button type="button" class="efs-popup-footer clnc-action" @click="submit">Save</button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useEfsStore } from '@/store/efs'

const store = useEfsStore()
const cid = ref('')
const error = ref('')
const cidInputEl = ref<HTMLInputElement | null>(null)

watch(
  () => store.cidDialogOpen,
  async (open) => {
    if (open) {
      cid.value = store.vatsimCid || store.cidDialogSuggested || ''
      error.value = ''
      await nextTick()
      cidInputEl.value?.focus()
      cidInputEl.value?.select()
    }
  },
)

watch(
  () => store.cidDialogSuggested,
  (s) => {
    if (store.cidDialogOpen && s && !cid.value) cid.value = s
  },
)

function onOpen(v: boolean) {
  if (!v) store.closeCidDialog()
}

function submit() {
  const t = cid.value.trim()
  if (t !== '' && !/^\d{4,10}$/.test(t)) {
    error.value = 'CID must be 4–10 digits'
    return
  }
  error.value = ''
  store.submitVatsimCid(t)
}
</script>

<style>
/* Teleported dialog chrome */
.cid-dialog-wrapper {
  box-shadow: none !important;
  background: transparent !important;
}

.cid-dialog .cid-subheader {
  font-size: calc(11px * var(--s, 1));
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: none;
}

.cid-dialog .cid-body {
  padding: calc(8px * var(--s, 1)) 0 calc(4px * var(--s, 1));
  max-height: none;
}

.cid-dialog .cid-hint {
  margin: 0;
  padding: calc(4px * var(--s, 1)) calc(10px * var(--s, 1)) calc(8px * var(--s, 1));
  font-size: calc(11px * var(--s, 1));
  font-weight: 600;
  color: #222;
  line-height: 1.35;
  text-align: center;
}

.cid-dialog .cid-field {
  justify-content: flex-start;
  gap: calc(8px * var(--s, 1));
  padding: calc(6px * var(--s, 1)) calc(10px * var(--s, 1));
}

.cid-dialog .clnc-field-label {
  flex: 0 0 calc(36px * var(--s, 1));
  font-size: calc(11px * var(--s, 1));
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #000;
}

.cid-dialog .cid-input {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: calc(4px * var(--s, 1)) calc(6px * var(--s, 1));
  border: 1px solid #666;
  border-radius: 0;
  background: #ebebeb;
  color: #000;
  font: inherit;
  font-size: calc(14px * var(--s, 1));
  font-weight: 700;
  letter-spacing: 0.04em;
  outline: none;
}

.cid-dialog .cid-input:focus {
  border-color: #0088aa;
  background: #fff;
}

.cid-dialog .cid-input.invalid {
  border-color: #c62828;
}

.cid-dialog .cid-error {
  margin: 0;
  padding: 0 calc(10px * var(--s, 1)) calc(6px * var(--s, 1));
  font-size: calc(10px * var(--s, 1));
  font-weight: 700;
  color: #b71c1c;
  text-align: center;
}

.cid-dialog .cid-suggest {
  margin: 0;
  padding: calc(4px * var(--s, 1)) calc(10px * var(--s, 1)) calc(8px * var(--s, 1));
  font-size: calc(10px * var(--s, 1));
  font-weight: 600;
  color: #444;
  text-align: center;
}

.cid-dialog .cid-suggest-btn {
  margin: 0;
  padding: 0 calc(4px * var(--s, 1));
  border: none;
  background: transparent;
  color: #006688;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
  text-decoration: underline;
}

.cid-dialog .cid-suggest-btn:hover {
  color: #004466;
}

.cid-dialog .clnc-actions {
  display: flex;
  border-top: 2px solid #555;
}

.cid-dialog .clnc-actions-2 .clnc-action {
  flex: 1;
}

.cid-dialog .clnc-action {
  margin: 0;
  padding: calc(8px * var(--s, 1)) 0;
  border: none;
  border-radius: 0;
  border-right: 1px solid #888;
  appearance: none;
  background: #c0c0c0;
  color: #000;
  font-size: calc(11px * var(--s, 1));
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

.cid-dialog .clnc-action:last-child {
  border-right: none;
  background: #0077aa;
  color: #fff;
}

.cid-dialog .clnc-action:hover {
  filter: brightness(1.06);
}
</style>
