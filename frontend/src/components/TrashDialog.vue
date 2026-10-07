<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    max-width="420"
    content-class="trash-dialog-wrapper"
  >
    <div class="trash-dialog">
      <div class="trash-header">
        <v-icon size="20" class="trash-header-icon">mdi-delete-restore</v-icon>
        <span class="trash-title">Recover strip</span>
        <button class="trash-close" type="button" title="Close" @click="emit('update:modelValue', false)">×</button>
      </div>

      <div class="trash-search">
        <input
          ref="searchInput"
          v-model="query"
          class="trash-search-input"
          type="search"
          placeholder="Search callsign…"
          maxlength="12"
          @keydown.escape="emit('update:modelValue', false)"
        />
      </div>

      <div class="trash-list">
        <div v-if="filtered.length === 0" class="trash-empty">
          {{ store.deletedStrips.length === 0 ? 'Trash is empty' : 'No matches' }}
        </div>
        <button
          v-for="item in filtered"
          :key="item.stripId"
          type="button"
          class="trash-row"
          @click="onRestore(item.stripId)"
        >
          <div class="trash-row-main">
            <span class="trash-callsign">{{ item.callsign || '(note)' }}</span>
            <span class="trash-meta">{{ rowMeta(item) }}</span>
          </div>
          <span class="trash-restore">Restore</span>
        </button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { DeletedStripInfo } from '@vatefs/common'
import { useEfsStore } from '@/store/efs'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const store = useEfsStore()
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      query.value = ''
      store.listDeletedStrips()
      nextTick(() => searchInput.value?.focus())
    }
  }
)

const filtered = computed(() => {
  const q = query.value.trim().toUpperCase()
  const list = store.deletedStrips
  if (!q) return list
  return list.filter((s) => {
    const hay = `${s.callsign} ${s.adep} ${s.ades} ${s.aircraftType} ${s.noteText ?? ''}`.toUpperCase()
    return hay.includes(q)
  })
})

function rowMeta(item: DeletedStripInfo): string {
  if (item.stripType === 'note') {
    const text = (item.noteText || '').trim()
    return text ? text.slice(0, 40) : 'NOTE'
  }
  const route = [item.adep, item.ades].filter(Boolean).join('→')
  const type = item.aircraftType || ''
  return [item.stripType.toUpperCase(), type, route].filter(Boolean).join(' · ')
}

function onRestore(stripId: string) {
  store.restoreStrip(stripId)
}
</script>

<style>
.trash-dialog-wrapper {
  box-shadow: none !important;
}
</style>

<style scoped>
.trash-dialog {
  background: #2b2d31;
  border: 1px solid #4a4e54;
  color: #e8e8e8;
  font-family: system-ui, sans-serif;
}

.trash-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #3a3e42;
}

.trash-header-icon {
  color: #9ca3af;
}

.trash-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.3px;
  flex: 1;
}

.trash-close {
  background: none;
  border: none;
  color: #9ca3af;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}

.trash-close:hover {
  color: #fff;
}

.trash-search {
  padding: 10px 12px 8px;
}

.trash-search-input {
  width: 100%;
  box-sizing: border-box;
  background: #1e1f22;
  border: 1px solid #4a4e54;
  color: #e8e8e8;
  padding: 7px 10px;
  font-size: 13px;
  font-family: ui-monospace, monospace;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.trash-search-input:focus {
  outline: none;
  border-color: #6b7280;
}

.trash-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 0 8px 10px;
}

.trash-empty {
  padding: 24px 12px;
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
}

.trash-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  text-align: left;
  background: #35373c;
  border: 1px solid #4a4e54;
  color: inherit;
  padding: 8px 10px;
  margin-bottom: 6px;
  cursor: pointer;
  font: inherit;
}

.trash-row:hover {
  background: #3f4248;
  border-color: #6b7280;
}

.trash-row-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.trash-callsign {
  font-weight: 700;
  font-size: 13px;
  font-family: ui-monospace, monospace;
  letter-spacing: 0.4px;
}

.trash-meta {
  font-size: 10px;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}

.trash-restore {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: #86efac;
  text-transform: uppercase;
}
</style>
